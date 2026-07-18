import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { config } from "../src/server/config.js";
import { stagingDatabase } from "../src/server/db/staging.js";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("Thiếu DATABASE_URL nguồn để chuyển dữ liệu OCR cũ");
if (new URL(sourceUrl).pathname === new URL(config.targetDatabaseUrl).pathname) {
  throw new Error("Database nguồn và database iDempiere đích không được trùng nhau");
}

const source = new pg.Pool({
  connectionString: sourceUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  application_name: `GreenCookOCR:staging-import:${process.pid}`,
  max: 1
});

try {
  const [batches, documents, items, runs] = await Promise.all([
    source.query("SELECT * FROM ocr_batches ORDER BY created_at"),
    source.query("SELECT * FROM ocr_documents ORDER BY created_at, batch_position"),
    source.query("SELECT * FROM ocr_items ORDER BY document_id, line_no"),
    source.query("SELECT * FROM ocr_runs ORDER BY created_at")
  ]);

  const imported = stagingDatabase.transaction(() => {
    const insertBatch = stagingDatabase.prepare(`
      INSERT OR IGNORE INTO ocr_batches(id, file_count, created_at) VALUES (?, ?, ?)
    `);
    const insertDocument = stagingDatabase.prepare(`
      INSERT OR IGNORE INTO ocr_documents(
        id, batch_id, batch_position, original_name, stored_name, storage_path,
        mime_type, size_bytes, sha256, status, document_title, template_key,
        issuer_name, issuer_branch, po_number, po_date, delivery_date, currency,
        supplier_name, buyer_name, delivery_address, subtotal_amount, tax_amount,
        total_amount, raw_result, normalized_ocr_result, normalized_result,
        reconciliation_result, reconciliation_version, warnings, error_message,
        attempts, next_attempt_at, gemini_file_name, model, prompt_version,
        started_at, completed_at, created_at, updated_at
      ) VALUES (
        @id, @batch_id, @batch_position, @original_name, @stored_name, @storage_path,
        @mime_type, @size_bytes, @sha256, @status, @document_title, @template_key,
        @issuer_name, @issuer_branch, @po_number, @po_date, @delivery_date, @currency,
        @supplier_name, @buyer_name, @delivery_address, @subtotal_amount, @tax_amount,
        @total_amount, @raw_result, @normalized_ocr_result, @normalized_result,
        @reconciliation_result, @reconciliation_version, @warnings, @error_message,
        @attempts, @next_attempt_at, @gemini_file_name, @model, @prompt_version,
        @started_at, @completed_at, @created_at, @updated_at
      )
    `);
    const insertItem = stagingDatabase.prepare(`
      INSERT OR IGNORE INTO ocr_items(
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
    const insertRun = stagingDatabase.prepare(`
      INSERT OR IGNORE INTO ocr_runs(
        id, document_id, status, model, prompt_version, gemini_interaction_id,
        duration_ms, error_message, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let batchCount = 0;
    let documentCount = 0;
    let itemCount = 0;
    let runCount = 0;
    for (const row of batches.rows) {
      batchCount += insertBatch.run(row.id, row.file_count, timestamp(row.created_at)).changes;
    }
    for (const row of documents.rows) {
      const storedName = String(row.stored_name);
      documentCount += insertDocument.run({
        id: row.id,
        batch_id: row.batch_id,
        batch_position: row.batch_position,
        original_name: row.original_name,
        stored_name: storedName,
        storage_path: localStoragePath(storedName, row.storage_path),
        mime_type: row.mime_type,
        size_bytes: Number(row.size_bytes),
        sha256: row.sha256,
        status: importedStatus(row.status),
        document_title: row.document_title ?? null,
        template_key: row.template_key ?? null,
        issuer_name: row.issuer_name ?? null,
        issuer_branch: row.issuer_branch ?? null,
        po_number: row.po_number ?? null,
        po_date: date(row.po_date),
        delivery_date: date(row.delivery_date),
        currency: row.currency ?? null,
        supplier_name: row.supplier_name ?? null,
        buyer_name: row.buyer_name ?? null,
        delivery_address: row.delivery_address ?? null,
        subtotal_amount: decimal(row.subtotal_amount),
        tax_amount: decimal(row.tax_amount),
        total_amount: decimal(row.total_amount),
        raw_result: json(row.raw_result),
        normalized_ocr_result: json(row.normalized_ocr_result),
        normalized_result: json(row.normalized_result),
        reconciliation_result: json(row.reconciliation_result),
        reconciliation_version: row.reconciliation_version ?? null,
        warnings: json(row.warnings, "[]"),
        error_message: row.error_message ?? null,
        attempts: Number(row.attempts ?? 0),
        next_attempt_at: timestamp(row.next_attempt_at),
        gemini_file_name: row.gemini_file_name ?? null,
        model: row.model ?? null,
        prompt_version: row.prompt_version ?? null,
        started_at: timestamp(row.started_at),
        completed_at: timestamp(row.completed_at),
        created_at: timestamp(row.created_at),
        updated_at: timestamp(row.updated_at)
      }).changes;
    }
    for (const row of items.rows) {
      itemCount += insertItem.run({
        id: row.id,
        document_id: row.document_id,
        line_no: row.line_no,
        po_number: row.po_number ?? null,
        po_date: date(row.po_date),
        store_code: row.store_code ?? null,
        store_name: row.store_name ?? null,
        delivery_address: row.delivery_address ?? null,
        product_code: row.product_code ?? null,
        vendor_product_code: row.vendor_product_code ?? null,
        barcode: row.barcode ?? null,
        product_name: row.product_name ?? null,
        model: row.model ?? null,
        quantity: decimal(row.quantity),
        units_per_order_unit: decimal(row.units_per_order_unit),
        unit: row.unit ?? null,
        unit_price: decimal(row.unit_price),
        vat_rate: decimal(row.vat_rate),
        amount: decimal(row.amount),
        source_page: row.source_page ?? null,
        confidence: Number(row.confidence ?? 0),
        raw_row: json(row.raw_row, "{}"),
        match_method: row.match_method ?? "none",
        match_confidence: row.match_confidence === null ? null : Number(row.match_confidence),
        field_sources: json(row.field_sources, "{}"),
        reconciliation_warnings: json(row.reconciliation_warnings, "[]"),
        reconciled_by_ai: row.reconciled_by_ai ? 1 : 0
      }).changes;
    }
    for (const row of runs.rows) {
      runCount += insertRun.run(
        row.id, row.document_id, row.status, row.model, row.prompt_version,
        row.gemini_interaction_id ?? null, row.duration_ms ?? null,
        row.error_message ?? null, timestamp(row.created_at ?? row.started_at),
        timestamp(row.completed_at)
      ).changes;
    }
    return { batchCount, documentCount, itemCount, runCount };
  })();

  console.log(JSON.stringify({
    source: {
      batches: batches.rowCount,
      documents: documents.rowCount,
      items: items.rowCount,
      runs: runs.rowCount
    },
    inserted: imported
  }, null, 2));
} finally {
  await source.end();
  stagingDatabase.close();
}

function importedStatus(status: unknown): string {
  if (status === "failed") return "failed";
  if (["queued", "preprocessing", "ocr_running", "validating"].includes(String(status))) return "queued";
  return "needs_review";
}

function localStoragePath(storedName: string, previousPath: unknown): string {
  const local = path.join(config.uploadDir, path.basename(storedName));
  if (fs.existsSync(local)) return local;
  const previous = typeof previousPath === "string" ? previousPath : "";
  return fs.existsSync(previous) ? previous : local;
}

function timestamp(value: unknown): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function date(value: unknown): string | null {
  if (!value) return null;
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function decimal(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function json(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined) return fallback;
  return typeof value === "string" ? value : JSON.stringify(value);
}
