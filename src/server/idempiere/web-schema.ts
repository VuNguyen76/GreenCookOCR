import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";

const WEB_ORDER_SCHEMA_SQL = `
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

  CREATE INDEX IF NOT EXISTS c_order_kg_source_sha256_idx
    ON adempiere.c_order(ad_client_id, kg_source_sha256);
  CREATE INDEX IF NOT EXISTS c_orderline_kg_barcode_idx
    ON adempiere.c_orderline(ad_client_id, kg_barcode);
  CREATE INDEX IF NOT EXISTS c_orderline_kg_product_code_idx
    ON adempiere.c_orderline(ad_client_id, kg_product_code);
`;

export async function ensureWebOrderSchema(client?: PoolClient): Promise<void> {
  await (client ?? pool).query(WEB_ORDER_SCHEMA_SQL);
}
