import { describe, expect, it } from "vitest";
import { canonicalizeOcrDocument } from "./gemini.js";
import { OCR_PROMPT } from "./prompt.js";

describe("Big C header extraction contract", () => {
  it("maps loose Ordered By header fields into the canonical schema", () => {
    const result = canonicalizeOcrDocument({
      document_title: "PURCHASE NOTE",
      template_key: "po_bigc_go_purchase_note",
      document_type: "purchase_order",
      ordered_by: "CTY TNHH DV EB\nSO 163, DUONG PHAN DANG LUU\nHO CHI MINH",
      for_store: "GO! DONG NAI",
      by_supplier: "CTY TNHH GREEN COOK",
      delivered_to: "GO! DONG NAI (101), SO 833, XA LO HA NOI",
      items: []
    });

    expect(result.issuer_name).toBe("CTY TNHH DV EB");
    expect(result.issuer_branch).toBe("GO! DONG NAI");
    expect(result.supplier_name).toBe("CTY TNHH GREEN COOK");
    expect(result.delivery_address).toContain("SO 833");
    expect(result.confidence).toBe(0.5);
  });

  it("explicitly instructs the OCR model where Ordered By must be stored", () => {
    expect(OCR_PROMPT).toContain("Ordered By -> issuer_name");
  });
});
