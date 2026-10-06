"use client";

import { useState } from "react";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { Pill, ScoreBars } from "@/src/lib/ui/Shell";
import type { ClientShortlistView } from "@/src/read-models/client";

/**
 * The masked shortlist board. Receives PLAIN JSON from the server component — the
 * client read model's output and nothing else — and owns only the selection state.
 *
 * There is no masking logic here, and there must never be: a portal's endpoint returns
 * only the fields that portal may see (CLAUDE.md). If a field is absent from the props,
 * it is absent from the server response, which is the point.
 */

const AVAILABILITY_STYLE: Record<string, { fg: string; bg: string }> = {
  immediate: { fg: "#16a34a", bg: "#e9f7ee" },
  dated: { fg: "#c2410c", bg: "#fdf0e7" },
  notice: { fg: "#1d4ed8", bg: "#e8eefc" },
};

function availabilityKind(label: string): keyof typeof AVAILABILITY_STYLE {
  if (/available now/i.test(label)) return "immediate";
  if (/^from /i.test(label)) return "dated";
  return "notice";
}

export function ShortlistBoard({ view }: { view: ClientShortlistView }) {
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

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const pass = (id: string) => {
    setPassed((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSelected((prev) => prev.filter((x) => x !== id));
  };

  return (
    <>
      {/* -------- header -------- */}
      <div style={s("padding:20px 26px 16px;background:#fff;border-bottom:1px solid #e8e8ee;flex:none")}>
        <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div style={s("min-width:0")}>
            <div style={s("display:flex;align-items:center;gap:9px;margin-bottom:7px")}>
              <Pill bg="#f1ecff" fg="#6d3ff0">SHORTLIST READY</Pill>
              <span style={sx("font-size:10.5px;font-weight:600;color:#8a8a96", { fontFamily: TOKENS.mono })}>
                {view.requirementCode} · delivered {formatDelivered(view.sentAt)}
              </span>
            </div>
            <div style={s("font-size:22px;font-weight:800;letter-spacing:-.6px")}>{view.roleTitle}</div>
            <div style={s("font-size:12.5px;color:#6b6b78;margin-top:4px")}>
              {view.quantity} position{view.quantity === 1 ? "" : "s"} · masked profiles ·
              names, photos and supplier withheld
            </div>
          </div>
          <div style={s("display:flex;gap:8px;flex:none")}>
            <button
              onClick={() => { setAskContext(`${view.requirementCode} · ${view.roleTitle}`); setAskOpen(true); }}
              style={s("padding:8px 13px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-weight:600;background:#fff;cursor:pointer;font-family:inherit")}
            >
              Ask Talentvibes
            </button>
            <button
              style={sx("padding:8px 13px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit", {
                background: selected.length ? "#6d3ff0" : "#c9bef0",
              })}
            >
              Request interviews · {selected.length}
            </button>
          </div>
        </div>
      </div>

      {/* -------- toolbar -------- */}
      <div style={s("padding:12px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none")}>
        <div style={s("font-size:12.5px;color:#6b6b78")}>
          <strong style={s("font-weight:700;color:#101014")}>{view.candidates.length} masked profiles</strong>
          {" · ranked by proctored score · names, photos and supplier withheld"}
        </div>
        <div style={sx("font-size:10.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>
          J / K to move · E to shortlist
        </div>
      </div>

      {/* -------- cards -------- */}
      <div style={s("flex:1;overflow:auto;padding:0 26px 26px")}>
        <div style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:12px")}>
          {view.candidates.map((c) => {
            const isSelected = selected.includes(c.maskedId);
            const isPassed = passed.includes(c.maskedId);
            const kind = availabilityKind(c.availabilityLabel);
            const av = AVAILABILITY_STYLE[kind];
            return (
              <div
                key={c.maskedId}
                style={sx("background:#fff;border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:10px", {
                  border: `1px solid ${isSelected ? "#c9b6ff" : "#e8e8ee"}`,
                  opacity: isPassed ? 0.55 : 1,
                })}
              >
                {/* 1. masked id + score */}
                <div style={s("display:flex;align-items:flex-start;justify-content:space-between;gap:10px")}>
                  <div>
                    <div style={sx("font-size:15px;font-weight:700;letter-spacing:-.5px", { fontFamily: TOKENS.mono })}>
                      {c.maskedId}
                    </div>
                    <div style={s("font-size:11.5px;color:#8a8a96;margin-top:2px")}>
                      {c.experienceLabel} · {c.baseCity}
                    </div>
                  </div>
                  <div style={s("text-align:right;flex:none")}>
                    <div style={sx("font-size:19px;font-weight:800;letter-spacing:-.6px;line-height:1", { color: av.fg })}>
                      {c.scoreOverall ?? "—"}
                    </div>
                    <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:#8a8a96;margin-top:3px", { fontFamily: TOKENS.mono })}>
                      PROCTORED
                    </div>
                  </div>
                </div>

                {/* 2. skill chips */}
                <div style={s("display:flex;flex-wrap:wrap;gap:4px")}>
                  {c.skills.map((sk) => (
                    <span key={sk} style={s("padding:3px 7px;background:#f3f3f7;border-radius:5px;font-size:10.5px;font-weight:600;color:#4a4a58")}>
                      {sk}
                    </span>
                  ))}
                </div>

                {/* 3. breakdown */}
                <div style={s("padding-top:10px;border-top:1px dashed #e8e8ee")}>
                  <ScoreBars sections={c.sections} width={9999} />
                </div>

                {/* 4. provenance */}
                <div style={s("font-size:10.5px;color:#8a8a96")}>
                  Proctored by Talentvibes · attempt {c.attemptNo ?? 1}
                  {c.testedOn ? ` · tested ${formatTested(c.testedOn)}` : ""}
                </div>

                {/* 5. rate band + availability */}
                <div style={s("display:flex;align-items:center;justify-content:space-between;gap:8px")}>
                  <div>
                    <div style={s("font-size:13px;font-weight:700")}>{c.rateBandLabel}</div>
                    <div style={s("font-size:10.5px;color:#8a8a96")}>per month</div>
                  </div>
                  <span style={sx("display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font-size:10.5px;font-weight:600", { background: av.bg, color: av.fg })}>
                    <span style={sx("width:5px;height:5px;border-radius:50%", { background: av.fg })} />
                    {c.availabilityLabel}
                  </span>
                </div>

                {/* 6. actions */}
                <div style={s("display:flex;align-items:center;gap:6px;margin-top:2px")}>
                  <button
                    onClick={() => toggle(c.maskedId)}
                    style={sx("flex:1;padding:7px;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
                      background: isSelected ? "#6d3ff0" : "#fff",
                      color: isSelected ? "#fff" : "#101014",
                      border: `1px solid ${isSelected ? "#6d3ff0" : "#e0e0e8"}`,
                    })}
                  >
                    {isSelected ? "Selected ✓" : "Interview"}
                  </button>
                  <button
                    onClick={() => pass(c.maskedId)}
                    style={s("padding:7px 10px;border:1px solid #e0e0e8;border-radius:7px;font-size:11.5px;font-weight:600;background:#fff;cursor:pointer;color:#6b6b78;font-family:inherit")}
                  >
                    Pass
                  </button>
                  <button
                    onClick={() => { setAskContext(`${c.maskedId} · ${view.roleTitle}`); setAskOpen(true); }}
                    title="Ask your broker about this candidate"
                    style={s("width:30px;padding:7px 0;border:1px solid #e0e0e8;border-radius:7px;font-size:11.5px;font-weight:700;background:#fff;cursor:pointer;color:#6d3ff0;font-family:inherit")}
                  >
                    ?
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* -------- broker footer strip -------- */}
        {view.brokerNote ? (
          <div style={s("margin-top:14px;background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:14px;display:flex;align-items:flex-start;gap:11px")}>
            <div style={s("width:28px;height:28px;border-radius:50%;background:#e4dcff;flex:none;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#6d3ff0")}>
              {initials(view.brokerName)}
            </div>
            <div style={s("flex:1;min-width:0")}>
              <span style={s("font-size:12.5px;font-weight:700")}>{view.brokerName}, your broker:</span>
              <span style={s("font-size:12.5px;color:#4a4a58;line-height:1.55")}> “{view.brokerNote}”</span>
            </div>
            <button
              onClick={() => { setAskContext(`${view.requirementCode} · ${view.roleTitle}`); setAskOpen(true); }}
              style={s("padding:7px 14px;border:0;border-radius:8px;font-size:12px;font-weight:700;background:#101014;color:#fff;cursor:pointer;flex:none;font-family:inherit")}
            >
              Reply
            </button>
          </div>
        ) : null}
      </div>

      {askOpen ? <AskPanel context={askContext} brokerName={view.brokerName} onClose={() => setAskOpen(false)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------ ask panel */

/**
 * The broker thread overlay. A client message goes to the CLIENT-side thread only;
 * there is no shared thread and no path from here to the supplier (ADR-008).
 */
function AskPanel({
  context, brokerName, onClose,
}: { context: string; brokerName: string; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<Array<{ who: string; body: string; mine: boolean; at: string }>>([
    { who: brokerName, mine: false, at: "earlier",
      body: "Shortlist is live — six masked profiles, all proctored in the last three weeks. Two of them clear your band and can start on the 15th." },
  ]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setThread((t) => [...t, { who: "You", body, mine: true, at: "just now" }]);
    setDraft("");
  };

  const CHIPS = [
    "Can we hold the top profile for a week?",
    "What is the notice period on the top two?",
    "Any room on the rate for the SAP profile?",
    "Can you add one more profile under ₹1.5L?",
  ];

  return (
    <div style={s("position:fixed;inset:0;background:rgba(16,16,20,.34);display:flex;justify-content:flex-end;z-index:50")} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={s("width:390px;max-width:100%;background:#fff;height:100%;display:flex;flex-direction:column;box-shadow:-18px 0 44px rgba(16,16,20,.18)")}
      >
        <div style={s("padding:15px 17px;border-bottom:1px solid #e8e8ee;flex:none")}>
          <div style={s("display:flex;align-items:center;justify-content:space-between;gap:10px")}>
            <div style={s("font-size:13.5px;font-weight:800")}>Ask Talentvibes</div>
            <button onClick={onClose} style={s("border:0;background:transparent;font-size:17px;color:#8a8a96;cursor:pointer;line-height:1")}>×</button>
          </div>
          <div style={sx("font-size:10.5px;font-weight:600;color:#8a8a96;margin-top:3px", { fontFamily: TOKENS.mono })}>
            {context}
          </div>
        </div>

        <div style={s("flex:1;overflow:auto;padding:15px 17px;display:flex;flex-direction:column;gap:10px")}>
          {thread.map((m, i) => (
            <div key={i} style={sx("display:flex;flex-direction:column;gap:3px", { alignItems: m.mine ? "flex-end" : "flex-start" })}>
              <div style={s("font-size:10px;color:#8a8a96")}>{m.who} · {m.at}</div>
              <div style={sx("max-width:86%;padding:9px 11px;border-radius:11px;font-size:12.5px;line-height:1.5", {
                background: m.mine ? "#101014" : "#f7f7fa",
                color: m.mine ? "#fff" : "#26262e",
                border: `1px solid ${m.mine ? "#101014" : "#eeeef3"}`,
              })}>
                {m.body}
              </div>
            </div>
          ))}
        </div>

        <div style={s("padding:11px 17px;border-top:1px solid #e8e8ee;flex:none")}>
          <div style={s("display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px")}>
            {CHIPS.map((c) => (
              <button key={c} onClick={() => setDraft(c)}
                style={s("padding:5px 9px;border:1px solid #e8e8ee;border-radius:999px;font-size:10.5px;background:#fff;cursor:pointer;color:#4a4a58;font-family:inherit;text-align:left")}>
                {c}
              </button>
            ))}
          </div>
          <div style={s("display:flex;gap:7px")}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Message your broker…"
              style={s("flex:1;padding:9px 11px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")}
            />
            <button onClick={send}
              style={sx("padding:9px 14px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit", {
                background: draft.trim() ? "#6d3ff0" : "#c9bef0",
              })}>
              Send
            </button>
          </div>
          <div style={s("font-size:10px;color:#8a8a96;margin-top:8px;line-height:1.5")}>
            Talentvibes relays anything relevant to the supplier with your company name and
            commercials removed.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- utils */

function formatDelivered(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function formatTested(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
}
