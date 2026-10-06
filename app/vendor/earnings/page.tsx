import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { getVendorEarnings } from "@/src/read-models/vendor";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { VendorAside } from "../aside";

/**
 * Vendor · Earnings — own rate only.
 *
 * The read model behind this page selects from invoices filtered to
 * direction = 'payable' and from engagements.vendor_rate_paise. It never selects
 * client_rate_paise, so no spread is reconstructible from anything on this screen.
 *
 * No client rate, client name or margin may appear anywhere in this portal.
 */
export const metadata = { title: "Earnings · Bench Exchange" };

const COLS = "168px 1fr 96px 120px 120px 130px";

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  BILLED: { bg: "#e8f6ef", fg: "#0f7a4a" },
  "PRO-RATA": { bg: "#e8eefc", fg: "#1d4ed8" },
};

export default async function VendorEarningsPage() {
  const session = await getDemoSession("vendor");
  const switcher = await getPortalSwitcherOptions();
  const [e, aside] = await Promise.all([
    getVendorEarnings(session.orgId),
    VendorAside(session.orgId),
  ]);

  const totalDue = e.rows.reduce((a, r) => a + Number(r.monthLabel.replace(/[^\d]/g, "")), 0);
  const ending = e.rows.filter((r) => r.status === "PRO-RATA").length;

  return (
    <Shell portal="vendor" switcher={switcher} user={{ name: session.userName, org: session.orgName }} activeKey="earnings" asideTitle="FRESHNESS ALERTS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Earnings"
        subtitle="Your contracted rate per placement. Talentvibes contracts separately with the client."
        actions={<><Button>Download statement</Button><Button primary accent="#0d9488">Raise invoice</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          <StatCard label="BILLED THIS MONTH" value={e.stats.billedThisMonthLabel}
            sub={`${e.stats.activePlacements} active placements`} />
          <StatCard label="RUN-RATE · MONTHLY" value={e.stats.runRateLabel} sub="at your contracted rates" />
          <StatCard label="ACTIVE PLACEMENTS" value={e.stats.activePlacements} sub="across the exchange" />
          <StatCard label="INVOICES RAISED" value={e.rows.length} sub="net 30 terms" />
        </div>

        <div style={s("margin-top:16px;background:#fff;border:1px solid #e8e8ee;border-radius:12px;overflow:hidden")}>
          <div style={sx("display:grid;padding:9px 15px;background:#fafafc;border-bottom:1px solid #e8e8ee", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["RESOURCE", "ROLE", "SINCE", "YOUR RATE/MO", "THIS MONTH", "STATUS"].map((h) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>{h}</div>
            ))}
          </div>
          {e.rows.map((r) => {
            const pill = STATUS_PILL[r.status] ?? STATUS_PILL.BILLED;
            return (
              <div key={r.maskedId + r.since} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid #f1f1f5;align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={s("min-width:0")}>
                  <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                  <div style={sx("font-size:10px;color:#8a8a96;margin-top:2px", { fontFamily: TOKENS.mono })}>{r.maskedId}</div>
                </div>
                <div style={s("font-size:12px;color:#4a4a58;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
                <div style={s("font-size:11px;color:#6b6b78")}>{r.since ? fmt(r.since) : "—"}</div>
                <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{r.rateLabel}</div>
                <div style={sx("font-size:11.5px;font-weight:600", { fontFamily: TOKENS.mono })}>{r.monthLabel}</div>
                <div>
                  <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.08em", { background: pill.bg, color: pill.fg, fontFamily: TOKENS.mono })}>
                    {r.status}
                  </span>
                </div>
              </div>
            );
          })}
          {e.rows.length === 0 ? (
            <div style={s("padding:28px;text-align:center;color:#8a8a96;font-size:12.5px")}>
              No placements billed yet.
            </div>
          ) : null}
          <div style={s("padding:12px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fafafc")}>
            <div style={s("font-size:11.5px;color:#8a8a96")}>
              {e.stats.activePlacements} active placements
              {ending ? ` · ${ending} billed pro-rata this month` : ""}
            </div>
            <div style={sx("font-size:20px;font-weight:800", { fontFamily: TOKENS.mono })}>
              TOTAL DUE ₹{totalDue.toLocaleString("en-IN")}
            </div>
          </div>
        </div>

        <div style={s("margin-top:14px;background:#f0fdfa;border:1px solid #cfe9dd;border-radius:12px;padding:13px")}>
          <SectionLabel>WHY YOU DO NOT SEE THE CLIENT</SectionLabel>
          <div style={s("font-size:12px;color:#0f766e;line-height:1.6")}>
            {e.disclosure} Client identity, client rate and margin are not shared with suppliers —
            and your rate is not shared with clients. That symmetry is what keeps the exchange
            neutral for both sides.
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
