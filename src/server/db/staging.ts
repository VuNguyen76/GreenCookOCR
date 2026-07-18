import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type StagingDatabase = Database.Database;

export function openStagingDatabase(filename = config.stagingDatabasePath): StagingDatabase {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  migrateStagingDatabase(database);
  return database;
}

export function migrateStagingDatabase(database: StagingDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS ocr_batches (
      id TEXT PRIMARY KEY,
      file_count INTEGER NOT NULL CHECK (file_count > 0),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS ocr_documents (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES ocr_batches(id) ON DELETE CASCADE,
      batch_position INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      document_title TEXT,
      template_key TEXT,
      issuer_name TEXT,
      issuer_branch TEXT,
      po_number TEXT,
      po_date TEXT,
      delivery_date TEXT,
      currency TEXT,
      supplier_name TEXT,
      buyer_name TEXT,
      delivery_address TEXT,
      subtotal_amount TEXT,
      tax_amount TEXT,
      total_amount TEXT,
      raw_result TEXT,
      normalized_ocr_result TEXT,
      normalized_result TEXT,
      reconciliation_result TEXT,
      reconciliation_version TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      gemini_file_name TEXT,
      model TEXT,
      prompt_version TEXT,
      target_bpartner_id TEXT,
      target_bpartner_name TEXT,
      published_order_ids TEXT NOT NULL DEFAULT '[]',
      confirmed_at TEXT,
      published_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ocr_documents_queue
      ON ocr_documents(status, next_attempt_at, created_at, batch_position);
    CREATE INDEX IF NOT EXISTS idx_ocr_documents_sha256 ON ocr_documents(sha256);

    CREATE TABLE IF NOT EXISTS ocr_items (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL,
      po_number TEXT,
      po_date TEXT,
      store_code TEXT,
      store_name TEXT,
      delivery_address TEXT,
      product_code TEXT,
      vendor_product_code TEXT,
      barcode TEXT,
      product_name TEXT,
      model TEXT,
      quantity TEXT,
      units_per_order_unit TEXT,
      unit TEXT,
      unit_price TEXT,
      vat_rate TEXT,
      amount TEXT,
      source_page INTEGER,
      confidence REAL NOT NULL,
      raw_row TEXT NOT NULL,
      matched_kg_sp_id TEXT,
      matched_product_value TEXT,
      matched_product_name TEXT,
      match_method TEXT NOT NULL DEFAULT 'none',
      match_confidence REAL,
      field_sources TEXT NOT NULL DEFAULT '{}',
      reconciliation_warnings TEXT NOT NULL DEFAULT '[]',
      reconciled_by_ai INTEGER NOT NULL DEFAULT 0,
      UNIQUE(document_id, line_no)
    );

    CREATE INDEX IF NOT EXISTS idx_ocr_items_document ON ocr_items(document_id, line_no);
    CREATE INDEX IF NOT EXISTS idx_ocr_items_barcode ON ocr_items(barcode);

    CREATE TABLE IF NOT EXISTS ocr_runs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      gemini_interaction_id TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS publish_outbox (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE REFERENCES ocr_documents(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_publish_outbox_queue
      ON publish_outbox(status, next_attempt_at, created_at);

    INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
  `);
}

export const stagingDatabase = openStagingDatabase();
