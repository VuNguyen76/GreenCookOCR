import { migrateStagingDatabase, stagingDatabase } from "./staging.js";

export async function migrate(): Promise<void> {
  migrateStagingDatabase(stagingDatabase);
}
