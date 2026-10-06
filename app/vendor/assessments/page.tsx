import { Shell, PageHeader, Scroll, Button, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession } from "@/src/lib/auth/session";
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
export const metadata = { title: "Assessments · Bench Exchange" };

const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  scored: { bg: "#e8f6ef", fg: "#0f7a4a", label: "SCORED" },
  in_progress: { bg: "#fff3e4", fg: "#b45309", label: "IN PROGRESS" },
  invited: { bg: "#fff3e4", fg: "#b45309", label: "INVITE SENT" },
  not_started: { bg: "#f3f3f7", fg: "#8a8a96", label: "NOT STARTED" },
  expired: { bg: "#fdecec", fg: "#b91c1c", label: "EXPIRED" },
  abandoned: { bg: "#f3f3f7", fg: "#8a8a96", label: "ABANDONED" },
};

const ACTION: Record<string, string> = {
  scored: "View report", in_progress: "Nudge candidate", invited: "Resend invite",
  not_started: "Send invite", expired: "Request retake", abandoned: "Resend invite",
};

export default async function VendorAssessmentsPage() {
  const session = await getDemoSession("vendor");
  const [a, aside] = await Promise.all([
    getVendorAssessments(session.orgId),
    VendorAside(session.orgId),
  ]);

  return (
    <Shell portal="vendor" user={{ name: session.userName, org: session.orgName }} activeKey="assessments" asideTitle="FRESHNESS ALERTS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Assessments"
        subtitle="Proctored by Talentvibes. Scores are visible to you and to clients — you cannot edit them."
        actions={<Button primary accent="#0d9488">Invite {a.summary.notStarted} to test</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          {[
            ["Scored", a.summary.scored, "#059669"],
            ["In progress", a.summary.inProgress, "#c2410c"],
            ["Not started", a.summary.notStarted, "#8a8a96"],
            ["Expired", a.summary.expired, "#b91c1c"],
          ].map(([label, n, color]) => (
            <div key={label as string} style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:14px")}>
              <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
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
              <div key={c.maskedId} style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:14px")}>
                <div style={s("display:flex;align-items:flex-start;justify-content:space-between;gap:9px")}>
                  <div style={s("min-width:0")}>
                    <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {c.fullName}
                    </div>
                    <div style={sx("font-size:10.5px;color:#8a8a96;margin-top:2px", { fontFamily: TOKENS.mono })}>
                      {c.maskedId}{c.track ? ` · ${c.track}` : ""}
                    </div>
                  </div>
                  <span style={sx("padding:3px 7px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.07em;white-space:nowrap", { background: pill.bg, color: pill.fg, fontFamily: TOKENS.mono })}>
                    {pill.label}
                  </span>
                </div>

                <div style={s("display:flex;align-items:baseline;gap:9px;margin-top:11px")}>
                  <div style={sx("font-size:30px;font-weight:800;letter-spacing:-1px;line-height:1", { color: c.overall != null ? pill.fg : "#c9c9d2" })}>
                    {c.overall ?? "—"}
                  </div>
                  <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
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
                      <div style={s("font-size:9.5px;color:#8a8a96;width:72px;flex:none")}>{label}</div>
                      <div style={s("flex:1;height:4px;background:#eeeef3;border-radius:3px;overflow:hidden")}>
                        <div style={sx("height:100%;border-radius:3px", {
                          width: `${v ?? 0}%`,
                          background: (v ?? 0) >= 85 ? "#16a34a" : (v ?? 0) >= 70 ? "#0d9488" : "#c2410c",
                        })} />
                      </div>
                      <div style={sx("font-size:9.5px;font-weight:700;width:20px;text-align:right", { fontFamily: TOKENS.mono })}>
                        {v ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={s("display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:12px;padding-top:10px;border-top:1px solid #f1f1f5")}>
                  <div style={s("font-size:10px;color:#8a8a96")}>
                    {c.validUntil ? `valid until ${fmt(c.validUntil)}` : "attempt " + c.attemptNo}
                  </div>
                  <div style={s("font-size:11px;font-weight:700;color:#0d9488")}>
                    {ACTION[c.status] ?? "View"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={s("margin-top:14px;background:#f0fdfa;border:1px solid #cfe9dd;border-radius:12px;padding:13px")}>
          <SectionLabel>WHY SCORES ARE READ-ONLY</SectionLabel>
          <div style={s("font-size:12px;color:#0f766e;line-height:1.6")}>
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
