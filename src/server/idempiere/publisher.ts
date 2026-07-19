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
  resolveCurrencyId,
  resolveTargetPartner,
  type TargetPartner
} from "./catalog.js";
import { normalizePoNumber } from "./po-reference.js";

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
  product_code?: string | null;
  vendor_product_code?: string | null;
  barcode?: string | null;
  product_name?: string | null;
  model?: string | null;
  article_code?: string | null;
  sku?: string | null;
  ou_type?: string | null;
  quantity?: string | null;
  free_quantity?: string | null;
  units_per_order_unit?: string | null;
  unit?: string | null;
  list_price?: string | null;
  unit_price?: string | null;
  discount_percent?: string | null;
  discount_amount?: string | null;
  vat_rate?: string | null;
  tax_amount?: string | null;
  amount: string | null;
  gross_amount?: string | null;
  promised_date?: string | null;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  extra_fields?: unknown[];
  source_page?: number | null;
  confidence?: number | null;
  raw_row?: Record<string, unknown>;
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

interface OrderDefaults {
  docTypeId: string;
  sequenceId: string;
  orgId: string;
  warehouseId: string;
  priceListId: string;
  paymentTermId: string;
  salesRepId: string | null;
  isSoTrx: "Y" | "N";
  paymentRule: string;
  invoiceRule: string;
  deliveryRule: string;
  freightCostRule: string;
  deliveryViaRule: string;
  priorityRule: string;
  taxIncluded: "Y" | "N";
}

export function groupDocumentOrders(
  document: GroupableDocument,
  items: GroupableItem[]
): PublishGroup[] {
  const fallbackPoNumber = clean(document.po_number)
    ?? items.map((item) => clean(item.po_number)).find((value): value is string => Boolean(value));
  if (!fallbackPoNumber) throw new Error("Chưa có Số PO để tạo đơn đặt hàng.");

  if (!items.length) {
    return [{
      orderKey: normalizePoNumber(fallbackPoNumber),
      poNumber: fallbackPoNumber,
      poDate: clean(document.po_date),
      deliveryDate: clean(document.delivery_date),
      deliveryAddress: clean(document.delivery_address),
      storeCode: null,
      storeName: null,
      subtotalAmount: null,
      items: []
    }];
  }

  const groups = new Map<string, PublishGroup>();
  for (const item of items) {
    const poNumber = clean(item.po_number) ?? fallbackPoNumber;
    const itemPoDate = clean(item.po_date);
    const itemPromisedDate = clean(item.promised_date);
    const storeCode = clean(item.store_code);
    const orderKey = normalizePoNumber(poNumber);
    let existing = groups.get(orderKey);
    if (!existing) {
      existing = {
        orderKey,
        poNumber,
        poDate: itemPoDate ?? clean(document.po_date),
        deliveryDate: itemPromisedDate ?? clean(document.delivery_date),
        deliveryAddress: clean(item.delivery_address) ?? clean(document.delivery_address),
        storeCode,
        storeName: clean(item.store_name),
        subtotalAmount: null,
        items: []
      };
      groups.set(orderKey, existing);
    } else {
      existing.poDate ??= itemPoDate ?? clean(document.po_date);
      existing.deliveryDate ??= itemPromisedDate ?? clean(document.delivery_date);
      existing.deliveryAddress ??= clean(item.delivery_address) ?? clean(document.delivery_address);
      existing.storeCode ??= storeCode;
      existing.storeName ??= clean(item.store_name);
    }
    existing.items.push(item);
    existing.subtotalAmount = sumAmounts(existing.items);
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
    if (!document) throw new Error("Không tìm thấy dữ liệu tạm của chứng từ.");
    const sourceDocument = documentSource(document);
    const items = enrichItems(document);
    const client = transactionClient ?? await pool.connect();
    const ownsTransaction = !transactionClient;
    try {
      if (ownsTransaction) await client.query("BEGIN");
      const groups = groupDocumentOrders(sourceDocument as unknown as GroupableDocument, items)
        .sort((left, right) => left.orderKey.localeCompare(right.orderKey));
      const orderIds: string[] = [];
      let partner: TargetPartner | null = null;
      let currencyId: string | null = null;
      for (const group of groups) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${config.targetAdClientId}:${group.orderKey}`
        ]);
        const existing = await findExistingOrder(client, group.orderKey);
        if (existing) {
          orderIds.push(existing.id);
          continue;
        }

        partner ??= await this.resolvePartner(sourceDocument, client);
        currencyId ??= await resolveCurrencyId(asString(sourceDocument.currency), client);
        const defaults = await resolveOrderDefaults(
          client,
          partner,
          currencyId,
          warehouseHints(sourceDocument, group)
        );
        orderIds.push(await this.insertGroup(client, sourceDocument, group, partner, currencyId, defaults));
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

  private async resolvePartner(_document: Record<string, unknown>, client: PoolClient): Promise<TargetPartner> {
    const pendingPartner = await resolveTargetPartner("OCR_PENDING", client);
    if (!pendingPartner?.locationId) {
      throw new Error("Chưa cấu hình đối tác chờ bổ sung thông tin trong iDempiere.");
    }
    return pendingPartner;
  }

  private async insertGroup(
    client: PoolClient,
    document: Record<string, unknown>,
    group: PublishGroup,
    partner: TargetPartner,
    currencyId: string,
    defaults: OrderDefaults
  ): Promise<string> {
    const source = documentSource(document);
    const dateOrdered = group.poDate
      ?? clean(source.po_date)
      ?? firstItemDate(group.items, "po_date")
      ?? group.deliveryDate
      ?? clean(source.delivery_date)
      ?? today();
    const datePromised = group.deliveryDate
      ?? clean(source.delivery_date)
      ?? firstItemDate(group.items, "promised_date")
      ?? group.poDate
      ?? clean(source.po_date)
      ?? dateOrdered;
    const orderId = String(await nextTableId(client, "c_order"));
    const documentNo = await nextDocumentNo(client, defaults.sequenceId);
    const lineValues = await Promise.all(group.items.map(async (item) => {
      return createLineValues(client, item, asString(source.template_key));
    }));
    const calculatedSubtotal = sumLineValues(lineValues);
    const calculatedTax = sumTaxValues(lineValues);
    const calculatedTotal = sumGrossValues(lineValues);
    const isSingleOrder = groupDocumentOrders(
      source as unknown as GroupableDocument,
      enrichItems(document)
    ).length === 1;
    const subtotal = isSingleOrder
      ? decimalOrNull(source.subtotal_amount ?? document.subtotal_amount) ?? calculatedSubtotal
      : calculatedSubtotal;
    const taxAmount = isSingleOrder
      ? decimalOrNull(source.tax_amount ?? document.tax_amount) ?? calculatedTax
      : calculatedTax;
    const discountAmount = isSingleOrder ? decimalOrZero(source.discount_amount) : new Decimal(0);
    const chargeAmount = isSingleOrder ? decimalOrZero(source.charge_amount) : new Decimal(0);
    const freightAmount = isSingleOrder ? decimalOrZero(source.freight_amount) : new Decimal(0);
    const grandTotal = isSingleOrder
      ? decimalOrNull(source.total_amount ?? document.total_amount)
        ?? calculatedTotal.plus(chargeAmount).plus(freightAmount).minus(discountAmount)
      : calculatedTotal;
    const payload = sourcePayload(document, group);
    await insertRecord(client, "c_order", {
      c_order_id: orderId,
      ad_client_id: config.targetAdClientId,
      ad_org_id: defaults.orgId,
      createdby: config.targetAdUserId,
      updatedby: config.targetAdUserId,
      issotrx: defaults.isSoTrx,
      documentno: documentNo,
      docstatus: "DR",
      docaction: "CO",
      processed: "N",
      c_doctype_id: defaults.docTypeId,
      c_doctypetarget_id: defaults.docTypeId,
      dateordered: dateOrdered,
      dateacct: dateOrdered,
      datepromised: datePromised,
      poreference: group.poNumber,
      c_bpartner_id: partner.id,
      c_bpartner_location_id: partner.locationId,
      bill_bpartner_id: partner.id,
      bill_location_id: partner.locationId,
      c_currency_id: currencyId,
      paymentrule: defaults.paymentRule,
      c_paymentterm_id: defaults.paymentTermId,
      invoicerule: defaults.invoiceRule,
      deliveryrule: defaults.deliveryRule,
      freightcostrule: defaults.freightCostRule,
      freightamt: freightAmount.toFixed(),
      chargeamt: chargeAmount.toFixed(),
      deliveryviarule: defaults.deliveryViaRule,
      priorityrule: defaults.priorityRule,
      totallines: subtotal.toFixed(),
      grandtotal: grandTotal.toFixed(),
      m_warehouse_id: defaults.warehouseId,
      m_pricelist_id: defaults.priceListId,
      istaxincluded: defaults.taxIncluded,
      salesrep_id: defaults.salesRepId,
      description: orderDescription(document, group),
      kg_source_document_id: String(document.id),
      kg_source_file_name: asString(document.original_name),
      kg_source_sha256: asString(document.sha256),
      kg_source_payload: JSON.stringify(payload),
      kg_document_title: source.document_title,
      kg_document_type: source.document_type,
      kg_currency_text: asString(source.currency) ?? "VND",
      kg_template_key: source.template_key,
      kg_issuer_name: source.issuer_name,
      kg_issuer_branch: source.issuer_branch,
      kg_supplier_name: source.supplier_name,
      kg_buyer_name: source.buyer_name,
      kg_reference_number: source.reference_number,
      kg_order_contact: source.order_contact,
      kg_delivery_address: group.deliveryAddress ?? source.delivery_address,
      kg_ship_to_address: source.ship_to_address,
      kg_store_code: group.storeCode,
      kg_store_name: group.storeName,
      kg_warehouse_code: source.warehouse_code,
      kg_warehouse_name: source.warehouse_name,
      kg_department: source.department,
      kg_price_includes_tax: booleanFlag(source.price_includes_tax),
      kg_print_date: rawFieldValue(source, ["Ngày In"]),
      kg_print_time: rawFieldValue(source, ["Giờ In"]),
      kg_form_type: rawFieldValue(source, ["Loại Phiếu"]),
      kg_approved_by: rawFieldValue(source, ["Được Chấp Thuận Bởi", "Người duyệt"]),
      kg_industry_code: rawFieldValue(source, ["Mã Ngành Hàng"]),
      kg_contract_number: asString(source.reference_number)
        ?? rawFieldValue(source, ["Số Hợp Đồng", "Hợp đồng số", "Số Hợp Đồng / Hợp đồng số"]),
      kg_subtotal_amount: subtotal.toFixed(),
      kg_discount_amount: discountAmount.toFixed(),
      kg_tax_amount: taxAmount.toFixed(),
      kg_total_amount: grandTotal.toFixed()
    });

    for (let index = 0; index < group.items.length; index += 1) {
      const item = group.items[index];
      const values = lineValues[index];
      const lineId = String(await nextTableId(client, "c_orderline"));
      await insertRecord(client, "c_orderline", {
        c_orderline_id: lineId,
        ad_client_id: config.targetAdClientId,
        ad_org_id: defaults.orgId,
        createdby: config.targetAdUserId,
        updatedby: config.targetAdUserId,
        c_order_id: orderId,
        line: (index + 1) * 10,
        c_bpartner_id: partner.id,
        c_bpartner_location_id: partner.locationId,
        dateordered: dateOrdered,
        datepromised: values.promisedDate ?? datePromised,
        m_warehouse_id: defaults.warehouseId,
        c_uom_id: values.uomId,
        qtyordered: values.baseQuantity.toFixed(),
        qtyentered: values.enteredQuantity.toFixed(),
        c_currency_id: currencyId,
        pricelist: values.listPrice.toFixed(),
        priceactual: values.unitPrice.toFixed(),
        priceentered: values.unitPrice.toFixed(),
        pricelimit: 0,
        linenetamt: values.lineNetAmount.toFixed(),
        discount: values.discountPercent.toFixed(),
        freightamt: 0,
        c_tax_id: values.taxId,
        description: lineDescription(item),
        kg_source_line_id: item.id,
        kg_line_source_payload: JSON.stringify({ ...item.raw_row, normalized: item }),
        kg_product_code: item.product_code,
        kg_barcode: item.barcode,
        kg_product_name: item.product_name,
        kg_units_per_order_unit: values.conversion.toFixed(),
        kg_unit_name: item.unit,
        kg_unit_price: values.unitPrice.toFixed(),
        kg_discount_percent: values.discountPercent.toFixed(),
        kg_discount_amount: numericText(item.discount_amount),
        kg_vat_rate: numericText(item.vat_rate),
        kg_tax_amount: values.taxAmount.toFixed(),
        kg_amount: values.sourceAmount?.toFixed() ?? null,
        kg_gross_amount: values.grossAmount.toFixed(),
        kg_source_page: item.source_page ?? null,
        kg_warehouse_code: item.warehouse_code,
        kg_warehouse_name: item.warehouse_name
      });
    }
    return orderId;
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

interface LineValues {
  uomId: string;
  enteredQuantity: Decimal;
  conversion: Decimal;
  baseQuantity: Decimal;
  listPrice: Decimal;
  unitPrice: Decimal;
  discountPercent: Decimal;
  lineNetAmount: Decimal;
  sourceAmount: Decimal | null;
  taxAmount: Decimal;
  grossAmount: Decimal;
  taxId: string;
  promisedDate: string | null;
}

async function createLineValues(
  client: PoolClient,
  item: GroupableItem,
  templateKey?: string | null
): Promise<LineValues> {
  const enteredQuantity = nonNegativeDecimal(item.quantity);
  const parsedConversion = decimalOrNull(item.units_per_order_unit);
  const conversion = parsedConversion && parsedConversion.gt(0) ? parsedConversion : new Decimal(1);
  const baseQuantity = enteredQuantity.mul(conversion);
  const unitPrice = decimalOrNull(item.unit_price) ?? new Decimal(0);
  const raw = item.raw_row ?? {};
  const listPrice = decimalOrNull(item.list_price ?? raw.list_price) ?? unitPrice;
  const sourceAmount = decimalOrNull(item.amount);
  const sourceTaxAmount = decimalOrNull(item.tax_amount);
  const sourceGrossAmount = decimalOrNull(item.gross_amount);
  const vatRate = decimalOrNull(item.vat_rate) ?? new Decimal(0);
  const calculatedNet = baseQuantity.mul(unitPrice);
  const amountIncludesTax = templateKey === "po_dmx_pdf_customer_manual";
  const lineNetAmount = amountIncludesTax
    ? calculatedNet
    : sourceAmount ?? calculatedNet;
  const calculatedTax = lineNetAmount.mul(vatRate).dividedBy(100);
  const taxAmount = sourceTaxAmount
    ?? (amountIncludesTax && sourceAmount ? Decimal.max(sourceAmount.minus(lineNetAmount), 0) : calculatedTax);
  const grossAmount = sourceGrossAmount
    ?? (amountIncludesTax && sourceAmount ? sourceAmount : lineNetAmount.plus(taxAmount));
  const explicitDiscount = decimalOrNull(item.discount_percent);
  const discountPercent = explicitDiscount
    ?? (listPrice.gt(0) && unitPrice.lt(listPrice)
      ? listPrice.minus(unitPrice).dividedBy(listPrice).mul(100)
      : new Decimal(0));
  return {
    uomId: await resolveUomId(client, clean(item.unit)),
    enteredQuantity,
    conversion,
    baseQuantity,
    listPrice,
    unitPrice,
    discountPercent,
    lineNetAmount,
    sourceAmount,
    taxAmount,
    grossAmount,
    taxId: await resolveTaxId(client, asString(item.vat_rate)),
    promisedDate: clean(item.promised_date) ?? clean(raw.promised_date)
  };
}

async function resolveUomId(
  client: PoolClient,
  sourceUnit: string | null
): Promise<string> {
  const result = await client.query<{ id: string; name: string; symbol: string | null }>(`
    SELECT c_uom_id::text AS id, name, uomsymbol AS symbol
    FROM adempiere.c_uom
    WHERE isactive = 'Y' AND ad_client_id IN (0, $1)
    ORDER BY CASE WHEN ad_client_id = $1 THEN 0 ELSE 1 END, c_uom_id
  `, [config.targetAdClientId]);
  const normalizedSource = sourceUnit ? normalizeText(sourceUnit) : "";
  const matched = normalizedSource ? result.rows.find((row) =>
    [row.name, row.symbol].some((value) => value && normalizeText(value) === normalizedSource)
  ) : null;
  const fallback = result.rows.find((row) => ["CAI", "EACH", "UNIT"].includes(normalizeText(row.name)))
    ?? result.rows[0];
  const selected = matched ?? fallback;
  if (!selected) throw new Error("Chưa cấu hình đơn vị tính trong iDempiere.");
  return selected.id;
}

async function resolveOrderDefaults(
  client: PoolClient,
  partner: TargetPartner,
  currencyId: string,
  warehouseSourceHints: string[] = []
): Promise<OrderDefaults> {
  const docType = await client.query<{ id: string; sequence_id: string; is_so_trx: "Y" | "N" }>(`
    SELECT c_doctype_id::text AS id, docnosequence_id::text AS sequence_id,
           issotrx AS is_so_trx
    FROM adempiere.c_doctype
    WHERE ad_client_id = $1 AND isactive = 'Y' AND docbasetype = 'POO'
      AND name = 'Purchase Order'
    ORDER BY c_doctype_id
    LIMIT 1
  `, [config.targetAdClientId]);
  if (!docType.rows[0]?.sequence_id) {
    throw new Error("Chưa cấu hình loại chứng từ Purchase Order trong iDempiere.");
  }

  const baseline = await client.query<Record<string, unknown>>(`
    SELECT ad_org_id::text AS org_id, m_warehouse_id::text AS warehouse_id,
           m_pricelist_id::text AS price_list_id,
           c_paymentterm_id::text AS payment_term_id, salesrep_id::text AS sales_rep_id,
           paymentrule AS payment_rule, invoicerule AS invoice_rule,
           deliveryrule AS delivery_rule, freightcostrule AS freight_cost_rule,
           deliveryviarule AS delivery_via_rule, priorityrule AS priority_rule,
           istaxincluded AS tax_included
    FROM adempiere.c_order
    WHERE ad_client_id = $1 AND c_doctypetarget_id = $2
    ORDER BY updated DESC
    LIMIT 1
  `, [config.targetAdClientId, docType.rows[0].id]);

  const priceList = await client.query<{ id: string; tax_included: "Y" | "N" }>(`
    SELECT m_pricelist_id::text AS id, istaxincluded AS tax_included
    FROM adempiere.m_pricelist
    WHERE ad_client_id = $1 AND isactive = 'Y' AND c_currency_id = $2
      AND issopricelist = $3
    ORDER BY CASE WHEN m_pricelist_id = $4 THEN 0 ELSE 1 END, m_pricelist_id
    LIMIT 1
  `, [
    config.targetAdClientId,
    currencyId,
    docType.rows[0].is_so_trx,
    partner.priceListId ?? asString(baseline.rows[0]?.price_list_id)
  ]);
  if (!priceList.rows[0]) throw new Error("Chưa có bảng giá mua hàng phù hợp với tiền tệ của chứng từ.");

  const warehouses = await client.query<{ id: string; org_id: string; value: string; name: string }>(`
    SELECT m_warehouse_id::text AS id, ad_org_id::text AS org_id, value, name
    FROM adempiere.m_warehouse
    WHERE ad_client_id = $1 AND isactive = 'Y'
    ORDER BY m_warehouse_id
  `, [config.targetAdClientId]);
  const warehouse = selectWarehouse(
    warehouses.rows,
    warehouseSourceHints,
    asString(baseline.rows[0]?.warehouse_id)
  );
  if (!warehouse) throw new Error("Chưa cấu hình kho nhận hàng trong iDempiere.");

  const paymentTermId = partner.paymentTermId ?? asString(baseline.rows[0]?.payment_term_id);
  if (!paymentTermId) throw new Error(`Đối tác ${partner.name} chưa có điều khoản thanh toán.`);
  const baselineRow = baseline.rows[0] ?? {};
  return {
    docTypeId: docType.rows[0].id,
    sequenceId: docType.rows[0].sequence_id,
    orgId: warehouse.org_id === "0"
      ? asString(baselineRow.org_id) ?? String(config.targetAdOrgId)
      : warehouse.org_id,
    warehouseId: warehouse.id,
    priceListId: priceList.rows[0].id,
    paymentTermId,
    salesRepId: asString(baselineRow.sales_rep_id),
    isSoTrx: docType.rows[0].is_so_trx,
    paymentRule: asString(baselineRow.payment_rule) ?? "P",
    invoiceRule: asString(baselineRow.invoice_rule) ?? "D",
    deliveryRule: asString(baselineRow.delivery_rule) ?? "A",
    freightCostRule: asString(baselineRow.freight_cost_rule) ?? "I",
    deliveryViaRule: asString(baselineRow.delivery_via_rule) ?? "P",
    priorityRule: asString(baselineRow.priority_rule) ?? "5",
    taxIncluded: priceList.rows[0].tax_included
  };
}

async function resolveTaxId(client: PoolClient, rate: string | null): Promise<string> {
  const numericRate = decimalOrNull(rate)?.toFixed() ?? "0";
  const result = await client.query<{ id: string }>(`
    SELECT c_tax_id::text AS id
    FROM adempiere.c_tax
    WHERE ad_client_id = $1 AND isactive = 'Y' AND rate = $2::numeric
    ORDER BY CASE WHEN lower(name) = 'standard' THEN 0 ELSE 1 END, c_tax_id
    LIMIT 1
  `, [config.targetAdClientId, numericRate]);
  if (result.rows[0]) return result.rows[0].id;
  const fallback = await client.query<{ id: string }>(`
    SELECT c_tax_id::text AS id
    FROM adempiere.c_tax
    WHERE ad_client_id = $1 AND isactive = 'Y'
    ORDER BY CASE WHEN rate = 0 THEN 0 ELSE 1 END, c_tax_id
    LIMIT 1
  `, [config.targetAdClientId]);
  if (!fallback.rows[0]) throw new Error("Chưa cấu hình thuế trong iDempiere.");
  return fallback.rows[0].id;
}

async function findExistingOrder(client: PoolClient, normalizedPo: string): Promise<{
  id: string;
  documentNo: string;
  sourceDocumentId: string | null;
} | null> {
  const result = await client.query<{
    id: string;
    document_no: string;
    source_document_id: string | null;
  }>(`
    SELECT c_order_id::text AS id, documentno AS document_no,
           kg_source_document_id AS source_document_id
    FROM adempiere.c_order
    WHERE ad_client_id = $1
      AND regexp_replace(upper(btrim(coalesce(poreference, ''))), '[^A-Z0-9]', '', 'g') = $2
    ORDER BY c_order_id
    LIMIT 1
  `, [config.targetAdClientId, normalizedPo]);
  return result.rows[0] ? {
    id: result.rows[0].id,
    documentNo: result.rows[0].document_no,
    sourceDocumentId: result.rows[0].source_document_id
  } : null;
}

async function nextDocumentNo(client: PoolClient, sequenceId: string): Promise<string> {
  const result = await client.query<{ document_no: string }>(`
    UPDATE adempiere.ad_sequence
    SET currentnext = currentnext + incrementno, updated = now(), updatedby = $2
    WHERE ad_sequence_id = $1 AND isactive = 'Y'
    RETURNING coalesce(prefix, '') || (currentnext - incrementno)::text || coalesce(suffix, '') AS document_no
  `, [sequenceId, config.targetAdUserId]);
  if (!result.rows[0]) throw new Error("Không lấy được số chứng từ kế tiếp từ iDempiere.");
  return result.rows[0].document_no;
}

async function nextTableId(client: PoolClient, tableName: string): Promise<number> {
  const result = await client.query<{ id: number }>("SELECT adempiere.nextidf($1) AS id", [tableName]);
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id)) throw new Error(`Không lấy được ID cho ${tableName}`);
  return id;
}

function enrichItems(document: Record<string, unknown> & { items?: Record<string, unknown>[] }): GroupableItem[] {
  const normalized = document.normalized_result as { items?: Record<string, unknown>[] } | null;
  const byLine = new Map((normalized?.items ?? []).map((item) => [Number(item.line_no), item]));
  return (document.items ?? []).map((item) => {
    const normalizedItem = byLine.get(Number(item.line_no)) ?? {};
    return {
      ...normalizedItem,
      ...withoutNullish(item),
      raw_row: item.raw_row as Record<string, unknown> | undefined
    };
  }) as GroupableItem[];
}

function documentSource(document: Record<string, unknown>): Record<string, unknown> {
  const normalized = document.normalized_result;
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? { ...document, ...(normalized as Record<string, unknown>) }
    : document;
}

async function insertRecord(
  client: PoolClient,
  table: "c_order" | "c_orderline",
  record: Record<string, unknown>
): Promise<void> {
  const entries = Object.entries(record);
  const columns = entries.map(([column]) => column).join(", ");
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(
    `INSERT INTO adempiere.${table}(${columns}) VALUES (${placeholders})`,
    entries.map(([, value]) => value === undefined ? null : value)
  );
}

function sourcePayload(document: Record<string, unknown>, group: PublishGroup): Record<string, unknown> {
  return {
    schema_version: "1.0",
    source_document_id: document.id,
    source_file_name: document.original_name,
    source_sha256: document.sha256,
    template_key: document.template_key,
    raw_result: document.raw_result,
    normalized_result: document.normalized_result,
    order_key: group.orderKey
  };
}

function rawFieldValue(source: Record<string, unknown>, labels: string[]): string | null {
  if (!Array.isArray(source.raw_fields)) return null;
  const normalizedLabels = new Set(labels.map(normalizeText));
  for (const field of source.raw_fields) {
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    const record = field as Record<string, unknown>;
    const label = asString(record.label);
    if (!label || !normalizedLabels.has(normalizeText(label))) continue;
    return asString(record.value);
  }
  return null;
}

function warehouseHints(document: Record<string, unknown>, group: PublishGroup): string[] {
  const normalized = document.normalized_result as Record<string, unknown> | null;
  return [
    normalized?.warehouse_code,
    normalized?.warehouse_name,
    group.storeCode,
    group.storeName,
    group.deliveryAddress,
    document.delivery_address
  ].flatMap((value) => {
    const text = clean(value);
    return text ? [text] : [];
  });
}

export function selectWarehouse<T extends { id: string; org_id: string; value: string; name: string }>(
  warehouses: T[],
  hints: string[],
  fallbackId: string | null
): T | null {
  const normalizedHints = hints.flatMap((hint) => {
    const normalized = normalizeText(hint);
    return normalized ? [normalized] : [];
  });
  const scored = warehouses.map((warehouse) => {
    const names = [warehouse.value, warehouse.name].flatMap((name) => {
      const normalized = normalizeText(name);
      return normalized ? [normalized] : [];
    });
    const score = normalizedHints.reduce((best, hint) => Math.max(best, ...names.map((name) => {
      if (hint === name) return 100;
      if (hint.includes(name) || name.includes(hint)) return Math.min(hint.length, name.length);
      const nameWords = name.split(" ").filter((word) => word.length >= 3);
      return nameWords.filter((word) => hint.includes(word)).join("").length;
    })), 0);
    return { warehouse, score };
  }).sort((left, right) => right.score - left.score);
  if (scored[0]?.score > 3 && scored[0].score > (scored[1]?.score ?? -1)) return scored[0].warehouse;
  return warehouses.find((warehouse) => warehouse.id === fallbackId)
    ?? warehouses.find((warehouse) => warehouse.org_id !== "0")
    ?? warehouses[0]
    ?? null;
}

function orderDescription(document: Record<string, unknown>, group: PublishGroup): string {
  return truncate([
    `Nguồn: ${asString(document.original_name) ?? "tài liệu đã tải lên"}`,
    group.storeName ? `Cửa hàng: ${group.storeName}` : null,
    group.deliveryAddress ? `Giao đến: ${group.deliveryAddress}` : null
  ].filter(Boolean).join(" | "), 255);
}

function lineDescription(item: GroupableItem): string {
  const conversion = decimalOrNull(item.units_per_order_unit);
  return truncate([
    clean(item.product_name) ?? `Dòng sản phẩm ${item.line_no}`,
    clean(item.model) ? `Model ${clean(item.model)}` : null,
    conversion && !conversion.eq(1) ? `Quy đổi ${item.quantity} x ${conversion.toFixed()}` : null,
    clean(item.barcode) ? `Barcode ${clean(item.barcode)}` : null
  ].filter(Boolean).join(" | "), 255);
}

function sumAmounts(items: GroupableItem[]): string | null {
  const values = items.map((item) => item.amount).filter((value): value is string => Boolean(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0)).toFixed();
}

function sumLineValues(values: LineValues[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value.lineNetAmount), new Decimal(0));
}

function sumTaxValues(values: LineValues[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value.taxAmount), new Decimal(0));
}

function sumGrossValues(values: LineValues[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value.grossAmount), new Decimal(0));
}

function firstItemDate(items: GroupableItem[], key: "po_date" | "promised_date"): string | null {
  return items.map((item) => clean(item[key])).find((value): value is string => Boolean(value)) ?? null;
}

function withoutNullish(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined)
  );
}

function nonNegativeDecimal(value: unknown): Decimal {
  const parsed = decimalOrNull(value);
  return parsed && parsed.gte(0) ? parsed : new Decimal(0);
}

function decimalOrNull(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = new Decimal(String(value));
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function decimalOrZero(value: unknown): Decimal {
  return decimalOrNull(value) ?? new Decimal(0);
}

function numericText(value: unknown): string | null {
  return decimalOrNull(value)?.toFixed() ?? null;
}

function booleanFlag(value: unknown): "Y" | "N" | null {
  return typeof value === "boolean" ? (value ? "Y" : "N") : null;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
