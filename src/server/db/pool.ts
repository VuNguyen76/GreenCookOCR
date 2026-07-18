import pg from "pg";
import { config } from "../config.js";

const { Pool, types } = pg;

// PostgreSQL DATE has no timezone. Keep it as YYYY-MM-DD so JSON serialization
// cannot shift the calendar day through UTC conversion.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  application_name: `GreenCookOCR:${process.pid}`,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error", error.message);
});

export async function terminateAnonymousWorkersOnDatabaseHost(): Promise<number> {
  const result = await pool.query<{ terminated: boolean }>(
    `select pg_terminate_backend(pid) as terminated
     from pg_stat_activity
     where datname = current_database()
       and usename = current_user
       and pid <> pg_backend_pid()
       and coalesce(application_name, '') = ''
       and client_addr is not null
       and client_addr = inet_server_addr()`
  );
  return result.rows.filter((row) => row.terminated).length;
}
