import { describe, expect, it } from "vitest";
import { buildGeminiMediaInput, buildGeminiTextInput, parseGeminiInteraction } from "./gemini.js";

describe("Gemini native document OCR", () => {
  it("wraps PDF bytes in a v1 user input without unsupported resolution", () => {
    const input = buildGeminiMediaInput(
      "document",
      Buffer.from("sample-pdf").toString("base64"),
      "application/pdf",
      "PO mẫu.pdf",
      "medium"
    );

    expect(input).toEqual([{
      type: "user_input",
      content: [{
        type: "document",
        data: Buffer.from("sample-pdf").toString("base64"),
        mime_type: "application/pdf"
      }, expect.objectContaining({ type: "text" })]
    }]);
    const content = input[0].content as Array<Record<string, unknown>>;
    expect(String(content[1].text)).toContain("Tên file: PO mẫu.pdf");
  });

  it("keeps medium resolution on native image input", () => {
    const input = buildGeminiMediaInput(
      "image",
      "base64-image",
      "image/png",
      "scan.png",
      "medium"
    );

    expect(input[0]).toMatchObject({ type: "user_input" });
    const content = input[0].content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({
      type: "image",
      data: "base64-image",
      mime_type: "image/png",
      resolution: "medium"
    });
  });

  it("sends extracted Word or Excel text without a media wrapper", () => {
    const input = buildGeminiTextInput("ORDER NO 123", "order.xlsx");

    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({ type: "user_input" });
    const content = input[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "text" });
    expect(String(content[0].text)).toContain("ORDER NO 123");
  });

  it("parses structured JSON from Interaction.output_text", () => {
    const extraction = parseGeminiInteraction({
      id: "interaction-123",
      status: "completed",
      output_text: JSON.stringify({
        schema_version: "1.0",
        document_title: "PURCHASE ORDER",
        title_source: "document",
        template_key: "unknown",
        document_type: "purchase_order",
        issuer_name: null,
        issuer_branch: null,
        po_number: "PO123",
        po_date: null,
        delivery_date: null,
        currency: "VND",
        supplier_name: null,
        buyer_name: null,
        delivery_address: null,
        subtotal_amount: null,
        tax_amount: null,
        total_amount: null,
        items: [],
        warnings: [],
        confidence: 0.9
      })
    });

    expect(extraction.interactionId).toBe("interaction-123");
    expect(extraction.raw).toMatchObject({ po_number: "PO123" });
  });

  it("rejects incomplete or empty Gemini interactions", () => {
    expect(() => parseGeminiInteraction({ id: "failed", status: "failed", output_text: "" }))
      .toThrow("Gemini interaction failed");
    expect(() => parseGeminiInteraction({ id: "empty", status: "completed", output_text: "" }))
      .toThrow("Gemini returned an empty response");
  });
});
