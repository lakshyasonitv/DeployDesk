"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";
import type { ClientInterviewSlot } from "@/src/read-models/client";

/**
 * Offering times for an interview round, and asking to move one.
 *
 * "Propose new slots" and "Reschedule" were buttons with no handler until migration 0005
 * created `interview_slots`. This is the client island that drives
 * `/api/client/interviews/slots`.
 *
 * **The control is on the round, not in the page header.** v2 (`SCREENS.md:83`) puts
 * "Propose new slots" in the header, but a header button has no round attached and this
 * screen lists several — it would either guess or open a chooser that clicking a round
 * already is. Same reasoning as the extension request on "People working".
 *
 * **The picker means IST, and says so.** A `datetime-local` input hands back the VIEWER's
 * wall clock. The window a slot is validated against is 09:00-19:00 IST, so a viewer
 * outside India picking "11:00" would be offering 05:30 IST and be told it is outside
 * business hours — correct, and baffling. So the value is read as IST wall-clock
 * regardless of where the browser is, and the field is labelled IST.
 */

type Round = {
  maskedId: string;
  roundNo: number;
  roundLabel: string;
  status: string;
  scheduledAt: string | null;
  slots: ClientInterviewSlot[];
};

const SLOT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  proposed: { bg: "var(--warn-tint)", fg: "var(--warn)", label: "OFFERED" },
  accepted: { bg: "var(--ok-tint)", fg: "var(--ok)", label: "BOOKED" },
  declined: { bg: "var(--surface-3)", fg: "var(--t4)", label: "DID NOT WORK" },
  withdrawn: { bg: "var(--surface-3)", fg: "var(--t4)", label: "WITHDRAWN" },
};

/** IST is UTC+05:30, fixed — no DST since 1945. Mirrors src/lib/business-clock.ts. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Reads a `datetime-local` value as IST wall-clock and returns the real instant. */
function istWallClockToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const utcAsIfIst = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return new Date(utcAsIfIst - IST_OFFSET_MS).toISOString();
}

/** Tomorrow at 09:00 IST, as a `datetime-local` value. */
function defaultSlotValue(): string {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  istNow.setUTCDate(istNow.getUTCDate() + 1);
  const d = istNow.toISOString().slice(0, 10);
  return `${d}T09:00`;
}

export function SlotButton({ round }: { round: Round }) {
  const [open, setOpen] = useState(false);
  const isMove = round.status === "confirmed" && round.scheduledAt;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={s("padding:0 13px;height:32px;display:inline-flex;align-items:center;border:1px solid var(--border-2);border-radius:9px;font-size:12px;font-weight:600;background:var(--surface);cursor:pointer;font-family:inherit;white-space:nowrap")}
      >
        {isMove ? "Move this" : "Offer times"}
      </button>
      {open ? <SlotDrawer round={round} isMove={Boolean(isMove)} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SlotDrawer({
  round, isMove, onClose,
}: {
  round: Round;
  isMove: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [times, setTimes] = useState<string[]>([defaultSlotValue()]);
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);

  const setAt = (i: number, v: string) =>
    setTimes((prev) => prev.map((t, j) => (j === i ? v : t)));

  async function send() {
    if (busy) return;
    const slots = times
      .map((t) => istWallClockToIso(t))
      .filter((x): x is string => Boolean(x))
      .map((startsAt) => ({ startsAt, durationMinutes: duration }));

    if (!slots.length) {
      toast({ tone: "error", message: "Pick at least one time." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/client/interviews/slots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maskedId: round.maskedId, roundNo: round.roundNo, slots }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error === "outside_business_hours"
            ? "Interviews run 09:00–19:00 IST, Monday to Saturday, and the whole slot has to fit."
            : body?.error === "slot_in_past"
              ? "Pick a time in the future."
              : body?.error === "duplicate_slot"
                ? "Two of those times are the same."
                : body?.error === "round_closed"
                  ? "This round is already finished."
                  : "Could not send those times.",
        );
      }
      const out = await res.json() as { slotIds: string[] };

      toast({
        message: isMove
          ? `Asked to move ${round.maskedId}. The current time stands until we confirm a new one.`
          : `Sent ${slots.length} time${slots.length === 1 ? "" : "s"} for ${round.maskedId} to your Talentvibes team.`,
        // Withdraws exactly the rows this call created, so an earlier batch still waiting
        // for an answer is left alone.
        undo: async () => {
          const r = await fetch("/api/client/interviews/slots", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              maskedId: round.maskedId, roundNo: round.roundNo, slotIds: out.slotIds,
            }),
          });
          if (!r.ok) throw new Error("withdraw failed");
          router.refresh();
        },
      });
      onClose();
      router.refresh();
    } catch (e) {
      toast({ tone: "error", message: e instanceof Error ? e.message : "Could not send those times." });
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
        onClick={(e) => e.stopPropagation()}
        style={s("width:420px;max-width:100%;background:var(--surface);height:100%;display:flex;flex-direction:column;box-shadow:-18px 0 44px rgba(16,16,20,.18)")}
      >
        <div style={s("padding:15px 17px;border-bottom:1px solid var(--border);flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:10px")}>
          <div>
            <div style={s("font-size:13.5px;font-weight:800")}>
              {isMove ? "Move this interview" : "Offer times"}
            </div>
            <div style={sx("font-size:10.5px;font-weight:600;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
              {round.maskedId} · {round.roundLabel}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={s("border:0;background:transparent;font-size:19px;color:var(--t4);cursor:pointer;line-height:1;flex:none")}>
            ×
          </button>
        </div>

        <div style={s("flex:1;overflow:auto;padding:16px 17px;display:flex;flex-direction:column;gap:16px")}>
          <div style={s("font-size:12px;color:var(--t2);line-height:1.6")}>
            {isMove
              ? "Tell us when else would work. The time already booked stays in your calendar until we confirm a replacement — we check the engineer is free before anything changes."
              : "Give us a few times that suit your panel. We confirm the engineer is free and come back with one locked slot and a Talentvibes meeting link."}
          </div>

          {round.slots.length ? (
            <div>
              <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-bottom:8px", { fontFamily: TOKENS.mono })}>
                TIMES SO FAR
              </div>
              <div style={s("display:flex;flex-direction:column;gap:6px")}>
                {round.slots.map((sl) => {
                  const st = SLOT_STYLE[sl.status] ?? SLOT_STYLE.proposed;
                  return (
                    <div key={sl.startsAtIso + sl.status}
                      style={s("display:flex;align-items:center;justify-content:space-between;gap:9px;padding:8px 10px;background:var(--surface-2);border-radius:8px")}>
                      <div style={s("min-width:0")}>
                        <div style={s("font-size:12px;font-weight:600")}>{sl.label}</div>
                        <div style={s("font-size:10.5px;color:var(--t4);margin-top:2px")}>
                          {sl.durationLabel} · offered by {sl.byLabel}
                        </div>
                      </div>
                      <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.07em;flex:none", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              {round.slots.some((sl) => sl.status === "declined") ? (
                /**
                 * Deliberately no reason. `interview_slots.decline_reason` is free text and
                 * the table has no `declined_by`, so there is no way to know whether a
                 * given reason was written by a broker or by the supplier — and a
                 * supplier's own words reaching a client is the leak masking exists to
                 * prevent. A broker-authored relay field would fix it; there isn't one yet.
                 */
                <div style={s("font-size:10.5px;color:var(--t4);margin-top:8px;line-height:1.55")}>
                  Where a time did not work, your Talentvibes team has the detail and will
                  explain if it matters.
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-bottom:8px", { fontFamily: TOKENS.mono })}>
              TIMES THAT WORK FOR YOU · IST
            </div>
            <div style={s("display:flex;flex-direction:column;gap:7px")}>
              {times.map((t, i) => (
                <div key={i} style={s("display:flex;align-items:center;gap:7px")}>
                  <input
                    type="datetime-local"
                    value={t}
                    onChange={(e) => setAt(i, e.target.value)}
                    style={s("flex:1;padding:9px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")}
                  />
                  {times.length > 1 ? (
                    <button
                      onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="Remove this time"
                      style={s("border:1px solid var(--border-2);background:var(--surface);border-radius:8px;width:32px;height:34px;cursor:pointer;color:var(--t4);font-size:15px;line-height:1;font-family:inherit")}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {times.length < 5 ? (
              <button
                onClick={() => setTimes((prev) => [...prev, defaultSlotValue()])}
                style={s("margin-top:8px;padding:6px 11px;border:1px dashed var(--border-2);border-radius:8px;font-size:11.5px;font-weight:600;background:transparent;cursor:pointer;color:var(--t3);font-family:inherit")}
              >
                + Another time
              </button>
            ) : null}
            <div style={s("font-size:10.5px;color:var(--t4);margin-top:9px;line-height:1.55")}>
              Times are Indian Standard Time. Interviews run 09:00–19:00 IST, Monday to
              Saturday, and public holidays are excluded.
            </div>
          </div>

          <div>
            <div style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-bottom:7px", { fontFamily: TOKENS.mono })}>
              HOW LONG
            </div>
            <div style={s("display:flex;gap:6px;flex-wrap:wrap")}>
              {[30, 45, 60, 90].map((m) => (
                <button
                  key={m}
                  onClick={() => setDuration(m)}
                  style={sx("padding:6px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
                    background: duration === m ? "var(--brand)" : "var(--surface)",
                    color: duration === m ? "#fff" : "var(--t2)",
                    border: `1px solid ${duration === m ? "var(--brand)" : "var(--border-2)"}`,
                  })}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={s("flex:none;padding:13px 17px;border-top:1px solid var(--border);display:flex;gap:7px")}>
          <button
            onClick={send}
            disabled={busy}
            style={sx("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:0;border-radius:9px;font-size:12.5px;font-weight:700;color:#fff;background:var(--brand);font-family:inherit", {
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            })}
          >
            {busy ? "Sending…" : isMove ? "Ask to move it" : "Send these times"}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            style={s("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:1px solid var(--border-2);border-radius:9px;font-size:12.5px;font-weight:600;background:var(--surface);cursor:pointer;font-family:inherit")}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
