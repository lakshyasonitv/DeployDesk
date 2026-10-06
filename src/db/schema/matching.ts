import {
  pgTable, uuid, text, integer, bigint, boolean, date, timestamp, index, unique,
} from "drizzle-orm/pg-core";
import { users } from "./tenancy";
import { benchResources } from "./supply";
import { requirements } from "./demand";
import { matchEligibility, clientDecision, availabilityKind } from "./enums";

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

// The ops-side candidate pool for one requirement. NEVER exposed to a client.
// margin_pct is derived, never stored:
//   (proposed_client_rate - vendor_rate) / proposed_client_rate * 100
export const matches = pgTable("matches", {
  id: uuid().primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id, { onDelete: "cascade" }),
  algoScore: integer("algo_score").notNull(),
  scoreSkill: integer("score_skill").notNull(),
  scoreTest: integer("score_test").notNull(),
  scoreExpFit: integer("score_exp_fit").notNull(),
  scoreRate: integer("score_rate").notNull(),
  scoreFreshness: integer("score_freshness").notNull(),
  scoreVendor: integer("score_vendor").notNull(),
  reasonLine: text("reason_line"),
  algoRank: integer("algo_rank").notNull(),
  manualRank: integer("manual_rank"), // null means follow algo_rank
  included: boolean().notNull().default(false),
  hidden: boolean().notNull().default(false),
  proposedClientRatePaise: paise("proposed_client_rate_paise"),
  eligibility: matchEligibility().notNull().default("eligible"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  unique("matches_req_resource_uq").on(t.requirementId, t.resourceId),
  index("matches_req_idx").on(t.requirementId),
]);

export const shortlists = pgTable("shortlists", {
  id: uuid().primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "cascade" }),
  sequenceNo: integer("sequence_no").notNull(),
  sentBy: uuid("sent_by").notNull().references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  brokerNote: text("broker_note"),
  openedAt: timestamp("opened_at", { withTimezone: true }), // powers "client has not opened it yet"
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [unique("shortlists_req_seq_uq").on(t.requirementId, t.sequenceNo)]);

// THE CLIENT-FACING SNAPSHOT (ADR-009).
// The client shortlist endpoint reads from here and nowhere else. This table
// structurally cannot leak: there is no vendor column and no vendor rate column.
// rate_band_* is derived from the CLIENT rate only, per ADR-004 and docs/MASKING.md.
export const shortlistItems = pgTable("shortlist_items", {
  id: uuid().primaryKey().defaultRandom(),
  shortlistId: uuid("shortlist_id").notNull().references(() => shortlists.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => benchResources.id), // join key, NEVER serialised
  maskedId: text("masked_id").notNull(),
  position: integer().notNull(),
  experienceMonths: integer("experience_months").notNull(),
  baseCity: text("base_city").notNull(),
  skillsSnapshot: text("skills_snapshot").array().notNull(),
  scoreOverall: integer("score_overall"),
  scoreCoding: integer("score_coding"),
  scoreDsa: integer("score_dsa"),
  scoreSystemDesign: integer("score_system_design"),
  scoreCommunication: integer("score_communication"),
  assessmentAttemptNo: integer("assessment_attempt_no"),
  assessmentTestedOn: date("assessment_tested_on"),
  availabilityLabel: text("availability_label").notNull(),
  availabilityKind: availabilityKind("availability_kind").notNull(),
  rateBandMinPaise: paise("rate_band_min_paise").notNull(),
  rateBandMaxPaise: paise("rate_band_max_paise").notNull(),
  clientDecision: clientDecision("client_decision").notNull().default("pending"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [index("shortlist_items_shortlist_idx").on(t.shortlistId)]);
