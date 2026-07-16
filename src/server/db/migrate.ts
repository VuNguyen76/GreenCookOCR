import { pool } from "./pool.js";

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ocr_batches (
      id uuid PRIMARY KEY,
      file_count integer NOT NULL CHECK (file_count > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ocr_documents (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES ocr_batches(id) ON DELETE CASCADE,
      batch_position integer NOT NULL,
      original_name text NOT NULL,
      stored_name text NOT NULL,
      storage_path text NOT NULL,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL,
      sha256 char(64) NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      document_title text,
      template_key text,
      issuer_name text,
      po_number text,
      po_date date,
      delivery_date date,
      currency text,
      supplier_name text,
      subtotal_amount numeric(24, 6),
      tax_amount numeric(24, 6),
      total_amount numeric(24, 6),
      raw_result jsonb,
      normalized_result jsonb,
      warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
      error_message text,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      gemini_file_name text,
      model text,
      prompt_version text,
      started_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (sha256)
    );

    CREATE INDEX IF NOT EXISTS idx_ocr_documents_queue
      ON ocr_documents(status, next_attempt_at, created_at, batch_position);

    CREATE TABLE IF NOT EXISTS ocr_items (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
      line_no integer NOT NULL,
      product_code text,
      vendor_product_code text,
      barcode varchar(64),
      product_name text,
      model text,
      quantity numeric(24, 6),
      units_per_order_unit numeric(24, 6),
      unit text,
      unit_price numeric(24, 6),
      vat_rate numeric(12, 6),
      amount numeric(24, 6),
      source_page integer,
      confidence numeric(5, 4) NOT NULL,
      raw_row jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (document_id, line_no)
    );

    CREATE INDEX IF NOT EXISTS idx_ocr_items_document ON ocr_items(document_id);
    CREATE INDEX IF NOT EXISTS idx_ocr_items_barcode ON ocr_items(barcode);
    CREATE INDEX IF NOT EXISTS idx_ocr_items_product_code ON ocr_items(product_code);

    CREATE TABLE IF NOT EXISTS ocr_runs (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
      status text NOT NULL,
      model text NOT NULL,
      prompt_version text NOT NULL,
      gemini_interaction_id text,
      duration_ms integer,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );

    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS subtotal_amount numeric(24, 6);
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS tax_amount numeric(24, 6);
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS total_amount numeric(24, 6);
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS units_per_order_unit numeric(24, 6);
  `);
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("Database migration completed"))
    .finally(() => pool.end());
}
