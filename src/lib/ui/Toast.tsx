"use client";

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { Check, X, AlertTriangle, Loader2 } from "lucide-react";
import { s, sx } from "./style";

/**
 * Toasts with a real Undo.
 *
 * v2 README rule 4: "Every action responds. There are no dead buttons." And its toast
 * spec: bottom-centre, `--t1` background with `--surface` text, radius 13, a green check,
 * the message, Undo in the brand colour, Dismiss, auto-hiding after 6s.
 *
 * ---------------------------------------------------------------------------
 * WHAT "UNDO" MEANS HERE, which the product owner chose deliberately
 * ---------------------------------------------------------------------------
 *
 * The action COMMITS IMMEDIATELY and Undo issues a COMPENSATING WRITE — a second request
 * that reverses the first and leaves its own audit row. So the history shows the thing was
 * done and then undone, which is the honest record for a brokered marketplace where
 * disputes happen (CLAUDE.md working agreement 5).
 *
 * The rejected alternative was holding the write for six seconds and letting Undo cancel
 * it. That gives a tidier audit trail but shows the user a state the database does not
 * have, and closing the tab inside those six seconds silently loses the action.
 *
 * **An action that cannot be reversed passes no `undo` and therefore renders no Undo
 * button.** A button that cannot do what it says is worse than no button — which is the
 * same reasoning that removed the dead ⌘K affordance.
 *
 * Undo is async and can fail. While it runs the button shows a spinner and is disabled, so
 * it cannot be double-fired; if it throws, the toast turns into an error rather than
 * disappearing and pretending it worked.
 */

export interface ToastRequest {
  /** Plain language, past tense: "Shortlist sent to Acme Finserv". */
  message: string;
  /**
   * Reverses the action. Omit for anything that genuinely cannot be undone — the Undo
   * button is then not rendered at all.
   */
  undo?: () => Promise<void>;
  /** "ok" (default) or "error" for a failed action. An error toast has no Undo. */
  tone?: "ok" | "error";
}

interface ToastState extends ToastRequest {
  id: number;
  /** Set once Undo has succeeded, so the toast can confirm it rather than vanish. */
  undone?: boolean;
  undoing?: boolean;
  undoFailed?: boolean;
}

const AUTO_HIDE_MS = 6000;

const ToastContext = createContext<(t: ToastRequest) => void>(() => {
  // A no-op default rather than a throw: a component rendered outside the provider should
  // still work, just without feedback. Throwing would turn a missing provider into a blank
  // page in production.
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(1);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = useCallback((req: ToastRequest) => {
    clearTimer();
    const id = nextId.current++;
    setToast({ ...req, id });
    timer.current = setTimeout(() => {
      // Only retire this toast. A newer one will have replaced the state already, and
      // clearing unconditionally would dismiss it early.
      setToast((cur) => (cur && cur.id === id ? null : cur));
    }, AUTO_HIDE_MS);
  }, []);

  useEffect(() => clearTimer, []);

  const dismiss = () => {
    clearTimer();
    setToast(null);
  };

  const runUndo = async () => {
    if (!toast?.undo || toast.undoing) return;
    clearTimer(); // do not let it auto-hide while the reversal is in flight
    const id = toast.id;
    setToast((cur) => (cur && cur.id === id ? { ...cur, undoing: true } : cur));
    try {
      await toast.undo();
      setToast((cur) => (cur && cur.id === id
        ? { ...cur, undoing: false, undone: true, message: "Undone." }
        : cur));
      timer.current = setTimeout(() => {
        setToast((cur) => (cur && cur.id === id ? null : cur));
      }, 2500);
    } catch {
      // Say so rather than disappearing. The original action is still committed.
      setToast((cur) => (cur && cur.id === id
        ? { ...cur, undoing: false, undoFailed: true, tone: "error",
            message: "Could not undo that. The change is still saved." }
        : cur));
    }
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          style={s("position:fixed;left:0;right:0;bottom:24px;display:flex;justify-content:center;pointer-events:none;z-index:200;padding:0 16px")}
        >
          <div
            style={sx(
              "display:flex;align-items:center;gap:12px;max-width:560px;padding:12px 14px;border-radius:13px;box-shadow:var(--sh3);pointer-events:auto;animation:tvin .16s ease-out",
              {
                background: "var(--t1)",
                color: "var(--surface)",
              },
            )}
          >
            <span style={sx("display:flex;flex:none", {
              color: toast.tone === "error" ? "var(--danger)" : "var(--ok)",
            })}>
              {toast.tone === "error"
                ? <AlertTriangle size={17} strokeWidth={2} />
                : <Check size={17} strokeWidth={2.4} />}
            </span>

            <span style={s("font-size:13px;font-weight:600;line-height:1.4")}>
              {toast.message}
            </span>

            {toast.undo && !toast.undone && !toast.undoFailed ? (
              <button
                type="button"
                onClick={runUndo}
                disabled={toast.undoing}
                style={sx("display:flex;align-items:center;gap:5px;border:0;background:transparent;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;flex:none;padding:2px 4px", {
                  color: "var(--brand)",
                  opacity: toast.undoing ? 0.6 : 1,
                  cursor: toast.undoing ? "default" : "pointer",
                })}
              >
                {toast.undoing ? (
                  <>
                    <Loader2 size={13} strokeWidth={2.4} style={{ animation: "tv-spin .8s linear infinite" }} />
                    Undoing
                  </>
                ) : "Undo"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              style={sx("display:flex;border:0;background:transparent;cursor:pointer;padding:2px;flex:none", {
                color: "var(--t4)",
              })}
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
