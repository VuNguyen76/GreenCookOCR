import fs from "node:fs/promises";
import path from "node:path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { registerApiRoutes } from "./routes/api.js";
import { SequentialOcrWorker } from "./services/worker.js";

const app = Fastify({ logger: true, bodyLimit: config.maxFileSizeBytes + 1024 * 1024 });
const worker = new SequentialOcrWorker();

await fs.mkdir(config.uploadDir, { recursive: true });
await fs.mkdir(config.workDir, { recursive: true });
await migrate();

app.log.info({
  ocrProvider: "gemini-interactions",
  ocrModel: config.geminiModel,
  mediaResolution: config.geminiMediaResolution,
  uploadDir: config.uploadDir,
  workDir: config.workDir
}, "GreenCookOCR configuration loaded");

await app.register(fastifyMultipart, {
  limits: { fileSize: config.maxFileSizeBytes, files: 1, fields: 10 }
});
await registerApiRoutes(app);

const webRoot = path.resolve("dist");
try {
  await fs.access(path.join(webRoot, "index.html"));
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
} catch {
  app.log.info("Frontend build not found; use the Vite development server");
}

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: "Dữ liệu không hợp lệ", details: error.issues });
  }
  app.log.error(error);
  const serverError = error as { statusCode?: number; message?: string };
  return reply.code(serverError.statusCode ?? 500)
    .send({ error: serverError.message || "Lỗi máy chủ" });
});

await worker.start();
await app.listen({ host: config.host, port: config.port });

async function shutdown(): Promise<void> {
  worker.stop();
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
