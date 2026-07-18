import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { DocumentRow } from "../../shared/ocr.js";
import { config } from "../config.js";
import { resolveDocumentPath } from "./preprocessor.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((filePath) => fs.rm(filePath, { force: true })));
});

describe("resolveDocumentPath", () => {
  it("dùng file cùng stored_name trong UPLOAD_DIR khi storage_path đã cũ", async () => {
    const storedName = `${randomUUID()}.pdf`;
    const localPath = path.join(config.uploadDir, storedName);
    cleanupPaths.push(localPath);
    await fs.mkdir(config.uploadDir, { recursive: true });
    await fs.writeFile(localPath, "pdf-test");

    await expect(resolveDocumentPath(documentFixture({
      stored_name: storedName,
      storage_path: String.raw`/home/old-server/storage/uploads/${storedName}`
    }))).resolves.toBe(localPath);
  });

  it("trả lỗi tiếng Việt gọn khi file không còn ở storage_path hoặc UPLOAD_DIR", async () => {
    const storedName = `${randomUUID()}.pdf`;
    const document = documentFixture({
      stored_name: storedName,
      storage_path: path.join("Z:\\missing", storedName)
    });

    await expect(resolveDocumentPath(document)).rejects.toMatchObject({
      name: "UploadedFileMissingError",
      message: "Không tìm thấy file đã upload. Vui lòng upload lại tài liệu."
    });
  });

  it("không cho stored_name thoát ra ngoài UPLOAD_DIR", async () => {
    const outsideName = `${randomUUID()}.pdf`;
    const outsidePath = path.resolve(config.uploadDir, "..", outsideName);
    cleanupPaths.push(outsidePath);
    await fs.writeFile(outsidePath, "outside-upload-dir");

    await expect(resolveDocumentPath(documentFixture({
      stored_name: `..${path.sep}${outsideName}`,
      storage_path: path.join("Z:\\missing", outsideName)
    }))).rejects.toMatchObject({ name: "UploadedFileMissingError" });
  });
});

function documentFixture(overrides: Partial<DocumentRow>): DocumentRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    batch_id: "00000000-0000-4000-8000-000000000002",
    batch_position: 1,
    original_name: "sample.pdf",
    stored_name: "sample.pdf",
    storage_path: "sample.pdf",
    mime_type: "application/pdf",
    size_bytes: "8",
    sha256: "0".repeat(64),
    status: "preprocessing",
    document_title: null,
    template_key: null,
    issuer_name: null,
    subtotal_amount: null,
    tax_amount: null,
    total_amount: null,
    attempts: 1,
    error_message: null,
    warnings: [],
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    completed_at: null,
    ...overrides
  };
}
