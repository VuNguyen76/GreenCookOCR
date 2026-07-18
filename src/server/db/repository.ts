import { randomUUID } from "node:crypto";
import type { DocumentRow, DocumentStatus, OcrDocument } from "../../shared/ocr.js";
import type { ReconciliationResult } from "../services/reconciliation.js";
import { config } from "../config.js";
import { pool } from "./pool.js";
import { sanitizeClientErrorMessage } from "../services/public-errors.js";

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

export async function createBatch(fileCount: number): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into ocr_batches(id, file_count) values ($1, $2)",
    [id, fileCount]
  );
  return id;
}

export async function insertDocument(input: NewDocument): Promise<DocumentRow> {
  const id = randomUUID();
  const result = await pool.query<DocumentRow>(
    `insert into ocr_documents(
      id, batch_id, batch_position, original_name, stored_name, storage_path,
      mime_type, size_bytes, sha256, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued') returning *`,
    [
      id, input.batchId, input.batchPosition, input.originalName, input.storedName,
      input.storagePath, input.mimeType, input.sizeBytes, input.sha256
    ]
  );
  return result.rows[0];
}

export async function listDocuments(limit = 200): Promise<DocumentRow[]> {
  const result = await pool.query<DocumentRow>(
    `select d.*, count(i.id)::int as item_count
     from ocr_documents d
     left join ocr_items i on i.document_id = d.id
     group by d.id
     order by d.created_at desc
     limit $1`,
    [limit]
  );
  return result.rows.map(sanitizeDocumentRow);
}

export async function getDocument(id: string): Promise<Record<string, unknown> | null> {
  const document = await pool.query("select * from ocr_documents where id = $1", [id]);
  if (!document.rows[0]) return null;
  const items = await pool.query(
    "select * from ocr_items where document_id = $1 order by line_no",
    [id]
  );
  return { ...sanitizeDocumentRecord(document.rows[0]), items: items.rows };
}

export async function getStats(): Promise<Record<string, number>> {
  const result = await pool.query<{ status: string; count: string }>(
    "select status, count(*)::text as count from ocr_documents group by status"
  );
  return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
}

export async function recoverStaleDocuments(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const stale = await client.query<{ id: string }>(
      `update ocr_documents
       set status = 'queued', error_message = 'Worker restarted during processing',
           next_attempt_at = now(), updated_at = now()
       where status in ('preprocessing', 'ocr_running', 'validating')
         and started_at < now() - interval '10 minutes'
       returning id`
    );
    if (stale.rows.length > 0) {
      await client.query(
        `update ocr_runs
         set status = 'failed',
             error_message = 'Worker restarted during processing',
             completed_at = now()
         where status = 'running'
           and document_id = any($1::uuid[])`,
        [stale.rows.map((row) => row.id)]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextDocument(): Promise<DocumentRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const selected = await client.query<DocumentRow>(
      `select * from ocr_documents
       where status = 'queued' and next_attempt_at <= now()
       order by created_at, batch_position
       for update skip locked
       limit 1`
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("commit");
      return null;
    }
    const claimed = await client.query<DocumentRow>(
      `update ocr_documents
       set status = 'preprocessing', attempts = attempts + 1,
           started_at = now(), updated_at = now(), error_message = null
       where id = $1 returning *`,
      [row.id]
    );
    await client.query("commit");
    return claimed.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function setDocumentStatus(
  id: string,
  status: DocumentRow["status"],
  geminiFileName?: string
): Promise<void> {
  await pool.query(
    `update ocr_documents
     set status = $2, gemini_file_name = coalesce($3, gemini_file_name), updated_at = now()
     where id = $1`,
    [id, status, geminiFileName ?? null]
  );
}

export async function completeDocument(
  id: string,
  rawResult: unknown,
  normalizedOcr: OcrDocument,
  reconciliation: ReconciliationResult,
  model: string,
  promptVersion: string
): Promise<DocumentStatus> {
  const normalized = reconciliation.document;
  const status: DocumentStatus =
    normalized.confidence < 0.8 || normalized.template_key === "unknown" || normalized.warnings.length > 0
      ? "needs_review"
      : "completed";
  const auditsByLine = new Map(reconciliation.lines.map((line) => [line.lineNo, line]));
  const rawItems = getRawItems(rawResult);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from ocr_items where document_id = $1", [id]);
    for (const [index, item] of normalized.items.entries()) {
      const audit = auditsByLine.get(item.line_no);
      await client.query(
        `insert into ocr_items(
          id, document_id, line_no, po_number, po_date, store_code, store_name,
          delivery_address, product_code, vendor_product_code, barcode, product_name,
          model, quantity, units_per_order_unit, unit, unit_price, vat_rate, amount,
          source_page, confidence, raw_row, matched_reference_id,
          match_method, match_confidence, field_sources, reconciliation_warnings,
          reconciled_by_ai
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28
        )`,
        [
          randomUUID(), id, item.line_no, item.po_number, item.po_date, item.store_code,
          item.store_name, item.delivery_address, item.product_code,
          item.vendor_product_code, item.barcode, item.product_name, item.model,
          item.quantity, item.units_per_order_unit, item.unit, item.unit_price,
          item.vat_rate, item.amount, item.source_page, item.confidence,
          JSON.stringify(rawItems[index] ?? item),
          audit?.matchedReferenceId ?? null,
          audit?.matchMethod ?? "none",
          audit?.matchConfidence ?? item.confidence,
          JSON.stringify(audit?.fieldSources ?? {}),
          JSON.stringify(audit?.warnings ?? []),
          audit?.reconciledByAi ?? false
        ]
      );
    }
    await client.query(
      `update ocr_documents set
        status = $2, document_title = $3, template_key = $4, issuer_name = $5,
        po_number = $6, po_date = $7, delivery_date = $8, currency = $9,
        supplier_name = $10, subtotal_amount = $11, tax_amount = $12,
        total_amount = $13, raw_result = $14, normalized_ocr_result = $15,
        normalized_result = $16, reconciliation_result = $17,
        reconciliation_version = $18, warnings = $19, model = $20,
        prompt_version = $21,
        error_message = null, completed_at = now(), updated_at = now()
       where id = $1`,
      [
        id,
        status,
        normalized.document_title,
        normalized.template_key,
        normalized.issuer_name,
        normalized.po_number,
        normalizeDateForDb(normalized.po_date),
        normalizeDateForDb(normalized.delivery_date),
        normalized.currency,
        normalized.supplier_name,
        normalized.subtotal_amount,
        normalized.tax_amount,
        normalized.total_amount,
        JSON.stringify(rawResult),
        JSON.stringify(normalizedOcr),
        JSON.stringify(normalized),
        JSON.stringify({
          version: reconciliation.version,
          usedAi: reconciliation.usedAi,
          lines: reconciliation.lines
        }),
        reconciliation.version,
        JSON.stringify(normalized.warnings),
        model,
        promptVersion
      ]
    );
    await client.query("commit");
    return status;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function getRawItems(rawResult: unknown): unknown[] {
  if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) return [];
  const items = (rawResult as Record<string, unknown>).items;
  return Array.isArray(items) ? items : [];
}

export async function failDocument(id: string, attempts: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const publicMessage = sanitizeClientErrorMessage(message)
    ?? "OCR thất bại. Vui lòng kiểm tra lại tài liệu hoặc thử quét lại.";
  const retry = attempts < config.maxAttempts;
  const delaySeconds = Math.min(120, 2 ** attempts * 5);
  await pool.query(
    `update ocr_documents set
      status = $2, error_message = $3,
      next_attempt_at = case when $2 = 'queued'
        then now() + ($4::text || ' seconds')::interval else next_attempt_at end,
      updated_at = now()
     where id = $1`,
    [id, retry ? "queued" : "failed", publicMessage.slice(0, 2000), delaySeconds]
  );
}

export async function retryDocument(id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update ocr_documents set status = 'queued', attempts = 0,
        error_message = null, next_attempt_at = now(), updated_at = now()
       where id = $1 and status in (
         'failed', 'needs_review', 'completed', 'preprocessing', 'ocr_running', 'validating'
       ) returning id`,
      [id]
    );
    if (result.rowCount) {
      await client.query(
        `update ocr_runs
         set status = 'failed',
             error_message = 'Retry requested',
             completed_at = now()
         where document_id = $1
           and status = 'running'`,
        [id]
      );
    }
    await client.query("commit");
    return Boolean(result.rowCount);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmDocument(id: string): Promise<boolean> {
  const result = await pool.query(
    `update ocr_documents set
      status = 'completed',
      warnings = '[]'::jsonb,
      error_message = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
     where id = $1 and status = 'needs_review'
     returning id`,
    [id]
  );
  return Boolean(result.rowCount);
}

export type DeleteDocumentResult =
  | { deleted: true; storedName: string }
  | { deleted: false; reason: "not_found" | "processing" };

export async function deleteDocument(id: string): Promise<DeleteDocumentResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const selected = await client.query<Pick<DocumentRow, "batch_id" | "stored_name" | "status">>(
      `select batch_id, stored_name, status
       from ocr_documents
       where id = $1
       for update`,
      [id]
    );
    const document = selected.rows[0];
    if (!document) {
      await client.query("rollback");
      return { deleted: false, reason: "not_found" };
    }
    if (["preprocessing", "ocr_running", "validating"].includes(document.status)) {
      await client.query("rollback");
      return { deleted: false, reason: "processing" };
    }

    await client.query("delete from ocr_documents where id = $1", [id]);
    await client.query(
      `delete from ocr_batches b
       where b.id = $1
         and not exists (select 1 from ocr_documents d where d.batch_id = b.id)`,
      [document.batch_id]
    );
    await client.query("commit");
    return { deleted: true, storedName: document.stored_name };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function createRun(documentId: string, model: string, promptVersion: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into ocr_runs(id, document_id, status, model, prompt_version)
     values ($1,$2,'running',$3,$4)`,
    [id, documentId, model, promptVersion]
  );
  return id;
}

export async function finishRun(
  id: string,
  status: "completed" | "failed",
  durationMs: number,
  interactionId?: string,
  errorMessage?: string
): Promise<void> {
  const publicErrorMessage = sanitizeClientErrorMessage(errorMessage ?? null);
  await pool.query(
    `update ocr_runs set status = $2, duration_ms = $3,
      gemini_interaction_id = $4, error_message = $5, completed_at = now()
     where id = $1`,
    [id, status, durationMs, interactionId ?? null, publicErrorMessage?.slice(0, 2000) ?? null]
  );
}

function normalizeDateForDb(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export function sanitizeDocumentRow<T extends { error_message: string | null }>(row: T): T {
  return {
    ...row,
    error_message: sanitizeClientErrorMessage(row.error_message)
  };
}

function sanitizeDocumentRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    error_message: typeof row.error_message === "string"
      ? sanitizeClientErrorMessage(row.error_message)
      : null
  };
}
