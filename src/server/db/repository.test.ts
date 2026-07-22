import { describe, expect, it } from "vitest";
import { sanitizeDocumentRow } from "./repository.js";

describe("sanitizeDocumentRow", () => {
  it("does not expose internal filesystem errors from stored document rows", () => {
    const row = sanitizeDocumentRow({
      id: "doc-1",
      error_message: "ENOENT: no such file or directory, stat 'D:\\GreenCook\\GreenCookOCR\\storage\\uploads\\missing.pdf'"
    });

    expect(row.error_message).toBe("Không tìm thấy file đã upload. Vui lòng upload lại tài liệu.");
    expect(row.error_message).not.toContain("ENOENT");
    expect(row.error_message).not.toContain("D:\\");
  });
});
