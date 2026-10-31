"use client";

import { Drawer } from "@/src/lib/ui/Drawer";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/src/lib/ui/Toast";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { Pill, ScoreBars } from "@/src/lib/ui/Shell";
import { Button } from "@/src/lib/ui/Button";
import type { ClientShortlistView } from "@/src/read-models/client";
import { istFormat } from "@/src/lib/derived";

/**
 * The masked shortlist board. Receives PLAIN JSON from the server component — the
 * client read model's output and nothing else — and owns only the selection state.
 *
 * There is no masking logic here, and there must never be: a portal's endpoint returns
 * only the fields that portal may see (CLAUDE.md). If a field is absent from the props,
 * it is absent from the server response, which is the point.
 */

const AVAILABILITY_STYLE: Record<string, { fg: string; bg: string }> = {
  immediate: { fg: "var(--ok)", bg: "var(--ok-tint)" },
  dated: { fg: "var(--warn)", bg: "var(--warn-tint)" },
  notice: { fg: "var(--info)", bg: "var(--info-tint)" },
};

function availabilityKind(label: string): keyof typeof AVAILABILITY_STYLE {
  if (/available now/i.test(label)) return "immediate";
  if (/^from /i.test(label)) return "dated";
  return "notice";
}

/**
 * The client-side broker thread, already display-shaped by the read model.
 *
 * `getClientBrokerThread` does the formatting — it resolves "You" vs the broker's name and
 * formats the time — because that decision depends on which side is reading, and that is a
 * read-model concern, not a component one.
 */
export interface BrokerThreadView {
  scopeLabel: string;
  brokerName: string;
  messages: Array<{ who: string; isMine: boolean; body: string; at: string }>;
}

export function ShortlistBoard({
  view, thread,
}: { view: ClientShortlistView; thread: BrokerThreadView | null }) {
  const [selected, setSelected] = useState<string[]>(
    view.candidates.filter((c) => c.decision === "selected").map((c) => c.maskedId),
  );
  const [passed, setPassed] = useState<string[]>(
    view.candidates.filter((c) => c.decision === "passed").map((c) => c.maskedId),
  );
  const [askOpen, setAskOpen] = useState(false);
  const [askContext, setAskContext] = useState<string>(
    `${view.requirementCode} · ${view.roleTitle}`,
  );

  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  /**
   * Every decision now persists.
   *
   * These used to be local state only, so a refresh threw away whatever the client had
   * chosen and the broker never saw any of it — on the one screen the whole brokered flow
   * turns on. The optimistic update is kept so the card responds instantly, and is rolled
   * back if the write fails rather than leaving the screen disagreeing with the database.
   */
  async function decide(id: string, decision: "pending" | "selected" | "passed") {
    const prevSelected = selected;
    const prevPassed = passed;

    // optimistic
    if (decision === "selected") {
      setSelected((p) => (p.includes(id) ? p : [...p, id]));
      setPassed((p) => p.filter((x) => x !== id));
    } else if (decision === "passed") {
      setPassed((p) => (p.includes(id) ? p : [...p, id]));
      setSelected((p) => p.filter((x) => x !== id));
    } else {
      setSelected((p) => p.filter((x) => x !== id));
      setPassed((p) => p.filter((x) => x !== id));
    }

    try {
      const res = await fetch("/api/client/shortlists/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "decide",
          requirementCode: view.requirementCode,
          maskedId: id,
          decision,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      router.refresh();
    } catch {
      setSelected(prevSelected);
      setPassed(prevPassed);
      toast({ tone: "error", message: `Could not save your decision on ${id}.` });
    }
  }

  const toggle = (id: string) => decide(id, selected.includes(id) ? "pending" : "selected");
  const pass = (id: string) => decide(id, passed.includes(id) ? "pending" : "passed");

  /** Asks Talentvibes to arrange round 1 for everyone currently selected. */
  async function requestInterviews() {
    if (!selected.length || busy) return;
    setBusy(true);
    const asked = [...selected];
    try {
      const res = await fetch("/api/client/shortlists/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "request_interviews",
          requirementCode: view.requirementCode,
          maskedIds: asked,
        }),
      });
      if (!res.ok) throw new Error("request failed");
      const out = await res.json() as { requested: string[]; alreadyRequested: string[] };

      if (!out.requested.length) {
        toast({ message: "Those interviews were already requested." });
        return;
      }

      const n = out.requested.length;
      toast({
        message: `Talentvibes will arrange ${n} ${n === 1 ? "interview" : "interviews"} and send you the invitation.`,
        // Withdraws only the rounds this call created, and only while they are still
        // proposed — a round ops has confirmed is not the client's to erase.
        undo: async () => {
          const r = await fetch("/api/client/shortlists/decide", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "withdraw_interviews",
              requirementCode: view.requirementCode,
              maskedIds: out.requested,
            }),
          });
          if (!r.ok) throw new Error("withdraw failed");
          // A 200 that withdrew nothing (Talentvibes had already confirmed, or times were
          // offered) is not "Undone." — throwing lets the toast say the request still stands.
          const done = await r.json() as { withdrawn: number };
          if (!done.withdrawn) throw new Error("nothing withdrawn");
          router.refresh();
        },
      });
      router.refresh();
    } catch {
      toast({ tone: "error", message: "Could not request those interviews." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* -------- header -------- */}
      <div style={s("padding:20px 26px 16px;background:var(--surface);border-bottom:1px solid var(--border);flex:none")}>
        <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div style={s("min-width:0")}>
            <div style={s("display:flex;align-items:center;gap:9px;margin-bottom:7px")}>
              <Pill bg="var(--brand-tint)" fg="var(--brand-ink)">SHORTLIST READY</Pill>
              <span style={sx("font-size:var(--fs-1);font-weight:600;color:var(--t4)", { fontFamily: TOKENS.mono })}>
                {view.requirementCode} · delivered {formatDelivered(view.sentAt)}
              </span>
            </div>
            <div style={s("font-size:26px;font-weight:800;letter-spacing:-.6px")}>{view.roleTitle}</div>
            <div style={s("font-size:var(--fs-7);color:var(--t2);margin-top:4px")}>
              {view.quantity} position{view.quantity === 1 ? "" : "s"} · masked profiles ·
              names, photos and supplier withheld
            </div>
          </div>
          <div style={s("display:flex;gap:8px;flex:none")}>
            <Button onClick={() => { setAskContext(`${view.requirementCode} · ${view.roleTitle}`); setAskOpen(true); }}>
              Conversation
            </Button>
            <Button primary onClick={requestInterviews} disabled={!selected.length || busy}>
              {busy ? "Asking\u2026" : `Request interviews \u00b7 ${selected.length}`}
            </Button>
          </div>
        </div>
      </div>

      {/* -------- toolbar -------- */}
      <div style={s("padding:12px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none")}>
        <div style={s("font-size:var(--fs-4);color:var(--t3)")}>
          <strong style={s("font-weight:700;color:var(--t1)")}>{view.candidates.length} masked profiles</strong>
          {/* Not "ranked by proctored score": the order is your Talentvibes team's. And no
              "J / K to move" hint — no key handler ever existed. */}
          {" · in the order your Talentvibes team ranked them · names, photos and supplier withheld"}
        </div>
      </div>

      {/* -------- cards -------- */}
      <div style={s("flex:1;overflow:auto;padding:0 26px 26px")}>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:12px")}>
          {view.candidates.map((c) => {
            const isSelected = selected.includes(c.maskedId);
            const isPassed = passed.includes(c.maskedId);
            const kind = availabilityKind(c.availabilityLabel);
            const av = AVAILABILITY_STYLE[kind];
            return (
              <div
                key={c.maskedId}
                style={sx("background:var(--surface);border-radius:16px;padding:13px;display:flex;flex-direction:column;gap:10px", {
                  border: `1px solid ${isSelected ? "var(--brand-tint-2)" : "var(--border)"}`,
                  opacity: isPassed ? 0.55 : 1,
                })}
              >
                {/* 1. masked id + score */}
                <div style={s("display:flex;align-items:flex-start;justify-content:space-between;gap:10px")}>
                  <div>
                    <div style={sx("font-size:15px;font-weight:700;letter-spacing:-.5px", { fontFamily: TOKENS.mono })}>
                      {c.maskedId}
                    </div>
                    <div style={s("font-size:var(--fs-2);color:var(--t4);margin-top:2px")}>
                      {c.experienceLabel} · {c.baseCity}
                    </div>
                  </div>
                  <div style={s("text-align:right;flex:none")}>
                    <div style={sx("font-size:19px;font-weight:800;letter-spacing:-.6px;line-height:1", { color: av.fg })}>
                      {c.scoreOverall ?? "—"}
                    </div>
                    <div style={sx("font-size:var(--fs-1);font-weight:700;letter-spacing:.1em;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
                      PROCTORED
                    </div>
                  </div>
                </div>

                {/* 2. skill chips */}
                <div style={s("display:flex;flex-wrap:wrap;gap:4px")}>
                  {c.skills.map((sk) => (
                    <span key={sk} style={s("padding:3px 7px;background:var(--surface-3);border-radius:5px;font-size:var(--fs-1);font-weight:600;color:var(--t2)")}>
                      {sk}
                    </span>
                  ))}
                </div>

                {/* 3. breakdown */}
                <div style={s("padding-top:10px;border-top:1px dashed var(--border)")}>
                  <ScoreBars sections={c.sections} width="100%" />
                </div>

                {/* 4. provenance */}
                <div style={s("font-size:var(--fs-1);color:var(--t4)")}>
                  Proctored by Talentvibes · attempt {c.attemptNo ?? 1}
                  {c.testedOn ? ` · tested ${formatTested(c.testedOn)}` : ""}
                </div>

                {/*
                  5. rate band + availability

                  `margin-top:auto` anchors this and the actions below it to the bottom of
                  the card. The cards are grid items, so they all stretch to the tallest in
                  their row, but the content inside stacks from the top -- so a candidate
                  with fewer skill chips, or no tested date, ended its content early and sat
                  its buttons higher than its neighbours'.

                  The auto margin goes HERE rather than on the actions row so that the rate
                  line is pinned too. Rate is the other thing read across cards rather than
                  down one, and pinning only the buttons would have left the rates ragged
                  while the buttons lined up -- a mixed alignment that reads worse than the
                  original.
                */}
                <div style={s("display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto")}>
                  <div>
                    <div style={s("font-size:var(--fs-5);font-weight:700")}>{c.rateBandLabel}</div>
                    <div style={s("font-size:var(--fs-1);color:var(--t4)")}>per month</div>
                  </div>
                  <span style={sx("display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font-size:var(--fs-1);font-weight:600", { background: av.bg, color: av.fg })}>
                    <span style={sx("width:5px;height:5px;border-radius:50%", { background: av.fg })} />
                    {c.availabilityLabel}
                  </span>
                </div>

                {/* 6. actions */}
                <div style={s("display:flex;align-items:center;gap:6px;margin-top:2px")}>
                  <button
                    onClick={() => toggle(c.maskedId)}
                    style={sx("flex:1;padding:7px;border-radius:7px;font-size:var(--fs-2);font-weight:700;cursor:pointer;font-family:inherit", {
                      background: isSelected ? "var(--brand)" : "var(--surface)",
                      color: isSelected ? "var(--surface)" : "var(--t1)",
                      border: `1px solid ${isSelected ? "var(--brand)" : "var(--border-2)"}`,
                    })}
                  >
                    {isSelected ? "Selected ✓" : "Interview"}
                  </button>
                  <button
                    onClick={() => pass(c.maskedId)}
                    style={s("padding:7px 10px;border:1px solid var(--border-2);border-radius:7px;font-size:var(--fs-2);font-weight:600;background:var(--surface);cursor:pointer;color:var(--t3);font-family:inherit")}
                  >
                    Pass
                  </button>
                  {/* The per-card "?" (ask about this candidate) is gone: it opened the same
                      read-only conversation, which cannot send — a question it could not ask. */}
                </div>
              </div>
            );
          })}
        </div>

        {/* -------- broker footer strip -------- */}
        {view.brokerNote ? (
          <div style={s("margin-top:14px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px;display:flex;align-items:flex-start;gap:11px")}>
            <div style={s("width:28px;height:28px;border-radius:50%;background:var(--brand-tint-2);flex:none;display:flex;align-items:center;justify-content:center;font-size:var(--fs-1);font-weight:700;color:var(--brand)")}>
              {initials(view.brokerName)}
            </div>
            <div style={s("flex:1;min-width:0")}>
              <span style={s("font-size:var(--fs-4);font-weight:700")}>{view.brokerName}:</span>
              <span style={s("font-size:var(--fs-4);color:var(--t2);line-height:1.55")}> {`"${view.brokerNote}"`}</span>
            </div>
            <Button variant="dark" size="sm" onClick={() => { setAskContext(`${view.requirementCode} · ${view.roleTitle}`); setAskOpen(true); }}>
              View conversation
            </Button>
          </div>
        ) : null}
      </div>

      {askOpen ? <AskPanel context={askContext} brokerName={view.brokerName} thread={thread} onClose={() => setAskOpen(false)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------ ask panel */

/**
 * The broker thread overlay. A client message goes to the CLIENT-side thread only;
 * there is no shared thread and no path from here to the supplier (ADR-008).
 */
function AskPanel({
  context, brokerName, thread: initial, onClose,
}: {
  context: string;
  brokerName: string;
  thread: BrokerThreadView | null;
  onClose: () => void;
}) {
  /**
   * Seeded from the database, read-only.
   *
   * There is no write endpoint for a client message yet. Send used to append to this list
   * in the browser only — the message vanished on reload and the broker never saw it, while
   * the copy said it "reaches them". Until messaging exists the panel shows the
   * conversation and says plainly that replying here is not connected.
   */
  const thread = (initial?.messages ?? []).map((m) => ({ who: m.who, body: m.body, mine: m.isMine, at: m.at }));

  return (
    <Drawer label="Your Talentvibes team" onClose={onClose}>
        <div style={s("padding:15px 17px;border-bottom:1px solid var(--border);flex:none")}>
          <div style={s("display:flex;align-items:center;justify-content:space-between;gap:10px")}>
            <div style={s("font-size:var(--fs-6);font-weight:800")}>Your Talentvibes team</div>
            <button onClick={onClose} aria-label="Close" style={s("border:0;background:transparent;font-size:19px;color:var(--t4);cursor:pointer;line-height:1;flex:none")}>×</button>
          </div>
          <div style={sx("font-size:var(--fs-1);font-weight:600;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
            {context}
          </div>
        </div>

        <div style={s("flex:1;overflow:auto;padding:15px 17px;display:flex;flex-direction:column;gap:10px")}>
          {thread.length === 0 ? (
            <div style={s("font-size:var(--fs-4);color:var(--t4);line-height:1.6;padding:4px 0")}>
              No messages yet. {brokerName} looks after this role for you, and this conversation
              is between you and them only. No supplier ever sees it.
            </div>
          ) : null}
          {thread.map((m, i) => (
            <div key={i} style={sx("display:flex;flex-direction:column;gap:3px", { alignItems: m.mine ? "flex-end" : "flex-start" })}>
              <div style={s("font-size:var(--fs-1);color:var(--t4)")}>{m.who} · {m.at}</div>
              <div style={sx("max-width:86%;padding:9px 11px;border-radius:11px;font-size:var(--fs-4);line-height:1.5", {
                background: m.mine ? "var(--t1)" : "var(--surface-2)",
                color: m.mine ? "var(--surface)" : "var(--t1)",
                border: `1px solid ${m.mine ? "var(--t1)" : "var(--border)"}`,
              })}>
                {m.body}
              </div>
            </div>
          ))}
        </div>

        <div style={s("padding:11px 17px;border-top:1px solid var(--border);flex:none")}>
          <div style={s("font-size:var(--fs-3);color:var(--t2);line-height:1.55")}>
            Sending from here is not connected yet, so nothing typed here would reach{" "}
            {brokerName}. Reach them the way you usually do; their replies appear above.
          </div>
          <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:8px;line-height:1.5")}>
            Talentvibes relays anything relevant to the supplier with your company name and
            commercials removed.
          </div>
        </div>
      </Drawer>
  );
}

/* ----------------------------------------------------------------- utils */

function formatDelivered(iso: string): string {
  return istFormat(iso, { day: "numeric", month: "short" });
}
function formatTested(iso: string): string {
  return istFormat(iso, { day: "2-digit", month: "short" });
}
function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
}
