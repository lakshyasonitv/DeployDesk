import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { getOpsMargin } from "@/src/read-models/ops";
import { s, sx, TOKENS, MARGIN_COLOR } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Margin. The only screen in the product that shows a spread.
 * Every figure here is derived from engagements.vendor_rate_paise and
 * client_rate_paise; nothing about margin is stored.
 */
export const metadata = { title: "Margin · Bench Exchange" };

const COLS = "150px 130px 1fr 118px 118px 118px 86px";

export default async function MarginPage() {
  const session = await getDemoSession("ops");
  const switcher = await getPortalSwitcherOptions();
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
    <Shell portal="ops" switcher={switcher} user={{ name: session.userName, org: `${session.orgName} · ${session.role}` }} activeKey="margin" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Margin"
        subtitle="Vendor rate, client rate and spread on every live placement · visible to Talentvibes only"
        actions={<><Button>{new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</Button><Button primary accent="#101014">Export to finance</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          <StatCard label="GROSS SPREAD · MONTH" value={margin.stats.grossSpreadLabel} delta="+12%" deltaColor="#0f7a4a" sub={`across ${margin.rows.length} placements`} />
          <StatCard label="AVERAGE MARGIN" value={margin.stats.averageMarginLabel} sub={`target ${margin.guardrail.targetPct}% · floor ${margin.guardrail.floorPct}%`} />
          <div style={s("background:#fffaf2;border:1px solid #f5e3c8;border-radius:12px;padding:15px")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:#b45309", { fontFamily: TOKENS.mono })}>BELOW FLOOR</div>
            <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;margin-top:7px;line-height:1;color:#b45309")}>
              {margin.stats.belowFloorCount}
            </div>
            <div style={s("font-size:11.5px;color:#b45309;margin-top:6px")}>
              {margin.guardrail.breaches.map((b) => `${b.maskedId} at ${b.pctLabel}`).join(", ") || "none"}
            </div>
          </div>
          <div style={s("background:#101014;border-radius:12px;padding:15px;color:#fff")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>RUN-RATE · MONTHLY</div>
            <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;margin-top:7px;line-height:1")}>
              {margin.stats.runRateLabel}
            </div>
            <div style={s("font-size:11.5px;color:#8a8a96;margin-top:6px")}>
              {margin.stats.livePlacements} live placements exchange-wide
            </div>
          </div>
        </div>

        <div style={s("margin-top:16px;background:#fff;border:1px solid #e8e8ee;border-radius:12px;overflow:hidden")}>
          <div style={sx("display:grid;padding:9px 15px;background:#fafafc;border-bottom:1px solid #e8e8ee", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["RESOURCE","CLIENT","ROLE","VENDOR RATE","CLIENT RATE","SPREAD","MARGIN"].map((h, i) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono, textAlign: i >= 3 ? "right" : "left" })}>{h}</div>
            ))}
          </div>
          {margin.rows.map((r) => {
            const mc = MARGIN_COLOR[r.band];
            return (
              <div key={r.maskedId + r.roleTitle} style={sx("display:grid;padding:10px 15px;border-bottom:1px solid #f1f1f5;align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={s("min-width:0")}>
                  <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                  <div style={sx("font-size:10px;color:#8a8a96;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", { fontFamily: TOKENS.mono })}>
                    {r.maskedId} · {r.vendorName}
                  </div>
                </div>
                <div style={s("font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.clientName}</div>
                <div style={s("font-size:11.5px;color:#4a4a58;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
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
          <div style={s("padding:12px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fafafc")}>
            <div style={s("font-size:11.5px;color:#8a8a96")}>
              {margin.rows.length} of {margin.stats.livePlacements} live placements
            </div>
            <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>
              VENDOR {fmt(totals.vendor)} · CLIENT {fmt(totals.client)} ·{" "}
              <span style={s("font-size:17px;color:#0f7a4a")}>SPREAD {fmt(totals.spread)}</span>
            </div>
          </div>
        </div>

        {margin.guardrail.breaches.length ? (
          <div style={s("margin-top:14px;background:#fffaf2;border:1px solid #f5e3c8;border-radius:12px;padding:13px")}>
            <SectionLabel>GUARDRAIL</SectionLabel>
            <div style={s("font-size:12.5px;color:#b45309;line-height:1.6")}>
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
