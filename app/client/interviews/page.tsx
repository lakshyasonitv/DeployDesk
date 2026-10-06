import { Shell, PageHeader, Scroll, Button, Card, SectionLabel, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession } from "@/src/lib/auth/session";
import { getClientInterviews, getClientFeedbackDue } from "@/src/read-models/client";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";

/**
 * Client · Interviews & feedback.
 *
 * The line that matters: an interview in `awaiting_vendor` shows "Broker is confirming
 * supplier release" — never a supplier name. That copy is produced by the read model
 * and asserted by a leak test.
 */
export const metadata = { title: "Interviews · Bench Exchange" };

export default async function ClientInterviewsPage() {
  const session = await getDemoSession("client");
  const interviews = await getClientInterviews(session.orgId);
  const feedback = await getClientFeedbackDue(session.orgId);
  const aside = await ShellAside(session.orgId);

  const scheduled = interviews.filter((i) => i.scheduledAt);
  const waiting = interviews.filter((i) => i.waitingLabel);

  return (
    <Shell portal="client" user={{ name: session.userName, org: session.orgName }} activeKey="interviews" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Interviews & feedback"
        subtitle="Talentvibes schedules every round and issues the meeting link. Your panel never contacts the supplier."
        actions={<><Button>Panel availability</Button><Button primary>Propose new slots</Button></>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start")}>
          <div style={s("display:flex;flex-direction:column;gap:11px")}>
            <SectionLabel>SCHEDULED</SectionLabel>
            {scheduled.map((iv) => {
              const d = new Date(iv.scheduledAt!);
              return (
                <div key={`${iv.maskedId}-${iv.roundLabel}`} style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:13px;display:flex;gap:13px;align-items:flex-start")}>
                  <div style={s("width:52px;flex:none;text-align:center;background:#fafafc;border-radius:9px;padding:8px 0")}>
                    <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
                      {d.toLocaleDateString("en-IN", { month: "short" }).toUpperCase()}
                    </div>
                    <div style={s("font-size:19px;font-weight:800;line-height:1.1")}>
                      {d.toLocaleDateString("en-IN", { day: "2-digit" })}
                    </div>
                    <div style={sx("font-size:9.5px;color:#6b6b78", { fontFamily: TOKENS.mono })}>
                      {d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </div>
                  </div>
                  <div style={s("flex:1;min-width:0")}>
                    <div style={s("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
                      <span style={sx("font-size:13px;font-weight:700", { fontFamily: TOKENS.mono })}>{iv.maskedId}</span>
                      <Pill bg="#f1ecff" fg="#6d3ff0">{iv.roundLabel}</Pill>
                      <span style={sx("font-size:10.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>{iv.requirementCode}</span>
                    </div>
                    <div style={s("font-size:12.5px;font-weight:600;margin-top:5px")}>{iv.roleTitle}</div>
                    <div style={s("font-size:11.5px;color:#6b6b78;margin-top:3px")}>
                      {iv.durationLabel}{iv.modeLabel ? ` · ${iv.modeLabel}` : ""}
                    </div>
                  </div>
                  <div style={s("flex:none;display:flex;flex-direction:column;gap:6px")}>
                    <Button primary>Join</Button>
                    <Button>Reschedule</Button>
                  </div>
                </div>
              );
            })}

            {waiting.length ? (
              <>
                <SectionLabel>AWAITING CONFIRMATION</SectionLabel>
                {waiting.map((iv) => (
                  <div key={`${iv.maskedId}-wait`} style={s("background:#fff8ef;border:1px solid #f0dcc0;border-radius:12px;padding:13px")}>
                    <div style={s("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
                      <span style={sx("font-size:13px;font-weight:700", { fontFamily: TOKENS.mono })}>{iv.maskedId}</span>
                      <Pill bg="#fff3e4" fg="#b45309">AWAITING</Pill>
                      <span style={sx("font-size:10.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>{iv.requirementCode}</span>
                    </div>
                    {/* The client is told the broker is working, never which supplier. */}
                    <div style={s("font-size:12.5px;color:#b45309;font-weight:600;margin-top:6px")}>
                      {iv.waitingLabel}
                    </div>
                    <div style={s("font-size:11.5px;color:#6b6b78;margin-top:4px")}>
                      You proposed slots{iv.requestedAgo ? ` ${iv.requestedAgo}` : ""}. Your broker confirms
                      release and comes back with a locked slot and a Talentvibes meeting link.
                    </div>
                  </div>
                ))}
              </>
            ) : null}

            {interviews.length === 0 ? (
              <div style={s("background:#fff;border:1px dashed #e0e0e8;border-radius:12px;padding:30px;text-align:center;color:#8a8a96;font-size:12.5px")}>
                No interviews yet. Select profiles on a shortlist and request interviews.
              </div>
            ) : null}
          </div>

          {/* feedback card — real interview_feedback rows */}
          {feedback.length ? (
            <Card pad="13px">
              <div style={s("display:flex;align-items:center;justify-content:space-between;margin-bottom:9px")}>
                <SectionLabel>FEEDBACK DUE</SectionLabel>
                <Pill bg="#fff3e4" fg="#b45309">{feedback.length}</Pill>
              </div>
              {feedback.slice(0, 2).map((f) => (
                <div key={f.maskedId + f.roundLabel} style={s("margin-bottom:14px")}>
                  <div style={s("font-size:12.5px;font-weight:700")}>
                    <span style={{ fontFamily: TOKENS.mono }}>{f.maskedId}</span> · {f.roundLabel}
                  </div>
                  <div style={s("font-size:11px;color:#8a8a96;margin-top:2px")}>
                    {f.roleTitle} · {f.requirementCode}
                  </div>

                  <div style={s("margin-top:11px;display:flex;flex-direction:column;gap:9px")}>
                    {f.ratings.map((r) => (
                      <div key={r.label}>
                        <div style={s("display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px")}>
                          <span style={s("color:#4a4a58")}>{r.label}</span>
                          <span style={sx("font-weight:700", { fontFamily: TOKENS.mono })}>{r.value}</span>
                        </div>
                        <div style={s("display:flex;gap:3px")}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <span key={n} style={sx("flex:1;height:5px;border-radius:3px", { background: n <= r.value ? "#6d3ff0" : "#eeeef3" })} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {f.notes ? (
                    <div style={s("margin-top:11px;background:#fafafc;border-radius:8px;padding:10px;font-size:11.5px;color:#4a4a58;line-height:1.55")}>
                      {f.notes}
                    </div>
                  ) : null}

                  <div style={s("margin-top:11px;display:flex;gap:7px")}>
                    <Button primary>Submit feedback</Button>
                    <Button>Save draft</Button>
                  </div>
                </div>
              ))}
              <div style={s("font-size:10.5px;color:#8a8a96;line-height:1.55;padding-top:10px;border-top:1px solid #f1f1f5")}>
                Talentvibes relays a redacted summary to the supplier with your company name and
                commercials removed. Your panel notes are never forwarded verbatim.
              </div>
            </Card>
          ) : (
            <Card pad="13px">
              <SectionLabel>FEEDBACK DUE</SectionLabel>
              <div style={s("font-size:12px;color:#8a8a96")}>
                Nothing outstanding. Feedback appears here after an interview completes.
              </div>
            </Card>
          )}
        </div>
      </Scroll>
    </Shell>
  );
}
