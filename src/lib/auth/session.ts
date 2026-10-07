import { eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "../../db/client";
import * as s from "../../db/schema";
import {
  getOrgCapabilities, requiredCapability, workspaceTabs,
  type WorkspaceTab, type Portal,
} from "./workspace";

/**
 * DEMO SESSION — stands in for Supabase Auth for the demo build.
 *
 * What this is NOT: it is not a security boundary, and it does not weaken the masking
 * model. Masking is enforced by the portal-specific read models, which take an org id
 * and return only the fields that portal may see. This module's only job is to decide
 * WHICH org id to pass.
 *
 * What production replaces it with (docs/BUILD-PLAN.md Phase 1):
 *   1. a valid Supabase session;
 *   2. a portal check — the caller must hold the CAPABILITY the namespace requires, and a
 *      mismatch is a 404, not a 403, so the route's existence is not confirmed;
 *   3. an ownership check on every row.
 *
 * Step 2 is the one this file currently skips enforcing as a 404: the demo lets a viewer
 * open all three portals, exactly as the design prototype's portal switcher does.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD KEYS ON CAPABILITIES, NOT `org_type` — this changed in Sprint 6
 * ---------------------------------------------------------------------------
 *
 * This file used to assert `org_type === portal`. That is wrong for a dual-role
 * organisation and it silently blocked the entire feature:
 *
 *   migration 0002 collapses two booleans into one enum, and resolves
 *   `can_supply AND can_hire` to `'vendor'`.
 *
 * So Cygnet Infotech Labs — which both supplies and hires — reads as `'vendor'`, and
 * `getDemoSession("client")` threw "is vendor, not client" for the one organisation whose
 * hiring workspace the dual-role brief is about. `org_capabilities` is authoritative
 * (ADR-012); `org_type` is a display convenience. The mapping lives in
 * `requiredCapability()` in ./workspace.ts and nowhere else.
 */

export type { Portal, WorkspaceTab };

export interface DemoSession {
  portal: Portal;
  orgId: string;
  orgName: string;
  userId: string;
  userName: string;
  role: string;
}

/**
 * The demo identities. Three are the tenants from docs/SEED-DATA.md; the fourth is the
 * dual-role organisation, without which acceptance test 2 ("a dual-role user can switch
 * workspaces and each side shows only its own rate") has no data to run against in the UI.
 *
 * Cygnet appears under BOTH `client` and `vendor` on purpose — that is what dual-role
 * means, and it is only reachable because the guard above now keys on capabilities.
 */
const DEMO_TENANT: Record<Portal, { orgName: string; email: string }> = {
  client: { orgName: "Acme Finserv", email: "ananya.krishnan@acmefinserv.com" },
  vendor: { orgName: "Nimbus Softworks", email: "vikram.shetty@nimbussoftworks.com" },
  ops: { orgName: "Talentvibes", email: "priya.nair@talentvibes.com" },
};

/** The organisation the demo is currently "acting as", if the viewer chose one. */
const ACTING_COOKIE = "tvbx-demo-org";

/**
 * Identities the demo may act as, for the top-bar switcher.
 *
 * `sides` is derived from capabilities at runtime, never hardcoded, so flipping
 * `can_hire` in the database changes this list — which is what makes acceptance test 6
 * ("revoking a capability removes the workspace") real rather than staged.
 */
export async function getDemoIdentities(): Promise<
  Array<{ orgId: string; orgName: string; canSupply: boolean; canHire: boolean; isOps: boolean }>
> {
  const rows = await db
    .select({
      orgId: s.organizations.id,
      orgName: s.organizations.name,
      orgType: s.organizations.orgType,
      canSupply: s.orgCapabilities.canSupply,
      canHire: s.orgCapabilities.canHire,
    })
    .from(s.organizations)
    .innerJoin(s.orgCapabilities, eq(s.orgCapabilities.orgId, s.organizations.id))
    .where(inArray(s.organizations.name, [
      "Acme Finserv",          // client only
      "Nimbus Softworks",      // vendor only
      "Cygnet Infotech Labs",  // DUAL ROLE
      "Talentvibes",           // the broker
    ]));

  return rows.map((r) => ({
    orgId: r.orgId,
    orgName: r.orgName,
    canSupply: r.canSupply,
    canHire: r.canHire,
    isOps: r.orgType === "talentvibes",
  }));
}

async function actingOrgId(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(ACTING_COOKIE)?.value ?? null;
  } catch {
    // cookies() throws outside a request scope (a script, a test). Fall back to defaults.
    return null;
  }
}

/**
 * Resolve the user to act as within an organisation for a given portal.
 *
 * Picks a user whose membership actually holds the side's role, so a dual-role company's
 * hiring workspace is viewed as someone entitled to see it. Prefers an admin, who holds
 * both sides.
 */
async function pickUser(orgId: string, portal: Portal) {
  const rows = await db
    .select({
      userId: s.users.id,
      userName: s.users.fullName,
      role: s.users.role,
      roles: s.memberships.roles,
    })
    .from(s.users)
    .leftJoin(s.memberships, eq(s.memberships.userId, s.users.id))
    .where(eq(s.users.orgId, orgId));

  if (!rows.length) return null;

  const want = portal === "client" ? "demand" : portal === "vendor" ? "supply" : "admin";
  const holds = (r: (typeof rows)[number], k: string) =>
    ((r.roles ?? []) as string[]).includes(k);

  return (
    rows.find((r) => holds(r, "admin") && holds(r, want))
    ?? rows.find((r) => holds(r, want))
    ?? rows.find((r) => holds(r, "admin"))
    ?? rows[0]
  );
}

export async function getDemoSession(portal: Portal): Promise<DemoSession> {
  const acting = await actingOrgId();

  /* ------------------------------------------------- acting as a chosen org */

  if (acting) {
    const [org] = await db
      .select({
        orgId: s.organizations.id,
        orgName: s.organizations.name,
        orgType: s.organizations.orgType,
      })
      .from(s.organizations)
      .where(eq(s.organizations.id, acting))
      .limit(1);

    if (org) {
      const need = requiredCapability(portal);
      const caps = await getOrgCapabilities(org.orgId);
      const permitted = need ? caps[need] : org.orgType === "talentvibes";

      // If the chosen org cannot act on this side, fall through to the default tenant
      // rather than throwing. The viewer picked an organisation, not a portal, and
      // landing them on an error page for a combination that simply does not exist is
      // worse than showing them the portal's own tenant.
      if (permitted) {
        const u = await pickUser(org.orgId, portal);
        if (u) {
          return {
            portal,
            orgId: org.orgId,
            orgName: org.orgName,
            userId: u.userId,
            userName: u.userName,
            role: u.role,
          };
        }
      }
    }
  }

  /* --------------------------------------------------- the default tenant */

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

  /**
   * The invariant the real guard will enforce — now on CAPABILITIES, not `org_type`.
   * See the header: `org_type` collapses a dual-role org to 'vendor', so asserting
   * `org_type === portal` refuses that org its own hiring workspace.
   */
  const need = requiredCapability(portal);
  if (need) {
    const caps = await getOrgCapabilities(row.orgId);
    if (!caps[need]) {
      throw new Error(
        `Demo session mismatch: ${tenant.email}'s organisation lacks ${need} for the `
        + `${portal} portal. Run \`npm run db:seed\`.`,
      );
    }
  } else if (row.orgType !== "talentvibes") {
    throw new Error(`Demo session mismatch: ${tenant.email} is not the broker`);
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
 * Everything the shell needs, in one call.
 *
 * Pages used to call `getPortalSwitcherOptions()` on its own. The dual-role workspace
 * tabs need the SESSION (org + user), so returning both together keeps each page at one
 * await instead of two and keeps the ordering obvious.
 */
export interface DemoIdentity {
  orgId: string;
  orgName: string;
  href: string;
  /** "Supplies", "Hires", "Both sides" or "Broker" — what this org may do. */
  role: string;
  active: boolean;
}

export async function getShellNav(session: DemoSession): Promise<{
  identities: DemoIdentity[];
  workspaces: WorkspaceTab[];
}> {
  const [rows, workspaces] = await Promise.all([
    getDemoIdentities(),
    workspaceTabs(session.orgId, session.userId, session.portal),
  ]);

  /**
   * The demo control lists ORGANISATIONS, not portals.
   *
   * It used to list the three portals, which could not express the case the dual-role
   * brief is about: Cygnet Infotech Labs is one organisation that appears on two sides,
   * and "Client / Vendor / Ops" has no way to say that. Picking an organisation and
   * letting the workspace tabs choose the side is both more capable and closer to
   * production, where a user has exactly one organisation and no portal choice at all.
   */
  const identities = rows
    .map((r) => {
      const landing = r.isOps ? "/ops" : r.canHire && !r.canSupply ? "/client" : "/vendor";
      return {
        orgId: r.orgId,
        orgName: r.orgName,
        href: `/demo/act-as?org=${r.orgId}&to=${landing}`,
        role: r.isOps
          ? "Broker"
          : r.canSupply && r.canHire ? "Both sides"
          : r.canSupply ? "Supplies" : "Hires",
        active: r.orgId === session.orgId,
      };
    })
    // Broker last: it is the internal console, not a party to the exchange.
    .sort((a, b) => Number(a.role === "Broker") - Number(b.role === "Broker"));

  return { identities, workspaces };
}

/**
 * The demo portal switcher's labels, resolved from the database.
 *
 * These used to be a hardcoded list ("Client · Acme Finserv") in Shell.tsx, which meant
 * renaming an organisation left the switcher showing the old name. In production the
 * switcher does not exist at all — a user belongs to one organisation and auth decides
 * which shell they get. The DUAL-ROLE workspace switcher is a different thing and IS a
 * production feature (ADR-012): it stays inside one organisation and changes which side
 * you are looking at. Do not merge the two.
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

export { ACTING_COOKIE };
