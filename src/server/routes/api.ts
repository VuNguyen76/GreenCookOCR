import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import { config } from "../config.js";
import {
  createBatch,
  findDocumentByHash,
  getDocument,
  getStats,
  insertDocument,
  listDocuments,
  retryDocument
} from "../db/repository.js";

const BatchSchema = z.object({ fileCount: z.number().int().positive().max(500) });
const IdParams = z.object({ id: z.string().uuid() });
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
  ".doc", ".docx", ".xlsx", ".txt", ".csv"
]);

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/batches", async (request, reply) => {
    const input = BatchSchema.parse(request.body);
    return reply.code(201).send({ id: await createBatch(input.fileCount) });
  });

  app.post("/api/uploads", async (request, reply) => {
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: "Thiếu file upload" });

    const fields = part.fields as Record<string, { value?: unknown }>;
    const batchId = String(fields.batchId?.value ?? "");
    const batchPosition = Number(fields.batchPosition?.value ?? 1);
    if (!z.string().uuid().safeParse(batchId).success || !Number.isInteger(batchPosition)) {
      return reply.code(400).send({ error: "Batch không hợp lệ" });
    }

    const originalName = path.basename(part.filename).normalize("NFC");
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return reply.code(415).send({ error: `Không hỗ trợ định dạng ${extension || "không xác định"}` });
    }

    const temporaryPath = path.join(config.workDir, `${randomUUID()}.upload`);
    await pipeline(part.file, fs.createWriteStream(temporaryPath, { flags: "wx" }));

    try {
      const stat = await fsp.stat(temporaryPath);
      if (stat.size === 0) return reply.code(400).send({ error: "File rỗng" });
      const sha256 = await hashFile(temporaryPath);
      const duplicate = await findDocumentByHash(sha256);
      if (duplicate) {
        return reply.send({ duplicate: true, document: duplicate });
      }

      const detected = await fileTypeFromFile(temporaryPath);
      const mimeType = detected?.mime ?? part.mimetype ?? mimeForExtension(extension);
      const storedName = `${randomUUID()}${extension}`;
      const storagePath = path.join(config.uploadDir, storedName);
      await fsp.rename(temporaryPath, storagePath);

      const document = await insertDocument({
        batchId,
        batchPosition,
        originalName,
        storedName,
        storagePath,
        mimeType,
        sizeBytes: stat.size,
        sha256
      });
      return reply.code(201).send({ duplicate: false, document });
    } finally {
      await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });

  app.get("/api/documents", async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) })
      .parse(request.query);
    return { documents: await listDocuments(query.limit), stats: await getStats() };
  });

  app.get("/api/documents/:id", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const document = await getDocument(id);
    if (!document) return reply.code(404).send({ error: "Không tìm thấy tài liệu" });
    return document;
  });

  app.post("/api/documents/:id/retry", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    if (!await retryDocument(id)) {
      return reply.code(409).send({ error: "Tài liệu không ở trạng thái có thể chạy lại" });
    }
    return { ok: true };
  });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function mimeForExtension(extension: string): string {
  const mapping: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".csv": "text/csv"
  };
  return mapping[extension] ?? "application/octet-stream";
}
