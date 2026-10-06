import { Shell, PageHeader, Scroll, Button } from "@/src/lib/ui/Shell";
import { getDemoSession } from "@/src/lib/auth/session";
import { getOpsTalentPool } from "@/src/read-models/ops";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Talent pool — fully unmasked.
 *
 * Both the result count and the elapsed time are measured, not hardcoded: the design
 * advertises "62 results · 0.18s" and docs/ARCHITECTURE.md sets a p95 target of 400ms
 * at 10k profiles, so showing a real number keeps that target honest.
 */
export const metadata = { title: "Talent pool · Bench Exchange" };

const COLS = "158px 148px 1fr 58px 74px 108px 108px 96px 126px";

const FRESHNESS_PILL = {
  confirmed: { bg: "#e8f6ef", fg: "#0f7a4a" },
  expiring_soon: { bg: "#fff3e4", fg: "#b45309" },
  unconfirmed: { bg: "#fdecec", fg: "#b91c1c" },
} as const;

const CHIPS = [
  { label: "Skill: React", active: true },
  { label: "Exp: 5–8y", active: true },
  { label: "Score ≥ 75", active: true },
  { label: "Freshness: confirmed", active: true },
  { label: "City: any", active: false },
  { label: "Vendor: any", active: false },
  { label: "Vendor rate ≤ ₹1.6L", active: false },
];

function scoreColor(n: number | null) {
  if (n == null) return "#9aa0ab";
  return n >= 85 ? "#0f7a4a" : n >= 78 ? "#b45309" : "#8a8a96";
}

export default async function PoolPage() {
  await getDemoSession("ops");
  const [pool, aside] = await Promise.all([getOpsTalentPool({ limit: 60 }), OpsAside()]);
  const withScores = pool.results.filter((r) => r.score != null).length;

  return (
    <Shell portal="ops" activeKey="pool" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Talent pool"
        subtitle={`${pool.poolTotal} profiles across the exchange · unmasked · ${withScores} of the ${pool.resultCount} shown have a proctored score`}
        actions={<><Button>Save this view</Button><Button primary accent="#101014">Add to a requirement</Button></>}
      />

      <div style={s("padding:11px 26px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;flex:none")}>
        {CHIPS.map((c) => (
          <span key={c.label}
            style={sx("padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700", {
              background: c.active ? "#fff3e4" : "#fff",
              color: c.active ? "#b45309" : "#8a8a96",
              border: `1px solid ${c.active ? "#f0dcc0" : "#e8e8ee"}`,
            })}>
            {c.label}{c.active ? " ×" : ""}
          </span>
        ))}
        <span style={s("padding:4px 10px;border:1px dashed #d4d4de;border-radius:999px;font-size:11px;font-weight:600;color:#6b6b78")}>
          + Add filter
        </span>
        <span style={sx("margin-left:auto;font-size:10.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>
          {pool.resultCount} results · {pool.elapsedSeconds}s
        </span>
      </div>

      <div style={s("flex:1;overflow:auto")}>
        <div style={sx("display:grid;padding:9px 26px;background:#fafafc;border-bottom:1px solid #e8e8ee;position:sticky;top:0;z-index:2", { gridTemplateColumns: COLS, gap: "10px" })}>
          {["NAME", "SUPPLIER", "SKILLS", "EXP", "SCORE", "VENDOR RATE", "CLIENT RATE", "CITY", "FRESHNESS"].map((h) => (
            <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>{h}</div>
          ))}
        </div>

        {pool.results.map((r) => {
          const fp = FRESHNESS_PILL[r.freshnessState as keyof typeof FRESHNESS_PILL] ?? FRESHNESS_PILL.confirmed;
          const rel = Number(r.vendorReliability);
          return (
            <div key={r.maskedId} style={sx("display:grid;padding:10px 26px;border-bottom:1px solid #f1f1f5;align-items:center;background:#fff", { gridTemplateColumns: COLS, gap: "10px" })}>
              <div style={s("min-width:0")}>
                <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                <div style={sx("font-size:10px;color:#8a8a96;margin-top:2px", { fontFamily: TOKENS.mono })}>{r.maskedId}</div>
              </div>
              <div style={s("min-width:0")}>
                <div style={s("font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.vendorName}</div>
                <div style={s("display:flex;align-items:center;gap:5px;margin-top:2px")}>
                  <span style={sx("width:5px;height:5px;border-radius:50%", { background: rel >= 4 ? "#16a34a" : rel >= 3.5 ? "#c2410c" : "#b91c1c" })} />
                  <span style={s("font-size:10px;color:#8a8a96")}>rel {r.vendorReliability}</span>
                </div>
              </div>
              <div style={s("display:flex;flex-wrap:wrap;gap:3px;min-width:0")}>
                {r.skills.slice(0, 3).map((sk) => (
                  <span key={sk} style={s("padding:2px 6px;background:#f3f3f7;border-radius:4px;font-size:10px;font-weight:600;color:#4a4a58;white-space:nowrap")}>{sk}</span>
                ))}
              </div>
              <div style={s("font-size:11.5px;font-weight:600")}>{r.experienceLabel}</div>
              <div style={sx("font-size:12.5px;font-weight:800", { color: scoreColor(r.score) })}>
                {r.score ?? "—"}
              </div>
              <div style={sx("font-size:11.5px;font-weight:600", { fontFamily: TOKENS.mono })}>{r.vendorRateLabel}</div>
              <div style={sx("font-size:11.5px;font-weight:600;color:#6d3ff0", { fontFamily: TOKENS.mono })}>
                {/* Ops sees both sides. A client rate here is correct and ops-only. */}
                {proposedFor(r.vendorRateLabel)}
              </div>
              <div style={s("font-size:11.5px;color:#4a4a58")}>{r.city}</div>
              <div>
                <span style={sx("display:inline-block;padding:3px 8px;border-radius:999px;font-size:9.5px;font-weight:700", { background: fp.bg, color: fp.fg, fontFamily: TOKENS.mono })}>
                  {r.freshnessLabel}
                </span>
              </div>
            </div>
          );
        })}

        <div style={s("padding:14px 26px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
          <div style={s("font-size:11.5px;color:#8a8a96")}>
            Showing {pool.resultCount} of {pool.poolTotal} profiles on the exchange
          </div>
          <Button>Load more</Button>
        </div>
      </div>
    </Shell>
  );
}

/**
 * An indicative client rate for the pool view, at the target margin. The contracted
 * figure lives on an engagement and the proposed one on a match; this column exists so
 * a broker can eyeball pricing while searching, and it is ops-only.
 */
function proposedFor(vendorRateLabel: string): string {
  const paise = Number(vendorRateLabel.replace(/[^\d]/g, "")) * 100;
  if (!paise) return "—";
  const atTarget = Math.round(paise / (1 - 0.24) / 100_000) * 100_000;
  return `₹${Math.round(atTarget / 100).toLocaleString("en-IN")}`;
}
