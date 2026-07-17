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
  const value = (row: string[], header: string): string | null => {
    const index = headers.get(header);
    if (index === undefined) return null;
    const cell = row[index]?.normalize("NFC").trim();
    return cell || null;
  };

  const items: OcrItem[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const poNumber = value(row, "ORDER ID");
    const productName = value(row, "PRODUCT NAME");
    if (!poNumber || !productName) continue;

    items.push({
      line_no: items.length + 1,
      po_number: poNumber,
      po_date: excelDate(value(row, "ORDER DATE")),
      store_code: value(row, "STORE ID"),
      store_name: value(row, "STORE NAME"),
      delivery_address: value(row, "STORE ADDRESS"),
      product_code: value(row, "PRODUCT ID"),
      vendor_product_code: value(row, "PROVIDER PRODUCT CODE"),
      barcode: null,
      product_name: productName,
      model: null,
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
    items,
    warnings: [],
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
