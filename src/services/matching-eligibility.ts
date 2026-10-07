import { and, ne, sql } from "drizzle-orm";
import * as s from "../db/schema";

/**
 * Who may be offered to whom.
 *
 * Two rules, and both are enforced TWICE — here in the query, and again in the database
 * by the trigger in migration 0004. That duplication is deliberate: an application bug
 * that forgets this predicate would otherwise hand a company its own people, or a
 * supplier's bench to an organisation that blocked them. The database refusal is the
 * backstop, and there are tests that try to get past it.
 *
 * 1. SELF-DEALING. A resource may not be offered to a requirement whose client is the
 *    same organisation, OR in the same declared group.
 *
 *    Keying on the group and not just the org id is the whole point. Helix Systems
 *    supplies, Vantage Insurance hires, and they are separate legal entities with
 *    different PANs — but the Helix MSA declares them one group, so Helix engineers
 *    offered to Vantage would be the group quoting itself through the broker, with the
 *    platform fee as the only thing moving.
 *
 *    Groups come from `organizations.parent_group_id`, declared by ops from the MSA. They
 *    are never inferred from PAN or GSTIN: subsidiaries can share a PAN prefix without
 *    being related, and genuinely related companies can share neither identifier.
 *
 * 2. BLOCKS. A block hides each organisation from the other in BOTH directions, so the
 *    check tests both columns. `orgs_are_blocked(a, b)` in the database does the same.
 */

export interface SelfDealingInput {
  vendorOrgId: string;
  vendorGroupId: string | null;
  clientOrgId: string;
  clientGroupId: string | null;
}

/** The rule in plain TypeScript, for the seed and for tests. */
export function isSelfDealing(x: SelfDealingInput): boolean {
  if (x.vendorOrgId === x.clientOrgId) return true;
  // Only a DECLARED group counts. Two orgs with no group are not related.
  if (x.vendorGroupId && x.clientGroupId && x.vendorGroupId === x.clientGroupId) return true;
  return false;
}

/** Why a candidate was refused, for ops-facing explanation. */
export type IneligibleReason = "self_dealing_same_org" | "self_dealing_same_group" | "blocked";

export function refusalReason(
  x: SelfDealingInput,
  blocked: boolean,
): IneligibleReason | null {
  if (x.vendorOrgId === x.clientOrgId) return "self_dealing_same_org";
  if (x.vendorGroupId && x.clientGroupId && x.vendorGroupId === x.clientGroupId) {
    return "self_dealing_same_group";
  }
  if (blocked) return "blocked";
  return null;
}

/**
 * The same two rules as a SQL predicate, for read models.
 *
 * Returns a condition that is TRUE when the resource may be offered. Apply it to a query
 * that already joins `bench_resources` as the resource and has the client organisation's
 * id available.
 *
 * `vendorOrg` is the organisations row joined on `bench_resources.vendor_org_id`.
 */
export function mayBeOfferedTo(clientOrgId: string) {
  return and(
    // not the same organisation
    ne(s.benchResources.vendorOrgId, clientOrgId),
    // not the same declared group — NULL groups are unrelated, hence the explicit guard
    sql`(
      ${s.organizations.parentGroupId} is null
      or (select o2.parent_group_id from organizations o2 where o2.id = ${clientOrgId}) is null
      or ${s.organizations.parentGroupId}
         <> (select o2.parent_group_id from organizations o2 where o2.id = ${clientOrgId})
    )`,
    // not blocked, in either direction
    sql`not orgs_are_blocked(${s.benchResources.vendorOrgId}, ${clientOrgId})`,
  );
}
