import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool } from "../db/pool.js";

export interface PoReference {
  sourceTable: "C_Order";
  sourceRecordId: string;
  sourceValue: string;
  documentNo: string;
  documentStatus: string;
  partnerName: string | null;
  sourceDocumentId: string | null;
}

export interface PoReferenceCheck {
  poNumber: string;
  matched: boolean;
  reference: PoReference | null;
}

interface PoReferenceRow {
  source_table: "C_Order";
  source_record_id: string;
  source_value: string;
  document_no: string;
  document_status: string;
  partner_name: string | null;
  source_document_id: string | null;
}

export async function findPoReference(
  poNumber: string,
  client: PoolClient
): Promise<PoReference | null> {
  const normalized = normalizePoNumber(poNumber);
  if (!normalized) return null;

  const result = await client.query<PoReferenceRow>(`
    SELECT 'C_Order'::text AS source_table,
           order_header.c_order_id::text AS source_record_id,
           order_header.poreference AS source_value,
           order_header.documentno AS document_no,
           order_header.docstatus AS document_status,
           partner.name AS partner_name,
           order_header.kg_source_document_id AS source_document_id
    FROM adempiere.c_order order_header
    LEFT JOIN adempiere.c_bpartner partner
      ON partner.c_bpartner_id = order_header.c_bpartner_id
    WHERE order_header.ad_client_id = $1
      AND order_header.poreference IS NOT NULL
      AND regexp_replace(upper(order_header.poreference), '[^A-Z0-9]', '', 'g') = $2
    ORDER BY order_header.created, order_header.c_order_id
    LIMIT 1
  `, [config.targetAdClientId, normalized]);

  const row = result.rows[0];
  return row ? {
    sourceTable: row.source_table,
    sourceRecordId: row.source_record_id,
    sourceValue: row.source_value,
    documentNo: row.document_no,
    documentStatus: row.document_status,
    partnerName: row.partner_name,
    sourceDocumentId: row.source_document_id
  } : null;
}

export async function checkPoReferences(poNumbers: string[]): Promise<PoReferenceCheck[]> {
  const unique = [...new Map(poNumbers
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => [normalizePoNumber(value), value])).values()];
  const client = await pool.connect();
  try {
    const checks: PoReferenceCheck[] = [];
    for (const poNumber of unique) {
      const reference = await findPoReference(poNumber, client);
      checks.push({ poNumber, matched: Boolean(reference), reference });
    }
    return checks;
  } finally {
    client.release();
  }
}

export function normalizePoNumber(value: string): string {
  return value.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
