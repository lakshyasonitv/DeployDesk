"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/src/lib/ui/Toast";
import { s, sx, TOKENS } from "@/src/lib/ui/style";

/**
 * Client · Post a requirement.
 *
 * The live match preview calls /api/client/match-preview, which returns counts only and
 * suppresses any bucket below five. The client never sees a profile, a supplier or a
 * rate from this screen — see the handler for the two side channels it has to avoid.
 */

const BANDS = [
  { key: "0-3", label: "0–3y" },
  { key: "3-5", label: "3–5y" },
  { key: "5-8", label: "5–8y" },
  { key: "8+", label: "8y+" },
] as const;

const LAKH = 100_000 * 100;

interface Preview {
  matching: { value: number | null; label: string };
  bars: Array<{ label: string; value: number | null; countLabel: string; pct: number }>;
  poolSize: number;
  note: string;
}

/**
 * Quick-add chips come from the catalogue, never a literal list.
 *
 * There used to be a hardcoded `SUGGESTED` array here while the real 30-skill catalogue
 * was already arriving as `availableSkills`. One of its entries — "Microservices" — is not
 * in the catalogue at all, so clicking it showed a chip, let the form submit, and the API
 * silently dropped it: the user believed they had tagged a skill that was never saved.
 *
 * Deriving the chips from `availableSkills` makes that impossible by construction. Nothing
 * clickable can be a skill the API will refuse.
 */
function suggestionsFrom(available: string[], chosen: string[], limit = 6): string[] {
  return available.filter((sk) => !chosen.includes(sk)).slice(0, limit);
}

export function PostForm({ availableSkills }: { availableSkills: string[] }) {
  const router = useRouter();
  const toast = useToast();

  /**
   * `roleTitle` is new. The form had no role-title field at all, while
   * `requirements.role_title` is NOT NULL — so there was no way to post a role even once
   * the endpoint existed. It is the first thing a hiring manager would type, so it is now
   * the first field on the form.
   */
  const [roleTitle, setRoleTitle] = useState("");
  const [duration, setDuration] = useState("6 months, extendable");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "new" | "draft">(null);
  const [error, setError] = useState<string | null>(null);

  const [skills, setSkills] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [band, setBand] = useState<string>("5-8");
  const [qty, setQty] = useState(3);
  const [minL, setMinL] = useState(1.3);
  const [maxL, setMaxL] = useState(1.7);
  const [engagement, setEngagement] = useState("contract");
  const [mode, setMode] = useState("hybrid");
  const [notice, setNotice] = useState<string[]>(["immediate", "le_30"]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  const addSkill = (sk: string) => {
    const v = sk.trim();
    if (!v || skills.includes(v)) return;
    setSkills((p) => [...p, v]);
    setDraft("");
  };

  // Debounced: the preview updates as you edit, but it is a server call.
  const key = useMemo(
    () => JSON.stringify({ skills, band, minL, maxL }),
    [skills, band, minL, maxL],
  );

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/client/match-preview", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skills, experienceBand: band,
            budgetMinPaise: Math.round(minL * LAKH),
            budgetMaxPaise: Math.round(maxL * LAKH),
          }),
        });
        const body = await res.json();
        if (!cancelled && res.ok) setPreview(body);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key, skills, band, minL, maxL]);

  const problems: string[] = [];
  if (roleTitle.trim().length < 3) problems.push("a role title");
  if (!skills.length) problems.push("at least one skill");
  if (!notice.length) problems.push("at least one notice period you would accept");
  if (maxL < minL) problems.push("a budget range where the top is not below the bottom");

  async function submit(stage: "new" | "draft") {
    if (problems.length) {
      setError(`Still needed: ${problems.join(", ")}.`);
      return;
    }
    setError(null);
    setBusy(stage);
    try {
      const res = await fetch("/api/client/requirements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roleTitle: roleTitle.trim(),
          skills,
          experienceBand: band,
          quantity: qty,
          budgetMinPaise: Math.round(minL * LAKH),
          budgetMaxPaise: Math.round(maxL * LAKH),
          engagementType: engagement,
          durationText: duration.trim() || undefined,
          locationCity: location.trim() || undefined,
          workMode: mode,
          startDate: startDate || undefined,
          noticeAccepted: notice,
          clientNote: note.trim() || undefined,
          stage,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error === "invalid_request" ? "Some details were rejected." : "Could not save.");
      }
      const out = await res.json() as { code: string; slaHours: number | null; skillsIgnored?: string[] };
      const ignored = out.skillsIgnored?.length
        ? ` ${out.skillsIgnored.length} skill${out.skillsIgnored.length === 1 ? "" : "s"} not in our list were skipped.`
        : "";

      toast({
        message: stage === "new"
          ? `${out.code} is with your Talentvibes team. First profiles usually arrive within ${out.slaHours ?? 36} hours.${ignored}`
          : `${out.code} saved as a draft.${ignored}`,
        // Real undo: cancels the role and writes a second audit row. The endpoint refuses
        // once a broker has moved it past `new`, which the toast surfaces as an error.
        undo: async () => {
          const r = await fetch("/api/client/requirements", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code: out.code }),
          });
          if (!r.ok) throw new Error("cancel failed");
          router.refresh();
        },
      });

      setRoleTitle(""); setSkills([]); setLocation(""); setStartDate(""); setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={s("display:grid;grid-template-columns:1.6fr 1fr;gap:18px;align-items:start")}>
      {/* ---------------- form ---------------- */}
      <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px")}>
        <Group label="ROLE">
          <Field label="What is the role called?">
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Senior React Engineer"
              style={s("width:100%;padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")}
            />
          </Field>
          <Field label="Primary skills">
            <div style={s("display:flex;flex-wrap:wrap;gap:5px;align-items:center")}>
              {skills.map((sk) => (
                <span key={sk} style={s("display:inline-flex;align-items:center;gap:6px;padding:4px 9px;background:var(--brand-tint);border-radius:6px;font-size:11.5px;font-weight:600;color:var(--brand)")}>
                  {sk}
                  <button onClick={() => setSkills((p) => p.filter((x) => x !== sk))}
                    style={s("border:0;background:transparent;color:var(--brand);cursor:pointer;font-size:12px;line-height:1;padding:0;font-family:inherit")}>×</button>
                </span>
              ))}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(draft); } }}
                placeholder="Add a skill…"
                list="skill-options"
                style={s("border:0;outline:none;font-size:11.5px;padding:4px;min-width:110px;font-family:inherit")}
              />
              <datalist id="skill-options">
                {availableSkills.map((sk) => <option key={sk} value={sk} />)}
              </datalist>
            </div>
            <div style={s("display:flex;flex-wrap:wrap;gap:5px;margin-top:8px")}>
              {suggestionsFrom(availableSkills, skills).map((sk) => (
                <button key={sk} onClick={() => addSkill(sk)}
                  style={s("padding:3px 9px;border:1px solid var(--border-2);border-radius:6px;font-size:11px;background:var(--surface);cursor:pointer;color:var(--t3);font-family:inherit")}>
                  + {sk}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Experience band">
            <Segments options={BANDS.map((b) => ({ key: b.key, label: b.label }))} value={band} onChange={setBand} />
          </Field>

          <Field label="Quantity">
            <div style={s("display:flex;align-items:center;gap:9px")}>
              <Stepper onClick={() => setQty((q) => Math.max(1, q - 1))}>−</Stepper>
              <span style={sx("font-size:15px;font-weight:800;min-width:22px;text-align:center", { fontFamily: TOKENS.mono })}>{qty}</span>
              <Stepper onClick={() => setQty((q) => Math.min(20, q + 1))}>+</Stepper>
              <span style={s("font-size:11px;color:var(--t4)")}>position{qty === 1 ? "" : "s"}</span>
            </div>
          </Field>
        </Group>

        <Group label="COMMERCIALS">
          <Field label="Budget range · per month">
            <div style={sx("font-size:12.5px;font-weight:700;margin-bottom:9px", { fontFamily: TOKENS.mono })}>
              ₹{(minL * 100000).toLocaleString("en-IN")} — ₹{(maxL * 100000).toLocaleString("en-IN")}
            </div>
            <div style={s("display:flex;gap:14px")}>
              <Slider label="Floor" value={minL} min={0.6} max={3} onChange={(v) => setMinL(Math.min(v, maxL - 0.1))} />
              <Slider label="Ceiling" value={maxL} min={0.6} max={3} onChange={(v) => setMaxL(Math.max(v, minL + 0.1))} />
            </div>
            <div style={sx("display:flex;justify-content:space-between;font-size:10px;color:var(--t4);margin-top:5px", { fontFamily: TOKENS.mono })}>
              <span>₹60K</span><span>₹3L</span>
            </div>
            {preview ? (
              <div style={s("margin-top:10px;background:var(--brand-tint);border-radius:8px;padding:10px;font-size:11.5px;font-weight:600;color:var(--brand-h);line-height:1.5")}>
                {preview.matching.label} profiles on live benches match this band.
                Identities and suppliers stay hidden until a shortlist is sent.
              </div>
            ) : null}
          </Field>

          <Field label="Engagement type">
            <Segments
              options={[{ key: "contract", label: "Contract" }, { key: "c2h", label: "C2H" }, { key: "full_time", label: "Full-time" }]}
              value={engagement} onChange={setEngagement}
            />
          </Field>

          <Field label="Duration">
            <input value={duration} onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 6 months, extendable"
              style={s("width:100%;padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")} />
          </Field>
        </Group>

        <Group label="LOGISTICS">
          <Field label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Bangalore"
              style={s("width:100%;padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")} />
          </Field>
          <Field label="Work mode">
            <Segments
              options={[{ key: "onsite", label: "Onsite" }, { key: "hybrid", label: "Hybrid · 3 days" }, { key: "remote", label: "Remote" }]}
              value={mode} onChange={setMode}
            />
          </Field>
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={s("padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")} />
          </Field>
          <Field label="Notice period accepted">
            <div style={s("display:flex;gap:6px;flex-wrap:wrap")}>
              {[["immediate", "Immediate"], ["le_30", "≤30 days"], ["le_60", "60 days"]].map(([k, label]) => {
                const on = notice.includes(k);
                return (
                  <button key={k}
                    onClick={() => setNotice((p) => on ? p.filter((x) => x !== k) : [...p, k])}
                    style={sx("padding:6px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
                      background: on ? "var(--t1)" : "var(--surface)", color: on ? "var(--surface)" : "var(--t3)",
                      border: `1px solid ${on ? "var(--t1)" : "var(--border-2)"}`,
                    })}>
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Note for your Talentvibes team">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything that would help us pick the right people. Only your Talentvibes team sees this."
              rows={3}
              style={s("width:100%;padding:9px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12px;font-family:inherit;outline:none;resize:vertical;line-height:1.5")}
            />
            <div style={s("font-size:10.5px;color:var(--t4);margin-top:5px")}>
              Shared with your Talentvibes team only. Never passed to a supplier.
            </div>
          </Field>
        </Group>

        {error ? (
          <div style={s("margin-bottom:12px;background:var(--danger-tint);border:1px solid var(--danger-tint);border-radius:9px;padding:11px;font-size:12px;color:var(--danger);font-weight:600")}>
            {error}
          </div>
        ) : null}

        <div style={s("display:flex;align-items:center;gap:9px;padding-top:15px;border-top:1px solid var(--border);flex-wrap:wrap")}>
          <button
            type="button"
            onClick={() => submit("new")}
            disabled={busy !== null}
            style={sx("padding:9px 15px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;background:var(--brand);color:#fff;font-family:inherit", {
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            })}
          >
            {busy === "new" ? "Sending\u2026" : "Send to Talentvibes"}
          </button>
          <button
            type="button"
            onClick={() => submit("draft")}
            disabled={busy !== null}
            style={sx("padding:9px 15px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--surface);font-family:inherit", {
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            })}
          >
            {busy === "draft" ? "Saving\u2026" : "Save draft"}
          </button>
          <div style={s("margin-left:auto;font-size:11.5px;color:var(--t3)")}>
            Typical first shortlist: <strong style={s("font-weight:700")}>36 hours</strong>
          </div>
        </div>
      </div>

      {/* ---------------- right rail ---------------- */}
      <div style={s("display:flex;flex-direction:column;gap:14px")}>
        <div style={s("background:var(--t1);border-radius:12px;padding:16px;color:var(--surface)")}>
          <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
            HOW BROKERING WORKS
          </div>
          <div style={s("display:flex;flex-direction:column;gap:11px;margin-top:12px")}>
            {[
              ["You post, we source", "We search every supplier we work with. None of them sees your company name."],
              ["Masked shortlist", "You review IDs, skills, proctored scores and rate bands only."],
              ["Brokered interviews", "We schedule, relay feedback and hold both commercial conversations."],
              ["One contract", "You contract with Talentvibes. We contract with the supplier."],
            ].map(([title, body], i) => (
              <div key={title} style={s("display:flex;gap:10px")}>
                <div style={sx("width:20px;height:20px;border-radius:6px;background:var(--border);flex:none;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700", { color: "var(--brand)" })}>
                  {i + 1}
                </div>
                <div>
                  <div style={s("font-size:12px;font-weight:700")}>{title}</div>
                  <div style={s("font-size:11px;color:var(--t2);margin-top:2px;line-height:1.5")}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px")}>
          <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
            LIVE MATCH PREVIEW
          </div>
          <div style={s("font-size:11px;color:var(--t4);margin-top:4px")}>
            Updates as you edit. Identities stay hidden.
          </div>
          <div style={sx("font-size:34px;font-weight:800;letter-spacing:-1.2px;margin-top:10px;line-height:1", { opacity: loading ? 0.45 : 1 })}>
            {preview?.matching.label ?? "—"}
          </div>
          <div style={s("font-size:11px;color:var(--t4)")}>bench profiles match</div>

          <div style={s("margin-top:13px;display:flex;flex-direction:column;gap:9px")}>
            {(preview?.bars ?? []).map((b) => (
              <div key={b.label}>
                <div style={s("display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px")}>
                  <span style={s("color:var(--t2)")}>{b.label}</span>
                  <span style={sx("font-weight:700", { fontFamily: TOKENS.mono })}>
                    {b.countLabel} <span style={s("color:var(--t4)")}>({b.pct}%)</span>
                  </span>
                </div>
                <div style={s("height:5px;background:var(--border);border-radius:3px;overflow:hidden")}>
                  <div style={sx("height:100%;background:var(--brand);border-radius:3px", { width: `${b.pct}%` })} />
                </div>
              </div>
            ))}
          </div>

          <div style={s("margin-top:12px;background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:8px;padding:10px;font-size:11px;color:var(--warn);line-height:1.55")}>
            <strong style={s("font-weight:700")}>Tighten your band?</strong> Raising the floor adds
            profiles with higher proctored scores and usually shortens time to shortlist.
          </div>

          {preview ? (
            <div style={s("font-size:10px;color:var(--t4);margin-top:10px;line-height:1.5")}>{preview.note}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s("padding-bottom:15px;margin-bottom:15px;border-bottom:1px solid var(--border)")}>
      <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--t4);margin-bottom:12px", { fontFamily: TOKENS.mono })}>
        {label}
      </div>
      <div style={s("display:flex;flex-direction:column;gap:14px")}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={s("font-size:11.5px;font-weight:600;color:var(--t2);margin-bottom:6px")}>{label}</div>
      {children}
    </div>
  );
}

function Segments({
  options, value, onChange,
}: { options: Array<{ key: string; label: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <div style={s("display:flex;gap:5px;flex-wrap:wrap")}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} onClick={() => onChange(o.key)}
            style={sx("padding:6px 13px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
              background: on ? "var(--t1)" : "var(--surface)", color: on ? "var(--surface)" : "var(--t3)",
              border: `1px solid ${on ? "var(--t1)" : "var(--border-2)"}`,
            })}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={s("width:26px;height:26px;border:1px solid var(--border-2);border-radius:7px;background:var(--surface);font-size:13px;cursor:pointer;color:var(--t2);font-family:inherit;line-height:1;padding:0")}>
      {children}
    </button>
  );
}

function Slider({
  label, value, min, max, onChange,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label style={s("flex:1")}>
      <div style={s("font-size:10px;color:var(--t4);margin-bottom:3px")}>{label}</div>
      <input type="range" min={min} max={max} step={0.05} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={s("width:100%;accent-color:var(--brand)")} />
    </label>
  );
}
