import { describe, expect, it } from "vitest";
import { normalizePoNumber } from "./po-reference.js";

describe("normalizePoNumber", () => {
  it("compares PO numbers without formatting differences", () => {
    expect(normalizePoNumber(" 10948-po 2603028891 ")).toBe("10948PO2603028891");
  });

  it("keeps letters and digits only", () => {
    expect(normalizePoNumber("PO/4501.723.503")).toBe("PO4501723503");
  });
});
