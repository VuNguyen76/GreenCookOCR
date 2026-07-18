export function localizeOcrWarning(warning: string): string | null {
  const cleaned = warning.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  if (/^total_amount is calculated as subtotal_amount \+ tax_amount because the grand total after tax was not explicitly printed on the document\.?$/i.test(cleaned)) {
    return "Tổng đơn hàng được tính bằng tiền hàng cộng thuế vì chứng từ không in rõ tổng thanh toán sau thuế.";
  }
  if (/^no price or amount values are specified in this delivery request document\.?$/i.test(cleaned)) {
    return "Chứng từ đề nghị giao hàng không ghi đơn giá hoặc thành tiền.";
  }
  if (/^document id is\s+\S+\.?$/i.test(cleaned)) return null;

  if (
    /^amount on item is post-?vat,? while unit_price is pre-?vat\.?$/i.test(cleaned)
    || /^unit price is before vat,? but the line amount includes vat\.?$/i.test(cleaned)
  ) {
    return "Thành tiền của dòng sản phẩm đã gồm VAT, còn đơn giá là giá trước VAT.";
  }
  if (/^document date \(po_date\) is blank on the document, so it is set to null\.?$/i.test(cleaned)) {
    return "Ngày chứng từ (ngày PO) để trống nên không thể ghi nhận.";
  }

  const referenceMatch = cleaned.match(
    /^document reference number is (\S+), order number (\S+) is used for po_number\.?$/i
  );
  if (referenceMatch) {
    return `Số tham chiếu chứng từ là ${referenceMatch[1]}; sử dụng số đơn hàng ${referenceMatch[2]} làm số PO.`;
  }

  const itemPriceMatch = cleaned.match(
    /^for items? (.+?), amount matches quantity \* units_per_order_unit \* unit_price, reflecting price per individual piece \([^)]+\) rather than per pack\.?$/i
  );
  if (itemPriceMatch) {
    const localizedLines = itemPriceMatch[1].replace(/\s+and\s+/gi, " và ");
    return `Ở dòng ${localizedLines}, thành tiền khớp số lượng × quy đổi × đơn giá; đơn giá được tính theo từng cái thay vì theo gói.`;
  }

  if (/^no unit prices or total amounts found on the document\.?$/i.test(cleaned)) {
    return "Chứng từ không ghi đơn giá hoặc tổng tiền.";
  }
  if (/^pricing\/amount columns are not present in this document template, so financial totals are set to null\.?$/i.test(cleaned)) {
    return "Mẫu chứng từ không có cột đơn giá hoặc thành tiền nên các tổng tiền được để trống.";
  }
  if (/^total after tax \(total_amount\) is not explicitly printed on the document\.?$/i.test(cleaned)) {
    return "Chứng từ không in rõ tổng tiền sau thuế.";
  }

  return cleaned;
}
