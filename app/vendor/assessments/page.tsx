import { Shell, PageHeader, Scroll, Button, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getVendorAssessments } from "@/src/read-models/vendor";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { VendorAside } from "../aside";

/**
 * Vendor · Assessments.
 *
 * Score authority stays with the provider (ADR-006): there is no write path from any
 * /api/vendor/* route to a score column, which is why this screen is read-only about
 * scores and says so.
 */
export const metadata = { title: "Assessments · DeployDesk" };

const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  scored: { bg: "var(--ok-tint)", fg: "var(--ok)", label: "SCORED" },
  in_progress: { bg: "var(--warn-tint)", fg: "var(--warn)", label: "IN PROGRESS" },
  invited: { bg: "var(--warn-tint)", fg: "var(--warn)", label: "INVITE SENT" },
  not_started: { bg: "var(--surface-3)", fg: "var(--t4)", label: "NOT STARTED" },
  expired: { bg: "var(--danger-tint)", fg: "var(--danger)", label: "EXPIRED" },
  abandoned: { bg: "var(--surface-3)", fg: "var(--t4)", label: "ABANDONED" },
};

const ACTION: Record<string, string> = {
  scored: "View report", in_progress: "Nudge candidate", invited: "Resend invite",
  not_started: "Send invite", expired: "Request retake", abandoned: "Resend invite",
};

export default async function VendorAssessmentsPage() {
  const session = await getDemoSession("vendor");
  const nav = await getShellNav(session);
  const [a, aside] = await Promise.all([
    getVendorAssessments(session.orgId),
    VendorAside(session.orgId),
  ]);

  return (
    <Shell portal="vendor" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="assessments" asideTitle="FRESHNESS ALERTS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Assessments"
        subtitle="Proctored by Talentvibes. Scores are visible to you and to clients — you cannot edit them."
        actions={<Button primary accent="var(--teal)">Invite {a.summary.notStarted} to test</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          {[
            ["Scored", a.summary.scored, "var(--ok)"],
            ["In progress", a.summary.inProgress, "var(--warn)"],
            ["Not started", a.summary.notStarted, "var(--t4)"],
            ["Expired", a.summary.expired, "var(--danger)"],
          ].map(([label, n, color]) => (
            <div key={label as string} style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px")}>
              <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
                {(label as string).toUpperCase()}
              </div>
              <div style={sx("font-size:24px;font-weight:800;letter-spacing:-.7px;margin-top:6px;line-height:1", { color: color as string })}>
                {n as number}
              </div>
            </div>
          ))}
        </div>

        <div style={s("margin-top:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px")}>
          {a.cards.map((c) => {
            const pill = STATUS_PILL[c.status] ?? STATUS_PILL.not_started;
            return (
              <div key={c.maskedId} style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px")}>
                <div style={s("display:flex;align-items:flex-start;justify-content:space-between;gap:9px")}>
                  <div style={s("min-width:0")}>
                    <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {c.fullName}
                    </div>
                    <div style={sx("font-size:10.5px;color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>
                      {c.maskedId}{c.track ? ` · ${c.track}` : ""}
                    </div>
                  </div>
                  <span style={sx("padding:3px 7px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.07em;white-space:nowrap", { background: pill.bg, color: pill.fg, fontFamily: TOKENS.mono })}>
                    {pill.label}
                  </span>
                </div>

                <div style={s("display:flex;align-items:baseline;gap:9px;margin-top:11px")}>
                  <div style={sx("font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1", { color: c.overall != null ? pill.fg : "var(--border-2)" })}>
                    {c.overall ?? "—"}
                  </div>
                  <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
                    {c.overall != null && c.testedOn
                      ? `PROCTORED · ${fmt(c.testedOn)}`
                      : c.status === "not_started" ? "INVITE NOT SENT"
                      : c.status === "in_progress" ? "IN PROGRESS"
                      : pill.label}
                  </div>
                </div>

                <div style={s("margin-top:11px;display:flex;flex-direction:column;gap:4px")}>
                  {([["Coding", c.sections.coding], ["DSA", c.sections.dsa], ["System design", c.sections.systemDesign], ["Communication", c.sections.communication]] as Array<[string, number | null]>).map(([label, v]) => (
                    <div key={label} style={s("display:flex;align-items:center;gap:7px")}>
                      <div style={s("font-size:9.5px;color:var(--t4);width:72px;flex:none")}>{label}</div>
                      <div style={s("flex:1;height:4px;background:var(--border);border-radius:3px;overflow:hidden")}>
                        <div style={sx("height:100%;border-radius:3px", {
                          width: `${v ?? 0}%`,
                          background: (v ?? 0) >= 85 ? "var(--ok)" : (v ?? 0) >= 70 ? "var(--teal)" : "var(--warn)",
                        })} />
                      </div>
                      <div style={sx("font-size:9.5px;font-weight:700;width:20px;text-align:right", { fontFamily: TOKENS.mono })}>
                        {v ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={s("display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:12px;padding-top:10px;border-top:1px solid var(--surface-3)")}>
                  <div style={s("font-size:10px;color:var(--t4)")}>
                    {c.validUntil ? `valid until ${fmt(c.validUntil)}` : "attempt " + c.attemptNo}
                  </div>
                  <div style={s("font-size:11px;font-weight:700;color:var(--teal)")}>
                    {ACTION[c.status] ?? "View"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={s("margin-top:14px;background:var(--teal-tint);border:1px solid var(--ok-tint);border-radius:12px;padding:13px")}>
          <SectionLabel>WHY SCORES ARE READ-ONLY</SectionLabel>
          <div style={s("font-size:12px;color:var(--teal);line-height:1.6")}>
            Every score comes from the proctoring provider and is written by a signed webhook.
            Neither you nor the client can influence it — that independence is what makes the
            score worth showing on a masked profile.
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
}
