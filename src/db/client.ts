import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * ===========================================================================
 * RLS IS CURRENTLY INERT. READ THIS BEFORE RELYING ON IT.
 * ===========================================================================
 *
 * Migration 0003 defines 22 Row Level Security policies and migration 0004 narrows one of
 * them. **None of them is doing anything at runtime**, for two independent reasons:
 *
 *   1. The app connects as `postgres`, a superuser, which BYPASSES RLS entirely.
 *   2. The policies key on `auth.uid()` / `current_org_id()`, and the demo session is
 *      resolved in application code — nothing sets a Postgres session variable, so those
 *      functions have nothing to read.
 *
 * This is a known, accepted state and not an oversight. **Masking is enforced by the
 * portal-specific read models** (ADR-003), which is the first net and the one that is
 * actually tested: 88 tests, including 12 read-model leak tests, 19 write-path tests and
 * the dual-role suite. RLS is the SECOND net, for the day an application bug writes a
 * query that forgets its tenancy predicate.
 *
 * Activating it needs real Supabase Auth plus a restricted database role, which is
 * docs/BUILD-PLAN.md Phase 1 work. Until then:
 *
 *   - Do NOT describe this system as RLS-protected. It is read-model-protected.
 *   - Do NOT weaken a read model on the grounds that "RLS will catch it". It will not.
 *   - A new read path still needs its own leak test; that is the net that exists.
 *
 * Recorded in project-brain/02-decisions.md (2026-10-07).
 */

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
    /**
     * Must be > 1. A single connection serialises every query, and issuing concurrent
     * queries over one Supavisor transaction-mode connection stalls indefinitely —
     * a page that reads two things in parallel hangs, and because the pool is one
     * socket wide it takes every other route down with it. Found exactly that way.
     */
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    /**
     * No `connection: { statement_timeout }` here, deliberately.
     *
     * It was set as a startup parameter to stop a stalled query hanging a request. In
     * Supavisor TRANSACTION mode, client connections are multiplexed onto server
     * connections, and the timeout leaked across statements: a query was cancelled with
     * "canceling statement due to statement timeout" after 281ms against a 15s limit —
     * i.e. it inherited a clock that had started on someone else's statement.
     *
     * The platform already bounds this: Vercel functions have their own timeout. If a
     * per-query bound is ever needed, set it inside an explicit transaction rather than
     * on the pooled connection.
     */
  });

if (process.env.NODE_ENV !== "production") globalThis.__tvSql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
export { schema };
