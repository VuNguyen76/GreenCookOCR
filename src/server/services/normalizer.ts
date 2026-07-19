import Decimal from "decimal.js";
import type { OcrDocument, OcrItem } from "../../shared/ocr.js";
import { OcrDocumentSchema } from "../../shared/ocr.js";
import { localizeOcrWarning } from "../../shared/warning-messages.js";

export function normalizeOcrResult(raw: unknown): OcrDocument {
  const parsed = OcrDocumentSchema.parse(raw);
  const warnings = new Set(parsed.warnings.flatMap((warning) => {
    const cleaned = localizeOcrWarning(warning);
    return cleaned ? [cleaned] : [];
  }));
  const seenLines = new Set<number>();

  const items = parsed.items.map((source, index) => {
    const item = normalizeItem(source, index + 1);
    while (seenLines.has(item.line_no)) item.line_no += 1;
    seenLines.add(item.line_no);

    applyTemplateRules(parsed.template_key, item, source);
    completeItemAmounts(parsed.template_key, item, warnings);
    item.confidence = calibratedItemConfidence(item, source.confidence, parsed.template_key);
    if (item.barcode && !isLikelyBarcode(item.barcode)) {
      warnings.add(`Barcode cần kiểm tra ở dòng ${item.line_no}: ${item.barcode}`);
    }
    if (!item.product_name && !item.product_code && !item.barcode) {
      warnings.add(`Dòng ${item.line_no} không có khóa nhận diện sản phẩm`);
    }
    return item;
  });

  if (parsed.template_key === "po_dmx_excel_order_export" && hasCompleteRowPoData(items)) {
    for (const warning of warnings) {
      if (isExpectedDmxExportNotice(warning)) warnings.delete(warning);
    }
  }
  if (parsed.template_key === "po_dmx_pdf_customer_manual") {
    for (const warning of warnings) {
      if (isIncorrectDmxProductIdNotice(warning)) warnings.delete(warning);
    }
  }

  const derivedSubtotal = sumItemAmounts(items);
  let subtotalAmount = normalizeNumeric(parsed.subtotal_amount);
  const printedTaxAmount = normalizeNumeric(parsed.tax_amount);
  let taxAmount = printedTaxAmount;
  let totalAmount = normalizeNumeric(parsed.total_amount);

  if (parsed.template_key === "po_dmx_pdf_customer_manual") {
    const derivedBeforeTax = sumItemAmountsBeforeVat(items);
    if (derivedBeforeTax) subtotalAmount = derivedBeforeTax;
    if (!totalAmount && derivedSubtotal) totalAmount = derivedSubtotal;
    if (totalAmount && derivedSubtotal && decimalsDiffer(totalAmount, derivedSubtotal)) {
      warnings.add(`Tổng Cost các dòng (${derivedSubtotal}) lệch tổng thanh toán trên chứng từ (${totalAmount})`);
    }
    if (subtotalAmount && totalAmount) {
      const derivedTax = new Decimal(totalAmount).minus(subtotalAmount);
      if (derivedTax.greaterThanOrEqualTo(0)) taxAmount = decimalText(derivedTax);
    }
  } else {
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
      if (parsed.template_key !== "po_dmx_excel_order_export") {
        warnings.add("Tổng đơn hàng được tính từ các dòng sản phẩm vì chứng từ không có tổng thanh toán rõ ràng");
      }
    }
  }

  fillUniformVatRates(items, subtotalAmount, printedTaxAmount);

  const buyerName = cleanNullable(parsed.buyer_name);
  const issuerName = cleanNullable(parsed.issuer_name)
    ?? (parsed.template_key === "po_bigc_go_purchase_note" ? buyerName : null);
  const documentTitle = cleanText(parsed.document_title) || "Không xác định";
  const poNumber = cleanIdentifier(parsed.po_number);
  const poDate = normalizeDate(parsed.po_date);
  const deliveryDate = normalizeDate(parsed.delivery_date);
  const confidence = calibratedDocumentConfidence({
    source: parsed,
    items,
    documentTitle,
    issuerName,
    poNumber,
    poDate,
    deliveryDate,
    subtotalAmount,
    taxAmount,
    totalAmount
  });

  return {
    ...parsed,
    document_title: documentTitle,
    issuer_name: issuerName,
    issuer_branch: cleanNullable(parsed.issuer_branch),
    po_number: poNumber,
    po_date: poDate,
    delivery_date: deliveryDate,
    currency: cleanNullable(parsed.currency)?.toUpperCase() ?? null,
    supplier_name: cleanNullable(parsed.supplier_name),
    buyer_name: buyerName,
    delivery_address: cleanNullable(parsed.delivery_address),
    document_number: cleanIdentifier(parsed.document_number ?? null),
    reference_number: cleanIdentifier(parsed.reference_number ?? null),
    buyer_code: cleanIdentifier(parsed.buyer_code ?? null),
    supplier_code: cleanIdentifier(parsed.supplier_code ?? null),
    buyer_tax_id: cleanIdentifier(parsed.buyer_tax_id ?? null),
    supplier_tax_id: cleanIdentifier(parsed.supplier_tax_id ?? null),
    order_contact: cleanNullable(parsed.order_contact ?? null),
    contact_phone: cleanNullable(parsed.contact_phone ?? null),
    contact_email: cleanNullable(parsed.contact_email ?? null),
    bill_to_address: cleanNullable(parsed.bill_to_address ?? null),
    ship_to_address: cleanNullable(parsed.ship_to_address ?? null),
    warehouse_code: cleanIdentifier(parsed.warehouse_code ?? null),
    warehouse_name: cleanNullable(parsed.warehouse_name ?? null),
    department: cleanNullable(parsed.department ?? null),
    payment_terms: cleanNullable(parsed.payment_terms ?? null),
    payment_method: cleanNullable(parsed.payment_method ?? null),
    delivery_method: cleanNullable(parsed.delivery_method ?? null),
    delivery_window: cleanNullable(parsed.delivery_window ?? null),
    price_list_name: cleanNullable(parsed.price_list_name ?? null),
    price_includes_tax: parsed.price_includes_tax ?? null,
    subtotal_amount: subtotalAmount,
    discount_amount: normalizeNumeric(parsed.discount_amount ?? null),
    charge_amount: normalizeNumeric(parsed.charge_amount ?? null),
    freight_amount: normalizeNumeric(parsed.freight_amount ?? null),
    tax_amount: taxAmount,
    total_amount: totalAmount,
    raw_fields: parsed.raw_fields ?? [],
    raw_tables: parsed.raw_tables ?? [],
    items,
    warnings: [...warnings],
    confidence
  };
}

function normalizeItem(source: OcrItem, fallbackLine: number): OcrItem {
  return {
    ...source,
    line_no: source.line_no > 0 ? source.line_no : fallbackLine,
    po_number: cleanIdentifier(source.po_number),
    po_date: normalizeDate(source.po_date),
    store_code: cleanIdentifier(source.store_code),
    store_name: cleanNullable(source.store_name),
    delivery_address: cleanNullable(source.delivery_address),
    product_code: cleanIdentifier(source.product_code),
    vendor_product_code: cleanIdentifier(source.vendor_product_code),
    barcode: normalizeBarcode(source.barcode),
    product_name: cleanProductName(source.product_name),
    model: cleanIdentifier(source.model),
    article_code: cleanIdentifier(source.article_code ?? null),
    sku: cleanIdentifier(source.sku ?? null),
    ou_type: cleanNullable(source.ou_type ?? null),
    quantity: normalizeNumeric(source.quantity),
    free_quantity: normalizeNumeric(source.free_quantity ?? null),
    units_per_order_unit: normalizeNumeric(source.units_per_order_unit),
    unit: cleanNullable(source.unit)?.toUpperCase() ?? null,
    list_price: normalizeNumeric(source.list_price ?? null),
    unit_price: normalizeNumeric(source.unit_price),
    discount_percent: normalizeNumeric(source.discount_percent ?? null),
    discount_amount: normalizeNumeric(source.discount_amount ?? null),
    vat_rate: normalizeNumeric(source.vat_rate),
    tax_amount: normalizeNumeric(source.tax_amount ?? null),
    amount: normalizeNumeric(source.amount),
    gross_amount: normalizeNumeric(source.gross_amount ?? null),
    promised_date: normalizeDate(source.promised_date ?? null),
    warehouse_code: cleanIdentifier(source.warehouse_code ?? null),
    warehouse_name: cleanNullable(source.warehouse_name ?? null),
    extra_fields: source.extra_fields ?? [],
    confidence: Math.max(0, Math.min(1, source.confidence))
  };
}

function completeItemAmounts(
  template: OcrDocument["template_key"],
  item: OcrItem,
  warnings: Set<string>
): void {
  if (!item.quantity) return;
  const multiplier = new Decimal(item.quantity).times(item.units_per_order_unit ?? "1");
  if (multiplier.isZero()) return;
  const priceMultiplier = template === "po_dmx_pdf_customer_manual" && item.vat_rate
    ? new Decimal(1).plus(new Decimal(item.vat_rate).dividedBy(100))
    : new Decimal(1);
  const amountMultiplier = multiplier.times(priceMultiplier);

  if (!item.amount && item.unit_price) {
    item.amount = decimalText(amountMultiplier.times(item.unit_price));
  } else if (!item.unit_price && item.amount) {
    item.unit_price = decimalText(new Decimal(item.amount).dividedBy(amountMultiplier));
  } else if (item.unit_price && item.amount) {
    const calculated = decimalText(amountMultiplier.times(item.unit_price));
    if (decimalsDiffer(calculated, item.amount)) {
      const formula = template === "po_dmx_pdf_customer_manual"
        ? "số lượng × đơn giá × (1 + VAT)"
        : "số lượng × quy đổi × đơn giá";
      warnings.add(`Thành tiền dòng ${item.line_no} (${item.amount}) không khớp ${formula} (${calculated})`);
    }
  }
}

function calibratedItemConfidence(
  item: OcrItem,
  modelConfidence: number,
  template: OcrDocument["template_key"]
): number {
  let validationScore = 0;
  const hasIdentifier = Boolean(
    (item.barcode && isLikelyBarcode(item.barcode))
    || item.product_code
    || item.vendor_product_code
  );
  if (hasIdentifier) validationScore += 0.25;
  if (item.product_name) validationScore += 0.15;
  if (isPositiveNumber(item.quantity)) validationScore += 0.1;
  if (item.unit) validationScore += 0.05;
  if (isNonNegativeNumber(item.unit_price)) validationScore += 0.1;
  if (isNonNegativeNumber(item.amount)) validationScore += 0.1;
  if (itemAmountsMatch(item, template)) validationScore += 0.2;
  if (item.source_page) validationScore += 0.05;

  const boundedModelConfidence = Math.max(0, Math.min(1, modelConfidence));
  return roundConfidence(boundedModelConfidence * 0.1 + validationScore * 0.9);
}

function calibratedDocumentConfidence(input: {
  source: OcrDocument;
  items: OcrItem[];
  documentTitle: string;
  issuerName: string | null;
  poNumber: string | null;
  poDate: string | null;
  deliveryDate: string | null;
  subtotalAmount: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
}): number {
  let validationScore = 0;
  if (input.source.template_key !== "unknown") validationScore += 0.1;
  if (input.documentTitle && input.documentTitle !== "Không xác định") validationScore += 0.05;
  if (input.poNumber || hasCompleteRowPoData(input.items)) validationScore += 0.15;
  if (input.poDate) validationScore += 0.1;
  if (input.deliveryDate) validationScore += 0.05;
  if (input.issuerName) validationScore += 0.05;
  if (input.items.length > 0) {
    validationScore += 0.1;
    const averageItemConfidence = input.items.reduce((sum, item) => sum + item.confidence, 0)
      / input.items.length;
    validationScore += averageItemConfidence * 0.25;
  }
  if (input.subtotalAmount) validationScore += 0.05;
  if (input.totalAmount) validationScore += 0.05;
  if (documentTotalsMatch(input.subtotalAmount, input.taxAmount, input.totalAmount)) {
    validationScore += 0.05;
  }

  return roundConfidence(input.source.confidence * 0.1 + validationScore * 0.9);
}

function documentTotalsMatch(
  subtotalAmount: string | null,
  taxAmount: string | null,
  totalAmount: string | null
): boolean {
  if (!subtotalAmount || !totalAmount) return false;
  const expected = new Decimal(subtotalAmount).plus(taxAmount ?? "0");
  return !decimalsDiffer(decimalText(expected), totalAmount);
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function itemAmountsMatch(item: OcrItem, template: OcrDocument["template_key"]): boolean {
  if (!item.quantity || !item.unit_price || !item.amount) return false;
  let expected = new Decimal(item.quantity)
    .times(item.units_per_order_unit ?? "1")
    .times(item.unit_price);
  if (template === "po_dmx_pdf_customer_manual" && item.vat_rate) {
    expected = expected.times(new Decimal(1).plus(new Decimal(item.vat_rate).dividedBy(100)));
  }
  return !decimalsDiffer(decimalText(expected), item.amount);
}

function isPositiveNumber(value: string | null): boolean {
  return Boolean(value && new Decimal(value).greaterThan(0));
}

function isNonNegativeNumber(value: string | null): boolean {
  return Boolean(value && new Decimal(value).greaterThanOrEqualTo(0));
}

function sumItemAmounts(items: OcrItem[]): string | null {
  if (!items.length || items.some((item) => !item.amount)) return null;
  return decimalText(items.reduce((sum, item) => sum.plus(item.amount!), new Decimal(0)));
}

function sumItemAmountsBeforeVat(items: OcrItem[]): string | null {
  if (!items.length || items.some((item) => !item.quantity || !item.unit_price)) return null;
  const total = items.reduce((sum, item) => sum.plus(
    new Decimal(item.quantity!)
      .times(item.units_per_order_unit ?? "1")
      .times(item.unit_price!)
  ), new Decimal(0));
  return decimalText(total);
}

function fillUniformVatRates(
  items: OcrItem[],
  subtotalAmount: string | null,
  printedTaxAmount: string | null
): void {
  if (!items.length || subtotalAmount === null || printedTaxAmount === null) return;
  const subtotal = new Decimal(subtotalAmount);
  if (subtotal.lessThanOrEqualTo(0)) return;

  const supportedRates = [0, 5, 8, 10];
  const rate = supportedRates.find((candidate) => {
    const expectedTax = subtotal.times(candidate).dividedBy(100);
    return expectedTax.minus(printedTaxAmount).abs().lessThanOrEqualTo(1);
  });
  if (rate === undefined) return;

  const existingRates = new Set(items
    .map((item) => item.vat_rate)
    .filter((value): value is string => value !== null));
  if ([...existingRates].some((value) => new Decimal(value).minus(rate).abs().greaterThan(0.0001))) {
    return;
  }
  for (const item of items) item.vat_rate ??= String(rate);
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
  if (
    template === "po_dmx_pdf_customer_manual"
    && item.barcode
    && item.product_code
    && normalizeBarcode(item.product_code) === item.barcode
  ) {
    item.barcode = null;
  }
  if (
    template === "po_dmx_excel_order_export"
    && item.barcode
    && (!item.vendor_product_code || item.barcode === item.vendor_product_code)
  ) {
    item.vendor_product_code ??= item.barcode;
    item.barcode = null;
  }
  const rawMenaCode = cleanIdentifier(source.barcode);
  if (template === "po_mena_gourmet_purchase_order" && !item.product_code && rawMenaCode && /^M/i.test(rawMenaCode)) {
    item.product_code = rawMenaCode;
    item.barcode = null;
  }
}

function hasCompleteRowPoData(items: OcrItem[]): boolean {
  if (!items.length || items.some((item) => !item.po_number)) return false;
  return new Set(items.map((item) => item.po_number)).size > 1;
}

function isExpectedDmxExportNotice(warning: string): boolean {
  return /multiple\s+po\s+numbers?/i.test(warning)
    || /line\s+item\s+amounts?\s+were\s+calculated/i.test(warning)
    || /total\s+fields?.*(?:set\s+to\s+null|not\s+present)/i.test(warning);
}

function isIncorrectDmxProductIdNotice(warning: string): boolean {
  return /product\s+ids?.*check\s+digits?.*barcode/i.test(warning);
}

function cleanText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function cleanNullable(value: string | null): string | null {
  if (value === null) return null;
  return cleanText(value) || null;
}

function cleanProductName(value: string | null): string | null {
  const cleaned = cleanNullable(value);
  if (!cleaned) return null;
  return cleaned
    .replace(/^pack\s+/i, "")
    .replace(/\s+pack$/i, "")
    .trim() || null;
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
  if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return decimalText(new Decimal(cleaned));
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
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? decimalText(new Decimal(cleaned)) : null;
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
  if (!/^\d{8}$|^\d{12,14}$/.test(value)) return false;
  return hasValidGs1CheckDigit(value);
}

function hasValidGs1CheckDigit(value: string): boolean {
  const digits = [...value].map(Number);
  const checkDigit = digits.pop();
  if (checkDigit === undefined) return false;
  let sum = 0;
  for (let index = digits.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += digits[index] * weight;
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}
