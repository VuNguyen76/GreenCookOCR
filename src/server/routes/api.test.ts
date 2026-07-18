import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { existingUploadPath, removeStoredUpload, safeDuplicateStoragePath } from "./api.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((filePath) => fs.rm(filePath, { force: true })));
});

describe("duplicate upload storage helpers", () => {
  it("uses the existing storage path when the duplicate file still exists", async () => {
    const storedName = `${randomUUID()}.pdf`;
    const existingPath = path.join(config.uploadDir, storedName);
    cleanupPaths.push(existingPath);
    await fs.mkdir(config.uploadDir, { recursive: true });
    await fs.writeFile(existingPath, "pdf");

    await expect(existingUploadPath({
      storage_path: existingPath,
      stored_name: storedName
    })).resolves.toBe(existingPath);
  });

  it("falls back to UPLOAD_DIR/stored_name for records migrated from another machine", async () => {
    const storedName = `${randomUUID()}.pdf`;
    const localPath = path.join(config.uploadDir, storedName);
    cleanupPaths.push(localPath);
    await fs.mkdir(config.uploadDir, { recursive: true });
    await fs.writeFile(localPath, "pdf");

    await expect(existingUploadPath({
      storage_path: `/home/old/app/storage/uploads/${storedName}`,
      stored_name: storedName
    })).resolves.toBe(localPath);
  });

  it("returns null when a duplicate record points to a missing file", async () => {
    const storedName = `${randomUUID()}.pdf`;

    await expect(existingUploadPath({
      storage_path: `/home/old/app/storage/uploads/${storedName}`,
      stored_name: storedName
    })).resolves.toBeNull();
  });

  it("rejects unsafe stored_name when rehydrating duplicate uploads", () => {
    expect(() => safeDuplicateStoragePath(`..${path.sep}escape.pdf`)).toThrow("Unsafe stored file name");
  });

  it("removes an uploaded file by its safe stored name", async () => {
    const storedName = `${randomUUID()}.pdf`;
    const storedPath = path.join(config.uploadDir, storedName);
    await fs.mkdir(config.uploadDir, { recursive: true });
    await fs.writeFile(storedPath, "pdf");

    await removeStoredUpload(storedName);

    await expect(fs.stat(storedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete a file when stored_name escapes the upload directory", async () => {
    const outsidePath = path.join(config.uploadDir, "..", `${randomUUID()}.pdf`);
    cleanupPaths.push(outsidePath);
    await fs.writeFile(outsidePath, "keep");

    await expect(removeStoredUpload(`..${path.sep}${path.basename(outsidePath)}`))
      .rejects.toThrow("Unsafe stored file name");
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("keep");
  });
});
