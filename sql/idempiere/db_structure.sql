-- GreenCookOCR iDempiere target schema (PostgreSQL)
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
  source_document_id varchar(36) NOT NULL,
  source_order_key varchar(120) NOT NULL,
  source_sha256 char(64) NOT NULL,
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
  kg_sp_id numeric(10,0) NOT NULL,
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
