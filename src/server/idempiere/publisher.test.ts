import { describe, expect, it } from "vitest";
import { groupDocumentOrders, selectWarehouse } from "./publisher.js";

describe("groupDocumentOrders", () => {
  it("splits a multi-PO spreadsheet by PO number only", () => {
    const groups = groupDocumentOrders({
      id: "document-1",
      po_number: null,
      po_date: "2026-03-02",
      delivery_date: null,
      delivery_address: null
    }, [
      { id: "item-1", line_no: 1, po_number: "PO-A", po_date: "2026-03-02", store_code: "S1", store_name: "Store 1", delivery_address: "Address 1", amount: "100" },
      { id: "item-2", line_no: 2, po_number: "PO-B", po_date: "2026-03-03", store_code: "S2", store_name: "Store 2", delivery_address: "Address 2", amount: "200" },
      { id: "item-3", line_no: 3, po_number: "PO-A", po_date: "2026-03-02", store_code: "S3", store_name: "Store 3", delivery_address: "Address 3", amount: "300" }
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      orderKey: "POA",
      poNumber: "PO-A",
      subtotalAmount: "400",
      items: [{ id: "item-1" }, { id: "item-3" }]
    });
    expect(groups[1]).toMatchObject({
      orderKey: "POB",
      poNumber: "PO-B",
      subtotalAmount: "200",
      items: [{ id: "item-2" }]
    });
  });

  it("refuses to publish only when the document has no PO anywhere", () => {
    expect(() => groupDocumentOrders({
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
    }])).toThrow("Chưa có Số PO");
  });

  it("creates a header-only group when OCR found a PO but no product lines", () => {
    const groups = groupDocumentOrders({
      id: "document-empty",
      po_number: "PO-EMPTY",
      po_date: "2026-03-02",
      delivery_date: null,
      delivery_address: null
    }, []);

    expect(groups).toEqual([expect.objectContaining({
      orderKey: "POEMPTY",
      poNumber: "PO-EMPTY",
      subtotalAmount: null,
      items: []
    })]);
  });

  it("keeps rows without their own PO under the first PO found in the document", () => {
    const groups = groupDocumentOrders({
      id: "document-fallback",
      po_number: null,
      po_date: null,
      delivery_date: null,
      delivery_address: null
    }, [
      { id: "item-1", line_no: 1, po_number: "PO-A", po_date: null, store_code: null, store_name: null, delivery_address: null, amount: "10" },
      { id: "item-2", line_no: 2, po_number: null, po_date: null, store_code: null, store_name: null, delivery_address: null, amount: "20" }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it("groups formatting variants of the same PO into one order", () => {
    const groups = groupDocumentOrders({
      id: "document-3",
      po_number: null,
      po_date: "2026-03-02",
      delivery_date: null,
      delivery_address: null
    }, [
      { id: "item-1", line_no: 1, po_number: "PO-123", po_date: null, store_code: null, store_name: null, delivery_address: null, amount: "10" },
      { id: "item-2", line_no: 2, po_number: "po 123", po_date: null, store_code: null, store_name: null, delivery_address: null, amount: "20" }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].subtotalAmount).toBe("30");
  });
});

describe("selectWarehouse", () => {
  const warehouses = [
    { id: "1", org_id: "0", value: "HUB-Hải Phòng", name: "HUB-Hải Phòng" },
    { id: "2", org_id: "0", value: "HUB-Thanh Hóa", name: "HUB-Thanh Hóa" },
    { id: "3", org_id: "1000016", value: "DEFAULT", name: "Kho mặc định" }
  ];

  it("uses the warehouse mentioned in the extracted delivery data", () => {
    expect(selectWarehouse(warehouses, ["Kho TT DMX Thanh Hoa"], "3")?.id).toBe("2");
  });

  it("falls back to the configured warehouse when the source is ambiguous", () => {
    expect(selectWarehouse(warehouses, ["Kho trung tâm"], "3")?.id).toBe("3");
  });
});
