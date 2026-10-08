import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsMargin } from "@/src/read-models/ops";
import { s, sx, TOKENS, MARGIN_COLOR } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Margin. The only screen in the product that shows a spread.
 *
 * Every figure is derived from `engagements.vendor_rate_paise` and `client_rate_paise`;
 * nothing about margin is stored (docs/DOMAIN.md).
 *
 * Four things this page used to get wrong, found by audit:
 *
 *   - **A hardcoded "+12%"** on the gross-spread card, in green beside a real figure. It
 *     came from the v2 mockup and read +12% every day forever, whatever the number did.
 *     There is no previous-period data to compare against, so it is gone rather than
 *     approximated.
 *   - **A month button that did nothing**, next to a stat labelled "· MONTH", over data
 *     that was never period-scoped. The button is gone and the labels say what the figures
 *     are: the monthly rates of the placements live right now.
 *   - **Finished work in the money.** The read model had no status filter, so `ended` and
 *     `terminated` engagements still fed gross spread and run-rate.
 *   - **Footer totals parsed back out of display strings.** `toPaise("₹1,38,000")` stripped
 *     non-digits and multiplied by 100. Correct for exact rupees and catastrophically wrong
 *     the day the formatter abbreviated — "₹1.38L" would have read as 138 rupees. The totals
 *     now come from the read model, summed in paise.
 */
export const metadata = { title: "Margin · DeployDesk" };

const COLS = "150px 130px 1fr 118px 118px 118px 86px";

/** Sortable columns, in table order. `null` means the column is not sortable. */
const SORTABLE = [
  { key: "name", label: "NAME" },
  { key: "client", label: "CLIENT" },
  { key: null, label: "ROLE" },
  { key: "vendor", label: "VENDOR RATE" },
  { key: "clientRate", label: "CLIENT RATE" },
  { key: "spread", label: "SPREAD" },
  { key: "margin", label: "MARGIN" },
] as const;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MarginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sort = one(sp.sort) ?? "";
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";

  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);
  const [margin, aside] = await Promise.all([getOpsMargin(), OpsAside()]);

  /**
   * Sorted here rather than in SQL: the rows are already in memory, and `spread` and
   * `margin` are derived on read (docs/DOMAIN.md says margin is never stored), so there is
   * no column to order by.
   */
  const rows = [...margin.rows];
  if (sort) {
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sort) {
        case "name": return sign * a.fullName.localeCompare(b.fullName);
        case "client": return sign * a.clientName.localeCompare(b.clientName);
        case "vendor": return sign * (a.vendorRatePaise - b.vendorRatePaise);
        case "clientRate": return sign * (a.clientRatePaise - b.clientRatePaise);
        case "spread": return sign * (a.spreadPaise - b.spreadPaise);
        case "margin": return sign * (a.pct - b.pct);
        default: return 0;
      }
    });
  }

  /** Clicking the active column flips direction; a new column starts descending. */
  const sortHref = (key: string) =>
    `/ops/margin?sort=${key}&dir=${sort === key && dir === "desc" ? "asc" : "desc"}`;

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="margin" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Margin"
        subtitle="Vendor rate, client rate and spread on every live placement · visible to Talentvibes only"
        /**
         * No month picker. v2 shows "[August 2026 ▾]" and this page had a button rendering
         * the current month with no handler — over data that was never scoped to a month.
         * A margin desk answers "what are we earning right now", which is what these
         * monthly rates are, so the implied filter is gone rather than faked.
         */
        actions={<Button href="/api/export?kind=ops-margin" download primary accent="var(--t1)">Export to finance</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          {/* No delta. There is nothing to compare this against — see the header comment. */}
          <StatCard label="WE KEEP · PER MONTH" value={margin.stats.grossSpreadLabel} sub={`across ${margin.stats.livePlacements} live placements`} />
          <StatCard label="AVERAGE MARGIN" value={margin.stats.averageMarginLabel} sub={`target ${margin.guardrail.targetPct}% · floor ${margin.guardrail.floorPct}%`} />
          <div style={s("background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:12px;padding:15px")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--warn)", { fontFamily: TOKENS.mono })}>BELOW FLOOR</div>
            <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;margin-top:7px;line-height:1;color:var(--warn)")}>
              {margin.stats.belowFloorCount}
            </div>
            <div style={s("font-size:11.5px;color:var(--warn);margin-top:6px")}>
              {/* Linked to the row rather than listed as text — this is the card you act on. */}
              {margin.guardrail.breaches.length
                ? margin.guardrail.breaches.map((b, i) => (
                    <span key={b.maskedId}>
                      {i ? ", " : ""}
                      <a href={`#row-${b.maskedId}`} style={s("color:var(--warn);font-weight:700;text-decoration:underline")}>
                        {b.maskedId}
                      </a>
                      {` at ${b.pctLabel}`}
                    </span>
                  ))
                : "none"}
            </div>
          </div>
          <div style={s("background:var(--t1);border-radius:12px;padding:15px;color:var(--surface)")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>CLIENTS PAY · PER MONTH</div>
            <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;margin-top:7px;line-height:1")}>
              {margin.stats.runRateLabel}
            </div>
            <div style={s("font-size:11.5px;color:var(--t4);margin-top:6px")}>
              {margin.stats.livePlacements} live placements exchange-wide
            </div>
          </div>
        </div>

        <div style={s("margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden")}>
          <div style={s("overflow-x:auto")}>
            <div style={s("min-width:840px")}>
              <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
                {SORTABLE.map((c, i) => {
                  const active = c.key && sort === c.key;
                  const style = sx("font-size:9px;font-weight:700;letter-spacing:.12em;white-space:nowrap", {
                    fontFamily: TOKENS.mono,
                    textAlign: i >= 3 ? "right" : "left",
                    color: active ? "var(--t1)" : "var(--t4)",
                  });
                  if (!c.key) return <div key={c.label} style={style}>{c.label}</div>;
                  return (
                    <Link key={c.label} href={sortHref(c.key)} style={{ ...style, textDecoration: "none" }}>
                      {c.label}{active ? (dir === "desc" ? " ↓" : " ↑") : ""}
                    </Link>
                  );
                })}
              </div>

              {rows.map((r) => {
                const mc = MARGIN_COLOR[r.band];
                return (
                  <div key={r.maskedId + r.roleTitle} id={`row-${r.maskedId}`}
                    style={sx("display:grid;padding:10px 15px;border-bottom:1px solid var(--surface-3);align-items:center", {
                      gridTemplateColumns: COLS, gap: "10px",
                      // v2 SCREENS.md O4: a row below the floor gets a faint red ground.
                      background: r.exception ? "var(--danger-tint)" : "transparent",
                    })}>
                    <div style={s("min-width:0")}>
                      <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                      <div style={sx("font-size:10px;color:var(--t4);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", { fontFamily: TOKENS.mono })}>
                        {r.maskedId} · {r.vendorName}
                      </div>
                    </div>
                    <div style={s("font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.clientName}</div>
                    <div style={s("font-size:11.5px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
                    <div style={sx("font-size:11.5px;font-weight:600;text-align:right", { fontFamily: TOKENS.mono })}>{r.vendorRateLabel}</div>
                    <div style={sx("font-size:11.5px;font-weight:600;text-align:right", { fontFamily: TOKENS.mono })}>{r.clientRateLabel}</div>
                    <div style={sx("font-size:11.5px;font-weight:700;text-align:right", { fontFamily: TOKENS.mono })}>{r.spreadLabel}</div>
                    <div style={s("text-align:right")}>
                      <span style={sx("display:inline-block;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700", { background: mc.bg, color: mc.fg, fontFamily: TOKENS.mono })}>
                        {r.pctLabel}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/*
                The three totals v2 asks for, straight from the read model.
                `WE KEEP` is the difference of the other two by construction, so the row can
                never fail to add up.
              */}
              <div style={sx("display:grid;padding:12px 15px;background:var(--surface-2);align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={s("font-size:11px;color:var(--t4)")}>
                  {rows.length} live placement{rows.length === 1 ? "" : "s"}
                </div>
                <div /><div />
                <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);text-align:right", { fontFamily: TOKENS.mono })}>
                  SUPPLIERS<br />
                  <span style={sx("font-size:12px;color:var(--t1)", { letterSpacing: 0 })}>{margin.stats.suppliersTotalLabel}</span>
                </div>
                <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);text-align:right", { fontFamily: TOKENS.mono })}>
                  CLIENTS<br />
                  <span style={sx("font-size:12px;color:var(--t1)", { letterSpacing: 0 })}>{margin.stats.clientsTotalLabel}</span>
                </div>
                <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);text-align:right", { fontFamily: TOKENS.mono })}>
                  WE KEEP<br />
                  <span style={sx("font-size:15px;font-weight:800;color:var(--ok)", { letterSpacing: "-.4px" })}>{margin.stats.weKeepLabel}</span>
                </div>
                <div />
              </div>
            </div>
          </div>
        </div>

        {margin.guardrail.breaches.length ? (
          <div style={s("margin-top:14px;background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:12px;padding:13px")}>
            <SectionLabel>GUARDRAIL</SectionLabel>
            <div style={s("font-size:12.5px;color:var(--warn);line-height:1.6")}>
              {margin.guardrail.breaches.length} placement
              {margin.guardrail.breaches.length === 1 ? "" : "s"} sit below the {margin.guardrail.floorPct}% floor.
              {margin.guardrail.breaches.map((b) => (
                <span key={b.maskedId}>
                  {" "}{b.maskedId} ({b.vendorName}) was approved at {b.pctLabel}
                  {b.exception?.approverName ? ` by ${b.exception.approverName}` : ""}
                  {b.exception?.note ? ` — ${b.exception.note}` : "."}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Scroll>
    </Shell>
  );
}
