CREATE TYPE "public"."assessment_status" AS ENUM('not_started', 'invited', 'in_progress', 'scored', 'expired', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."availability_kind" AS ENUM('immediate', 'dated', 'notice');--> statement-breakpoint
CREATE TYPE "public"."client_decision" AS ENUM('pending', 'selected', 'passed');--> statement-breakpoint
CREATE TYPE "public"."confirm_method" AS ENUM('single', 'bulk', 'api', 'email_link');--> statement-breakpoint
CREATE TYPE "public"."duplicate_status" AS ENUM('open', 'kept_a', 'kept_b', 'not_duplicate');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('onboarding', 'active', 'ending', 'ended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."engagement_type" AS ENUM('contract', 'c2h', 'full_time');--> statement-breakpoint
CREATE TYPE "public"."experience_band" AS ENUM('0-3', '3-5', '5-8', '8+');--> statement-breakpoint
CREATE TYPE "public"."feedback_outcome" AS ENUM('advance', 'hold', 'pass');--> statement-breakpoint
CREATE TYPE "public"."import_row_resolution" AS ENUM('pending', 'listed', 'rejected', 'merged');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('parsing', 'review_pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('video', 'onsite', 'phone');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('proposed', 'awaiting_vendor', 'confirmed', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."invoice_direction" AS ENUM('receivable', 'payable');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."match_eligibility" AS ENUM('eligible', 'blocked_stale', 'blocked_score_expired', 'blocked_duplicate', 'blocked_deployed');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('client', 'vendor', 'talentvibes');--> statement-breakpoint
CREATE TYPE "public"."rate_side" AS ENUM('vendor', 'client');--> statement-breakpoint
CREATE TYPE "public"."requirement_stage" AS ENUM('draft', 'new', 'matching', 'shortlisted', 'interviewing', 'placed', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('draft', 'listed', 'in_process', 'deployed', 'withdrawn', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sender_side" AS ENUM('client', 'vendor', 'ops');--> statement-breakpoint
CREATE TYPE "public"."thread_scope" AS ENUM('general', 'requirement', 'candidate', 'interview');--> statement-breakpoint
CREATE TYPE "public"."thread_side" AS ENUM('client', 'vendor');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('client_admin', 'hiring_manager', 'panel_member', 'vendor_admin', 'bench_manager', 'ops_admin', 'broker', 'finance');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."work_mode" AS ENUM('onsite', 'hybrid', 'remote');--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"account_owner_id" uuid,
	"default_notice_accepted" text[],
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_type" "org_type" NOT NULL,
	"name" text NOT NULL,
	"public_code" text,
	"status" "org_status" DEFAULT 'onboarding' NOT NULL,
	"billing_address" jsonb,
	"gstin" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_public_code_unique" UNIQUE("public_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendor_profiles" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"reliability_score" numeric(2, 1),
	"placements_count" integer DEFAULT 0 NOT NULL,
	"withdrawal_count" integer DEFAULT 0 NOT NULL,
	"onboarded_at" timestamp with time zone,
	"notes_internal" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"provider" text DEFAULT 'invigil' NOT NULL,
	"provider_ref" text,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"status" "assessment_status" DEFAULT 'not_started' NOT NULL,
	"track" text,
	"invited_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"overall_score" integer,
	"score_coding" integer,
	"score_dsa" integer,
	"score_system_design" integer,
	"score_communication" integer,
	"report_object_key" text,
	"summary_json" jsonb,
	"proctoring_flags" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" "confirm_method" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bench_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"masked_id" text NOT NULL,
	"full_name" text NOT NULL,
	"employee_code" text,
	"base_city" text NOT NULL,
	"experience_months" integer NOT NULL,
	"available_from" date,
	"notice_period_days" integer,
	"work_modes" text[] NOT NULL,
	"vendor_rate_paise" bigint NOT NULL,
	"status" "resource_status" DEFAULT 'draft' NOT NULL,
	"last_confirmed_at" timestamp with time zone,
	"listed_at" timestamp with time zone,
	"cv_object_key" text,
	"contact_email" text,
	"contact_phone" text,
	"pan_hash" text,
	"phone_hash" text,
	"email_hash" text,
	"github_handle" text,
	"last_project_note" text,
	"source_import_id" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bench_resources_masked_id_unique" UNIQUE("masked_id")
);
--> statement-breakpoint
CREATE TABLE "bulk_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"errors" text[],
	"duplicate_of" uuid,
	"resolution" "import_row_resolution" DEFAULT 'pending' NOT NULL,
	"resource_id" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"filename" text NOT NULL,
	"object_key" text NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_listed" integer DEFAULT 0 NOT NULL,
	"rows_needs_review" integer DEFAULT 0 NOT NULL,
	"status" "import_status" DEFAULT 'parsing' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"employer_name" text NOT NULL,
	"employer_slug" text NOT NULL,
	"start_date" date,
	"end_date" date,
	"title" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_skills" (
	"resource_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"years" numeric(3, 1),
	CONSTRAINT "resource_skills_resource_id_skill_id_pk" PRIMARY KEY("resource_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"aliases" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "requirement_skills" (
	"requirement_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "requirement_skills_requirement_id_skill_id_pk" PRIMARY KEY("requirement_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "requirement_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"client_org_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"owner_user_id" uuid,
	"role_title" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"experience_band" "experience_band" NOT NULL,
	"budget_min_paise" bigint NOT NULL,
	"budget_max_paise" bigint NOT NULL,
	"engagement_type" "engagement_type" NOT NULL,
	"duration_text" text,
	"location_city" text,
	"work_mode" "work_mode" NOT NULL,
	"hybrid_days" integer,
	"start_date" date,
	"notice_accepted" text[] NOT NULL,
	"client_note" text,
	"stage" "requirement_stage" DEFAULT 'draft' NOT NULL,
	"sla_due_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"algo_score" integer NOT NULL,
	"score_skill" integer NOT NULL,
	"score_test" integer NOT NULL,
	"score_exp_fit" integer NOT NULL,
	"score_rate" integer NOT NULL,
	"score_freshness" integer NOT NULL,
	"score_vendor" integer NOT NULL,
	"reason_line" text,
	"algo_rank" integer NOT NULL,
	"manual_rank" integer,
	"included" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"proposed_client_rate_paise" bigint,
	"eligibility" "match_eligibility" DEFAULT 'eligible' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_req_resource_uq" UNIQUE("requirement_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "shortlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shortlist_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"masked_id" text NOT NULL,
	"position" integer NOT NULL,
	"experience_months" integer NOT NULL,
	"base_city" text NOT NULL,
	"skills_snapshot" text[] NOT NULL,
	"score_overall" integer,
	"score_coding" integer,
	"score_dsa" integer,
	"score_system_design" integer,
	"score_communication" integer,
	"assessment_attempt_no" integer,
	"assessment_tested_on" date,
	"availability_label" text NOT NULL,
	"availability_kind" "availability_kind" NOT NULL,
	"rate_band_min_paise" bigint NOT NULL,
	"rate_band_max_paise" bigint NOT NULL,
	"client_decision" "client_decision" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"sent_by" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broker_note" text,
	"opened_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shortlists_req_seq_uq" UNIQUE("requirement_id","sequence_no")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_org_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"context" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_side" "sender_side" NOT NULL,
	"body" text NOT NULL,
	"relayed_from_id" uuid,
	"redaction_note" text,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"side" "thread_side" NOT NULL,
	"counterparty_org_id" uuid NOT NULL,
	"broker_user_id" uuid NOT NULL,
	"scope_type" "thread_scope" DEFAULT 'general' NOT NULL,
	"scope_requirement_id" uuid,
	"scope_resource_id" uuid,
	"scope_label" text NOT NULL,
	"linked_thread_id" uuid,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"resource_a_id" uuid NOT NULL,
	"resource_b_id" uuid NOT NULL,
	"confidence" integer NOT NULL,
	"signals" jsonb NOT NULL,
	"status" "duplicate_status" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"blocks_requirements" uuid[],
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_flags_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid,
	"resource_id" uuid NOT NULL,
	"client_org_id" uuid NOT NULL,
	"vendor_org_id" uuid NOT NULL,
	"role_title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "engagement_status" DEFAULT 'onboarding' NOT NULL,
	"vendor_rate_paise" bigint NOT NULL,
	"client_rate_paise" bigint NOT NULL,
	"margin_approved_by" uuid,
	"margin_exception_note" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interview_id" uuid NOT NULL,
	"submitted_by" uuid,
	"rating_technical_depth" integer,
	"rating_problem_solving" integer,
	"rating_communication" integer,
	"rating_role_fit" integer,
	"notes" text,
	"outcome" "feedback_outcome",
	"submitted_at" timestamp with time zone,
	"relayed_at" timestamp with time zone,
	"relayed_summary" text,
	"relayed_by" uuid,
	"due_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_panelists" (
	"interview_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"title" text,
	CONSTRAINT "interview_panelists_interview_id_display_name_pk" PRIMARY KEY("interview_id","display_name")
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"shortlist_item_id" uuid NOT NULL,
	"round_no" integer NOT NULL,
	"status" "interview_status" DEFAULT 'proposed' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer,
	"mode" "interview_mode",
	"location_text" text,
	"meeting_url" text,
	"proposed_slots" jsonb,
	"requested_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"description" text NOT NULL,
	"days_billed" integer,
	"days_in_month" integer,
	"amount_paise" bigint NOT NULL,
	"is_prorata" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"counterparty_org_id" uuid NOT NULL,
	"direction" "invoice_direction" NOT NULL,
	"period_month" date NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"total_paise" bigint DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_party_dir_month_uq" UNIQUE("counterparty_org_id","direction","period_month")
);
--> statement-breakpoint
CREATE TABLE "rate_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"side" "rate_side" NOT NULL,
	"old_paise" bigint,
	"new_paise" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensitive_columns" (
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"visible_to" text[] NOT NULL,
	"reason" text,
	CONSTRAINT "sensitive_columns_table_name_column_name_pk" PRIMARY KEY("table_name","column_name")
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_account_owner_id_users_id_fk" FOREIGN KEY ("account_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "vendor_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_confirmations" ADD CONSTRAINT "availability_confirmations_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_confirmations" ADD CONSTRAINT "availability_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_resources" ADD CONSTRAINT "bench_resources_vendor_org_id_organizations_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bench_resources" ADD CONSTRAINT "bench_resources_source_import_id_bulk_imports_id_fk" FOREIGN KEY ("source_import_id") REFERENCES "public"."bulk_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_import_id_bulk_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."bulk_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_duplicate_of_bench_resources_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_import_rows" ADD CONSTRAINT "bulk_import_rows_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_vendor_org_id_organizations_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_imports" ADD CONSTRAINT "bulk_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_skills" ADD CONSTRAINT "resource_skills_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_skills" ADD CONSTRAINT "resource_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_skills" ADD CONSTRAINT "requirement_skills_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_skills" ADD CONSTRAINT "requirement_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_stage_events" ADD CONSTRAINT "requirement_stage_events_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_stage_events" ADD CONSTRAINT "requirement_stage_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_shortlist_id_shortlists_id_fk" FOREIGN KEY ("shortlist_id") REFERENCES "public"."shortlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_org_id_organizations_id_fk" FOREIGN KEY ("actor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_messages" ADD CONSTRAINT "broker_messages_thread_id_broker_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."broker_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_messages" ADD CONSTRAINT "broker_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_threads" ADD CONSTRAINT "broker_threads_counterparty_org_id_organizations_id_fk" FOREIGN KEY ("counterparty_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_threads" ADD CONSTRAINT "broker_threads_broker_user_id_users_id_fk" FOREIGN KEY ("broker_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_threads" ADD CONSTRAINT "broker_threads_scope_requirement_id_requirements_id_fk" FOREIGN KEY ("scope_requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_threads" ADD CONSTRAINT "broker_threads_scope_resource_id_bench_resources_id_fk" FOREIGN KEY ("scope_resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_flags" ADD CONSTRAINT "duplicate_flags_resource_a_id_bench_resources_id_fk" FOREIGN KEY ("resource_a_id") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_flags" ADD CONSTRAINT "duplicate_flags_resource_b_id_bench_resources_id_fk" FOREIGN KEY ("resource_b_id") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_flags" ADD CONSTRAINT "duplicate_flags_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_flags" ADD CONSTRAINT "duplicate_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_resource_id_bench_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."bench_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_client_org_id_organizations_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_vendor_org_id_organizations_id_fk" FOREIGN KEY ("vendor_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_margin_approved_by_users_id_fk" FOREIGN KEY ("margin_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_feedback" ADD CONSTRAINT "interview_feedback_relayed_by_users_id_fk" FOREIGN KEY ("relayed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_shortlist_item_id_shortlist_items_id_fk" FOREIGN KEY ("shortlist_item_id") REFERENCES "public"."shortlist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_counterparty_org_id_organizations_id_fk" FOREIGN KEY ("counterparty_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_changes" ADD CONSTRAINT "rate_changes_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_changes" ADD CONSTRAINT "rate_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "assessments_resource_idx" ON "assessments" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "bench_vendor_idx" ON "bench_resources" USING btree ("vendor_org_id");--> statement-breakpoint
CREATE INDEX "bench_status_idx" ON "bench_resources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stage_events_req_idx" ON "requirement_stage_events" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "req_client_idx" ON "requirements" USING btree ("client_org_id");--> statement-breakpoint
CREATE INDEX "req_stage_idx" ON "requirements" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "req_owner_idx" ON "requirements" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "matches_req_idx" ON "matches" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "shortlist_items_shortlist_idx" ON "shortlist_items" USING btree ("shortlist_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_occurred_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "broker_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "threads_party_idx" ON "broker_threads" USING btree ("counterparty_org_id");--> statement-breakpoint
CREATE INDEX "engagements_client_idx" ON "engagements" USING btree ("client_org_id");--> statement-breakpoint
CREATE INDEX "engagements_vendor_idx" ON "engagements" USING btree ("vendor_org_id");--> statement-breakpoint
CREATE INDEX "interviews_req_idx" ON "interviews" USING btree ("requirement_id");