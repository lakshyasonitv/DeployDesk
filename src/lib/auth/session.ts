import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";

/**
 * DEMO SESSION — stands in for Supabase Auth for today's demo build.
 *
 * What this is NOT: it is not a security boundary, and it does not weaken the masking
 * model. Masking is enforced by the portal-specific read models, which take an org id
 * and return only the fields that portal may see. This module's only job is to decide
 * WHICH org id to pass.
 *
 * What production replaces it with (docs/BUILD-PLAN.md Phase 1):
 *   1. a valid Supabase session;
 *   2. a portal check — the caller's org_type must match the route namespace, and a
 *      mismatch is a 404, not a 403, so the route's existence is not confirmed;
 *   3. an ownership check on every row.
 *
 * Step 2 is the one this file currently skips: the demo lets a viewer open all three
 * portals, exactly as the design prototype's portal switcher does. The switcher is
 * flagged in the design handoff as a demo affordance with no production equivalent.
 */

export type Portal = "client" | "vendor" | "ops";

export interface DemoSession {
  portal: Portal;
  orgId: string;
  orgName: string;
  userId: string;
  userName: string;
  role: string;
}

/** The three demo tenants from docs/SEED-DATA.md. */
const DEMO_TENANT: Record<Portal, { orgName: string; email: string }> = {
  client: { orgName: "Acme Finserv", email: "ananya.krishnan@acmefinserv.com" },
  vendor: { orgName: "Nimbus Softworks", email: "vikram.shetty@nimbussoftworks.com" },
  ops: { orgName: "Talentvibes", email: "priya.nair@talentvibes.com" },
};

export async function getDemoSession(portal: Portal): Promise<DemoSession> {
  const tenant = DEMO_TENANT[portal];

  const [row] = await db
    .select({
      userId: s.users.id,
      userName: s.users.fullName,
      role: s.users.role,
      orgId: s.organizations.id,
      orgName: s.organizations.name,
      orgType: s.organizations.orgType,
    })
    .from(s.users)
    .innerJoin(s.organizations, eq(s.organizations.id, s.users.orgId))
    .where(eq(s.users.email, tenant.email))
    .limit(1);

  if (!row) {
    throw new Error(
      `Demo session unavailable: no user ${tenant.email}. Run \`npm run db:seed\`.`,
    );
  }

  // The invariant the real guard will enforce: the org type must match the namespace.
  const expected = portal === "ops" ? "talentvibes" : portal;
  if (row.orgType !== expected) {
    throw new Error(`Demo session mismatch: ${tenant.email} is ${row.orgType}, not ${expected}`);
  }

  return {
    portal,
    orgId: row.orgId,
    orgName: row.orgName,
    userId: row.userId,
    userName: row.userName,
    role: row.role,
  };
}


/**
 * The demo portal switcher's labels, resolved from the database.
 *
 * These used to be a hardcoded list ("Client · Acme Finserv") in Shell.tsx, which meant
 * renaming an organisation left the switcher showing the old name. In production the
 * switcher is driven by org_capabilities (ADR-012) and only appears for an organisation
 * holding more than one capability.
 */
export async function getPortalSwitcherOptions(): Promise<
  Array<{ portal: Portal; href: string; label: string }>
> {
  // ONE query for all three, not one per portal. A loop of three here would have added
  // three round trips to every page in the app, which is the opposite of the point.
  const emails = (["client", "vendor", "ops"] as Portal[]).map((p) => DEMO_TENANT[p].email);
  const rows = await db
    .select({ email: s.users.email, orgName: s.organizations.name })
    .from(s.users)
    .innerJoin(s.organizations, eq(s.organizations.id, s.users.orgId))
    .where(inArray(s.users.email, emails));

  const byEmail = new Map(rows.map((r) => [r.email, r.orgName]));

  return (["client", "vendor", "ops"] as Portal[])
    .map((portal) => {
      const orgName = byEmail.get(DEMO_TENANT[portal].email);
      if (!orgName) return null;
      return {
        portal,
        href: `/${portal}`,
        label: portal === "ops" ? `${orgName} Ops` : `${title(portal)} · ${orgName}`,
      };
    })
    .filter((x): x is { portal: Portal; href: string; label: string } => x !== null);
}

const title = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
