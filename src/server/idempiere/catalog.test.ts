import { describe, expect, it } from "vitest";
import { findUniqueTitleProduct, type TargetProduct } from "./catalog.js";

const product = (id: string, value: string): TargetProduct => ({
  id,
  value,
  barcode: null,
  productCode: null,
  name: value,
  uomId: null,
  uomName: null
});

describe("findUniqueTitleProduct", () => {
  it("khớp model trong tiêu đề khi nguồn lược tiền tố GC và hậu tố IH", () => {
    const result = findUniqueTitleProduct(
      "GREENCOOK Chảo sâu men 24cm P231-24",
      [product("1", "GCP231-20IH"), product("2", "GCP231-24IH")]
    );
    expect(result?.id).toBe("2");
  });

  it("không tự chọn khi alias model còn mơ hồ", () => {
    const result = findUniqueTitleProduct(
      "Chảo mẫu P231-24",
      [product("1", "GCP231-24IH"), product("2", "GCP231-24")]
    );
    expect(result).toBeNull();
  });
});
