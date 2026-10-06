import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";

/**
 * Capabilities, membership roles, and the dual-role workspace switcher.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: `org_type` cannot answer "may this org hire?"
 * ---------------------------------------------------------------------------
 *
 * Migration 0002 derives `organizations.org_type` from `org_capabilities`, and it has to
 * collapse two booleans into one enum. It resolves a dual-role organisation to `'vendor'`:
 *
 *     WHEN can_supply AND can_hire THEN 'vendor'
 *
 * So `org_type` is a LOSSY projection. Cygnet Infotech Labs both supplies and hires, and
 * reads as `'vendor'`. Any guard of the form `org_type === portal` therefore refuses a
 * dual-role organisation its own hiring workspace — which is precisely the case the
 * dual-role brief exists to support.
 *
 * The correct invariant, and the one production must enforce too:
 *
 *     portal 'client' requires can_hire
 *     portal 'vendor' requires can_supply
 *     portal 'ops'    requires org_type = 'talentvibes'
 *
 * `org_capabilities` is the authoritative record (ADR-012); `org_type` is a display
 * convenience and must never gate access. `requiredCapability()` below is the single
 * place that mapping lives.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT GOVERNS THE WHOLE FEATURE
 * ---------------------------------------------------------------------------
 *
 * A supply-only organisation must see ONE workspace and NO HINT that a hiring side
 * exists — not a disabled tab, not a greyed switcher, nothing. A locked door tells you
 * there is a room. `workspaceTabs()` returns an EMPTY array rather than one tab for
 * exactly this reason: the shell renders nothing at all when there is nothing to switch
 * between, instead of rendering a single inert tab.
 *
 * And separately, from docs/MASKING.md: the two rate views must never appear on the same
 * screen for the same organisation. That is a per-screen constraint, not a per-org one —
 * the switcher is safe because it NAVIGATES between workspaces. A combined dashboard may
 * show bench counts beside hiring counts, but never a vendor rate beside a client rate.
 */

export type Portal = "client" | "vendor" | "ops";
export type Side = "hiring" | "bench";
export type MembershipRole = "supply" | "demand" | "admin";

export interface OrgCapabilities {
  canSupply: boolean;
  canHire: boolean;
}

export interface WorkspaceTab {
  side: Side;
  label: string;
  href: string;
  active: boolean;
}

/** Which capability a portal namespace requires. `null` = not capability-gated. */
export function requiredCapability(portal: Portal): keyof OrgCapabilities | null {
  if (portal === "client") return "canHire";
  if (portal === "vendor") return "canSupply";
  return null; // ops is gated on org_type = 'talentvibes', not on a capability
}

/**
 * What this organisation may do. Absent row means neither — fail closed.
 *
 * A missing `org_capabilities` row is not "unknown, allow it": migration 0002 backfilled
 * every organisation and the seed owns the table, so a gap means something is wrong and
 * the safe answer reveals less.
 */
export async function getOrgCapabilities(orgId: string): Promise<OrgCapabilities> {
  const [row] = await db
    .select({
      canSupply: s.orgCapabilities.canSupply,
      canHire: s.orgCapabilities.canHire,
    })
    .from(s.orgCapabilities)
    .where(eq(s.orgCapabilities.orgId, orgId))
    .limit(1);

  return { canSupply: row?.canSupply ?? false, canHire: row?.canHire ?? false };
}

/**
 * The roles this user holds. ADR-012: one user, one organisation, a SET of roles.
 *
 * Absent membership means no roles, which collapses the switcher — again failing closed.
 */
export async function getMembershipRoles(userId: string): Promise<MembershipRole[]> {
  const [row] = await db
    .select({ roles: s.memberships.roles })
    .from(s.memberships)
    .where(eq(s.memberships.userId, userId))
    .limit(1);

  return (row?.roles ?? []) as MembershipRole[];
}

/**
 * A side is available only where the ORGANISATION holds the capability AND the USER holds
 * the matching role.
 *
 * Both halves matter and they fail differently. At a dual-role company the org holds both
 * capabilities, but a bench manager holds only `supply` — they must not see the hiring
 * side, because the company's commercial terms as a buyer are not theirs to read. An
 * `admin` at the same company holds both and sees both.
 */
export function availableSides(caps: OrgCapabilities, roles: MembershipRole[]): Side[] {
  const isAdmin = roles.includes("admin");
  const sides: Side[] = [];
  if (caps.canSupply && (isAdmin || roles.includes("supply"))) sides.push("bench");
  if (caps.canHire && (isAdmin || roles.includes("demand"))) sides.push("hiring");
  return sides;
}

/** Where each side's workspace lives. */
const SIDE_HREF: Record<Side, string> = { hiring: "/client", bench: "/vendor" };
const SIDE_LABEL: Record<Side, string> = { hiring: "Hiring", bench: "Bench" };

/** Which side a portal namespace represents. Ops is neither. */
export function sideOfPortal(portal: Portal): Side | null {
  if (portal === "client") return "hiring";
  if (portal === "vendor") return "bench";
  return null;
}

/**
 * The "Hiring | Bench" tabs, or an EMPTY ARRAY when there is nothing to switch between.
 *
 * Returning `[]` for the single-side case is the whole point — see the "no hint" rule in
 * the file header. Callers must render nothing when this is empty, not a lone tab.
 */
export async function workspaceTabs(
  orgId: string,
  userId: string,
  portal: Portal,
): Promise<WorkspaceTab[]> {
  // Ops is the broker's own console. It is not a side of the exchange and the trigger in
  // migration 0002 forbids the Talentvibes org holding either capability, so there is
  // never a switcher here.
  if (portal === "ops") return [];

  const [caps, roles] = await Promise.all([
    getOrgCapabilities(orgId),
    getMembershipRoles(userId),
  ]);

  const sides = availableSides(caps, roles);
  if (sides.length < 2) return [];

  const current = sideOfPortal(portal);
  // Bench first, then Hiring — a stable order, so the tabs do not reorder as you switch.
  return (["bench", "hiring"] as Side[])
    .filter((side) => sides.includes(side))
    .map((side) => ({
      side,
      label: SIDE_LABEL[side],
      href: SIDE_HREF[side],
      active: side === current,
    }));
}

/**
 * True when this organisation sits on both sides of the exchange.
 *
 * Ops-facing only. Telling a CLIENT that its supplier also hires, or a VENDOR that its
 * buyer also supplies, is a masking breach — it narrows the counterparty to a handful of
 * companies. Use this for the ops console's dual-role badge and nowhere else.
 */
export function isDualRole(caps: OrgCapabilities): boolean {
  return caps.canSupply && caps.canHire;
}
