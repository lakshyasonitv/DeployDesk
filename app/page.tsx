import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/src/db/client";
import { getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { s, TOKENS, ACCENT_GRADIENT, BRAND } from "@/src/lib/ui/style";
import { DeployDeskLogo } from "@/src/lib/ui/DeployDeskLogo";

/**
 * Deployment smoke page. It exists to prove the whole pipe end to end — Vercel build,
 * env vars, the Supavisor transaction pooler from a serverless function, and one real
 * read through a portal read model — before the fifteen screens are built on top of it.
 *
 * It will be replaced by the portal router. The masked shortlist read below is the
 * genuine client read model, so a passing render here also means ADR-004 bands and the
 * snapshot read path work in production.
 */

const PORTAL_LABEL = {
  client: "Client portal",
  vendor: "Vendor portal",
  ops: "Ops console",
} as const;

export default async function Home() {
  /**
   * ONE query for all three portals, not one per portal.
   *
   * This page was the slowest in the app — ~8 sequential queries, each paying a
   * cross-continent round trip while the functions ran in iad1 against a Mumbai
   * database. It is also the first page anyone opens, so it set the impression for the
   * whole app. Three of those queries were this block calling getDemoSession() per
   * portal; getPortalSwitcherOptions() resolves all three in one.
   */
  const tenants = await getPortalSwitcherOptions();

  let counts: Array<{ table: string; n: number }> = [];
  let shortlistSummary = "";
  let error: string | null = null;

  try {
    const [row] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*) from organizations)  as organizations,
        (select count(*) from users)          as users,
        (select count(*) from bench_resources) as bench_resources,
        (select count(*) from requirements)   as requirements,
        (select count(*) from matches)        as matches,
        (select count(*) from shortlist_items) as shortlist_items,
        (select count(*) from engagements)    as engagements,
        (select count(*) from audit_log)      as audit_log
    `) as unknown as Array<Record<string, number>>;
    counts = Object.entries(row).map(([table, n]) => ({ table, n: Number(n) }));

    /**
     * The masking summary, in ONE query against the client-facing snapshot table.
     *
     * This used to be an org lookup followed by getClientShortlist(), which is three more
     * queries — four round trips to render one line of text on a smoke page. Reading
     * shortlist_items directly is sound here for the same reason the client read model
     * does: the table has no vendor column and no vendor rate to leak.
     */
    const [band] = await db.execute<{ n: number; selected: number; bands: string }>(sql`
      select count(*)::int as n,
             count(*) filter (where client_decision = 'selected')::int as selected,
             coalesce(string_agg(
               -- One lakh is 10,000,000 paise: 100,000 rupees x 100 paise.
               '₹' || round(rate_band_min_paise / 10000000.0, 2) || '–' ||
                      round(rate_band_max_paise / 10000000.0, 2) || 'L',
               ', ' order by position), '') as bands
        from shortlist_items
    `) as unknown as Array<{ n: number; selected: number; bands: string }>;
    shortlistSummary = Number(band?.n)
      ? `${band.n} masked profiles · ${band.selected} selected · bands ${band.bands}`
      : "no shortlist found";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main style={s("max-width:860px;margin:0 auto;padding:48px 26px 60px")}>
      <div style={s("display:flex;align-items:center;gap:11px;margin-bottom:6px")}>
        {/* The lockup carries the name and tagline itself, so no separate <h1> text. */}
        <DeployDeskLogo variant="lockup" size={44} />
        <h1 style={s("position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);margin:0")}>
          {BRAND.full}
        </h1>
      </div>
      <p style={s("font-size:13px;color:var(--t3);margin:0 0 28px")}>
        Brokered marketplace for IT bench capacity. Three portals, one database, masking
        enforced on the server.
      </p>

      {error ? (
        <div style={s("background:var(--danger-tint);border:1px solid var(--danger-tint);border-radius:12px;padding:16px;margin-bottom:24px")}>
          <div style={{ ...s("font-weight:700;font-size:13px;margin-bottom:6px"), color: "var(--danger)" }}>
            Database unreachable
          </div>
          <code style={s("font-size:11.5px;color:var(--danger);word-break:break-all")}>{error}</code>
        </div>
      ) : (
        <>
          <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px")}>
            {counts.map((c) => (
              <div key={c.table} style={s("background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:13px")}>
                <div style={{ ...s("font-size:9.5px;font-weight:700;letter-spacing:.11em;color:var(--t4)"), fontFamily: TOKENS.mono }}>
                  {c.table.replace(/_/g, " ").toUpperCase()}
                </div>
                <div style={s("font-size:21px;font-weight:800;letter-spacing:-.5px;margin-top:4px")}>{c.n}</div>
              </div>
            ))}
          </div>

          <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:28px")}>
            <div style={{ ...s("font-size:9.5px;font-weight:700;letter-spacing:.11em;color:var(--t4);margin-bottom:6px"), fontFamily: TOKENS.mono }}>
              CLIENT READ MODEL · REQ-2291
            </div>
            <div style={s("font-size:12.5px;color:var(--t1);line-height:1.55")}>{shortlistSummary}</div>
            <div style={s("font-size:11.5px;color:var(--t4);margin-top:7px")}>
              Bands are derived from the proposed client rate only (ADR-004), so they read
              higher than the design mockups — which bracket the vendor cost.
            </div>
          </div>
        </>
      )}

      <div style={{ ...s("font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--t4);margin-bottom:9px"), fontFamily: TOKENS.mono }}>
        PORTALS
      </div>
      <div style={s("display:flex;flex-direction:column;gap:8px")}>
        {tenants.map((t) => (
          <Link
            key={t.portal}
            href={t.href}
            style={s("display:flex;align-items:center;gap:11px;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:13px 15px;color:var(--t1)")}
          >
            <div style={{ ...s("width:22px;height:22px;border-radius:6px;flex:none"), background: ACCENT_GRADIENT[t.portal] }} />
            <div>
              <div style={s("font-size:13.5px;font-weight:700")}>{PORTAL_LABEL[t.portal]}</div>
              <div style={s("font-size:11.5px;color:var(--t4);margin-top:1px")}>{t.label}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
