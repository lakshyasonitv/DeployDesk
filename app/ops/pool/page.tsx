import { Shell, PageHeader, Button } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsTalentPool } from "@/src/read-models/ops";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Talent pool — fully unmasked.
 *
 * Both the result count and the elapsed time are measured, not hardcoded: the design
 * advertises "62 results · 0.18s" and docs/ARCHITECTURE.md sets a p95 target of 400ms
 * at 10k profiles, so showing a real number keeps that target honest.
 */
export const metadata = { title: "Talent pool · DeployDesk" };

const COLS = "158px 148px 1fr 58px 74px 108px 108px 96px 126px";

const FRESHNESS_PILL = {
  confirmed: { bg: "var(--ok-tint)", fg: "var(--ok)" },
  expiring_soon: { bg: "var(--warn-tint)", fg: "var(--warn)" },
  unconfirmed: { bg: "var(--danger-tint)", fg: "var(--danger)" },
} as const;

/**
 * Filter affordances. These are presentational: the design shows active chips, but no
 * filtering is wired behind them yet, so none is marked active — a chip rendered as
 * "active" that filters nothing misreports the result count beside it.
 */
const CHIPS = [
  { label: "Skill", active: false },
  { label: "Experience", active: false },
  { label: "Score", active: false },
  { label: "Freshness", active: false },
  { label: "City", active: false },
  { label: "Supplier", active: false },
  { label: "Vendor rate", active: false },
];

function scoreColor(n: number | null) {
  if (n == null) return "var(--t4)";
  return n >= 85 ? "var(--ok)" : n >= 78 ? "var(--warn)" : "var(--t4)";
}

export default async function PoolPage() {
  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);
  const [pool, aside] = await Promise.all([getOpsTalentPool({ limit: 60 }), OpsAside()]);
  const withScores = pool.results.filter((r) => r.score != null).length;

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: `${session.orgName} · ${session.role}` }} activeKey="pool" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Talent pool"
        subtitle={`${pool.poolTotal} profiles across the exchange · unmasked · ${withScores} of the ${pool.resultCount} shown have a proctored score`}
        actions={<><Button>Save this view</Button><Button primary accent="var(--t1)">Add to a requirement</Button></>}
      />

      <div style={s("padding:11px 26px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:none")}>
        {CHIPS.map((c) => (
          <span key={c.label}
            style={sx("padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700", {
              background: c.active ? "var(--warn-tint)" : "var(--surface)",
              color: c.active ? "var(--warn)" : "var(--t4)",
              border: `1px solid ${c.active ? "var(--warn-tint)" : "var(--border)"}`,
            })}>
            {c.label}: any
          </span>
        ))}
        <span style={s("padding:4px 10px;border:1px dashed var(--border-2);border-radius:999px;font-size:11px;font-weight:600;color:var(--t3)")}>
          + Add filter
        </span>
        <span style={sx("margin-left:auto;font-size:10.5px;color:var(--t4)", { fontFamily: TOKENS.mono })}>
          {pool.resultCount} results · {pool.elapsedSeconds}s
        </span>
      </div>

      <div style={s("flex:1;overflow:auto")}>
        <div style={sx("display:grid;padding:9px 26px;background:var(--surface-2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:2", { gridTemplateColumns: COLS, gap: "10px" })}>
          {["NAME", "SUPPLIER", "SKILLS", "EXP", "SCORE", "VENDOR RATE", "CLIENT RATE", "CITY", "FRESHNESS"].map((h) => (
            <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>{h}</div>
          ))}
        </div>

        {pool.results.map((r) => {
          const fp = FRESHNESS_PILL[r.freshnessState as keyof typeof FRESHNESS_PILL] ?? FRESHNESS_PILL.confirmed;
          const rel = Number(r.vendorReliability);
          return (
            <div key={r.maskedId} style={sx("display:grid;padding:10px 26px;border-bottom:1px solid var(--surface-3);align-items:center;background:var(--surface)", { gridTemplateColumns: COLS, gap: "10px" })}>
              <div style={s("min-width:0")}>
                <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                <div style={sx("font-size:10px;color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>{r.maskedId}</div>
              </div>
              <div style={s("min-width:0")}>
                <div style={s("font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.vendorName}</div>
                <div style={s("display:flex;align-items:center;gap:5px;margin-top:2px")}>
                  <span style={sx("width:5px;height:5px;border-radius:50%", { background: rel >= 4 ? "var(--ok)" : rel >= 3.5 ? "var(--warn)" : "var(--danger)" })} />
                  <span style={s("font-size:10px;color:var(--t4)")}>rel {r.vendorReliability}</span>
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

        <div style={s("padding:14px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
          <div style={s("font-size:11.5px;color:var(--t4)")}>
            Showing {pool.resultCount} of {pool.poolTotal} profiles on the exchange
          </div>
          <Button>Load more</Button>
        </div>
      </div>
    </Shell>
  );
}
