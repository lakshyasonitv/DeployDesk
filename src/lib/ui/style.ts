import type { CSSProperties } from "react";

/**
 * Parses a CSS declaration string into a React style object.
 *
 * The design handoff is high fidelity — every colour, size and spacing value is final —
 * and the prototype carries them as inline `style="..."` strings. This helper lets the
 * port copy those strings verbatim instead of hand-converting ~15 screens of inline
 * styles, which is both slow and a chance to drift off the spec on every line.
 *
 *   <div style={s("display:flex;gap:9px;background:#111114")} />
 *
 * Recorded as a demo-time shortcut in project-brain/02-decisions.md. The eventual move to
 * CSS modules or Tailwind is a mechanical find-and-replace against these same strings.
 *
 * Splitting on the FIRST colon matters: values like `linear-gradient(135deg,#8b5cf6,#6366f1)`
 * and `url(data:...)` contain colons and commas of their own.
 */

const cache = new Map<string, CSSProperties>();

export function s(css: string): CSSProperties {
  const hit = cache.get(css);
  if (hit) return hit;

  const out: Record<string, string | number> = {};
  for (const decl of splitDeclarations(css)) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop || !value) continue;
    out[toCamel(prop)] = value;
  }

  const frozen = out as CSSProperties;
  cache.set(css, frozen);
  return frozen;
}

/** Merge extra declarations onto a base string. Later wins, as in CSS. */
export function sx(...parts: Array<string | CSSProperties | false | null | undefined>): CSSProperties {
  const out: Record<string, unknown> = {};
  for (const p of parts) {
    if (!p) continue;
    Object.assign(out, typeof p === "string" ? s(p) : p);
  }
  return out as CSSProperties;
}

/** Semicolons inside parentheses are not declaration separators. */
function splitDeclarations(css: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      parts.push(css.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(css.slice(start));
  return parts;
}

/** background-color -> backgroundColor; -webkit-font-smoothing -> WebkitFontSmoothing */
function toCamel(prop: string): string {
  if (prop.startsWith("--")) return prop; // custom property, keep as-is
  const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return prop.startsWith("-") ? camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
}

/* ---------------------------------------------------------------- tokens */

/**
 * Design tokens from design_handoff_bench_exchange_v2/DESIGN_TOKENS.md.
 *
 * Every value is a CSS variable declared in app/globals.css, NOT a literal. That is what
 * makes the light/dark toggle work: nothing in the TypeScript knows which theme is
 * active, it just names a role and the stylesheet resolves it.
 *
 * Do not reintroduce a hex literal here. `--brand` is the one knob the handoff wants
 * turned (its #0b6ed9 is approximated from thinkvibes.com and needs confirming with the
 * brand team), and every tint derives from it through color-mix.
 */
export const TOKENS = {
  ink: "var(--t1)",
  pageBg: "var(--bg)",
  cardBg: "var(--surface)",
  border: "var(--border)",
  borderSoft: "var(--border)",
  muted: "var(--t3)",
  mutedSoft: "var(--t4)",
  sidebarBg: "var(--surface)",
  sidebarBorder: "var(--border)",
  sidebarText: "var(--t2)",
  sidebarDim: "var(--t4)",
  sidebarActive: "var(--brand-tint)",
  primary: "var(--brand)",
  // Resolves to the self-hosted next/font face, with the literal name as a fallback for
  // anything rendered before the CSS variable is available.
  mono: "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace",
} as const;

/**
 * v2 rule 3: "Colour only for meaning. Brand comes from --brand." The v1 design gave each
 * portal its own accent (violet / green / amber); v2 does not, so all three resolve to the
 * single brand colour. The per-portal shape is kept because pages pass `accent` through.
 */
export const ACCENT = { client: "var(--brand)", vendor: "var(--brand)", ops: "var(--brand)" } as const;

/** The logo tile is flat brand blue in v2, not a gradient. Kept for call-site shape. */
export const ACCENT_GRADIENT = {
  client: "var(--brand)",
  vendor: "var(--brand)",
  ops: "var(--brand)",
} as const;

/* ----------------------------------------------------------------- brand */

/**
 * The product name, in one place.
 *
 * `name` is the wordmark and is what goes in tight lockups (the 222px sidebar, where
 * the line beneath it is already spent on PORTAL_TAG). `full` is the complete lockup and
 * belongs anywhere there is room for it — the landing page and the browser title.
 *
 * Note the handoff disagrees: design_handoff_bench_exchange_v2/README.md specifies
 * "Bench Exchange" / "by Thinkvibes" in the sidebar. The name here is the one the product
 * owner asked for and it wins; see project-brain/02-decisions.md.
 */
export const BRAND = {
  name: "DeployDesk",
  by: "Talentvibes",
  full: "DeployDesk by Talentvibes",
} as const;

/** v2 sidebar group labels: HIRING / YOUR BENCH / BROKERING DESK. */
export const GROUP_LABEL = {
  client: "HIRING",
  vendor: "YOUR BENCH",
  ops: "BROKERING DESK",
} as const;

export const PORTAL_TAG = {
  client: "CLIENT PORTAL",
  vendor: "VENDOR PORTAL",
  ops: "OPS CONSOLE · INTERNAL",
} as const;

/** The five pipeline stages: key, label, dot, background, foreground. */
export const STAGES = [
  { key: "new", label: "NEW", color: "var(--t4)", bg: "var(--surface-3)", fg: "var(--t2)" },
  { key: "matching", label: "MATCHING", color: "var(--warn)", bg: "var(--warn-tint)", fg: "var(--warn)" },
  { key: "shortlisted", label: "SHORTLISTED", color: "var(--violet)", bg: "var(--violet-tint)", fg: "var(--violet)" },
  { key: "interviewing", label: "INTERVIEWING", color: "var(--info)", bg: "var(--info-tint)", fg: "var(--info)" },
  { key: "placed", label: "PLACED", color: "var(--ok)", bg: "var(--ok-tint)", fg: "var(--ok)" },
] as const;

export const SLA_COLOR = {
  ok: "var(--ok)", warn: "var(--warn)", late: "var(--danger)", idle: "var(--t4)",
} as const;

/** Margin colour thresholds, shared so the API and UI cannot disagree. */
export const MARGIN_COLOR = {
  green: { bg: "var(--ok-tint)", fg: "var(--ok)" },
  amber: { bg: "var(--warn-tint)", fg: "var(--warn)" },
  red: { bg: "var(--danger-tint)", fg: "var(--danger)" },
} as const;

export function stageMeta(key: string) {
  return STAGES.find((x) => x.key === key) ?? STAGES[0];
}
