import Decimal from "decimal.js";
import type { OcrDocument, OcrItem } from "../../shared/ocr.js";
import { OcrDocumentSchema } from "../../shared/ocr.js";

export function normalizeOcrResult(raw: unknown): OcrDocument {
  const parsed = OcrDocumentSchema.parse(raw);
  const warnings = new Set(parsed.warnings.map(cleanText).filter(Boolean));
  const seenLines = new Set<number>();

  const items = parsed.items.map((source, index) => {
    const item = normalizeItem(source, index + 1);
    while (seenLines.has(item.line_no)) item.line_no += 1;
    seenLines.add(item.line_no);

    applyTemplateRules(parsed.template_key, item, source);
    completeItemAmounts(item, warnings);
    if (item.barcode && !isLikelyBarcode(item.barcode)) {
      warnings.add(`Barcode cần kiểm tra ở dòng ${item.line_no}: ${item.barcode}`);
    }
    if (!item.product_name && !item.product_code && !item.barcode) {
      warnings.add(`Dòng ${item.line_no} không có khóa nhận diện sản phẩm`);
    }
    return item;
  });

  const derivedSubtotal = sumItemAmounts(items);
  let subtotalAmount = normalizeNumeric(parsed.subtotal_amount);
  let taxAmount = normalizeNumeric(parsed.tax_amount);
  let totalAmount = normalizeNumeric(parsed.total_amount);

  if (!subtotalAmount && derivedSubtotal) subtotalAmount = derivedSubtotal;
  if (subtotalAmount && derivedSubtotal && decimalsDiffer(subtotalAmount, derivedSubtotal)) {
    warnings.add(`Tổng thành tiền các dòng (${derivedSubtotal}) lệch tổng tiền hàng trên chứng từ (${subtotalAmount})`);
  }
  if (!taxAmount && subtotalAmount && totalAmount) {
    const derivedTax = new Decimal(totalAmount).minus(subtotalAmount);
    if (derivedTax.greaterThanOrEqualTo(0)) taxAmount = decimalText(derivedTax);
  }
  if (!totalAmount && subtotalAmount) {
    totalAmount = taxAmount
      ? decimalText(new Decimal(subtotalAmount).plus(taxAmount))
      : subtotalAmount;
    warnings.add("Tổng đơn hàng được tính từ các dòng sản phẩm vì chứng từ không có tổng thanh toán rõ ràng");
  }

  return {
    ...parsed,
    document_title: cleanText(parsed.document_title) || "Không xác định",
    issuer_name: cleanNullable(parsed.issuer_name),
    issuer_branch: cleanNullable(parsed.issuer_branch),
    po_number: cleanIdentifier(parsed.po_number),
    po_date: normalizeDate(parsed.po_date),
    delivery_date: normalizeDate(parsed.delivery_date),
    currency: cleanNullable(parsed.currency)?.toUpperCase() ?? null,
    supplier_name: cleanNullable(parsed.supplier_name),
    buyer_name: cleanNullable(parsed.buyer_name),
    delivery_address: cleanNullable(parsed.delivery_address),
    subtotal_amount: subtotalAmount,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    items,
    warnings: [...warnings]
  };
}

function normalizeItem(source: OcrItem, fallbackLine: number): OcrItem {
  return {
    ...source,
    line_no: source.line_no > 0 ? source.line_no : fallbackLine,
    product_code: cleanIdentifier(source.product_code),
    vendor_product_code: cleanIdentifier(source.vendor_product_code),
    barcode: normalizeBarcode(source.barcode),
    product_name: cleanNullable(source.product_name),
    model: cleanIdentifier(source.model),
    quantity: normalizeNumeric(source.quantity),
    units_per_order_unit: normalizeNumeric(source.units_per_order_unit),
    unit: cleanNullable(source.unit)?.toUpperCase() ?? null,
    unit_price: normalizeNumeric(source.unit_price),
    vat_rate: normalizeNumeric(source.vat_rate),
    amount: normalizeNumeric(source.amount),
    confidence: Math.max(0, Math.min(1, source.confidence))
  };
}

function completeItemAmounts(item: OcrItem, warnings: Set<string>): void {
  if (!item.quantity) return;
  const multiplier = new Decimal(item.quantity).times(item.units_per_order_unit ?? "1");
  if (multiplier.isZero()) return;

  if (!item.amount && item.unit_price) {
    item.amount = decimalText(multiplier.times(item.unit_price));
  } else if (!item.unit_price && item.amount) {
    item.unit_price = decimalText(new Decimal(item.amount).dividedBy(multiplier));
  } else if (item.unit_price && item.amount) {
    const calculated = decimalText(multiplier.times(item.unit_price));
    if (decimalsDiffer(calculated, item.amount)) {
      warnings.add(`Thành tiền dòng ${item.line_no} (${item.amount}) không khớp số lượng × quy đổi × đơn giá (${calculated})`);
    }
  }
}

function sumItemAmounts(items: OcrItem[]): string | null {
  if (!items.length || items.some((item) => !item.amount)) return null;
  return decimalText(items.reduce((sum, item) => sum.plus(item.amount!), new Decimal(0)));
}

function decimalsDiffer(left: string, right: string): boolean {
  return new Decimal(left).minus(right).abs().greaterThan(1);
}

function decimalText(value: Decimal): string {
  return value.toDecimalPlaces(6).toFixed().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function applyTemplateRules(template: OcrDocument["template_key"], item: OcrItem, source: OcrItem): void {
  if (template === "po_bigc_go_purchase_note" && !item.barcode && item.product_code) {
    const digits = normalizeBarcode(item.product_code);
    if (digits && [8, 12, 13, 14].includes(digits.length)) {
      item.barcode = digits;
      item.product_code = null;
    }
  }
  if (template === "po_dmx_pdf_customer_manual" && !item.vendor_product_code && item.barcode) {
    item.vendor_product_code = item.barcode;
    item.barcode = null;
  }
  const rawMenaCode = cleanIdentifier(source.barcode);
  if (template === "po_mena_gourmet_purchase_order" && !item.product_code && rawMenaCode && /^M/i.test(rawMenaCode)) {
    item.product_code = rawMenaCode;
    item.barcode = null;
  }
}

function cleanText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function cleanNullable(value: string | null): string | null {
  if (value === null) return null;
  return cleanText(value) || null;
}

function cleanIdentifier(value: string | null): string | null {
  const cleaned = cleanNullable(value);
  return cleaned?.replace(/\s+/g, "") ?? null;
}

function normalizeBarcode(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return digits || cleanIdentifier(value);
}

function normalizeNumeric(value: string | null): string | null {
  if (!value) return null;
  let cleaned = value.trim().replace(/\s+/g, "");
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return cleaned;
  if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(cleaned)) {
    return cleaned.replace(/[.,]/g, "");
  }
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const decimalMark = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousandsMark = decimalMark === "," ? "." : ",";
    cleaned = cleaned.replaceAll(thousandsMark, "").replace(decimalMark, ".");
  } else {
    cleaned = cleaned.replace(",", ".");
  }
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const match = cleaned.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function isLikelyBarcode(value: string): boolean {
  return /^\d{8}$|^\d{12,14}$/.test(value);
}
