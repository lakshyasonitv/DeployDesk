import Link from "next/link";
import type { ReactNode } from "react";
import { s, sx, TOKENS, ACCENT, ACCENT_GRADIENT, PORTAL_TAG } from "./style";

/**
 * The global shell: sidebar + content column. Applies to all three portals.
 *
 * Markup and every value here come from design_handoff_bench_exchange/README.md
 * § "Global shell". The portal switcher at the bottom is a DEMO AFFORDANCE ONLY — in
 * production a user belongs to exactly one organisation and auth decides which shell
 * they get (docs/ARCHITECTURE.md, Tenancy).
 *
 * NOTE for anyone adding a page-level leak test over rendered HTML: this switcher is the
 * ONE place a counterpart organisation name appears in the markup of every portal
 * ("Client · Acme Finserv" is in the vendor portal's sidebar). It is hardcoded UI, not
 * read-model output, which is why the read-model leak suite passes. Delete the switcher
 * with the demo, or exclude it explicitly — do not relax the assertion to accommodate it.
 */

export type Portal = "client" | "vendor" | "ops";

export interface NavItem {
  href: string;
  label: string;
  badge?: string | number;
  active?: boolean;
}

export interface AsideItem {
  label: string;
  dot: string;
}

const NAV: Record<Portal, Array<{ href: string; label: string; key: string }>> = {
  client: [
    { href: "/client", label: "Overview", key: "overview" },
    { href: "/client/requirements", label: "Requirements", key: "requirements" },
    { href: "/client/shortlists", label: "Shortlists", key: "shortlists" },
    { href: "/client/interviews", label: "Interviews", key: "interviews" },
    { href: "/client/engagements", label: "Engagements", key: "engagements" },
  ],
  vendor: [
    { href: "/vendor", label: "Overview", key: "overview" },
    { href: "/vendor/resources/new", label: "Add resource", key: "add" },
    { href: "/vendor/roster", label: "Bench roster", key: "roster" },
    { href: "/vendor/assessments", label: "Assessments", key: "assessments" },
    { href: "/vendor/earnings", label: "Earnings", key: "earnings" },
  ],
  ops: [
    { href: "/ops", label: "Pipeline", key: "pipeline" },
    { href: "/ops/matching", label: "Matching", key: "matching" },
    { href: "/ops/pool", label: "Talent pool", key: "pool" },
    { href: "/ops/margin", label: "Margin", key: "margin" },
    { href: "/ops/duplicates", label: "Duplicates", key: "duplicates" },
  ],
};

/** Who is signed in. Comes from the session, never from a table in this file. */
export interface ShellUser {
  name: string;
  org: string;
}

const SWITCHER: Array<{ portal: Portal; href: string; label: string }> = [
  { portal: "client", href: "/client", label: "Client · Acme Finserv" },
  { portal: "vendor", href: "/vendor", label: "Vendor · Nimbus" },
  { portal: "ops", href: "/ops", label: "Talentvibes Ops" },
];

export function Shell({
  portal,
  activeKey,
  user,
  badges = {},
  asideTitle,
  asideItems = [],
  children,
}: {
  portal: Portal;
  activeKey: string;
  user: ShellUser;
  badges?: Record<string, string | number | undefined>;
  asideTitle: string;
  asideItems?: AsideItem[];
  children: ReactNode;
}) {
  const accent = ACCENT[portal];

  return (
    <div style={s("display:flex;height:100vh;min-height:720px;background:#f7f7f9;color:#101014;overflow:hidden")}>
      {/* ---------------- sidebar ---------------- */}
      <div style={s("width:222px;flex:none;background:#111114;color:#fff;display:flex;flex-direction:column;padding:16px 0;overflow:hidden")}>
        <div style={s("padding:0 16px 14px;display:flex;align-items:center;gap:9px")}>
          <div style={sx("width:22px;height:22px;border-radius:6px;flex:none", { background: ACCENT_GRADIENT[portal] })} />
          <div>
            <div style={s("font-weight:800;font-size:13px;letter-spacing:-.3px")}>Bench Exchange</div>
            <div style={sx("font-size:9px;font-weight:600;letter-spacing:.12em;color:#6c6c78;margin-top:2px", { fontFamily: TOKENS.mono })}>
              {PORTAL_TAG[portal]}
            </div>
          </div>
        </div>

        <div style={s("margin:0 12px 12px;padding:6px 9px;border:1px solid #26262c;border-radius:7px;display:flex;align-items:center;justify-content:space-between;color:#8b8b96;font-size:12px")}>
          Search
          <span style={sx("font-size:10px;font-weight:500;border:1px solid #33333b;border-radius:4px;padding:1px 5px", { fontFamily: TOKENS.mono })}>
            ⌘K
          </span>
        </div>

        <div style={s("padding:0 8px;display:flex;flex-direction:column;gap:2px")}>
          {NAV[portal].map((n) => {
            const active = n.key === activeKey;
            const badge = badges[n.key];
            return (
              <Link
                key={n.key}
                href={n.href}
                style={sx(
                  "padding:7px 10px;border-radius:7px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:8px;white-space:nowrap",
                  {
                    background: active ? "#1e1e26" : "transparent",
                    color: active ? "#fff" : "#a0a0ac",
                    fontWeight: active ? 700 : 500,
                  },
                )}
              >
                {n.label}
                <span style={sx("font-size:10.5px;font-weight:600", { fontFamily: TOKENS.mono, color: active ? accent : "#6c6c78" })}>
                  {badge ?? ""}
                </span>
              </Link>
            );
          })}
        </div>

        <div style={sx("margin:16px 12px 0;padding-top:13px;border-top:1px solid #26262c;font-size:9px;font-weight:700;letter-spacing:.14em;color:#5c5c68", { fontFamily: TOKENS.mono })}>
          {asideTitle}
        </div>
        <div style={s("padding:9px 12px;display:flex;flex-direction:column;gap:8px;overflow:hidden")}>
          {asideItems.map((a, i) => (
            <div key={i} style={s("display:flex;align-items:center;gap:7px")}>
              <div style={sx("width:5px;height:5px;border-radius:50%;flex:none", { background: a.dot })} />
              <div style={s("font-size:11.5px;color:#a0a0ac;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                {a.label}
              </div>
            </div>
          ))}
        </div>

        <div style={s("margin-top:auto;padding:12px;border-top:1px solid #26262c")}>
          <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:#5c5c68;padding:0 4px 8px", { fontFamily: TOKENS.mono })}>
            DEMO · SWITCH PORTAL
          </div>
          <div style={s("display:flex;flex-direction:column;gap:3px")}>
            {SWITCHER.map((p) => {
              const active = p.portal === portal;
              return (
                <Link
                  key={p.portal}
                  href={p.href}
                  style={sx("padding:6px 9px;border-radius:6px;font-size:12px;display:flex;align-items:center;gap:8px", {
                    background: active ? "#1e1e26" : "transparent",
                    color: active ? "#fff" : "#8b8b96",
                    fontWeight: active ? 700 : 500,
                  })}
                >
                  <div style={sx("width:6px;height:6px;border-radius:2px", { background: ACCENT[p.portal] })} />
                  {p.label}
                </Link>
              );
            })}
          </div>
          <div style={s("margin-top:10px;padding-top:10px;border-top:1px solid #26262c;display:flex;align-items:center;gap:9px")}>
            <div style={s("width:24px;height:24px;border-radius:50%;background:#3b3b45;flex:none")} />
            <div style={s("min-width:0")}>
              <div style={s("font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                {user.name}
              </div>
              <div style={s("font-size:10.5px;color:#6c6c78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                {user.org}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- content column ---------------- */}
      <div style={s("flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden")}>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={s("padding:20px 26px 16px;background:#fff;border-bottom:1px solid #e8e8ee;flex:none")}>
      <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px")}>
        <div style={s("min-width:0")}>
          <div style={s("font-size:22px;font-weight:800;letter-spacing:-.6px")}>{title}</div>
          {subtitle ? (
            <div style={s("font-size:12.5px;color:#6b6b78;margin-top:4px")}>{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div style={s("display:flex;gap:8px;flex:none")}>{actions}</div> : null}
      </div>
    </div>
  );
}

export function Scroll({ children }: { children: ReactNode }) {
  return <div style={s("flex:1;overflow:auto;padding:20px 26px 30px")}>{children}</div>;
}

export function Button({
  children, href, primary, accent,
}: { children: ReactNode; href?: string; primary?: boolean; accent?: string }) {
  const style = primary
    ? sx("padding:8px 13px;border-radius:8px;font-size:12.5px;font-weight:700;color:#fff", {
        background: accent ?? TOKENS.primary,
      })
    : s("padding:8px 13px;border:1px solid #e0e0e8;border-radius:8px;font-size:12.5px;font-weight:600;background:#fff;color:#101014");
  return href ? <Link href={href} style={style}>{children}</Link> : <div style={style}>{children}</div>;
}

export function StatCard({
  label, value, delta, deltaColor, sub,
}: { label: string; value: string | number; delta?: string; deltaColor?: string; sub?: string }) {
  return (
    <div style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:15px")}>
      <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.12em;color:#8a8a96", { fontFamily: TOKENS.mono })}>
        {label}
      </div>
      <div style={s("display:flex;align-items:baseline;gap:7px;margin-top:7px")}>
        <div style={s("font-size:25px;font-weight:800;letter-spacing:-.8px;line-height:1")}>{value}</div>
        {delta ? (
          <div style={sx("font-size:11.5px;font-weight:700", { color: deltaColor ?? "#8a8a96" })}>{delta}</div>
        ) : null}
      </div>
      {sub ? <div style={s("font-size:11.5px;color:#8a8a96;margin-top:6px")}>{sub}</div> : null}
    </div>
  );
}

export function Card({ children, pad = "15px" }: { children: ReactNode; pad?: string }) {
  return (
    <div style={sx("background:#fff;border:1px solid #e8e8ee;border-radius:12px", { padding: pad })}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.14em;color:#8a8a96;margin-bottom:9px", { fontFamily: TOKENS.mono })}>
      {children}
    </div>
  );
}

export function Pill({
  children, bg, fg, border,
}: { children: ReactNode; bg: string; fg: string; border?: string }) {
  return (
    <span style={sx("display:inline-block;padding:3px 8px;border-radius:999px;font-size:9.5px;font-weight:700;letter-spacing:.08em;white-space:nowrap", {
      background: bg, color: fg, border: border ? `1px solid ${border}` : undefined,
      fontFamily: TOKENS.mono,
    })}>
      {children}
    </span>
  );
}

export function Mono({ children, size = 11, color }: { children: ReactNode; size?: number; color?: string }) {
  return (
    <span style={sx("font-weight:600", { fontFamily: TOKENS.mono, fontSize: `${size}px`, color })}>
      {children}
    </span>
  );
}

/** The four-section proctored score breakdown, as bars. */
export function ScoreBars({
  sections, width = 150,
}: {
  sections: { coding: number | null; dsa: number | null; systemDesign: number | null; communication: number | null };
  width?: number;
}) {
  const rows: Array<[string, number | null]> = [
    ["COD", sections.coding],
    ["DSA", sections.dsa],
    ["SYS", sections.systemDesign],
    ["COM", sections.communication],
  ];
  return (
    <div style={sx("display:flex;flex-direction:column;gap:4px", { width: `${width}px` })}>
      {rows.map(([label, v]) => (
        <div key={label} style={s("display:flex;align-items:center;gap:7px")}>
          <div style={sx("font-size:8.5px;font-weight:700;letter-spacing:.08em;color:#8a8a96;width:24px;flex:none", { fontFamily: TOKENS.mono })}>
            {label}
          </div>
          <div style={s("flex:1;height:4px;background:#eeeef3;border-radius:3px;overflow:hidden")}>
            <div style={sx("height:100%;border-radius:3px", {
              width: `${v ?? 0}%`,
              background: (v ?? 0) >= 85 ? "#16a34a" : (v ?? 0) >= 70 ? "#6d3ff0" : "#c2410c",
            })} />
          </div>
          <div style={sx("font-size:9.5px;font-weight:700;width:20px;text-align:right;flex:none", { fontFamily: TOKENS.mono })}>
            {v ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={s("background:#fff;border:1px dashed #e0e0e8;border-radius:12px;padding:34px;text-align:center;color:#8a8a96;font-size:12.5px")}>
      {children}
    </div>
  );
}
