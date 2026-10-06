import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Two connections, deliberately.
 *
 * DATABASE_URL  -> Supavisor TRANSACTION pooler (:6543). Used by the app at runtime.
 *                  Serverless functions open many short-lived connections, so a direct
 *                  connection exhausts Postgres. Transaction pooling does not support
 *                  prepared statements, hence `prepare: false`.
 * DIRECT_URL    -> direct connection (:5432). Used by migrations and the seed script,
 *                  which need session-level features the pooler does not pass through.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
}

declare global {
  // Reuse the client across hot reloads in dev and across warm invocations on Vercel.
  var __tvSql: ReturnType<typeof postgres> | undefined;
}

const sql =
  globalThis.__tvSql ??
  postgres(connectionString, {
    prepare: false, // required for Supavisor transaction mode
    max: 1,         // one socket per serverless instance; the pooler does the pooling
    idle_timeout: 20,
    connect_timeout: 15,
  });

if (process.env.NODE_ENV !== "production") globalThis.__tvSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
