import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel, HeadCell, EmptyState, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getVendorEarnings } from "@/src/read-models/vendor";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { VendorAside } from "../aside";
import { istFormat } from "@/src/lib/derived";

/**
 * Vendor · Earnings — own rate only.
 *
 * The read model behind this page selects from invoices filtered to
 * direction = 'payable' and from engagements.vendor_rate_paise. It never selects
 * client_rate_paise, so no spread is reconstructible from anything on this screen.
 *
 * No client rate, client name or margin may appear anywhere in this portal.
 */
export const metadata = { title: "Your earnings · DeployDesk" };

// The flexible column has a floor: as a bare 1fr it collapsed to 0px on narrower screens.
const COLS = "168px minmax(140px, 1fr) 96px 120px 120px 130px";

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  BILLED: { bg: "var(--ok-tint)", fg: "var(--ok)" },
  "PRO-RATA": { bg: "var(--info-tint)", fg: "var(--info)" },
  "NOT BILLED": { bg: "var(--surface-3)", fg: "var(--t3)" },
};

export default async function VendorEarningsPage() {
  const session = await getDemoSession("vendor");
  const nav = await getShellNav(session);
  const [e, aside] = await Promise.all([
    getVendorEarnings(session.orgId),
    VendorAside(session.orgId),
  ]);

  const ending = e.rows.filter((r) => r.status === "PRO-RATA").length;

  return (
    <Shell portal="vendor" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="earnings" asideTitle="NEEDS CONFIRMING" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Your earnings"
        subtitle="Your contracted rate per placement. Talentvibes contracts separately with the client."
        // No "Raise invoice": it did nothing, and there is no billing integration behind it.
        actions={<Button href="/api/export?kind=vendor-earnings" download>Download statement</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(198px,1fr));gap:12px")}>
          <StatCard label="BILLED THIS MONTH" value={e.stats.billedThisMonthLabel}
            sub={`${e.stats.activePlacements} active placements`} />
          <StatCard label="RUN-RATE · MONTHLY" value={e.stats.runRateLabel} sub="at your contracted rates" />
          {/* Your own placements — "across all our suppliers" was wrong under your numbers. */}
          <StatCard label="ACTIVE PLACEMENTS" value={e.stats.activePlacements} sub="yours, working now" />
          {/* Invoices, counted — this was the number of placements, with an invented "net 30". */}
          <StatCard label="INVOICES RAISED" value={e.stats.invoicesThisMonth} sub="this month" />
        </div>

        <div style={s("margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow-x:auto")}>
          <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["NAME", "ROLE", "WORKING SINCE", "YOUR MONTHLY RATE", "BILLED THIS MONTH", "STATUS"].map((h) => (
              <HeadCell key={h}>{h}</HeadCell>
            ))}
          </div>
          {e.rows.map((r) => {
            const pill = STATUS_PILL[r.status] ?? STATUS_PILL.BILLED;
            return (
              <div key={r.maskedId + r.since} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={s("min-width:0")}>
                  <div style={s("font-size:var(--fs-3);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.fullName}</div>
                  <div style={sx("font-size:var(--fs-1);color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>{r.maskedId}</div>
                </div>
                <div style={s("font-size:var(--fs-3);color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
                <div style={s("font-size:var(--fs-1);color:var(--t3)")}>{r.since ? fmt(r.since) : "—"}</div>
                <div style={sx("text-align:right;padding-right:8px;font-size:var(--fs-2);font-weight:700", { fontFamily: TOKENS.mono })}>{r.rateLabel}</div>
                <div style={sx("text-align:right;padding-right:8px;font-size:var(--fs-2);font-weight:600", { fontFamily: TOKENS.mono })}>{r.monthLabel}</div>
                <div>
                  <Pill bg={pill.bg} fg={pill.fg}>{r.status}</Pill>
                </div>
              </div>
            );
          })}
          {e.rows.length === 0 ? (
            <EmptyState inline title="No placements billed yet" />
          ) : null}
          <div style={s("padding:12px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--surface-2)")}>
            <div style={s("font-size:var(--fs-2);color:var(--t4)")}>
              {e.stats.activePlacements} active placements
              {ending ? ` · ${ending} billed pro-rata this month` : ""}
            </div>
            <div style={sx("font-size:20px;font-weight:800", { fontFamily: TOKENS.mono })}>
              TOTAL DUE {e.stats.totalDueLabel}
            </div>
          </div>
        </div>

        <div style={s("margin-top:14px;background:var(--teal-tint);border:1px solid var(--ok-tint);border-radius:12px;padding:13px")}>
          <SectionLabel>WHY YOU DO NOT SEE THE CLIENT</SectionLabel>
          <div style={s("font-size:var(--fs-3);color:var(--teal-ink);line-height:1.6")}>
            {e.disclosure} Client identity, client rate and margin are not shared with suppliers,
            and your rate is not shared with clients. That keeps the exchange neutral for both
            sides.
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}

function fmt(iso: string): string {
  return istFormat(iso, { day: "numeric", month: "short" });
}
