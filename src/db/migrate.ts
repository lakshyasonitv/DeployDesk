/**
 * Applies the checked-in SQL migrations in src/db/migrations.
 *
 *   npm run db:migrate
 *
 * Migrations are append-only (CLAUDE.md working agreement 1): never edit an applied
 * migration, write a new one. Drizzle records what it has applied in
 * `drizzle.__drizzle_migrations`, so re-running is a no-op.
 *
 * Runs against DIRECT_URL. For this Supabase project that is the SESSION pooler on 5432 —
 * `db.<ref>.supabase.co` has no IPv4 address, so it does not resolve from every network.
 * The transaction pooler on 6543 cannot be used here: DDL needs session-level features.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL (or DATABASE_URL) must be set to migrate");

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

async function main() {
  const host = new URL(url!).host;
  console.log(`\nApplying migrations against ${host}`);
  await migrate(drizzle(sql), { migrationsFolder: "./src/db/migrations" });

  const [{ count }] = await sql<Array<{ count: number }>>`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'public'
  `;
  console.log(`Done. ${count} tables in public.\n`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\nMigration failed:\n", err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
