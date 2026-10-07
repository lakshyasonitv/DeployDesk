import { Shell, PageHeader, Scroll, Button, StatCard, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientEngagements } from "@/src/read-models/client";
import { formatPaiseShort } from "@/src/lib/money/paise";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";
import { EngagementsTable } from "./EngagementsTable";

/**
 * Client · People working.
 *
 * The client sees the rate IT pays. `engagements.vendor_rate_paise` is never selected by
 * the client read model, so no spread is reconstructible from this page.
 *
 * Each row opens a panel with everything the client is allowed to know about that
 * placement, and it is also where an extension is requested — see `EngagementsTable`.
 *
 * `getClientOverview` used to supply the two stat cards here. It is no longer called:
 * `getClientEngagements` already returns every row, so the counts and the monthly total
 * are derived from data this page has rather than fetched a second time.
 */
export const metadata = { title: "People working · DeployDesk" };

export default async function ClientEngagementsPage() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const [engagements, aside] = await Promise.all([
    getClientEngagements(session.orgId),
    ShellAside(session.orgId),
  ]);

  const totalPaise = engagements.reduce((a, e) => a + e.ratePaise, 0);
  const endingSoon = engagements.filter((e) => e.endingSoon).length;

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="engagements" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="People working"
        subtitle="Everyone currently working for you through Talentvibes. One contract and one invoice, with us — never with the supplier."
        /**
         * No page-level "Request an extension" button. An extension belongs to one
         * person, and a header button has no way to say which of five placements was
         * meant — it would either guess or open a chooser that the row click already is.
         * The control lives on the person, in the panel. (v2 SCREENS.md:96 puts it in the
         * header; this is a deliberate departure, recorded in the brain.)
         */
        actions={<Button href="/api/export?kind=client-engagements" download>Download statement</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
          <StatCard label="PEOPLE WORKING" value={engagements.length} sub="across your requirements" />
          <StatCard label="TOTAL PER MONTH" value={formatPaiseShort(totalPaise)} sub="the rate you pay Talentvibes" />
          <StatCard
            label="ENDING SOON"
            value={endingSoon}
            sub={endingSoon ? "within 45 days — open one to extend" : "nothing needs a decision"}
          />
          <StatCard label="CONTRACTING PARTY" value="Talentvibes" sub="one contract for everyone you hire" />
        </div>

        <div style={s("margin-top:16px")}>
          <EngagementsTable engagements={engagements} />
        </div>

        {engagements.length ? (
          <div style={s("margin-top:12px;display:flex;align-items:center;justify-content:flex-end;gap:12px")}>
            <span style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
              TOTAL PER MONTH
            </span>
            <span style={sx("font-size:15px;font-weight:800", { fontFamily: TOKENS.mono })}>
              {formatPaiseShort(totalPaise)}
            </span>
          </div>
        ) : null}

        <div style={s("margin-top:14px;background:var(--brand-tint);border:1px solid var(--brand-tint-2);border-radius:12px;padding:13px")}>
          <SectionLabel>HOW BILLING WORKS</SectionLabel>
          <div style={s("font-size:12px;color:var(--brand-h);line-height:1.6")}>
            Talentvibes invoices you at the agreed rate per resource, net 30, and contracts
            separately with each supplier. Supplier identity and supplier commercials are not part
            of your agreement — which is what keeps the exchange neutral for both sides.
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}
