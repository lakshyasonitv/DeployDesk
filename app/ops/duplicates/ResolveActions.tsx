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
 */

export function ResolveActions({
  code,
  keepALabel,
  keepBLabel,
}: {
  code: string;
  /** The supplier whose submission "Keep A" keeps, for a button that names it. */
  keepALabel: string;
  keepBLabel: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function resolve(resolution: "kept_a" | "kept_b" | "not_duplicate") {
    if (busy) return;
    setBusy(resolution);
    try {
      const res = await fetch("/api/ops/duplicates/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, resolution }),
      });
      if (!res.ok) throw new Error("resolve failed");
      const out = await res.json() as { withdrew: string | null };

      toast({
        message: out.withdrew
          ? `${code} settled. ${out.withdrew} withdrawn, so they cannot be offered twice.`
          : `${code} marked as two different people. Neither submission was withdrawn.`,
        // Re-opens the flag and relists whatever was withdrawn.
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

  const base = "padding:0 13px;height:34px;display:inline-flex;align-items:center;border-radius:9px;font-size:12.5px;font-weight:700;font-family:inherit;white-space:nowrap";

  return (
    <div style={s("display:flex;gap:8px;flex:none;flex-wrap:wrap")}>
      <button
        type="button"
        onClick={() => resolve("kept_a")}
        disabled={busy !== null}
        style={sx(base, {
          background: "var(--t1)", color: "var(--surface)", border: 0,
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        })}
      >
        {busy === "kept_a" ? "Settling…" : `Keep ${keepALabel}`}
      </button>

      <button
        type="button"
        onClick={() => resolve("kept_b")}
        disabled={busy !== null}
        style={sx(base, {
          background: "var(--surface)", color: "var(--t1)",
          border: "1px solid var(--border-2)",
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        })}
      >
        {busy === "kept_b" ? "Settling…" : `Keep ${keepBLabel}`}
      </button>

      <button
        type="button"
        onClick={() => resolve("not_duplicate")}
        disabled={busy !== null}
        style={sx(base, {
          background: "var(--surface)", color: "var(--t2)",
          border: "1px solid var(--border-2)",
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        })}
      >
        {busy === "not_duplicate" ? "Saving…" : "Two different people"}
      </button>
    </div>
  );
}
