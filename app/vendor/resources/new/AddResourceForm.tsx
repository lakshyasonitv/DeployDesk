"use client";

import { useState } from "react";
import { s, sx, TOKENS } from "@/src/lib/ui/style";

/**
 * The add-resource form. Identity fields are collected but are vendor+ops only —
 * docs/MASKING.md marks candidate name, contacts and employer history as never
 * visible to a client.
 */

const SUGGESTED = ["Java Spring Boot", "Microservices", "PostgreSQL", "Kafka", "AWS", "React"];

export function AddResourceForm({
  availableSkills, vendorName, vendorCode,
}: { availableSkills: string[]; vendorName: string; vendorCode: string }) {
  const [skills, setSkills] = useState<string[]>(["Java Spring Boot", "Microservices", "PostgreSQL"]);
  const [draft, setDraft] = useState("");
  const [rate, setRate] = useState("145000");
  const [modes, setModes] = useState<string[]>(["hybrid", "remote"]);
  const [availability, setAvailability] = useState("immediate");

  const add = (sk: string) => {
    const v = sk.trim();
    if (!v || skills.includes(v)) return;
    setSkills((p) => [...p, v]);
    setDraft("");
  };

  const rateNum = Number(rate.replace(/[^\d]/g, "")) || 0;

  return (
    <div style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:20px")}>
      <Group label="IDENTITY · INTERNAL ONLY">
        <div style={s("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
          <Field label="Full name">
            <Input defaultValue="Ishita Bansal" />
          </Field>
          <Field label="Employee ID">
            <Input defaultValue={`${vendorCode}-3391`} />
          </Field>
        </div>
        <Field label="Base city">
          <Input defaultValue="Pune" />
        </Field>
        <div style={s("background:#f6fdfa;border:1px solid #cfe9dd;border-radius:9px;padding:11px")}>
          <div style={s("font-size:11.5px;color:#0f766e;line-height:1.6")}>
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
              <span key={sk} style={s("display:inline-flex;align-items:center;gap:6px;padding:4px 9px;background:#e6fffa;border-radius:6px;font-size:11.5px;font-weight:600;color:#0d9488")}>
                {sk}
                <button onClick={() => setSkills((p) => p.filter((x) => x !== sk))}
                  style={s("border:0;background:transparent;color:#0d9488;cursor:pointer;font-size:12px;line-height:1;padding:0;font-family:inherit")}>×</button>
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
            {SUGGESTED.filter((sk) => !skills.includes(sk)).map((sk) => (
              <button key={sk} onClick={() => add(sk)}
                style={s("padding:3px 9px;border:1px solid #e0e0e8;border-radius:6px;font-size:11px;background:#fff;cursor:pointer;color:#6b6b78;font-family:inherit")}>
                + {sk}
              </button>
            ))}
          </div>
        </Field>

        <div style={s("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
          <Field label="Total experience">
            <Input defaultValue="6 years 4 months" />
          </Field>
          <Field label="Available from">
            <Segments
              options={[{ key: "immediate", label: "Immediate" }, { key: "30", label: "30 days" }, { key: "dated", label: "A date" }]}
              value={availability} onChange={setAvailability} accent="#0d9488"
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
                    background: on ? "#0d9488" : "#fff", color: on ? "#fff" : "#6b6b78",
                    border: `1px solid ${on ? "#0d9488" : "#e0e0e8"}`,
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
            <input value={rate} onChange={(e) => setRate(e.target.value)}
              style={sx("padding:8px 11px;border:1px solid #e0e0e8;border-radius:8px;font-size:14px;font-weight:700;width:150px;outline:none", { fontFamily: TOKENS.mono })} />
            <span style={s("font-size:11px;color:#8a8a96")}>per month</span>
          </div>
          <div style={s("margin-top:10px;background:#f6fdfa;border:1px solid #cfe9dd;border-radius:9px;padding:11px")}>
            <div style={s("font-size:11.5px;color:#0f766e;line-height:1.6")}>
              This is what Talentvibes pays you. You will never see the client-side rate, and the
              client never sees this figure — they see a coarse band derived from the price we quote
              them.
            </div>
          </div>
          {rateNum > 0 ? (
            <div style={s("font-size:10.5px;color:#8a8a96;margin-top:7px")}>
              Stored as {rateNum * 100} paise. Money is never a float on this platform.
            </div>
          ) : null}
        </Field>
      </Group>

      <Group label="PROCTORED ASSESSMENT">
        <div style={s("font-size:11.5px;color:#4a4a58;line-height:1.6;margin-bottom:10px")}>
          Scored profiles are shortlisted far more often. The score is set by the proctoring
          provider — you cannot edit it, which is exactly why a client trusts it.
        </div>
        <div style={s("display:flex;gap:7px")}>
          <div style={s("padding:8px 13px;border-radius:8px;font-size:12px;font-weight:700;background:#101014;color:#fff")}>
            Send test invite now
          </div>
          <div style={s("padding:8px 13px;border:1px solid #e0e0e8;border-radius:8px;font-size:12px;font-weight:600;background:#fff")}>
            Schedule for later
          </div>
        </div>
      </Group>

      <div style={s("display:flex;align-items:center;gap:9px;padding-top:15px;border-top:1px solid #eeeef3")}>
        <button style={s("padding:9px 15px;border:0;border-radius:8px;font-size:12.5px;font-weight:700;background:#0d9488;color:#fff;cursor:pointer;font-family:inherit")}>
          List on exchange
        </button>
        <button style={s("padding:9px 15px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-weight:600;background:#fff;cursor:pointer;font-family:inherit")}>
          Save as draft
        </button>
        <div style={s("margin-left:auto;font-size:11.5px;color:#6b6b78")}>
          A masked ID is allocated at random on listing
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s("padding-bottom:15px;margin-bottom:15px;border-bottom:1px solid #eeeef3")}>
      <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:#8a8a96;margin-bottom:12px", { fontFamily: TOKENS.mono })}>
        {label}
      </div>
      <div style={s("display:flex;flex-direction:column;gap:14px")}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={s("font-size:11.5px;font-weight:600;color:#4a4a58;margin-bottom:6px")}>{label}</div>
      {children}
    </div>
  );
}

function Input({ defaultValue }: { defaultValue?: string }) {
  return (
    <input defaultValue={defaultValue}
      style={s("width:100%;padding:8px 11px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-family:inherit;outline:none")} />
  );
}

function Segments({
  options, value, onChange, accent = "#101014",
}: { options: Array<{ key: string; label: string }>; value: string; onChange: (v: string) => void; accent?: string }) {
  return (
    <div style={s("display:flex;gap:5px;flex-wrap:wrap")}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} onClick={() => onChange(o.key)}
            style={sx("padding:6px 12px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit", {
              background: on ? accent : "#fff", color: on ? "#fff" : "#6b6b78",
              border: `1px solid ${on ? accent : "#e0e0e8"}`,
            })}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
