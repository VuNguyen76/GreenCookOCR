import { describe, expect, it } from "vitest";
import { groupDocumentOrders } from "./publisher.js";

describe("groupDocumentOrders", () => {
  it("splits a multi-PO spreadsheet into deterministic order groups", () => {
    const groups = groupDocumentOrders({
      id: "document-1",
      po_number: null,
      po_date: "2026-03-02",
      delivery_date: null,
      delivery_address: null
    }, [
      { id: "item-1", line_no: 1, po_number: "PO-A", po_date: "2026-03-02", store_code: "S1", store_name: "Store 1", delivery_address: "Address 1", amount: "100" },
      { id: "item-2", line_no: 2, po_number: "PO-B", po_date: "2026-03-03", store_code: "S2", store_name: "Store 2", delivery_address: "Address 2", amount: "200" },
      { id: "item-3", line_no: 3, po_number: "PO-A", po_date: "2026-03-02", store_code: "S1", store_name: "Store 1", delivery_address: "Address 1", amount: "300" }
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      orderKey: "PO-A|S1",
      poNumber: "PO-A",
      subtotalAmount: "400",
      items: [{ id: "item-1" }, { id: "item-3" }]
    });
    expect(groups[1]).toMatchObject({
      orderKey: "PO-B|S2",
      poNumber: "PO-B",
      subtotalAmount: "200",
      items: [{ id: "item-2" }]
    });
  });

  it("uses one stable fallback key for a single document without a printed PO", () => {
    const groups = groupDocumentOrders({
      id: "document-2",
      po_number: null,
      po_date: null,
      delivery_date: null,
      delivery_address: null
    }, [{
      id: "item-1",
      line_no: 1,
      po_number: null,
      po_date: null,
      store_code: null,
      store_name: null,
      delivery_address: null,
      amount: null
    }]);

    expect(groups[0]).toMatchObject({
      orderKey: "document",
      poNumber: "OCR-document-2"
    });
  });
});
