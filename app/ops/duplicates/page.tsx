import { Shell, PageHeader, Scroll, Button, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsDuplicates } from "@/src/read-models/ops";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";

/**
 * Ops · Duplicate candidates. Ops-only, always.
 *
 * Neither the client nor the candidate is ever told a duplicate flag exists, and the
 * losing vendor is told only that the profile is already represented — never who else
 * submitted it (docs/DATA-MODEL.md section 9).
 */
export const metadata = { title: "Duplicates · DeployDesk" };

type Flags = Awaited<ReturnType<typeof getOpsDuplicates>>;
type Side = NonNullable<Flags[number]["sides"][number]>;

const SEVERITY = {
  high: { bg: "var(--danger-tint)", border: "var(--danger-tint)", fg: "var(--danger)" },
  medium: { bg: "var(--warn-tint)", border: "var(--warn-tint)", fg: "var(--warn)" },
  low: { bg: "var(--surface-2)", border: "var(--border)", fg: "var(--t2)" },
  none: { bg: "var(--surface-2)", border: "var(--border)", fg: "var(--t2)" },
} as const;

const sev = (k: string) => SEVERITY[k as keyof typeof SEVERITY] ?? SEVERITY.low;

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

export default async function DuplicatesPage() {
  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);
  const [flags, aside] = await Promise.all([getOpsDuplicates(), OpsAside()]);
  const open = flags.filter((f) => f.status === "open");
  const blocking = flags.filter((f) => f.blocks);
  const secondary = flags.filter((f) => !f.blocks);

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: `${session.orgName} · ${session.role}` }} activeKey="duplicates" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Duplicate candidates"
        subtitle="Same person submitted by two suppliers · resolve before a shortlist goes out"
        actions={<><Button>Detection rules</Button><Button primary accent="var(--t1)">{open.length} open flags</Button></>}
      />
      <Scroll>
        {blocking.map((f) => {
          const keeper = f.sides.find((x) => x && x.maskedId === f.recommendation);
          return (
            <div key={f.code} style={s("background:var(--surface);border:1px solid var(--danger-tint);border-radius:12px;overflow:hidden;margin-bottom:14px")}>
              <div style={s("background:var(--danger-tint);border-bottom:1px solid var(--danger-tint);padding:11px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
                <div>
                  <div style={s("font-size:13px;font-weight:800;color:var(--danger)")}>
                    Likely the same person · {f.confidence}% confidence
                  </div>
                  <div style={s("font-size:11px;color:var(--danger);margin-top:3px")}>
                    Flagged {stamp(f.detectedAt)}
                    {f.blockedRequirementCount > 0
                      ? ` · blocks ${f.blockedRequirementCount} shortlist`
                      : ""}
                  </div>
                </div>
                <div style={sx("font-size:11px;font-weight:700;color:var(--danger)", { fontFamily: TOKENS.mono })}>{f.code}</div>
              </div>

              <div style={s("display:grid;grid-template-columns:1fr 200px 1fr")}>
                {f.sides[0] ? <SidePanel side={f.sides[0]} primary /> : <div />}

                <div style={s("background:var(--surface-2);border-left:1px solid var(--surface-3);border-right:1px solid var(--surface-3);padding:13px")}>
                  <SectionLabel>MATCH SIGNALS</SectionLabel>
                  <div style={s("display:flex;flex-direction:column;gap:6px")}>
                    {f.signals.map((sig) => {
                      const c = sev(sig.severity);
                      return (
                        <div key={sig.key} style={sx("border-radius:7px;padding:7px 9px", { background: c.bg, border: `1px solid ${c.border}` })}>
                          <div style={sx("font-size:10.5px;font-weight:700", { color: c.fg })}>{sig.label}</div>
                          <div style={s("font-size:10px;color:var(--t3);margin-top:2px")}>{sig.verdict}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {f.sides[1] ? <SidePanel side={f.sides[1]} /> : <div />}
              </div>

              <div style={s("background:var(--surface-2);border-top:1px solid var(--surface-3);padding:13px 15px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap")}>
                <div style={s("font-size:12px;color:var(--t2);line-height:1.6;flex:1;min-width:260px")}>
                  <strong style={s("font-weight:700")}>Recommended:</strong> keep the{" "}
                  <strong style={s("font-weight:700")}>{keeper?.vendorName ?? "earlier"}</strong>{" "}
                  submission — earlier, confirmed availability and the higher reliability score.
                  Notify the other supplier that the profile is already represented; neither the
                  client nor the candidate is told.
                </div>
                <div style={s("display:flex;gap:8px;flex:none")}>
                  <Button primary accent="var(--t1)">
                    Keep {keeper?.vendorName.split(" ")[0] ?? "A"}
                  </Button>
                  <Button>Not a duplicate</Button>
                </div>
              </div>
            </div>
          );
        })}

        {secondary.map((f) => (
          <div key={f.code} style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px 15px;display:flex;align-items:center;gap:12px;margin-bottom:10px")}>
            <span style={s("width:8px;height:8px;border-radius:50%;background:var(--warn);flex:none")} />
            <div style={s("flex:1;min-width:0")}>
              <div style={s("font-size:12.5px;font-weight:700")}>
                {f.sides[0]?.fullName} ({f.sides[0]?.vendorName}) vs {f.sides[1]?.fullName} ({f.sides[1]?.vendorName})
              </div>
              <div style={s("font-size:11.5px;color:var(--t3);margin-top:3px")}>
                {f.signals.map((x) => x.verdict === "DIFFERENT" ? `different ${x.label.toLowerCase()}` : x.label.toLowerCase()).join(", ")}. Needs a human call.
              </div>
            </div>
            <div style={s("text-align:right;flex:none")}>
              <div style={sx("font-size:11px;font-weight:700", { fontFamily: TOKENS.mono })}>{f.code} · {f.confidence}%</div>
              <div style={s("font-size:10.5px;color:var(--t4);margin-top:2px")}>
                assigned to {f.assignedName ?? "unassigned"} · {f.status}
              </div>
            </div>
          </div>
        ))}

        {flags.length === 0 ? (
          <div style={s("background:var(--surface);border:1px dashed var(--border-2);border-radius:12px;padding:34px;text-align:center;color:var(--t4);font-size:12.5px")}>
            No duplicate flags open. Detection runs on create, on import and nightly.
          </div>
        ) : null}
      </Scroll>
    </Shell>
  );
}

function SidePanel({ side, primary }: { side: Side; primary?: boolean }) {
  return (
    <div style={s("padding:13px 15px")}>
      <div style={s("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
        <span style={sx("padding:2px 7px;border-radius:4px;font-size:8.5px;font-weight:700;letter-spacing:.08em", {
          background: side.isFirst ? "var(--ok-tint)" : "var(--warn-tint)",
          color: side.isFirst ? "var(--ok)" : "var(--warn)",
          fontFamily: TOKENS.mono,
        })}>
          {side.isFirst ? "SUBMISSION A · EARLIER" : "SUBMISSION B · LATER"}
        </span>
        <span style={sx("font-size:9.5px;color:var(--t4)", { fontFamily: TOKENS.mono })}>
          {stamp(side.submittedAt).toUpperCase()}
        </span>
      </div>
      <div style={s("font-size:14px;font-weight:800;margin-top:8px")}>{side.fullName}</div>
      <div style={sx("font-size:11px;color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>{side.maskedId}</div>
      <div style={s("font-size:11.5px;color:var(--t2);margin-top:3px")}>
        submitted by <strong style={s("font-weight:700")}>{side.vendorName}</strong>
      </div>

      <div style={s("margin-top:11px;display:flex;flex-direction:column")}>
        {side.facts.map((f) => (
          <div key={f.k} style={s("display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--surface-3)")}>
            <span style={s("font-size:11px;color:var(--t4)")}>{f.k}</span>
            <span style={sx("font-size:11px;font-weight:700;text-align:right", {
              color: f.severity === "high" ? "var(--danger)" : f.severity === "medium" ? "var(--warn)" : "var(--t1)",
              fontFamily: TOKENS.mono,
            })}>{f.v}</span>
          </div>
        ))}
      </div>

      <div style={s("display:flex;gap:7px;margin-top:11px")}>
        <div style={sx("padding:6px 11px;border-radius:7px;font-size:11px;font-weight:700", {
          background: primary ? "var(--t1)" : "var(--surface-3)", color: primary ? "var(--surface)" : "var(--t2)",
        })}>
          Keep this one
        </div>
        <div style={s("padding:6px 11px;border:1px solid var(--border-2);border-radius:7px;font-size:11px;font-weight:600;background:var(--surface)")}>
          Contact vendor
        </div>
      </div>
    </div>
  );
}
