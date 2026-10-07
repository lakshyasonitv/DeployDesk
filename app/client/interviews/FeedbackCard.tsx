"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";

/**
 * The feedback card, now a form.
 *
 * `/api/client/interviews/feedback` has existed and been tested since Sprint 7b part 4,
 * and nothing called it — "Submit feedback" and "Save draft" were `<Button>` elements with
 * no handler, and the ratings were read-only bars. The page is a server component, so this
 * is the client island.
 *
 * Two behaviours the endpoint defines and this card has to respect:
 *
 *   - **A null outcome is a draft.** Saving without choosing an outcome keeps the row in
 *     "feedback due", which is why "Save draft" needs no separate column — the endpoint
 *     already supports it. Submitting requires an outcome, so the button is disabled until
 *     one is picked.
 *   - **The note never reaches the supplier verbatim.** A broker writes a redacted summary
 *     separately. The card says so, because a panel that believes the supplier reads this
 *     writes differently — and more guardedly — than one that knows a human edits it first.
 */

type Outcome = "advance" | "hold" | "pass";

interface Rating {
  label: string;
  value: number | null;
}

/** The API field each label maps to. Kept here so the server shape is not inferred. */
const FIELD: Record<string, "technicalDepth" | "problemSolving" | "communication" | "roleFit"> = {
  "Technical depth": "technicalDepth",
  "Problem solving": "problemSolving",
  "Communication": "communication",
  "Role fit": "roleFit",
};

const OUTCOMES: Array<{ key: Outcome; label: string; tone: string }> = [
  { key: "advance", label: "Move forward", tone: "var(--ok)" },
  { key: "hold", label: "Keep on hold", tone: "var(--warn)" },
  { key: "pass", label: "Not a fit", tone: "var(--danger)" },
];

export function FeedbackCard({
  maskedId, roundNo, roundLabel, roleTitle, requirementCode, ratings: initial, notes: initialNotes,
}: {
  maskedId: string;
  roundNo: number;
  roundLabel: string;
  roleTitle: string;
  requirementCode: string;
  ratings: Rating[];
  notes: string | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [ratings, setRatings] = useState<Rating[]>(initial);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<null | "submit" | "draft">(null);

  const set = (label: string, value: number) =>
    setRatings((prev) => prev.map((r) =>
      // Clicking the value already chosen clears it, which is the only way back to
      // "not answered" without a separate control.
      r.label === label ? { ...r, value: r.value === value ? null : value } : r,
    ));

  async function save(kind: "submit" | "draft") {
    if (busy) return;
    if (kind === "submit" && !outcome) return;
    setBusy(kind);

    const payload = {
      maskedId,
      roundNo,
      ratings: Object.fromEntries(
        ratings.map((r) => [FIELD[r.label] ?? r.label, r.value]),
      ) as Record<string, number | null>,
      outcome: kind === "submit" ? outcome : null,
      notes: notes.trim() || null,
    };

    try {
      const res = await fetch("/api/client/interviews/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error === "already_relayed"
          ? "Your Talentvibes team has already passed this on, so it cannot be changed."
          : "Could not save.");
      }
      const out = await res.json() as {
        previous: null | Record<string, number | null | string>;
      };

      toast({
        message: kind === "submit"
          ? `Feedback on ${maskedId} sent to your Talentvibes team.`
          : `Draft saved for ${maskedId}. It still shows as due.`,
        /**
         * Restores exactly what was there before, which the endpoint returns as
         * `previous`. A first submission has no previous, so Undo writes nulls back — the
         * row returns to "nothing recorded" rather than being deleted, because the row
         * also carries `due_at`, which the client never set and must not lose.
         */
        undo: async () => {
          const p = out.previous;
          const r = await fetch("/api/client/interviews/feedback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              maskedId,
              roundNo,
              ratings: {
                technicalDepth: (p?.technicalDepth as number | null) ?? null,
                problemSolving: (p?.problemSolving as number | null) ?? null,
                communication: (p?.communication as number | null) ?? null,
                roleFit: (p?.roleFit as number | null) ?? null,
              },
              outcome: (p?.outcome as Outcome | null) ?? null,
              notes: (p?.notes as string | null) ?? null,
            }),
          });
          if (!r.ok) throw new Error("restore failed");
          router.refresh();
        },
      });
      router.refresh();
    } catch (e) {
      toast({ tone: "error", message: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setBusy(null);
    }
  }

  const answered = ratings.filter((r) => r.value != null).length;

  return (
    <div style={s("margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--border)")}>
      <div style={s("font-size:12.5px;font-weight:700")}>
        <span style={{ fontFamily: TOKENS.mono }}>{maskedId}</span> · {roundLabel}
      </div>
      <div style={s("font-size:11px;color:var(--t4);margin-top:2px")}>
        {roleTitle} · {requirementCode}
      </div>

      {/* ---- ratings, 1 to 5, clickable ---- */}
      <div style={s("margin-top:12px;display:flex;flex-direction:column;gap:10px")}>
        {ratings.map((r) => (
          <div key={r.label}>
            <div style={s("display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:5px")}>
              <span style={s("color:var(--t2)")}>{r.label}</span>
              <span style={sx("font-weight:700", {
                fontFamily: TOKENS.mono,
                color: r.value == null ? "var(--t4)" : "var(--t1)",
              })}>
                {r.value ?? "—"}
              </span>
            </div>
            <div style={s("display:flex;gap:3px")} role="group" aria-label={r.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set(r.label, n)}
                  aria-label={`${r.label}: ${n} of 5`}
                  aria-pressed={r.value != null && n <= r.value}
                  style={sx("flex:1;height:14px;border:0;border-radius:3px;cursor:pointer;padding:0", {
                    background: r.value != null && n <= r.value ? "var(--brand)" : "var(--border)",
                  })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ---- the note ---- */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="What stood out, and anything your Talentvibes team should know."
        style={s("width:100%;margin-top:12px;padding:9px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12px;font-family:inherit;outline:none;resize:vertical;line-height:1.5")}
      />
      <div style={s("font-size:10.5px;color:var(--t4);margin-top:5px;line-height:1.5")}>
        Goes to your Talentvibes team as written. They send the supplier a shortened version — your
        note is never passed on word for word.
      </div>

      {/* ---- outcome ---- */}
      <div style={s("margin-top:12px")}>
        <div style={s("font-size:11.5px;color:var(--t2);margin-bottom:6px")}>
          What should happen next?
        </div>
        <div style={s("display:flex;gap:6px;flex-wrap:wrap")}>
          {OUTCOMES.map((o) => {
            const on = outcome === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setOutcome(on ? null : o.key)}
                style={sx("padding:6px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
                  background: on ? o.tone : "var(--surface)",
                  color: on ? "#fff" : "var(--t2)",
                  border: `1px solid ${on ? o.tone : "var(--border-2)"}`,
                })}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- actions ---- */}
      <div style={s("margin-top:13px;display:flex;gap:7px;align-items:center;flex-wrap:wrap")}>
        <button
          type="button"
          onClick={() => save("submit")}
          disabled={busy !== null || !outcome}
          title={outcome ? undefined : "Choose what should happen next first"}
          style={sx("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:0;border-radius:9px;font-size:12.5px;font-weight:700;color:#fff;font-family:inherit", {
            background: outcome ? "var(--brand)" : "var(--brand-tint-2)",
            cursor: busy || !outcome ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          })}
        >
          {busy === "submit" ? "Sending…" : "Send to your Talentvibes team"}
        </button>
        <button
          type="button"
          onClick={() => save("draft")}
          disabled={busy !== null}
          style={sx("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:1px solid var(--border-2);border-radius:9px;font-size:12.5px;font-weight:600;background:var(--surface);font-family:inherit", {
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          })}
        >
          {busy === "draft" ? "Saving…" : "Save for later"}
        </button>
        <span style={s("font-size:11px;color:var(--t4);margin-left:auto")}>
          {answered} of {ratings.length} rated
        </span>
      </div>
    </div>
  );
}
