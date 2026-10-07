"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon, Loader2, X } from "lucide-react";
import { s, sx, TOKENS } from "./style";
import type { Portal } from "./Shell";

/**
 * The sidebar search.
 *
 * This replaces a box that read "Search or jump to… ⌘K" and did nothing when clicked. Two
 * problems with that, and the product owner raised both: the control was dead, which v2
 * rule 4 forbids outright, and ⌘K is a keyboard shortcut the audience has to be taught —
 * their words were "what does that even mean". Senior staff who want a search box should
 * get a search box.
 *
 * So: no shortcut, no modal, no hint to decode. Type and the results appear underneath.
 *
 * Results are fetched from /api/search, which resolves the session for the portal and
 * scopes every query to the caller's organisation. **Masking is applied in the read model,
 * not here** — a client's results carry `TV-####` and a rate band, a vendor's carry its own
 * people's real names and its own rates, and this component renders whatever it is handed
 * without knowing which portal it is in. That is the point: a component that filtered
 * fields would be the "mask it in the UI" shape CLAUDE.md forbids.
 */

interface Hit {
  group: string;
  title: string;
  sub: string;
  href: string;
  code?: string;
}

/** Long enough that a keystroke does not fire a query, short enough to feel immediate. */
const DEBOUNCE_MS = 220;
const MIN_CHARS = 2;

/**
 * Empty-state suggestions, per portal.
 *
 * NOT exported, and NOT passed in as a prop. Both of those were bugs:
 *
 *  1. They started in `src/read-models/search.ts`. Shell imports Search, and Shell is
 *     imported by client components, so that dragged the Postgres driver into the browser
 *     bundle and the build failed on `Can't resolve 'fs'`.
 *  2. Moving them here and exporting them was worse, because it crashed at RUNTIME.
 *     This is a `"use client"` module, and **every export of a client module becomes a
 *     client reference when a server component imports it** — so `SEARCH_EXAMPLES[portal]`
 *     evaluated in Shell was `undefined`, arrived as `examples={undefined}`, and
 *     `examples.map(...)` threw. That line only runs in the empty state, so the app
 *     crashed on exactly the searches that found nothing.
 *
 * Keeping them private to this client component removes the boundary entirely.
 */
const SEARCH_EXAMPLES: Record<Portal, string[]> = {
  client: ["react", "bangalore", "REQ-2291"],
  vendor: ["java", "pune", "TV-4821"],
  ops: ["acme", "nimbus", "DUP-0148"],
};

export function Search({ portal }: { portal: Portal }) {
  const examples = SEARCH_EXAMPLES[portal];
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close when clicking away, which is the behaviour anyone expects of a dropdown.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setHits(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?portal=${portal}&q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error("search failed");
        const body = await res.json() as { hits: Hit[] };
        if (!cancelled) setHits(body.hits);
      } catch {
        // An empty result rather than an error state: a failed search should not be a
        // dialog in someone's way, and the next keystroke retries anyway.
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(t); };
  }, [query, portal]);

  // Preserve the read model's order, which groups by type.
  const groups: Array<[string, Hit[]]> = [];
  for (const h of hits ?? []) {
    const last = groups[groups.length - 1];
    if (last && last[0] === h.group) last[1].push(h);
    else groups.push([h.group, [h]]);
  }

  const showPanel = open && query.trim().length >= MIN_CHARS;

  return (
    <div ref={boxRef} style={s("position:relative;margin:0 12px 14px")}>
      <div style={s("display:flex;align-items:center;gap:8px;height:38px;padding:0 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px")}>
        <SearchIcon size={15} strokeWidth={1.9} style={{ color: "var(--t4)", flex: "none" }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search"
          aria-label="Search"
          style={s("flex:1;min-width:0;border:0;outline:none;background:transparent;font-size:13px;font-family:inherit;color:var(--t1)")}
        />
        {loading ? (
          <Loader2 size={14} strokeWidth={2} style={{ color: "var(--t4)", flex: "none", animation: "tv-spin .8s linear infinite" }} />
        ) : query ? (
          <button
            type="button"
            onClick={() => { setQuery(""); setHits(null); }}
            aria-label="Clear search"
            style={s("display:flex;border:0;background:transparent;cursor:pointer;padding:0;color:var(--t4);flex:none")}
          >
            <X size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div style={s("position:absolute;left:0;right:0;top:44px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--sh3);max-height:min(60vh,420px);overflow:auto;z-index:60;animation:tvin .14s ease-out")}>
          {hits === null || loading ? (
            <div style={s("padding:14px;font-size:12.5px;color:var(--t4)")}>Searching…</div>
          ) : hits.length === 0 ? (
            <div style={s("padding:14px")}>
              <div style={s("font-size:12.5px;color:var(--t2);font-weight:600")}>
                Nothing matches “{query.trim()}”.
              </div>
              <div style={s("font-size:11.5px;color:var(--t4);margin-top:6px;line-height:1.6")}>
                Try {examples.map((e, i) => (
                  <span key={e}>
                    {i > 0 ? (i === examples.length - 1 ? " or " : ", ") : ""}
                    <button
                      type="button"
                      onClick={() => setQuery(e)}
                      style={sx("border:0;background:transparent;padding:0;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700", { color: "var(--brand)" })}
                    >
                      {e}
                    </button>
                  </span>
                ))}.
              </div>
            </div>
          ) : (
            groups.map(([group, rows]) => (
              <div key={group}>
                <div style={s("padding:9px 13px 5px;font-size:10.5px;font-weight:700;letter-spacing:.08em;color:var(--t4);text-transform:uppercase")}>
                  {group}
                </div>
                {rows.map((h, i) => (
                  <Link
                    key={`${group}-${i}`}
                    href={h.href}
                    onClick={() => setOpen(false)}
                    style={s("display:block;padding:8px 13px;border-top:1px solid var(--border)")}
                  >
                    <div style={s("display:flex;align-items:baseline;gap:8px")}>
                      <span style={s("font-size:13px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                        {h.title}
                      </span>
                      {h.code && h.code !== h.title ? (
                        <span style={sx("font-size:11px;color:var(--t4);flex:none", { fontFamily: TOKENS.mono })}>
                          {h.code}
                        </span>
                      ) : null}
                    </div>
                    <div style={s("font-size:11.5px;color:var(--t3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {h.sub}
                    </div>
                  </Link>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
