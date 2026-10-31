import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, StatCard, Card, SectionLabel, Pill, HeadCell, EmptyState } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
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
export const metadata = { title: "Overview · DeployDesk" };

// The flexible column has a floor: as a bare 1fr it collapsed to 0px on narrower screens.
const PIPE_COLS = "92px minmax(120px, 1fr) 112px 118px 76px";

const STAGE_PILL: Record<string, { bg: string; fg: string }> = {
  "INTERVIEW R1": { bg: "var(--brand-tint)", fg: "var(--brand)" },
  "INTERVIEW R2": { bg: "var(--brand-tint)", fg: "var(--brand)" },
  "CLIENT SELECTED": { bg: "var(--ok-tint)", fg: "var(--ok)" },
  SHORTLISTED: { bg: "var(--info-tint)", fg: "var(--info)" },
  PASSED: { bg: "var(--surface-3)", fg: "var(--t4)" },
};

const FRESH_TILE = [
  { key: "Confirmed", bg: "var(--ok-tint)", fg: "var(--ok)" },
  { key: "Expiring", bg: "var(--warn-tint)", fg: "var(--warn)" },
  { key: "Unconfirmed", bg: "var(--danger-tint)", fg: "var(--danger)" },
];

export default async function VendorDashboard() {
  const session = await getDemoSession("vendor");
  const nav = await getShellNav(session);
  const [o, aside] = await Promise.all([
    getVendorOverview(session.orgId, session.userName),
    VendorAside(session.orgId),
  ]);

  const idle = o.stats.onBench - o.stats.listed - o.stats.inProcess;

  return (
    <Shell portal="vendor" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="overview" asideTitle="NEEDS CONFIRMING" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Your bench"
        subtitle={`${o.orgName} · supplier ${o.vendorCode} · reliability ${o.reliability} of 5 · ${o.placements} placements to date`}
        actions={<>
          {/* A link, so it says where it goes. "Confirm availability (4)" confirmed nothing,
              and its 4 (expiring) disagreed with the roster's own 7 (expiring + unconfirmed). */}
          <Button href="/vendor/roster">Go to roster</Button>
          <Button primary href="/vendor/resources/new">Add people</Button>
        </>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(198px,1fr));gap:12px")}>
          {/* utilisation — dark card */}
          <div style={s("background:var(--t1);border-radius:12px;padding:15px;color:var(--surface)")}>
            <div style={sx("font-size:var(--fs-1);font-weight:700;letter-spacing:.12em;opacity:.7", { fontFamily: TOKENS.mono })}>
              BENCH UTILISATION
            </div>
            <div style={s("display:flex;align-items:baseline;gap:8px;margin-top:7px")}>
              <div style={s("font-size:27px;font-weight:800;letter-spacing:-1px;line-height:1")}>
                {o.stats.utilisationPct}%
              </div>
              <div style={s("font-size:var(--fs-2);font-weight:600;opacity:.75")}>listed + in process</div>
            </div>
            <div style={s("display:flex;height:7px;border-radius:4px;overflow:hidden;margin-top:11px;background:var(--border)")}>
              <div style={sx("height:100%", { width: `${pct(o.stats.listed, o.stats.onBench)}%`, background: "var(--brand)" })} />
              <div style={sx("height:100%", { width: `${pct(o.stats.inProcess, o.stats.onBench)}%`, background: "var(--violet)" })} />
            </div>
            <div style={s("font-size:var(--fs-1);opacity:.85;margin-top:9px")}>
              {o.stats.listed} listed / {o.stats.inProcess} in process / {Math.max(0, idle)} idle
            </div>
            <div style={s("font-size:var(--fs-1);opacity:.7;margin-top:7px;line-height:1.5")}>
              Listing idle profiles is the fastest way to recover bench cost.
            </div>
          </div>

          <StatCard label="PROFILES LISTED" value={o.stats.listed} sub={`of ${o.stats.onBench} on bench`} />
          <StatCard label="IN PROCESS" value={o.stats.inProcess} sub="shortlisted or interviewing" />
          <StatCard label="PLACEMENTS" value={o.placements} sub="yours, to date" />
          <StatCard label="BILLED THIS MONTH" value={o.stats.billedThisMonthLabel} sub="payable to you this month" />
        </div>

        <div style={s("display:grid;grid-template-columns:1.5fr 1fr;gap:16px;margin-top:16px;align-items:start")}>
          {/* pipeline */}
          <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow-x:auto")}>
            <div style={s("padding:13px 15px;border-bottom:1px solid var(--surface-3)")}>
              <SectionLabel>PIPELINE ON YOUR PROFILES</SectionLabel>
              <div style={s("font-size:var(--fs-1);color:var(--t4)")}>
                Talentvibes contracts with the client directly; client identity is not shared.
              </div>
            </div>
            <div style={sx("display:grid;padding:8px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: PIPE_COLS, gap: "10px" })}>
              {["REFERENCE", "SKILLS", "YOUR MONTHLY RATE", "STAGE", "UPDATED"].map((h) => (
                <HeadCell key={h}>{h}</HeadCell>
              ))}
            </div>
            {o.pipeline.map((p) => {
              const pill = STAGE_PILL[p.stageLabel] ?? { bg: "var(--surface-3)", fg: "var(--t2)" };
              return (
                <div key={p.maskedId} style={sx("display:grid;padding:10px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: PIPE_COLS, gap: "10px" })}>
                  <div>
                    <div style={sx("font-size:var(--fs-1);font-weight:700", { fontFamily: TOKENS.mono })}>{p.maskedId}</div>
                    <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:2px")}>{p.displayName}</div>
                  </div>
                  <div style={s("display:flex;flex-wrap:wrap;gap:3px;min-width:0")}>
                    {p.skills.slice(0, 3).map((sk) => (
                      <span key={sk} style={s("padding:2px 6px;background:var(--surface-3);border-radius:4px;font-size:var(--fs-1);font-weight:600;color:var(--t2);white-space:nowrap")}>
                        {sk}
                      </span>
                    ))}
                  </div>
                  <div style={sx("text-align:right;padding-right:8px;font-size:var(--fs-2);font-weight:700", { fontFamily: TOKENS.mono })}>{p.rateLabel}</div>
                  <div>
                    <Pill bg={pill.bg} fg={pill.fg}>{p.stageLabel}</Pill>
                  </div>
                  <div style={s("font-size:var(--fs-1);color:var(--t4)")}>{p.updatedAgo}</div>
                </div>
              );
            })}
            {o.pipeline.length === 0 ? (
              <EmptyState inline title="None of your profiles are in a client process yet" />
            ) : null}
          </div>

          {/* right rail */}
          <div style={s("display:flex;flex-direction:column;gap:14px")}>
            <div style={s("background:var(--surface);border:1px solid var(--warn-tint);border-radius:16px;padding:13px")}>
              <div style={s("display:flex;align-items:center;justify-content:space-between;margin-bottom:8px")}>
                <SectionLabel>LAST CONFIRMED</SectionLabel>
                <Pill bg="var(--warn-tint)" fg="var(--warn)">ACTION NEEDED</Pill>
              </div>
              <div style={s("font-size:var(--fs-2);color:var(--t2);line-height:1.55")}>
                Profiles unconfirmed for 14 days drop out of matching. Confirming takes one click
                and lifts your ranking.
              </div>
              <div style={s("display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:11px")}>
                {FRESH_TILE.map((t) => {
                  const n = o.freshness.find((f) => f.label === t.key)?.n ?? 0;
                  return (
                    <div key={t.key} style={sx("border-radius:9px;padding:9px;text-align:center", { background: t.bg })}>
                      <div style={sx("font-size:17px;font-weight:800;line-height:1", { color: t.fg })}>{n}</div>
                      <div style={sx("font-size:var(--fs-1);font-weight:700;margin-top:3px", { color: t.fg })}>{t.key}</div>
                    </div>
                  );
                })}
              </div>
              {/* It is a link, so it says where it goes: "Confirm all N" confirmed nothing, and its
                  N disagreed with the roster's own button (expiring + unconfirmed). */}
              <Link href="/vendor/roster"
                style={s("display:block;margin-top:10px;padding:9px;border-radius:8px;background:var(--ok);color:var(--surface);font-size:var(--fs-3);font-weight:700;text-align:center")}>
                Confirm on your roster
              </Link>
            </div>

            <Card pad="13px">
              <SectionLabel>ASSESSMENT THROUGHPUT</SectionLabel>
              <div style={s("font-size:var(--fs-2);color:var(--t2);line-height:1.55")}>
                Talentvibes shortlists scored profiles far more often. The proctoring provider sets
                the scores. You cannot edit them, and neither can a client.
              </div>
              <Link href="/vendor/assessments"
                style={s("display:inline-block;font-size:var(--fs-2);font-weight:700;color:var(--teal-ink);margin-top:9px")}>
                Review skill tests →
              </Link>
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
