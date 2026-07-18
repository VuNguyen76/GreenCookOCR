import { migrate } from "../src/server/db/migrate.js";
import { stagingDatabase } from "../src/server/db/staging.js";

await migrate();
stagingDatabase.close();
console.log("Đã cập nhật schema SQLite staging.");
