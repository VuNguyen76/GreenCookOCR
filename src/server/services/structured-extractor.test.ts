import { describe, expect, it } from "vitest";
import { extractStructuredSpreadsheet } from "./structured-extractor.js";

const dmxExport = [
  "### SHEET: Sheet1",
  "1\tORDER ID\tORDER DATE\tINPUT TYPE NAME\tSTORE ID\tSHIP CODE\tSOLD CODE\tSTORE NAME\tSTORE ADDRESS\tLAT\tLNG\tPROVIDER PRODUCT CODE\tPRODUCT ID\tPRODUCT NAME\tQUANTITY\tPRICE",
  "2\t01907PO2603888957\t46084.45972222222\tNhập mua hàng (trong nước)\t1907\t\t\tHCM - Kho TT ĐMX Tân Bình\tKCN Tân Bình\t10.8\t106.6\t8936146122189\t1033263001000       \tChảo thép sâu chống dính Ceramic 28cm Greencook GCW257-28IH\t6\t176727",
  "3\t02393PO2603889566\t46084.45972222222\tNhập mua hàng (trong nước)\t2393\t\t\tĐCN_BDU - Kho TT ĐMX Bình Dương\tĐường ĐT 743\t11.0\t106.7\tGCP245-24IH\t1033263000994       \tChảo inox sâu 24cm Greencook GCP245-24IH\t12\t209962"
].join("\n");

describe("extractStructuredSpreadsheet", () => {
  it("maps a DMX export losslessly and preserves the PO on every item", () => {
    const result = extractStructuredSpreadsheet(dmxExport, "PO DMX 3.3.xlsx");

    expect(result).not.toBeNull();
    expect(result?.po_number).toBeNull();
    expect(result?.po_date).toBe("2026-03-02");
    expect(result?.warnings).toEqual([]);
    expect(result?.items).toHaveLength(2);
    expect(result?.items[0]).toMatchObject({
      po_number: "01907PO2603888957",
      po_date: "2026-03-02",
      store_code: "1907",
      store_name: "HCM - Kho TT ĐMX Tân Bình",
      delivery_address: "KCN Tân Bình",
      product_code: "1033263001000",
      vendor_product_code: "8936146122189",
      barcode: null,
      quantity: "6",
      unit_price: "176727",
      amount: null
    });
  });

  it("does not claim an unrelated spreadsheet", () => {
    expect(extractStructuredSpreadsheet("### SHEET: Sheet1\n1\tNAME\tVALUE", "other.xlsx")).toBeNull();
  });
});
