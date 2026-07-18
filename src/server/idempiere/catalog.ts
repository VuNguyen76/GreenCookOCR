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
    SELECT c_bpartner_id::text AS id, value, name
    FROM adempiere.c_bpartner
    WHERE isactive = 'Y' AND ad_client_id = $3
      AND (value ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%')
    ORDER BY CASE WHEN lower(name) = lower($1) THEN 0 ELSE 1 END, name
    LIMIT $2
  `, [normalized, limit, config.targetAdClientId]);
  return result.rows;
}

export async function getTargetPartner(id: string, client?: PoolClient): Promise<TargetPartner | null> {
  const executor = client ?? pool;
  const result = await executor.query(`
    SELECT c_bpartner_id::text AS id, value, name
    FROM adempiere.c_bpartner WHERE c_bpartner_id = $1 AND isactive = 'Y'
      AND ad_client_id = $2
  `, [id, config.targetAdClientId]);
  return result.rows[0] ?? null;
}

export async function resolveTargetPartner(name: string, client?: PoolClient): Promise<TargetPartner | null> {
  const executor = client ?? pool;
  const result = await executor.query(`
    SELECT c_bpartner_id::text AS id, value, name
    FROM adempiere.c_bpartner
    WHERE isactive = 'Y' AND ad_client_id = $2
      AND (lower(btrim(name)) = lower(btrim($1)) OR lower(btrim(value)) = lower(btrim($1)))
    ORDER BY c_bpartner_id
    LIMIT 2
  `, [name, config.targetAdClientId]);
  return result.rows.length === 1 ? result.rows[0] : null;
}

export async function resolveCurrencyId(code: string | null, client: PoolClient): Promise<string> {
  const result = await client.query<{ id: string }>(`
    SELECT c_currency_id::text AS id FROM adempiere.c_currency
    WHERE isactive = 'Y' AND iso_code = $1 LIMIT 1
  `, [(code ?? "VND").toUpperCase()]);
  if (!result.rows[0]) throw new Error(`Không tìm thấy tiền tệ ${code ?? "VND"} trong iDempiere`);
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

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean))];
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
