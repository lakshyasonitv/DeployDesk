import { Shell, PageHeader, Scroll, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsDuplicates } from "@/src/read-models/ops";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { OpsAside } from "../aside";
import { ResolveActions } from "./ResolveActions";
import { istFormat } from "@/src/lib/derived";

/**
 * Ops · Duplicate candidates. Ops-only, always.
 *
 * Neither the client nor the candidate is ever told a duplicate flag exists, and the
 * losing vendor is told only that the profile is already represented — never who else
 * submitted it (docs/DATA-MODEL.md section 9).
 */
export const metadata = { title: "Duplicate checks · DeployDesk" };

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
  istFormat(iso, {
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
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="duplicates" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Duplicate checks"
        subtitle="Same person submitted by two suppliers · resolve before a shortlist goes out"
        /*
          "Detection rules" is gone: it opened nothing, and no agreed thresholds exist to put
          behind it (working agreement 8). "N open flags" was a primary button that did
          nothing; it is a count, so it reads as one.
        */
        actions={
          <span style={s("font-size:var(--fs-4);font-weight:700;color:var(--t2)")}>
            {open.length} open {open.length === 1 ? "flag" : "flags"}
          </span>
        }
      />
      <Scroll>
        {blocking.map((f) => {
          const keeper = f.recommendation === "b" ? f.sides[1] : f.sides[0];
          return (
            <div key={f.code} style={s("background:var(--surface);border:1px solid var(--danger-tint);border-radius:12px;overflow:hidden;margin-bottom:14px")}>
              <div style={s("background:var(--danger-tint);border-bottom:1px solid var(--danger-tint);padding:11px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
                <div>
                  <div style={s("font-size:var(--fs-5);font-weight:800;color:var(--danger)")}>
                    Likely the same person · {f.confidence}% confidence
                  </div>
                  <div style={s("font-size:var(--fs-1);color:var(--danger);margin-top:3px")}>
                    Flagged {stamp(f.detectedAt)}
                    {f.blockedRequirementCount > 0
                      ? ` · blocks ${f.blockedRequirementCount} shortlist`
                      : ""}
                  </div>
                </div>
                <div style={sx("font-size:var(--fs-1);font-weight:700;color:var(--danger)", { fontFamily: TOKENS.mono })}>{f.code}</div>
              </div>

              <div style={s("display:grid;grid-template-columns:1fr 200px 1fr")}>
                {f.sides[0] ? <SidePanel side={f.sides[0]} letter="A" /> : <div />}

                <div style={s("background:var(--surface-2);border-left:1px solid var(--surface-3);border-right:1px solid var(--surface-3);padding:13px")}>
                  <SectionLabel>MATCH SIGNALS</SectionLabel>
                  <div style={s("display:flex;flex-direction:column;gap:6px")}>
                    {f.signals.map((sig) => {
                      const c = sev(sig.severity);
                      return (
                        <div key={sig.key} style={sx("border-radius:7px;padding:7px 9px", { background: c.bg, border: `1px solid ${c.border}` })}>
                          <div style={sx("font-size:var(--fs-1);font-weight:700", { color: c.fg })}>{sig.label}</div>
                          <div style={s("font-size:var(--fs-1);color:var(--t3);margin-top:2px")}>{sig.verdict}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {f.sides[1] ? <SidePanel side={f.sides[1]} letter="B" /> : <div />}
              </div>

              <div style={s("background:var(--surface-2);border-top:1px solid var(--surface-3);padding:13px 15px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap")}>
                <div style={s("font-size:var(--fs-3);color:var(--t2);line-height:1.6;flex:1;min-width:260px")}>
                  <strong style={s("font-weight:700")}>Recommended:</strong> keep the{" "}
                  <strong style={s("font-weight:700")}>{keeper?.vendorName ?? "first"}</strong>{" "}
                  submission, because {f.recommendationReason ?? "it was submitted first"}. The other
                  submission is withdrawn. Its supplier sees only that it was withdrawn, never who
                  else submitted it, and neither the client nor the candidate is told.
                </div>
                <Resolve f={f} />
              </div>
            </div>
          );
        })}

        {secondary.map((f) => {
          const settled = settledAs(f.status, f.sides[0]?.vendorName, f.sides[1]?.vendorName);
          return (
            <div key={f.code} style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:13px 15px;display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap")}>
              <span style={sx("width:8px;height:8px;border-radius:50%;flex:none", { background: settled ? "var(--ok)" : "var(--warn)" })} />
              <div style={s("flex:1;min-width:0")}>
                <div style={s("font-size:var(--fs-4);font-weight:700")}>
                  {f.sides[0]?.fullName} ({f.sides[0]?.vendorName}) vs {f.sides[1]?.fullName} ({f.sides[1]?.vendorName})
                </div>
                <div style={s("font-size:var(--fs-2);color:var(--t3);margin-top:3px")}>
                  {f.signals.map((x) => x.verdict === "DIFFERENT" ? `different ${x.label.toLowerCase()}` : x.label.toLowerCase()).join(", ")}.{" "}
                  {settled ?? "Needs a human call."}
                </div>
              </div>
              <div style={s("text-align:right;flex:none")}>
                <div style={sx("font-size:var(--fs-1);font-weight:700", { fontFamily: TOKENS.mono })}>{f.code} · {f.confidence}%</div>
                <div style={s("font-size:var(--fs-1);color:var(--t4);margin-top:2px")}>
                  assigned to {f.assignedName ?? "unassigned"} · {settled ? "settled" : "open"}
                </div>
              </div>
              {/* "Needs a human call" used to come with no way to make one. */}
              {settled ? null : (
                <div style={s("flex-basis:100%;display:flex;justify-content:flex-end")}>
                  <Resolve f={f} />
                </div>
              )}
            </div>
          );
        })}

        {flags.length === 0 ? (
          <div style={s("background:var(--surface);border:1px dashed var(--border-2);border-radius:12px;padding:34px;text-align:center;color:var(--t4);font-size:var(--fs-4)")}>
            No duplicate flags open. Detection runs on create, on import and nightly.
          </div>
        ) : null}
      </Scroll>
    </Shell>
  );
}

/**
 * The three resolve buttons for one flag. "Keep A" withdraws B, so it is disabled by B's
 * blocker, and vice versa — the same check the route enforces (src/services/withdrawal.ts).
 */
function Resolve({ f }: { f: Flags[number] }) {
  const [a, b] = f.sides;
  return (
    <ResolveActions
      code={f.code}
      keepALabel={a?.vendorName.split(" ")[0] ?? "A"}
      keepBLabel={b?.vendorName.split(" ")[0] ?? "B"}
      keepABlockedBy={b?.withdrawBlocker ? `${b.maskedId} ${b.withdrawBlocker}` : null}
      keepBBlockedBy={a?.withdrawBlocker ? `${a.maskedId} ${a.withdrawBlocker}` : null}
      recommended={f.recommendation}
    />
  );
}

/** What a settled flag decided, in words. `null` while the flag is still open. */
function settledAs(status: string, vendorA?: string, vendorB?: string): string | null {
  if (status === "kept_a") return `Settled: kept ${vendorA ?? "submission A"}.`;
  if (status === "kept_b") return `Settled: kept ${vendorB ?? "submission B"}.`;
  if (status === "not_duplicate") return "Settled: two different people.";
  return null;
}

function SidePanel({ side, letter }: { side: Side; letter: "A" | "B" }) {
  // EARLIER / LATER comes from the timestamps, and is left off when they are equal.
  const tone = side.order === "earlier" ? "ok" : side.order === "later" ? "warn" : null;
  return (
    <div style={s("padding:13px 15px")}>
      <div style={s("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
        <span style={sx("padding:2px 7px;border-radius:4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.08em", {
          background: tone ? `var(--${tone}-tint)` : "var(--surface-3)",
          color: tone ? `var(--${tone})` : "var(--t2)",
          fontFamily: TOKENS.mono,
        })}>
          SUBMISSION {letter}{side.order ? ` · ${side.order.toUpperCase()}` : ""}
        </span>
        <span style={sx("font-size:var(--fs-1);color:var(--t4)", { fontFamily: TOKENS.mono })}>
          {stamp(side.submittedAt).toUpperCase()}
        </span>
      </div>
      <div style={s("font-size:var(--fs-7);font-weight:800;margin-top:8px")}>{side.fullName}</div>
      <div style={sx("font-size:var(--fs-1);color:var(--t4);margin-top:2px", { fontFamily: TOKENS.mono })}>{side.maskedId}</div>
      <div style={s("font-size:var(--fs-2);color:var(--t2);margin-top:3px")}>
        submitted by <strong style={s("font-weight:700")}>{side.vendorName}</strong>
      </div>

      <div style={s("margin-top:11px;display:flex;flex-direction:column")}>
        {side.facts.map((f) => (
          <div key={f.k} style={s("display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--surface-3)")}>
            <span style={s("font-size:var(--fs-1);color:var(--t4)")}>{f.k}</span>
            <span style={sx("font-size:var(--fs-1);font-weight:700;text-align:right", {
              color: f.severity === "high" ? "var(--danger)" : f.severity === "medium" ? "var(--warn)" : "var(--t1)",
              fontFamily: TOKENS.mono,
            })}>{f.v}</span>
          </div>
        ))}
      </div>

      {/*
        The decorative "Keep this one" / "Contact vendor" chips that used to sit here are
        gone. They looked like controls and were plain divs, and now that the card footer
        carries real working buttons, two competing affordances for the same decision is
        worse than one. "Contact vendor" also had nowhere to go — relaying to a supplier is
        the broker-thread write path, which does not exist yet.
      */}
    </div>
  );
}
