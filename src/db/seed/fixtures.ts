import fixtures from "./prototype-fixtures.json";

/**
 * Typed access to the data extracted from the design prototype
 * (design_handoff_bench_exchange/Talentvibes Bench Exchange.dc.html).
 *
 * The prototype is the source of truth for fixture content per docs/SEED-DATA.md.
 * The JSON is generated, not hand-written — see src/db/seed/README.md.
 */

export interface PoolCandidate {
  id: string;            // masked id, TV-####
  name: string;
  vendor: string;        // ops pools are authoritative for vendor attribution
  exp: string;           // "6.2y"
  rate: string;          // vendor rate, "₹1.38L"
  match: number;         // the prototype's own score — NOT seeded, see ADR-011
  note: string;          // reason line
  r: number[];           // [skill, test, exp_fit, rate, freshness, vendor]
  city: string;
  notice: string;
  score: string;         // "88 · 09 Aug" | "Not started" | "Expired"
  fresh: string;         // "Confirmed 2d" | "Expiring 11d" | "Unconfirmed 26d"
  rel: string;           // "4.6 / 5"
  crate: string;         // proposed client rate
  margin: string;        // derived at read time, never stored
  last: string;          // last-project note, ops-facing
}

export interface Requirement {
  id: string;            // REQ-####
  role: string;
  client: string;
  qty: number;
  skills: string[];
  value: string;
  age: string;           // "4d", "2h" — offset from SEED_NOW
  owner: string;         // "P. Nair"
  stage0: string;
  sla: string;
  slaKind: "ok" | "warn" | "late" | "idle";
  budget: string;        // "₹1.30–1.70L"
  start: string;
  expBand: string;       // "5–8 years"
  loc: string;           // "Bangalore / hybrid"
  pool: "A" | "B" | "C" | "D";
  note: string;          // client note — CLIENT + OPS ONLY
  sourced: number;
}

export interface ShortlistCandidate {
  id: string;
  name: string;
  vendor: string;
  city: string;
  skills: string[];
  exp: string;
  score: number;
  rate: string;          // the prototype's leaky band — NOT used, see ADR-004
  clientRate: string;
  avail: string;
  attempt: string;       // "attempt 1"
  testedOn: string;      // "tested 09 Aug"
  fresh: string;
  /** The four section bars: Coding, DSA, System design, Communication. */
  bars?: Array<{ label: string; short: string; v: number; w: string }>;
}

const f = fixtures as unknown as {
  cands: ShortlistCandidate[];
  POOLS: Record<"A" | "B" | "C" | "D", PoolCandidate[]>;
  REQS: Requirement[];
  screens: Record<string, Array<Record<string, unknown>>>;
};

export const POOLS = f.POOLS;
export const REQS = f.REQS;
export const SHORTLIST_CANDS = f.cands;
export const SCREENS = f.screens;

/** Every candidate across all four pools, deduplicated by masked id. */
export const ALL_POOL_CANDIDATES: PoolCandidate[] = (() => {
  const seen = new Map<string, PoolCandidate>();
  for (const pool of Object.values(POOLS)) {
    for (const c of pool) if (!seen.has(c.id)) seen.set(c.id, c);
  }
  return [...seen.values()];
})();

/** Which pool(s) a masked id appears in. */
export const POOL_OF: Record<string, Array<"A" | "B" | "C" | "D">> = (() => {
  const out: Record<string, Array<"A" | "B" | "C" | "D">> = {};
  for (const [key, pool] of Object.entries(POOLS) as Array<["A" | "B" | "C" | "D", PoolCandidate[]]>) {
    for (const c of pool) (out[c.id] ??= []).push(key);
  }
  return out;
})();
