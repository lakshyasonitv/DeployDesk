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

/** Design tokens from design_handoff_bench_exchange/README.md. */
export const TOKENS = {
  ink: "#101014",
  pageBg: "#f7f7f9",
  cardBg: "#ffffff",
  border: "#e8e8ee",
  borderSoft: "#eeeef3",
  muted: "#6b6b78",
  mutedSoft: "#8a8a96",
  sidebarBg: "#111114",
  sidebarBorder: "#26262c",
  sidebarText: "#a0a0ac",
  sidebarDim: "#6c6c78",
  sidebarActive: "#1e1e26",
  primary: "#6d3ff0",
  // Resolves to the self-hosted next/font face, with the literal name as a fallback for
  // anything rendered before the CSS variable is available.
  mono: "var(--font-mono), 'JetBrains Mono', monospace",
} as const;

export const ACCENT = { client: "#a78bfa", vendor: "#34d399", ops: "#fbbf24" } as const;

export const ACCENT_GRADIENT = {
  client: "linear-gradient(135deg,#8b5cf6,#6366f1)",
  vendor: "linear-gradient(135deg,#34d399,#0d9488)",
  ops: "linear-gradient(135deg,#fbbf24,#f97316)",
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

export const PORTAL_TAG = {
  client: "CLIENT PORTAL",
  vendor: "VENDOR PORTAL",
  ops: "OPS CONSOLE · INTERNAL",
} as const;

/** The five pipeline stages: key, label, dot, background, foreground. */
export const STAGES = [
  { key: "new", label: "NEW", color: "#9aa0ab", bg: "#f3f3f7", fg: "#4a4a58" },
  { key: "matching", label: "MATCHING", color: "#b45309", bg: "#fff3e4", fg: "#b45309" },
  { key: "shortlisted", label: "SHORTLISTED", color: "#6d3ff0", bg: "#f1ecff", fg: "#6d3ff0" },
  { key: "interviewing", label: "INTERVIEWING", color: "#1d4ed8", bg: "#e8eefc", fg: "#1d4ed8" },
  { key: "placed", label: "PLACED", color: "#0f7a4a", bg: "#e8f6ef", fg: "#0f7a4a" },
] as const;

export const SLA_COLOR = {
  ok: "#0f7a4a", warn: "#b45309", late: "#b91c1c", idle: "#8a8a96",
} as const;

/** Margin colour thresholds, shared so the API and UI cannot disagree. */
export const MARGIN_COLOR = {
  green: { bg: "#e8f6ef", fg: "#0f7a4a" },
  amber: { bg: "#fff3e4", fg: "#b45309" },
  red: { bg: "#fdecec", fg: "#b91c1c" },
} as const;

export function stageMeta(key: string) {
  return STAGES.find((x) => x.key === key) ?? STAGES[0];
}
