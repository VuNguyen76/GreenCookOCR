import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool } from "../db/pool.js";

export interface TargetProduct {
  id: string;
  value: string;
  barcode: string | null;
  productCode: string | null;
  name: string;
  uomId: string | null;
  uomName: string | null;
}

export interface TargetPartner {
  id: string;
  value: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
  paymentTermId: string | null;
  priceListId: string | null;
}

export async function searchTargetProducts(query: string, limit = 20): Promise<TargetProduct[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const result = await pool.query(`
    SELECT product.kg_sp_id::text AS id, product.value,
           product.barcode, product.mau AS product_code, product.name,
           product.c_uom_id::text AS uom_id, uom.name AS uom_name
    FROM adempiere.kg_sp product
    LEFT JOIN adempiere.c_uom uom ON uom.c_uom_id = product.c_uom_id
    WHERE product.isactive = 'Y' AND product.ad_client_id = $3
      AND (
        lower(product.value) = lower($1)
        OR lower(coalesce(product.barcode, '')) = lower($1)
        OR lower(coalesce(product.mau, '')) = lower($1)
        OR product.name ILIKE '%' || $1 || '%'
      )
    ORDER BY
      CASE
        WHEN lower(coalesce(product.barcode, '')) = lower($1) THEN 0
        WHEN lower(coalesce(product.mau, '')) = lower($1) THEN 1
        WHEN lower(product.value) = lower($1) THEN 2
        ELSE 3
      END,
      product.name
    LIMIT $2
  `, [normalized, limit, config.targetAdClientId]);
  return result.rows.map(productRow);
}

export async function getTargetProduct(id: string, client?: PoolClient): Promise<TargetProduct | null> {
  const executor = client ?? pool;
  const result = await executor.query(`
    SELECT product.kg_sp_id::text AS id, product.value,
           product.barcode, product.mau AS product_code, product.name,
           product.c_uom_id::text AS uom_id, uom.name AS uom_name
    FROM adempiere.kg_sp product
    LEFT JOIN adempiere.c_uom uom ON uom.c_uom_id = product.c_uom_id
    WHERE product.kg_sp_id = $1 AND product.isactive = 'Y'
      AND product.ad_client_id = $2
  `, [id, config.targetAdClientId]);
  return result.rows[0] ? productRow(result.rows[0]) : null;
}

export async function getTargetProducts(ids: string[], client?: PoolClient): Promise<TargetProduct[]> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const executor = client ?? pool;
  const result = await executor.query(`
    SELECT product.kg_sp_id::text AS id, product.value,
           product.barcode, product.mau AS product_code, product.name,
           product.c_uom_id::text AS uom_id, uom.name AS uom_name
    FROM adempiere.kg_sp product
    LEFT JOIN adempiere.c_uom uom ON uom.c_uom_id = product.c_uom_id
    WHERE product.kg_sp_id = ANY($1::numeric[]) AND product.isactive = 'Y'
      AND product.ad_client_id = $2
  `, [uniqueIds, config.targetAdClientId]);
  return result.rows.map(productRow);
}

export async function resolveTargetProduct(
  item: Record<string, unknown>,
  client?: PoolClient
): Promise<TargetProduct | null> {
  const executor = client ?? pool;
  const candidates = uniqueStrings([
    item.barcode,
    item.product_code,
    item.vendor_product_code,
    item.model
  ]);
  const result = candidates.length ? await executor.query(`
    SELECT product.kg_sp_id::text AS id, product.value,
           product.barcode, product.mau AS product_code, product.name,
           product.c_uom_id::text AS uom_id, uom.name AS uom_name,
           CASE
             WHEN lower(coalesce(product.barcode, '')) = ANY($1::text[]) THEN 0
             WHEN lower(coalesce(product.mau, '')) = ANY($1::text[]) THEN 1
             WHEN lower(product.value) = ANY($1::text[]) THEN 2
             ELSE 9
           END AS rank
    FROM adempiere.kg_sp product
    LEFT JOIN adempiere.c_uom uom ON uom.c_uom_id = product.c_uom_id
    WHERE product.isactive = 'Y' AND product.ad_client_id = $2
      AND (
        lower(coalesce(product.barcode, '')) = ANY($1::text[])
        OR lower(coalesce(product.mau, '')) = ANY($1::text[])
        OR lower(product.value) = ANY($1::text[])
      )
    ORDER BY rank, product.kg_sp_id
    LIMIT 2
  `, [candidates.map((value) => value.toLowerCase()), config.targetAdClientId]) : { rows: [] };
  if (result.rows.length === 1) return productRow(result.rows[0]);
  if (result.rows.length > 1) return null;

  const title = [item.product_name, item.model]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (!title) return null;
  const catalog = await executor.query(`
    SELECT product.kg_sp_id::text AS id, product.value,
           product.barcode, product.mau AS product_code, product.name,
           product.c_uom_id::text AS uom_id, uom.name AS uom_name
    FROM adempiere.kg_sp product
    LEFT JOIN adempiere.c_uom uom ON uom.c_uom_id = product.c_uom_id
    WHERE product.isactive = 'Y' AND product.ad_client_id = $1
  `, [config.targetAdClientId]);
  return findUniqueTitleProduct(title, catalog.rows.map(productRow));
}

export function findUniqueTitleProduct(title: string, products: TargetProduct[]): TargetProduct | null {
  const normalizedTitle = normalizeModel(title);
  const matches = products.flatMap((product) => {
    const aliases = modelAliases(product.value);
    const matchedAlias = aliases.find((alias) => normalizedTitle.includes(alias));
    return matchedAlias ? [{ product, score: matchedAlias.length }] : [];
  });
  if (!matches.length) return null;
  const bestScore = Math.max(...matches.map((match) => match.score));
  const best = matches.filter((match) => match.score === bestScore);
  return best.length === 1 ? best[0].product : null;
}

export async function searchTargetPartners(query: string, limit = 20): Promise<TargetPartner[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const result = await pool.query(`
    SELECT partner.c_bpartner_id::text AS id, partner.value, partner.name,
           location.c_bpartner_location_id::text AS location_id,
           location.name AS location_name,
           coalesce(partner.po_paymentterm_id, partner.c_paymentterm_id)::text AS payment_term_id,
           coalesce(partner.po_pricelist_id, partner.m_pricelist_id)::text AS price_list_id
    FROM adempiere.c_bpartner partner
    LEFT JOIN LATERAL (
      SELECT candidate.c_bpartner_location_id, candidate.name
      FROM adempiere.c_bpartner_location candidate
      WHERE candidate.c_bpartner_id = partner.c_bpartner_id
        AND candidate.isactive = 'Y'
      ORDER BY candidate.isshipto DESC, candidate.isbillto DESC,
               candidate.c_bpartner_location_id
      LIMIT 1
    ) location ON true
    WHERE partner.isactive = 'Y' AND partner.ad_client_id = $3
      AND (partner.value ILIKE '%' || $1 || '%' OR partner.name ILIKE '%' || $1 || '%')
    ORDER BY CASE WHEN lower(partner.name) = lower($1) THEN 0 ELSE 1 END,
             CASE WHEN location.c_bpartner_location_id IS NULL THEN 1 ELSE 0 END,
             partner.name
    LIMIT $2
  `, [normalized, limit, config.targetAdClientId]);
  return result.rows.map(partnerRow);
}

export async function getTargetPartner(id: string, client?: PoolClient): Promise<TargetPartner | null> {
  const executor = client ?? pool;
  const result = await executor.query(`
    SELECT partner.c_bpartner_id::text AS id, partner.value, partner.name,
           location.c_bpartner_location_id::text AS location_id,
           location.name AS location_name,
           coalesce(partner.po_paymentterm_id, partner.c_paymentterm_id)::text AS payment_term_id,
           coalesce(partner.po_pricelist_id, partner.m_pricelist_id)::text AS price_list_id
    FROM adempiere.c_bpartner partner
    LEFT JOIN LATERAL (
      SELECT candidate.c_bpartner_location_id, candidate.name
      FROM adempiere.c_bpartner_location candidate
      WHERE candidate.c_bpartner_id = partner.c_bpartner_id
        AND candidate.isactive = 'Y'
      ORDER BY candidate.isshipto DESC, candidate.isbillto DESC,
               candidate.c_bpartner_location_id
      LIMIT 1
    ) location ON true
    WHERE partner.c_bpartner_id = $1 AND partner.isactive = 'Y'
      AND partner.ad_client_id = $2
  `, [id, config.targetAdClientId]);
  return result.rows[0] ? partnerRow(result.rows[0]) : null;
}

export async function resolveTargetPartner(name: string, client?: PoolClient): Promise<TargetPartner | null> {
  const executor = client ?? pool;
  const result = await executor.query(`
    SELECT partner.c_bpartner_id::text AS id, partner.value, partner.name,
           location.c_bpartner_location_id::text AS location_id,
           location.name AS location_name,
           coalesce(partner.po_paymentterm_id, partner.c_paymentterm_id)::text AS payment_term_id,
           coalesce(partner.po_pricelist_id, partner.m_pricelist_id)::text AS price_list_id
    FROM adempiere.c_bpartner partner
    LEFT JOIN LATERAL (
      SELECT candidate.c_bpartner_location_id, candidate.name
      FROM adempiere.c_bpartner_location candidate
      WHERE candidate.c_bpartner_id = partner.c_bpartner_id
        AND candidate.isactive = 'Y'
      ORDER BY candidate.isshipto DESC, candidate.isbillto DESC,
               candidate.c_bpartner_location_id
      LIMIT 1
    ) location ON true
    WHERE partner.isactive = 'Y' AND partner.ad_client_id = $2
      AND (lower(btrim(partner.name)) = lower(btrim($1)) OR lower(btrim(partner.value)) = lower(btrim($1)))
    ORDER BY partner.c_bpartner_id
    LIMIT 2
  `, [name, config.targetAdClientId]);
  return result.rows.length === 1 ? partnerRow(result.rows[0]) : null;
}

export async function resolveCurrencyId(code: string | null, client: PoolClient): Promise<string> {
  const requestedCode = (code ?? "VND").toUpperCase();
  const result = await client.query<{ id: string }>(`
    SELECT c_currency_id::text AS id FROM adempiere.c_currency
    WHERE isactive = 'Y' AND iso_code IN ($1, 'VND')
    ORDER BY CASE WHEN iso_code = $1 THEN 0 ELSE 1 END
    LIMIT 1
  `, [requestedCode]);
  if (!result.rows[0]) throw new Error("Chưa cấu hình tiền tệ VND trong iDempiere");
  return result.rows[0].id;
}

function productRow(row: Record<string, unknown>): TargetProduct {
  return {
    id: String(row.id),
    value: String(row.value),
    barcode: row.barcode ? String(row.barcode) : null,
    productCode: row.product_code ? String(row.product_code) : null,
    name: String(row.name),
    uomId: row.uom_id ? String(row.uom_id) : null,
    uomName: row.uom_name ? String(row.uom_name) : null
  };
}

function partnerRow(row: Record<string, unknown>): TargetPartner {
  return {
    id: String(row.id),
    value: String(row.value),
    name: String(row.name),
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    paymentTermId: row.payment_term_id ? String(row.payment_term_id) : null,
    priceListId: row.price_list_id ? String(row.price_list_id) : null
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }))];
}

function modelAliases(value: string): string[] {
  const full = normalizeModel(value);
  const withoutSuffix = full.replace(/IH$/, "");
  const withoutPrefix = withoutSuffix.replace(/^GC/, "");
  return [...new Set([full, withoutSuffix, withoutPrefix].filter((alias) => alias.length >= 5))]
    .sort((left, right) => right.length - left.length);
}

function normalizeModel(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
