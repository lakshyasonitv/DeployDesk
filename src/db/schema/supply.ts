import {
  pgTable, uuid, text, integer, bigint, numeric, boolean, date, timestamp,
  jsonb, index, primaryKey,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./tenancy";
import {
  resourceStatus, confirmMethod, importStatus, importRowResolution, assessmentStatus,
} from "./enums";

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

export const skills = pgTable("skills", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  label: text().notNull(),
  category: text(),
  aliases: text().array(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts(),
  updatedAt: ts(),
});

export const bulkImports = pgTable("bulk_imports", {
  id: uuid().primaryKey().defaultRandom(),
  vendorOrgId: uuid("vendor_org_id").notNull().references(() => organizations.id),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  filename: text().notNull(),
  objectKey: text("object_key").notNull(),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsListed: integer("rows_listed").notNull().default(0),
  rowsNeedsReview: integer("rows_needs_review").notNull().default(0),
  status: importStatus().notNull().default("parsing"),
  createdAt: ts(),
  updatedAt: ts(),
});

// The most sensitive table in the system. See docs/MASKING.md for per-column visibility.
export const benchResources = pgTable("bench_resources", {
  id: uuid().primaryKey().defaultRandom(),
  vendorOrgId: uuid("vendor_org_id").notNull().references(() => organizations.id),
  maskedId: text("masked_id").notNull().unique(), // TV-4821: random, immutable, never reused
  fullName: text("full_name").notNull(),          // ops + owning vendor only
  employeeCode: text("employee_code"),
  baseCity: text("base_city").notNull(),
  experienceMonths: integer("experience_months").notNull(),
  availableFrom: date("available_from"),          // null means immediate
  noticePeriodDays: integer("notice_period_days"),
  workModes: text("work_modes").array().notNull(),
  vendorRatePaise: paise("vendor_rate_paise").notNull(),
  status: resourceStatus().notNull().default("draft"),
  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }), // drives freshness
  listedAt: timestamp("listed_at", { withTimezone: true }),
  cvObjectKey: text("cv_object_key"),             // ops-only
  contactEmail: text("contact_email"),            // ops + owning vendor only
  contactPhone: text("contact_phone"),            // ops + owning vendor only
  panHash: text("pan_hash"),                      // ops only
  phoneHash: text("phone_hash"),                  // ops only
  emailHash: text("email_hash"),                  // ops only
  githubHandle: text("github_handle"),
  lastProjectNote: text("last_project_note"),
  sourceImportId: uuid("source_import_id").references(() => bulkImports.id),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("bench_vendor_idx").on(t.vendorOrgId),
  index("bench_status_idx").on(t.status),
]);

export const resourceSkills = pgTable("resource_skills", {
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  isPrimary: boolean("is_primary").notNull().default(false),
  years: numeric({ precision: 3, scale: 1 }),
}, (t) => [primaryKey({ columns: [t.resourceId, t.skillId] })]);

export const employmentHistory = pgTable("employment_history", {
  id: uuid().primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id, { onDelete: "cascade" }),
  employerName: text("employer_name").notNull(),
  employerSlug: text("employer_slug").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  title: text(),
  createdAt: ts(),
});

export const availabilityConfirmations = pgTable("availability_confirmations", {
  id: uuid().primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id, { onDelete: "cascade" }),
  confirmedBy: uuid("confirmed_by").notNull().references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  method: confirmMethod().notNull(),
});

export const bulkImportRows = pgTable("bulk_import_rows", {
  id: uuid().primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => bulkImports.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number").notNull(),
  raw: jsonb().notNull(),
  errors: text().array(),
  duplicateOf: uuid("duplicate_of").references(() => benchResources.id),
  resolution: importRowResolution().notNull().default("pending"),
  resourceId: uuid("resource_id").references(() => benchResources.id),
  createdAt: ts(),
});

export const assessments = pgTable("assessments", {
  id: uuid().primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id, { onDelete: "cascade" }),
  provider: text().notNull().default("invigil"),
  providerRef: text("provider_ref"),
  attemptNo: integer("attempt_no").notNull().default(1),
  status: assessmentStatus().notNull().default("not_started"),
  track: text(),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }), // completed_at + 90 days
  overallScore: integer("overall_score"),
  scoreCoding: integer("score_coding"),
  scoreDsa: integer("score_dsa"),
  scoreSystemDesign: integer("score_system_design"),
  scoreCommunication: integer("score_communication"),
  reportObjectKey: text("report_object_key"), // ops-only raw report
  summaryJson: jsonb("summary_json"),         // name-free, safe to surface to a client
  proctoringFlags: jsonb("proctoring_flags"), // ops-only integrity signals
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [index("assessments_resource_idx").on(t.resourceId)]);
