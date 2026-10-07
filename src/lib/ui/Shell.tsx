import Link from "next/link";
import type { ReactNode } from "react";
import {
  LayoutGrid, FileText, Users, Calendar, Briefcase,
  Upload, List, ClipboardCheck, Wallet,
  Columns3, Target, Database, BarChart2, AlertTriangle,
  HelpCircle, MoreHorizontal, ChevronDown, Building2, Briefcase as BriefcaseIcon,
} from "lucide-react";
import { s, sx, TOKENS, PORTAL_TAG, GROUP_LABEL, BRAND } from "./style";
import type { WorkspaceTab } from "../auth/workspace";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The global shell: sidebar + top bar + content column. Applies to all three portals.
 *
 * Every value here comes from design_handoff_bench_exchange_v2/README.md § "App shell"
 * and DESIGN_TOKENS.md. Colours are CSS variables, never literals, so the light/dark
 * toggle re-themes this file without it knowing which theme is active.
 *
 * This replaced the v1 shell, whose sidebar was a fixed dark panel (#111114 with #fff
 * text). v2's sidebar is `--surface` — white in light mode, near-black in dark. That is
 * why this file could not be migrated by substituting hex values: `color:#fff` on the old
 * sidebar maps to `--surface`, which would have been white text on a white sidebar.
 *
 * The portal switcher is a DEMO AFFORDANCE ONLY — in production a user belongs to exactly
 * one organisation and auth decides which shell they get (docs/ARCHITECTURE.md, Tenancy).
 * v2 moves it from the sidebar to the top bar and tags it "DEMO".
 *
 * NOTE for anyone adding a page-level leak test over rendered HTML: this switcher is the
 * ONE place a counterpart organisation name appears in the markup of every portal
 * ("Client · Acme Finserv" is in the vendor portal's top bar). It is hardcoded UI, not
 * read-model output, which is why the read-model leak suite passes. Delete the switcher
 * with the demo, or exclude it explicitly — do not relax the assertion to accommodate it.
 */

export type Portal = "client" | "vendor" | "ops";

export interface AsideItem {
  label: string;
  dot: string;
  /** Optional second line, 11.5px --t4. v2 gives each attention item a sub-line. */
  sub?: string;
}

/**
 * Nav labels use v2's plain language, because the users include non-technical HR staff:
 * "Open roles" not "Requirements", "People working" not "Engagements", "Skill tests" not
 * "Assessments". The `key` is the stable identifier the pages pass as `activeKey` and the
 * read models use for badge counts — renaming a label must never change a key.
 */
const NAV: Record<
  Portal,
  Array<{ href: string; label: string; key: string; Icon: typeof LayoutGrid }>
> = {
  client: [
    { href: "/client", label: "Overview", key: "overview", Icon: LayoutGrid },
    { href: "/client/requirements", label: "Open roles", key: "requirements", Icon: FileText },
    { href: "/client/shortlists", label: "Candidate shortlists", key: "shortlists", Icon: Users },
    { href: "/client/interviews", label: "Interviews", key: "interviews", Icon: Calendar },
    { href: "/client/engagements", label: "People working", key: "engagements", Icon: Briefcase },
  ],
  vendor: [
    { href: "/vendor", label: "Overview", key: "overview", Icon: LayoutGrid },
    { href: "/vendor/resources/new", label: "Add people", key: "add", Icon: Upload },
    { href: "/vendor/roster", label: "Bench roster", key: "roster", Icon: List },
    { href: "/vendor/assessments", label: "Skill tests", key: "assessments", Icon: ClipboardCheck },
    { href: "/vendor/earnings", label: "Your earnings", key: "earnings", Icon: Wallet },
  ],
  ops: [
    { href: "/ops", label: "Role pipeline", key: "pipeline", Icon: Columns3 },
    { href: "/ops/matching", label: "Matching desk", key: "matching", Icon: Target },
    { href: "/ops/pool", label: "Talent pool", key: "pool", Icon: Database },
    { href: "/ops/margin", label: "Margin", key: "margin", Icon: BarChart2 },
    { href: "/ops/duplicates", label: "Duplicate checks", key: "duplicates", Icon: AlertTriangle },
  ],
};

/** Who is signed in. Comes from the session, never from a table in this file. */
export interface ShellUser {
  name: string;
  org: string;
}

/**
 * Demo switcher entries, resolved from the database by getShellNav().
 *
 * These are ORGANISATIONS, not portals. The old three-portal list could not express a
 * dual-role company — one organisation on two sides — which is the whole point of the
 * feature. Picking an organisation and letting the workspace tabs choose the side is also
 * closer to production, where a user has one organisation and no portal choice at all.
 */
export interface SwitcherOption {
  orgId: string;
  orgName: string;
  href: string;
  role: string;
  active: boolean;
}

/** Initials for the 32px footer avatar. "Anita Mehta" -> "AM". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function Shell({
  portal,
  activeKey,
  user,
  identities = [],
  badges = {},
  asideTitle,
  asideItems = [],
  workspaces = [],
  children,
}: {
  portal: Portal;
  activeKey: string;
  user: ShellUser;
  identities?: SwitcherOption[];
  badges?: Record<string, string | number | undefined>;
  asideTitle: string;
  asideItems?: AsideItem[];
  /**
   * The dual-role "Hiring | Bench" tabs, or EMPTY when there is nothing to switch
   * between. Empty renders nothing at all — a supply-only organisation must see no hint
   * that a hiring side exists, and a lone inert tab is exactly such a hint.
   */
  workspaces?: WorkspaceTab[];
  children: ReactNode;
}) {
  const active = NAV[portal].find((n) => n.key === activeKey);

  return (
    <div style={s("display:flex;height:100vh;min-height:720px;background:var(--bg);color:var(--t1);overflow:hidden")}>
      {/* ================================ sidebar, 260px ================== */}
      <div style={s("width:260px;flex:none;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:16px 0;overflow:hidden")}>
        {/* logo lockup — 30x30 brand tile, name and byline, never wrapping */}
        <div style={s("padding:0 16px 14px;display:flex;align-items:center;gap:10px")}>
          <div style={s("width:30px;height:30px;border-radius:9px;flex:none;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800")}>
            T
          </div>
          <div style={s("min-width:0")}>
            <div style={s("font-size:14.5px;font-weight:800;letter-spacing:-.3px;white-space:nowrap")}>
              {BRAND.name}
            </div>
            <div style={s("font-size:11.5px;color:var(--t3);white-space:nowrap")}>
              by {BRAND.by}
            </div>
          </div>
        </div>

        {/* search — opens the command palette (wired in 7b) */}
        <div style={s("margin:0 12px 14px;height:38px;padding:0 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;display:flex;align-items:center;justify-content:space-between;color:var(--t4);font-size:13px")}>
          Search or jump to…
          <span style={sx("font-size:11px;font-weight:500;border:1px solid var(--border-2);border-radius:5px;padding:1px 5px;color:var(--t3)", { fontFamily: TOKENS.mono })}>
            ⌘K
          </span>
        </div>

        <div style={s("padding:0 12px 6px;font-size:10.5px;font-weight:700;letter-spacing:.09em;color:var(--t4)")}>
          {GROUP_LABEL[portal]}
        </div>

        <div style={s("padding:0 8px;display:flex;flex-direction:column;gap:2px")}>
          {NAV[portal].map((n) => {
            const on = n.key === activeKey;
            const badge = badges[n.key];
            return (
              <Link
                key={n.key}
                href={n.href}
                style={sx(
                  "height:38px;padding:0 10px;border-radius:10px;font-size:13.5px;display:flex;align-items:center;gap:10px;white-space:nowrap",
                  {
                    background: on ? "var(--brand-tint)" : "transparent",
                    color: on ? "var(--brand-ink)" : "var(--t2)",
                    fontWeight: on ? 700 : 500,
                  },
                )}
              >
                <n.Icon size={17} strokeWidth={1.75} style={{ flex: "none" }} />
                <span style={s("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis")}>{n.label}</span>
                {badge ? (
                  <span style={sx("font-size:11.5px;font-weight:700;border-radius:999px;padding:1px 7px;flex:none", {
                    background: on ? "var(--surface)" : "var(--surface-3)",
                    color: on ? "var(--brand-ink)" : "var(--t3)",
                  })}>
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>

        {/* NEEDS ATTENTION / TODAY'S QUEUE */}
        <div style={s("margin:18px 12px 0;padding-top:14px;border-top:1px solid var(--border);font-size:10.5px;font-weight:700;letter-spacing:.09em;color:var(--t4)")}>
          {asideTitle}
        </div>
        <div style={s("padding:9px 12px;display:flex;flex-direction:column;gap:9px;overflow:hidden")}>
          {asideItems.map((a, i) => (
            <div key={i} style={s("display:flex;align-items:flex-start;gap:8px;min-width:0")}>
              <div style={sx("width:6px;height:6px;border-radius:50%;flex:none;margin-top:5px", { background: a.dot })} />
              <div style={s("min-width:0")}>
                <div style={s("font-size:12.5px;font-weight:600;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                  {a.label}
                </div>
                {a.sub ? (
                  <div style={s("font-size:11.5px;color:var(--t4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                    {a.sub}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* user footer */}
        <div style={s("margin-top:auto;padding:12px 14px 2px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px")}>
          <div style={s("width:32px;height:32px;border-radius:50%;background:var(--surface-3);color:var(--t2);flex:none;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700")}>
            {initials(user.name)}
          </div>
          <div style={s("min-width:0;flex:1")}>
            <div style={s("font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
              {user.name}
            </div>
            <div style={s("font-size:11.5px;color:var(--t4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
              {user.org}
            </div>
          </div>
          <MoreHorizontal size={16} strokeWidth={1.75} style={{ flex: "none", color: "var(--t4)" }} />
        </div>
      </div>

      {/* ============================ content column ====================== */}
      <div style={s("flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden")}>
        {/* ---- top bar, 60px ---- */}
        <div style={s("height:60px;flex:none;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;padding:0 24px")}>
          {/* breadcrumb: the portal part truncates, the screen name never does */}
          <div style={s("display:flex;align-items:center;gap:7px;min-width:0;font-size:13px")}>
            <span style={s("color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
              {PORTAL_TAG[portal]} · {user.org}
            </span>
            <span style={s("color:var(--t4);flex:none")}>›</span>
            <span style={s("font-weight:700;flex:none;white-space:nowrap")}>{active?.label ?? ""}</span>
          </div>

          {/*
            Dual-role workspace switcher — a PRODUCTION feature (ADR-012), unlike the demo
            portal switcher below it. It stays inside one organisation and changes which
            side of the exchange you are looking at. The two must not be merged.

            It renders only when there are two or more sides. `workspaceTabs()` returns an
            empty array for a single-side organisation precisely so that nothing appears
            here: a disabled or greyed "Hiring" tab would tell a supply-only company that
            a hiring side exists, which the brief forbids.
          */}
          {workspaces.length > 1 ? (
            <div
              role="group"
              aria-label="Workspace"
              style={s("display:flex;gap:2px;flex:none;padding:3px;background:var(--surface-3);border-radius:10px")}
            >
              {workspaces.map((w) => (
                <Link
                  key={w.side}
                  href={w.href}
                  aria-current={w.active ? "page" : undefined}
                  style={sx("display:flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:8px;font-size:12.5px;white-space:nowrap", {
                    background: w.active ? "var(--surface)" : "transparent",
                    color: w.active ? "var(--t1)" : "var(--t3)",
                    fontWeight: w.active ? 700 : 500,
                    boxShadow: w.active ? "var(--sh)" : undefined,
                  })}
                >
                  {w.side === "hiring"
                    ? <BriefcaseIcon size={14} strokeWidth={1.75} />
                    : <Building2 size={14} strokeWidth={1.75} />}
                  {w.label}
                </Link>
              ))}
            </div>
          ) : null}

          <div style={s("flex:1")} />

          {/*
            Demo organisation switcher — DEMO ONLY, deleted with the demo. In production a
            user belongs to exactly one organisation and never sees this. The dual-role
            workspace tabs above it are a different thing and ARE a production feature.
          */}
          {identities.length > 1 ? (
            <div style={s("display:flex;align-items:center;gap:8px;flex:none;height:32px;padding:0 10px;border:1px solid var(--border);border-radius:9px;min-width:0")}>
              <span style={sx("font-size:9.5px;font-weight:700;letter-spacing:.08em;color:var(--t4);border:1px solid var(--border-2);border-radius:4px;padding:1px 4px;flex:none", { fontFamily: TOKENS.mono })}>
                DEMO
              </span>
              <span style={s("font-size:12.5px;color:var(--t3);white-space:nowrap;flex:none")}>Acting as</span>
              <div style={s("display:flex;gap:3px;min-width:0")}>
                {identities.map((p) => (
                  /*
                   * A plain <a>, NOT next/link — and this is load-bearing.
                   *
                   * `p.href` points at /demo/act-as, which is a ROUTE HANDLER, not a page.
                   * It answers with a 307 and a Set-Cookie. next/link performs a
                   * client-side RSC navigation: it fetches the destination expecting a
                   * flight payload, gets a redirect to an HTML page instead, and the
                   * transition silently does nothing — which is exactly how this bug
                   * presented ("the Acting as names are not clickable").
                   *
                   * next/link also PREFETCHES by default, so simply rendering this bar
                   * would have issued a GET to the handler and set the cookie with no
                   * click at all. A full browser navigation is what is wanted here: it
                   * follows the redirect and honours Set-Cookie.
                   *
                   * Rule of thumb: next/link for pages, <a> for route handlers.
                   */
                  <a
                    key={p.orgId}
                    href={p.href}
                    title={`${p.orgName} — ${p.role}`}
                    style={sx("font-size:12.5px;font-weight:700;padding:2px 8px;border-radius:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px", {
                      background: p.active ? "var(--brand-tint)" : "transparent",
                      color: p.active ? "var(--brand-ink)" : "var(--t3)",
                    })}
                  >
                    {p.orgName}
                  </a>
                ))}
              </div>
              <ChevronDown size={14} strokeWidth={1.75} style={{ color: "var(--t4)", flex: "none" }} />
            </div>
          ) : null}

          <ThemeToggle />

          <div
            title="How Talentvibes works"
            style={s("width:32px;height:30px;border:1px solid var(--border);border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--t3);flex:none")}
          >
            <HelpCircle size={15} strokeWidth={1.75} />
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  Shared pieces                                                          */
/* ====================================================================== */

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={s("padding:22px 24px 18px;background:var(--surface);border-bottom:1px solid var(--border);flex:none")}>
      <div style={s("display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap")}>
        <div style={s("min-width:0")}>
          <div style={s("font-size:26px;font-weight:800;letter-spacing:-.6px")}>{title}</div>
          {subtitle ? (
            <div style={s("font-size:14px;color:var(--t2);margin-top:4px")}>{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div style={s("display:flex;gap:8px;flex:none")}>{actions}</div> : null}
      </div>
    </div>
  );
}

export function Scroll({ children }: { children: ReactNode }) {
  return <div style={s("flex:1;overflow:auto;padding:20px 24px 32px")}>{children}</div>;
}

export function Button({
  children, href, primary, accent,
}: { children: ReactNode; href?: string; primary?: boolean; accent?: string }) {
  const style = primary
    ? sx("padding:0 14px;height:38px;display:inline-flex;align-items:center;border-radius:10px;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;box-shadow:var(--sh)", {
        background: accent ?? "var(--brand)",
      })
    : s("padding:0 14px;height:38px;display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:10px;font-size:13px;font-weight:600;background:var(--surface);color:var(--t1);white-space:nowrap");
  return href ? <Link href={href} style={style}>{children}</Link> : <div style={style}>{children}</div>;
}

export function StatCard({
  label, value, delta, deltaColor, sub,
}: { label: string; value: string | number; delta?: string; deltaColor?: string; sub?: string }) {
  return (
    <div style={s("background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:17px;box-shadow:var(--sh)")}>
      <div style={s("font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--t3);text-transform:uppercase")}>
        {label}
      </div>
      <div style={s("display:flex;align-items:baseline;gap:7px;margin-top:8px")}>
        <div style={s("font-size:28px;font-weight:800;letter-spacing:-1px;line-height:1")}>{value}</div>
        {delta ? (
          <div style={sx("font-size:11.5px;font-weight:700", { color: deltaColor ?? "var(--t4)" })}>{delta}</div>
        ) : null}
      </div>
      {sub ? <div style={s("font-size:11.5px;color:var(--t4);margin-top:6px")}>{sub}</div> : null}
    </div>
  );
}

export function Card({ children, pad = "18px" }: { children: ReactNode; pad?: string }) {
  return (
    <div style={sx("background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh)", { padding: pad })}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={s("font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--t3);text-transform:uppercase;margin-bottom:9px")}>
      {children}
    </div>
  );
}

export function Pill({
  children, bg, fg, border,
}: { children: ReactNode; bg: string; fg: string; border?: string }) {
  return (
    <span style={sx("display:inline-block;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap", {
      background: bg, color: fg, border: border ? `1px solid ${border}` : undefined,
    })}>
      {children}
    </span>
  );
}

export function Mono({ children, size = 12, color }: { children: ReactNode; size?: number; color?: string }) {
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
          <div style={sx("font-size:9.5px;font-weight:700;letter-spacing:.08em;color:var(--t4);width:26px;flex:none", { fontFamily: TOKENS.mono })}>
            {label}
          </div>
          <div style={s("flex:1;height:4px;background:var(--surface-3);border-radius:3px;overflow:hidden")}>
            <div style={sx("height:100%;border-radius:3px", {
              width: `${v ?? 0}%`,
              // Colour means status only: >=85 good, >=70 neutral brand, below that attention.
              background: (v ?? 0) >= 85 ? "var(--ok)" : (v ?? 0) >= 70 ? "var(--brand)" : "var(--warn)",
            })} />
          </div>
          <div style={sx("font-size:11px;font-weight:700;width:22px;text-align:right;flex:none", { fontFamily: TOKENS.mono })}>
            {v ?? "—"}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={s("background:var(--surface);border:1px dashed var(--border-2);border-radius:16px;padding:34px;text-align:center;color:var(--t4);font-size:13px")}>
      {children}
    </div>
  );
}
