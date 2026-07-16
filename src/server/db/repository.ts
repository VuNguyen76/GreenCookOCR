import { randomUUID } from "node:crypto";
import type { OcrDocument, DocumentRow } from "../../shared/ocr.js";
import { config } from "../config.js";
import { pool } from "./pool.js";

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

export async function findDocumentByHash(sha256: string): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>(
    "select * from ocr_documents where sha256 = $1",
    [sha256]
  );
  return result.rows[0] ?? null;
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
  return result.rows;
}

export async function getDocument(id: string): Promise<Record<string, unknown> | null> {
  const document = await pool.query("select * from ocr_documents where id = $1", [id]);
  if (!document.rows[0]) return null;
  const items = await pool.query(
    "select * from ocr_items where document_id = $1 order by line_no",
    [id]
  );
  return { ...document.rows[0], items: items.rows };
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
  normalized: OcrDocument,
  model: string,
  promptVersion: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from ocr_items where document_id = $1", [id]);
    for (const item of normalized.items) {
      await client.query(
        `insert into ocr_items(
          id, document_id, line_no, product_code, vendor_product_code, barcode,
          product_name, model, quantity, units_per_order_unit, unit, unit_price,
          vat_rate, amount, source_page, confidence, raw_row
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          randomUUID(), id, item.line_no, item.product_code, item.vendor_product_code,
          item.barcode, item.product_name, item.model, item.quantity,
          item.units_per_order_unit, item.unit, item.unit_price, item.vat_rate,
          item.amount, item.source_page, item.confidence, JSON.stringify(item)
        ]
      );
    }
    await client.query(
      `update ocr_documents set
        status = $2, document_title = $3, template_key = $4, issuer_name = $5,
        po_number = $6, po_date = $7, delivery_date = $8, currency = $9,
        supplier_name = $10, subtotal_amount = $11, tax_amount = $12,
        total_amount = $13, raw_result = $14, normalized_result = $15,
        warnings = $16, model = $17, prompt_version = $18,
        error_message = null, completed_at = now(), updated_at = now()
       where id = $1`,
      [
        id,
        normalized.confidence < 0.8 || normalized.template_key === "unknown"
          ? "needs_review"
          : "completed",
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
        JSON.stringify(normalized),
        JSON.stringify(normalized.warnings),
        model,
        promptVersion
      ]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function failDocument(id: string, attempts: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const retry = attempts < config.maxAttempts;
  const delaySeconds = Math.min(120, 2 ** attempts * 5);
  await pool.query(
    `update ocr_documents set
      status = $2, error_message = $3,
      next_attempt_at = case when $2 = 'queued'
        then now() + ($4::text || ' seconds')::interval else next_attempt_at end,
      updated_at = now()
     where id = $1`,
    [id, retry ? "queued" : "failed", message.slice(0, 2000), delaySeconds]
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
  await pool.query(
    `update ocr_runs set status = $2, duration_ms = $3,
      gemini_interaction_id = $4, error_message = $5, completed_at = now()
     where id = $1`,
    [id, status, durationMs, interactionId ?? null, errorMessage?.slice(0, 2000) ?? null]
  );
}

function normalizeDateForDb(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}
