"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { s } from "./style";

/**
 * A panel that slides in from the right over a dimmed page. Every drawer uses this one, so
 * they share the contract's 412px width, a shadow, Escape to close and the dialog role that
 * screen readers expect.
 *
 * `dirty` means the user has typed something they would lose. While it is set, Escape and a
 * click on the dimmed page do nothing; the drawer's own Cancel or close button still works.
 */
export function Drawer({
  label, onClose, dirty, children,
}: { label: string; onClose: () => void; dirty?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // A click only closes when it started on the dimmed page too. Selecting text in the panel
  // and letting go over the dim area must not close it.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    // Focus moves into the drawer and goes back where it came from on close.
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dirty) onClose();
      if (e.key !== "Tab" || !panel.current) return;
      // Keep Tab inside the drawer while it is open.
      const items = [...panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement as HTMLElement | null;
      // Focus can sit on a button that just became disabled (Send while it runs), which is no
      // longer in the list. Treat that like the edge and wrap.
      if (!at || !items.includes(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dirty]);

  return (
    <div
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (!dirty && downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      style={s("position:fixed;inset:0;background:rgba(15,23,41,.38);display:flex;justify-content:flex-end;z-index:300")}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={s("width:412px;max-width:100%;background:var(--surface);height:100%;display:flex;flex-direction:column;box-shadow:var(--sh3);animation:tvin .16s ease-out;outline:none")}
      >
        {children}
      </div>
    </div>
  );
}
