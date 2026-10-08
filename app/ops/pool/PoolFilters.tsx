"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";
import type { PoolFilters as Filters } from "@/src/read-models/ops";

/**
 * The talent pool's filter chips, and saved views.
 *
 * Both were presentational. The chips were a hardcoded list rendered with `active: false`
 * and no filtering behind them, and "Save this view" had no handler while `saved_views` sat
 * seeded and unused since migration 0005.
 *
 * **Filters live in the URL.** That is what makes a saved view possible without a second
 * mechanism: a view is a set of query parameters, applying one is a navigation, and the
 * page is a server component with `force-dynamic` so it re-reads and re-queries on its own.
 * It also means a filtered pool can be pasted to a colleague, and the browser's back button
 * does what it looks like it does.
 *
 * **The options come from the data** (`getOpsPoolFacets`), never a literal. A chip that
 * offers a city nobody is in, or a skill not in the catalogue, is the same defect as the
 * hardcoded "Microservices" suggestion the create endpoint used to drop silently.
 */

const PARAM: Record<string, string> = {
  skills: "skills", experienceBand: "exp", minScore: "score",
  city: "city", supplier: "employer", maxRatePaise: "rate", freshness: "fresh",
};

const SCORE_OPTIONS = [70, 80, 85];
const RATE_OPTIONS: Array<[string, number]> = [
  ["Under ₹1.2L", 12_000_000], ["Under ₹1.6L", 16_000_000], ["Under ₹2L", 20_000_000],
];
const EXP_OPTIONS = ["0-3", "3-5", "5-8", "8+"] as const;
const FRESH_OPTIONS: Array<[string, string]> = [
  ["Confirmed", "confirmed"], ["Needs confirming", "expiring"], ["Unconfirmed", "unconfirmed"],
];

function chipStyle(on: boolean) {
  return sx("padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap", {
    background: on ? "var(--warn-tint)" : "var(--surface)",
    color: on ? "var(--warn)" : "var(--t4)",
    border: `1px solid ${on ? "var(--warn-tint)" : "var(--border)"}`,
  });
}

export function PoolFilters({
  current, facets, savedViews,
}: {
  current: Filters;
  facets: { cities: string[]; suppliers: string[]; skills: string[] };
  savedViews: Array<{ name: string; filters: Filters }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const [busy, setBusy] = useState(false);

  /** Rewrites the query string from a whole filter object. */
  function apply(next: Filters) {
    const q = new URLSearchParams();
    if (next.skills?.length) q.set(PARAM.skills, next.skills.join(","));
    if (next.experienceBand) q.set(PARAM.experienceBand, next.experienceBand);
    if (next.minScore) q.set(PARAM.minScore, String(next.minScore));
    if (next.city) q.set(PARAM.city, next.city);
    if (next.supplier) q.set(PARAM.supplier, next.supplier);
    if (next.maxRatePaise) q.set(PARAM.maxRatePaise, String(next.maxRatePaise));
    if (next.freshness) q.set(PARAM.freshness, next.freshness);
    if (next.search) q.set("q", next.search);
    setOpen(null);
    router.push(q.toString() ? `/ops/pool?${q}` : "/ops/pool", { scroll: false });
  }

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    apply({ ...current, [key]: value });

  const toggleSkill = (label: string) => {
    const have = current.skills ?? [];
    const next = have.includes(label) ? have.filter((x) => x !== label) : [...have, label];
    apply({ ...current, skills: next.length ? next : undefined });
  };

  const activeCount = [
    current.skills?.length, current.experienceBand, current.minScore, current.city,
    current.supplier, current.maxRatePaise, current.freshness, current.search,
  ].filter(Boolean).length;

  async function saveView() {
    const name = viewName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ops/pool/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, filters: current }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error === "no_filters"
          ? "Pick at least one filter before saving a view."
          : "Could not save that view.");
      }
      toast({
        message: `Saved "${name}". It is on this screen for you from now on.`,
        undo: async () => {
          const r = await fetch("/api/ops/pool/views", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!r.ok) throw new Error("delete failed");
          router.refresh();
        },
      });
      setNaming(false);
      setViewName("");
      router.refresh();
    } catch (e) {
      toast({ tone: "error", message: e instanceof Error ? e.message : "Could not save that view." });
    } finally {
      setBusy(false);
    }
  }

  async function forgetView(name: string) {
    const res = await fetch("/api/ops/pool/views", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      toast({ message: `Forgot "${name}".` });
      router.refresh();
    } else {
      toast({ tone: "error", message: `Could not forget "${name}".` });
    }
  }

  function Popover({ id, children }: { id: string; children: React.ReactNode }) {
    if (open !== id) return null;
    return (
      <div style={s("position:absolute;top:26px;left:0;z-index:20;background:var(--surface);border:1px solid var(--border-2);border-radius:10px;padding:9px;box-shadow:0 10px 30px rgba(16,16,20,.16);min-width:184px;max-height:280px;overflow:auto")}>
        {children}
      </div>
    );
  }

  function Option({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
    return (
      <button
        type="button"
        onClick={onPick}
        style={sx("display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:7px;font-size:11.5px;cursor:pointer;font-family:inherit", {
          background: on ? "var(--brand-tint)" : "transparent",
          color: on ? "var(--brand-h)" : "var(--t2)",
          fontWeight: on ? 700 : 500,
        })}
      >
        {on ? "✓ " : ""}{label}
      </button>
    );
  }

  /** A chip plus its popover, positioned relative to each other. */
  function Chip({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    const on = label !== "any";
    return (
      <span style={s("position:relative;display:inline-block")}>
        <button type="button" onClick={() => setOpen(open === id ? null : id)} style={chipStyle(on)}>
          {id === "skills" ? "Skill" : id === "exp" ? "Experience" : id === "score" ? "Test score"
            : id === "fresh" ? "Last confirmed" : id === "city" ? "City"
            : id === "employer" ? "Employer" : "Vendor rate"}: {label}
        </button>
        <Popover id={id}>{children}</Popover>
      </span>
    );
  }

  return (
    <div style={s("padding:11px 26px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:none")}>
      <Chip id="skills" label={current.skills?.length ? current.skills.join(" + ") : "any"}>
        {facets.skills.map((sk) => (
          <Option key={sk} label={sk} on={(current.skills ?? []).includes(sk)} onPick={() => toggleSkill(sk)} />
        ))}
      </Chip>

      <Chip id="exp" label={current.experienceBand ? `${current.experienceBand} yrs` : "any"}>
        <Option label="Any" on={!current.experienceBand} onPick={() => set("experienceBand", undefined)} />
        {EXP_OPTIONS.map((b) => (
          <Option key={b} label={`${b} years`} on={current.experienceBand === b} onPick={() => set("experienceBand", b)} />
        ))}
      </Chip>

      <Chip id="score" label={current.minScore ? `${current.minScore}+` : "any"}>
        <Option label="Any" on={!current.minScore} onPick={() => set("minScore", undefined)} />
        {SCORE_OPTIONS.map((n) => (
          <Option key={n} label={`${n} and above`} on={current.minScore === n} onPick={() => set("minScore", n)} />
        ))}
      </Chip>

      <Chip id="fresh" label={current.freshness ?? "any"}>
        <Option label="Any" on={!current.freshness} onPick={() => set("freshness", undefined)} />
        {FRESH_OPTIONS.map(([label, v]) => (
          <Option key={v} label={label} on={current.freshness === v}
            onPick={() => set("freshness", v as Filters["freshness"])} />
        ))}
      </Chip>

      <Chip id="city" label={current.city ?? "any"}>
        <Option label="Any city" on={!current.city} onPick={() => set("city", undefined)} />
        {facets.cities.map((c) => (
          <Option key={c} label={c} on={current.city === c} onPick={() => set("city", c)} />
        ))}
      </Chip>

      <Chip id="employer" label={current.supplier ?? "any"}>
        <Option label="Any employer" on={!current.supplier} onPick={() => set("supplier", undefined)} />
        {facets.suppliers.map((v) => (
          <Option key={v} label={v} on={current.supplier === v} onPick={() => set("supplier", v)} />
        ))}
      </Chip>

      <Chip id="rate" label={
        current.maxRatePaise
          ? RATE_OPTIONS.find(([, v]) => v === current.maxRatePaise)?.[0] ?? "capped"
          : "any"
      }>
        <Option label="Any rate" on={!current.maxRatePaise} onPick={() => set("maxRatePaise", undefined)} />
        {RATE_OPTIONS.map(([label, v]) => (
          <Option key={v} label={label} on={current.maxRatePaise === v} onPick={() => set("maxRatePaise", v)} />
        ))}
      </Chip>

      {activeCount ? (
        <button type="button" onClick={() => apply({})}
          style={s("padding:4px 10px;border:1px solid var(--border-2);border-radius:999px;font-size:11px;font-weight:700;background:transparent;cursor:pointer;color:var(--t3);font-family:inherit;white-space:nowrap")}>
          Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
        </button>
      ) : null}

      {/* ---------------------------------------------------- saved views ---- */}
      {savedViews.length ? (
        <span style={s("display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;padding-left:7px;margin-left:2px;border-left:1px solid var(--border)")}>
          {savedViews.map((v) => (
            <span key={v.name} style={s("display:inline-flex;align-items:center;gap:0")}>
              <button type="button" onClick={() => apply(v.filters)}
                title="Apply this view"
                style={s("padding:4px 9px;border:1px solid var(--brand-tint-2);border-right:0;border-radius:999px 0 0 999px;font-size:11px;font-weight:700;background:var(--brand-tint);color:var(--brand-h);cursor:pointer;font-family:inherit;white-space:nowrap")}>
                {v.name}
              </button>
              <button type="button" onClick={() => forgetView(v.name)}
                aria-label={`Forget ${v.name}`} title="Forget this view"
                style={s("padding:4px 8px;border:1px solid var(--brand-tint-2);border-radius:0 999px 999px 0;font-size:11px;font-weight:700;background:var(--brand-tint);color:var(--brand);cursor:pointer;font-family:inherit;line-height:1")}>
                ×
              </button>
            </span>
          ))}
        </span>
      ) : null}

      {naming ? (
        <span style={s("display:inline-flex;align-items:center;gap:5px")}>
          <input
            autoFocus
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveView(); if (e.key === "Escape") setNaming(false); }}
            placeholder="Name this view"
            style={s("padding:4px 9px;border:1px solid var(--border-2);border-radius:999px;font-size:11px;font-family:inherit;outline:none;width:150px")}
          />
          <button type="button" onClick={saveView} disabled={busy}
            style={sx("padding:4px 10px;border:0;border-radius:999px;font-size:11px;font-weight:700;background:var(--brand);color:#fff;font-family:inherit", { cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 })}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setNaming(false)}
            style={s("border:0;background:transparent;font-size:14px;color:var(--t4);cursor:pointer;line-height:1;font-family:inherit")}>
            ×
          </button>
        </span>
      ) : activeCount ? (
        <button type="button" onClick={() => setNaming(true)}
          style={s("padding:4px 10px;border:1px dashed var(--border-2);border-radius:999px;font-size:11px;font-weight:600;background:transparent;cursor:pointer;color:var(--t3);font-family:inherit;white-space:nowrap")}>
          + Save this view
        </button>
      ) : null}
    </div>
  );
}
