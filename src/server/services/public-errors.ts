export function toPublicOcrErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/antiword/i.test(message)) {
    return "\u004b\u0068\u00f4\u006e\u0067 \u0111\u1ecdc \u0111\u01b0\u1ee3\u0063 \u0066\u0069\u006c\u0065 \u0057\u006f\u0072\u0064 \u0063\u0169. \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u0063\u00e0\u0069 \u0068\u006f\u1eb7\u0063 \u0063\u1ea5\u0075 \u0068\u00ec\u006e\u0068 \u0063\u00f4\u006e\u0067 \u0063\u1ee5 \u0111\u1ecdc \u002e\u0064\u006f\u0063.";
  }
  if (/ENOENT|no such file|cannot find|UploadedFileMissingError/i.test(message)) {
    return "\u004b\u0068\u00f4\u006e\u0067 \u0074\u00ec\u006d \u0074\u0068\u1ea5\u0079 \u0066\u0069\u006c\u0065 \u0111\u00e3 \u0075\u0070\u006c\u006f\u0061\u0064. \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u0075\u0070\u006c\u006f\u0061\u0064 \u006c\u1ea1\u0069 \u0074\u00e0\u0069 \u006c\u0069\u1ec7\u0075.";
  }
  if (/pdftoppm|Couldn't open file|I\/O Error|PDF rendering/i.test(message)) {
    return "\u004b\u0068\u00f4\u006e\u0067 \u0111\u1ecdc \u0111\u01b0\u1ee3\u0063 \u0066\u0069\u006c\u0065 \u0050\u0044\u0046. \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u006b\u0069\u1ec3\u006d \u0074\u0072\u0061 \u0066\u0069\u006c\u0065 \u0068\u006f\u1eb7\u0063 \u0063\u0068\u1ea1\u0079 \u006c\u1ea1\u0069 \u004f\u0043\u0052.";
  }
  if (/OCR response did not contain a JSON object|Unexpected token|is not valid JSON/i.test(message)) {
    return "Model OCR trả về sai định dạng dữ liệu. Vui lòng chạy lại OCR hoặc đổi model.";
  }
  return stripInternalPaths(message)
    || "\u004f\u0043\u0052 \u0074\u0068\u1ea5\u0074 \u0062\u1ea1\u0069. \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u0063\u0068\u1ea1\u0079 \u006c\u1ea1\u0069 \u0068\u006f\u1eb7\u0063 \u006b\u0069\u1ec3\u006d \u0074\u0072\u0061 \u0074\u00e0\u0069 \u006c\u0069\u1ec7\u0075.";
}

export function sanitizeClientErrorMessage(message: string | null): string | null {
  return message ? toPublicOcrErrorMessage(new Error(message)) : null;
}

function stripInternalPaths(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
    .replace(/\/(?:home|tmp|var|Users)\/[^\s"'<>]+/g, "[path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
