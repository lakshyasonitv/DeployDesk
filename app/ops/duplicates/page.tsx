import { Shell, PageHeader, Scroll, Button, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession } from "@/src/lib/auth/session";
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
export const metadata = { title: "Duplicates · Bench Exchange" };

type Flags = Awaited<ReturnType<typeof getOpsDuplicates>>;
type Side = NonNullable<Flags[number]["sides"][number]>;

const SEVERITY = {
  high: { bg: "#fdecec", border: "#f6cfcf", fg: "#b91c1c" },
  medium: { bg: "#fff3e4", border: "#f0dcc0", fg: "#b45309" },
  low: { bg: "#fafafc", border: "#eeeef3", fg: "#4a4a58" },
  none: { bg: "#fafafc", border: "#eeeef3", fg: "#4a4a58" },
} as const;

const sev = (k: string) => SEVERITY[k as keyof typeof SEVERITY] ?? SEVERITY.low;

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });

export default async function DuplicatesPage() {
  await getDemoSession("ops");
  const [flags, aside] = await Promise.all([getOpsDuplicates(), OpsAside()]);
  const open = flags.filter((f) => f.status === "open");
  const blocking = flags.filter((f) => f.blocks);
  const secondary = flags.filter((f) => !f.blocks);

  return (
    <Shell portal="ops" activeKey="duplicates" asideTitle="TODAY'S QUEUE" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Duplicate candidates"
        subtitle="Same person submitted by two suppliers · resolve before a shortlist goes out"
        actions={<><Button>Detection rules</Button><Button primary accent="#101014">{open.length} open flags</Button></>}
      />
      <Scroll>
        {blocking.map((f) => {
          const keeper = f.sides.find((x) => x && x.maskedId === f.recommendation);
          return (
            <div key={f.code} style={s("background:#fff;border:1px solid #f0c9c9;border-radius:12px;overflow:hidden;margin-bottom:14px")}>
              <div style={s("background:#fdecec;border-bottom:1px solid #f6cfcf;padding:11px 15px;display:flex;align-items:center;justify-content:space-between;gap:12px")}>
                <div>
                  <div style={s("font-size:13px;font-weight:800;color:#b91c1c")}>
                    Likely the same person · {f.confidence}% confidence
                  </div>
                  <div style={s("font-size:11px;color:#b91c1c;margin-top:3px")}>
                    Flagged {stamp(f.detectedAt)}
                    {f.blockedRequirementCount > 0
                      ? ` · blocks ${f.blockedRequirementCount} shortlist`
                      : ""}
                  </div>
                </div>
                <div style={sx("font-size:11px;font-weight:700;color:#b91c1c", { fontFamily: TOKENS.mono })}>{f.code}</div>
              </div>

              <div style={s("display:grid;grid-template-columns:1fr 200px 1fr")}>
                {f.sides[0] ? <SidePanel side={f.sides[0]} primary /> : <div />}

                <div style={s("background:#fafafc;border-left:1px solid #f1f1f5;border-right:1px solid #f1f1f5;padding:13px")}>
                  <SectionLabel>MATCH SIGNALS</SectionLabel>
                  <div style={s("display:flex;flex-direction:column;gap:6px")}>
                    {f.signals.map((sig) => {
                      const c = sev(sig.severity);
                      return (
                        <div key={sig.key} style={sx("border-radius:7px;padding:7px 9px", { background: c.bg, border: `1px solid ${c.border}` })}>
                          <div style={sx("font-size:10.5px;font-weight:700", { color: c.fg })}>{sig.label}</div>
                          <div style={s("font-size:10px;color:#6b6b78;margin-top:2px")}>{sig.verdict}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {f.sides[1] ? <SidePanel side={f.sides[1]} /> : <div />}
              </div>

              <div style={s("background:#fafafc;border-top:1px solid #f1f1f5;padding:13px 15px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap")}>
                <div style={s("font-size:12px;color:#4a4a58;line-height:1.6;flex:1;min-width:260px")}>
                  <strong style={s("font-weight:700")}>Recommended:</strong> keep the{" "}
                  <strong style={s("font-weight:700")}>{keeper?.vendorName ?? "earlier"}</strong>{" "}
                  submission — earlier, confirmed availability and the higher reliability score.
                  Notify the other supplier that the profile is already represented; neither the
                  client nor the candidate is told.
                </div>
                <div style={s("display:flex;gap:8px;flex:none")}>
                  <Button primary accent="#101014">
                    Keep {keeper?.vendorName.split(" ")[0] ?? "A"}
                  </Button>
                  <Button>Not a duplicate</Button>
                </div>
              </div>
            </div>
          );
        })}

        {secondary.map((f) => (
          <div key={f.code} style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:13px 15px;display:flex;align-items:center;gap:12px;margin-bottom:10px")}>
            <span style={s("width:8px;height:8px;border-radius:50%;background:#f59e0b;flex:none")} />
            <div style={s("flex:1;min-width:0")}>
              <div style={s("font-size:12.5px;font-weight:700")}>
                {f.sides[0]?.fullName} ({f.sides[0]?.vendorName}) vs {f.sides[1]?.fullName} ({f.sides[1]?.vendorName})
              </div>
              <div style={s("font-size:11.5px;color:#6b6b78;margin-top:3px")}>
                {f.signals.map((x) => x.verdict === "DIFFERENT" ? `different ${x.label.toLowerCase()}` : x.label.toLowerCase()).join(", ")}. Needs a human call.
              </div>
            </div>
            <div style={s("text-align:right;flex:none")}>
              <div style={sx("font-size:11px;font-weight:700", { fontFamily: TOKENS.mono })}>{f.code} · {f.confidence}%</div>
              <div style={s("font-size:10.5px;color:#8a8a96;margin-top:2px")}>
                assigned to {f.assignedName ?? "unassigned"} · {f.status}
              </div>
            </div>
          </div>
        ))}

        {flags.length === 0 ? (
          <div style={s("background:#fff;border:1px dashed #e0e0e8;border-radius:12px;padding:34px;text-align:center;color:#8a8a96;font-size:12.5px")}>
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
          background: side.isFirst ? "#e8f6ef" : "#fff3e4",
          color: side.isFirst ? "#0f7a4a" : "#b45309",
          fontFamily: TOKENS.mono,
        })}>
          {side.isFirst ? "SUBMISSION A · EARLIER" : "SUBMISSION B · LATER"}
        </span>
        <span style={sx("font-size:9.5px;color:#8a8a96", { fontFamily: TOKENS.mono })}>
          {stamp(side.submittedAt).toUpperCase()}
        </span>
      </div>
      <div style={s("font-size:14px;font-weight:800;margin-top:8px")}>{side.fullName}</div>
      <div style={sx("font-size:11px;color:#8a8a96;margin-top:2px", { fontFamily: TOKENS.mono })}>{side.maskedId}</div>
      <div style={s("font-size:11.5px;color:#4a4a58;margin-top:3px")}>
        submitted by <strong style={s("font-weight:700")}>{side.vendorName}</strong>
      </div>

      <div style={s("margin-top:11px;display:flex;flex-direction:column")}>
        {side.facts.map((f) => (
          <div key={f.k} style={s("display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid #f4f4f8")}>
            <span style={s("font-size:11px;color:#8a8a96")}>{f.k}</span>
            <span style={sx("font-size:11px;font-weight:700;text-align:right", {
              color: f.severity === "high" ? "#b91c1c" : f.severity === "medium" ? "#b45309" : "#101014",
              fontFamily: TOKENS.mono,
            })}>{f.v}</span>
          </div>
        ))}
      </div>

      <div style={s("display:flex;gap:7px;margin-top:11px")}>
        <div style={sx("padding:6px 11px;border-radius:7px;font-size:11px;font-weight:700", {
          background: primary ? "#101014" : "#f3f3f7", color: primary ? "#fff" : "#4a4a58",
        })}>
          Keep this one
        </div>
        <div style={s("padding:6px 11px;border:1px solid #e0e0e8;border-radius:7px;font-size:11px;font-weight:600;background:#fff")}>
          Contact vendor
        </div>
      </div>
    </div>
  );
}
