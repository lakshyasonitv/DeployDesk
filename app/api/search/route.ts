import { NextResponse } from "next/server";
import { z } from "zod";
import { getDemoSession } from "@/src/lib/auth/session";
import { searchFor, MIN_QUERY } from "@/src/read-models/search";

/**
 * GET /api/search?portal=client&q=react
 *
 * The portal is explicit rather than inferred from a referrer, and the session is resolved
 * for that portal — so the org id the search is scoped to comes from the SESSION, never
 * from the query string. A caller cannot ask for another organisation's results.
 *
 * Each portal has its own read model with its own queries and its own shape
 * (src/read-models/search.ts), because search is the most tempting place in this product
 * to write one function with a role branch inside it, and that is the shape ADR-003
 * forbids.
 */

const Query = z.object({
  portal: z.enum(["client", "vendor", "ops"]),
  q: z.string().max(80),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    portal: url.searchParams.get("portal"),
    q: url.searchParams.get("q") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { portal, q } = parsed.data;
  // Too short to be useful: answer empty rather than scanning for one character.
  if (q.trim().length < MIN_QUERY) return NextResponse.json({ hits: [] });

  const session = await getDemoSession(portal);
  const hits = await searchFor(portal, session.orgId, q);

  return NextResponse.json({ hits });
}
