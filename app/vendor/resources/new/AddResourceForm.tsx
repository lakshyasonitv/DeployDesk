"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { s, sx, TOKENS } from "@/src/lib/ui/style";
import { useToast } from "@/src/lib/ui/Toast";

/**
 * The add-resource form. Identity fields are collected but are vendor+ops only —
 * docs/MASKING.md marks candidate name, contacts and employer history as never
 * visible to a client.
 *
 * This form used to have no submit path at all: every field was local state or an
 * uncontrolled `defaultValue`, and both buttons did nothing. It now POSTs to
 * /api/vendor/resources, which allocates the masked id, links the skills and writes the
 * audit row, and the toast's Undo withdraws the listing through the same route's DELETE.
 *
 * Experience is entered the way a bench manager says it ("6 years 4 months") and converted
 * to whole months at the boundary, because the column is `experience_months`. The rate is
 * converted to paise here for the same reason — the API refuses a float (ADR-007).
 */

/** "6 years 4 months" / "6y 4m" / "6.5 years" -> whole months. */
function parseExperienceToMonths(input: string): number | null {
  const text = input.toLowerCase().trim();
  if (!text) return null;
  const y = text.match(/(\d+(?:\.\d+)?)\s*(?:y|year)/);
  const m = text.match(/(\d+)\s*(?:m|month)/);
  if (!y && !m) {
    // A bare number is read as years, which is how people write it.
    const bare = text.match(/^(\d+(?:\.\d+)?)$/);
    if (!bare) return null;
    return Math.round(parseFloat(bare[1]) * 12);
  }
  const months = (y ? parseFloat(y[1]) * 12 : 0) + (m ? parseInt(m[1], 10) : 0);
  return Math.round(months);
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

export function AddResourceForm({
  availableSkills, vendorName, vendorCode,
}: { availableSkills: string[]; vendorName: string; vendorCode: string }) {
  const router = useRouter();
  const toast = useToast();

  const [fullName, setFullName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [baseCity, setBaseCity] = useState("");
  const [experience, setExperience] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [rate, setRate] = useState("");
  const [modes, setModes] = useState<string[]>(["hybrid"]);
  const [availability, setAvailability] = useState("immediate");
  const [busy, setBusy] = useState<null | "listed" | "draft">(null);
  const [error, setError] = useState<string | null>(null);

  const add = (sk: string) => {
    const v = sk.trim();
    if (!v || skills.includes(v)) return;
    setSkills((p) => [...p, v]);
    setDraft("");
  };

  const rateNum = Number(rate.replace(/[^\d]/g, "")) || 0;
  const months = parseExperienceToMonths(experience);

  /**
   * Validated here as well as at the API boundary, and deliberately so: the API's Zod
   * schema is the authority, but telling someone which field is wrong before a round trip
   * is the difference between a form that helps and one that scolds.
   */
  const problems: string[] = [];
  if (fullName.trim().length < 2) problems.push("a full name");
  if (baseCity.trim().length < 2) problems.push("a base city");
  if (months === null) problems.push("total experience, for example \u201c6 years 4 months\u201d");
  if (!skills.length) problems.push("at least one skill");
  if (rateNum < 1000) problems.push("a monthly rate");
  if (!modes.length) problems.push("at least one work mode");

  async function submit(status: "listed" | "draft") {
    if (problems.length) {
      setError(`Still needed: ${problems.join(", ")}.`);
      return;
    }
    setError(null);
    setBusy(status === "listed" ? "listed" : "draft");
    try {
      const res = await fetch("/api/vendor/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          employeeCode: employeeCode.trim() || undefined,
          baseCity: baseCity.trim(),
          experienceMonths: months,
          skills,
          vendorRatePaise: rateNum * 100,   // rupees in the field, paise in the column
          workModes: modes,
          availability,
          status,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error === "invalid_request" ? "Some details were rejected." : "Could not save.");
      }
      const out = await res.json() as { maskedId: string; skillsIgnored?: string[] };

      const ignored = out.skillsIgnored?.length
        ? ` ${out.skillsIgnored.length} skill${out.skillsIgnored.length === 1 ? "" : "s"} not in our list were skipped.`
        : "";

      toast({
        message: status === "listed"
          ? `${fullName.trim()} is on your bench as ${out.maskedId}.${ignored}`
          : `${fullName.trim()} saved as a draft (${out.maskedId}).${ignored}`,
        // Real undo: withdraws the listing and writes a second audit row.
        undo: async () => {
          const r = await fetch("/api/vendor/resources", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ maskedId: out.maskedId }),
          });
          if (!r.ok) throw new Error("withdraw failed");
          router.refresh();
        },
      });

      // Clear the form for the next person rather than leaving the last one in the fields.
      setFullName(""); setEmployeeCode(""); setBaseCity(""); setExperience("");
      setSkills([]); setRate(""); setModes(["hybrid"]); setAvailability("immediate");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px")}>
      <Group label="IDENTITY · INTERNAL ONLY">
        <div style={s("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
          <Field label="Full name">
            <Input value={fullName} onChange={setFullName} placeholder="e.g. Ishita Bansal" />
          </Field>
          <Field label="Employee ID">
            <Input value={employeeCode} onChange={setEmployeeCode} placeholder={`${vendorCode}-3391`} />
          </Field>
        </div>
        <Field label="Base city">
          <Input value={baseCity} onChange={setBaseCity} placeholder="e.g. Pune" />
        </Field>
        <div style={s("background:var(--ok-tint);border:1px solid var(--ok-tint);border-radius:9px;padding:11px")}>
          <div style={s("font-size:11.5px;color:var(--teal);line-height:1.6")}>
            Clients will see this profile as <strong style={s("font-weight:700")}>TV-####</strong>{" "}
            only. The name and {vendorName} are never exposed — not on the shortlist card, not in a
            broker message, not in an interview invitation.
          </div>
        </div>
      </Group>

      <Group label="CAPABILITY">
        <Field label="Skills">
          <div style={s("display:flex;flex-wrap:wrap;gap:5px;align-items:center")}>
            {skills.map((sk) => (
              <span key={sk} style={s("display:inline-flex;align-items:center;gap:6px;padding:4px 9px;background:var(--teal-tint);border-radius:6px;font-size:11.5px;font-weight:600;color:var(--teal)")}>
                {sk}
                <button onClick={() => setSkills((p) => p.filter((x) => x !== sk))}
                  style={s("border:0;background:transparent;color:var(--teal);cursor:pointer;font-size:12px;line-height:1;padding:0;font-family:inherit")}>×</button>
              </span>
            ))}
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }}
              placeholder="Add a skill…" list="vendor-skills"
              style={s("border:0;outline:none;font-size:11.5px;padding:4px;min-width:110px;font-family:inherit")} />
            <datalist id="vendor-skills">
              {availableSkills.map((sk) => <option key={sk} value={sk} />)}
            </datalist>
          </div>
          <div style={s("display:flex;flex-wrap:wrap;gap:5px;margin-top:8px")}>
            {suggestionsFrom(availableSkills, skills).map((sk) => (
              <button key={sk} onClick={() => add(sk)}
                style={s("padding:3px 9px;border:1px solid var(--border-2);border-radius:6px;font-size:11px;background:var(--surface);cursor:pointer;color:var(--t3);font-family:inherit")}>
                + {sk}
              </button>
            ))}
          </div>
        </Field>

        <div style={s("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
          <Field label="Total experience">
            <Input value={experience} onChange={setExperience} placeholder="e.g. 6 years 4 months" />
            {experience && months !== null ? (
              <div style={s("font-size:10.5px;color:var(--t4);margin-top:5px")}>
                Saved as {months} months.
              </div>
            ) : null}
          </Field>
          <Field label="Available from">
            <Segments
              options={[{ key: "immediate", label: "Immediate" }, { key: "30", label: "30 days" }, { key: "dated", label: "A date" }]}
              value={availability} onChange={setAvailability} accent="var(--teal)"
            />
          </Field>
        </div>

        <Field label="Work mode">
          <div style={s("display:flex;gap:6px;flex-wrap:wrap")}>
            {[["onsite", "Onsite"], ["hybrid", "Hybrid"], ["remote", "Remote"]].map(([k, label]) => {
              const on = modes.includes(k);
              return (
                <button key={k} onClick={() => setModes((p) => on ? p.filter((x) => x !== k) : [...p, k])}
                  style={sx("padding:6px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
                    background: on ? "var(--teal)" : "var(--surface)", color: on ? "var(--surface)" : "var(--t3)",
                    border: `1px solid ${on ? "var(--teal)" : "var(--border-2)"}`,
                  })}>
                  {label}
                </button>
              );
            })}
          </div>
        </Field>
      </Group>

      <Group label="YOUR RATE">
        <Field label="Monthly rate to Talentvibes">
          <div style={s("display:flex;align-items:center;gap:9px")}>
            <span style={sx("font-size:14px;font-weight:700", { fontFamily: TOKENS.mono })}>₹</span>
            <input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="145000"
              style={sx("padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:14px;font-weight:700;width:150px;outline:none", { fontFamily: TOKENS.mono })} />
            <span style={s("font-size:11px;color:var(--t4)")}>per month</span>
          </div>
          <div style={s("margin-top:10px;background:var(--ok-tint);border:1px solid var(--ok-tint);border-radius:9px;padding:11px")}>
            <div style={s("font-size:11.5px;color:var(--teal);line-height:1.6")}>
              This is what Talentvibes pays you. You will never see the client-side rate, and the
              client never sees this figure — they see a coarse band derived from the price we quote
              them.
            </div>
          </div>
          {rateNum > 0 ? (
            <div style={s("font-size:10.5px;color:var(--t4);margin-top:7px")}>
              Stored as {rateNum * 100} paise. Money is never a float on this platform.
            </div>
          ) : null}
        </Field>
      </Group>

      <Group label="PROCTORED ASSESSMENT">
        <div style={s("font-size:11.5px;color:var(--t2);line-height:1.6;margin-bottom:10px")}>
          Scored profiles are shortlisted far more often. The score is set by the proctoring
          provider — you cannot edit it, which is exactly why a client trusts it.
        </div>
        <div style={s("display:flex;gap:7px")}>
          <div style={s("padding:8px 13px;border-radius:8px;font-size:12px;font-weight:700;background:var(--t1);color:var(--surface)")}>
            Send test invite now
          </div>
          <div style={s("padding:8px 13px;border:1px solid var(--border-2);border-radius:8px;font-size:12px;font-weight:600;background:var(--surface)")}>
            Schedule for later
          </div>
        </div>
      </Group>

      {error ? (
        <div style={s("margin-bottom:12px;background:var(--danger-tint);border:1px solid var(--danger-tint);border-radius:9px;padding:11px;font-size:12px;color:var(--danger);font-weight:600")}>
          {error}
        </div>
      ) : null}

      <div style={s("display:flex;align-items:center;gap:9px;padding-top:15px;border-top:1px solid var(--border);flex-wrap:wrap")}>
        <button
          type="button"
          onClick={() => submit("listed")}
          disabled={busy !== null}
          style={sx("padding:9px 15px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;color:var(--surface);font-family:inherit", {
            background: "var(--teal)",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          })}
        >
          {busy === "listed" ? "Adding\u2026" : "Add to your bench"}
        </button>
        <button
          type="button"
          onClick={() => submit("draft")}
          disabled={busy !== null}
          style={sx("padding:9px 15px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-weight:600;background:var(--surface);font-family:inherit", {
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          })}
        >
          {busy === "draft" ? "Saving\u2026" : "Save as draft"}
        </button>
        <div style={s("margin-left:auto;font-size:11.5px;color:var(--t3)")}>
          A masked ID is allocated at random when you add someone
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

function Input({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={s("width:100%;padding:8px 11px;border:1px solid var(--border-2);border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")}
    />
  );
}

function Segments({
  options, value, onChange, accent = "var(--t1)",
}: { options: Array<{ key: string; label: string }>; value: string; onChange: (v: string) => void; accent?: string }) {
  return (
    <div style={s("display:flex;gap:5px;flex-wrap:wrap")}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} onClick={() => onChange(o.key)}
            style={sx("padding:6px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
              background: on ? accent : "var(--surface)", color: on ? "var(--surface)" : "var(--t3)",
              border: `1px solid ${on ? accent : "var(--border-2)"}`,
            })}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
