import { describe, expect, it } from "vitest";
import { toPublicOcrErrorMessage } from "./public-errors.js";

describe("toPublicOcrErrorMessage", () => {
  it("an ENOENT va duong dan noi bo khoi loi tra ve UI", () => {
    const message = toPublicOcrErrorMessage(new Error(
      "ENOENT: no such file or directory, stat 'D:\\GreenCook\\GreenCookOCR\\storage\\uploads\\missing.pdf'"
    ));

    expect(message).toBe("\u004b\u0068\u00f4\u006e\u0067 \u0074\u00ec\u006d \u0074\u0068\u1ea5\u0079 \u0066\u0069\u006c\u0065 \u0111\u00e3 \u0075\u0070\u006c\u006f\u0061\u0064. \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u0075\u0070\u006c\u006f\u0061\u0064 \u006c\u1ea1\u0069 \u0074\u00e0\u0069 \u006c\u0069\u1ec7\u0075.");
    expect(message).not.toContain("ENOENT");
    expect(message).not.toContain("D:\\");
  });

  it("giu thong bao nghiep vu tieng Viet da an toan", () => {
    expect(toPublicOcrErrorMessage(new Error("\u004d\u006f\u0064\u0065\u006c \u006c\u006f\u0063\u0061\u006c \u0074\u1ea1\u006d \u0074\u0068\u1eddi \u006b\u0068\u00f4\u006e\u0067 \u006b\u0068\u1ea3 \u0064\u1ee5\u006e\u0067.")))
      .toBe("\u004d\u006f\u0064\u0065\u006c \u006c\u006f\u0063\u0061\u006c \u0074\u1ea1\u006d \u0074\u0068\u1eddi \u006b\u0068\u00f4\u006e\u0067 \u006b\u0068\u1ea3 \u0064\u1ee5\u006e\u0067.");
  });
});
