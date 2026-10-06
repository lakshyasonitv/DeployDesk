import { Shell, PageHeader, Scroll, Button, StatCard, Card, SectionLabel, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession } from "@/src/lib/auth/session";
import { getVendorOverview } from "@/src/read-models/vendor";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { VendorAside } from "./aside";

/**
 * Vendor · Dashboard.
 *
 * "Talentvibes hides the hiring company until placement" is the design's own copy, but
 * open question Q1 takes the safer default: client identity is NEVER shared, so there is
 * no reveal path anywhere in this portal. The pipeline card below shows stage and the
 * vendor's own rate, and nothing about the client.
 */
export const metadata = { title: "Overview · Bench Exchange" };

const PIPE_COLS = "100px 1fr 120px 130px 118px";

const STAGE_PILL: Record<string, { bg: string; fg: string }> = {
  "INTERVIEW R1": { bg: "#f1ecff", fg: "#6d3ff0" },
  "INTERVIEW R2": { bg: "#f1ecff", fg: "#6d3ff0" },
  "CLIENT SELECTED": { bg: "#e8f6ef", fg: "#0f7a4a" },
  SHORTLISTED: { bg: "#e8eefc", fg: "#1d4ed8" },
  PASSED: { bg: "#f3f3f7", fg: "#8a8a96" },
};

const FRESH_TILE = [
  { key: "Confirmed", bg: "#e8f6ef", fg: "#0f7a4a" },
  { key: "Expiring", bg: "#fff3e4", fg: "#b45309" },
  { key: "Unconfirmed", bg: "#fdecec", fg: "#b91c1c" },
];

export default async function VendorDashboard() {
  const session = await getDemoSession("vendor");
  const [o, aside] = await Promise.all([
    getVendorOverview(session.orgId, session.userName),
    VendorAside(session.orgId),
  ]);

  const idle = o.stats.onBench - o.stats.listed - o.stats.inProcess;
  const expiring = o.freshness.find((f) => f.label === "Expiring")?.n ?? 0;

  return (
    <Shell portal="vendor" user={{ name: session.userName, org: session.orgName }} activeKey="overview" asideTitle="FRESHNESS ALERTS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title={`${o.orgName} · bench`}
        subtitle={`Supplier ID ${o.vendorCode} · reliability score ${o.reliability}/5 · ${o.placements} placements to date`}
        actions={<>
          <Button href="/vendor/roster">Confirm availability ({expiring})</Button>
          <Button primary accent="#0d9488" href="/vendor/resources/new">Add bench resource</Button>
        </>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:1.15fr repeat(4,1fr);gap:12px")}>
          {/* utilisation — dark card */}
          <div style={s("background:#101014;border-radius:12px;padding:15px;color:#fff")}>
            <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
              BENCH UTILISATION
            </div>
            <div style={s("display:flex;align-items:baseline;gap:8px;margin-top:7px")}>
              <div style={s("font-size:27px;font-weight:800;letter-spacing:-1px;line-height:1")}>
                {o.stats.utilisationPct}%
              </div>
              <div style={s("font-size:11.5px;font-weight:700;color:#34d399")}>deployed + in process</div>
            </div>
            <div style={s("display:flex;height:7px;border-radius:4px;overflow:hidden;margin-top:11px;background:#26262c")}>
              <div style={sx("height:100%", { width: `${pct(o.stats.listed, o.stats.onBench)}%`, background: "#34d399" })} />
              <div style={sx("height:100%", { width: `${pct(o.stats.inProcess, o.stats.onBench)}%`, background: "#fbbf24" })} />
            </div>
            <div style={s("font-size:11px;color:#a0a0ac;margin-top:9px")}>
              {o.stats.listed} listed / {o.stats.inProcess} in process / {Math.max(0, idle)} idle
            </div>
            <div style={s("font-size:11px;color:#8a8a96;margin-top:7px;line-height:1.5")}>
              Listing idle profiles is the fastest way to recover bench cost.
            </div>
          </div>

          <StatCard label="PROFILES LISTED" value={o.stats.listed} sub={`of ${o.stats.onBench} on bench`} />
          <StatCard label="IN PROCESS" value={o.stats.inProcess} sub="shortlisted or interviewing" />
          <StatCard label="PLACEMENTS" value={o.placements} sub="to date, across the exchange" />
          <StatCard label="BILLED THIS MONTH" value={o.stats.billedThisMonthLabel} sub="your contracted rates" />
        </div>

        <div style={s("display:grid;grid-template-columns:1.5fr 1fr;gap:16px;margin-top:16px;align-items:start")}>
          {/* pipeline */}
          <div style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;overflow:hidden")}>
            <div style={s("padding:13px 15px;border-bottom:1px solid #f1f1f5")}>
              <SectionLabel>PIPELINE ON YOUR PROFILES</SectionLabel>
              <div style={s("font-size:11px;color:#8a8a96")}>
                Talentvibes contracts with the client directly; client identity is not shared.
              </div>
            </div>
            <div style={sx("display:grid;padding:8px 15px;background:#fafafc;border-bottom:1px solid #e8e8ee", { gridTemplateColumns: PIPE_COLS, gap: "10px" })}>
              {["RESOURCE", "SKILLS", "YOUR RATE", "STAGE", "UPDATED"].map((h) => (
                <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>{h}</div>
              ))}
            </div>
            {o.pipeline.map((p) => {
              const pill = STAGE_PILL[p.stageLabel] ?? { bg: "#f3f3f7", fg: "#4a4a58" };
              return (
                <div key={p.maskedId} style={sx("display:grid;padding:10px 15px;border-bottom:1px solid #f1f1f5;align-items:center", { gridTemplateColumns: PIPE_COLS, gap: "10px" })}>
                  <div>
                    <div style={sx("font-size:11px;font-weight:700", { fontFamily: TOKENS.mono })}>{p.maskedId}</div>
                    <div style={s("font-size:10.5px;color:#8a8a96;margin-top:2px")}>{p.displayName}</div>
                  </div>
                  <div style={s("display:flex;flex-wrap:wrap;gap:3px;min-width:0")}>
                    {p.skills.slice(0, 3).map((sk) => (
                      <span key={sk} style={s("padding:2px 6px;background:#f3f3f7;border-radius:4px;font-size:9.5px;font-weight:600;color:#4a4a58;white-space:nowrap")}>
                        {sk}
                      </span>
                    ))}
                  </div>
                  <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>{p.rateLabel}</div>
                  <div>
                    <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.07em", { background: pill.bg, color: pill.fg, fontFamily: TOKENS.mono })}>
                      {p.stageLabel}
                    </span>
                  </div>
                  <div style={s("font-size:10.5px;color:#8a8a96")}>{p.updatedAgo}</div>
                </div>
              );
            })}
            {o.pipeline.length === 0 ? (
              <div style={s("padding:26px;text-align:center;color:#8a8a96;font-size:12.5px")}>
                None of your profiles are in a client process yet.
              </div>
            ) : null}
          </div>

          {/* right rail */}
          <div style={s("display:flex;flex-direction:column;gap:14px")}>
            <div style={s("background:#fff;border:1px solid #f7dcae;border-radius:12px;padding:13px")}>
              <div style={s("display:flex;align-items:center;justify-content:space-between;margin-bottom:8px")}>
                <SectionLabel>AVAILABILITY FRESHNESS</SectionLabel>
                <Pill bg="#fff3e4" fg="#b45309">ACTION NEEDED</Pill>
              </div>
              <div style={s("font-size:11.5px;color:#4a4a58;line-height:1.55")}>
                Profiles unconfirmed for 14 days drop out of matching. Confirming takes one click
                and lifts your ranking.
              </div>
              <div style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:11px")}>
                {FRESH_TILE.map((t) => {
                  const n = o.freshness.find((f) => f.label === t.key)?.n ?? 0;
                  return (
                    <div key={t.key} style={sx("border-radius:9px;padding:9px;text-align:center", { background: t.bg })}>
                      <div style={sx("font-size:17px;font-weight:800;line-height:1", { color: t.fg })}>{n}</div>
                      <div style={sx("font-size:9px;font-weight:700;margin-top:3px", { color: t.fg })}>{t.key}</div>
                    </div>
                  );
                })}
              </div>
              <a href="/vendor/roster"
                style={s("display:block;margin-top:10px;padding:9px;border-radius:8px;background:#0f7a4a;color:#fff;font-size:12px;font-weight:700;text-align:center")}>
                Confirm all {expiring} expiring
              </a>
            </div>

            <Card pad="13px">
              <SectionLabel>ASSESSMENT THROUGHPUT</SectionLabel>
              <div style={s("font-size:11.5px;color:#4a4a58;line-height:1.55")}>
                Scored profiles are shortlisted far more often. Scores are set by the proctoring
                provider — you cannot edit them, and neither can a client.
              </div>
              <a href="/vendor/assessments"
                style={s("display:inline-block;font-size:11.5px;font-weight:700;color:#0d9488;margin-top:9px")}>
                Review assessments →
              </a>
            </Card>
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}
