import { ensureWebOrderSchema } from "../idempiere/web-schema.js";

export async function migrate(): Promise<void> {
  await ensureWebOrderSchema();
}
