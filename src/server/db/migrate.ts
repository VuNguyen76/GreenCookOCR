import { migrateStagingDatabase, stagingDatabase } from "./staging.js";
import { ensureWebOrderSchema } from "../idempiere/web-schema.js";

export async function migrate(): Promise<void> {
  migrateStagingDatabase(stagingDatabase);
  await ensureWebOrderSchema();
}
