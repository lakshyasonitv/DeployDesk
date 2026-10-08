"use client";

import {
  createContext, useCallback, useContext, useMemo, useState, type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, X } from "lucide-react";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";
import type { OpsOpenRequirement } from "@/src/read-models/ops";

/**
 * "Add to a requirement" — the talent pool's one remaining dead button.
 *
 * It sat in the page header with no handler and nothing selected, which made it doubly
 * inert: even with a handler there was no way to say WHO to add. So the selection comes
 * first (a checkbox per row) and the button names the count, which is the shape the product
 * owner chose over a per-row "+" button.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE PROVIDER AND NOT A BUTTON PER ROW
 * ---------------------------------------------------------------------------
 *
 * The checkboxes are in the table and the button is in the page header — two places the
 * server renders, far apart in the markup. A client context spanning both is what lets the
 * header count rows it does not own. The provider renders no DOM element of its own, which
 * matters: `Shell` lays its children out as a flex column, and an extra wrapping `<div>`
 * would collapse the table's `flex:1`.
 *
 * ---------------------------------------------------------------------------
 * THE OUTCOME IS SHOWN, NOT SUMMARISED AWAY
 * ---------------------------------------------------------------------------
 *
 * Adding ten people can produce four different outcomes at once: added, added-but-flagged,
 * already there, and refused. A toast cannot carry that honestly, so when anything other
 * than a clean add happens the dialog stays open and lists it person by person. A clean add
 * closes and toasts with a real Undo.
 */

/* ---------------------------------------------------------------- selection */

interface Selection {
  selected: Set<string>;
  toggle: (maskedId: string) => void;
  toggleAll: () => void;
  clear: () => void;
  /** Every row currently rendered — what "select all" means on a filtered, limited page. */
  pageIds: string[];
  requirements: OpsOpenRequirement[];
}

const SelectionContext = createContext<Selection | null>(null);

/**
 * Null outside the provider rather than a throw, matching `ToastContext`: a checkbox
 * rendered outside it should degrade to doing nothing, not blank the page.
 */
function useSelection() {
  return useContext(SelectionContext);
}

export function PoolSelectionProvider({
  pageIds, requirements, children,
}: {
  pageIds: string[];
  requirements: OpsOpenRequirement[];
  children: ReactNode;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const toggle = useCallback((maskedId: string) => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(maskedId)) next.delete(maskedId);
      else next.add(maskedId);
      return next;
    });
  }, []);

  // Keyed on the joined list so the callbacks below are stable across re-renders that pass
  // an equal-but-new array, which a server component does on every navigation.
  const pageKey = pageIds.join(",");

  /**
   * **What counts as selected is the intersection with the page in front of you.**
   *
   * The filters are a navigation, and this provider sits at the same position in the tree
   * across one — so ticking five people and then clicking a filter chip would otherwise
   * leave all five selected while the table shows different rows, and the header would read
   * "Add 5 to a requirement" with two of them visible. A count nobody can see is a promise
   * the screen cannot keep, and it is the same shape as every other defect found on these
   * pages: a control that looks like it is working.
   *
   * Derived rather than pruned in an effect, because the obvious effect — clear what is no
   * longer on the page — also fires on the `router.refresh()` after an add, and because
   * deriving means a tick cannot be lost to a re-render. Going back to the earlier filter
   * brings the earlier ticks back, which is what somebody comparing two filters wants.
   */
  const selected = useMemo(() => {
    const onPage = new Set<string>();
    for (const id of pageKey ? pageKey.split(",") : []) {
      if (picked.has(id)) onPage.add(id);
    }
    return onPage;
  }, [picked, pageKey]);

  const toggleAll = useCallback(() => {
    const ids = pageKey ? pageKey.split(",") : [];
    setPicked((cur) => (ids.every((id) => cur.has(id)) ? new Set() : new Set(ids)));
  }, [pageKey]);

  const clear = useCallback(() => setPicked(new Set()), []);

  const value = useMemo<Selection>(
    () => ({ selected, toggle, toggleAll, clear, pageIds, requirements }),
    [selected, toggle, toggleAll, clear, pageIds, requirements],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/* ---------------------------------------------------------------- checkboxes */

function box(on: boolean) {
  return sx("width:15px;height:15px;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0", {
    background: on ? "var(--brand)" : "var(--surface)",
    border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
    color: "#fff",
  });
}

export function PoolRowCheck({ maskedId, name }: { maskedId: string; name: string }) {
  const sel = useSelection();
  if (!sel) return null;
  const on = sel.selected.has(maskedId);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={`Select ${name}`}
      onClick={() => sel.toggle(maskedId)}
      style={box(on)}
    >
      {on ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  );
}

export function PoolHeaderCheck() {
  const sel = useSelection();
  if (!sel) return null;
  const all = sel.pageIds.length > 0 && sel.pageIds.every((id) => sel.selected.has(id));
  const label = all ? "Clear the selection" : `Select all ${sel.pageIds.length} shown`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={all}
      aria-label={label}
      title={label}
      onClick={sel.toggleAll}
      style={box(all)}
    >
      {all ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  );
}

/* ---------------------------------------------------------------- the action */

/** What the endpoint reports back, in the words a broker would use. */
const FLAG_TEXT: Record<string, string> = {
  blocked_stale: "profile not confirmed in the last 14 days",
  blocked_duplicate: "flagged as a possible duplicate of another profile",
  blocked_deployed: "already deployed somewhere else",
  blocked_score_expired: "proctored score has expired",
};

const REFUSED_TEXT: Record<string, string> = {
  not_found: "no longer in the exchange",
  self_dealing_or_blocked: "this client has blocked their employer, or it is the same group",
  off_the_bench: "withdrawn from the bench",
};

interface AddResult {
  requirementCode: string;
  added: string[];
  flagged: Array<{ maskedId: string; eligibility: string }>;
  alreadyThere: string[];
  refused: Array<{ maskedId: string; reason: string }>;
  written: string[];
}

export function AddToRequirementAction() {
  const sel = useSelection();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AddResult | null>(null);

  const count = sel?.selected.size ?? 0;
  const requirements = sel?.requirements ?? [];

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requirements;
    return requirements.filter((r) =>
      `${r.code} ${r.roleTitle} ${r.clientName}`.toLowerCase().includes(q));
  }, [requirements, query]);

  if (!sel) return null;

  const close = () => {
    setOpen(false);
    setQuery("");
    setOutcome(null);
  };

  const submit = async (req: OpsOpenRequirement) => {
    const maskedIds = [...sel.selected];
    setBusy(req.code);
    try {
      const res = await fetch("/api/ops/pool/add-to-requirement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: req.code, maskedIds }),
      });
      const data = (await res.json().catch(() => null)) as (AddResult & { error?: string }) | null;

      if (!res.ok || !data || data.error) {
        toast({
          tone: "error",
          message: data?.error === "stage_closed"
            ? `${req.code} is no longer open — reload the page.`
            : `Could not add anybody to ${req.code}.`,
        });
        return;
      }

      // Re-query the pool: adding somebody changes the "already sourced" count the picker
      // shows, and the matching desk this links to.
      router.refresh();

      const clean = data.flagged.length === 0
        && data.refused.length === 0
        && data.alreadyThere.length === 0;

      if (clean) {
        /**
         * Undo removes only what this call wrote, and the endpoint refuses to remove anybody
         * already quoted to the client or hand-arranged by a broker — so it reverses the add
         * without reversing somebody else's work.
         */
        const written = data.written;
        toast({
          message: `${written.length} added to ${req.code} · ${req.roleTitle}`,
          undo: async () => {
            const undo = await fetch("/api/ops/pool/add-to-requirement", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code: req.code, maskedIds: written }),
            });
            if (!undo.ok) throw new Error("undo failed");
            router.refresh();
          },
        });
        sel.clear();
        close();
      } else {
        // Something needs saying per person. Keep the dialog open and say it.
        setOutcome(data);
        if (data.written.length) sel.clear();
      }
    } catch {
      toast({ tone: "error", message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={count === 0}
        title={count === 0 ? "Tick somebody in the table first" : undefined}
        style={sx("padding:0 14px;height:38px;display:inline-flex;align-items:center;border-radius:10px;font-size:13px;font-weight:700;white-space:nowrap;font-family:inherit;border:0;box-shadow:var(--sh)", {
          background: count === 0 ? "var(--surface-3)" : "var(--t1)",
          color: count === 0 ? "var(--t4)" : "#fff",
          cursor: count === 0 ? "default" : "pointer",
        })}
      >
        {count === 0 ? "Add to a requirement" : `Add ${count} to a requirement`}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add to a requirement"
          onClick={close}
          style={s("position:fixed;inset:0;background:rgba(17,19,24,.46);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:70px 16px 24px")}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={sx("width:100%;max-width:620px;max-height:calc(100vh - 110px);display:flex;flex-direction:column;border-radius:15px;overflow:hidden;box-shadow:var(--sh3)", { background: "var(--surface)" })}
          >
            <div style={s("padding:15px 18px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:12px")}>
              <div style={s("flex:1;min-width:0")}>
                <div style={s("font-size:14px;font-weight:800")}>
                  {outcome ? `Added to ${outcome.requirementCode}` : `Add ${count} to a requirement`}
                </div>
                <div style={s("font-size:11.5px;color:var(--t4);margin-top:3px;line-height:1.45")}>
                  {outcome
                    ? "Not everybody went in cleanly. Here is what happened to each one."
                    : "Only roles somebody is still working are listed. They are scored and ranked like anybody the matcher sourced — any order you arranged by hand is kept."}
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                style={sx("display:flex;border:0;background:transparent;cursor:pointer;padding:3px;flex:none", { color: "var(--t4)" })}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {outcome ? (
              <div style={s("flex:1;overflow:auto;padding:4px 0")}>
                <OutcomeList outcome={outcome} />
              </div>
            ) : (
              <>
                <div style={s("padding:11px 18px;border-bottom:1px solid var(--surface-3);display:flex;align-items:center;gap:8px")}>
                  <Search size={13} strokeWidth={2.2} style={{ color: "var(--t4)", flex: "none" }} />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return;
                      if (query) setQuery("");
                      else close();
                    }}
                    placeholder="Find a role by code, title or client"
                    style={s("flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:12.5px;font-family:inherit;color:var(--t1)")}
                  />
                </div>

                <div style={s("flex:1;overflow:auto")}>
                  {matches.length === 0 ? (
                    <div style={s("padding:28px 18px;text-align:center")}>
                      <div style={s("font-size:12.5px;font-weight:600")}>
                        {requirements.length === 0
                          ? "No role is open right now."
                          : "No open role matches that."}
                      </div>
                      <div style={s("font-size:11.5px;color:var(--t4);margin-top:5px;line-height:1.5")}>
                        {requirements.length === 0
                          ? "A role has to be posted and still being worked. A draft, a placed role or a closed one cannot take candidates."
                          : "Clear the search to see all of them."}
                      </div>
                    </div>
                  ) : matches.map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => submit(r)}
                      disabled={busy !== null}
                      style={sx("width:100%;display:flex;align-items:center;gap:12px;padding:11px 18px;border:0;border-bottom:1px solid var(--surface-3);background:var(--surface);text-align:left;font-family:inherit", {
                        cursor: busy ? "default" : "pointer",
                        opacity: busy && busy !== r.code ? 0.45 : 1,
                      })}
                    >
                      <div style={s("flex:1;min-width:0")}>
                        <div style={s("display:flex;align-items:center;gap:7px;min-width:0")}>
                          <span style={sx("font-size:10.5px;font-weight:700;color:var(--t4);flex:none", { fontFamily: TOKENS.mono })}>{r.code}</span>
                          <span style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</span>
                        </div>
                        <div style={s("font-size:11px;color:var(--t4);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          {r.clientName} · {r.positions} {r.positions === 1 ? "position" : "positions"} · {r.experienceBand} yrs · {r.budgetLabel} · {r.poolCount} already sourced
                        </div>
                      </div>
                      <span style={sx("padding:3px 8px;border-radius:999px;font-size:9.5px;font-weight:700;flex:none", { background: "var(--surface-3)", color: "var(--t4)", fontFamily: TOKENS.mono })}>
                        {r.stage.toUpperCase()}
                      </span>
                      {busy === r.code ? (
                        <Loader2 size={14} strokeWidth={2.4} style={{ color: "var(--brand)", flex: "none", animation: "tv-spin .8s linear infinite" }} />
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            )}

            {outcome ? (
              <div style={s("padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end")}>
                <button
                  type="button"
                  onClick={close}
                  style={sx("padding:0 14px;height:34px;display:inline-flex;align-items:center;border-radius:9px;font-size:12.5px;font-weight:700;border:0;cursor:pointer;font-family:inherit", { background: "var(--t1)", color: "#fff" })}
                >
                  Done
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- outcome */

function OutcomeList({ outcome }: { outcome: AddResult }) {
  const sections: Array<{ title: string; color: string; rows: Array<[string, string]> }> = [
    {
      title: "Added",
      color: "var(--ok)",
      rows: outcome.added.map((id) => [id, "in the pool, scored and ranked"] as [string, string]),
    },
    {
      title: "Added, but flagged",
      color: "var(--warn)",
      rows: outcome.flagged.map((f) =>
        [f.maskedId, FLAG_TEXT[f.eligibility] ?? f.eligibility] as [string, string]),
    },
    {
      title: "Already in this role",
      color: "var(--t4)",
      rows: outcome.alreadyThere.map((id) => [id, "nothing changed for them"] as [string, string]),
    },
    {
      title: "Not added",
      color: "var(--danger)",
      rows: outcome.refused.map((r) =>
        [r.maskedId, REFUSED_TEXT[r.reason] ?? r.reason] as [string, string]),
    },
  ].filter((sec) => sec.rows.length > 0);

  return (
    <>
      {sections.map((sec) => (
        <div key={sec.title} style={s("padding:8px 0")}>
          <div style={sx("padding:0 18px 4px;font-size:9px;font-weight:700;letter-spacing:.12em", { color: sec.color, fontFamily: TOKENS.mono })}>
            {sec.title.toUpperCase()} · {sec.rows.length}
          </div>
          {sec.rows.map(([id, text]) => (
            <div key={id} style={s("display:flex;align-items:baseline;gap:9px;padding:6px 18px")}>
              <span style={sx("font-size:10.5px;font-weight:700;flex:none;width:76px", { fontFamily: TOKENS.mono, color: "var(--t2)" })}>{id}</span>
              <span style={s("font-size:11.5px;line-height:1.45;color:var(--t2)")}>{text}</span>
            </div>
          ))}
        </div>
      ))}
      {outcome.flagged.length ? (
        <div style={s("margin:4px 18px 12px;padding:10px 12px;border-radius:10px;background:var(--warn-tint)")}>
          <div style={s("font-size:11.5px;line-height:1.5;color:var(--t2)")}>
            A flagged candidate is in the pool and carries the reason on their match, so the
            matching desk shows it rather than mixing them in silently. Nothing reaches the
            client until you send a shortlist.
          </div>
        </div>
      ) : null}
    </>
  );
}
