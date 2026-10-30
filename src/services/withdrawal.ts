import { and, inArray, ne } from "drizzle-orm";
import { db } from "../db/client";
import * as s from "../db/schema";

/**
 * Who a client is relying on: a live placement, or a shortlist the client has not passed on.
 *
 * Nobody in that position is taken off offer by a side-action. Resolving a duplicate flag
 * withdrew the losing submission with no such check — in the seed, DUP-0148's "Keep Orbit"
 * would have withdrawn TV-4821, on an active placement and selected by a client — and the
 * vendor's own withdraw and back-to-draft guarded on `in_process` / `deployed`, statuses
 * nothing in the app ever sets. Taking a working person off the exchange is a conversation
 * with the client first.
 *
 * One function, so every route that enforces this and every screen that disables a button
 * for it cannot disagree.
 *
 * ponytail: read outside the writing transaction, so a placement created in the same
 * millisecond could slip past. Move the read into the transaction if that ever matters.
 */
export async function liveWork(resourceIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!resourceIds.length) return out;

  const [working, offered] = await Promise.all([
    db.select({ id: s.engagements.resourceId })
      .from(s.engagements)
      .where(and(
        inArray(s.engagements.resourceId, resourceIds),
        inArray(s.engagements.status, ["onboarding", "active", "ending"]),
      )),
    // Every shortlist row is a SENT shortlist (`sent_at` is not null). Only a pass frees them.
    db.select({ id: s.shortlistItems.resourceId })
      .from(s.shortlistItems)
      .where(and(
        inArray(s.shortlistItems.resourceId, resourceIds),
        ne(s.shortlistItems.clientDecision, "passed"),
      )),
  ]);

  // The placement is the more serious reason, so it wins.
  for (const o of offered) out.set(o.id, "is on a shortlist a client has");
  for (const w of working) out.set(w.id, "is on a live placement");
  return out;
}

/**
 * Why a duplicate resolution may NOT withdraw this person, or nothing if it may: live work,
 * or not being `listed` (a draft is not on offer, and anything else is not this screen's to
 * change).
 */
export async function withdrawBlockers(resourceIds: string[]): Promise<Map<string, string>> {
  if (!resourceIds.length) return new Map();
  const [people, live] = await Promise.all([
    db.select({ id: s.benchResources.id, status: s.benchResources.status })
      .from(s.benchResources)
      .where(inArray(s.benchResources.id, resourceIds)),
    liveWork(resourceIds),
  ]);
  const out = new Map<string, string>();
  for (const p of people) if (p.status !== "listed") out.set(p.id, `is ${p.status.replace("_", " ")}, not listed`);
  for (const [id, why] of live) out.set(id, why);
  return out;
}
