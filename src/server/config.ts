import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: process.env.ENV_FILE ?? ".env", override: true });

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_API_VERSION: z.enum(["v1", "v1beta"]).default("v1"),
  GEMINI_MEDIA_RESOLUTION: z.enum(["low", "medium", "high"]).default("medium"),
  DATABASE_URL: z.url().optional(),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
  TARGET_DATABASE_URL: z.url().optional(),
  TARGET_DATABASE_NAME: z.string().trim().min(1).optional(),
  TARGET_DATABASE_SSL: z.enum(["true", "false"]).optional(),
  TARGET_AD_CLIENT_ID: z.coerce.number().int().positive().default(11),
  TARGET_AD_ORG_ID: z.coerce.number().int().nonnegative().default(0),
  TARGET_AD_USER_ID: z.coerce.number().int().positive().default(100),
  STAGING_DATABASE_PATH: z.string().default("./storage/greencook-ocr.sqlite"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  UPLOAD_DIR: z.string().default("./storage/uploads"),
  WORK_DIR: z.string().default("./storage/work"),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(50),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1200),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  ANTIWORD_PATH: z.string().default("antiword")
});

const env = EnvSchema.parse(process.env);
const targetDatabaseUrl = env.TARGET_DATABASE_URL
  ?? databaseUrlWithName(env.DATABASE_URL, env.TARGET_DATABASE_NAME);
if (!targetDatabaseUrl) {
  throw new Error("Thiếu TARGET_DATABASE_URL cho hệ thống iDempiere đích");
}

export const config = {
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  geminiApiVersion: env.GEMINI_API_VERSION,
  geminiMediaResolution: env.GEMINI_MEDIA_RESOLUTION,
  databaseUrl: targetDatabaseUrl,
  databaseSsl: (env.TARGET_DATABASE_SSL ?? env.DATABASE_SSL) === "true",
  targetDatabaseUrl,
  targetDatabaseSsl: (env.TARGET_DATABASE_SSL ?? env.DATABASE_SSL) === "true",
  targetAdClientId: env.TARGET_AD_CLIENT_ID,
  targetAdOrgId: env.TARGET_AD_ORG_ID,
  targetAdUserId: env.TARGET_AD_USER_ID,
  stagingDatabasePath: path.resolve(env.STAGING_DATABASE_PATH),
  host: env.HOST,
  port: env.PORT,
  uploadDir: path.resolve(env.UPLOAD_DIR),
  workDir: path.resolve(env.WORK_DIR),
  maxFileSizeBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024,
  workerPollMs: env.WORKER_POLL_MS,
  maxAttempts: env.MAX_ATTEMPTS,
  antiwordPath: env.ANTIWORD_PATH
};

function databaseUrlWithName(databaseUrl: string | undefined, databaseName: string | undefined): string | undefined {
  if (!databaseUrl || !databaseName) return databaseUrl;
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}
