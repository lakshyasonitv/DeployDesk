import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql as rawSql } from "drizzle-orm";
import * as s from "../schema";
import { makeRng } from "./helpers";

/**
 * Seed context: one direct connection, one deterministic RNG.
 * Env comes from `tsx --env-file=.env.local` (see the db:seed script) — the seed is a
 * standalone process and does not get Next.js's env loading.
 */

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DIRECT_URL is not set. Put the Supabase DIRECT connection string (port 5432) in .env.local.",
  );
}
if (!process.env.IDENTITY_PEPPER) process.env.IDENTITY_PEPPER = "seed-pepper-local-only";

export const client = postgres(url, { max: 1, prepare: false, idle_timeout: 10 });
export const db = drizzle(client, { schema: s, casing: "snake_case" });
export const schema = s;

/** Fixed seed, so repeated runs generate identical filler rows. */
export const rng = makeRng(20260822);
export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
export const log = (...a: unknown[]) => console.log(...a);

/** Tables this seed owns, in a readable order. TRUNCATE CASCADE handles the FK graph. */
const OWNED_TABLES = [
  "audit_log", "broker_messages", "broker_threads", "duplicate_flags",
  "invoice_lines", "invoices", "rate_changes", "engagements",
  "interview_feedback", "interview_panelists", "interviews",
  "shortlist_items", "shortlists", "matches",
  "requirement_stage_events", "requirement_skills", "requirements",
  "assessments", "availability_confirmations", "bulk_import_rows",
  "employment_history", "resource_skills", "bench_resources", "bulk_imports",
  "skills", "sensitive_columns",
  // Dual-role tables. These MUST be listed: they reference organizations with ON DELETE
  // CASCADE, so `truncate organizations cascade` empties them whether or not the seed
  // mentions them. Migration 0002 backfilled org_capabilities and memberships once, and
  // the next db:seed silently destroyed both because they were absent from this list.
  "org_blocks", "memberships", "org_capabilities", "groups",
  // Migration 0005. Same rule, same reason: `saved_views` and `extension_requests`
  // cascade from organizations and engagements, and `interview_slots` from interviews,
  // so a truncate empties them regardless. `holiday_calendar` references nothing and is
  // listed anyway — the seed writes it, so the seed owns it.
  "saved_views", "extension_requests", "interview_slots", "holiday_calendar",
  "client_profiles", "vendor_profiles", "users", "organizations",
];

export async function reset() {
  await db.execute(
    rawSql.raw(`truncate table ${OWNED_TABLES.map((t) => `"${t}"`).join(", ")} cascade`),
  );
  log(`  reset ${OWNED_TABLES.length} tables`);
}
