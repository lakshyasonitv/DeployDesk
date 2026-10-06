import {
  pgTable, uuid, text, integer, bigint, boolean, date, timestamp, index, primaryKey,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./tenancy";
import { skills } from "./supply";
import { experienceBand, engagementType, workMode, requirementStage } from "./enums";

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

// Not stored, by design: value_per_month, age, sla_state, sourced_count.
// All four are derived on read. See working agreement 4 in CLAUDE.md.
export const requirements = pgTable("requirements", {
  id: uuid().primaryKey().defaultRandom(),
  code: text().notNull().unique(), // REQ-2291
  clientOrgId: uuid("client_org_id").notNull().references(() => organizations.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  ownerUserId: uuid("owner_user_id").references(() => users.id), // the ops broker
  roleTitle: text("role_title").notNull(),
  quantity: integer().notNull().default(1),
  experienceBand: experienceBand("experience_band").notNull(),
  budgetMinPaise: paise("budget_min_paise").notNull(),
  budgetMaxPaise: paise("budget_max_paise").notNull(),
  engagementType: engagementType("engagement_type").notNull(),
  durationText: text("duration_text"),
  locationCity: text("location_city"),
  workMode: workMode("work_mode").notNull(),
  hybridDays: integer("hybrid_days"),
  startDate: date("start_date"),
  noticeAccepted: text("notice_accepted").array().notNull(),
  clientNote: text("client_note"), // CLIENT + OPS ONLY. Never reaches a vendor response.
  stage: requirementStage().notNull().default("draft"),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  /**
   * Overrides the per-stage SLA window from docs/DOMAIN.md. NULL falls back to the
   * default for the stage. Added by migration 0002: a `warn` requirement in the 4-hour
   * `new` window had under an hour of runway and aged into `late` within the hour, so
   * the window has to be a property of the requirement, not only of its stage.
   */
  slaWindowHours: integer("sla_window_hours"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("req_client_idx").on(t.clientOrgId),
  index("req_stage_idx").on(t.stage),
  index("req_owner_idx").on(t.ownerUserId),
]);

export const requirementSkills = pgTable("requirement_skills", {
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id),
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.requirementId, t.skillId] })]);

export const requirementStageEvents = pgTable("requirement_stage_events", {
  id: uuid().primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").notNull().references(() => requirements.id, { onDelete: "cascade" }),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  actorId: uuid("actor_id").references(() => users.id), // null for system moves
  reason: text(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("stage_events_req_idx").on(t.requirementId)]);
