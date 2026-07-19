import { applyIdempiereMigration } from "../src/server/idempiere/migration.js";
import { pool } from "../src/server/db/pool.js";

try {
  await applyIdempiereMigration();
  console.log("Đã cài schema và Window Đơn Đặt Hàng vào iDempiere.");
} finally {
  await pool.end();
}
