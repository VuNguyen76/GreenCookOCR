import { describe, expect, it } from "vitest";
import { normalizeOcrResult } from "./normalizer.js";

const base = {
  schema_version: "1.0" as const,
  document_title: "  PURCHASE   NOTE ",
  title_source: "document" as const,
  template_key: "po_bigc_go_purchase_note" as const,
  document_type: "purchase_order" as const,
  issuer_name: "Big C",
  issuer_branch: null,
  po_number: " 2610 0545 ",
  po_date: "10/03/2026",
  delivery_date: null,
  currency: "vnd",
  supplier_name: "GREEN COOK",
  buyer_name: null,
  delivery_address: null,
  subtotal_amount: null,
  tax_amount: null,
  total_amount: null,
  items: [],
  warnings: [],
  confidence: 0.95
};

describe("normalizeOcrResult", () => {
  it("normalizes text, identifiers and Vietnamese dates", () => {
    const result = normalizeOcrResult(base);
    expect(result.document_title).toBe("PURCHASE NOTE");
    expect(result.po_number).toBe("26100545");
    expect(result.po_date).toBe("2026-03-10");
    expect(result.currency).toBe("VND");
  });

  it("translates an inferred grand-total warning to Vietnamese", () => {
    const result = normalizeOcrResult({
      ...base,
      subtotal_amount: "100",
      tax_amount: "8",
      total_amount: "108",
      warnings: ["total_amount is calculated as subtotal_amount + tax_amount because the grand total after tax was not explicitly printed on the document."]
    });

    expect(result.warnings).toEqual([
      "Tổng đơn hàng được tính bằng tiền hàng cộng thuế vì chứng từ không in rõ tổng thanh toán sau thuế."
    ]);
  });

  it("translates delivery-request price warnings and drops duplicated document-id notes", () => {
    const result = normalizeOcrResult({
      ...base,
      template_key: "po_nguyenkim_delivery_request",
      document_type: "delivery_request",
      warnings: [
        "No price or amount values are specified in this Delivery Request document.",
        "Document ID is 4801100916"
      ]
    });

    expect(result.warnings).toEqual([
      "Chứng từ đề nghị giao hàng không ghi đơn giá hoặc thành tiền."
    ]);
  });

  it("translates VAT price-basis notes to Vietnamese", () => {
    const result = normalizeOcrResult({
      ...base,
      warnings: [
        "Amount on item is post-VAT, while unit_price is pre-VAT.",
        "Unit price is before VAT, but the line amount includes VAT."
      ]
    });

    expect(result.warnings).toEqual([
      "Thành tiền của dòng sản phẩm đã gồm VAT, còn đơn giá là giá trước VAT."
    ]);
  });

  it("translates all known English model notes to Vietnamese", () => {
    const result = normalizeOcrResult({
      ...base,
      warnings: [
        "Document date (po_date) is blank on the document, so it is set to null.",
        "Document reference number is 4801105433, order number 4600170104 is used for po_number.",
        "For items 3 and 4, amount matches quantity * units_per_order_unit * unit_price, reflecting price per individual piece (Cai) rather than per Pack.",
        "No unit prices or total amounts found on the document.",
        "Pricing/amount columns are not present in this document template, so financial totals are set to null.",
        "Total after tax (total_amount) is not explicitly printed on the document."
      ]
    });

    expect(result.warnings).toEqual([
      "Ngày chứng từ (ngày PO) để trống nên không thể ghi nhận.",
      "Số tham chiếu chứng từ là 4801105433; sử dụng số đơn hàng 4600170104 làm số PO.",
      "Ở dòng 3 và 4, thành tiền khớp số lượng × quy đổi × đơn giá; đơn giá được tính theo từng cái thay vì theo gói.",
      "Chứng từ không ghi đơn giá hoặc tổng tiền.",
      "Mẫu chứng từ không có cột đơn giá hoặc thành tiền nên các tổng tiền được để trống.",
      "Chứng từ không in rõ tổng tiền sau thuế."
    ]);
  });

  it("moves a Big C Article-like product code into barcode", () => {
    const result = normalizeOcrResult({
      ...base,
      items: [{
        line_no: 1,
        product_code: "8936146121045",
        vendor_product_code: null,
        barcode: null,
        product_name: "Nồi mẫu",
        model: null,
        quantity: "4",
        units_per_order_unit: null,
        unit: "Cai",
        unit_price: "374318",
        vat_rate: null,
        amount: "1497272",
        source_page: 1,
        confidence: 0.98
      }]
    });
    expect(result.items[0].barcode).toBe("8936146121045");
    expect(result.items[0].product_code).toBeNull();
  });

  it("removes neighboring Pack text from product names", () => {
    const result = normalizeOcrResult({
      ...base,
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: "8936146122165",
        product_name: "Pack CHẢO SÂU INOX 3LỚP MIỆNG RÓT GCP255 20IH Pack",
        model: null,
        quantity: "10",
        units_per_order_unit: null,
        unit: "EA",
        unit_price: "284707",
        vat_rate: null,
        amount: "2847070",
        source_page: 1,
        confidence: 0.98
      }]
    });

    expect(result.items[0].product_name).toBe("CHẢO SÂU INOX 3LỚP MIỆNG RÓT GCP255 20IH");
    expect(result.items[0].barcode).toBe("8936146122165");
  });

  it("warns when a barcode has an implausible length", () => {
    const result = normalizeOcrResult({
      ...base,
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: "12345",
        product_name: "Sản phẩm",
        model: null,
        quantity: "1",
        units_per_order_unit: null,
        unit: "Cái",
        unit_price: null,
        vat_rate: null,
        amount: null,
        source_page: 1,
        confidence: 0.6
      }]
    });
    expect(result.warnings[0]).toContain("Barcode cần kiểm tra");
  });

  it("warns when an EAN-13 barcode fails its check digit", () => {
    const result = normalizeOcrResult({
      ...base,
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: "8936146121265",
        product_name: "TH6 GCP255 20IH CHAO SAU INOX D.LIEN MROT 20CM",
        model: null,
        quantity: "2",
        units_per_order_unit: "6",
        unit: "Cai",
        unit_price: "254093",
        vat_rate: null,
        amount: "3049116",
        source_page: 1,
        confidence: 0.75
      }]
    });

    expect(result.warnings[0]).toContain("Barcode cần kiểm tra");
  });

  it("preserves a Mena product code returned in the barcode field", () => {
    const result = normalizeOcrResult({
      ...base,
      template_key: "po_mena_gourmet_purchase_order",
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: "M001256",
        product_name: "Mena sample",
        model: null,
        quantity: "1",
        units_per_order_unit: null,
        unit: "CAI",
        unit_price: null,
        vat_rate: null,
        amount: null,
        source_page: 1,
        confidence: 0.9
      }]
    });
    expect(result.items[0].product_code).toBe("M001256");
    expect(result.items[0].barcode).toBeNull();
  });

  it("uses the order-unit conversion factor and derives document totals", () => {
    const result = normalizeOcrResult({
      ...base,
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: "8936146121953",
        product_name: "Chảo",
        model: null,
        quantity: "2",
        units_per_order_unit: "6",
        unit: "CAI",
        unit_price: "177500",
        vat_rate: "8",
        amount: null,
        source_page: 1,
        confidence: 1
      }],
      tax_amount: "170400"
    });

    expect(result.items[0].amount).toBe("2130000");
    expect(result.subtotal_amount).toBe("2130000");
    expect(result.total_amount).toBe("2300400");
  });

  it("raises confidence for a complete row that passes deterministic validation", () => {
    const result = normalizeOcrResult({
      ...base,
      delivery_date: "09/03/2026",
      subtotal_amount: "3428724",
      tax_amount: "274298",
      total_amount: "3703022",
      confidence: 0.2,
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: "8936146121052",
        product_name: "GCS231-20IH NOI M.DA M.ROT 20CM",
        model: "GCS231-20IH",
        quantity: "2",
        units_per_order_unit: "6",
        unit: "Cai",
        unit_price: "285727",
        vat_rate: "8",
        amount: "3428724",
        source_page: 1,
        confidence: 0.75
      }]
    });

    expect(result.items[0].confidence).toBeGreaterThanOrEqual(0.93);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("does not trust high model confidence when required evidence is missing", () => {
    const result = normalizeOcrResult({
      ...base,
      items: [{
        line_no: 1,
        product_code: null,
        vendor_product_code: null,
        barcode: null,
        product_name: "Unknown product",
        model: null,
        quantity: null,
        units_per_order_unit: null,
        unit: null,
        unit_price: null,
        vat_rate: null,
        amount: null,
        source_page: 1,
        confidence: 0.99
      }]
    });

    expect(result.items[0].confidence).toBeLessThan(0.8);
  });

  it("uses the Big C Ordered By organization as issuer fallback", () => {
    const result = normalizeOcrResult({
      ...base,
      issuer_name: null,
      buyer_name: "CTY TNHH DV EB"
    });

    expect(result.issuer_name).toBe("CTY TNHH DV EB");
  });

  it("keeps row-level PO data for a multi-order DMX export without review warnings", () => {
    const result = normalizeOcrResult({
      ...base,
      document_title: "DMX Excel Order Export",
      title_source: "inferred",
      template_key: "po_dmx_excel_order_export",
      issuer_name: "Điện Máy Xanh",
      po_number: null,
      po_date: "2026-03-02",
      warnings: [
        "Multiple PO numbers found in this sheet. Field 'po_number' was set to null.",
        "Line item amounts were calculated by multiplying quantity by unit_price.",
        "Total fields were set to null as they are not present in the Excel export."
      ],
      items: [{
        line_no: 1,
        po_number: "01907PO2603888957",
        po_date: "2026-03-02",
        store_code: "1907",
        store_name: "HCM - Kho TT ĐMX Tân Bình",
        delivery_address: "Khu công nghiệp Tân Bình mở rộng",
        product_code: "1033263001000       ",
        vendor_product_code: "8936146122189",
        barcode: "8936146122189",
        product_name: "Chảo thép sâu chống dính Ceramic 28cm Greencook GCW257-28IH",
        model: null,
        quantity: "6",
        units_per_order_unit: null,
        unit: null,
        unit_price: "176727",
        vat_rate: null,
        amount: null,
        source_page: null,
        confidence: 1
      }, {
        line_no: 2,
        po_number: "02393PO2603889566",
        po_date: "2026-03-02",
        store_code: "2393",
        store_name: "ĐCN_BDU - Kho TT ĐMX Bình Dương",
        delivery_address: "Đường ĐT 743, Bình Dương",
        product_code: "1033263000994",
        vendor_product_code: "GCP245-24IH",
        barcode: null,
        product_name: "Chảo inox sâu 24cm Greencook GCP245-24IH",
        model: null,
        quantity: "12",
        units_per_order_unit: null,
        unit: null,
        unit_price: "209962",
        vat_rate: null,
        amount: null,
        source_page: null,
        confidence: 1
      }]
    });

    expect(result.items[0]).toMatchObject({
      po_number: "01907PO2603888957",
      store_code: "1907",
      store_name: "HCM - Kho TT ĐMX Tân Bình",
      barcode: null,
      product_code: "1033263001000",
      amount: "1060362"
    });
    expect(result.items[1].po_number).toBe("02393PO2603889566");
    expect(result.subtotal_amount).toBe("3579906");
    expect(result.total_amount).toBe("3579906");
    expect(result.warnings).toEqual([]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("treats DMX PDF Cost as VAT-inclusive and never treats Prod.ID as a barcode", () => {
    const result = normalizeOcrResult({
      ...base,
      document_title: "CUSTOMER MANUAL PURCHASE ORDER",
      template_key: "po_dmx_pdf_customer_manual",
      issuer_name: "CÔNG TY CỔ PHẦN ĐẦU TƯ ĐIỆN MÁY XANH",
      po_number: "10948PO2603028891",
      po_date: "2026-03-10",
      subtotal_amount: null,
      tax_amount: null,
      total_amount: "20077200.00",
      warnings: [
        "Product ID 1033265001126 check digit is invalid EAN-13, barcode mapped to null."
      ],
      items: [{
        line_no: 1,
        product_code: "1033265001078",
        vendor_product_code: "GCS241-T1",
        barcode: "1033265001078",
        product_name: "Bộ nồi chảo inox 5 đáy Greencook GCS241-T1 - Bộ 4 cái",
        model: null,
        quantity: "20",
        units_per_order_unit: null,
        unit: null,
        unit_price: "702000.00",
        vat_rate: "8",
        amount: "15163200.00",
        source_page: 1,
        confidence: 0.5
      }, {
        line_no: 2,
        product_code: "1033265001126",
        vendor_product_code: "GCS2519-T1",
        barcode: null,
        product_name: "Bộ nồi inox Greencook GCS2519-T1 - Bộ 3 cái",
        model: null,
        quantity: "13",
        units_per_order_unit: null,
        unit: null,
        unit_price: "350000.00",
        vat_rate: "8",
        amount: "4914000.00",
        source_page: 1,
        confidence: 0.5
      }]
    });

    expect(result.items[0].barcode).toBeNull();
    expect(result.items[0].product_code).toBe("1033265001078");
    expect(result.items[0].vendor_product_code).toBe("GCS241-T1");
    expect(result.subtotal_amount).toBe("18590000");
    expect(result.tax_amount).toBe("1487200");
    expect(result.total_amount).toBe("20077200");
    expect(result.warnings).toEqual([]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
