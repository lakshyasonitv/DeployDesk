import Link from "next/link";
import { Shell, PageHeader, Scroll, Button, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientRequirements } from "@/src/read-models/client";
import { s, sx, TOKENS, stageMeta } from "@/src/lib/ui/style";
import { ShellAside } from "../aside";

/** Client · Requirements. The client's own note is visible to them; never to a vendor. */
export const metadata = { title: "Open roles · DeployDesk" };

// The flexible column has a floor: as a bare 1fr it collapsed to 0px on narrower screens.
const COLS = "96px minmax(140px, 1fr) 60px 128px 118px 124px 86px";

export default async function ClientRequirementsPage() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const [all, aside] = await Promise.all([
    getClientRequirements(session.orgId),
    ShellAside(session.orgId),
  ]);
  /**
   * "Open roles" listed every role ever posted — 9 for Acme, including 2 placed — while the
   * sidebar beside it said 7. Open (and drafts, which still need the client) go in the main
   * table; placed, closed and cancelled go in their own section below.
   */
  const PAST = new Set(["placed", "closed", "cancelled"]);
  const rows = all.filter((r) => !PAST.has(r.stage));
  const past = all.filter((r) => PAST.has(r.stage));
  const openCount = rows.filter((r) => r.stage !== "draft").length;

  function row(r: (typeof all)[number]) {
    const st = stageMeta(r.stage);
    return (
      <div key={r.code} style={sx("display:grid;padding:11px 15px;border-bottom:1px solid var(--surface-3);align-items:center", { gridTemplateColumns: COLS, gap: "10px" })}>
        <div style={sx("font-size:var(--fs-1);font-weight:700", { fontFamily: TOKENS.mono })}>{r.code}</div>
        <div style={s("min-width:0")}>
          <div style={s("font-size:var(--fs-4);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{r.roleTitle}</div>
          <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
            {r.experienceBand}y · {r.locationLabel}
            {r.promiseLabel ? ` · ${r.promiseLabel}` : ""}
          </div>
        </div>
        <div style={sx("font-size:var(--fs-2);font-weight:700", { fontFamily: TOKENS.mono })}>×{r.quantity}</div>
        <div style={sx("font-size:var(--fs-2);font-weight:600", { fontFamily: TOKENS.mono })}>{r.budgetLabel}</div>
        <div>
          <span style={sx("display:inline-block;padding:3px 8px;border-radius:5px;font-size:var(--fs-1);font-weight:700;letter-spacing:.08em", { background: st.bg, color: st.fg, fontFamily: TOKENS.mono })}>
            {st.label}
          </span>
        </div>
        <div style={s("font-size:var(--fs-1);color:var(--t4)")}>{r.postedAgo}</div>
        <div>
          {r.stage === "shortlisted" ? (
            <Link href={`/client/shortlists/${r.code}`} style={s("font-size:var(--fs-2);font-weight:700;color:var(--brand);display:inline-block;padding:6px 0")}>Review</Link>
          ) : r.stage === "interviewing" ? (
            <Link href="/client/interviews" style={s("font-size:var(--fs-2);font-weight:700;color:var(--brand);display:inline-block;padding:6px 0")}>Interviews</Link>
          ) : (
            <span style={s("font-size:var(--fs-2);color:var(--t4)")}>—</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="requirements" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Open roles"
        subtitle={`${openCount} open${past.length ? ` · ${past.length} placed or closed` : ""} · Talentvibes sources from every supplier bench on the exchange`}
        actions={<Button primary href="/client/requirements/new">Post a requirement</Button>}
      />
      <Scroll>
        <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow-x:auto")}>
          <div style={sx("display:grid;padding:9px 15px;background:var(--surface-2);border-bottom:1px solid var(--border)", { gridTemplateColumns: COLS, gap: "10px" })}>
            {["REQ", "ROLE", "HOW MANY", "BUDGET / MONTH", "STAGE", "POSTED", "ACTION"].map((h) => (
              <div key={h} style={sx("font-size:var(--fs-1);font-weight:700;letter-spacing:.08em;color:var(--t3);line-height:1.3", { fontFamily: TOKENS.mono })}>{h}</div>
            ))}
          </div>
          {rows.map(row)}
        </div>

        {past.length ? (
          <div style={s("margin-top:14px")}>
            <SectionLabel>PLACED AND CLOSED</SectionLabel>
            <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow-x:auto")}>
              {past.map(row)}
            </div>
          </div>
        ) : null}

        {rows.some((r) => r.note) ? (
          <div style={s("margin-top:14px;background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:12px;padding:13px")}>
            <SectionLabel>YOUR NOTES TO THE BROKER</SectionLabel>
            <div style={s("display:flex;flex-direction:column;gap:8px")}>
              {rows.filter((r) => r.note).slice(0, 5).map((r) => (
                <div key={r.code} style={s("font-size:var(--fs-2);color:var(--t2);line-height:1.55")}>
                  <span style={sx("font-weight:700;color:var(--warn)", { fontFamily: TOKENS.mono })}>{r.code}</span>
                  {": "}{r.note}
                </div>
              ))}
            </div>
            <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:9px")}>
              These notes are shared with your Talentvibes team only. They are never passed to a
              supplier.
            </div>
          </div>
        ) : null}
      </Scroll>
    </Shell>
  );
}
