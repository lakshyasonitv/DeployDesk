import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientOverview } from "@/src/read-models/client";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";

/**
 * Client · Engagements.
 *
 * The client sees the rate IT pays. engagements.vendor_rate_paise is not selected by
 * the client read model, so no spread is reconstructible from this page.
 */
export const metadata = { title: "People working · DeployDesk" };

const COLS = "120px 1fr 120px 128px 128px";

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: "var(--ok-tint)", fg: "var(--ok)", label: "ACTIVE" },
  onboarding: { bg: "var(--info-tint)", fg: "var(--info)", label: "ONBOARDING" },
  ending: { bg: "var(--warn-tint)", fg: "var(--warn)", label: "ENDING" },
  ended: { bg: "var(--surface-3)", fg: "var(--t4)", label: "ENDED" },
  terminated: { bg: "var(--danger-tint)", fg: "var(--danger)", label: "TERMINATED" },
};

export default async function ClientEngagementsPage() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const [overview, aside] = await Promise.all([
    getClientOverview(session.orgId, session.userName),
    ShellAside(session.orgId),
  ]);

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="engagements" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="People working"
        subtitle="Everyone currently working for you through Talentvibes. One contract and one invoice, with us — never with the supplier."
        actions={<><Button>Download statement</Button><Button primary>Request an extension</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:12px")}>
          <StatCard label="ACTIVE ENGAGEMENTS" value={overview.stats.activeEngagements} sub="across your requirements" />
          <StatCard label="MONTHLY SPEND" value={overview.stats.monthlySpendLabel} sub="the rate you pay Talentvibes" />
          <StatCard label="CONTRACTING PARTY" value="Talentvibes" sub="one contract for everyone you hire" />
        </div>

        <div style={s("margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden")}>
          <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["RESOURCE", "ROLE", "SINCE", "YOUR RATE/MO", "STATUS"].map((h) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>{h}</div>
            ))}
          </div>
          {overview.engagements.map((e) => {
            const st = STATUS[e.status] ?? STATUS.active;
            return (
              <div key={e.maskedId} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{e.maskedId}</div>
                <div style={s("font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{e.roleTitle}</div>
                <div style={s("font-size:11.5px;color:var(--t3)")}>{e.sinceLabel.replace("since ", "")}</div>
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
            <div style={s("padding:28px;text-align:center;color:var(--t4);font-size:12.5px")}>
              No engagements yet.
            </div>
          ) : null}
        </div>

        <div style={s("margin-top:14px;background:var(--brand-tint);border:1px solid var(--brand-tint-2);border-radius:12px;padding:13px")}>
          <SectionLabel>HOW BILLING WORKS</SectionLabel>
          <div style={s("font-size:12px;color:var(--brand-h);line-height:1.6")}>
            Talentvibes invoices you at the agreed rate per resource, net 30, and contracts
            separately with each supplier. Supplier identity and supplier commercials are not part
            of your agreement — which is what keeps the exchange neutral for both sides.
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}
