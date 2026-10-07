import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsMargin } from "@/src/read-models/ops";
import { s, sx, TOKENS, MARGIN_COLOR } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Margin. The only screen in the product that shows a spread.
 * Every figure here is derived from engagements.vendor_rate_paise and
 * client_rate_paise; nothing about margin is stored.
 */
export const metadata = { title: "Margin · DeployDesk" };

const COLS = "150px 130px 1fr 118px 118px 118px 86px";

export default async function MarginPage() {
  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);
  const [margin, aside] = await Promise.all([getOpsMargin(), OpsAside()]);

  const totals = margin.rows.reduce(
    (a, r) => ({
      vendor: a.vendor + toPaise(r.vendorRateLabel),
      client: a.client + toPaise(r.clientRateLabel),
      spread: a.spread + toPaise(r.spreadLabel),
    }),
    { vendor: 0, client: 0, spread: 0 },
  );

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="margin" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Margin"
        subtitle="Vendor rate, client rate and spread on every live placement · visible to Talentvibes only"
        actions={<><Button>{new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Button><Button href="/api/export?kind=ops-margin" download primary accent="var(--t1)">Export to finance</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          <StatCard label="GROSS SPREAD · MONTH" value={margin.stats.grossSpreadLabel} delta="+12%" deltaColor="var(--ok)" sub={`across ${margin.rows.length} placements`} />
          <StatCard label="AVERAGE MARGIN" value={margin.stats.averageMarginLabel} sub={`target ${margin.guardrail.targetPct}% · floor ${margin.guardrail.floorPct}%`} />
          <div style={s("background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:12px;padding:15px")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--warn)", { fontFamily: TOKENS.mono })}>BELOW FLOOR</div>
            <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;margin-top:7px;line-height:1;color:var(--warn)")}>
              {margin.stats.belowFloorCount}
            </div>
            <div style={s("font-size:11.5px;color:var(--warn);margin-top:6px")}>
              {margin.guardrail.breaches.map((b) => `${b.maskedId} at ${b.pctLabel}`).join(", ") || "none"}
            </div>
          </div>
          <div style={s("background:var(--t1);border-radius:12px;padding:15px;color:var(--surface)")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>RUN-RATE · MONTHLY</div>
            <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;margin-top:7px;line-height:1")}>
              {margin.stats.runRateLabel}
            </div>
            <div style={s("font-size:11.5px;color:var(--t4);margin-top:6px")}>
              {margin.stats.livePlacements} live placements exchange-wide
            </div>
          </div>
        </div>

        <div style={s("margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden")}>
          <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["NAME","CLIENT","ROLE","VENDOR RATE","CLIENT RATE","SPREAD","MARGIN"].map((h, i) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono, textAlign: i >= 3 ? "right" : "left" })}>{h}</div>
            ))}
          </div>
          {margin.rows.map((r) => {
            const mc = MARGIN_COLOR[r.band];
            return (
              <div key={r.maskedId + r.roleTitle} style={sx("display:grid;padding:10px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
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
          <div style={s("padding:12px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--surface-2)")}>
            <div style={s("font-size:11.5px;color:var(--t4)")}>
              {margin.rows.length} of {margin.stats.livePlacements} live placements
            </div>
            <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>
              VENDOR {fmt(totals.vendor)} · CLIENT {fmt(totals.client)} ·{" "}
              <span style={s("font-size:17px;color:var(--ok)")}>SPREAD {fmt(totals.spread)}</span>
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

function toPaise(label: string): number {
  return Number(label.replace(/[^\d]/g, "")) * 100;
}
function fmt(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
