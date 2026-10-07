"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { Pill, ScoreBars } from "@/src/lib/ui/Shell";
import { useToast } from "@/src/lib/ui/Toast";
import type { ClientEngagement } from "@/src/read-models/client";

/**
 * "People working", clickable.
 *
 * The owner asked for a row to open "full information about the resource like name date of
 * joining etc." The date of joining is here, along with everything else the client is
 * allowed to know. The NAME is not, and the panel says so in plain words rather than
 * leaving a gap that reads like a bug — a name is a side channel to the supplier
 * (name -> public profile -> current employer), and supplier identity is what the product
 * exists to protect.
 *
 * The panel is also where you ACT. A read-only box would largely restate the row it was
 * opened from; the question a client actually has about someone already working is "when
 * does this end and what do I do about it", so the panel carries the extension request —
 * a button that had existed with no handler since the screen was built.
 */

const COLS = "116px 1fr 118px 118px 128px 112px";

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: "var(--ok-tint)", fg: "var(--ok)", label: "ACTIVE" },
  onboarding: { bg: "var(--info-tint)", fg: "var(--info)", label: "STARTING" },
  ending: { bg: "var(--warn-tint)", fg: "var(--warn)", label: "ENDING" },
  ended: { bg: "var(--surface-3)", fg: "var(--t4)", label: "ENDED" },
  terminated: { bg: "var(--danger-tint)", fg: "var(--danger)", label: "STOPPED" },
};

/**
 * YYYY-MM-DD, computed in UTC.
 *
 * The endpoint parses these strings as `T00:00:00Z` and rejects a date that is not strictly
 * after BOTH today and the agreed end date. Doing the arithmetic in local time here would
 * disagree with that: in any timezone behind UTC, local "tomorrow" at `T00:00:00Z` can
 * already be in the past by the server's reckoning, so the picker would offer the first
 * allowed date and the server would answer `date_in_past`. Both ends now use UTC.
 */
function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Midnight UTC, `offsetDays` after whichever is later: today, or the agreed end date. */
function afterBoth(endDateIso: string | null, offsetDays: number, offsetMonths = 0) {
  const end = endDateIso ? new Date(`${endDateIso}T00:00:00Z`).getTime() : 0;
  const d = new Date(Math.max(Date.now(), end));
  if (offsetMonths) d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  d.setUTCHours(0, 0, 0, 0);
  return isoDay(d);
}

export function EngagementsTable({ engagements }: { engagements: ClientEngagement[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = engagements.find((e) => e.maskedId === openId) ?? null;

  return (
    <>
      <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden")}>
        <div style={s("overflow-x:auto")}>
          <div style={s("min-width:730px")}>
            <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
              {["REFERENCE", "ROLE", "WORKING SINCE", "ENDS", "YOUR MONTHLY RATE", "STATUS"].map((h) => (
                <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4);white-space:nowrap", { fontFamily: TOKENS.mono })}>{h}</div>
              ))}
            </div>

            {engagements.map((e) => {
              const st = STATUS[e.status] ?? STATUS.active;
              return (
                <div
                  key={e.maskedId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(e.maskedId)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setOpenId(e.maskedId); }
                  }}
                  title={`See ${e.maskedId}'s placement`}
                  style={sx("display:grid;padding:11px 15px;border-bottom:1px solid var(--surface-3);align-items:center;cursor:pointer;outline-offset:-2px", { gridTemplateColumns: COLS, gap: "10px" })}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--surface-2)"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
                >
                  <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{e.maskedId}</div>
                  <div style={s("font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{e.roleTitle}</div>
                  <div style={s("font-size:11.5px;color:var(--t3);white-space:nowrap")}>{e.startedOn}</div>
                  <div style={sx("font-size:11.5px;white-space:nowrap", {
                    // v2 SCREENS.md:100 — an end date that is close shows amber and bold.
                    color: e.endsOn ? (e.endingSoon ? "var(--warn)" : "var(--t3)") : "var(--t4)",
                    fontWeight: e.endingSoon ? 700 : 400,
                  })}>
                    {e.endsOn ?? "open-ended"}
                  </div>
                  <div style={sx("font-size:12px;font-weight:700", { fontFamily: TOKENS.mono })}>{e.rateLabel}</div>
                  <div>
                    <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.08em;white-space:nowrap", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                      {st.label}
                    </span>
                  </div>
                </div>
              );
            })}

            {engagements.length === 0 ? (
              <div style={s("padding:28px;text-align:center;color:var(--t4);font-size:12.5px")}>
                Nobody is working for you through Talentvibes yet.
              </div>
            ) : null}
          </div>
        </div>

        {engagements.length ? (
          <div style={s("padding:10px 15px;background:var(--surface-2);font-size:11px;color:var(--t4)")}>
            Click anyone to see their full placement, their test result, and to ask to
            keep them for longer.
          </div>
        ) : null}
      </div>

      {/* `key` so each person gets a fresh panel. Without it, React reconciles the same
          element position and the date, note and open/closed form state would carry over
          from the last person viewed -- including the previous placement's end date as the
          default. */}
      {open ? <PlacementPanel key={open.maskedId} e={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function Fact({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div>
      <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4)", { fontFamily: TOKENS.mono })}>{k}</div>
      <div style={sx("font-size:12.5px;font-weight:600;margin-top:3px", { color: tone ?? "var(--t1)" })}>{v}</div>
    </div>
  );
}

function PlacementPanel({ e, onClose }: { e: ClientEngagement; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const st = STATUS[e.status] ?? STATUS.active;

  // Three months past whichever is later, the agreed end or today.
  const defaultUntil = useMemo(() => afterBoth(e.endDateIso, 0, 3), [e.endDateIso]);
  // The earliest the endpoint will accept: the day after both.
  const minUntil = useMemo(() => afterBoth(e.endDateIso, 1), [e.endDateIso]);

  const [until, setUntil] = useState(defaultUntil);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  async function request() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/client/engagements/extension", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maskedId: e.maskedId, requestedUntil: until, note: note.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error === "already_open"
            ? "There is already a request in progress for this person."
            : body?.error === "not_an_extension"
              ? "Pick a date after the current end date."
              : body?.error === "date_in_past"
                ? "Pick a date in the future."
                : "Could not send that request.",
        );
      }

      toast({
        message: `Asked to keep ${e.maskedId} until ${until}. Your Talentvibes team will confirm.`,
        /**
         * A real reversal, not a dialog. Withdrawing sets the row to `withdrawn` rather
         * than deleting it — this is a commercial request in a brokered marketplace, and
         * the audit trail is the thing a dispute is argued over later.
         */
        undo: async () => {
          const r = await fetch("/api/client/engagements/extension", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ maskedId: e.maskedId }),
          });
          if (!r.ok) throw new Error("withdraw failed");
          router.refresh();
        },
      });
      setAsking(false);
      router.refresh();
    } catch (err) {
      toast({ tone: "error", message: err instanceof Error ? err.message : "Could not send that request." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={s("position:fixed;inset:0;background:rgba(16,16,20,.34);display:flex;justify-content:flex-end;z-index:50")}
      onClick={onClose}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={s("width:430px;max-width:100%;background:var(--surface);height:100%;display:flex;flex-direction:column;box-shadow:-18px 0 44px rgba(16,16,20,.18)")}
      >
        {/* ---------------------------------------------------------- header */}
        <div style={s("padding:15px 17px;border-bottom:1px solid var(--border);flex:none")}>
          <div style={s("display:flex;align-items:flex-start;justify-content:space-between;gap:10px")}>
            <div style={s("min-width:0")}>
              <div style={sx("font-size:14px;font-weight:800", { fontFamily: TOKENS.mono })}>{e.maskedId}</div>
              <div style={s("font-size:12.5px;color:var(--t2);margin-top:2px")}>{e.roleTitle}</div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={s("border:0;background:transparent;font-size:19px;color:var(--t4);cursor:pointer;line-height:1;flex:none")}
            >
              ×
            </button>
          </div>
          <div style={s("margin-top:9px")}>
            <Pill bg={st.bg} fg={st.fg}>{st.label}</Pill>
          </div>
        </div>

        <div style={s("flex:1;overflow:auto;padding:16px 17px;display:flex;flex-direction:column;gap:16px")}>
          {/* ------------------------------------------------- the contract */}
          <div style={s("display:grid;grid-template-columns:1fr 1fr;gap:13px")}>
            <Fact k="WORKING SINCE" v={e.startedOn} />
            <Fact k="HOW LONG" v={e.tenureLabel} />
            <Fact
              k="ENDS"
              v={e.endsOn ?? "No end date agreed"}
              tone={e.endsOn ? (e.endingSoon ? "var(--warn)" : undefined) : "var(--t4)"}
            />
            <Fact k="YOU PAY" v={`${e.rateLabel} per month`} />
          </div>

          {/* ------------------------------------------------- the person */}
          <div style={s("border-top:1px solid var(--border);padding-top:14px")}>
            <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-bottom:9px", { fontFamily: TOKENS.mono })}>
              ABOUT THIS ENGINEER
            </div>
            <div style={s("display:grid;grid-template-columns:1fr 1fr;gap:13px")}>
              <Fact k="EXPERIENCE" v={e.experienceLabel} />
              <Fact k="BASED IN" v={e.baseCity} />
              {e.workModes.length ? <Fact k="WORKS" v={e.workModes.join(", ")} /> : null}
              {e.noticePeriodLabel ? <Fact k="NOTICE PERIOD" v={e.noticePeriodLabel} /> : null}
            </div>
            {e.skills.length ? (
              <div style={s("display:flex;flex-wrap:wrap;gap:4px;margin-top:12px")}>
                {e.skills.map((sk) => (
                  <span key={sk} style={s("padding:3px 8px;background:var(--surface-3);border-radius:5px;font-size:10.5px;font-weight:600;color:var(--t2)")}>
                    {sk}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* ------------------------------------------------- the test */}
          <div style={s("border-top:1px solid var(--border);padding-top:14px")}>
            <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-bottom:9px", { fontFamily: TOKENS.mono })}>
              INDEPENDENT TEST RESULT
            </div>
            {e.assessment ? (
              <>
                <div style={s("display:flex;align-items:center;gap:14px")}>
                  <div>
                    <div style={sx("font-size:26px;font-weight:800;line-height:1", {
                      color: (e.assessment.scoreOverall ?? 0) >= 85 ? "var(--ok)" : "var(--brand)",
                    })}>
                      {e.assessment.scoreOverall ?? "—"}
                    </div>
                    <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
                      TEST SCORE
                    </div>
                  </div>
                  <ScoreBars
                    sections={{
                      coding: e.assessment.sections[0]?.value ?? null,
                      dsa: e.assessment.sections[1]?.value ?? null,
                      systemDesign: e.assessment.sections[2]?.value ?? null,
                      communication: e.assessment.sections[3]?.value ?? null,
                    }}
                    width={210}
                  />
                </div>
                <div style={s("font-size:10.5px;color:var(--t4);margin-top:10px;line-height:1.5")}>
                  {e.assessment.attemptNo === 1 ? "First attempt" : `Attempt ${e.assessment.attemptNo ?? "—"}`}
                  {e.assessment.testedOn ? ` · tested ${e.assessment.testedOn}` : ""}
                  {" · proctored by an independent provider, taken before you interviewed them."}
                </div>
              </>
            ) : (
              /**
               * The common case, not the edge: the seed creates engagements with
               * `requirement_id = null`, so most placements have no shortlist lineage and
               * therefore no snapshot. Say why rather than render an empty block.
               */
              <div style={s("font-size:11.5px;color:var(--t4);line-height:1.55")}>
                No test result is on file for this placement. Scores are captured on the
                shortlist a person arrives on, so placements arranged outside that flow do
                not carry one.
              </div>
            )}
          </div>

          {/* ------------------------------------------------- extension */}
          <div style={s("border-top:1px solid var(--border);padding-top:14px")}>
            <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-bottom:9px", { fontFamily: TOKENS.mono })}>
              KEEPING THEM FOR LONGER
            </div>

            {e.extension && !e.extension.settled ? (
              <div style={s("background:var(--info-tint);border:1px solid var(--info-tint);border-radius:9px;padding:11px")}>
                <div style={s("font-size:12px;font-weight:700;color:var(--info)")}>{e.extension.statusLabel}</div>
                <div style={s("font-size:11.5px;color:var(--t2);margin-top:4px;line-height:1.5")}>
                  You asked to keep them until {e.extension.requestedUntil}. We are checking that
                  they are free to stay and will come back to you.
                </div>
              </div>
            ) : asking ? (
              <>
                <label style={s("display:block;font-size:11.5px;color:var(--t2);margin-bottom:5px")}>
                  Keep them until
                </label>
                <input
                  type="date"
                  value={until}
                  min={minUntil}
                  onChange={(ev) => setUntil(ev.target.value)}
                  style={s("width:100%;padding:9px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")}
                />
                <textarea
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                  rows={3}
                  placeholder="Anything that would help — a project date, a phase that slipped."
                  style={s("width:100%;margin-top:9px;padding:9px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12px;font-family:inherit;outline:none;resize:vertical;line-height:1.5")}
                />
                <div style={s("font-size:10.5px;color:var(--t4);margin-top:5px;line-height:1.5")}>
                  Your note goes to your Talentvibes team only. It is never passed on word for word.
                </div>
                <div style={s("display:flex;gap:7px;margin-top:11px")}>
                  <button
                    onClick={request}
                    disabled={busy}
                    style={sx("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:0;border-radius:9px;font-size:12.5px;font-weight:700;color:#fff;background:var(--brand);font-family:inherit", {
                      cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                    })}
                  >
                    {busy ? "Sending…" : "Send the request"}
                  </button>
                  <button
                    onClick={() => setAsking(false)}
                    disabled={busy}
                    style={s("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:1px solid var(--border-2);border-radius:9px;font-size:12.5px;font-weight:600;background:var(--surface);cursor:pointer;font-family:inherit")}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {e.extension?.settled ? (
                  <div style={s("font-size:11.5px;color:var(--t2);margin-bottom:10px;line-height:1.55")}>
                    Your last request (until {e.extension.requestedUntil}) came back:{" "}
                    <strong style={s("font-weight:700")}>{e.extension.statusLabel.toLowerCase()}</strong>.
                  </div>
                ) : (
                  <div style={s("font-size:11.5px;color:var(--t2);margin-bottom:10px;line-height:1.55")}>
                    {e.endsOn
                      ? `This placement ends ${e.endsOn}. Ask now and we will check whether they can stay.`
                      : "There is no agreed end date. You can still fix one further out if you want certainty."}
                  </div>
                )}
                <button
                  onClick={() => setAsking(true)}
                  style={s("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:0;border-radius:9px;font-size:12.5px;font-weight:700;color:#fff;background:var(--brand);cursor:pointer;font-family:inherit")}
                >
                  Request an extension
                </button>
              </>
            )}
          </div>
        </div>

        {/* ------------------------------------------------- masking note */}
        <div style={s("flex:none;padding:12px 17px;border-top:1px solid var(--border);background:var(--surface-2)")}>
          <div style={s("font-size:10.5px;color:var(--t4);line-height:1.6")}>
            <strong style={s("font-weight:700;color:var(--t3)")}>Why there is no name here.</strong>{" "}
            Names and supplier details are hidden on purpose. A name would let anyone trace
            which supplier this engineer works for — and once the two sides can find each
            other, neither your rate nor theirs stays private. You contract with Talentvibes
            alone, which is what keeps that true.
          </div>
        </div>
      </div>
    </div>
  );
}
