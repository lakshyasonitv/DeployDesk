import { defineConfig } from "drizzle-kit";

// Schema changes run against the DIRECT connection (:5432), never the pooler.
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
  // Column names come from the TypeScript keys where no explicit name is given.
  // Without this, `createdAt` became a column literally named "createdAt", against
  // CLAUDE.md's snake_case rule. Migration 0001 renamed the 40 columns that affected;
  // this setting and that migration must stay together.
  casing: "snake_case",
  strict: true,
  verbose: true,
});
