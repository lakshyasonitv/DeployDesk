import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { getClientOverview } from "@/src/read-models/client";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";

/**
 * Client · Engagements.
 *
 * The client sees the rate IT pays. engagements.vendor_rate_paise is not selected by
 * the client read model, so no spread is reconstructible from this page.
 */
export const metadata = { title: "Engagements · Bench Exchange" };

const COLS = "120px 1fr 120px 128px 128px";

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: "#e8f6ef", fg: "#0f7a4a", label: "ACTIVE" },
  onboarding: { bg: "#e8eefc", fg: "#1d4ed8", label: "ONBOARDING" },
  ending: { bg: "#fff3e4", fg: "#b45309", label: "ENDING" },
  ended: { bg: "#f3f3f7", fg: "#8a8a96", label: "ENDED" },
  terminated: { bg: "#fdecec", fg: "#b91c1c", label: "TERMINATED" },
};

export default async function ClientEngagementsPage() {
  const session = await getDemoSession("client");
  const switcher = await getPortalSwitcherOptions();
  const [overview, aside] = await Promise.all([
    getClientOverview(session.orgId, session.userName),
    ShellAside(session.orgId),
  ]);

  return (
    <Shell portal="client" switcher={switcher} user={{ name: session.userName, org: session.orgName }} activeKey="engagements" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Engagements"
        subtitle="You contract with Talentvibes for every placement. One invoice, one counterparty."
        actions={<><Button>Download statement</Button><Button primary>Request an extension</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:12px")}>
          <StatCard label="ACTIVE ENGAGEMENTS" value={overview.stats.activeEngagements} sub="across your requirements" />
          <StatCard label="MONTHLY SPEND" value={overview.stats.monthlySpendLabel} sub="the rate you pay Talentvibes" />
          <StatCard label="CONTRACTING PARTY" value="Talentvibes" sub="single counterparty for all placements" />
        </div>

        <div style={s("margin-top:16px;background:#fff;border:1px solid #e8e8ee;border-radius:12px;overflow:hidden")}>
          <div style={sx("display:grid;padding:9px 15px;background:#fafafc;border-bottom:1px solid #e8e8ee", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["RESOURCE", "ROLE", "SINCE", "YOUR RATE/MO", "STATUS"].map((h) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>{h}</div>
            ))}
          </div>
          {overview.engagements.map((e) => {
            const st = STATUS[e.status] ?? STATUS.active;
            return (
              <div key={e.maskedId} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid #f1f1f5;align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{e.maskedId}</div>
                <div style={s("font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{e.roleTitle}</div>
                <div style={s("font-size:11.5px;color:#6b6b78")}>{e.sinceLabel.replace("since ", "")}</div>
                <div style={sx("font-size:12px;font-weight:700", { fontFamily: TOKENS.mono })}>{e.rateLabel}</div>
                <div>
                  <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.08em", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                    {st.label}
                  </span>
                </div>
              </div>
            );
          })}
          {overview.engagements.length === 0 ? (
            <div style={s("padding:28px;text-align:center;color:#8a8a96;font-size:12.5px")}>
              No engagements yet.
            </div>
          ) : null}
        </div>

        <div style={s("margin-top:14px;background:#f5f2ff;border:1px solid #e4dcff;border-radius:12px;padding:13px")}>
          <SectionLabel>HOW BILLING WORKS</SectionLabel>
          <div style={s("font-size:12px;color:#5a2fd0;line-height:1.6")}>
            Talentvibes invoices you at the agreed rate per resource, net 30, and contracts
            separately with each supplier. Supplier identity and supplier commercials are not part
            of your agreement — which is what keeps the exchange neutral for both sides.
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}
