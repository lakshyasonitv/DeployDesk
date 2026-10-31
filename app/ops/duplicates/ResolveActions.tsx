"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";

/**
 * The resolve buttons on a duplicate flag.
 *
 * `/api/ops/duplicates/resolve` has existed and been tested since Sprint 7b part 4, but
 * nothing called it — the buttons on this screen were `<Button>` elements with no handler.
 * The page is a server component, so this is the client island that connects them.
 *
 * Why the Undo is a real reversal and not a confirmation dialog: resolving a flag
 * WITHDRAWS the losing submission, which takes a real person off the exchange. Asking
 * "are you sure?" before every one would slow down a desk that clears these in batches,
 * and it still would not help the case that matters — realising thirty seconds later that
 * you kept the wrong side. Undo re-opens the flag and relists what was withdrawn.
 *
 * "Keep A" withdraws B. When B cannot be withdrawn — a live placement, a shortlist a client
 * holds — that button is disabled and the reason is shown, rather than offering a click
 * the route will refuse.
 */

type Resolution = "kept_a" | "kept_b" | "not_duplicate";

/** Each refusal the route can give, in words a broker can act on. */
function refusal(code: string, body: { error?: string; reason?: string } | null): string {
  switch (body?.error) {
    case "already_settled": return `${code} was already settled. Showing the current state.`;
    case "already_open": return `${code} is already open.`;
    case "cannot_withdraw": return `Not settled: ${body.reason ?? "that person cannot be withdrawn"}.`;
    default: return `Could not settle ${code}.`;
  }
}

export function ResolveActions({
  code,
  keepALabel,
  keepBLabel,
  keepABlockedBy,
  keepBBlockedBy,
  recommended,
}: {
  code: string;
  /** The supplier whose submission "Keep A" keeps, for a button that names it. */
  keepALabel: string;
  keepBLabel: string;
  /** Why "Keep A" cannot be used (it would withdraw B), or null. */
  keepABlockedBy: string | null;
  keepBBlockedBy: string | null;
  /** Which "Keep" the recommendation favours; that one is the primary button. */
  recommended: "a" | "b" | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<Resolution | null>(null);

  async function resolve(resolution: Resolution) {
    if (busy) return;
    setBusy(resolution);
    try {
      const res = await fetch("/api/ops/duplicates/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, resolution }),
      });
      if (!res.ok) {
        toast({ tone: "error", message: refusal(code, await res.json().catch(() => null)) });
        router.refresh();
        return;
      }
      const out = await res.json() as { withdrew: string | null };

      toast({
        message: out.withdrew
          ? `${code} settled. ${out.withdrew} withdrawn, so they cannot be offered twice.`
          : `${code} marked as two different people. Neither submission was withdrawn.`,
        // Re-opens the flag and relists the person this withdrew.
        undo: async () => {
          const r = await fetch("/api/ops/duplicates/resolve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code, resolution: "open" }),
          });
          if (!r.ok) throw new Error("reopen failed");
          router.refresh();
        },
      });
      router.refresh();
    } catch {
      toast({ tone: "error", message: `Could not settle ${code}.` });
    } finally {
      setBusy(null);
    }
  }

  const base = "padding:0 13px;height:34px;display:inline-flex;align-items:center;border-radius:9px;font-size:var(--fs-4);font-weight:700;font-family:inherit;white-space:nowrap";
  const look = (primary: boolean, blocked: boolean) => sx(base, {
    background: primary ? "var(--t1)" : "var(--surface)",
    color: primary ? "var(--surface)" : "var(--t1)",
    border: primary ? 0 : "1px solid var(--border-2)",
    cursor: busy || blocked ? "default" : "pointer",
    opacity: busy || blocked ? 0.45 : 1,
  });

  const keep = (side: "a" | "b", label: string, blockedBy: string | null) => (
    <button
      type="button"
      onClick={() => resolve(side === "a" ? "kept_a" : "kept_b")}
      disabled={busy !== null || blockedBy !== null}
      title={blockedBy ? `Can't: ${blockedBy}` : undefined}
      style={look(recommended === side && !blockedBy, blockedBy !== null)}
    >
      {busy === `kept_${side}` ? "Settling…" : `Keep ${label}`}
    </button>
  );

  const blocked = [keepABlockedBy, keepBBlockedBy].filter(Boolean);

  return (
    <div style={s("display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none")}>
      <div style={s("display:flex;gap:8px;flex-wrap:wrap")}>
        {keep("a", keepALabel, keepABlockedBy)}
        {keep("b", keepBLabel, keepBBlockedBy)}
        <button
          type="button"
          onClick={() => resolve("not_duplicate")}
          disabled={busy !== null}
          style={sx(look(false, false), { color: "var(--t2)" })}
        >
          {busy === "not_duplicate" ? "Saving…" : "Two different people"}
        </button>
      </div>
      {/* Said on screen, not only in a tooltip: a greyed button with no reason is a dead end. */}
      {blocked.length ? (
        <div style={s("font-size:var(--fs-1);color:var(--t4);text-align:right;max-width:420px")}>
          Can&apos;t withdraw: {blocked.join("; ")}. Talk to the client first.
        </div>
      ) : null}
    </div>
  );
}
