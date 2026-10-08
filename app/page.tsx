import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACTING_COOKIE, getDemoIdentities, landingFor } from "@/src/lib/auth/session";

/**
 * `/` is a router, not a page.
 *
 * It used to be a deployment smoke page: eight table counts, a live masked-shortlist read,
 * and three portal links. Its own comment said "it will be replaced by the portal router",
 * and this is that.
 *
 * It had done its job. It proved the whole pipe end to end — Vercel build, env vars, the
 * Supavisor transaction pooler from a serverless function, and one real read through a
 * portal read model with ADR-004 bands — before any of the screens existed to sit on top of
 * it. None of that needs proving on every visit now: `npm test` covers the read models,
 * `db:verify` covers the fixtures, and the organisation switcher in the top bar does the
 * portal-choosing the three links were there for.
 *
 * Leaving it up had a cost beyond redundancy. It was the first thing anyone opened and it
 * described the product to itself — "three portals, one database, masking enforced on the
 * server" is an architecture note, not a landing page, and the row of table counts published
 * the exact size of the exchange to anyone with the URL.
 *
 * So `/` now sends you where the switcher says you are. No cookie means the client portal:
 * the exchange exists because clients post requirements, and the switcher is one click away.
 */
export default async function Home() {
  const jar = await cookies();
  const acting = jar.get(ACTING_COOKIE)?.value;

  if (acting) {
    const org = (await getDemoIdentities()).find((r) => r.orgId === acting);
    // An unknown cookie value falls through rather than erroring — the org may have been
    // renamed or dropped from the demo set since it was written.
    if (org) redirect(landingFor(org));
  }

  redirect("/client");
}
