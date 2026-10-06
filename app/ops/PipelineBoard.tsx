"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { s, sx, TOKENS, STAGES, SLA_COLOR, stageMeta } from "@/src/lib/ui/style";
import type { OpsPipelineRequirement } from "@/src/read-models/ops";

/**
 * Ops pipeline. Board and list views over the same server-grouped data.
 *
 * Stage moves go through POST /api/ops/requirements/stage, which writes a
 * requirement_stage_events row and an audit row. Undo is a FORWARD transition back to
 * the previous stage, not a delete — docs/DOMAIN.md requires the trail to stay intact.
 */

const STAGE_KEYS = STAGES.map((x) => x.key) as readonly string[];
const STAGE_ACTION: Record<string, string> = {
  new: "Source", matching: "Match", shortlisted: "Review",
  interviewing: "Track", placed: "Margin",
};
const WIP_LIMIT = 6;

export function PipelineBoard({
  requirements, ownerShortSelf, clientCount, vendorCount,
}: {
  requirements: OpsPipelineRequirement[];
  ownerShortSelf: string;
  clientCount: number;
  vendorCount: number;
}) {
  const [view, setView] = useState<"board" | "list">("board");
  const [query, setQuery] = useState("");
  const [myDesk, setMyDesk] = useState(false);
  const [atRisk, setAtRisk] = useState(false);
  const [needsSourcing, setNeedsSourcing] = useState(false);
  const [stageOverride, setStageOverride] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; code: string; prev: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const rows = useMemo(
    () => requirements.map((r) => ({ ...r, stage: stageOverride[r.code] ?? r.stage })),
    [requirements, stageOverride],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(
        r.code.toLowerCase().includes(q) || r.roleTitle.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) || r.ownerShort.toLowerCase().includes(q) ||
        r.skills.some((sk) => sk.toLowerCase().includes(q))
      )) return false;
      if (myDesk && r.ownerShort !== ownerShortSelf) return false;
      if (atRisk && !(r.sla.state === "warn" || r.sla.state === "late")) return false;
      if (needsSourcing && r.sourcedCount !== 0) return false;
      return true;
    });
  }, [rows, query, myDesk, atRisk, needsSourcing, ownerShortSelf]);

  const anyFilter = Boolean(query || myDesk || atRisk || needsSourcing);
  const breaches = rows.filter((r) => r.sla.state === "late").length;

  const move = async (code: string, toStage: string) => {
    const row = rows.find((r) => r.code === code);
    if (!row || row.stage === toStage) { setDragging(null); return; }
    const prev = row.stage;
    setStageOverride((p) => ({ ...p, [code]: toStage }));
    setDragging(null);
    setToast({ msg: `${code} · ${row.roleTitle} moved to ${stageMeta(toStage).label.toLowerCase()}`, code, prev });
    try {
      await fetch("/api/ops/requirements/stage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, toStage, reason: "pipeline_drag" }),
      });
    } catch { /* optimistic; the next load reflects server truth */ }
  };

  const step = (code: string, dir: 1 | -1) => {
    const row = rows.find((r) => r.code === code);
    if (!row) return;
    const i = STAGE_KEYS.indexOf(row.stage);
    const j = i + dir;
    if (j < 0 || j >= STAGE_KEYS.length) return;
    void move(code, STAGE_KEYS[j]);
  };

  const undo = () => {
    if (!toast) return;
    void move(toast.code, toast.prev);
    setToast(null);
  };

  return (
    <>
      {/* ---------------- header ---------------- */}
      <div style={s("padding:20px 26px 14px;background:#fff;border-bottom:1px solid #e8e8ee;flex:none")}>
        <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div>
            <div style={s("font-size:22px;font-weight:800;letter-spacing:-.6px")}>Requirement pipeline</div>
            <div style={s("font-size:12.5px;color:#6b6b78;margin-top:4px")}>
              {rows.length} live requirements · {clientCount} clients · {vendorCount} supplier
              benches · {breaches} SLA breach{breaches === 1 ? "" : "es"} · drag a card between
              columns or use ← →
            </div>
          </div>
          <div style={s("display:flex;align-items:center;gap:8px;flex:none")}>
            <div style={s("display:flex;background:#f1f1f4;border-radius:8px;padding:2px")}>
              {(["board", "list"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  style={sx("padding:6px 13px;border:0;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;text-transform:capitalize", {
                    background: view === v ? "#fff" : "transparent",
                    color: view === v ? "#101014" : "#6b6b78",
                    boxShadow: view === v ? "0 1px 2px rgba(16,16,20,.08)" : "none",
                  })}>
                  {v}
                </button>
              ))}
            </div>
            <Link href="/ops/matching/REQ-2291"
              style={s("padding:8px 13px;border-radius:8px;font-size:12.5px;font-weight:700;background:#101014;color:#fff")}>
              Open matching workspace
            </Link>
          </div>
        </div>

        {/* ---------------- filters ---------------- */}
        <div style={s("display:flex;align-items:center;gap:7px;margin-top:13px;flex-wrap:wrap")}>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search REQ, role, client, owner, skill…"
            style={s("padding:6px 11px;border:1px solid #e0e0e8;border-radius:8px;font-size:12px;width:270px;font-family:inherit;outline:none")}
          />
          <Toggle on={myDesk} onClick={() => setMyDesk((v) => !v)}>My desk · {ownerShortSelf}</Toggle>
          <Toggle on={atRisk} onClick={() => setAtRisk((v) => !v)}>SLA at risk</Toggle>
          <Toggle on={needsSourcing} onClick={() => setNeedsSourcing((v) => !v)}>Needs sourcing</Toggle>
          {anyFilter ? (
            <button onClick={() => { setQuery(""); setMyDesk(false); setAtRisk(false); setNeedsSourcing(false); }}
              style={s("padding:5px 10px;border:0;background:transparent;font-size:11.5px;font-weight:600;color:#6d3ff0;cursor:pointer;font-family:inherit")}>
              Clear filters
            </button>
          ) : null}
          <div style={sx("margin-left:auto;font-size:10.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>
            {filtered.length} of {rows.length} requirements shown
          </div>
        </div>
      </div>

      {/* ---------------- toast ---------------- */}
      {toast ? (
        <div style={s("background:#101014;color:#fff;padding:10px 26px;display:flex;align-items:center;gap:11px;flex:none")}>
          <span style={s("width:7px;height:7px;border-radius:50%;background:#16a34a;flex:none")} />
          <span style={s("font-size:12.5px;flex:1")}>{toast.msg}</span>
          <button onClick={undo}
            style={sx("border:0;background:transparent;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit", { color: "#fbbf24" })}>
            Undo
          </button>
          <button onClick={() => setToast(null)}
            style={s("border:0;background:transparent;font-size:12px;color:#8a8a96;cursor:pointer;font-family:inherit")}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ---------------- body ---------------- */}
      {view === "board" ? (
        <div style={s("flex:1;min-height:0;display:flex;gap:11px;padding:16px 26px 20px;overflow:hidden")}>
          {STAGES.map((st) => {
            const col = filtered.filter((r) => r.stage === st.key);
            const over = col.length > WIP_LIMIT;
            return (
              <div key={st.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dragging && move(dragging, st.key)}
                style={s("flex:1;min-width:0;background:#f2f2f5;border:1px solid #eaeaef;border-radius:12px;display:flex;flex-direction:column;overflow:hidden")}>
                <div style={s("padding:11px 11px 7px;flex:none")}>
                  <div style={s("display:flex;align-items:center;gap:7px")}>
                    <span style={sx("width:7px;height:7px;border-radius:2px;flex:none", { background: st.color })} />
                    <span style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;flex:1", { fontFamily: TOKENS.mono, color: st.fg })}>
                      {st.label}
                    </span>
                    <span style={sx("padding:1px 7px;background:#fff;border:1px solid #e8e8ee;border-radius:20px;font-size:10px;font-weight:700", { fontFamily: TOKENS.mono })}>
                      {col.length}
                    </span>
                  </div>
                  <div style={sx("font-size:10.5px;margin-top:5px", { color: over ? "#b45309" : "#9a9aa6" })}>
                    {over ? `WIP ${col.length} · over the limit of ${WIP_LIMIT}, scroll for the rest`
                          : `${col.length} requirement${col.length === 1 ? "" : "s"}`}
                  </div>
                </div>

                <div style={s("flex:1;min-height:0;overflow:auto;padding:0 9px 9px;display:flex;flex-direction:column;gap:8px")}>
                  {col.length === 0 ? (
                    <div style={s("border:1px dashed #d4d4de;border-radius:9px;padding:18px;text-align:center;font-size:11px;color:#9a9aa6")}>
                      Drop a requirement here
                    </div>
                  ) : col.map((r) => (
                    <div key={r.code}
                      draggable
                      onDragStart={() => setDragging(r.code)}
                      onDragEnd={() => setDragging(null)}
                      style={sx("background:#fff;border-radius:10px;padding:10px;cursor:grab", {
                        border: `1px solid ${dragging === r.code ? "#b45309" : r.sla.state === "late" ? "#f0c9c9" : "#e8e8ee"}`,
                        opacity: dragging === r.code ? 0.5 : 1,
                      })}>
                      <div style={s("display:flex;align-items:center;justify-content:space-between;gap:7px")}>
                        <Link href={`/ops/matching/${r.code}`}
                          style={sx("font-size:11px;font-weight:700;color:#101014", { fontFamily: TOKENS.mono })}>
                          {r.code}
                        </Link>
                        <span style={s("font-size:10px;color:#9a9aa6")}>{r.ageLabel}</span>
                      </div>
                      <Link href={`/ops/matching/${r.code}`}
                        style={s("display:block;font-size:12.5px;font-weight:700;margin-top:4px;color:#101014;line-height:1.3")}>
                        {r.roleTitle}
                      </Link>
                      <div style={s("font-size:10.5px;color:#8a8a96;margin-top:3px")}>
                        {r.clientName} · ×{r.quantity} · {r.ownerShort}
                      </div>
                      <div style={s("display:flex;flex-wrap:wrap;gap:3px;margin-top:7px")}>
                        {r.skills.slice(0, 3).map((sk) => (
                          <span key={sk} style={s("padding:2px 6px;background:#f3f3f7;border-radius:4px;font-size:9.5px;font-weight:600;color:#4a4a58")}>
                            {sk}
                          </span>
                        ))}
                      </div>
                      <div style={s("display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:8px")}>
                        <span style={sx("font-size:11px;font-weight:700", { fontFamily: TOKENS.mono })}>
                          {r.valuePerMonthLabel}
                        </span>
                        <span style={s("display:inline-flex;align-items:center;gap:5px")}>
                          <span style={sx("width:5px;height:5px;border-radius:50%", { background: SLA_COLOR[r.sla.state] })} />
                          <span style={sx("font-size:10px;font-weight:600", { color: SLA_COLOR[r.sla.state] })}>
                            {r.sla.label}
                          </span>
                        </span>
                      </div>
                      <div style={s("display:flex;align-items:center;gap:5px;margin-top:9px;padding-top:8px;border-top:1px solid #f1f1f5")}>
                        <Arrow dir="left" disabled={STAGE_KEYS.indexOf(r.stage) === 0} onClick={() => step(r.code, -1)} />
                        <Link href={`/ops/matching/${r.code}`}
                          style={s("flex:1;text-align:center;font-size:10.5px;font-weight:700;color:#6d3ff0")}>
                          {STAGE_ACTION[r.stage] ?? "Open"}
                        </Link>
                        <Arrow dir="right" disabled={STAGE_KEYS.indexOf(r.stage) === STAGE_KEYS.length - 1} onClick={() => step(r.code, 1)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ListView rows={filtered} onStep={step} />
      )}
    </>
  );
}

/* ------------------------------------------------------------- list view */

const LIST_COLS = "98px 1fr 132px 52px 104px 92px 158px 120px 92px";

function ListView({
  rows, onStep,
}: { rows: OpsPipelineRequirement[]; onStep: (code: string, dir: 1 | -1) => void }) {
  const ordered = [...rows].sort(
    (a, b) => STAGE_KEYS.indexOf(a.stage) - STAGE_KEYS.indexOf(b.stage),
  );
  return (
    <div style={s("flex:1;overflow:auto")}>
      <div style={sx("display:grid;padding:9px 26px;background:#fafafc;border-bottom:1px solid #e8e8ee;position:sticky;top:0;z-index:2", { gridTemplateColumns: LIST_COLS, gap: "10px" })}>
        {["REQ", "ROLE", "CLIENT", "QTY", "VALUE/MO", "OWNER", "STAGE · MOVE", "SLA", "ACTION"].map((h) => (
          <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
            {h}
          </div>
        ))}
      </div>
      {ordered.map((r) => {
        const st = stageMeta(r.stage);
        return (
          <div key={r.code}
            style={sx("display:grid;padding:10px 26px;border-bottom:1px solid #f1f1f5;align-items:center", {
              gridTemplateColumns: LIST_COLS, gap: "10px",
              background: r.sla.state === "late" ? "#fffbfb" : "#fff",
            })}>
            <Link href={`/ops/matching/${r.code}`} style={sx("font-size:11px;font-weight:700;color:#101014", { fontFamily: TOKENS.mono })}>
              {r.code}
            </Link>
            <div style={s("min-width:0")}>
              <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                {r.roleTitle}
              </div>
              <div style={sx("font-size:10px;color:#8a8a96;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", { fontFamily: TOKENS.mono })}>
                {r.skills.join(", ")} · {r.experienceBand} · {r.locationLabel}
              </div>
            </div>
            <div style={s("font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.clientName}</div>
            <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>×{r.quantity}</div>
            <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{r.valuePerMonthLabel}</div>
            <div style={s("font-size:11.5px;color:#4a4a58")}>{r.ownerShort}</div>
            <div style={s("display:flex;align-items:center;gap:5px")}>
              <Arrow dir="left" disabled={STAGE_KEYS.indexOf(r.stage) === 0} onClick={() => onStep(r.code, -1)} />
              <span style={sx("flex:1;text-align:center;padding:3px 7px;border-radius:5px;font-size:9px;font-weight:700;letter-spacing:.08em", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                {st.label}
              </span>
              <Arrow dir="right" disabled={STAGE_KEYS.indexOf(r.stage) === STAGE_KEYS.length - 1} onClick={() => onStep(r.code, 1)} />
            </div>
            <div style={s("display:inline-flex;align-items:center;gap:5px")}>
              <span style={sx("width:5px;height:5px;border-radius:50%;flex:none", { background: SLA_COLOR[r.sla.state] })} />
              <span style={sx("font-size:10.5px;font-weight:600", { color: SLA_COLOR[r.sla.state] })}>{r.sla.label}</span>
            </div>
            <Link href={`/ops/matching/${r.code}`} style={s("font-size:11px;font-weight:700;color:#6d3ff0")}>
              {STAGE_ACTION[r.stage] ?? "Open"}
            </Link>
          </div>
        );
      })}
      <div style={s("padding:14px 26px;font-size:11.5px;color:#8a8a96")}>
        {ordered.length} requirements, grouped in stage order. Late rows are tinted; use the
        arrows to move a requirement one stage at a time.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={sx("padding:6px 11px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
        background: on ? "#fff3e4" : "#fff",
        color: on ? "#b45309" : "#6b6b78",
        border: `1px solid ${on ? "#f0dcc0" : "#e0e0e8"}`,
      })}>
      {children}
    </button>
  );
}

function Arrow({ dir, disabled, onClick }: { dir: "left" | "right"; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={sx("width:22px;height:22px;border-radius:6px;border:1px solid #eaeaef;background:#fff;font-size:11px;line-height:1;font-family:inherit", {
        color: disabled ? "#dcdce4" : "#4a4a58",
        cursor: disabled ? "default" : "pointer",
      })}>
      {dir === "left" ? "←" : "→"}
    </button>
  );
}
