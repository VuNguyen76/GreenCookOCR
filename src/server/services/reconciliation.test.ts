import { describe, expect, it, vi } from "vitest";
import type { OcrDocument } from "../../shared/ocr.js";
import {
  normalizeProductNameForMatch,
  createSourceOnlyReconciliation,
  rankProductCandidates,
  reconcileOcrDocument,
  type ProductReference
} from "./reconciliation.js";

const baseDocument: OcrDocument = {
  schema_version: "1.0",
  document_title: "Purchase Order",
  title_source: "document",
  template_key: "po_emart_thiso_purchase_order",
  document_type: "purchase_order",
  issuer_name: "THISO RETAIL COMPANY LIMITED",
  issuer_branch: null,
  po_number: "4501723503",
  po_date: "2026-03-02",
  delivery_date: "2026-03-03",
  currency: "VND",
  supplier_name: "GREEN COOK",
  buyer_name: null,
  delivery_address: null,
  subtotal_amount: "2847070",
  tax_amount: "227766",
  total_amount: "3074836",
  items: [{
    line_no: 1,
    po_number: null,
    po_date: null,
    store_code: null,
    store_name: null,
    delivery_address: null,
    product_code: "1193924",
    vendor_product_code: null,
    barcode: "8936146122165",
    product_name: "CHAO SAU INOX 3LOP MIENG ROT GCP255 20IH",
    model: null,
    quantity: "10",
    units_per_order_unit: null,
    unit: "EA",
    unit_price: "284707",
    vat_rate: "8",
    amount: "2847070",
    source_page: 1,
    confidence: 0.96
  }],
  warnings: [],
  confidence: 0.96
};

const reference: ProductReference = {
  id: "f5ae3ea6-d313-4ac0-8ddd-909eb481c2d9",
  referenceKey: "barcode:8936146122165",
  barcode: "8936146122165",
  productCodes: ["1193924"],
  vendorProductCodes: [],
  canonicalName: "Chảo sâu inox 3 lớp miệng rót GCP255 20IH",
  nameAliases: ["CHAO SAU INOX 3LOP MIENG ROT GCP255 20IH"],
  units: ["EA"],
  templateKeys: ["po_emart_thiso_purchase_order"],
  issuerNames: ["THISO RETAIL COMPANY LIMITED"],
  scopedIdentifiers: [{
    templateKey: "po_emart_thiso_purchase_order",
    issuerName: "THISO RETAIL COMPANY LIMITED",
    productCode: "1193924",
    vendorProductCode: null,
    unit: "EA"
  }],
  sourceCount: 3,
  trustScore: 0.98,
  verified: false
};

describe("product reconciliation", () => {
  it("preserves document content without consulting learned product references", () => {
    const source = {
      ...baseDocument,
      items: [{
        ...baseDocument.items[0],
        product_code: "NEW-SKU",
        barcode: null,
        product_name: "Sản phẩm hoàn toàn mới trong tài liệu hiện tại",
        confidence: 0.72
      }]
    };

    const result = createSourceOnlyReconciliation(source);

    expect(result.document).toEqual(source);
    expect(result.usedAi).toBe(false);
    expect(result.lines[0]).toMatchObject({
      matchedReferenceId: null,
      matchMethod: "none",
      warnings: []
    });
  });

  it("normalizes Vietnamese and English-facing OCR names for retrieval", () => {
    expect(normalizeProductNameForMatch("Chảo sâu inox 3 lớp - miệng rót GCP255 20IH"))
      .toBe("chao sau inox 3 lop mieng rot gcp255 20ih");
  });

  it("ranks a valid exact barcode above semantic name matches", () => {
    const candidates = rankProductCandidates(
      baseDocument.items[0],
      [
        { ...reference, id: "8ed6945f-66cf-4e27-9cda-9a40a15779e2", barcode: null, referenceKey: "product:other" },
        reference
      ],
      baseDocument
    );

    expect(candidates[0]).toMatchObject({
      referenceKey: reference.referenceKey,
      method: "barcode_exact",
      score: 1
    });
  });

  it("uses source A for identity while preserving quantities and money from source B", async () => {
    const result = await reconcileOcrDocument(baseDocument, [reference]);
    const item = result.document.items[0];

    expect(item.product_name).toBe(reference.canonicalName);
    expect(item.quantity).toBe("10");
    expect(item.unit_price).toBe("284707");
    expect(item.amount).toBe("2847070");
    expect(result.lines[0]).toMatchObject({
      matchedReferenceId: reference.id,
      matchMethod: "barcode_exact",
      reconciledByAi: false,
      fieldSources: { product_name: "reference", quantity: "ocr", unit_price: "ocr", amount: "ocr" }
    });
  });

  it("does not copy an Emart product code into a Big C barcode row", async () => {
    const bigC = {
      ...baseDocument,
      template_key: "po_bigc_go_purchase_note" as const,
      issuer_name: "CTY TNHH DV EB",
      items: [{
        ...baseDocument.items[0],
        product_code: null,
        barcode: "8936146122165",
        unit: "CAI"
      }]
    };

    const result = await reconcileOcrDocument(bigC, [reference]);

    expect(result.document.items[0].product_code).toBeNull();
    expect(result.document.items[0].product_name).toBe(reference.canonicalName);
    expect(result.lines[0].fieldSources.product_code).toBe("ocr");
  });

  it("sends only ambiguous semantic matches to the second AI pass", async () => {
    const ambiguous = {
      ...baseDocument,
      items: [{
        ...baseDocument.items[0],
        product_code: null,
        barcode: null,
        product_name: "Chao inox sau 3 lop GCP255 20IH",
        confidence: 0.82
      }]
    };
    const resolver = vi.fn().mockResolvedValue([{
      line_no: 1,
      matched_reference_key: reference.referenceKey,
      decision: "match",
      confidence: 0.91,
      reason: "Tên và model sản phẩm tương ứng"
    }]);

    const result = await reconcileOcrDocument(ambiguous, [reference], resolver);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result.document.items[0].product_name).toBe(reference.canonicalName);
    expect(result.document.items[0].product_code).toBe("1193924");
    expect(result.document.items[0].quantity).toBe("10");
    expect(result.lines[0]).toMatchObject({
      matchMethod: "ai_semantic",
      reconciledByAi: true,
      matchConfidence: 0.91
    });
  });

  it("keeps OCR evidence and requests review when the AI selects an unknown candidate", async () => {
    const ambiguous = {
      ...baseDocument,
      items: [{ ...baseDocument.items[0], product_code: null, barcode: null, confidence: 0.7 }]
    };
    const resolver = vi.fn().mockResolvedValue([{
      line_no: 1,
      matched_reference_key: "barcode:not-in-candidates",
      decision: "match",
      confidence: 0.99,
      reason: "Invalid model choice"
    }]);

    const result = await reconcileOcrDocument(ambiguous, [reference], resolver);

    expect(result.document.items[0]).toEqual(ambiguous.items[0]);
    expect(result.document.warnings.some((warning) => warning.includes("dòng 1"))).toBe(true);
    expect(result.lines[0].matchedReferenceId).toBeNull();
  });

  it("falls back to normalized OCR when the second AI pass is unavailable", async () => {
    const ambiguous = {
      ...baseDocument,
      items: [{ ...baseDocument.items[0], product_code: null, barcode: null, confidence: 0.75 }]
    };
    const resolver = vi.fn().mockRejectedValue(new Error("provider timeout"));

    const result = await reconcileOcrDocument(ambiguous, [reference], resolver);

    expect(result.document.items[0]).toEqual(ambiguous.items[0]);
    expect(result.document.warnings.some((warning) => warning.includes("AI đối soát"))).toBe(true);
  });

  it("requests review for a low-confidence row with no source A candidate", async () => {
    const newProduct = {
      ...baseDocument,
      items: [{
        ...baseDocument.items[0],
        product_code: null,
        barcode: "8936146121052",
        product_name: "GCS231-20IH NOI M.DA M.ROT 20CM",
        confidence: 0.75
      }]
    };

    const result = await reconcileOcrDocument(newProduct, []);

    expect(result.document.items[0]).toEqual(newProduct.items[0]);
    expect(result.document.warnings.some((warning) => warning.includes("chưa có dữ liệu tham chiếu"))).toBe(true);
    expect(result.lines[0]).toMatchObject({ matchMethod: "none", matchConfidence: 0.75 });
  });

  it("accepts a confident new product when AI confirms that no reference matches", async () => {
    const newProduct = {
      ...baseDocument,
      items: [{
        ...baseDocument.items[0],
        product_code: "1033263000994",
        vendor_product_code: "GCP245-24IH",
        barcode: null,
        product_name: "Chảo sâu inox 3 lớp miệng rót Greencook GCP245 24IH",
        confidence: 0.9
      }]
    };
    const resolver = vi.fn().mockResolvedValue([{
      line_no: 1,
      matched_reference_key: null,
      decision: "no_match",
      confidence: 0.96,
      reason: "Sản phẩm nguồn hợp lệ nhưng không trùng model trong danh sách tham chiếu"
    }]);

    const result = await reconcileOcrDocument(newProduct, [reference], resolver);

    expect(result.document.items[0]).toEqual(newProduct.items[0]);
    expect(result.document.warnings).toEqual([]);
    expect(result.lines[0]).toMatchObject({
      matchMethod: "none",
      matchedReferenceId: null,
      reconciledByAi: true,
      warnings: []
    });
  });

  it("does not send a weak name-only candidate to AI", async () => {
    const distinctProduct = {
      ...baseDocument,
      items: [{
        ...baseDocument.items[0],
        product_code: "1033263000994",
        vendor_product_code: "GCP245-24IH",
        barcode: null,
        product_name: "Chảo inox sâu 24cm Greencook GCP245-24IH",
        confidence: 0.91
      }]
    };
    const resolver = vi.fn();

    const result = await reconcileOcrDocument(distinctProduct, [reference], resolver);

    expect(resolver).not.toHaveBeenCalled();
    expect(result.document.items[0]).toEqual(distinctProduct.items[0]);
    expect(result.document.warnings).toEqual([]);
  });
});
