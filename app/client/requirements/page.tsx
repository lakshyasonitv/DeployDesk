import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { getClientRequirements } from "@/src/read-models/client";
import { s, sx, TOKENS, stageMeta } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";

/** Client · Requirements. The client's own note is visible to them; never to a vendor. */
export const metadata = { title: "Requirements · DeployDesk" };

const COLS = "96px 1fr 60px 128px 118px 124px 86px";

export default async function ClientRequirementsPage() {
  const session = await getDemoSession("client");
  const switcher = await getPortalSwitcherOptions();
  const [rows, aside] = await Promise.all([
    getClientRequirements(session.orgId),
    ShellAside(session.orgId),
  ]);

  return (
    <Shell portal="client" switcher={switcher} user={{ name: session.userName, org: session.orgName }} activeKey="requirements" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Requirements"
        subtitle={`${rows.length} requirements · Talentvibes sources from every supplier bench on the exchange`}
        actions={<Button primary href="/client/requirements/new">Post a requirement</Button>}
      />
      <Scroll>
        <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden")}>
          <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["REQ", "ROLE", "QTY", "BUDGET/MO", "STAGE", "POSTED", "ACTION"].map((h) => (
              <div key={h} style={sx("font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--t4)", { fontFamily: TOKENS.mono })}>{h}</div>
            ))}
          </div>
          {rows.map((r) => {
            const st = stageMeta(r.stage);
            return (
              <div key={r.code} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
                <div style={sx("font-size:11px;font-weight:700", { fontFamily: TOKENS.mono })}>{r.code}</div>
                <div style={s("min-width:0")}>
                  <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
                  <div style={s("font-size:10.5px;color:var(--t4);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                    {r.experienceBand}y · {r.locationLabel}
                    {r.promiseLabel ? ` · ${r.promiseLabel}` : ""}
                  </div>
                </div>
                <div style={sx("font-size:11.5px;font-weight:700", { fontFamily: TOKENS.mono })}>×{r.quantity}</div>
                <div style={sx("font-size:11.5px;font-weight:600", { fontFamily: TOKENS.mono })}>{r.budgetLabel}</div>
                <div>
                  <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:8.5px;font-weight:700;letter-spacing:.08em", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
                    {st.label}
                  </span>
                </div>
                <div style={s("font-size:11px;color:var(--t4)")}>{r.postedAgo}</div>
                <div>
                  {r.stage === "shortlisted" ? (
                    <Link href={`/client/shortlists/${r.code}`} style={s("font-size:11.5px;font-weight:700;color:var(--brand)")}>Review</Link>
                  ) : (
                    <span style={s("font-size:11.5px;color:var(--t4)")}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {rows.some((r) => r.note) ? (
          <div style={s("margin-top:14px;background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:12px;padding:13px")}>
            <SectionLabel>YOUR NOTES TO THE BROKER</SectionLabel>
            <div style={s("display:flex;flex-direction:column;gap:8px")}>
              {rows.filter((r) => r.note).slice(0, 5).map((r) => (
                <div key={r.code} style={s("font-size:11.5px;color:var(--t2);line-height:1.55")}>
                  <span style={sx("font-weight:700;color:var(--warn)", { fontFamily: TOKENS.mono })}>{r.code}</span>
                  {" — "}{r.note}
                </div>
              ))}
            </div>
            <div style={s("font-size:10.5px;color:var(--t4);margin-top:9px")}>
              These notes are shared with your Talentvibes broker only. They are never passed to a
              supplier.
            </div>
          </div>
        ) : null}
      </Scroll>
    </Shell>
  );
}
