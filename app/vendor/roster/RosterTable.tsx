"use client";

import { useState, useTransition } from "react";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import type { VendorRosterResource } from "@/src/read-models/vendor";

/**
 * Bench roster table. Owns the filter pills and the confirm interaction.
 *
 * Freshness arrives already derived from the server (state, label, decay bar width) —
 * docs/DOMAIN.md forbids storing it, and recomputing it here from a timestamp would
 * duplicate the thresholds in a second place.
 */

const FRESHNESS_STYLE = {
  confirmed: { bg: "#e8f6ef", fg: "#0f7a4a", label: "CONFIRMED" },
  expiring_soon: { bg: "#fff3e4", fg: "#b45309", label: "EXPIRING SOON" },
  unconfirmed: { bg: "#fdecec", fg: "#b91c1c", label: "UNCONFIRMED" },
} as const;

const ASSESSMENT_STYLE: Record<string, { dot: string; label: string; sub: string }> = {
  scored: { dot: "#16a34a", label: "Scored", sub: "proctored, valid 90 days" },
  in_progress: { dot: "#c2410c", label: "In progress", sub: "started recently" },
  invited: { dot: "#c2410c", label: "Invite sent", sub: "awaiting start" },
  not_started: { dot: "#9aa0ab", label: "Not started", sub: "invite not sent" },
  expired: { dot: "#b91c1c", label: "Expired", sub: "needs a retake" },
  abandoned: { dot: "#9aa0ab", label: "Abandoned", sub: "not completed" },
};

const COLS = "170px 1fr 66px 118px 138px 186px 122px";

type Filter = "all" | "listed" | "in_process" | "expiring" | "unconfirmed";

export function RosterTable({
  resources, counts, total,
}: {
  resources: VendorRosterResource[];
  counts: Record<Filter, number>;
  total: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState(9);
  const [pending, startTransition] = useTransition();

  const confirm = async (maskedIds: string[], method: "single" | "bulk") => {
    // Optimistic: the row flips immediately, then the write lands.
    setConfirmed((p) => ({ ...p, ...Object.fromEntries(maskedIds.map((id) => [id, true])) }));
    try {
      await fetch("/api/vendor/resources/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maskedIds, method }),
      });
    } catch {
      setConfirmed((p) => {
        const next = { ...p };
        for (const id of maskedIds) delete next[id];
        return next;
      });
    }
  };

  const shown = resources.filter((r) => {
    switch (filter) {
      case "listed": return r.status === "listed";
      case "in_process": return r.status === "in_process";
      case "expiring": return r.freshness.state === "expiring_soon" && !confirmed[r.maskedId];
      case "unconfirmed": return r.freshness.state === "unconfirmed" && !confirmed[r.maskedId];
      default: return true;
    }
  });

  const expiringIds = resources
    .filter((r) => r.freshness.state !== "confirmed" && !confirmed[r.maskedId])
    .map((r) => r.maskedId);

  const PILLS: Array<[Filter, string, number, string, string]> = [
    ["all", "All", counts.all, "#101014", "#fff"],
    ["listed", "Listed", counts.listed, "#f3f3f7", "#4a4a58"],
    ["in_process", "In process", counts.in_process, "#f3f3f7", "#4a4a58"],
    ["expiring", "Expiring", counts.expiring, "#fff3e4", "#b45309"],
    ["unconfirmed", "Unconfirmed", counts.unconfirmed, "#fdecec", "#b91c1c"],
  ];

  return (
    <>
      <div style={s("padding:20px 26px 16px;background:#fff;border-bottom:1px solid #e8e8ee;flex:none")}>
        <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div>
            <div style={s("font-size:22px;font-weight:800;letter-spacing:-.6px")}>Bench roster</div>
            <div style={s("font-size:12.5px;color:#6b6b78;margin-top:4px")}>
              {total} resources · {counts.listed} listed on the exchange · confirm availability
              every 14 days to stay in matching
            </div>
          </div>
          <div style={s("display:flex;gap:8px;flex:none")}>
            <div style={s("padding:8px 13px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-weight:600;background:#fff")}>
              Export CSV
            </div>
            <button
              disabled={!expiringIds.length}
              onClick={() => startTransition(() => { void confirm(expiringIds, "bulk"); })}
              style={sx("padding:8px 13px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;color:#fff;font-family:inherit", {
                background: expiringIds.length ? "#0f7a4a" : "#b9ccc2",
                cursor: expiringIds.length ? "pointer" : "default",
              })}
            >
              Confirm all expiring · {expiringIds.length}
            </button>
          </div>
        </div>

        <div style={s("display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px")}>
          <div style={s("display:flex;gap:6px;flex-wrap:wrap")}>
            {PILLS.map(([key, label, n, bg, fg]) => {
              const active = filter === key;
              return (
                <button key={key} onClick={() => setFilter(key)}
                  style={sx("padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;border:0", {
                    background: active ? bg : "#fff",
                    color: active ? fg : "#6b6b78",
                    boxShadow: active ? "none" : "inset 0 0 0 1px #e8e8ee",
                  })}>
                  {label} {n}
                </button>
              );
            })}
          </div>
          <div style={sx("font-size:10.5px;color:#8a8a96;flex:none", { fontFamily: TOKENS.mono })}>
            Freshness recalculated nightly · 02:00 IST
          </div>
        </div>
      </div>

      <div style={s("flex:1;overflow:auto")}>
        <div style={sx("display:grid;padding:9px 26px;background:#fafafc;border-bottom:1px solid #e8e8ee;position:sticky;top:0;z-index:2", { gridTemplateColumns: COLS, gap: "12px" })}>
          {["RESOURCE", "SKILLS", "EXP", "YOUR RATE", "ASSESSMENT", "AVAILABILITY FRESHNESS", "CONFIRM"].map((h) => (
            <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
              {h}
            </div>
          ))}
        </div>

        {shown.slice(0, visible).map((r) => {
          const isConfirmed = confirmed[r.maskedId];
          const fresh = isConfirmed
            ? { state: "confirmed" as const, label: "just now", decayBarWidthPct: 100, days: 0 }
            : r.freshness;
          const fs = FRESHNESS_STYLE[fresh.state as keyof typeof FRESHNESS_STYLE] ?? FRESHNESS_STYLE.confirmed;
          const as = ASSESSMENT_STYLE[r.assessment.status] ?? ASSESSMENT_STYLE.not_started;
          return (
            <div key={r.maskedId}
              style={sx("display:grid;padding:11px 26px;border-bottom:1px solid #f1f1f5;align-items:center;background:#fff", { gridTemplateColumns: COLS, gap: "12px" })}>
              <div style={s("min-width:0")}>
                <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                  {r.fullName}
                </div>
                <div style={sx("font-size:10.5px;color:#8a8a96;margin-top:2px", { fontFamily: TOKENS.mono })}>
                  {r.maskedId} · {r.baseCity}
                </div>
              </div>

              <div style={s("display:flex;flex-wrap:wrap;gap:4px;min-width:0")}>
                {r.skills.slice(0, 4).map((sk) => (
                  <span key={sk} style={s("padding:2px 7px;background:#f3f3f7;border-radius:5px;font-size:10.5px;font-weight:600;color:#4a4a58;white-space:nowrap")}>
                    {sk}
                  </span>
                ))}
              </div>

              <div style={s("font-size:12px;font-weight:600")}>{r.experienceLabel}</div>

              <div style={sx("font-size:12px;font-weight:700", { fontFamily: TOKENS.mono })}>
                {r.vendorRateLabel}
              </div>

              <div style={s("min-width:0")}>
                <div style={s("display:flex;align-items:center;gap:6px")}>
                  <span style={sx("width:6px;height:6px;border-radius:50%;flex:none", { background: as.dot })} />
                  <span style={s("font-size:12px;font-weight:600")}>
                    {as.label}{r.assessment.overall != null ? ` ${r.assessment.overall}` : ""}
                  </span>
                </div>
                <div style={s("font-size:10px;color:#8a8a96;margin-top:2px")}>{as.sub}</div>
              </div>

              <div style={s("min-width:0")}>
                <div style={s("display:flex;align-items:center;gap:7px")}>
                  <span style={sx("display:inline-block;padding:2px 7px;border-radius:4px;font-size:8.5px;font-weight:700;letter-spacing:.08em;white-space:nowrap", { background: fs.bg, color: fs.fg, fontFamily: TOKENS.mono })}>
                    {fs.label}
                  </span>
                  <span style={s("font-size:10.5px;color:#8a8a96")}>
                    {fresh.state === "confirmed" && isConfirmed ? "just now" : `${fresh.days}d ago`}
                  </span>
                </div>
                <div style={s("height:4px;background:#eeeef3;border-radius:3px;margin-top:6px;overflow:hidden")}>
                  <div style={sx("height:100%;border-radius:3px", { width: `${fresh.decayBarWidthPct}%`, background: fs.fg })} />
                </div>
              </div>

              <div>
                {isConfirmed ? (
                  <div style={s("padding:6px 10px;border-radius:7px;font-size:11px;font-weight:700;background:#f3f3f7;color:#8a8a96;text-align:center")}>
                    Confirmed ✓
                  </div>
                ) : (
                  <button
                    onClick={() => startTransition(() => { void confirm([r.maskedId], "single"); })}
                    style={s("padding:6px 10px;border:0;border-radius:7px;font-size:11px;font-weight:700;background:#0f7a4a;color:#fff;cursor:pointer;width:100%;font-family:inherit")}
                  >
                    Still available
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div style={s("padding:14px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
          <div style={s("font-size:12px;color:#8a8a96")}>
            Showing {Math.min(visible, shown.length)} of {shown.length}
            {filter !== "all" ? ` ${filter.replace("_", " ")}` : ""}
          </div>
          {visible < shown.length ? (
            <button onClick={() => setVisible((v) => v + 12)}
              style={s("padding:7px 13px;border:1px solid #e0e0e8;border-radius:8px;font-size:12px;font-weight:700;background:#fff;cursor:pointer;font-family:inherit")}>
              Load more
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
