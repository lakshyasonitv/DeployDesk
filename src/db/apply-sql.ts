/**
 * Applies the hand-written SQL migrations in src/db/migrations, in filename order.
 *
 *   npm run db:apply            # apply anything pending
 *   npm run db:apply -- --dry   # list what WOULD run, touch nothing
 *
 * Why this exists alongside src/db/migrate.ts: drizzle-kit's migrator tracks migrations
 * it generated itself, via meta/_journal.json plus a snapshot per migration. 0001-0003
 * are hand-written — renames, triggers, views and RLS policies that drizzle-kit cannot
 * express — so they need their own ledger.
 *
 * Each file runs inside its own transaction. A failure rolls that file back and stops,
 * so a half-applied migration is not possible.
 *
 * Runs against DIRECT_URL (the session pooler), never the transaction pooler: DDL,
 * triggers and policies need session-level features.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL must be set");

const dry = process.argv.includes("--dry");
const DIR = "src/db/migrations";
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

/** 0000 was applied by drizzle-kit's migrator, so it is recorded rather than re-run. */
const APPLIED_ELSEWHERE = new Set(["0000_medical_leech.sql"]);

async function main() {
  await sql`
    create table if not exists "applied_sql_migrations" (
      "filename"   text primary key,
      "sha256"     text not null,
      "applied_at" timestamptz not null default now()
    )
  `;

  const done = new Map(
    (await sql<Array<{ filename: string; sha256: string }>>`
      select filename, sha256 from applied_sql_migrations
    `).map((r) => [r.filename, r.sha256]),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const pending: string[] = [];

  for (const file of files) {
    const body = readFileSync(`${DIR}/${file}`, "utf8");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);

    if (APPLIED_ELSEWHERE.has(file)) {
      if (!done.has(file)) {
        if (!dry) await sql`
          insert into applied_sql_migrations (filename, sha256)
          values (${file}, ${hash}) on conflict do nothing
        `;
        console.log(`  recorded (applied by drizzle-kit)  ${file}`);
      }
      continue;
    }

    const prior = done.get(file);
    if (prior === hash) { console.log(`  already applied                    ${file}`); continue; }
    if (prior && prior !== hash) {
      // Migrations are append-only (CLAUDE.md working agreement 1).
      throw new Error(
        `${file} has changed since it was applied (${prior} -> ${hash}). ` +
        `Migrations are append-only: write a new file instead of editing this one.`,
      );
    }
    pending.push(file);
  }

  if (!pending.length) { console.log("\n  nothing pending.\n"); return; }

  console.log(`\n  ${pending.length} pending:`);
  for (const f of pending) console.log(`    ${f}`);

  if (dry) {
    console.log("\n  --dry: nothing was applied.\n");
    return;
  }

  for (const file of pending) {
    const body = readFileSync(`${DIR}/${file}`, "utf8");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const started = Date.now();
    process.stdout.write(`\n  applying ${file} ... `);
    // The file carries its own BEGIN/COMMIT, so it is sent as one simple query.
    await sql.unsafe(body);
    await sql`insert into applied_sql_migrations (filename, sha256) values (${file}, ${hash})`;
    console.log(`done in ${Date.now() - started}ms`);
  }
  console.log("");
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\n  FAILED:\n", err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
