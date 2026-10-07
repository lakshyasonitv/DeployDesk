import {
  pgTable, pgEnum, uuid, text, boolean, timestamp, index, primaryKey, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./tenancy";

/**
 * Dual-role organisations. Created by migration 0002; declared here so Drizzle can query
 * them. See ADR-012.
 *
 * The invariants that are enforced in the DATABASE, not here, and must not be duplicated
 * into application logic where they could drift:
 *   - the Talentvibes org may hold neither capability (trigger `org_capabilities_sync`)
 *   - `organizations.org_type` is DERIVED from capabilities by that same trigger, so no
 *     application code writes it
 *   - `memberships.user_id` is UNIQUE: one user still belongs to exactly one organisation
 */

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const membershipRole = pgEnum("membership_role", ["supply", "demand", "admin"]);
export const kycStatus = pgEnum("kyc_status", ["pending", "in_review", "verified", "rejected"]);

/** Corporate groupings, declared by ops from the MSA. NEVER inferred from PAN or GSTIN. */
export const groups = pgTable("groups", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  notes: text(), // which MSA declared this grouping
  createdAt: ts(),
  updatedAt: ts(),
});

/**
 * The authoritative record of what an organisation may do.
 * `organizations.org_type` is derived from this, not the other way round.
 */
export const orgCapabilities = pgTable("org_capabilities", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  canSupply: boolean("can_supply").notNull().default(false),
  canHire: boolean("can_hire").notNull().default(false),
  updatedBy: uuid("updated_by").references(() => users.id), // ops only, per the RLS policy
  createdAt: ts(),
  updatedAt: ts(),
});

/**
 * A membership holds a SET of roles. One user, one organisation — the UNIQUE on user_id
 * is the part of the old model ADR-012 deliberately kept.
 */
export const memberships = pgTable("memberships", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  roles: membershipRole("roles").array().notNull().default(sql`'{}'`),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("memberships_org_idx").on(t.orgId),
  check("memberships_roles_not_empty", sql`array_length(${t.roles}, 1) >= 1`),
]);

/**
 * Applies in BOTH directions. One row hides each organisation from the other, so every
 * query has to test both columns — use the `orgs_are_blocked(a, b)` SQL helper rather
 * than writing the pair of comparisons by hand.
 */
export const orgBlocks = pgTable("org_blocks", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  blockedOrgId: uuid("blocked_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reason: text(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.blockedOrgId] }),
  index("org_blocks_blocked_idx").on(t.blockedOrgId),
  check("org_blocks_not_self", sql`${t.orgId} <> ${t.blockedOrgId}`),
]);
