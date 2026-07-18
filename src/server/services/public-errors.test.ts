import { describe, expect, it } from "vitest";
import { sanitizeClientErrorMessage, toPublicOcrErrorMessage } from "./public-errors.js";

describe("public OCR errors", () => {
  it("hides ENOENT and internal paths from messages returned to the UI", () => {
    const message = sanitizeClientErrorMessage(
      "ENOENT: no such file or directory, stat 'D:\\GreenCook\\GreenCookOCR\\storage\\uploads\\missing.pdf'"
    );

    expect(message).toBe("Không tìm thấy file đã upload. Vui lòng upload lại tài liệu.");
    expect(message).not.toContain("ENOENT");
    expect(message).not.toContain("D:\\");
  });

  it("keeps already safe business messages", () => {
    expect(toPublicOcrErrorMessage(new Error("Model local tạm thời không khả dụng.")))
      .toBe("Model local tạm thời không khả dụng.");
  });

  it("turns malformed model responses into a Vietnamese user-facing error", () => {
    const message = sanitizeClientErrorMessage("OCR response did not contain a JSON object");

    expect(message).toBe("Model OCR trả về sai định dạng dữ liệu. Vui lòng chạy lại OCR hoặc đổi model.");
    expect(message).not.toContain("OCR response did not contain");
  });

  it("hides antiword executable errors behind a Word-specific message", () => {
    const message = sanitizeClientErrorMessage("spawn antiword ENOENT");

    expect(message).toContain("Word");
    expect(message).toContain(".doc");
    expect(message).not.toContain("ENOENT");
  });
});
