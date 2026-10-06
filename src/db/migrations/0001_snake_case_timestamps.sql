-- 0001_snake_case_timestamps.sql
--
-- Renames the 40 camelCase columns created by 0000 to snake_case.
--
-- WHY: CLAUDE.md states "Tables and columns: snake_case". Migration 0000 was generated
-- from a Drizzle schema that used the implicit-name API without `casing: "snake_case"`,
-- so the TypeScript keys `createdAt`/`updatedAt` became the column names verbatim. The
-- application works today because Drizzle quotes identifiers consistently, but every
-- hand-written statement has to quote them too — and the RLS policies in 0003 are
-- hand-written and reference column names directly. This has to land first.
--
-- SAFE: a rename preserves data, indexes, constraints and foreign keys. No table is
-- rewritten. Each statement is guarded so the migration is idempotent and a partial
-- application can be re-run.
--
-- PAIRED CODE CHANGE: `casing: "snake_case"` is added to drizzle.config.ts and to both
-- drizzle() calls in the same commit that applies this. Applying one without the other
-- breaks every query, so they must not be separated.

BEGIN;

-- client_profiles
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'client_profiles' AND column_name = 'createdAt')
  THEN ALTER TABLE "client_profiles" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'client_profiles' AND column_name = 'updatedAt')
  THEN ALTER TABLE "client_profiles" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- organizations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'createdAt')
  THEN ALTER TABLE "organizations" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'updatedAt')
  THEN ALTER TABLE "organizations" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- users
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'createdAt')
  THEN ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'updatedAt')
  THEN ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- vendor_profiles
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'vendor_profiles' AND column_name = 'createdAt')
  THEN ALTER TABLE "vendor_profiles" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'vendor_profiles' AND column_name = 'updatedAt')
  THEN ALTER TABLE "vendor_profiles" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- assessments
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'assessments' AND column_name = 'createdAt')
  THEN ALTER TABLE "assessments" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'assessments' AND column_name = 'updatedAt')
  THEN ALTER TABLE "assessments" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- bench_resources
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bench_resources' AND column_name = 'createdAt')
  THEN ALTER TABLE "bench_resources" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bench_resources' AND column_name = 'updatedAt')
  THEN ALTER TABLE "bench_resources" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- bulk_import_rows
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bulk_import_rows' AND column_name = 'createdAt')
  THEN ALTER TABLE "bulk_import_rows" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;

-- bulk_imports
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bulk_imports' AND column_name = 'createdAt')
  THEN ALTER TABLE "bulk_imports" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'bulk_imports' AND column_name = 'updatedAt')
  THEN ALTER TABLE "bulk_imports" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- employment_history
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'employment_history' AND column_name = 'createdAt')
  THEN ALTER TABLE "employment_history" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;

-- skills
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'createdAt')
  THEN ALTER TABLE "skills" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'skills' AND column_name = 'updatedAt')
  THEN ALTER TABLE "skills" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- requirements
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'requirements' AND column_name = 'createdAt')
  THEN ALTER TABLE "requirements" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'requirements' AND column_name = 'updatedAt')
  THEN ALTER TABLE "requirements" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- matches
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'createdAt')
  THEN ALTER TABLE "matches" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'updatedAt')
  THEN ALTER TABLE "matches" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- shortlist_items
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shortlist_items' AND column_name = 'createdAt')
  THEN ALTER TABLE "shortlist_items" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shortlist_items' AND column_name = 'updatedAt')
  THEN ALTER TABLE "shortlist_items" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- shortlists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shortlists' AND column_name = 'createdAt')
  THEN ALTER TABLE "shortlists" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'shortlists' AND column_name = 'updatedAt')
  THEN ALTER TABLE "shortlists" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- broker_threads
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'broker_threads' AND column_name = 'createdAt')
  THEN ALTER TABLE "broker_threads" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'broker_threads' AND column_name = 'updatedAt')
  THEN ALTER TABLE "broker_threads" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- duplicate_flags
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'duplicate_flags' AND column_name = 'createdAt')
  THEN ALTER TABLE "duplicate_flags" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'duplicate_flags' AND column_name = 'updatedAt')
  THEN ALTER TABLE "duplicate_flags" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- engagements
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'engagements' AND column_name = 'createdAt')
  THEN ALTER TABLE "engagements" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'engagements' AND column_name = 'updatedAt')
  THEN ALTER TABLE "engagements" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- interview_feedback
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'interview_feedback' AND column_name = 'createdAt')
  THEN ALTER TABLE "interview_feedback" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'interview_feedback' AND column_name = 'updatedAt')
  THEN ALTER TABLE "interview_feedback" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- interviews
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'interviews' AND column_name = 'createdAt')
  THEN ALTER TABLE "interviews" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'interviews' AND column_name = 'updatedAt')
  THEN ALTER TABLE "interviews" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- invoice_lines
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'invoice_lines' AND column_name = 'createdAt')
  THEN ALTER TABLE "invoice_lines" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;

-- invoices
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'createdAt')
  THEN ALTER TABLE "invoices" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'updatedAt')
  THEN ALTER TABLE "invoices" RENAME COLUMN "updatedAt" TO "updated_at"; END IF;
END $$;

-- rate_changes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'rate_changes' AND column_name = 'createdAt')
  THEN ALTER TABLE "rate_changes" RENAME COLUMN "createdAt" TO "created_at"; END IF;
END $$;

COMMIT;

-- Verification (run after applying):
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and column_name ~ '[A-Z]';
--   -- expected: 0
