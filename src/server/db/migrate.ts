import { pathToFileURL } from "node:url";
import { migrateStagingDatabase, stagingDatabase } from "./staging.js";

export async function migrate(): Promise<void> {
  migrateStagingDatabase(stagingDatabase);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  stagingDatabase.close();
  console.log("Đã cập nhật schema SQLite staging.");
}
