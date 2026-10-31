import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, StatCard, Card, SectionLabel, Pill, HeadCell, EmptyState } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientOverview } from "@/src/read-models/client";
import { s, sx, TOKENS, stageMeta } from "@/src/lib/ui/style";
import { ShellAside } from "./aside";
import { istFormat } from "@/src/lib/derived";

/**
 * Client · Dashboard. The hiring manager's morning view.
 *
 * Everything here comes from the client read model, so no supplier identity, vendor
 * rate, margin or freshness state can appear — asserted by the leak suite.
 */
export const metadata = { title: "Overview · DeployDesk" };

/**
 * ROLE has a floor. As `1fr` beside 530px of fixed columns, in a card about half the page wide,
 * it collapsed to 0px at 1024 and one letter at 1366 — the role titles simply vanished. Past
 * the floor the table scrolls inside its card (v2 README rule 5), as Organisations does.
 */
const TABLE_COLS = "82px minmax(128px, 1fr) 70px 108px 100px 74px";
// Fits the card at 1366px with the 11px type floor; it clipped ACTION at 690px.
const TABLE_MIN_WIDTH = "640px";

const ENGAGEMENT_STATUS: Record<string, { dot: string; label: string }> = {
  active: { dot: "var(--ok)", label: "Active" },
  onboarding: { dot: "var(--info)", label: "Onboarding" },
  ending: { dot: "var(--warn)", label: "Ending" },
  ended: { dot: "var(--t4)", label: "Ended" },
  terminated: { dot: "var(--danger)", label: "Terminated" },
};

export default async function ClientDashboard() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const [overview, aside] = await Promise.all([
    getClientOverview(session.orgId, session.userName),
    ShellAside(session.orgId),
  ]);

  const actionFor = (stage: string, count: number) =>
    stage === "shortlisted" && count > 0 ? `Review ${count}` : stage === "interviewing" ? "Schedule" : "View";

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="overview" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title={`Good morning, ${overview.greetingName}`}
        // No "replies in ~2h" (a promise nothing measures) and no "Ask Talentvibes" button (it
        // had no handler; the conversation lives on each shortlist).
        subtitle={`${overview.orgName} · ${overview.stats.openRequirements} open requirements · your Talentvibes team: ${overview.brokerName}`}
        actions={<Button primary href="/client/requirements/new">Post a new role</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(198px,1fr));gap:12px")}>
          <StatCard label="OPEN REQUIREMENTS" value={overview.stats.openRequirements}
            sub={`${overview.stats.positions} positions in total`} />
          <StatCard label="AWAITING REVIEW" value={overview.stats.awaitingReview}
            sub={`${overview.stats.maskedProfiles} masked profiles`} />
          <StatCard label="IN INTERVIEW" value={overview.stats.inInterview}
            sub={`${overview.stats.feedbackDue} feedback form${overview.stats.feedbackDue === 1 ? "" : "s"} due`} />
          <StatCard label="ACTIVE ENGAGEMENTS" value={overview.stats.activeEngagements}
            delta={`${overview.stats.monthlySpendLabel}/mo`} sub="range of your monthly spend" />
        </div>

        <div style={s("display:grid;grid-template-columns:1.55fr 1fr;gap:16px;margin-top:16px;align-items:start")}>
          {/* open requirements */}
          <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden")}>
            <div style={s("padding:13px 15px;border-bottom:1px solid var(--surface-3)")}>
              <SectionLabel>OPEN REQUIREMENTS</SectionLabel>
            </div>
            <div style={s("overflow-x:auto")}>
            <div style={sx("", { minWidth: TABLE_MIN_WIDTH })}>
            <div style={sx("display:grid;padding:8px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: TABLE_COLS, gap: "10px" })}>
              {["REQ", "ROLE", "HOW MANY", "BUDGET / MONTH", "STAGE", "ACTION"].map((h) => (
                <HeadCell key={h}>{h}</HeadCell>
              ))}
            </div>
            {overview.openRequirements.map((r) => {
              const st = stageMeta(r.stage);
              return (
                <div key={r.code} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: TABLE_COLS, gap: "10px" })}>
                  <div style={sx("font-size:var(--fs-1);font-weight:700", { fontFamily: TOKENS.mono })}>{r.code}</div>
                  <div style={s("min-width:0")}>
                    <div style={s("font-size:var(--fs-4);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
                    <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {r.experienceBand} · {r.locationLabel}{r.startDate ? ` · start ${fmtDay(r.startDate)}` : ""}
                    </div>
                  </div>
                  <div style={sx("text-align:right;padding-right:8px;font-size:var(--fs-2);font-weight:700", { fontFamily: TOKENS.mono })}>×{r.quantity}</div>
                  <div style={sx("text-align:right;padding-right:8px;font-size:var(--fs-2);font-weight:600", { fontFamily: TOKENS.mono })}>{r.budgetLabel}</div>
                  <div>
                    <Pill bg={st.bg} fg={st.fg}>{st.label}</Pill>
                  </div>
                  <Link href={r.stage === "shortlisted" ? `/client/shortlists/${r.code}` : r.stage === "interviewing" ? "/client/interviews" : "/client/requirements"}
                    style={s("font-size:var(--fs-2);font-weight:700;color:var(--brand);display:inline-block;padding:6px 0")}>
                    {actionFor(r.stage, r.shortlistCount)}
                  </Link>
                </div>
              );
            })}
            </div>
            </div>
            {overview.openRequirements.length === 0 ? (
              <EmptyState inline title="No open requirements">
                Post one and your Talentvibes team starts sourcing.
              </EmptyState>
            ) : null}
          </div>

          {/* right rail */}
          <div style={s("display:flex;flex-direction:column;gap:14px")}>
            <Card pad="13px">
              <div style={s("display:flex;align-items:center;justify-content:space-between;margin-bottom:10px")}>
                <SectionLabel>AWAITING YOUR REVIEW</SectionLabel>
                <Pill bg="var(--brand-tint)" fg="var(--brand-ink)">{overview.awaitingReview.length}</Pill>
              </div>
              <div style={s("display:flex;flex-direction:column;gap:7px")}>
                {overview.awaitingReview.map((a) => (
                  <Link key={a.code} href={`/client/shortlists/${a.code}`} className="tv-card"
                    style={s("display:block;background:var(--surface-2);border:1px solid var(--surface-3);border-radius:9px;padding:10px;color:var(--t1)")}>
                    <div style={s("display:flex;align-items:center;justify-content:space-between;gap:8px")}>
                      <span style={sx("font-size:var(--fs-1);font-weight:700", { fontFamily: TOKENS.mono })}>{a.code}</span>
                      <span style={s("font-size:var(--fs-1);color:var(--t4)")}>{a.sentAgo}</span>
                    </div>
                    <div style={s("font-size:var(--fs-3);font-weight:700;margin-top:4px")}>{a.roleTitle}</div>
                    <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:2px")}>
                      {a.count} masked profiles{a.averageScore != null ? ` · avg score ${a.averageScore}` : ""}
                    </div>
                  </Link>
                ))}
                {overview.awaitingReview.length === 0 ? (
                  <div style={s("font-size:var(--fs-2);color:var(--t4);padding:6px 0")}>Nothing waiting on you.</div>
                ) : null}
              </div>
            </Card>

            <Card pad="13px">
              <SectionLabel>ACTIVE ENGAGEMENTS</SectionLabel>
              <div style={s("display:flex;flex-direction:column;gap:9px")}>
                {/* A short list; the full set (and the count above) is on People working. */}
                {overview.engagements.slice(0, 6).map((e) => {
                  const st = ENGAGEMENT_STATUS[e.status] ?? ENGAGEMENT_STATUS.active;
                  return (
                    <div key={e.maskedId} style={s("display:flex;align-items:center;gap:10px")}>
                      <div style={sx("width:34px;height:34px;border-radius:8px;background:var(--brand-tint);flex:none;display:flex;align-items:center;justify-content:center;font-size:var(--fs-1);font-weight:700;color:var(--brand-ink)", { fontFamily: TOKENS.mono })}>
                        TV
                      </div>
                      <div style={s("flex:1;min-width:0")}>
                        <div style={s("font-size:var(--fs-2);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          <span style={{ fontFamily: TOKENS.mono }}>{e.maskedId}</span> · {e.roleTitle}
                        </div>
                        <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:1px")}>
                          {e.sinceLabel ? `${e.sinceLabel} · ` : ""}{e.rateLabel}/mo
                        </div>
                      </div>
                      <div style={s("display:flex;align-items:center;gap:5px;flex:none")}>
                        <span style={sx("width:6px;height:6px;border-radius:50%", { background: st.dot })} />
                        <span style={sx("font-size:var(--fs-1);font-weight:600", { color: st.dot })}>{st.label}</span>
                      </div>
                    </div>
                  );
                })}
                {overview.engagements.length === 0 ? (
                  <div style={s("font-size:var(--fs-2);color:var(--t4)")}>No active engagements yet.</div>
                ) : overview.engagements.length > 6 ? (
                  <Link href="/client/engagements" style={s("font-size:var(--fs-2);font-weight:700;color:var(--brand);display:inline-block;padding:6px 0")}>
                    See all {overview.engagements.length} people working
                  </Link>
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
  return istFormat(iso, { day: "numeric", month: "short" });
}
