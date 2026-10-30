import { and, inArray, ne } from "drizzle-orm";
import { db } from "../db/client";
import * as s from "../db/schema";

/**
 * Why a person may NOT be withdrawn from the exchange, or nothing if they may.
 *
 * Resolving a duplicate flag withdraws the losing submission, and nothing stopped that
 * landing on somebody a client is already relying on. In the seed, DUP-0148's "Keep Orbit"
 * would have withdrawn TV-4821 — on an active placement, and selected by a client. Taking a
 * working person off the exchange is not a broker's tidy-up; it is a conversation with the
 * client first, so the route refuses and the screen says why.
 *
 * One function, so the route that enforces this and the screen that disables the button
 * cannot disagree.
 *
 * ponytail: read outside the resolving transaction, so a placement created in the same
 * millisecond could slip past. Move the read into the transaction if that ever matters.
 */
export async function withdrawBlockers(resourceIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!resourceIds.length) return out;

  const [people, working, offered] = await Promise.all([
    db.select({ id: s.benchResources.id, status: s.benchResources.status })
      .from(s.benchResources)
      .where(inArray(s.benchResources.id, resourceIds)),
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

  // Most serious reason wins, so the message names the thing that matters.
  for (const p of people) if (p.status !== "listed") out.set(p.id, `is ${p.status.replace("_", " ")}, not listed`);
  for (const o of offered) out.set(o.id, "is on a shortlist a client has");
  for (const w of working) out.set(w.id, "is on a live placement");
  return out;
}
