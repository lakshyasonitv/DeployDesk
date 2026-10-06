import { pgTable, uuid, text, integer, numeric, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { orgType, orgStatus, userRole, userStatus } from "./enums";

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  orgType: orgType("org_type").notNull(),
  name: text().notNull(),
  publicCode: text("public_code").unique(), // NSW-0142 for vendors
  status: orgStatus().notNull().default("onboarding"),
  billingAddress: jsonb("billing_address"),
  gstin: text(),
  createdAt: ts(),
  updatedAt: ts(),
});

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(), // matches Supabase auth.users.id
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text().notNull().unique(),
  fullName: text("full_name").notNull(),
  role: userRole().notNull(),
  status: userStatus().notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [index("users_org_idx").on(t.orgId)]);

export const vendorProfiles = pgTable("vendor_profiles", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id),
  reliabilityScore: numeric("reliability_score", { precision: 2, scale: 1 }),
  placementsCount: integer("placements_count").notNull().default(0),
  withdrawalCount: integer("withdrawal_count").notNull().default(0),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  notesInternal: text("notes_internal"), // ops only
  createdAt: ts(),
  updatedAt: ts(),
});

export const clientProfiles = pgTable("client_profiles", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id),
  accountOwnerId: uuid("account_owner_id").references(() => users.id),
  defaultNoticeAccepted: text("default_notice_accepted").array(),
  createdAt: ts(),
  updatedAt: ts(),
});
