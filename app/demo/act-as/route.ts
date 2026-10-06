import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { ACTING_COOKIE } from "@/src/lib/auth/session";
import { getOrgCapabilities, requiredCapability, type Portal } from "@/src/lib/auth/workspace";

/**
 * GET /demo/act-as?org=<uuid>&to=<path> — choose which organisation the demo acts as.
 *
 * DEMO AFFORDANCE ONLY. In production a user belongs to exactly one organisation and the
 * session decides; there is no equivalent of this route and it must be deleted with the
 * demo switcher. It exists so the dual-role organisation can actually be viewed: the
 * seeded demo tenants are one client, one vendor and the broker, none of which sits on
 * both sides, so without this there is no way to exercise the "Hiring | Bench" switcher
 * or acceptance test 2.
 *
 * Why a route handler and not a client component: the choice has to survive a navigation
 * and be readable by server components on the next request, which means a cookie set in
 * an HTTP response. Server components cannot set cookies during render.
 *
 * `org` is validated as a uuid and looked up, and `to` is constrained to a known portal
 * path — never echoed back from the query string. An open redirect here would be a real
 * vulnerability even in a demo, because the cookie is set on the same response.
 */

const Query = z.object({
  org: z.string().uuid(),
  to: z.enum(["/client", "/vendor", "/ops"]).default("/client"),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    org: url.searchParams.get("org") ?? "",
    to: url.searchParams.get("to") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { org, to } = parsed.data;

  // The organisation must exist. Setting a cookie naming a row that is not there would
  // silently fall back to the default tenant on every later request, which looks like the
  // switcher being broken rather than the id being wrong.
  const [row] = await db
    .select({ id: s.organizations.id, orgType: s.organizations.orgType })
    .from(s.organizations)
    .where(eq(s.organizations.id, org))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "unknown_organisation" }, { status: 404 });
  }

  /**
   * Send the viewer to a side this organisation can actually act on.
   *
   * A client-only organisation asked for `/vendor` has no bench workspace, and the
   * capability check is the authority on that — not `org_type`, which collapses a
   * dual-role org to 'vendor'. Redirecting to a side it holds is friendlier than an
   * error page, and it is also the honest behaviour: the workspace does not exist.
   */
  const caps = await getOrgCapabilities(row.id);
  const want = to.slice(1) as Portal;
  const need = requiredCapability(want);

  let dest: string = to;
  if (row.orgType === "talentvibes") {
    dest = "/ops";
  } else if (need && !caps[need]) {
    dest = caps.canHire ? "/client" : caps.canSupply ? "/vendor" : "/";
  }

  const res = NextResponse.redirect(new URL(dest, url.origin));
  res.cookies.set(ACTING_COOKIE, row.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // a demo session, not a login
  });
  return res;
}
