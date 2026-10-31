import Link from "next/link";
import type { ReactNode } from "react";
import { s, sx } from "./style";

/**
 * The one button. It lives in its own file so that client components (HowItWorks among
 * them) can import it without importing the whole shell, which imports them back.
 */
export function Button({
  children, href, primary, variant, size = "md", accent, download, onClick, disabled, type = "button", title, external, full,
}: {
  children: ReactNode;
  href?: string;
  /** Shorthand for variant="primary". */
  primary?: boolean;
  /** primary: brand fill. dark: ink fill. ok: green fill. secondary (default): outlined. */
  variant?: "primary" | "dark" | "ok" | "secondary";
  /** md is 40px, for page actions (the contract asks 40 to 42px in headers). sm is 34px, for actions inside a card or drawer. */
  size?: "md" | "sm";
  accent?: string;
  /**
   * Renders a plain `<a>` instead of next/link, for an href that is a ROUTE HANDLER
   * rather than a page — a CSV download, for instance.
   *
   * next/link does a client-side RSC navigation, so it fetches the destination expecting a
   * flight payload and the download never starts. This is the same trap that made the
   * "Acting as" switcher unclickable; the rule is next/link for pages, `<a>` for route
   * handlers.
   */
  download?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  /** Opens an outside page (a meeting link, say) in a new tab. */
  external?: boolean;
  /** Stretches to the width of its container. */
  full?: boolean;
}) {
  const kind = variant ?? (primary ? "primary" : "secondary");
  const fill = kind === "primary" ? accent ?? "var(--brand)" : kind === "dark" ? "var(--t1)" : kind === "ok" ? "var(--ok)" : null;
  const base = `padding:0 ${size === "sm" ? 13 : 14}px;height:${size === "sm" ? 34 : 40}px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:${size === "sm" ? 9 : 10}px;font-size:var(${size === "sm" ? "--fs-4" : "--fs-5"});white-space:nowrap;font-family:inherit;text-decoration:none${full ? ";width:100%" : ""}`;
  // One disabled look everywhere: a flat grey chip, whatever the variant.
  const style = disabled
    ? s(`${base};border:1px solid transparent;font-weight:700;background:var(--surface-3);color:var(--t4);cursor:not-allowed`)
    : fill
      ? sx(`${base};border:1px solid transparent;font-weight:700;box-shadow:var(--sh);cursor:pointer`, {
          background: fill, color: kind === "dark" ? "var(--surface)" : "var(--on-accent)",
        })
      : s(`${base};border:1px solid var(--border-2);font-weight:600;background:var(--surface);color:var(--t1);cursor:pointer`);
  if (href && !disabled) {
    if (download) return <a href={href} className="tv-btn" style={style} title={title}>{children}</a>;
    if (external) return <a href={href} target="_blank" rel="noreferrer" className="tv-btn" style={style} title={title}>{children}</a>;
    return <Link href={href} className="tv-btn" style={style} title={title}>{children}</Link>;
  }
  return (
    <button type={type} className="tv-btn" style={style} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}
