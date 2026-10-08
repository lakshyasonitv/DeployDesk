import { Shell, PageHeader, Scroll, Card, SectionLabel, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientInterviews, getClientFeedbackDue } from "@/src/read-models/client";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";
import { FeedbackCard } from "./FeedbackCard";
import { SlotButton } from "./SlotPlanner";
import { istFormat } from "@/src/lib/derived";

/**
 * Client · Interviews & feedback.
 *
 * The line that matters: an interview in `awaiting_vendor` shows "Your Talentvibes team
 * supplier release" — never a supplier name. That copy is produced by the read model
 * and asserted by a leak test.
 */
export const metadata = { title: "Interviews · DeployDesk" };

export default async function ClientInterviewsPage() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const interviews = await getClientInterviews(session.orgId);
  const feedback = await getClientFeedbackDue(session.orgId);
  const aside = await ShellAside(session.orgId);

  const scheduled = interviews.filter((i) => i.scheduledAt);
  const waiting = interviews.filter((i) => i.waitingLabel);

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="interviews" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Interviews"
        subtitle="Talentvibes schedules every round and issues the meeting link. Your panel never contacts the supplier."
        /**
         * No header actions.
         *
         * "Propose new slots" lives on each round instead: a header button has no round
         * attached and this screen lists several, so it would either guess or open a
         * chooser that clicking a round already is. Same call as the extension request on
         * "People working". v2 (SCREENS.md:83) puts it in the header.
         *
         * "Panel availability" is GONE rather than left inert. It needs a recurring
         * availability model, and `interview_slots.interview_id` is `not null` — every slot
         * must hang off a specific round, so there is nowhere to record "Tuesdays suit us".
         * That is a new table, which needs the owner's approval under the database-safety
         * rule, so it is recorded in the brain rather than faked with a read-only list
         * under a button that says "set".
         */
        actions={null}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:1.5fr 1fr;gap:16px;align-items:start")}>
          <div style={s("display:flex;flex-direction:column;gap:11px")}>
            <SectionLabel>SCHEDULED</SectionLabel>
            {scheduled.map((iv) => {
              const d = new Date(iv.scheduledAt!);
              return (
                <div key={`${iv.maskedId}-${iv.roundLabel}`} style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px;display:flex;gap:13px;align-items:flex-start")}>
                  <div style={s("width:52px;flex:none;text-align:center;background:var(--surface-2);border-radius:9px;padding:8px 0")}>
                    <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
                      {istFormat(d, { month: "short" }).toUpperCase()}
                    </div>
                    <div style={s("font-size:19px;font-weight:800;line-height:1.1")}>
                      {istFormat(d, { day: "2-digit" })}
                    </div>
                    <div style={sx("font-size:9.5px;color:var(--t3)", { fontFamily: TOKENS.mono })}>
                      {istFormat(d, { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </div>
                  </div>
                  <div style={s("flex:1;min-width:0")}>
                    <div style={s("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
                      <span style={sx("font-size:13px;font-weight:700", { fontFamily: TOKENS.mono })}>{iv.maskedId}</span>
                      <Pill bg="var(--brand-tint)" fg="var(--brand)">{iv.roundLabel}</Pill>
                      <span style={sx("font-size:10.5px;color:var(--t4)", { fontFamily: TOKENS.mono })}>{iv.requirementCode}</span>
                    </div>
                    <div style={s("font-size:12.5px;font-weight:600;margin-top:5px")}>{iv.roleTitle}</div>
                    <div style={s("font-size:11.5px;color:var(--t3);margin-top:3px")}>
                      {iv.durationLabel}{iv.modeLabel ? ` · ${iv.modeLabel}` : ""}
                    </div>
                  </div>
                  <div style={s("flex:none;display:flex;flex-direction:column;gap:6px;align-items:stretch")}>
                    {/*
                      A real link when one exists. `meeting_url` is always Talentvibes-issued
                      -- docs/MASKING.md lists a link on the vendor's workspace domain as a
                      side channel -- and it is null until a round is confirmed, which is why
                      this cannot always be live. It says so instead of looking broken.
                    */}
                    {iv.meetingUrl ? (
                      <a href={iv.meetingUrl} target="_blank" rel="noreferrer"
                        style={s("padding:0 13px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:9px;font-size:12px;font-weight:700;background:var(--brand);color:#fff;text-decoration:none;white-space:nowrap")}>
                        Join
                      </a>
                    ) : (
                      <span title="Your Talentvibes team issues the link once the round is locked."
                        style={s("padding:0 13px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px dashed var(--border-2);border-radius:9px;font-size:12px;font-weight:600;color:var(--t4);white-space:nowrap")}>
                        Link to come
                      </span>
                    )}
                    <SlotButton round={{
                      maskedId: iv.maskedId, roundNo: iv.roundNo, roundLabel: iv.roundLabel,
                      status: iv.status, scheduledAt: iv.scheduledAt, slots: iv.slots,
                    }} />
                  </div>
                </div>
              );
            })}

            {waiting.length ? (
              <>
                <SectionLabel>AWAITING CONFIRMATION</SectionLabel>
                {waiting.map((iv) => (
                  <div key={`${iv.maskedId}-wait`} style={s("background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:12px;padding:13px")}>
                    <div style={s("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
                      <span style={sx("font-size:13px;font-weight:700", { fontFamily: TOKENS.mono })}>{iv.maskedId}</span>
                      <Pill bg="var(--warn-tint)" fg="var(--warn)">AWAITING</Pill>
                      <span style={sx("font-size:10.5px;color:var(--t4)", { fontFamily: TOKENS.mono })}>{iv.requirementCode}</span>
                    </div>
                    {/* The client is told the broker is working, never which supplier. */}
                    <div style={s("font-size:12.5px;color:var(--warn);font-weight:600;margin-top:6px")}>
                      {iv.waitingLabel}
                    </div>
                    <div style={s("font-size:11.5px;color:var(--t3);margin-top:4px")}>
                      You proposed slots{iv.requestedAgo ? ` ${iv.requestedAgo}` : ""}. Your Talentvibes team confirms
                      release and comes back with a locked slot and a Talentvibes meeting link.
                    </div>
                    <div style={s("margin-top:9px")}>
                      <SlotButton round={{
                        maskedId: iv.maskedId, roundNo: iv.roundNo, roundLabel: iv.roundLabel,
                        status: iv.status, scheduledAt: iv.scheduledAt, slots: iv.slots,
                      }} />
                    </div>
                  </div>
                ))}
              </>
            ) : null}

            {interviews.length === 0 ? (
              <div style={s("background:var(--surface);border:1px dashed var(--border-2);border-radius:12px;padding:30px;text-align:center;color:var(--t4);font-size:12.5px")}>
                No interviews yet. Select profiles on a shortlist and request interviews.
              </div>
            ) : null}
          </div>

          {/* feedback card — real interview_feedback rows */}
          {feedback.length ? (
            <Card pad="13px">
              <div style={s("display:flex;align-items:center;justify-content:space-between;margin-bottom:9px")}>
                <SectionLabel>FEEDBACK DUE</SectionLabel>
                <Pill bg="var(--warn-tint)" fg="var(--warn)">{feedback.length}</Pill>
              </div>
              {/*
                Was a read-only set of bars with two dead buttons while
                /api/client/interviews/feedback already existed and was tested. Now a form.
              */}
              {feedback.slice(0, 2).map((f) => (
                <FeedbackCard
                  key={f.maskedId + f.roundLabel}
                  maskedId={f.maskedId}
                  roundNo={f.roundNo}
                  roundLabel={f.roundLabel}
                  roleTitle={f.roleTitle}
                  requirementCode={f.requirementCode}
                  ratings={f.ratings}
                  notes={f.notes}
                />
              ))}
              <div style={s("font-size:10.5px;color:var(--t4);line-height:1.55;padding-top:10px;border-top:1px solid var(--surface-3)")}>
                Talentvibes relays a redacted summary to the supplier with your company name and
                commercials removed. Your panel notes are never forwarded verbatim.
              </div>
            </Card>
          ) : (
            <Card pad="13px">
              <SectionLabel>FEEDBACK DUE</SectionLabel>
              <div style={s("font-size:12px;color:var(--t4)")}>
                Nothing outstanding. Feedback appears here after an interview completes.
              </div>
            </Card>
          )}
        </div>
      </Scroll>
    </Shell>
  );
}
