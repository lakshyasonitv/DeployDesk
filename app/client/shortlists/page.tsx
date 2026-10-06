import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, Pill } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientOverview } from "@/src/read-models/client";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";

/** Client · Shortlists index. Each row opens the masked review screen. */
export const metadata = { title: "Shortlists · DeployDesk" };

export default async function ShortlistsIndex() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const [overview, aside] = await Promise.all([
    getClientOverview(session.orgId, session.userName),
    ShellAside(session.orgId),
  ]);

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="shortlists" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Shortlists"
        subtitle="Masked profiles delivered by your broker. Names, photos and suppliers are withheld."
        actions={<Button>Ask Talentvibes</Button>}
      />
      <Scroll>
        <div style={s("display:grid;grid-template-columns:repeat(2,1fr);gap:12px")}>
          {overview.awaitingReview.map((a) => (
            <Link key={a.code} href={`/client/shortlists/${a.code}`}
              style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px;color:var(--t1)")}>
              <div style={s("display:flex;align-items:center;justify-content:space-between;gap:9px")}>
                <div style={s("display:flex;align-items:center;gap:8px")}>
                  <Pill bg="var(--brand-tint)" fg="var(--brand)">SHORTLIST READY</Pill>
                  <span style={sx("font-size:10.5px;font-weight:600;color:var(--t4)", { fontFamily: TOKENS.mono })}>{a.code}</span>
                </div>
                <span style={s("font-size:10.5px;color:var(--t4)")}>{a.sentAgo}</span>
              </div>
              <div style={s("font-size:15px;font-weight:800;margin-top:9px;letter-spacing:-.3px")}>{a.roleTitle}</div>
              <div style={s("display:flex;align-items:baseline;gap:14px;margin-top:11px")}>
                <div>
                  <div style={s("font-size:21px;font-weight:800;line-height:1")}>{a.count}</div>
                  <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
                    MASKED PROFILES
                  </div>
                </div>
                {a.averageScore != null ? (
                  <div>
                    <div style={s("font-size:21px;font-weight:800;line-height:1;color:var(--ok)")}>{a.averageScore}</div>
                    <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
                      AVG PROCTORED
                    </div>
                  </div>
                ) : null}
              </div>
              <div style={s("font-size:11.5px;font-weight:700;color:var(--brand);margin-top:12px")}>
                Review {a.count} profiles →
              </div>
            </Link>
          ))}
        </div>

        {overview.awaitingReview.length === 0 ? (
          <div style={s("background:var(--surface);border:1px dashed var(--border-2);border-radius:12px;padding:34px;text-align:center;color:var(--t4);font-size:12.5px")}>
            No shortlists waiting. Your broker delivers masked profiles here, typically within 36
            hours of posting a requirement.
          </div>
        ) : null}
      </Scroll>
    </Shell>
  );
}
