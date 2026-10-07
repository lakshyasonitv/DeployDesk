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
  confirmed: { bg: "var(--ok-tint)", fg: "var(--ok)", label: "CONFIRMED" },
  expiring_soon: { bg: "var(--warn-tint)", fg: "var(--warn)", label: "EXPIRING SOON" },
  unconfirmed: { bg: "var(--danger-tint)", fg: "var(--danger)", label: "UNCONFIRMED" },
} as const;

const ASSESSMENT_STYLE: Record<string, { dot: string; label: string; sub: string }> = {
  scored: { dot: "var(--ok)", label: "Scored", sub: "proctored, valid 90 days" },
  in_progress: { dot: "var(--warn)", label: "In progress", sub: "started recently" },
  invited: { dot: "var(--warn)", label: "Invite sent", sub: "awaiting start" },
  not_started: { dot: "var(--t4)", label: "Not started", sub: "invite not sent" },
  expired: { dot: "var(--danger)", label: "Expired", sub: "needs a retake" },
  abandoned: { dot: "var(--t4)", label: "Abandoned", sub: "not completed" },
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
  const [, startTransition] = useTransition();

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
    ["all", "All", counts.all, "var(--t1)", "var(--surface)"],
    ["listed", "Listed", counts.listed, "var(--surface-3)", "var(--t2)"],
    ["in_process", "In process", counts.in_process, "var(--surface-3)", "var(--t2)"],
    ["expiring", "Expiring", counts.expiring, "var(--warn-tint)", "var(--warn)"],
    ["unconfirmed", "Unconfirmed", counts.unconfirmed, "var(--danger-tint)", "var(--danger)"],
  ];

  /**
   * " on your bench" / " who are expiring" — a readable tail for the count sentence.
   * The raw filter keys are `in_process` and `expiring`, which are not English.
   */
  const filterLabel = filter === "all" ? " on your bench"
    : filter === "listed" ? " listed and available"
    : filter === "in_process" ? " already with a client"
    : filter === "expiring" ? " who need confirming this week"
    : " not confirmed for over two weeks";

  return (
    <>
      <div style={s("padding:20px 26px 16px;background:var(--surface);border-bottom:1px solid var(--border);flex:none")}>
        <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
          <div>
            <div style={s("font-size:22px;font-weight:800;letter-spacing:-.6px")}>Bench roster</div>
            <div style={s("font-size:12.5px;color:var(--t3);margin-top:4px")}>
              {total} resources · {counts.listed} listed on the exchange · confirm availability
              every 14 days to stay in matching
            </div>
          </div>
          <div style={s("display:flex;gap:8px;flex:none")}>
            <div style={s("padding:8px 13px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--surface)")}>
              Export CSV
            </div>
            <button
              disabled={!expiringIds.length}
              onClick={() => startTransition(() => { void confirm(expiringIds, "bulk"); })}
              style={sx("padding:8px 13px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;color:var(--surface);font-family:inherit", {
                background: expiringIds.length ? "var(--ok)" : "var(--ok-tint)",
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
                    background: active ? bg : "var(--surface)",
                    color: active ? fg : "var(--t3)",
                    boxShadow: active ? "none" : "inset 0 0 0 1px var(--border)",
                  })}>
                  {label} {n}
                </button>
              );
            })}
          </div>
          <div style={sx("font-size:10.5px;color:var(--t4);flex:none", { fontFamily: TOKENS.mono })}>
            Rechecked every night at 02:00 IST
          </div>
        </div>
      </div>

      <div style={s("flex:1;overflow:auto")}>
        <div style={sx("display:grid;padding:9px 26px;background:var(--surface-2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:2", { gridTemplateColumns: COLS, gap: "12px" })}>
          {["NAME", "SKILLS", "EXPERIENCE", "YOUR MONTHLY RATE", "ASSESSMENT", "LAST CONFIRMED", "CONFIRM"].map((h) => (
            <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4);white-space:nowrap", { fontFamily: TOKENS.mono })}>
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
              style={sx("display:grid;padding:11px 26px;border-bottom:1px solid var(--surface-3);align-items:center;background:var(--surface)", { gridTemplateColumns: COLS, gap: "12px" })}>
              <div style={s("min-width:0")}>
                <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                  {r.fullName}
                </div>
                <div style={sx("font-size:10.5px;color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>
                  {r.maskedId} · {r.baseCity}
                </div>
              </div>

              <div style={s("display:flex;flex-wrap:wrap;gap:4px;min-width:0")}>
                {r.skills.slice(0, 4).map((sk) => (
                  <span key={sk} style={s("padding:2px 7px;background:var(--surface-3);border-radius:5px;font-size:10.5px;font-weight:600;color:var(--t2);white-space:nowrap")}>
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
                <div style={s("font-size:10px;color:var(--t4);margin-top:2px")}>{as.sub}</div>
              </div>

              <div style={s("min-width:0")}>
                <div style={s("display:flex;align-items:center;gap:7px")}>
                  <span style={sx("display:inline-block;padding:2px 7px;border-radius:4px;font-size:8.5px;font-weight:700;letter-spacing:.08em;white-space:nowrap", { background: fs.bg, color: fs.fg, fontFamily: TOKENS.mono })}>
                    {fs.label}
                  </span>
                  <span style={s("font-size:10.5px;color:var(--t4)")}>
                    {fresh.state === "confirmed" && isConfirmed ? "just now" : `${fresh.days}d ago`}
                  </span>
                </div>
                <div style={s("height:4px;background:var(--border);border-radius:3px;margin-top:6px;overflow:hidden")}>
                  <div style={sx("height:100%;border-radius:3px", { width: `${fresh.decayBarWidthPct}%`, background: fs.fg })} />
                </div>
              </div>

              <div>
                {isConfirmed ? (
                  <div style={s("padding:6px 10px;border-radius:7px;font-size:11px;font-weight:700;background:var(--surface-3);color:var(--t4);text-align:center")}>
                    Confirmed ✓
                  </div>
                ) : (
                  <button
                    onClick={() => startTransition(() => { void confirm([r.maskedId], "single"); })}
                    style={s("padding:6px 10px;border:0;border-radius:7px;font-size:11px;font-weight:700;background:var(--ok);color:var(--surface);cursor:pointer;width:100%;font-family:inherit")}
                  >
                    Still available
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/*
          "Load more" said nothing useful: not how many more, and not how many were left.
          With 42 people on a bench it also meant clicking the same button four times.

          It now names the number and finishes the job in one click — "Show all 42 people".
          The count line beside it is a sentence rather than "12 of 42", because the
          audience is senior staff who should not have to infer what a bare ratio means.
        */}
        <div style={s("padding:14px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap")}>
          <div style={s("font-size:12.5px;color:var(--t3)")}>
            {visible >= shown.length
              ? `Showing all ${shown.length} ${shown.length === 1 ? "person" : "people"}${filterLabel}`
              : `Showing ${Math.min(visible, shown.length)} of ${shown.length} ${shown.length === 1 ? "person" : "people"}${filterLabel}`}
          </div>
          {visible < shown.length ? (
            <button
              type="button"
              onClick={() => setVisible(shown.length)}
              style={s("padding:8px 14px;border:1px solid var(--border-2);border-radius:9px;font-size:12.5px;font-weight:700;background:var(--surface);cursor:pointer;font-family:inherit;color:var(--t1)")}
            >
              Show all {shown.length} {shown.length === 1 ? "person" : "people"}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
