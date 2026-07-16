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
});
