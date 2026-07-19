-- GreenCook iDempiere target schema (PostgreSQL)
-- Re-runnable: all objects are guarded and metadata is installed separately.

SET search_path = adempiere, public;

ALTER TABLE adempiere.kg_sp
  ADD COLUMN IF NOT EXISTS barcode varchar(32);

CREATE UNIQUE INDEX IF NOT EXISTS kg_sp_barcode_uq
  ON adempiere.kg_sp(ad_client_id, barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE TABLE IF NOT EXISTS adempiere.kg_order (
  kg_order_id numeric(10,0) PRIMARY KEY DEFAULT adempiere.nextidf('kg_order'),
  ad_client_id numeric(10,0) NOT NULL,
  ad_org_id numeric(10,0) NOT NULL DEFAULT 0,
  isactive char(1) NOT NULL DEFAULT 'Y' CHECK (isactive IN ('Y', 'N')),
  created timestamp without time zone NOT NULL DEFAULT now(),
  createdby numeric(10,0) NOT NULL,
  updated timestamp without time zone NOT NULL DEFAULT now(),
  updatedby numeric(10,0) NOT NULL,

  value varchar(60) NOT NULL,
  po_matched char(1) NOT NULL DEFAULT 'N' CHECK (po_matched IN ('Y', 'N')),
  po_source_table varchar(30),
  po_source_record_id numeric(10,0),
  po_source_value varchar(120),
  source_document_id varchar(36),
  source_order_key varchar(120),
  source_sha256 char(64),
  source_file_name varchar(255),
  document_title varchar(150),
  template_key varchar(80),
  document_type varchar(30),

  c_bpartner_id numeric(10,0),
  issuer_name varchar(255),
  store_code varchar(60),
  store_name varchar(255),
  po_date date,
  delivery_date date,
  delivery_address varchar(500),
  c_currency_id numeric(10,0) NOT NULL,

  subtotal_amount numeric(24,6),
  tax_amount numeric(24,6),
  total_amount numeric(24,6),
  docstatus char(2) NOT NULL DEFAULT 'CO',
  confirmed_at timestamp without time zone NOT NULL DEFAULT now(),
  description varchar(500),

  CONSTRAINT kg_order_source_uq UNIQUE(ad_client_id, source_document_id, source_order_key),
  CONSTRAINT kg_order_bpartner_fk FOREIGN KEY(c_bpartner_id)
    REFERENCES adempiere.c_bpartner(c_bpartner_id),
  CONSTRAINT kg_order_currency_fk FOREIGN KEY(c_currency_id)
    REFERENCES adempiere.c_currency(c_currency_id)
);

CREATE INDEX IF NOT EXISTS kg_order_value_idx
  ON adempiere.kg_order(ad_client_id, value);
CREATE INDEX IF NOT EXISTS kg_order_po_date_idx
  ON adempiere.kg_order(po_date);
CREATE UNIQUE INDEX IF NOT EXISTS kg_order_source_file_uq
  ON adempiere.kg_order(ad_client_id, source_sha256, source_order_key);

ALTER TABLE adempiere.kg_order ALTER COLUMN c_bpartner_id DROP NOT NULL;
ALTER TABLE adempiere.kg_order ALTER COLUMN source_document_id DROP NOT NULL;
ALTER TABLE adempiere.kg_order ALTER COLUMN source_order_key DROP NOT NULL;
ALTER TABLE adempiere.kg_order ALTER COLUMN source_sha256 DROP NOT NULL;
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS po_matched char(1) NOT NULL DEFAULT 'N';
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS po_source_table varchar(30);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS po_source_record_id numeric(10,0);
ALTER TABLE adempiere.kg_order ADD COLUMN IF NOT EXISTS po_source_value varchar(120);

CREATE INDEX IF NOT EXISTS kg_order_po_matched_idx
  ON adempiere.kg_order(ad_client_id, po_matched);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kg_order_po_matched_check'
      AND conrelid = 'adempiere.kg_order'::regclass
  ) THEN
    ALTER TABLE adempiere.kg_order
      ADD CONSTRAINT kg_order_po_matched_check CHECK (po_matched IN ('Y', 'N'));
  END IF;
END $$;

-- Standard iDempiere order integration. Parsed documents stay in SQLite until the user
-- confirms; only the reviewed result is written to C_Order/C_OrderLine.
ALTER TABLE adempiere.c_order
  ADD COLUMN IF NOT EXISTS kg_source_document_id varchar(36),
  ADD COLUMN IF NOT EXISTS kg_source_file_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_source_payload text,
  ADD COLUMN IF NOT EXISTS kg_source_sha256 varchar(64),
  ADD COLUMN IF NOT EXISTS kg_document_title varchar(255),
  ADD COLUMN IF NOT EXISTS kg_document_type varchar(40),
  ADD COLUMN IF NOT EXISTS kg_currency_text varchar(20),
  ADD COLUMN IF NOT EXISTS kg_template_key varchar(100),
  ADD COLUMN IF NOT EXISTS kg_issuer_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_issuer_branch varchar(255),
  ADD COLUMN IF NOT EXISTS kg_supplier_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_buyer_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_document_number varchar(120),
  ADD COLUMN IF NOT EXISTS kg_reference_number varchar(120),
  ADD COLUMN IF NOT EXISTS kg_buyer_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_supplier_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_buyer_tax_id varchar(40),
  ADD COLUMN IF NOT EXISTS kg_supplier_tax_id varchar(40),
  ADD COLUMN IF NOT EXISTS kg_order_contact varchar(255),
  ADD COLUMN IF NOT EXISTS kg_contact_phone varchar(80),
  ADD COLUMN IF NOT EXISTS kg_contact_email varchar(255),
  ADD COLUMN IF NOT EXISTS kg_delivery_address varchar(1000),
  ADD COLUMN IF NOT EXISTS kg_bill_to_address varchar(1000),
  ADD COLUMN IF NOT EXISTS kg_ship_to_address varchar(1000),
  ADD COLUMN IF NOT EXISTS kg_store_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_store_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_warehouse_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_warehouse_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_department varchar(255),
  ADD COLUMN IF NOT EXISTS kg_payment_terms varchar(255),
  ADD COLUMN IF NOT EXISTS kg_payment_method varchar(120),
  ADD COLUMN IF NOT EXISTS kg_delivery_method varchar(120),
  ADD COLUMN IF NOT EXISTS kg_delivery_window varchar(255),
  ADD COLUMN IF NOT EXISTS kg_price_list_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_price_includes_tax char(1),
  ADD COLUMN IF NOT EXISTS kg_print_date varchar(40),
  ADD COLUMN IF NOT EXISTS kg_print_time varchar(40),
  ADD COLUMN IF NOT EXISTS kg_form_type varchar(80),
  ADD COLUMN IF NOT EXISTS kg_approved_by varchar(255),
  ADD COLUMN IF NOT EXISTS kg_industry_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_contract_number varchar(255),
  ADD COLUMN IF NOT EXISTS kg_subtotal_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_discount_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_tax_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_total_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS kg_warnings text,
  ADD COLUMN IF NOT EXISTS kg_extra_fields text;

ALTER TABLE adempiere.c_orderline
  ADD COLUMN IF NOT EXISTS kg_sp_id numeric(10,0),
  ADD COLUMN IF NOT EXISTS kg_source_line_id varchar(36),
  ADD COLUMN IF NOT EXISTS kg_line_source_payload text,
  ADD COLUMN IF NOT EXISTS kg_product_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_vendor_product_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_barcode varchar(40),
  ADD COLUMN IF NOT EXISTS kg_product_name varchar(500),
  ADD COLUMN IF NOT EXISTS kg_model varchar(150),
  ADD COLUMN IF NOT EXISTS kg_article_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_sku varchar(120),
  ADD COLUMN IF NOT EXISTS kg_ou_type varchar(80),
  ADD COLUMN IF NOT EXISTS kg_free_quantity numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_units_per_order_unit numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_unit_name varchar(80),
  ADD COLUMN IF NOT EXISTS kg_list_price numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_unit_price numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_discount_percent numeric(12,6),
  ADD COLUMN IF NOT EXISTS kg_discount_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_vat_rate numeric(12,6),
  ADD COLUMN IF NOT EXISTS kg_tax_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_gross_amount numeric(24,6),
  ADD COLUMN IF NOT EXISTS kg_source_page integer,
  ADD COLUMN IF NOT EXISTS kg_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS kg_warehouse_code varchar(120),
  ADD COLUMN IF NOT EXISTS kg_warehouse_name varchar(255),
  ADD COLUMN IF NOT EXISTS kg_extra_fields text;

CREATE INDEX IF NOT EXISTS c_order_kg_source_document_idx
  ON adempiere.c_order(ad_client_id, kg_source_document_id);

CREATE UNIQUE INDEX IF NOT EXISTS c_order_kg_source_po_uq
  ON adempiere.c_order(ad_client_id, kg_source_document_id,
    regexp_replace(upper(btrim(poreference)), '[^A-Z0-9]', '', 'g'))
  WHERE kg_source_document_id IS NOT NULL AND poreference IS NOT NULL
    AND btrim(poreference) <> '';

CREATE INDEX IF NOT EXISTS c_orderline_kg_sp_idx
  ON adempiere.c_orderline(kg_sp_id);
CREATE INDEX IF NOT EXISTS c_orderline_kg_barcode_idx
  ON adempiere.c_orderline(ad_client_id, kg_barcode);
CREATE INDEX IF NOT EXISTS c_orderline_kg_product_code_idx
  ON adempiere.c_orderline(ad_client_id, kg_product_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'c_orderline_kg_sp_fk'
      AND conrelid = 'adempiere.c_orderline'::regclass
  ) THEN
    ALTER TABLE adempiere.c_orderline
      ADD CONSTRAINT c_orderline_kg_sp_fk FOREIGN KEY(kg_sp_id)
      REFERENCES adempiere.kg_sp(kg_sp_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS adempiere.kg_detail (
  kg_detail_id numeric(10,0) PRIMARY KEY DEFAULT adempiere.nextidf('kg_detail'),
  ad_client_id numeric(10,0) NOT NULL,
  ad_org_id numeric(10,0) NOT NULL DEFAULT 0,
  isactive char(1) NOT NULL DEFAULT 'Y' CHECK (isactive IN ('Y', 'N')),
  created timestamp without time zone NOT NULL DEFAULT now(),
  createdby numeric(10,0) NOT NULL,
  updated timestamp without time zone NOT NULL DEFAULT now(),
  updatedby numeric(10,0) NOT NULL,

  kg_order_id numeric(10,0) NOT NULL,
  line integer NOT NULL,
  kg_sp_id numeric(10,0),
  product_code varchar(60),
  vendor_product_code varchar(60),
  barcode varchar(32),
  product_name varchar(255),
  model varchar(80),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  units_per_order_unit numeric(18,6),
  c_uom_id numeric(10,0),
  unit_name varchar(30),
  unit_price numeric(24,6),
  vat_rate numeric(9,6),
  amount numeric(24,6),
  source_page integer,
  confidence numeric(5,4),
  description varchar(500),

  CONSTRAINT kg_detail_order_line_uq UNIQUE(kg_order_id, line),
  CONSTRAINT kg_detail_order_fk FOREIGN KEY(kg_order_id)
    REFERENCES adempiere.kg_order(kg_order_id),
  CONSTRAINT kg_detail_product_fk FOREIGN KEY(kg_sp_id)
    REFERENCES adempiere.kg_sp(kg_sp_id),
  CONSTRAINT kg_detail_uom_fk FOREIGN KEY(c_uom_id)
    REFERENCES adempiere.c_uom(c_uom_id)
);

CREATE INDEX IF NOT EXISTS kg_detail_product_idx
  ON adempiere.kg_detail(kg_sp_id);
CREATE INDEX IF NOT EXISTS kg_detail_barcode_idx
  ON adempiere.kg_detail(barcode);

ALTER TABLE adempiere.kg_detail ALTER COLUMN kg_sp_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kg_detail_order_fk'
      AND conrelid = 'adempiere.kg_detail'::regclass
      AND confdeltype <> 'c'
  ) THEN
    ALTER TABLE adempiere.kg_detail DROP CONSTRAINT kg_detail_order_fk;
    ALTER TABLE adempiere.kg_detail
      ADD CONSTRAINT kg_detail_order_fk FOREIGN KEY(kg_order_id)
      REFERENCES adempiere.kg_order(kg_order_id) ON DELETE CASCADE;
  END IF;
END $$;
