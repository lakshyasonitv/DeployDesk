import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, StatCard, Card, SectionLabel, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { getClientOverview } from "@/src/read-models/client";
import { s, sx, TOKENS, stageMeta } from "@/src/lib/ui/style";
import { ShellAside } from "./aside";

/**
 * Client · Dashboard. The hiring manager's morning view.
 *
 * Everything here comes from the client read model, so no supplier identity, vendor
 * rate, margin or freshness state can appear — asserted by the leak suite.
 */
export const metadata = { title: "Overview · DeployDesk" };

const TABLE_COLS = "96px 1fr 78px 128px 132px 96px";

const ENGAGEMENT_STATUS: Record<string, { dot: string; label: string }> = {
  active: { dot: "#16a34a", label: "Active" },
  onboarding: { dot: "#1d4ed8", label: "Onboarding" },
  ending: { dot: "#c2410c", label: "Ending" },
  ended: { dot: "#8a8a96", label: "Ended" },
  terminated: { dot: "#b91c1c", label: "Terminated" },
};

export default async function ClientDashboard() {
  const session = await getDemoSession("client");
  const switcher = await getPortalSwitcherOptions();
  const [overview, aside] = await Promise.all([
    getClientOverview(session.orgId, session.userName),
    ShellAside(session.orgId),
  ]);

  const actionFor = (stage: string, count: number) =>
    stage === "shortlisted" ? `Review ${count}` : stage === "interviewing" ? "Schedule" : "View";

  return (
    <Shell portal="client" switcher={switcher} user={{ name: session.userName, org: session.orgName }} activeKey="overview" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title={`Good morning, ${overview.greetingName}`}
        subtitle={`${overview.orgName} · ${overview.stats.openRequirements} open requirements · your broker ${overview.brokerName} responds in ~2h`}
        actions={<><Button>Ask Talentvibes</Button><Button primary href="/client/requirements/new">Post a requirement</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          <StatCard label="OPEN REQUIREMENTS" value={overview.stats.openRequirements}
            sub={`${overview.stats.positions} positions in total`} />
          <StatCard label="AWAITING REVIEW" value={overview.stats.awaitingReview} delta="new" deltaColor="#6d3ff0"
            sub={`${overview.stats.maskedProfiles} masked profiles`} />
          <StatCard label="IN INTERVIEW" value={overview.stats.inInterview}
            sub={`${overview.stats.feedbackDue} feedback form${overview.stats.feedbackDue === 1 ? "" : "s"} due`} />
          <StatCard label="ACTIVE ENGAGEMENTS" value={overview.stats.activeEngagements}
            delta={`${overview.stats.monthlySpendLabel}/mo`} sub="your contracted rate" />
        </div>

        <div style={s("display:grid;grid-template-columns:1.55fr 1fr;gap:16px;margin-top:16px;align-items:start")}>
          {/* open requirements */}
          <div style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;overflow:hidden")}>
            <div style={s("padding:13px 15px;border-bottom:1px solid #f1f1f5")}>
              <SectionLabel>OPEN REQUIREMENTS</SectionLabel>
            </div>
            <div style={sx("display:grid;padding:8px 15px;background:#fafafc;border-bottom:1px solid #e8e8ee", { gridTemplateColumns: TABLE_COLS, gap: "10px" })}>
              {["REQ", "ROLE", "QTY", "BUDGET/MO", "STAGE", "ACTION"].map((h) => (
                <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>{h}</div>
              ))}
            </div>
            {overview.openRequirements.map((r) => {
              const st = stageMeta(r.stage);
              return (
                <div key={r.code} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid #f1f1f5;align-items:center", { gridTemplateColumns: TABLE_COLS, gap: "10px" })}>
                  <div style={sx("font-size:11px;font-weight:700", { fontFamily: TOKENS.mono })}>{r.code}</div>
                  <div style={s("min-width:0")}>
                    <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
                    <div style={s("font-size:10.5px;color:#8a8a96;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {r.experienceBand} · {r.locationLabel}{r.startDate ? ` · start ${fmtDay(r.startDate)}` : ""}
                    </div>
                  </div>
                  <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>×{r.quantity}</div>
                  <div style={sx("font-size:11.5px;font-weight:600", { fontFamily: TOKENS.mono })}>{r.budgetLabel}</div>
                  <div>
                    <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.08em", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                      {st.label}
                    </span>
                  </div>
                  <Link href={r.stage === "shortlisted" ? `/client/shortlists/${r.code}` : "/client/requirements"}
                    style={s("font-size:11.5px;font-weight:700;color:#6d3ff0")}>
                    {actionFor(r.stage, r.shortlistCount)}
                  </Link>
                </div>
              );
            })}
            {overview.openRequirements.length === 0 ? (
              <div style={s("padding:26px;text-align:center;color:#8a8a96;font-size:12.5px")}>
                No open requirements. Post one and your broker starts sourcing.
              </div>
            ) : null}
          </div>

          {/* right rail */}
          <div style={s("display:flex;flex-direction:column;gap:14px")}>
            <Card pad="13px">
              <div style={s("display:flex;align-items:center;justify-content:space-between;margin-bottom:10px")}>
                <SectionLabel>AWAITING YOUR REVIEW</SectionLabel>
                <Pill bg="#f1ecff" fg="#6d3ff0">{overview.awaitingReview.length}</Pill>
              </div>
              <div style={s("display:flex;flex-direction:column;gap:7px")}>
                {overview.awaitingReview.map((a) => (
                  <Link key={a.code} href={`/client/shortlists/${a.code}`}
                    style={s("display:block;background:#fafafc;border:1px solid #f1f1f5;border-radius:9px;padding:10px;color:#101014")}>
                    <div style={s("display:flex;align-items:center;justify-content:space-between;gap:8px")}>
                      <span style={sx("font-size:10.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{a.code}</span>
                      <span style={s("font-size:10px;color:#8a8a96")}>{a.sentAgo}</span>
                    </div>
                    <div style={s("font-size:12px;font-weight:700;margin-top:4px")}>{a.roleTitle}</div>
                    <div style={s("font-size:10.5px;color:#8a8a96;margin-top:2px")}>
                      {a.count} masked profiles{a.averageScore != null ? ` · avg score ${a.averageScore}` : ""}
                    </div>
                  </Link>
                ))}
                {overview.awaitingReview.length === 0 ? (
                  <div style={s("font-size:11.5px;color:#8a8a96;padding:6px 0")}>Nothing waiting on you.</div>
                ) : null}
              </div>
            </Card>

            <Card pad="13px">
              <SectionLabel>ACTIVE ENGAGEMENTS</SectionLabel>
              <div style={s("display:flex;flex-direction:column;gap:9px")}>
                {overview.engagements.map((e) => {
                  const st = ENGAGEMENT_STATUS[e.status] ?? ENGAGEMENT_STATUS.active;
                  return (
                    <div key={e.maskedId} style={s("display:flex;align-items:center;gap:10px")}>
                      <div style={sx("width:34px;height:34px;border-radius:8px;background:#f1ecff;flex:none;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#6d3ff0", { fontFamily: TOKENS.mono })}>
                        TV
                      </div>
                      <div style={s("flex:1;min-width:0")}>
                        <div style={s("font-size:11.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          <span style={{ fontFamily: TOKENS.mono }}>{e.maskedId}</span> · {e.roleTitle}
                        </div>
                        <div style={s("font-size:10.5px;color:#8a8a96;margin-top:1px")}>
                          {e.sinceLabel} · {e.rateLabel}/mo
                        </div>
                      </div>
                      <div style={s("display:flex;align-items:center;gap:5px;flex:none")}>
                        <span style={sx("width:6px;height:6px;border-radius:50%", { background: st.dot })} />
                        <span style={sx("font-size:10px;font-weight:600", { color: st.dot })}>{st.label}</span>
                      </div>
                    </div>
                  );
                })}
                {overview.engagements.length === 0 ? (
                  <div style={s("font-size:11.5px;color:#8a8a96")}>No active engagements yet.</div>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
