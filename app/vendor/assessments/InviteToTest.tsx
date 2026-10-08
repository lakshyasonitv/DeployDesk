"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";

/**
 * Asking for a proctored test.
 *
 * "Invite N to test" had no handler, and the screen behind it could not even show an
 * untested person: `getVendorAssessments` read `FROM assessments INNER JOIN
 * bench_resources`, so only people who already had a test record appeared. Someone just
 * added to the bench was invisible on the one screen whose job is to get them tested.
 *
 * **What this claims is narrow, deliberately.** ADR-006 puts the provider behind an
 * adapter that does not exist, so the endpoint records a REQUEST — an `assessments` row at
 * status `invited`, `provider_ref` null — and the copy says "test requested", never
 * "invitation sent". The owner chose that over leaving the button inert and over faking a
 * score; faking was the one to refuse, because an independently proctored result that
 * neither side can influence is the whole product, and a number invented by our own
 * endpoint would be indistinguishable from a real one later.
 */

async function post(maskedIds: string[]) {
  const res = await fetch("/api/vendor/assessments/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maskedIds }),
  });
  if (!res.ok) throw new Error("invite failed");
  return res.json() as Promise<{ queued: string[]; alreadyWaiting: string[] }>;
}

async function undo(maskedIds: string[]) {
  const res = await fetch("/api/vendor/assessments/invite", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ maskedIds }),
  });
  if (!res.ok) throw new Error("abandon failed");
}

/** Shared behaviour: request, report honestly, offer a real reversal. */
function useRequest() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(maskedIds: string[], describe: (queued: number) => string) {
    if (busy || !maskedIds.length) return;
    setBusy(true);
    try {
      const out = await post(maskedIds);

      if (!out.queued.length) {
        // Pressing the button twice must not look like it failed, and must not look like
        // it worked either.
        toast({ message: "Everyone there is already waiting on a test." });
        return;
      }
      const waiting = out.alreadyWaiting.length
        ? ` ${out.alreadyWaiting.length} ${out.alreadyWaiting.length === 1 ? "was" : "were"} already waiting.`
        : "";
      toast({
        message: describe(out.queued.length) + waiting,
        // Sets the rows to `abandoned` rather than deleting them: "we asked and changed our
        // mind" is a different fact from "we never asked", and it is the first thing a
        // supplier would argue about on an assessment bill.
        undo: async () => {
          await undo(out.queued);
          router.refresh();
        },
      });
      router.refresh();
    } catch {
      toast({ tone: "error", message: "Could not request that test." });
    } finally {
      setBusy(false);
    }
  }

  return { run, busy };
}

export function InviteAllButton({ maskedIds }: { maskedIds: string[] }) {
  const { run, busy } = useRequest();
  const n = maskedIds.length;

  // Nothing untested: say so rather than offering an action that would do nothing.
  if (!n) {
    return (
      <span style={s("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:1px dashed var(--border-2);border-radius:9px;font-size:12.5px;font-weight:600;color:var(--t4);white-space:nowrap")}>
        Everyone has been tested
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => run(maskedIds, (q) => `Requested a test for ${q} ${q === 1 ? "person" : "people"}.`)}
      disabled={busy}
      style={sx("padding:0 14px;height:34px;display:inline-flex;align-items:center;border:0;border-radius:9px;font-size:12.5px;font-weight:700;color:#fff;background:var(--teal);font-family:inherit;white-space:nowrap", {
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
      })}
    >
      {busy ? "Requesting…" : `Request a test for ${n}`}
    </button>
  );
}

export function RequestTestButton({ maskedId, fullName }: { maskedId: string; fullName: string }) {
  const { run, busy } = useRequest();
  return (
    <button
      type="button"
      onClick={() => run([maskedId], () => `Requested a test for ${fullName}.`)}
      disabled={busy}
      style={sx("margin-top:11px;width:100%;padding:7px;border:1px solid var(--teal);border-radius:8px;font-size:11.5px;font-weight:700;background:transparent;color:var(--teal);font-family:inherit", {
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
      })}
    >
      {busy ? "Requesting…" : "Request a test"}
    </button>
  );
}
