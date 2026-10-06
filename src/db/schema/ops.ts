import {
  pgTable, uuid, text, integer, bigint, boolean, date, timestamp, jsonb,
  index, unique, primaryKey,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./tenancy";
import { benchResources } from "./supply";
import { requirements } from "./demand";
import { shortlistItems } from "./matching";
import {
  interviewStatus, interviewMode, feedbackOutcome, engagementStatus, rateSide,
  invoiceDirection, invoiceStatus, threadSide, threadScope, threadStatus, senderSide,
  duplicateStatus,
} from "./enums";

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

/* ---------- interviews ---------- */

export const interviews = pgTable("interviews", {
  id: uuid().primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "cascade" }),
  shortlistItemId: uuid("shortlist_item_id").notNull().references(() => shortlistItems.id, { onDelete: "cascade" }),
  roundNo: integer("round_no").notNull(),
  status: interviewStatus().notNull().default("proposed"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  mode: interviewMode(),
  locationText: text("location_text"),
  meetingUrl: text("meeting_url"), // ALWAYS issued by Talentvibes, never a vendor domain
  proposedSlots: jsonb("proposed_slots"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [index("interviews_req_idx").on(t.requirementId)]);

// Client-side names. Never relayed to a vendor.
export const interviewPanelists = pgTable("interview_panelists", {
  interviewId: uuid("interview_id").notNull().references(() => interviews.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  displayName: text("display_name").notNull(),
  title: text(),
}, (t) => [primaryKey({ columns: [t.interviewId, t.displayName] })]);

export const interviewFeedback = pgTable("interview_feedback", {
  id: uuid().primaryKey().defaultRandom(),
  interviewId: uuid("interview_id").notNull().references(() => interviews.id, { onDelete: "cascade" }),
  submittedBy: uuid("submitted_by").references(() => users.id),
  ratingTechnicalDepth: integer("rating_technical_depth"),
  ratingProblemSolving: integer("rating_problem_solving"),
  ratingCommunication: integer("rating_communication"),
  ratingRoleFit: integer("rating_role_fit"),
  notes: text(), // verbatim, client + ops only
  outcome: feedbackOutcome(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  relayedAt: timestamp("relayed_at", { withTimezone: true }),
  relayedSummary: text("relayed_summary"), // redacted version sent to the vendor
  relayedBy: uuid("relayed_by").references(() => users.id),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: ts(),
  updatedAt: ts(),
});

/* ---------- placements and money ---------- */

// spread and margin_pct are DERIVED, never stored. One row models both contracts;
// neither side's API ever sees the other side's rate column.
export const engagements = pgTable("engagements", {
  id: uuid().primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").references(() => requirements.id),
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id),
  clientOrgId: uuid("client_org_id").notNull().references(() => organizations.id),
  vendorOrgId: uuid("vendor_org_id").notNull().references(() => organizations.id),
  roleTitle: text("role_title").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  status: engagementStatus().notNull().default("onboarding"),
  vendorRatePaise: paise("vendor_rate_paise").notNull(),
  clientRatePaise: paise("client_rate_paise").notNull(),
  marginApprovedBy: uuid("margin_approved_by").references(() => users.id),
  marginExceptionNote: text("margin_exception_note"),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("engagements_client_idx").on(t.clientOrgId),
  index("engagements_vendor_idx").on(t.vendorOrgId),
]);

export const rateChanges = pgTable("rate_changes", {
  id: uuid().primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  side: rateSide().notNull(),
  oldPaise: paise("old_paise"),
  newPaise: paise("new_paise").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  reason: text(),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: ts(),
});

export const invoices = pgTable("invoices", {
  id: uuid().primaryKey().defaultRandom(),
  counterpartyOrgId: uuid("counterparty_org_id").notNull().references(() => organizations.id),
  direction: invoiceDirection().notNull(),
  periodMonth: date("period_month").notNull(),
  status: invoiceStatus().notNull().default("draft"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  totalPaise: paise("total_paise").notNull().default(0),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [unique("invoices_party_dir_month_uq").on(t.counterpartyOrgId, t.direction, t.periodMonth)]);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid().primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  engagementId: uuid("engagement_id").notNull().references(() => engagements.id),
  description: text().notNull(),
  daysBilled: integer("days_billed"),
  daysInMonth: integer("days_in_month"),
  amountPaise: paise("amount_paise").notNull(),
  isProrata: boolean("is_prorata").notNull().default(false),
  createdAt: ts(),
});

/* ---------- brokering: two threads, never one (ADR-008) ---------- */

export const brokerThreads = pgTable("broker_threads", {
  id: uuid().primaryKey().defaultRandom(),
  side: threadSide().notNull(),
  counterpartyOrgId: uuid("counterparty_org_id").notNull().references(() => organizations.id),
  brokerUserId: uuid("broker_user_id").notNull().references(() => users.id),
  scopeType: threadScope("scope_type").notNull().default("general"),
  scopeRequirementId: uuid("scope_requirement_id").references(() => requirements.id),
  scopeResourceId: uuid("scope_resource_id").references(() => benchResources.id),
  scopeLabel: text("scope_label").notNull(),
  linkedThreadId: uuid("linked_thread_id"), // the counterpart; ops-visible only
  status: threadStatus().notNull().default("open"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [index("threads_party_idx").on(t.counterpartyOrgId)]);

export const brokerMessages = pgTable("broker_messages", {
  id: uuid().primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => brokerThreads.id, { onDelete: "cascade" }),
  senderUserId: uuid("sender_user_id").notNull().references(() => users.id),
  senderSide: senderSide("sender_side").notNull(),
  body: text().notNull(),
  relayedFromId: uuid("relayed_from_id"), // set on the redacted counterpart copy
  redactionNote: text("redaction_note"),  // ops-only: what was removed and why
  readAt: timestamp("read_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("messages_thread_idx").on(t.threadId)]);

/* ---------- duplicates ---------- */

export const duplicateFlags = pgTable("duplicate_flags", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(), // DUP-0148
  resourceAId: uuid("resource_a_id").notNull().references(() => benchResources.id), // earlier submission
  resourceBId: uuid("resource_b_id").notNull().references(() => benchResources.id),
  confidence: integer().notNull(),
  signals: jsonb().notNull(),
  status: duplicateStatus().notNull().default("open"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  blocksRequirements: uuid("blocks_requirements").array(),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: ts(),
  updatedAt: ts(),
});

/* ---------- cross-cutting ---------- */

// Append-only. Every stage, rate, shortlist and duplicate resolution writes a row.
export const auditLog = pgTable("audit_log", {
  id: uuid().primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id), // null for system
  actorOrgId: uuid("actor_org_id").references(() => organizations.id),
  action: text().notNull(), // 'shortlist.sent', 'requirement.stage_changed'
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  before: jsonb(),
  after: jsonb(),
  context: jsonb(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_entity_idx").on(t.entityType, t.entityId),
  index("audit_occurred_idx").on(t.occurredAt),
]);

// Tagged sensitive columns. A build step fails if a tagged column appears in a
// client or vendor view definition. See docs/MASKING.md, enforcement item 4.
export const sensitiveColumns = pgTable("sensitive_columns", {
  tableName: text("table_name").notNull(),
  columnName: text("column_name").notNull(),
  visibleTo: text("visible_to").array().notNull(), // {'ops'}, {'ops','vendor_own'}
  reason: text(),
}, (t) => [primaryKey({ columns: [t.tableName, t.columnName] })]);
