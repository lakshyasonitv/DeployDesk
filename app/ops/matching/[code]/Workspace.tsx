"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx, TOKENS, SLA_COLOR, MARGIN_COLOR, stageMeta } from "@/src/lib/ui/style";
import type { OpsMatchCandidate } from "@/src/read-models/ops";

/**
 * Ops matching workspace: build and override the ranked shortlist, then send it masked.
 *
 * This screen is ops-only and therefore UNMASKED — real names, supplier names, vendor
 * rates and the margin at the proposed rate are all visible here. That is correct: ops
 * is the only portal that may see them. The masking happens at send time, when
 * shortlist_items snapshots only the client-visible fields with a band derived from the
 * client rate (ADR-004 / ADR-009).
 */

interface Requirement {
  code: string; roleTitle: string; quantity: number; clientName: string; stage: string;
  ownerShort: string; budgetLabel: string; experienceBand: string; locationLabel: string;
  startDate: string | null; clientNote: string | null;
}

const COMPONENT_SHORT = ["SKILL", "TEST", "EXP FIT", "RATE", "FRESH", "VENDOR"];

function barColor(v: number) {
  return v >= 80 ? "#b45309" : v >= 60 ? "#d9a066" : "#e0b3b3";
}

export function Workspace({
  requirement, weights, candidates: initial, duplicateCount, pickerOptions, benchCount,
}: {
  requirement: Requirement;
  weights: Array<{ label: string; pct: string }>;
  candidates: OpsMatchCandidate[];
  duplicateCount: number;
  pickerOptions: Array<{ code: string; roleTitle: string; clientName: string; quantity: number; ownerShort: string; stage: string; slaLabel: string; slaState: string }>;
  benchCount: number;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<string[]>(initial.map((c) => c.maskedId));
  const [included, setIncluded] = useState<string[]>(initial.filter((c) => c.included).map((c) => c.maskedId));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [manual, setManual] = useState(initial.some((c) => c.isManuallyRanked));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const byId = new Map(initial.map((c) => [c.maskedId, c]));
  const rows = order.map((id) => byId.get(id)!).filter(Boolean);

  const moveBy = (id: string, dir: -1 | 1) => {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      next.splice(j, 0, next.splice(i, 1)[0]);
      return next;
    });
    setManual(true);
  };

  const drop = (targetId: string) => {
    if (!dragging || dragging === targetId) { setDragging(null); return; }
    setOrder((prev) => {
      const next = prev.filter((x) => x !== dragging);
      next.splice(next.indexOf(targetId), 0, dragging);
      return next;
    });
    setManual(true);
    setDragging(null);
  };

  const toggleInclude = (id: string) =>
    setIncluded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const reset = () => {
    setOrder(initial.map((c) => c.maskedId));
    setIncluded([]);
    setManual(false);
    setToast(`${requirement.code} · ranking reset to the algorithm order`);
  };

  const send = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/ops/shortlists/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: requirement.code, maskedIds: order.filter((id) => included.includes(id)) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setToast(body.error === "blocked_duplicate" ? "Blocked: resolve the duplicate flags first" : `Send failed: ${body.error ?? res.status}`); return; }
      setToast(`Masked shortlist sent · ${included.length} profiles · ${requirement.code} moved to shortlisted`);
      router.refresh();
    } finally { setSending(false); }
  };

  const st = stageMeta(requirement.stage);
  const sourcedBenches = new Set(initial.map((c) => c.vendorName)).size;

  return (
    <>
      {/* ---------------- header ---------------- */}
      <div style={s("padding:18px 26px 14px;background:#fff;border-bottom:1px solid #e8e8ee;flex:none;position:relative")}>
        <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div style={s("min-width:0")}>
            <div style={s("display:flex;align-items:center;gap:9px;margin-bottom:6px")}>
              <span style={sx("padding:3px 8px;border-radius:5px;font-size:9px;font-weight:700;letter-spacing:.08em", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                {st.label}
              </span>
              <span style={s("font-size:11.5px;color:#8a8a96")}>
                {requirement.clientName} · owner {requirement.ownerShort}
              </span>
            </div>
            <div style={s("display:flex;align-items:center;gap:10px")}>
              <div style={s("font-size:22px;font-weight:800;letter-spacing:-.6px")}>Matching workspace</div>
              <button onClick={() => setPickerOpen((v) => !v)}
                style={sx("display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:8px;font-size:11.5px;cursor:pointer;font-family:inherit", {
                  background: pickerOpen ? "#fff8ef" : "#fff",
                  border: `1px solid ${pickerOpen ? "#f0dcc0" : "#e0e0e8"}`,
                })}>
                <span style={sx("font-weight:700", { fontFamily: TOKENS.mono })}>{requirement.code}</span>
                <span style={s("color:#8a8a96;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                  {requirement.roleTitle}
                </span>
                <span style={s("color:#8a8a96")}>▾</span>
              </button>
            </div>
            <div style={s("font-size:12.5px;color:#6b6b78;margin-top:4px")}>
              {initial.length
                ? `${initial.length} candidates sourced from ${sourcedBenches} of ${benchCount} benches`
                : "no candidates sourced yet — matching starts here"}
            </div>
          </div>
          <div style={s("display:flex;gap:8px;flex:none")}>
            <button onClick={reset}
              style={s("padding:8px 13px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-weight:600;background:#fff;cursor:pointer;font-family:inherit")}>
              Reset to algorithm
            </button>
            <button onClick={send} disabled={!included.length || sending}
              style={sx("padding:8px 13px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;color:#fff;font-family:inherit", {
                background: included.length ? "#101014" : "#c9c9d2",
                cursor: included.length && !sending ? "pointer" : "default",
              })}>
              {sending ? "Sending…" : `Send masked shortlist · ${included.length}`}
            </button>
          </div>
        </div>

        {pickerOpen ? (
          <div style={s("position:absolute;top:92px;left:26px;width:430px;background:#fff;border:1px solid #e8e8ee;border-radius:12px;box-shadow:0 16px 40px rgba(16,16,20,.16);z-index:30;overflow:hidden")}>
            <div style={sx("padding:10px 13px;background:#fafafc;border-bottom:1px solid #e8e8ee;font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
              SELECT A REQUIREMENT · {pickerOptions.length} ON YOUR DESK
            </div>
            <div style={s("max-height:330px;overflow:auto")}>
              {pickerOptions.map((o) => {
                const ost = stageMeta(o.stage);
                const active = o.code === requirement.code;
                return (
                  <a key={o.code} href={`/ops/matching/${o.code}`}
                    style={sx("display:grid;grid-template-columns:76px 1fr 96px 74px;gap:9px;align-items:center;padding:9px 13px;border-bottom:1px solid #f4f4f8;color:#101014", { background: active ? "#fff8ef" : "#fff" })}>
                    <span style={sx("font-size:10.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{o.code}</span>
                    <span style={s("min-width:0")}>
                      <span style={s("display:block;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{o.roleTitle}</span>
                      <span style={s("display:block;font-size:10px;color:#8a8a96;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                        {o.clientName} · ×{o.quantity} · {o.ownerShort}
                      </span>
                    </span>
                    <span style={sx("padding:2px 6px;border-radius:4px;font-size:8.5px;font-weight:700;letter-spacing:.06em;text-align:center", { background: ost.bg, color: ost.fg, fontFamily: TOKENS.mono })}>
                      {ost.label}
                    </span>
                    <span style={sx("font-size:10px;font-weight:600;text-align:right", { color: SLA_COLOR[o.slaState as keyof typeof SLA_COLOR] ?? "#8a8a96" })}>
                      {o.slaLabel}
                    </span>
                  </a>
                );
              })}
            </div>
            <div style={s("padding:9px 13px;font-size:10.5px;color:#8a8a96;background:#fafafc")}>
              Only requirements in Matching, Shortlisted or New appear here.
            </div>
          </div>
        ) : null}
      </div>

      {toast ? (
        <div style={s("background:#101014;color:#fff;padding:10px 26px;display:flex;align-items:center;gap:11px;flex:none")}>
          <span style={s("width:7px;height:7px;border-radius:50%;background:#16a34a;flex:none")} />
          <span style={s("font-size:12.5px;flex:1")}>{toast}</span>
          <button onClick={() => setToast(null)} style={s("border:0;background:transparent;font-size:12px;color:#8a8a96;cursor:pointer;font-family:inherit")}>Dismiss</button>
        </div>
      ) : null}

      {/* ---------------- body ---------------- */}
      <div style={s("flex:1;min-height:0;display:flex;overflow:hidden")}>
        {/* left: requirement facts + weighting */}
        <div style={s("width:320px;flex:none;background:#fff;border-right:1px solid #e8e8ee;overflow:auto;padding:16px")}>
          <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
            REQUIREMENT
          </div>
          <div style={s("font-size:15px;font-weight:800;margin-top:7px;line-height:1.3")}>{requirement.roleTitle}</div>
          <div style={s("font-size:11.5px;color:#8a8a96;margin-top:3px")}>
            {requirement.clientName} · {requirement.quantity} position{requirement.quantity === 1 ? "" : "s"} · owner {requirement.ownerShort}
          </div>

          <div style={s("margin-top:14px;display:flex;flex-direction:column;gap:0")}>
            <Fact k="Positions" v={`×${requirement.quantity}`} />
            <Fact k="Experience" v={requirement.experienceBand} />
            <Fact k="Location" v={requirement.locationLabel} />
            <Fact k="Start" v={requirement.startDate ?? "—"} />
            <Fact k="Client budget" v={requirement.budgetLabel} color="#b45309" />
            <Fact k="Target margin" v="≥ 22%" color="#0f7a4a" />
          </div>

          <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:#8a8a96;margin-top:18px", { fontFamily: TOKENS.mono })}>
            WEIGHTING
          </div>
          <div style={s("margin-top:9px;display:flex;flex-direction:column;gap:7px")}>
            {weights.map((w) => (
              <div key={w.label}>
                <div style={s("display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px")}>
                  <span style={s("color:#4a4a58")}>{w.label}</span>
                  <span style={sx("font-weight:700", { fontFamily: TOKENS.mono })}>{w.pct}</span>
                </div>
                <div style={s("height:4px;background:#eeeef3;border-radius:3px;overflow:hidden")}>
                  <div style={sx("height:100%;background:#b45309;border-radius:3px", { width: w.pct })} />
                </div>
              </div>
            ))}
          </div>

          {requirement.clientNote ? (
            <div style={s("margin-top:18px;background:#fff8ef;border:1px solid #f0dcc0;border-radius:10px;padding:11px")}>
              <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.12em;color:#b45309", { fontFamily: TOKENS.mono })}>
                CLIENT NOTE · CLIENT + OPS ONLY
              </div>
              <div style={s("font-size:11.5px;color:#4a4a58;margin-top:6px;line-height:1.5")}>
                {requirement.clientNote}
              </div>
            </div>
          ) : null}

          {duplicateCount > 0 ? (
            <div style={s("margin-top:12px;background:#fdecec;border:1px solid #f6cfcf;border-radius:10px;padding:11px")}>
              <div style={s("font-size:11.5px;font-weight:700;color:#b91c1c")}>
                {duplicateCount} duplicate flag{duplicateCount === 1 ? "" : "s"} touch this pool
              </div>
              <a href="/ops/duplicates" style={s("display:inline-block;font-size:11px;font-weight:700;color:#b91c1c;margin-top:5px")}>
                Resolve before sending →
              </a>
            </div>
          ) : null}
        </div>

        {/* right: ranked candidates */}
        <div style={s("flex:1;min-width:0;background:#f7f7f9;overflow:auto;padding:14px 18px 22px")}>
          <div style={s("display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px")}>
            <div style={s("font-size:12.5px")}>
              <strong style={s("font-weight:700")}>Ranked candidates · {rows.length}</strong>
              <span style={s("color:#8a8a96")}>
                {manual ? " · manual override active, algorithm ranking saved" : " · algorithm ranking"}
              </span>
            </div>
            <div style={sx("font-size:10.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>
              Drag a row or use ▲▼ to reorder · client sees this order
            </div>
          </div>

          <div style={s("display:flex;flex-direction:column;gap:10px")}>
            {rows.map((c, idx) => {
              const inSet = included.includes(c.maskedId);
              const open = expanded === c.maskedId;
              const mc = MARGIN_COLOR[c.marginBand];
              return (
                <div key={c.maskedId}
                  draggable onDragStart={() => setDragging(c.maskedId)} onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => e.preventDefault()} onDrop={() => drop(c.maskedId)}
                  style={sx("background:#fff;border-radius:11px;padding:11px;display:flex;gap:11px;align-items:flex-start", {
                    border: `1px solid ${dragging === c.maskedId ? "#b45309" : "#e8e8ee"}`,
                    opacity: dragging === c.maskedId ? 0.5 : 1,
                    flexWrap: "wrap",
                  })}>
                  {/* rank */}
                  <div style={s("width:34px;flex:none;text-align:center")}>
                    <div style={s("font-size:19px;font-weight:800;line-height:1")}>{idx + 1}</div>
                    <div style={sx("font-size:8px;font-weight:700;letter-spacing:.1em;color:#8a8a96;margin-top:2px", { fontFamily: TOKENS.mono })}>RANK</div>
                    <div style={s("display:flex;flex-direction:column;gap:3px;margin-top:6px")}>
                      <button onClick={() => moveBy(c.maskedId, -1)} style={miniBtn}>▲</button>
                      <button onClick={() => moveBy(c.maskedId, 1)} style={miniBtn}>▼</button>
                    </div>
                  </div>

                  {/* identity — UNMASKED, ops only */}
                  <div style={s("width:186px;flex:none;min-width:0")}>
                    <div style={s("display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
                      <span style={sx("font-size:12px;font-weight:700", { fontFamily: TOKENS.mono })}>{c.maskedId}</span>
                      <span style={sx("padding:2px 6px;border-radius:4px;font-size:8px;font-weight:700;letter-spacing:.06em", {
                        background: inSet ? "#e8f6ef" : "#f3f3f7", color: inSet ? "#0f7a4a" : "#8a8a96", fontFamily: TOKENS.mono,
                      })}>
                        {inSet ? "IN SHORTLIST" : "HELD BACK"}
                      </span>
                    </div>
                    <div style={s("font-size:12.5px;font-weight:700;margin-top:4px")}>{c.fullName}</div>
                    <div style={s("font-size:10.5px;color:#8a8a96;margin-top:2px")}>{c.vendorName}</div>
                    <div style={sx("font-size:10.5px;color:#4a4a58;margin-top:3px", { fontFamily: TOKENS.mono })}>
                      {c.experienceLabel} · {c.vendorRateLabel}/mo
                    </div>
                  </div>

                  {/* reason + components */}
                  <div style={s("flex:1;min-width:230px")}>
                    <div style={s("display:flex;align-items:baseline;gap:8px")}>
                      <span style={s("font-size:20px;font-weight:800;color:#b45309;line-height:1")}>{c.algoScore}</span>
                      <span style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:#8a8a96", { fontFamily: TOKENS.mono })}>MATCH SCORE</span>
                      {c.eligibility !== "eligible" ? (
                        <span style={sx("padding:2px 6px;border-radius:4px;font-size:8px;font-weight:700;background:#fdecec;color:#b91c1c", { fontFamily: TOKENS.mono })}>
                          {c.eligibility.replace("blocked_", "").toUpperCase()}
                        </span>
                      ) : null}
                    </div>
                    <div style={s("font-size:11.5px;color:#4a4a58;margin-top:4px")}>{c.reasonLine}</div>
                    <div style={s("display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:9px")}>
                      {c.components.map((comp, i) => (
                        <div key={comp.label}>
                          <div style={sx("font-size:7.5px;font-weight:700;letter-spacing:.07em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
                            {COMPONENT_SHORT[i]}
                          </div>
                          <div style={s("height:4px;background:#eeeef3;border-radius:3px;margin-top:3px;overflow:hidden")}>
                            <div style={sx("height:100%;border-radius:3px", { width: `${comp.value}%`, background: barColor(comp.value) })} />
                          </div>
                          <div style={sx("font-size:9px;font-weight:700;margin-top:2px", { fontFamily: TOKENS.mono })}>{comp.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* actions */}
                  <div style={s("width:96px;flex:none;display:flex;flex-direction:column;gap:5px")}>
                    <button onClick={() => toggleInclude(c.maskedId)}
                      style={sx("padding:6px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;border:0", {
                        background: inSet ? "#0f7a4a" : "#101014", color: "#fff",
                      })}>
                      {inSet ? "Included" : "Include"}
                    </button>
                    <button onClick={() => setExpanded(open ? null : c.maskedId)}
                      style={s("padding:6px;border:1px solid #e0e0e8;border-radius:7px;font-size:11px;font-weight:600;background:#fff;cursor:pointer;font-family:inherit")}>
                      {open ? "Hide" : "Profile"}
                    </button>
                  </div>

                  {/* expanded detail — the full unmasked record */}
                  {open ? (
                    <div style={s("width:100%;margin-top:4px;padding-top:11px;border-top:1px dashed #e8e8ee")}>
                      <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:11px")}>
                        <Detail k="CITY" v={c.city} />
                        <Detail k="NOTICE" v={c.noticeLabel} />
                        <Detail k="PROCTORED" v={c.assessment.overall != null ? `${c.assessment.overall}${c.assessment.testedOn ? ` · ${c.assessment.testedOn}` : ""}` : c.assessment.status.replace("_", " ")} />
                        <Detail k="FRESHNESS" v={c.freshnessLabel} />
                        <Detail k="VENDOR RELIABILITY" v={`${c.vendorReliability} / 5`} />
                        <Detail k="VENDOR RATE" v={c.vendorRateLabel} />
                        <Detail k="PROPOSED CLIENT RATE" v={c.proposedClientRateLabel} />
                        <Detail k="MARGIN AT THAT RATE" v={c.marginPctLabel} color={mc.fg} />
                      </div>
                      {c.lastProjectNote ? (
                        <div style={s("margin-top:10px;background:#fafafc;border-radius:8px;padding:9px;font-size:11.5px;color:#4a4a58;line-height:1.5")}>
                          {c.lastProjectNote}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {rows.length === 0 ? (
              <div style={s("background:#fff;border:1px dashed #e0e0e8;border-radius:12px;padding:34px;text-align:center;color:#8a8a96;font-size:12.5px")}>
                No candidates sourced for this requirement yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

const miniBtn = {
  width: "22px", height: "16px", borderRadius: "4px", border: "1px solid #eaeaef",
  background: "#fff", fontSize: "8px", lineHeight: "1", cursor: "pointer",
  color: "#4a4a58", fontFamily: "inherit", padding: 0,
} as const;

function Fact({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={s("display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f4f8")}>
      <span style={s("font-size:11.5px;color:#8a8a96")}>{k}</span>
      <span style={sx("font-size:11.5px;font-weight:700;text-align:right", { color: color ?? "#101014" })}>{v}</span>
    </div>
  );
}

function Detail({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div>
      <div style={sx("font-size:8px;font-weight:700;letter-spacing:.1em;color:#8a8a96", { fontFamily: TOKENS.mono })}>{k}</div>
      <div style={sx("font-size:11.5px;font-weight:700;margin-top:3px", { color: color ?? "#101014" })}>{v}</div>
    </div>
  );
}
