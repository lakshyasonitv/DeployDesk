import { Shell, PageHeader, Button } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import {
  getOpsTalentPool, getOpsPoolFacets, getOpsSavedViews, getOpsOpenRequirements,
} from "@/src/read-models/ops";
import type { PoolFilters as Filters } from "@/src/read-models/ops";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";
import { PoolFilters } from "./PoolFilters";
import {
  PoolSelectionProvider, PoolRowCheck, PoolHeaderCheck, AddToRequirementAction,
} from "./PoolSelection";

/**
 * Ops · Talent pool — full detail, nothing hidden.
 *
 * The filters are real and they live in the query string, which is what lets a saved view
 * be nothing more than a set of parameters: applying one is a navigation, and this page is
 * a server component, so it re-reads and re-queries on its own.
 *
 * Every filter is pushed into SQL by `getOpsTalentPool`. The previous version filtered in
 * memory AFTER `.limit(60)`, so a search only ever looked at the first 60 of 1,284 rows and
 * the count beside it described the page rather than the result.
 *
 * Both numbers on screen are measured. `matchCount` is how many rows the filters match
 * across the whole exchange, counted in the database with no limit; `resultCount` is how
 * many are rendered. They are different numbers, and the page says which is which.
 */
export const metadata = { title: "Talent pool · DeployDesk" };

/**
 * The leading 24px is the selection checkbox.
 *
 * A fixed width, not `auto`: `1fr` is `minmax(auto, 1fr)`, so a column sized by its
 * content pushes every other column around as the content changes — the same trap that
 * made a score bar 9999px wide on the matching desk.
 */
const COLS = "24px 158px 148px 1fr 74px 74px 108px 108px 96px 126px";

const FRESHNESS_PILL = {
  confirmed: { bg: "var(--ok-tint)", fg: "var(--ok)" },
  expiring_soon: { bg: "var(--warn-tint)", fg: "var(--warn)" },
  unconfirmed: { bg: "var(--danger-tint)", fg: "var(--danger)" },
} as const;

function scoreColor(n: number | null) {
  if (n == null) return "var(--t4)";
  return n >= 85 ? "var(--ok)" : n >= 78 ? "var(--warn)" : "var(--t4)";
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Query string -> filters. Anything unrecognised is dropped rather than guessed at. */
function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const band = one(sp.exp);
  const fresh = one(sp.fresh);
  return {
    skills: one(sp.skills)?.split(",").map((x) => x.trim()).filter(Boolean),
    experienceBand: (["0-3", "3-5", "5-8", "8+"] as const).includes(band as never)
      ? (band as Filters["experienceBand"]) : undefined,
    minScore: num(one(sp.score)),
    city: one(sp.city) || undefined,
    supplier: one(sp.employer) || undefined,
    maxRatePaise: num(one(sp.rate)),
    freshness: (["confirmed", "expiring", "unconfirmed"] as const).includes(fresh as never)
      ? (fresh as Filters["freshness"]) : undefined,
    search: one(sp.q) || undefined,
  };
}

export default async function PoolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  // Capped. "Show everything" on a 10k pool is a page nobody can read and a query nobody
  // asked for; 300 is well past what a broker scrolls and still one fast request.
  const limit = Math.min(Number(one(sp.limit)) || 60, 300);

  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);
  const [pool, facets, savedViews, openRequirements, aside] = await Promise.all([
    getOpsTalentPool({ ...filters, limit }),
    getOpsPoolFacets(),
    getOpsSavedViews(session.userId),
    // The picker's options. Read on the server with the page, so the list is as fresh as
    // the table beside it; the endpoint re-checks the stage anyway, because a role can be
    // placed between rendering this and clicking it.
    getOpsOpenRequirements(),
    OpsAside(),
  ]);
  const withScores = pool.results.filter((r) => r.score != null).length;
  const more = pool.matchCount - pool.resultCount;

  /** Raises the limit while keeping every filter that is already applied. */
  const showMoreHref = (() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = one(v);
      if (k !== "limit" && val) q.set(k, val);
    }
    q.set("limit", String(Math.min(pool.matchCount, 300)));
    return `/ops/pool?${q}`;
  })();

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="pool" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      {/*
        The provider spans the header AND the table because the checkboxes are in one and
        the button is in the other. It renders no DOM node, so these stay direct flex
        children of the shell.
      */}
      <PoolSelectionProvider
        pageIds={pool.results.map((r) => r.maskedId)}
        requirements={openRequirements}
      >
        <PageHeader
          title="Talent pool"
          subtitle={`${pool.poolTotal} profiles across the exchange · full detail, nothing hidden · ${withScores} of the ${pool.resultCount} shown have a proctored score`}
          /**
           * "Save this view" is no longer here. It belongs beside the filters it saves — in
           * the header it had nothing to name, and it only makes sense once something is
           * actually filtered, which is exactly when the chip row offers it.
           */
          actions={<AddToRequirementAction />}
        />

        <PoolFilters current={filters} facets={facets} savedViews={savedViews} />

        <div style={s("padding:0 26px 8px;display:flex;align-items:center;justify-content:flex-end;flex:none")}>
          <span style={sx("font-size:10.5px;color:var(--t4)", { fontFamily: TOKENS.mono })}>
            {pool.matchCount} matching · {pool.elapsedSeconds}s
          </span>
        </div>

        <div style={s("flex:1;overflow:auto")}>
          <div style={sx("display:grid;padding:9px 26px;background:var(--surface-2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:2", { gridTemplateColumns: COLS, gap: "10px" })}>
            {/* Ticks every row on the page — which is the filtered, limited page, not the
                whole exchange. "Select all 1,284" would be a promise the limit cannot keep. */}
            <PoolHeaderCheck />
            {["NAME", "EMPLOYER", "SKILLS", "EXPERIENCE", "TEST SCORE", "VENDOR RATE", "CLIENT RATE", "CITY", "LAST CONFIRMED"].map((h) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4);white-space:nowrap", { fontFamily: TOKENS.mono })}>{h}</div>
            ))}
          </div>

          {pool.results.map((r) => {
            const fp = FRESHNESS_PILL[r.freshnessState as keyof typeof FRESHNESS_PILL] ?? FRESHNESS_PILL.confirmed;
            const rel = Number(r.vendorReliability);
            return (
              <div key={r.maskedId} style={sx("display:grid;padding:10px 26px;border-bottom:1px solid var(--surface-3);align-items:center;background:var(--surface)", { gridTemplateColumns: COLS, gap: "10px" })}>
                <PoolRowCheck maskedId={r.maskedId} name={r.fullName} />
                <div style={s("min-width:0")}>
                  <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                  <div style={sx("font-size:10px;color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>{r.maskedId}</div>
                </div>
                <div style={s("min-width:0")}>
                  <div style={s("font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.vendorName}</div>
                  <div style={s("display:flex;align-items:center;gap:5px;margin-top:2px")}>
                    <span style={sx("width:5px;height:5px;border-radius:50%", { background: rel >= 4 ? "var(--ok)" : rel >= 3.5 ? "var(--warn)" : "var(--danger)" })} />
                    <span style={s("font-size:10px;color:var(--t4)")}>reliability {r.vendorReliability}</span>
                  </div>
                </div>
                <div style={s("display:flex;flex-wrap:wrap;gap:3px;min-width:0")}>
                  {r.skills.slice(0, 3).map((sk) => (
                    <span key={sk} style={s("padding:2px 6px;background:var(--surface-3);border-radius:4px;font-size:10px;font-weight:600;color:var(--t2);white-space:nowrap")}>{sk}</span>
                  ))}
                </div>
                <div style={s("font-size:11.5px;font-weight:600")}>{r.experienceLabel}</div>
                <div style={sx("font-size:12.5px;font-weight:800", { color: scoreColor(r.score) })}>
                  {r.score ?? "—"}
                </div>
                <div style={sx("font-size:11.5px;font-weight:600", { fontFamily: TOKENS.mono })}>{r.vendorRateLabel}</div>
                <div style={sx("font-size:11.5px;font-weight:600", { fontFamily: TOKENS.mono, color: r.clientRateLabel ? "var(--brand)" : "var(--t4)" })}>
                  {/* Ops sees both sides. Shows the real proposed rate, or nothing. */}
                  {r.clientRateLabel ?? "not priced"}
                </div>
                <div style={s("font-size:11.5px;color:var(--t2)")}>{r.city}</div>
                <div>
                  <span style={sx("display:inline-block;padding:3px 8px;border-radius:999px;font-size:9.5px;font-weight:700", { background: fp.bg, color: fp.fg, fontFamily: TOKENS.mono })}>
                    {r.freshnessLabel}
                  </span>
                </div>
              </div>
            );
          })}

          {pool.results.length === 0 ? (
            <div style={s("padding:34px 26px;text-align:center")}>
              <div style={s("font-size:13px;font-weight:600")}>Nobody matches all of those filters.</div>
              <div style={s("font-size:12px;color:var(--t4);margin-top:5px")}>
                Widen one of them. The skill filter is the narrowest — every skill you add has
                to be present on the same person.
              </div>
            </div>
          ) : (
            <div style={s("padding:14px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
              <div style={s("font-size:11.5px;color:var(--t4)")}>
                {more > 0
                  ? `Showing the ${pool.resultCount} most recently confirmed of ${pool.matchCount} matches`
                  : `All ${pool.matchCount} matches are shown`}
              </div>
              {/*
                "Load more" said neither how many more nor how many were left, and did nothing
                at all. It now names the number and raises the limit in the URL, so it keeps
                the filters and the browser's back button undoes it.
              */}
              {more > 0 ? (
                <Button href={showMoreHref}>Show all {Math.min(pool.matchCount, 300)}</Button>
              ) : null}
            </div>
          )}
        </div>
      </PoolSelectionProvider>
    </Shell>
  );
}
