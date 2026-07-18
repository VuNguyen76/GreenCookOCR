import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ override: true });

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  OCR_PROVIDER: z.enum(["gemini", "openai-compatible"]).default("gemini"),
  OPENAI_COMPATIBLE_BASE_URL: z.url().default("http://localhost:20128/v1"),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
  OPENAI_COMPATIBLE_MODEL: z.string().default("antigravity/gemini-3.5-flash-medium"),
  DATABASE_URL: z.url(),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  UPLOAD_DIR: z.string().default("./storage/uploads"),
  WORK_DIR: z.string().default("./storage/work"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(50),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1200),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  ANTIWORD_PATH: z.string().default("antiword"),
  PDFTOPPM_PATH: z.string().default("pdftoppm")
});

const env = EnvSchema.parse(process.env);

export const config = {
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  ocrProvider: env.OCR_PROVIDER,
  openAiCompatibleBaseUrl: env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, ""),
  openAiCompatibleApiKey: env.OPENAI_COMPATIBLE_API_KEY,
  openAiCompatibleModel: env.OPENAI_COMPATIBLE_MODEL,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL === "true",
  host: env.HOST,
  port: env.PORT,
  uploadDir: path.resolve(env.UPLOAD_DIR),
  workDir: path.resolve(env.WORK_DIR),
  maxFileSizeBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024,
  workerPollMs: env.WORKER_POLL_MS,
  maxAttempts: env.MAX_ATTEMPTS,
  antiwordPath: env.ANTIWORD_PATH,
  pdftoppmPath: env.PDFTOPPM_PATH
};
