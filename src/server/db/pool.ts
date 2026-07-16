import pg from "pg";
import { config } from "../config.js";

const { Pool, types } = pg;

// PostgreSQL DATE has no timezone. Keep it as YYYY-MM-DD so JSON serialization
// cannot shift the calendar day through UTC conversion.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error", error.message);
});
