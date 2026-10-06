import { pgEnum } from "drizzle-orm/pg-core";

// Enum names mirror docs/DATA-MODEL.md exactly. Adding a value is a new migration.
export const orgType = pgEnum("org_type", ["client", "vendor", "talentvibes"]);
export const orgStatus = pgEnum("org_status", ["active", "suspended", "onboarding"]);
export const userRole = pgEnum("user_role", [
  "client_admin", "hiring_manager", "panel_member",
  "vendor_admin", "bench_manager",
  "ops_admin", "broker", "finance",
]);
export const userStatus = pgEnum("user_status", ["active", "invited", "disabled"]);

export const resourceStatus = pgEnum("resource_status", [
  "draft", "listed", "in_process", "deployed", "withdrawn", "archived",
]);
export const confirmMethod = pgEnum("confirm_method", ["single", "bulk", "api", "email_link"]);
export const importStatus = pgEnum("import_status", [
  "parsing", "review_pending", "completed", "failed",
]);
export const importRowResolution = pgEnum("import_row_resolution", [
  "pending", "listed", "rejected", "merged",
]);

export const assessmentStatus = pgEnum("assessment_status", [
  "not_started", "invited", "in_progress", "scored", "expired", "abandoned",
]);

export const experienceBand = pgEnum("experience_band", ["0-3", "3-5", "5-8", "8+"]);
export const engagementType = pgEnum("engagement_type", ["contract", "c2h", "full_time"]);
export const workMode = pgEnum("work_mode", ["onsite", "hybrid", "remote"]);
export const requirementStage = pgEnum("requirement_stage", [
  "draft", "new", "matching", "shortlisted", "interviewing", "placed", "closed", "cancelled",
]);

export const matchEligibility = pgEnum("match_eligibility", [
  "eligible", "blocked_stale", "blocked_score_expired", "blocked_duplicate", "blocked_deployed",
]);
export const clientDecision = pgEnum("client_decision", ["pending", "selected", "passed"]);
export const availabilityKind = pgEnum("availability_kind", ["immediate", "dated", "notice"]);

export const interviewStatus = pgEnum("interview_status", [
  "proposed", "awaiting_vendor", "confirmed", "completed", "cancelled", "no_show",
]);
export const interviewMode = pgEnum("interview_mode", ["video", "onsite", "phone"]);
export const feedbackOutcome = pgEnum("feedback_outcome", ["advance", "hold", "pass"]);

export const engagementStatus = pgEnum("engagement_status", [
  "onboarding", "active", "ending", "ended", "terminated",
]);
export const rateSide = pgEnum("rate_side", ["vendor", "client"]);
export const invoiceDirection = pgEnum("invoice_direction", ["receivable", "payable"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "issued", "paid", "void"]);

export const threadSide = pgEnum("thread_side", ["client", "vendor"]);
export const threadScope = pgEnum("thread_scope", ["general", "requirement", "candidate", "interview"]);
export const threadStatus = pgEnum("thread_status", ["open", "closed"]);
export const senderSide = pgEnum("sender_side", ["client", "vendor", "ops"]);

export const duplicateStatus = pgEnum("duplicate_status", [
  "open", "kept_a", "kept_b", "not_duplicate",
]);
