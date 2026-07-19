import path from "node:path";
import { OcrDocumentSchema, type OcrDocument, type OcrItem } from "../../shared/ocr.js";

const DMX_REQUIRED_HEADERS = [
  "ORDER ID",
  "ORDER DATE",
  "STORE ID",
  "STORE NAME",
  "STORE ADDRESS",
  "PROVIDER PRODUCT CODE",
  "PRODUCT ID",
  "PRODUCT NAME",
  "QUANTITY",
  "PRICE"
] as const;

export function extractStructuredSpreadsheet(text: string, originalName: string): OcrDocument | null {
  if (path.extname(originalName).toLowerCase() !== ".xlsx") return null;

  const rows = text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("### SHEET:"))
    .map((line) => line.split("\t").slice(1));
  const headerIndex = rows.findIndex((row) => DMX_REQUIRED_HEADERS.every((header) => row.includes(header)));
  if (headerIndex < 0) return null;

  const headers = new Map(rows[headerIndex].map((header, index) => [header.trim().toUpperCase(), index]));
  const tableHeaders = rows[headerIndex].map((header) => header.normalize("NFC").trim());
  const value = (row: string[], header: string): string | null => {
    const index = headers.get(header);
    if (index === undefined) return null;
    const cell = row[index]?.normalize("NFC").trim();
    return cell || null;
  };

  const items: OcrItem[] = [];
  let orderContext: {
    poNumber: string | null;
    poDate: string | null;
    storeCode: string | null;
    storeName: string | null;
    deliveryAddress: string | null;
  } = {
    poNumber: null,
    poDate: null,
    storeCode: null,
    storeName: null,
    deliveryAddress: null
  };
  for (const row of rows.slice(headerIndex + 1)) {
    const rowPoNumber = value(row, "ORDER ID");
    const rowPoDate = excelDate(value(row, "ORDER DATE"));
    const rowStoreCode = value(row, "STORE ID");
    const rowStoreName = value(row, "STORE NAME");
    const rowDeliveryAddress = value(row, "STORE ADDRESS");
    if (rowPoNumber || rowPoDate || rowStoreCode || rowStoreName || rowDeliveryAddress) {
      orderContext = {
        poNumber: rowPoNumber ?? orderContext.poNumber,
        poDate: rowPoDate ?? orderContext.poDate,
        storeCode: rowStoreCode ?? orderContext.storeCode,
        storeName: rowStoreName ?? orderContext.storeName,
        deliveryAddress: rowDeliveryAddress ?? orderContext.deliveryAddress
      };
    }

    const productCode = value(row, "PRODUCT ID");
    const vendorProductCode = value(row, "PROVIDER PRODUCT CODE");
    const productName = value(row, "PRODUCT NAME");
    if (!productCode && !vendorProductCode && !productName) continue;

    items.push({
      line_no: items.length + 1,
      po_number: rowPoNumber ?? orderContext.poNumber,
      po_date: rowPoDate ?? orderContext.poDate,
      store_code: rowStoreCode ?? orderContext.storeCode,
      store_name: rowStoreName ?? orderContext.storeName,
      delivery_address: rowDeliveryAddress ?? orderContext.deliveryAddress,
      product_code: productCode,
      vendor_product_code: vendorProductCode,
      barcode: null,
      product_name: productName,
      model: null,
      extra_fields: tableHeaders.flatMap((header, index) => {
        const normalizedHeader = header.toUpperCase();
        if (!header || DMX_REQUIRED_HEADERS.includes(normalizedHeader as typeof DMX_REQUIRED_HEADERS[number])) {
          return [];
        }
        const cell = row[index]?.normalize("NFC").trim();
        return cell ? [{ label: header, value: cell, section: "Dòng sản phẩm", page: null }] : [];
      }),
      quantity: numericText(value(row, "QUANTITY")),
      units_per_order_unit: null,
      unit: null,
      unit_price: numericText(value(row, "PRICE")),
      vat_rate: null,
      amount: null,
      source_page: null,
      confidence: 1
    });
  }
  if (!items.length) return null;

  const dates = new Set(items.map((item) => item.po_date).filter((date): date is string => Boolean(date)));
  const orderIds = new Set(items.map((item) => item.po_number).filter(Boolean));
  const warnings = items.some((item) => !item.po_number)
    ? ["Có dòng sản phẩm chưa đọc được Số PO; dữ liệu dòng vẫn được giữ lại."]
    : [];
  return OcrDocumentSchema.parse({
    schema_version: "1.0",
    document_title: "DMX Excel Order Export",
    title_source: "inferred",
    template_key: "po_dmx_excel_order_export",
    document_type: "purchase_order",
    issuer_name: "Điện Máy Xanh",
    issuer_branch: null,
    po_number: orderIds.size === 1 ? items[0].po_number : null,
    po_date: dates.size === 1 ? [...dates][0] : null,
    delivery_date: null,
    currency: "VND",
    supplier_name: null,
    buyer_name: null,
    delivery_address: null,
    subtotal_amount: null,
    tax_amount: null,
    total_amount: null,
    raw_fields: [],
    raw_tables: [{
      title: "DMX Excel Order Export",
      page: null,
      headers: tableHeaders,
      rows: rows.slice(headerIndex + 1).flatMap((row) => row.some((cell) => cell?.trim())
        ? [tableHeaders.map((_, index) => row[index]?.normalize("NFC").trim() ?? "")]
        : [])
    }],
    items,
    warnings,
    confidence: 1
  });
}

function numericText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, "");
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function excelDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1) return null;
  // DMX exports store these serials one day ahead of the date rendered in Excel.
  const date = new Date(Math.round((Math.floor(serial) - 25_570) * 86_400_000));
  return date.toISOString().slice(0, 10);
}
