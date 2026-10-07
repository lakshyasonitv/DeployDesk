import { Shell, PageHeader, Scroll, StatCard, SectionLabel, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsOrgDirectory } from "@/src/read-models/ops";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Organisations. OPS ONLY, and more sharply so than the rest of the console.
 *
 * Three things on this screen would each be a masking breach in another portal:
 *
 *   - the dual-role badge. Telling a client that its supplier also hires, or a vendor that
 *     its buyer also supplies, narrows the counterparty to a handful of companies.
 *   - "Billed as client" beside "Paid as supplier". For a dual-role organisation those two
 *     figures ARE the spread. This is the one screen in the product where they may appear
 *     together, because the audience is the broker — and it is also why such orgs are put
 *     on a flat declared fee, so there is no hidden spread left to infer.
 *   - the block list and the probing flag. A block is a commercial judgement about a
 *     counterparty; a probing flag is close to an accusation. Neither party sees either.
 *
 * Nothing here is editable yet. The brief asks for controls over capabilities, group, fee
 * model and block list; writing any of them has to go through an audited service (working
 * agreement 5: every change to a stage, rate, shortlist or resolution writes an audit
 * row), so this ships as the read view first.
 */
export const metadata = { title: "Organisations · DeployDesk" };

const COLS = "1fr 104px 124px 150px 112px 112px 112px";

export default async function OrganisationsPage() {
  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);
  const [orgs, aside] = await Promise.all([getOpsOrgDirectory(), OpsAside()]);

  const dualRole = orgs.filter((o) => o.isDualRole);
  const grouped = orgs.filter((o) => o.groupName);
  const blocked = orgs.filter((o) => o.blockedWith.length);
  const probing = orgs.filter((o) => o.isProbingSuspect);

  return (
    <Shell
      portal="ops"
      identities={nav.identities}
      workspaces={nav.workspaces}
      user={{ name: session.userName, org: session.orgName }}
      activeKey="organisations"
      asideTitle="TODAY'S QUEUE"
      asideItems={aside.items}
      badges={aside.badges}
    >
      <PageHeader
        title="Organisations"
        subtitle="What every company can do, who it is related to, and what it is worth · Talentvibes only"
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(198px,1fr));gap:14px")}>
          <StatCard label="COMPANIES" value={orgs.length} sub={`${orgs.filter((o) => o.canSupply).length} supply · ${orgs.filter((o) => o.canHire).length} hire`} />
          <StatCard label="DUAL ROLE" value={dualRole.length} sub={dualRole.map((o) => o.name).join(", ") || "none"} />
          <StatCard label="DECLARED GROUPS" value={grouped.length ? grouped.length / 2 : 0} sub={grouped.length ? `${grouped[0].groupName} · self-dealing blocked` : "none declared"} />
          <StatCard label="BLOCK PAIRS" value={blocked.length ? blocked.length / 2 : 0} sub={blocked.length ? "hidden from each other both ways" : "none"} />
        </div>

        {/* ---------------- the dual-role callout ---------------- */}
        {dualRole.length ? (
          <div style={s("margin-top:16px;background:var(--violet-tint);border:1px solid var(--violet-tint);border-radius:14px;padding:16px")}>
            <div style={s("display:flex;align-items:center;gap:8px;margin-bottom:8px")}>
              <span style={sx("font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--violet);border:1px solid var(--violet);border-radius:4px;padding:1px 5px", { fontFamily: TOKENS.mono })}>
                OPS ONLY
              </span>
              <div style={s("font-size:13px;font-weight:700;color:var(--violet)")}>
                {dualRole.length === 1 ? "One organisation sits on both sides" : `${dualRole.length} organisations sit on both sides`}
              </div>
            </div>
            {dualRole.map((o) => (
              <div key={o.orgId} style={s("font-size:12.5px;color:var(--t2);line-height:1.6")}>
                <strong>{o.name}</strong> has {o.benchCount} on its own bench and {o.openRequirements} open{" "}
                {o.openRequirements === 1 ? "role" : "roles"}. On <strong>{o.feeModelLabel.toLowerCase()}</strong>,
                so the spread is declared rather than inferable — and its own people are
                refused as candidates for its own roles.
              </div>
            ))}
          </div>
        ) : null}

        <div style={s("margin-top:18px")}>
          <SectionLabel>Every organisation</SectionLabel>
        </div>

        {/* Dense table: scrolls horizontally inside its card, header and rows sharing a
            min-width so they stay aligned (v2 README rule 5). */}
        <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh);overflow:hidden")}>
          <div style={s("overflow-x:auto")}>
            <div style={sx("min-width:940px")}>
              <div style={sx(`display:grid;grid-template-columns:${COLS};gap:10px;padding:11px 18px;background:var(--surface-2);border-bottom:1px solid var(--border)`)}>
                {["Organisation", "Role", "Fee model", "Group / blocks", "Bench", "Billed as client", "Paid as supplier"].map((h, i) => (
                  <div key={h} style={sx("font-size:11.5px;font-weight:700;letter-spacing:.04em;color:var(--t3);text-transform:uppercase", { textAlign: i >= 4 ? "right" : "left" })}>
                    {h}
                  </div>
                ))}
              </div>

              {orgs.map((o, i) => (
                <div
                  key={o.orgId}
                  style={sx(`display:grid;grid-template-columns:${COLS};gap:10px;padding:13px 18px;align-items:center`, {
                    borderBottom: i < orgs.length - 1 ? "1px solid var(--border)" : "none",
                  })}
                >
                  <div style={s("min-width:0")}>
                    <div style={s("font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {o.name}
                    </div>
                    <div style={sx("font-size:11.5px;color:var(--t4)", { fontFamily: TOKENS.mono })}>
                      {o.publicCode ?? "—"}
                    </div>
                  </div>

                  <div>
                    {o.isDualRole ? (
                      <Pill bg="var(--violet-tint)" fg="var(--violet)">BOTH SIDES</Pill>
                    ) : (
                      <span style={s("font-size:12.5px;color:var(--t2)")}>{o.roleLabel}</span>
                    )}
                  </div>

                  <div style={s("font-size:12.5px;color:var(--t2)")}>
                    {o.feeModel === "flat_declared_fee" ? (
                      <Pill bg="var(--ok-tint)" fg="var(--ok)">DECLARED FEE</Pill>
                    ) : o.feeModelLabel}
                  </div>

                  <div style={s("min-width:0;display:flex;flex-direction:column;gap:3px")}>
                    {o.groupName ? (
                      <div style={s("font-size:11.5px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                        {o.groupName} · with {o.groupSiblings.join(", ") || "—"}
                      </div>
                    ) : null}
                    {o.blockedWith.length ? (
                      <div style={s("font-size:11.5px;color:var(--danger);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                        blocked ↔ {o.blockedWith.join(", ")}
                      </div>
                    ) : null}
                    {!o.groupName && !o.blockedWith.length ? (
                      <span style={s("font-size:11.5px;color:var(--t4)")}>—</span>
                    ) : null}
                  </div>

                  <div style={sx("font-size:13px;text-align:right", { fontFamily: TOKENS.mono, color: o.benchCount ? "var(--t1)" : "var(--t4)" })}>
                    {o.benchCount || "—"}
                  </div>
                  <div style={sx("font-size:13px;text-align:right", { fontFamily: TOKENS.mono, color: o.billedAsClientLabel === "—" ? "var(--t4)" : "var(--t1)" })}>
                    {o.billedAsClientLabel}
                  </div>
                  <div style={sx("font-size:13px;text-align:right", { fontFamily: TOKENS.mono, color: o.paidAsSupplierLabel === "—" ? "var(--t4)" : "var(--t1)" })}>
                    {o.paidAsSupplierLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ---------------- probing signal ---------------- */}
        <div style={s("margin-top:18px")}>
          <SectionLabel>Probing signal</SectionLabel>
        </div>
        <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh);padding:18px")}>
          <div style={s("font-size:12.5px;color:var(--t2);line-height:1.6;margin-bottom:10px")}>
            A client that posts roles, collects masked shortlists and never requests an
            interview may be mapping the market rather than hiring.{" "}
            <code style={sx("font-size:11.5px;color:var(--t3)", { fontFamily: TOKENS.mono })}>v_requirement_probing</code>{" "}
            counts a role as a suspect once a shortlist has sat five days without an
            interview request.
          </div>
          {probing.length ? (
            <div style={s("display:flex;flex-direction:column;gap:8px")}>
              {probing.map((o) => (
                <div key={o.orgId} style={s("display:flex;align-items:center;gap:9px;font-size:12.5px")}>
                  <Pill bg="var(--warn-tint)" fg="var(--warn)">{o.probingSuspectRequirements} SUSPECT</Pill>
                  <strong>{o.name}</strong>
                  <span style={s("color:var(--t3)")}>
                    {o.openRequirements} open · {o.placementsEver} ever placed
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={s("font-size:12.5px;color:var(--t4)")}>
              No organisation is flagged on the current data. The two figures worth watching
              by hand are open roles against placements ever made —{" "}
              {orgs.filter((o) => o.openRequirements > 0 && o.placementsEver === 0)
                .map((o) => `${o.name} (${o.openRequirements} open, none placed)`)
                .join("; ") || "every client with open roles has placed before"}.
            </div>
          )}
        </div>
      </Scroll>
    </Shell>
  );
}
