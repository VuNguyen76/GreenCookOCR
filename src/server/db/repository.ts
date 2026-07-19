import { randomUUID } from "node:crypto";
import type { DocumentRow, DocumentStatus, OcrDocument } from "../../shared/ocr.js";
import type { ReconciliationResult } from "../services/reconciliation.js";
import { config } from "../config.js";
import { sanitizeClientErrorMessage } from "../services/public-errors.js";
import { stagingDatabase, type StagingDatabase } from "./staging.js";

export interface NewDocument {
  batchId: string;
  batchPosition: number;
  originalName: string;
  storedName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface PublishJob {
  id: string;
  document_id: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  error_message: string | null;
}

export class StagingRepository {
  constructor(private readonly database: StagingDatabase) {}

  async createBatch(fileCount: number): Promise<string> {
    const id = randomUUID();
    this.database.prepare(
      "INSERT INTO ocr_batches(id, file_count) VALUES (?, ?)"
    ).run(id, fileCount);
    return id;
  }

  async insertDocument(input: NewDocument): Promise<DocumentRow> {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO ocr_documents(
        id, batch_id, batch_position, original_name, stored_name, storage_path,
        mime_type, size_bytes, sha256, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
    `).run(
      id, input.batchId, input.batchPosition, input.originalName, input.storedName,
      input.storagePath, input.mimeType, input.sizeBytes, input.sha256
    );
    return this.documentRow(id);
  }

  async listDocuments(limit = 200): Promise<DocumentRow[]> {
    const rows = this.database.prepare(`
      SELECT document.*, count(item.id) AS item_count
      FROM ocr_documents document
      LEFT JOIN ocr_items item ON item.document_id = document.id
      GROUP BY document.id
      ORDER BY document.created_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => sanitizeDocumentRow(hydrateDocumentRow(row) as unknown as DocumentRow));
  }

  async getDocument(id: string): Promise<(Record<string, unknown> & { items: Record<string, unknown>[] }) | null> {
    const row = this.database.prepare(
      "SELECT * FROM ocr_documents WHERE id = ?"
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const items = this.database.prepare(
      "SELECT * FROM ocr_items WHERE document_id = ? ORDER BY line_no"
    ).all(id) as Array<Record<string, unknown>>;
    const document = sanitizeDocumentRecord(hydrateDocumentRow(row));
    const normalizedItems = normalizedItemsByLine(document.normalized_result);
    return {
      ...document,
      items: items.map((item) => {
        const hydrated = hydrateItemRow(item);
        return { ...normalizedItems.get(Number(hydrated.line_no)), ...hydrated };
      })
    };
  }

  async getStats(): Promise<Record<string, number>> {
    const rows = this.database.prepare(
      "SELECT status, count(*) AS count FROM ocr_documents GROUP BY status"
    ).all() as Array<{ status: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  async recoverStaleDocuments(): Promise<void> {
    this.database.prepare(`
      UPDATE ocr_documents
      SET status = 'queued', error_message = NULL, next_attempt_at = ?, updated_at = ?
      WHERE status IN ('preprocessing', 'ocr_running', 'validating')
        AND started_at < ?
    `).run(now(), now(), new Date(Date.now() - 10 * 60_000).toISOString());
    this.database.prepare(`
      UPDATE publish_outbox
      SET status = 'pending', next_attempt_at = ?, updated_at = ?
      WHERE status = 'running' AND updated_at < ?
    `).run(now(), now(), new Date(Date.now() - 10 * 60_000).toISOString());
    this.database.prepare(`
      UPDATE ocr_documents SET status = 'publishing', updated_at = ?
      WHERE status = 'publishing'
        AND EXISTS (
          SELECT 1 FROM publish_outbox job
          WHERE job.document_id = ocr_documents.id AND job.status = 'pending'
        )
    `).run(now());
  }

  async claimNextDocument(): Promise<DocumentRow | null> {
    const claim = this.database.transaction(() => {
      const row = this.database.prepare(`
        SELECT id FROM ocr_documents
        WHERE status = 'queued' AND next_attempt_at <= ?
        ORDER BY created_at, batch_position LIMIT 1
      `).get(now()) as { id: string } | undefined;
      if (!row) return null;
      this.database.prepare(`
        UPDATE ocr_documents
        SET status = 'preprocessing', attempts = attempts + 1,
            started_at = ?, updated_at = ?, error_message = NULL
        WHERE id = ?
      `).run(now(), now(), row.id);
      return this.documentRow(row.id);
    });
    return claim();
  }

  async setDocumentStatus(id: string, status: DocumentStatus, geminiFileName?: string): Promise<void> {
    this.database.prepare(`
      UPDATE ocr_documents
      SET status = ?, gemini_file_name = coalesce(?, gemini_file_name), updated_at = ?
      WHERE id = ?
    `).run(status, geminiFileName ?? null, now(), id);
  }

  async completeDocument(
    id: string,
    rawResult: unknown,
    normalizedOcr: OcrDocument,
    reconciliation: ReconciliationResult,
    model: string,
    promptVersion: string
  ): Promise<DocumentStatus> {
    const normalized = reconciliation.document;
    const auditsByLine = new Map(reconciliation.lines.map((line) => [line.lineNo, line]));
    const rawItems = getRawItems(rawResult);
    const complete = this.database.transaction(() => {
      this.database.prepare("DELETE FROM ocr_items WHERE document_id = ?").run(id);
      const insert = this.database.prepare(`
        INSERT INTO ocr_items(
          id, document_id, line_no, po_number, po_date, store_code, store_name,
          delivery_address, product_code, vendor_product_code, barcode, product_name,
          model, quantity, units_per_order_unit, unit, unit_price, vat_rate, amount,
          source_page, confidence, raw_row, match_method, match_confidence,
          field_sources, reconciliation_warnings, reconciled_by_ai
        ) VALUES (
          @id, @document_id, @line_no, @po_number, @po_date, @store_code, @store_name,
          @delivery_address, @product_code, @vendor_product_code, @barcode, @product_name,
          @model, @quantity, @units_per_order_unit, @unit, @unit_price, @vat_rate, @amount,
          @source_page, @confidence, @raw_row, @match_method, @match_confidence,
          @field_sources, @reconciliation_warnings, @reconciled_by_ai
        )
      `);
      normalized.items.forEach((item, index) => {
        const audit = auditsByLine.get(item.line_no);
        insert.run({
          id: randomUUID(),
          document_id: id,
          line_no: item.line_no,
          po_number: item.po_number,
          po_date: normalizeDateForDb(item.po_date),
          store_code: item.store_code,
          store_name: item.store_name,
          delivery_address: item.delivery_address,
          product_code: item.product_code,
          vendor_product_code: item.vendor_product_code,
          barcode: item.barcode,
          product_name: item.product_name,
          model: item.model,
          quantity: item.quantity,
          units_per_order_unit: item.units_per_order_unit,
          unit: item.unit,
          unit_price: item.unit_price,
          vat_rate: item.vat_rate,
          amount: item.amount,
          source_page: item.source_page,
          confidence: item.confidence,
          raw_row: json(rawItems[index] ?? item),
          match_method: audit?.matchMethod ?? "none",
          match_confidence: audit?.matchConfidence ?? item.confidence,
          field_sources: json(audit?.fieldSources ?? {}),
          reconciliation_warnings: json(audit?.warnings ?? []),
          reconciled_by_ai: audit?.reconciledByAi ? 1 : 0
        });
      });

      this.database.prepare(`
        UPDATE ocr_documents SET
          status = 'needs_review', document_title = ?, template_key = ?, issuer_name = ?,
          issuer_branch = ?, po_number = ?, po_date = ?, delivery_date = ?, currency = ?,
          supplier_name = ?, buyer_name = ?, delivery_address = ?, subtotal_amount = ?,
          tax_amount = ?, total_amount = ?, raw_result = ?, normalized_ocr_result = ?,
          normalized_result = ?, reconciliation_result = ?, reconciliation_version = ?,
          warnings = ?, model = ?, prompt_version = ?, error_message = NULL,
          completed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        normalized.document_title, normalized.template_key, normalized.issuer_name,
        normalized.issuer_branch, normalized.po_number, normalizeDateForDb(normalized.po_date),
        normalizeDateForDb(normalized.delivery_date), normalized.currency,
        normalized.supplier_name, normalized.buyer_name, normalized.delivery_address,
        normalized.subtotal_amount, normalized.tax_amount, normalized.total_amount,
        json(rawResult), json(normalizedOcr), json(normalized),
        json({ version: reconciliation.version, usedAi: reconciliation.usedAi, lines: reconciliation.lines }),
        reconciliation.version, json(normalized.warnings), model, promptVersion,
        now(), now(), id
      );
    });
    complete();
    return "needs_review";
  }

  async failDocument(id: string, attempts: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const publicMessage = sanitizeClientErrorMessage(message)
      ?? "OCR thất bại. Vui lòng kiểm tra lại tài liệu hoặc thử quét lại.";
    const retry = attempts < config.maxAttempts;
    const delaySeconds = Math.min(120, 2 ** attempts * 5);
    this.database.prepare(`
      UPDATE ocr_documents SET status = ?, error_message = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      retry ? "queued" : "failed",
      publicMessage.slice(0, 2000),
      retry ? new Date(Date.now() + delaySeconds * 1000).toISOString() : now(),
      now(), id
    );
  }

  async retryDocument(id: string): Promise<boolean> {
    const retry = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE ocr_documents SET status = 'queued', attempts = 0, error_message = NULL,
          next_attempt_at = ?, updated_at = ?, published_order_ids = '[]', published_at = NULL
        WHERE id = ? AND status IN (
          'failed', 'needs_review', 'completed', 'publish_failed', 'published',
          'preprocessing', 'ocr_running', 'validating'
        )
      `).run(now(), now(), id);
      if (result.changes) {
        this.database.prepare(`
          UPDATE ocr_runs SET status = 'failed', error_message = 'Retry requested', completed_at = ?
          WHERE document_id = ? AND status = 'running'
        `).run(now(), id);
        this.database.prepare("DELETE FROM publish_outbox WHERE document_id = ?").run(id);
      }
      return result.changes > 0;
    });
    return retry();
  }

  async setTargetPartner(id: string, bpartnerId: string, bpartnerName: string): Promise<boolean> {
    const result = this.database.prepare(`
      UPDATE ocr_documents SET target_bpartner_id = ?, target_bpartner_name = ?, updated_at = ?
      WHERE id = ? AND status IN ('needs_review', 'publish_failed')
    `).run(bpartnerId, bpartnerName, now(), id);
    return result.changes > 0;
  }

  async setItemProductMatch(
    documentId: string,
    itemId: string,
    product: { id: string; value: string; name: string },
    method = "manual"
  ): Promise<boolean> {
    const result = this.database.prepare(`
      UPDATE ocr_items SET matched_kg_sp_id = ?, matched_product_value = ?,
        matched_product_name = ?, match_method = ?, match_confidence = 1
      WHERE id = ? AND document_id = ?
        AND EXISTS (
          SELECT 1 FROM ocr_documents document
          WHERE document.id = ocr_items.document_id
            AND document.status IN ('needs_review', 'publish_failed', 'published')
        )
    `).run(product.id, product.value, product.name, method, itemId, documentId);
    return result.changes > 0;
  }

  async queuePublish(id: string): Promise<boolean> {
    const queue = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE ocr_documents SET status = 'publishing', confirmed_at = coalesce(confirmed_at, ?),
          error_message = NULL, updated_at = ?
        WHERE id = ? AND status IN ('needs_review', 'publish_failed')
      `).run(now(), now(), id);
      if (!result.changes) return false;
      this.database.prepare(`
        INSERT INTO publish_outbox(id, document_id, status, attempts, error_message, next_attempt_at, updated_at)
        VALUES (?, ?, 'pending', 0, NULL, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          status = 'pending', attempts = 0, error_message = NULL,
          next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at,
          completed_at = NULL
      `).run(randomUUID(), id, now(), now());
      return true;
    });
    return queue();
  }

  async claimNextPublishJob(): Promise<PublishJob | null> {
    const claim = this.database.transaction(() => {
      const row = this.database.prepare(`
        SELECT * FROM publish_outbox
        WHERE status IN ('pending', 'failed') AND next_attempt_at <= ?
        ORDER BY created_at LIMIT 1
      `).get(now()) as PublishJob | undefined;
      if (!row) return null;
      this.database.prepare(`
        UPDATE publish_outbox SET status = 'running', attempts = attempts + 1, updated_at = ?
        WHERE id = ?
      `).run(now(), row.id);
      return { ...row, status: "running" as const, attempts: row.attempts + 1 };
    });
    return claim();
  }

  async markPublished(jobId: string, documentId: string, orderIds: string[]): Promise<void> {
    const complete = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE publish_outbox SET status = 'completed', error_message = NULL,
          completed_at = ?, updated_at = ? WHERE id = ?
      `).run(now(), now(), jobId);
      this.database.prepare(`
        UPDATE ocr_documents SET status = 'published', published_order_ids = ?,
          published_at = ?, error_message = NULL, updated_at = ? WHERE id = ?
      `).run(json(orderIds), now(), now(), documentId);
    });
    complete();
  }

  async markPublishFailed(jobId: string, documentId: string, error: unknown): Promise<void> {
    const message = sanitizeClientErrorMessage(error instanceof Error ? error.message : String(error))
      ?? "Không thể đưa dữ liệu vào hệ thống iDempiere.";
    const fail = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE publish_outbox SET status = 'failed', error_message = ?,
          next_attempt_at = ?, updated_at = ? WHERE id = ?
      `).run(message.slice(0, 2000), new Date(Date.now() + 30_000).toISOString(), now(), jobId);
      this.database.prepare(`
        UPDATE ocr_documents SET status = 'publish_failed', error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(message.slice(0, 2000), now(), documentId);
    });
    fail();
  }

  async deleteDocument(id: string): Promise<DeleteDocumentResult> {
    const remove = this.database.transaction(() => {
      const document = this.database.prepare(`
        SELECT batch_id, stored_name, status FROM ocr_documents WHERE id = ?
      `).get(id) as { batch_id: string; stored_name: string; status: string } | undefined;
      if (!document) return { deleted: false as const, reason: "not_found" as const };
      if (["preprocessing", "ocr_running", "validating", "publishing"].includes(document.status)) {
        return { deleted: false as const, reason: "processing" as const };
      }
      this.database.prepare("DELETE FROM ocr_documents WHERE id = ?").run(id);
      this.database.prepare(`
        DELETE FROM ocr_batches WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM ocr_documents WHERE batch_id = ?)
      `).run(document.batch_id, document.batch_id);
      return { deleted: true as const, storedName: document.stored_name };
    });
    return remove();
  }

  async createRun(documentId: string, model: string, promptVersion: string): Promise<string> {
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO ocr_runs(id, document_id, status, model, prompt_version)
      VALUES (?, ?, 'running', ?, ?)
    `).run(id, documentId, model, promptVersion);
    return id;
  }

  async finishRun(
    id: string,
    status: "completed" | "failed",
    durationMs: number,
    interactionId?: string,
    errorMessage?: string
  ): Promise<void> {
    const publicErrorMessage = sanitizeClientErrorMessage(errorMessage ?? null);
    this.database.prepare(`
      UPDATE ocr_runs SET status = ?, duration_ms = ?, gemini_interaction_id = ?,
        error_message = ?, completed_at = ? WHERE id = ?
    `).run(
      status, durationMs, interactionId ?? null,
      publicErrorMessage?.slice(0, 2000) ?? null, now(), id
    );
  }

  private documentRow(id: string): DocumentRow {
    const row = this.database.prepare("SELECT * FROM ocr_documents WHERE id = ?").get(id);
    if (!row) throw new Error(`Không tìm thấy tài liệu staging ${id}`);
    return sanitizeDocumentRow(hydrateDocumentRow(row as Record<string, unknown>) as unknown as DocumentRow);
  }
}

export type DeleteDocumentResult =
  | { deleted: true; storedName: string }
  | { deleted: false; reason: "not_found" | "processing" };

const repository = new StagingRepository(stagingDatabase);

export const createBatch = (fileCount: number) => repository.createBatch(fileCount);
export const insertDocument = (input: NewDocument) => repository.insertDocument(input);
export const listDocuments = (limit = 200) => repository.listDocuments(limit);
export const getDocument = (id: string) => repository.getDocument(id);
export const getStats = () => repository.getStats();
export const recoverStaleDocuments = () => repository.recoverStaleDocuments();
export const claimNextDocument = () => repository.claimNextDocument();
export const setDocumentStatus = (id: string, status: DocumentStatus, fileName?: string) =>
  repository.setDocumentStatus(id, status, fileName);
export const completeDocument = (
  id: string,
  rawResult: unknown,
  normalizedOcr: OcrDocument,
  reconciliation: ReconciliationResult,
  model: string,
  promptVersion: string
) => repository.completeDocument(id, rawResult, normalizedOcr, reconciliation, model, promptVersion);
export const failDocument = (id: string, attempts: number, error: unknown) =>
  repository.failDocument(id, attempts, error);
export const retryDocument = (id: string) => repository.retryDocument(id);
export const queuePublish = (id: string) => repository.queuePublish(id);
export const claimNextPublishJob = () => repository.claimNextPublishJob();
export const markPublished = (jobId: string, documentId: string, orderIds: string[]) =>
  repository.markPublished(jobId, documentId, orderIds);
export const markPublishFailed = (jobId: string, documentId: string, error: unknown) =>
  repository.markPublishFailed(jobId, documentId, error);
export const setTargetPartner = (id: string, bpartnerId: string, name: string) =>
  repository.setTargetPartner(id, bpartnerId, name);
export const setItemProductMatch = (
  documentId: string,
  itemId: string,
  product: { id: string; value: string; name: string },
  method?: string
) => repository.setItemProductMatch(documentId, itemId, product, method);
export const deleteDocument = (id: string) => repository.deleteDocument(id);
export const createRun = (documentId: string, model: string, promptVersion: string) =>
  repository.createRun(documentId, model, promptVersion);
export const finishRun = (
  id: string,
  status: "completed" | "failed",
  durationMs: number,
  interactionId?: string,
  errorMessage?: string
) => repository.finishRun(id, status, durationMs, interactionId, errorMessage);

function hydrateDocumentRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    warnings: parseJson(row.warnings, []),
    raw_result: parseJson(row.raw_result, null),
    normalized_ocr_result: parseJson(row.normalized_ocr_result, null),
    normalized_result: parseJson(row.normalized_result, null),
    reconciliation_result: parseJson(row.reconciliation_result, null),
    published_order_ids: parseJson(row.published_order_ids, [])
  };
}

function hydrateItemRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    raw_row: parseJson(row.raw_row, {}),
    field_sources: parseJson(row.field_sources, {}),
    reconciliation_warnings: parseJson(row.reconciliation_warnings, []),
    reconciled_by_ai: Boolean(row.reconciled_by_ai)
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function now(): string {
  return new Date().toISOString();
}

function normalizeDateForDb(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function getRawItems(rawResult: unknown): unknown[] {
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) return [];
  const items = (rawResult as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

function normalizedItemsByLine(value: unknown): Map<number, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return new Map();
  return new Map(items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const lineNo = Number(row.line_no);
    return Number.isInteger(lineNo) ? [[lineNo, row] as const] : [];
  }));
}

export function sanitizeDocumentRow<T extends { error_message: string | null }>(row: T): T {
  return { ...row, error_message: sanitizeClientErrorMessage(row.error_message) };
}

function sanitizeDocumentRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    error_message: typeof row.error_message === "string"
      ? sanitizeClientErrorMessage(row.error_message)
      : null
  };
}
