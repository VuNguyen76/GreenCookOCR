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
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE ocr_documents DROP CONSTRAINT IF EXISTS ocr_documents_sha256_key;
    CREATE INDEX IF NOT EXISTS idx_ocr_documents_sha256 ON ocr_documents(sha256);
    CREATE INDEX IF NOT EXISTS idx_ocr_documents_queue
      ON ocr_documents(status, next_attempt_at, created_at, batch_position);

    CREATE TABLE IF NOT EXISTS ocr_items (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
      line_no integer NOT NULL,
      po_number text,
      po_date date,
      store_code text,
      store_name text,
      delivery_address text,
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

    CREATE TABLE IF NOT EXISTS product_references (
      id uuid PRIMARY KEY,
      reference_key text NOT NULL UNIQUE,
      barcode varchar(64),
      product_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
      vendor_product_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
      canonical_name text NOT NULL,
      name_aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
      units text[] NOT NULL DEFAULT ARRAY[]::text[],
      template_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
      issuer_names text[] NOT NULL DEFAULT ARRAY[]::text[],
      source_count integer NOT NULL DEFAULT 1 CHECK (source_count > 0),
      confidence numeric(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      verified boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_product_references_barcode
      ON product_references(barcode) WHERE barcode IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_references_product_codes
      ON product_references USING gin(product_codes);
    CREATE INDEX IF NOT EXISTS idx_product_references_vendor_codes
      ON product_references USING gin(vendor_product_codes);

    CREATE TABLE IF NOT EXISTS product_reference_evidence (
      id uuid PRIMARY KEY,
      reference_id uuid NOT NULL REFERENCES product_references(id) ON DELETE CASCADE,
      document_id uuid NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
      line_no integer NOT NULL,
      source_kind text NOT NULL,
      observed_item jsonb NOT NULL,
      confidence numeric(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (document_id, line_no)
    );

    CREATE INDEX IF NOT EXISTS idx_product_reference_evidence_reference
      ON product_reference_evidence(reference_id);

    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS subtotal_amount numeric(24, 6);
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS tax_amount numeric(24, 6);
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS total_amount numeric(24, 6);
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS normalized_ocr_result jsonb;
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS reconciliation_result jsonb;
    ALTER TABLE ocr_documents ADD COLUMN IF NOT EXISTS reconciliation_version text;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS units_per_order_unit numeric(24, 6);
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS po_number text;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS po_date date;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS store_code text;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS store_name text;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS delivery_address text;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS matched_reference_id uuid REFERENCES product_references(id);
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS match_method text;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS match_confidence numeric(5, 4);
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS reconciliation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE ocr_items ADD COLUMN IF NOT EXISTS reconciled_by_ai boolean NOT NULL DEFAULT false;

    UPDATE product_reference_evidence e
    SET observed_item = e.observed_item || '{"product_code":null,"vendor_product_code":null}'::jsonb
    FROM ocr_documents d
    WHERE d.id = e.document_id
      AND d.template_key IN ('po_bigc_go_purchase_note', 'po_wincommerce_purchase_order')
      AND (
        e.observed_item->>'product_code' IS NOT NULL
        OR e.observed_item->>'vendor_product_code' IS NOT NULL
      );
  `);
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  migrate()
    .then(() => console.log("Database migration completed"))
    .finally(() => pool.end());
}
