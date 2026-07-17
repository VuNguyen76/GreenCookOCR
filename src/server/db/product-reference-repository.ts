import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { OcrDocument, OcrItem } from "../../shared/ocr.js";
import type {
  ProductReference,
  ReconciliationLineAudit,
  ScopedProductIdentifier
} from "../services/reconciliation.js";
import { productReferenceKey } from "../services/reconciliation.js";
import { pool } from "./pool.js";

interface ProductReferenceRow {
  id: string;
  reference_key: string;
  barcode: string | null;
  product_codes: string[];
  vendor_product_codes: string[];
  canonical_name: string;
  name_aliases: string[];
  units: string[];
  template_keys: string[];
  issuer_names: string[];
  scoped_identifiers: unknown;
  source_count: number;
  confidence: string;
  verified: boolean;
}

interface HistoricalItemRow extends OcrItem {
  document_id: string;
  template_key: OcrDocument["template_key"];
  issuer_name: string | null;
  raw_row: unknown;
}

interface ReferenceGroup {
  id: string;
  referenceKey: string;
  barcode: string | null;
  productCodes: Set<string>;
  vendorProductCodes: Set<string>;
  names: Map<string, { count: number; confidence: number }>;
  units: Set<string>;
  templateKeys: Set<string>;
  issuerNames: Set<string>;
  rows: HistoricalItemRow[];
  confidence: number;
}

export async function loadProductReferences(limit = 5000): Promise<ProductReference[]> {
  const result = await pool.query<ProductReferenceRow>(
    `select r.id, r.reference_key, r.barcode, r.product_codes, r.vendor_product_codes,
            r.canonical_name, r.name_aliases, r.units, r.template_keys, r.issuer_names,
            r.source_count, r.confidence, r.verified,
            coalesce((
              select jsonb_agg(distinct jsonb_build_object(
                'templateKey', d.template_key,
                'issuerName', d.issuer_name,
                'productCode', e.observed_item->>'product_code',
                'vendorProductCode', e.observed_item->>'vendor_product_code',
                'unit', e.observed_item->>'unit'
              ))
              from product_reference_evidence e
              join ocr_documents d on d.id = e.document_id
              where e.reference_id = r.id
            ), '[]'::jsonb) as scoped_identifiers
     from product_references r
     where r.active = true
     order by r.verified desc, r.source_count desc, r.confidence desc
     limit $1`,
    [limit]
  );
  return result.rows.map(toProductReference);
}

export async function bootstrapProductReferencesFromHistory(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const count = await client.query<{ count: string }>("select count(*)::text as count from product_references");
    if (Number(count.rows[0]?.count ?? 0) > 0) {
      await client.query("commit");
      return 0;
    }

    const history = await client.query<HistoricalItemRow>(
      `select i.line_no, i.product_code, i.vendor_product_code, i.barcode,
              i.product_name, i.model, i.quantity, i.units_per_order_unit,
              i.unit, i.unit_price, i.vat_rate, i.amount, i.source_page,
              i.confidence, i.raw_row, d.id as document_id,
              d.template_key, d.issuer_name
       from ocr_items i
       join ocr_documents d on d.id = i.document_id
       where d.status = 'completed'
         and i.confidence >= 0.9
         and i.product_name is not null
       order by d.completed_at, i.line_no`
    );

    const groups = groupHistoricalItems(history.rows);
    const referenceIds = new Map<string, string>();
    for (const group of groups.values()) {
      const canonicalName = chooseCanonicalName(group.names);
      await insertReference(client, group, canonicalName);
      referenceIds.set(group.referenceKey, group.id);
    }

    const evidence = history.rows.flatMap((row) => {
      const key = productReferenceKey(row, row.template_key);
      const referenceId = key ? referenceIds.get(key) : undefined;
      if (!referenceId) return [];
      return [{
        id: randomUUID(),
        reference_id: referenceId,
        document_id: row.document_id,
        line_no: row.line_no,
        source_kind: "historical_completed",
        observed_item: row.raw_row ?? row,
        confidence: Number(row.confidence)
      }];
    });
    if (evidence.length > 0) await insertEvidenceBatch(client, evidence);

    await client.query("commit");
    return groups.size;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function learnProductReferences(
  documentId: string,
  document: OcrDocument,
  audits: ReconciliationLineAudit[]
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const lines = document.items.map((item) => item.line_no);
    const existing = lines.length === 0
      ? { rows: [] as Array<{ line_no: number }> }
      : await client.query<{ line_no: number }>(
          `select line_no from product_reference_evidence
           where document_id = $1 and line_no = any($2::int[])`,
          [documentId, lines]
        );
    const learnedLines = new Set(existing.rows.map((row) => row.line_no));
    const auditByLine = new Map(audits.map((audit) => [audit.lineNo, audit]));
    let learned = 0;

    for (const item of document.items) {
      if (learnedLines.has(item.line_no) || !item.product_name) continue;
      const audit = auditByLine.get(item.line_no);
      if (!isEligibleEvidence(item, audit)) continue;
      const key = productReferenceKey(item, document.template_key);
      if (!key) continue;

      const referenceId = await upsertReference(client, key, document, item, audit);
      await client.query(
        `insert into product_reference_evidence(
           id, reference_id, document_id, line_no, source_kind, observed_item, confidence
         ) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (document_id, line_no) do nothing`,
        [
          randomUUID(),
          referenceId,
          documentId,
          item.line_no,
          audit?.matchedReferenceId ? "reference_match" : "ocr_high_confidence",
          JSON.stringify(item),
          evidenceConfidence(item, audit)
        ]
      );
      learned += 1;
    }

    await client.query("commit");
    return learned;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function groupHistoricalItems(rows: HistoricalItemRow[]): Map<string, ReferenceGroup> {
  const groups = new Map<string, ReferenceGroup>();
  for (const row of rows) {
    const key = productReferenceKey(row, row.template_key);
    if (!key || !row.product_name) continue;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: randomUUID(),
        referenceKey: key,
        barcode: row.barcode,
        productCodes: new Set(),
        vendorProductCodes: new Set(),
        names: new Map(),
        units: new Set(),
        templateKeys: new Set(),
        issuerNames: new Set(),
        rows: [],
        confidence: 0
      };
      groups.set(key, group);
    }
    addIfPresent(group.productCodes, row.product_code);
    addIfPresent(group.vendorProductCodes, row.vendor_product_code);
    addIfPresent(group.units, row.unit?.toUpperCase() ?? null);
    addIfPresent(group.templateKeys, row.template_key);
    addIfPresent(group.issuerNames, row.issuer_name);
    const currentName = group.names.get(row.product_name) ?? { count: 0, confidence: 0 };
    group.names.set(row.product_name, {
      count: currentName.count + 1,
      confidence: Math.max(currentName.confidence, Number(row.confidence))
    });
    group.rows.push(row);
    group.confidence = Math.max(group.confidence, Number(row.confidence));
  }
  return groups;
}

async function insertReference(
  client: PoolClient,
  group: ReferenceGroup,
  canonicalName: string
): Promise<void> {
  await client.query(
    `insert into product_references(
       id, reference_key, barcode, product_codes, vendor_product_codes,
       canonical_name, name_aliases, units, template_keys, issuer_names,
       source_count, confidence
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      group.id,
      group.referenceKey,
      group.barcode,
      [...group.productCodes],
      [...group.vendorProductCodes],
      canonicalName,
      [...group.names.keys()],
      [...group.units],
      [...group.templateKeys],
      [...group.issuerNames],
      group.rows.length,
      group.confidence
    ]
  );
}

async function upsertReference(
  client: PoolClient,
  key: string,
  document: OcrDocument,
  item: OcrItem,
  audit?: ReconciliationLineAudit
): Promise<string> {
  const confidence = evidenceConfidence(item, audit);
  const result = await client.query<{ id: string }>(
    `insert into product_references(
       id, reference_key, barcode, product_codes, vendor_product_codes,
       canonical_name, name_aliases, units, template_keys, issuer_names,
       source_count, confidence
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)
     on conflict (reference_key) do update set
       barcode = coalesce(product_references.barcode, excluded.barcode),
       product_codes = case
         when excluded.product_codes <@ product_references.product_codes then product_references.product_codes
         else product_references.product_codes || excluded.product_codes end,
       vendor_product_codes = case
         when excluded.vendor_product_codes <@ product_references.vendor_product_codes then product_references.vendor_product_codes
         else product_references.vendor_product_codes || excluded.vendor_product_codes end,
       name_aliases = case
         when excluded.name_aliases <@ product_references.name_aliases then product_references.name_aliases
         else product_references.name_aliases || excluded.name_aliases end,
       units = case
         when excluded.units <@ product_references.units then product_references.units
         else product_references.units || excluded.units end,
       template_keys = case
         when excluded.template_keys <@ product_references.template_keys then product_references.template_keys
         else product_references.template_keys || excluded.template_keys end,
       issuer_names = case
         when excluded.issuer_names <@ product_references.issuer_names then product_references.issuer_names
         else product_references.issuer_names || excluded.issuer_names end,
       canonical_name = case
         when excluded.confidence > product_references.confidence then excluded.canonical_name
         else product_references.canonical_name end,
       source_count = product_references.source_count + 1,
       confidence = greatest(product_references.confidence, excluded.confidence),
       updated_at = now()
     returning id`,
    [
      randomUUID(),
      key,
      item.barcode,
      textArray(item.product_code),
      textArray(item.vendor_product_code),
      item.product_name,
      textArray(item.product_name),
      textArray(item.unit?.toUpperCase() ?? null),
      [document.template_key],
      textArray(document.issuer_name),
      confidence
    ]
  );
  return result.rows[0].id;
}

async function insertEvidenceBatch(
  client: PoolClient,
  evidence: Array<Record<string, unknown>>
): Promise<void> {
  await client.query(
    `insert into product_reference_evidence(
       id, reference_id, document_id, line_no, source_kind, observed_item, confidence
     )
     select id::uuid, reference_id::uuid, document_id::uuid, line_no,
            source_kind, observed_item, confidence
     from jsonb_to_recordset($1::jsonb) as value(
       id text, reference_id text, document_id text, line_no integer,
       source_kind text, observed_item jsonb, confidence numeric
     )
     on conflict (document_id, line_no) do nothing`,
    [JSON.stringify(evidence)]
  );
}

function isEligibleEvidence(item: OcrItem, audit?: ReconciliationLineAudit): boolean {
  if (audit?.warnings.length) return false;
  if (audit?.matchedReferenceId) return audit.matchConfidence >= 0.9;
  return item.confidence >= 0.95;
}

function evidenceConfidence(item: OcrItem, audit?: ReconciliationLineAudit): number {
  return Math.max(0, Math.min(1, audit?.matchedReferenceId ? audit.matchConfidence : item.confidence));
}

function chooseCanonicalName(names: ReferenceGroup["names"]): string {
  return [...names.entries()]
    .sort((left, right) => {
      const countDifference = right[1].count - left[1].count;
      if (countDifference !== 0) return countDifference;
      const confidenceDifference = right[1].confidence - left[1].confidence;
      if (confidenceDifference !== 0) return confidenceDifference;
      return right[0].length - left[0].length;
    })[0]?.[0] ?? "Unknown product";
}

function toProductReference(row: ProductReferenceRow): ProductReference {
  const confidence = Number(row.confidence);
  const trustScore = Math.min(
    1,
    confidence * 0.82 + Math.min(row.source_count, 5) * 0.025 + (row.verified ? 0.1 : 0)
  );
  return {
    id: row.id,
    referenceKey: row.reference_key,
    barcode: row.barcode,
    productCodes: unique(row.product_codes),
    vendorProductCodes: unique(row.vendor_product_codes),
    canonicalName: row.canonical_name,
    nameAliases: unique(row.name_aliases),
    units: unique(row.units),
    templateKeys: unique(row.template_keys),
    issuerNames: unique(row.issuer_names),
    scopedIdentifiers: parseScopedIdentifiers(row.scoped_identifiers),
    sourceCount: row.source_count,
    trustScore,
    verified: row.verified
  };
}

function parseScopedIdentifiers(value: unknown): ScopedProductIdentifier[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const templateKey = nullableText(source.templateKey);
    if (!templateKey) return [];
    return [{
      templateKey,
      issuerName: nullableText(source.issuerName),
      productCode: nullableText(source.productCode),
      vendorProductCode: nullableText(source.vendorProductCode),
      unit: nullableText(source.unit)?.toUpperCase() ?? null
    }];
  });
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function addIfPresent(target: Set<string>, value: string | null): void {
  if (value) target.add(value);
}

function textArray(value: string | null): string[] {
  return value ? [value] : [];
}

function unique(values: string[] | null | undefined): string[] {
  return [...new Set(values ?? [])];
}
