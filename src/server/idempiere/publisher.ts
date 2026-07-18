import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import {
  claimNextPublishJob,
  getDocument,
  markPublished,
  markPublishFailed
} from "../db/repository.js";
import {
  getTargetPartner,
  getTargetProduct,
  resolveCurrencyId,
  resolveTargetPartner,
  resolveTargetProduct,
  type TargetPartner,
  type TargetProduct
} from "./catalog.js";

interface GroupableDocument {
  id: string;
  po_number: string | null;
  po_date: string | null;
  delivery_date: string | null;
  delivery_address: string | null;
}

interface GroupableItem {
  id: string;
  line_no: number;
  po_number: string | null;
  po_date: string | null;
  store_code: string | null;
  store_name: string | null;
  delivery_address: string | null;
  amount: string | null;
  [key: string]: unknown;
}

export interface PublishGroup {
  orderKey: string;
  poNumber: string;
  poDate: string | null;
  deliveryDate: string | null;
  deliveryAddress: string | null;
  storeCode: string | null;
  storeName: string | null;
  subtotalAmount: string | null;
  items: GroupableItem[];
}

export function groupDocumentOrders(
  document: GroupableDocument,
  items: GroupableItem[]
): PublishGroup[] {
  const groups = new Map<string, PublishGroup>();
  for (const item of items) {
    const poNumber = clean(item.po_number) ?? clean(document.po_number);
    const storeCode = clean(item.store_code);
    const orderKey = poNumber
      ? `${poNumber}|${storeCode ?? "default"}`
      : storeCode
        ? `document|${storeCode}`
        : "document";
    const existing = groups.get(orderKey) ?? {
      orderKey,
      poNumber: poNumber ?? `OCR-${document.id}`,
      poDate: clean(item.po_date) ?? clean(document.po_date),
      deliveryDate: clean(document.delivery_date),
      deliveryAddress: clean(item.delivery_address) ?? clean(document.delivery_address),
      storeCode,
      storeName: clean(item.store_name),
      subtotalAmount: null,
      items: []
    };
    existing.items.push(item);
    existing.subtotalAmount = sumAmounts(existing.items);
    groups.set(orderKey, existing);
  }
  return [...groups.values()];
}

export class IdempierePublisher {
  async publishNext(): Promise<boolean> {
    const job = await claimNextPublishJob();
    if (!job) return false;
    try {
      const orderIds = await this.publishDocument(job.document_id);
      await markPublished(job.id, job.document_id, orderIds);
    } catch (error) {
      await markPublishFailed(job.id, job.document_id, error);
      console.error(`Publish failed for ${job.document_id}:`, error);
    }
    return true;
  }

  async publishDocument(documentId: string, transactionClient?: PoolClient): Promise<string[]> {
    const document = await getDocument(documentId);
    if (!document) throw new Error("Không tìm thấy dữ liệu OCR trong SQLite");
    const items = document.items as unknown as GroupableItem[];
    if (!items.length) throw new Error("Tài liệu không có dòng sản phẩm để đưa vào iDempiere");
    const client = transactionClient ?? await pool.connect();
    const ownsTransaction = !transactionClient;
    try {
      if (ownsTransaction) await client.query("BEGIN");
      const partner = await this.resolvePartner(document, client);
      const currencyId = await resolveCurrencyId(asString(document.currency), client);
      const products = await this.resolveProducts(items, client);
      const groups = groupDocumentOrders(document as unknown as GroupableDocument, items);
      const orderIds: string[] = [];
      for (const group of groups) {
        orderIds.push(await this.upsertGroup(client, document, group, partner, currencyId, products));
      }
      if (ownsTransaction) await client.query("COMMIT");
      return orderIds;
    } catch (error) {
      if (ownsTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  private async resolvePartner(document: Record<string, unknown>, client: PoolClient): Promise<TargetPartner | null> {
    const selectedId = asString(document.target_bpartner_id);
    if (selectedId) {
      const selected = await getTargetPartner(selectedId, client);
      if (!selected) throw new Error("Đối tác đã chọn không còn tồn tại trong iDempiere.");
      return selected;
    }
    return resolveTargetPartner(asString(document.issuer_name) ?? "", client);
  }

  private async resolveProducts(items: GroupableItem[], client: PoolClient): Promise<Map<string, TargetProduct>> {
    const products = new Map<string, TargetProduct>();
    const unmatched: number[] = [];
    for (const item of items) {
      const selectedId = asString(item.matched_kg_sp_id);
      const product = selectedId
        ? await getTargetProduct(selectedId, client)
        : await resolveTargetProduct(item, client);
      if (!product) unmatched.push(item.line_no);
      else products.set(item.id, product);
    }
    if (unmatched.length) {
      throw new Error(`Chưa đối chiếu được sản phẩm ở dòng ${unmatched.join(", ")}.`);
    }
    return products;
  }

  private async upsertGroup(
    client: PoolClient,
    document: Record<string, unknown>,
    group: PublishGroup,
    partner: TargetPartner | null,
    currencyId: string,
    products: Map<string, TargetProduct>
  ): Promise<string> {
    const existing = await client.query<{ id: string }>(`
      SELECT kg_order_id::text AS id FROM adempiere.kg_order
      WHERE ad_client_id = $1 AND source_order_key = $3
        AND (source_document_id = $2 OR source_sha256 = $4)
      ORDER BY CASE WHEN source_document_id = $2 THEN 0 ELSE 1 END
      LIMIT 1
    `, [config.targetAdClientId, document.id, group.orderKey, document.sha256]);
    if (existing.rows[0]) return existing.rows[0].id;

    const id = await nextTableId(client, "kg_order");
    const isSingleGroup = groupDocumentOrders(
      document as unknown as GroupableDocument,
      document.items as unknown as GroupableItem[]
    ).length === 1;
    await client.query(`
      INSERT INTO adempiere.kg_order(
        kg_order_id, ad_client_id, ad_org_id, createdby, updatedby,
        value, source_document_id, source_order_key, source_sha256,
        source_file_name, document_title, template_key, document_type,
        c_bpartner_id, issuer_name, store_code, store_name, po_date,
        delivery_date, delivery_address, c_currency_id, subtotal_amount,
        tax_amount, total_amount, docstatus, confirmed_at, description
      ) VALUES (
        $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,'CO',now(),$24
      )
    `, [
      id, config.targetAdClientId, config.targetAdOrgId, config.targetAdUserId,
      group.poNumber, document.id, group.orderKey, document.sha256,
      document.original_name, document.document_title, document.template_key,
      document.document_type ?? "purchase_order", partner?.id ?? null, document.issuer_name,
      group.storeCode, group.storeName, group.poDate, group.deliveryDate,
      group.deliveryAddress, currencyId,
      isSingleGroup ? document.subtotal_amount : group.subtotalAmount,
      isSingleGroup ? document.tax_amount : null,
      isSingleGroup ? document.total_amount : group.subtotalAmount,
      `GreenCookOCR: ${document.original_name}`
    ]);

    let line = 10;
    for (const item of group.items) {
      const product = products.get(item.id);
      if (!product) throw new Error(`Thiếu sản phẩm đã đối chiếu ở dòng ${item.line_no}`);
      const detailId = await nextTableId(client, "kg_detail");
      await client.query(`
        INSERT INTO adempiere.kg_detail(
          kg_detail_id, ad_client_id, ad_org_id, createdby, updatedby,
          kg_order_id, line, kg_sp_id, product_code, vendor_product_code,
          barcode, product_name, model, quantity, units_per_order_unit,
          c_uom_id, unit_name, unit_price, vat_rate, amount, source_page,
          confidence, description
        ) VALUES (
          $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22
        )
      `, [
        detailId, config.targetAdClientId, config.targetAdOrgId, config.targetAdUserId,
        id, line, product.id, item.product_code, item.vendor_product_code,
        item.barcode, item.product_name, item.model, item.quantity,
        item.units_per_order_unit, product.uomId, item.unit ?? product.uomName,
        item.unit_price, item.vat_rate, item.amount, item.source_page,
        item.confidence, `Dòng OCR ${item.line_no}`
      ]);
      line += 10;
    }
    return String(id);
  }
}

export class SequentialPublishWorker {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private readonly publisher = new IdempierePublisher();

  start(): void {
    this.schedule(500);
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay = 1500): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return this.schedule();
    this.running = true;
    try {
      await this.publisher.publishNext();
    } catch (error) {
      console.error("Publisher loop error", error);
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}

async function nextTableId(client: PoolClient, tableName: string): Promise<number> {
  const result = await client.query<{ id: number }>("SELECT adempiere.nextidf($1) AS id", [tableName]);
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id)) throw new Error(`Không lấy được ID cho ${tableName}`);
  return id;
}

function sumAmounts(items: GroupableItem[]): string | null {
  const values = items.map((item) => item.amount).filter((value): value is string => Boolean(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed();
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
