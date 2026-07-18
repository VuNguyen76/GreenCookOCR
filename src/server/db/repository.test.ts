import { afterEach, describe, expect, it } from "vitest";
import type { OcrDocument } from "../../shared/ocr.js";
import { createSourceOnlyReconciliation } from "../services/reconciliation.js";
import { StagingRepository, sanitizeDocumentRow } from "./repository.js";
import { openStagingDatabase } from "./staging.js";

const databases: ReturnType<typeof openStagingDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function repository() {
  const database = openStagingDatabase(":memory:");
  databases.push(database);
  return new StagingRepository(database);
}

const normalized: OcrDocument = {
  schema_version: "1.0",
  document_title: "PURCHASE ORDER",
  title_source: "document",
  template_key: "po_emart_thiso_purchase_order",
  document_type: "purchase_order",
  issuer_name: "Khách hàng mẫu",
  issuer_branch: null,
  po_number: "PO-001",
  po_date: "2026-03-10",
  delivery_date: null,
  currency: "VND",
  supplier_name: "GREEN COOK",
  buyer_name: null,
  delivery_address: null,
  subtotal_amount: "100000",
  tax_amount: "8000",
  total_amount: "108000",
  items: [{
    line_no: 1,
    po_number: "PO-001",
    po_date: "2026-03-10",
    store_code: null,
    store_name: null,
    delivery_address: null,
    product_code: "SP001",
    vendor_product_code: null,
    barcode: "8930000000001",
    product_name: "Sản phẩm mẫu",
    model: "GCP01",
    quantity: "2",
    units_per_order_unit: "1",
    unit: "Cái",
    unit_price: "50000",
    vat_rate: "8",
    amount: "108000",
    source_page: 1,
    confidence: 0.99
  }],
  warnings: [],
  confidence: 0.99
};

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

describe("SQLite staging repository", () => {
  it("keeps every OCR result in needs_review until explicit confirmation", async () => {
    const repo = repository();
    const batchId = await repo.createBatch(1);
    const document = await repo.insertDocument({
      batchId,
      batchPosition: 1,
      originalName: "po.pdf",
      storedName: "stored.pdf",
      storagePath: "C:/uploads/stored.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64)
    });

    const status = await repo.completeDocument(
      document.id,
      normalized,
      normalized,
      createSourceOnlyReconciliation(normalized),
      "gemini-3.5-flash",
      "prompt-1"
    );
    const stored = await repo.getDocument(document.id);

    expect(status).toBe("needs_review");
    expect(stored?.status).toBe("needs_review");
    expect(stored?.items).toHaveLength(1);
  });

  it("creates a durable publish outbox job instead of marking the document published", async () => {
    const repo = repository();
    const batchId = await repo.createBatch(1);
    const document = await repo.insertDocument({
      batchId,
      batchPosition: 1,
      originalName: "po.pdf",
      storedName: "stored.pdf",
      storagePath: "C:/uploads/stored.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: "b".repeat(64)
    });
    await repo.completeDocument(
      document.id,
      normalized,
      normalized,
      createSourceOnlyReconciliation(normalized),
      "gemini-3.5-flash",
      "prompt-1"
    );

    const queued = await repo.queuePublish(document.id);
    const stored = await repo.getDocument(document.id);
    const job = await repo.claimNextPublishJob();

    expect(queued).toBe(true);
    expect(stored?.status).toBe("publishing");
    expect(job).toMatchObject({ document_id: document.id, status: "running" });
    expect(job?.id).toEqual(expect.any(String));
  });
});
