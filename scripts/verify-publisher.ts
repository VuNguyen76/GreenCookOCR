import { randomUUID } from "node:crypto";
import type { OcrDocument } from "../src/shared/ocr.js";
import {
  completeDocument,
  createBatch,
  deleteDocument,
  insertDocument
} from "../src/server/db/repository.js";
import { pool } from "../src/server/db/pool.js";
import { IdempierePublisher } from "../src/server/idempiere/publisher.js";
import { ensureWebOrderSchema } from "../src/server/idempiere/web-schema.js";
import { stagingDatabase } from "../src/server/db/staging.js";
import { createSourceOnlyReconciliation } from "../src/server/services/reconciliation.js";

const poNumber = `VERIFY-${Date.now()}`;
const normalized: OcrDocument = {
  schema_version: "1.0",
  document_title: "ĐƠN ĐẶT HÀNG KIỂM THỬ",
  title_source: "document",
  template_key: "unknown",
  document_type: "purchase_order",
  issuer_name: "ĐƠN VỊ CHƯA CÓ TRONG IDEMPIERE",
  issuer_branch: null,
  po_number: poNumber,
  po_date: new Date().toISOString().slice(0, 10),
  delivery_date: null,
  currency: "VND",
  supplier_name: "NHÀ CUNG CẤP CHƯA LIÊN KẾT",
  buyer_name: null,
  delivery_address: "Địa chỉ kiểm thử",
  document_number: "DOC-VERIFY-001",
  reference_number: "REF-VERIFY-001",
  buyer_code: "BUYER-001",
  supplier_code: "SUPPLIER-001",
  buyer_tax_id: "0311111111",
  supplier_tax_id: "0312222222",
  order_contact: "Nguyễn Văn Kiểm Thử",
  contact_phone: "0900000000",
  contact_email: "verify@example.com",
  bill_to_address: "Địa chỉ thanh toán kiểm thử",
  ship_to_address: "Địa chỉ nhận hàng kiểm thử",
  warehouse_code: "HUB-VERIFY",
  warehouse_name: "Kho kiểm thử",
  department: "Thu mua",
  payment_terms: "Thanh toán 30 ngày",
  payment_method: "Chuyển khoản",
  delivery_method: "Giao tại kho",
  delivery_window: "08:00-12:00",
  price_list_name: "Bảng giá kiểm thử",
  price_includes_tax: false,
  subtotal_amount: "100000",
  discount_amount: "5000",
  charge_amount: "2000",
  freight_amount: "3000",
  tax_amount: "0",
  total_amount: "100000",
  items: [{
    line_no: 1,
    po_number: poNumber,
    po_date: new Date().toISOString().slice(0, 10),
    store_code: null,
    store_name: null,
    delivery_address: "Địa chỉ kiểm thử",
    product_code: "SP-CHUA-LIEN-KET",
    vendor_product_code: null,
    barcode: null,
    product_name: "Sản phẩm chờ bổ sung",
    model: "MODEL-CHUA-LIEN-KET",
    article_code: "ARTICLE-001",
    sku: "SKU-001",
    ou_type: "Pack",
    quantity: "2",
    free_quantity: "1",
    units_per_order_unit: "1",
    unit: "Cái",
    list_price: "55000",
    unit_price: "50000",
    discount_percent: "9.090909",
    discount_amount: "10000",
    vat_rate: "0",
    tax_amount: "0",
    amount: "100000",
    gross_amount: "100000",
    promised_date: new Date().toISOString().slice(0, 10),
    warehouse_code: "HUB-VERIFY",
    warehouse_name: "Kho kiểm thử",
    extra_fields: [{ label: "Ghi chú dòng", value: "Giữ nguyên", section: "line", page: 1 }],
    source_page: 1,
    confidence: 1
  }],
  raw_fields: [
    { label: "Người kiểm thử", value: "GreenCook", section: "header", page: 1 },
    { label: "Ngày In", value: "19 07 2026", section: "header", page: 1 },
    { label: "Giờ In", value: "08:30:00", section: "header", page: 1 },
    { label: "Loại Phiếu", value: "VERIFY", section: "header", page: 1 },
    { label: "Được Chấp Thuận Bởi", value: "TEST USER", section: "header", page: 1 },
    { label: "Mã Ngành Hàng", value: "TEST-01", section: "header", page: 1 }
  ],
  raw_tables: [],
  warnings: [],
  confidence: 1
};
const duplicateNormalized: OcrDocument = {
  ...normalized,
  issuer_name: null,
  currency: null,
  supplier_name: null,
  delivery_address: null,
  subtotal_amount: null,
  tax_amount: null,
  total_amount: null,
  items: []
};

const batchId = await createBatch(1);
const staged = await insertDocument({
  batchId,
  batchPosition: 1,
  originalName: "verify-standard-order.pdf",
  storedName: `${randomUUID()}.pdf`,
  storagePath: "D:/GreenCook/GreenCookOCR/storage/verify-standard-order.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
  sha256: randomUUID().replaceAll("-", "").padEnd(64, "0")
});
const duplicateBatchId = await createBatch(1);
const duplicateStaged = await insertDocument({
  batchId: duplicateBatchId,
  batchPosition: 1,
  originalName: "verify-standard-order-duplicate.pdf",
  storedName: `${randomUUID()}.pdf`,
  storagePath: "D:/GreenCook/GreenCookOCR/storage/verify-standard-order-duplicate.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
  sha256: randomUUID().replaceAll("-", "").padEnd(64, "0")
});

const client = await pool.connect();
try {
  await ensureWebOrderSchema(client);
  await completeDocument(
    staged.id,
    normalized,
    normalized,
    createSourceOnlyReconciliation(normalized),
    "verification",
    "greencook-document-2.0.0"
  );
  await completeDocument(
    duplicateStaged.id,
    duplicateNormalized,
    duplicateNormalized,
    createSourceOnlyReconciliation(duplicateNormalized),
    "verification",
    "greencook-document-2.0.0"
  );
  await client.query("BEGIN");
  const publisher = new IdempierePublisher();
  const orderIds = await publisher.publishDocument(staged.id, client);
  const repeatedOrderIds = await publisher.publishDocument(staged.id, client);
  if (repeatedOrderIds.join(",") !== orderIds.join(",")) {
    throw new Error("Publisher không idempotent với cùng chứng từ nguồn.");
  }
  const duplicateOrderIds = await publisher.publishDocument(duplicateStaged.id, client);
  const duplicateReused = duplicateOrderIds.join(",") === orderIds.join(",");
  if (!duplicateReused) throw new Error("Publisher không dùng lại đơn đã có cùng Số PO.");
  const result = await client.query<{
    c_order_id: string;
    poreference: string;
    docstatus: string;
    processed: string;
    partner_value: string;
    kg_document_number: string | null;
    kg_supplier_tax_id: string | null;
    kg_payment_terms: string | null;
    kg_supplier_name: string | null;
    kg_reference_number: string | null;
    kg_delivery_address: string | null;
    kg_discount_amount: string | null;
    kg_print_date: string | null;
    kg_print_time: string | null;
    kg_form_type: string | null;
    kg_approved_by: string | null;
    kg_industry_code: string | null;
    mapped_line_count: number;
    line_count: number;
    core_line_count: number;
    discarded_line_count: number;
  }>(`
    SELECT orders.c_order_id::text, orders.poreference, orders.docstatus,
           orders.processed, partner.value AS partner_value,
           orders.kg_document_number, orders.kg_supplier_tax_id,
           orders.kg_payment_terms, orders.kg_supplier_name,
           orders.kg_reference_number, orders.kg_delivery_address,
           orders.kg_discount_amount::text,
           orders.kg_print_date, orders.kg_print_time, orders.kg_form_type,
           orders.kg_approved_by, orders.kg_industry_code,
           count(lines.kg_sp_id)::int AS mapped_line_count,
           count(lines.c_orderline_id)::int AS line_count,
           count(*) FILTER (
             WHERE lines.kg_product_code = 'SP-CHUA-LIEN-KET'
               AND lines.kg_product_name IS NOT NULL
               AND lines.kg_units_per_order_unit = 1
               AND lines.kg_unit_price = 50000
               AND lines.kg_discount_amount = 10000
               AND lines.kg_vat_rate = 0
               AND lines.kg_amount = 100000
               AND lines.kg_gross_amount = 100000
               AND lines.kg_warehouse_code = 'HUB-VERIFY'
               AND lines.kg_source_page = 1
           )::int AS core_line_count,
           count(*) FILTER (
             WHERE lines.kg_article_code IS NOT NULL
                OR lines.kg_sku IS NOT NULL
                OR lines.kg_free_quantity IS NOT NULL
                OR lines.kg_extra_fields IS NOT NULL
           )::int AS discarded_line_count
    FROM adempiere.c_order orders
    JOIN adempiere.c_orderline lines ON lines.c_order_id = orders.c_order_id
    JOIN adempiere.c_bpartner partner ON partner.c_bpartner_id = orders.c_bpartner_id
    WHERE orders.c_order_id = ANY($1::numeric[])
    GROUP BY orders.c_order_id, orders.poreference, orders.docstatus,
             orders.processed, partner.value, orders.kg_document_number,
             orders.kg_supplier_tax_id, orders.kg_payment_terms,
             orders.kg_supplier_name, orders.kg_reference_number,
             orders.kg_delivery_address, orders.kg_discount_amount, orders.kg_print_date,
             orders.kg_print_time, orders.kg_form_type,
             orders.kg_approved_by, orders.kg_industry_code
  `, [orderIds]);
  const order = result.rows[0];
  if (!order || order.poreference !== poNumber || order.docstatus !== "DR"
    || order.processed !== "N" || order.partner_value !== "OCR_PENDING"
    || order.kg_document_number !== null
    || order.kg_supplier_tax_id !== null
    || order.kg_payment_terms !== null
    || order.kg_supplier_name !== normalized.supplier_name
    || order.kg_reference_number !== normalized.reference_number
    || order.kg_delivery_address !== normalized.delivery_address
    || Number(order.kg_discount_amount) !== 5000
    || order.kg_print_date !== "19 07 2026"
    || order.kg_print_time !== "08:30:00"
    || order.kg_form_type !== "VERIFY"
    || order.kg_approved_by !== "TEST USER"
    || order.kg_industry_code !== "TEST-01"
    || order.mapped_line_count !== 0 || order.line_count !== 1
    || order.core_line_count !== 1 || order.discarded_line_count !== 0) {
    throw new Error("Draft C_Order/C_OrderLine kiểm thử không đúng hợp đồng.");
  }

  const deletedLines = await client.query(`
    DELETE FROM adempiere.c_orderline
    WHERE c_order_id = ANY($1::numeric[])
    RETURNING c_orderline_id
  `, [orderIds]);
  const deletedOrders = await client.query(`
    DELETE FROM adempiere.c_order
    WHERE c_order_id = ANY($1::numeric[])
    RETURNING c_order_id
  `, [orderIds]);
  if (deletedLines.rowCount !== order.line_count || deletedOrders.rowCount !== orderIds.length) {
    throw new Error("Không thể xóa đầy đủ đơn kiểm thử và các dòng sản phẩm.");
  }
  await client.query("ROLLBACK");

  const residual = await client.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM adempiere.c_order
    WHERE kg_source_document_id = $1
  `, [staged.id]);
  if (Number(residual.rows[0]?.count ?? 0) !== 0) {
    throw new Error("Giao dịch kiểm thử còn để lại C_Order.");
  }
  console.log(JSON.stringify({
    ok: true,
    poNumber,
    orderCount: orderIds.length,
    lineCount: order.line_count,
    pendingPartner: order.partner_value,
    unmappedLinesAccepted: order.mapped_line_count === 0,
    structuredHeaderFieldsStored: true,
    structuredLineFieldsStored: order.core_line_count === 1,
    idempotentRetry: true,
    duplicateReused,
    deleteVerified: true,
    residualOrderCount: 0
  }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await deleteDocument(staged.id);
  await deleteDocument(duplicateStaged.id);
  client.release();
  await pool.end();
  stagingDatabase.close();
}
