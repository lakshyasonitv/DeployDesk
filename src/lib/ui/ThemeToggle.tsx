"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { sx } from "./style";

/**
 * The light/dark segmented control from the v2 handoff: two 32x30 segments, sun and moon.
 *
 * The choice is written to `localStorage("tvbx-theme")` and applied as
 * `data-tvtheme="dark"` on <html>, which is what app/globals.css keys its dark palette on.
 *
 * This is the only interactive piece of the token migration, and it is a client component
 * for the obvious reason: there is no way for the server to know the choice, because
 * localStorage is not sent with the request.
 *
 * Two details that matter:
 *
 *   - The theme is applied before first paint by a blocking inline script in
 *     app/layout.tsx, NOT here. If this component were the only thing applying it, a user
 *     who chose dark would see a white flash on every navigation while React hydrated.
 *     This component's effect only syncs the button's own highlight to what that script
 *     already did.
 *   - Every localStorage access is wrapped. It throws outright in a private window or
 *     with site data blocked, and a theme preference is not worth a crashed page.
 */

type Theme = "light" | "dark";

function read(): Theme {
  try {
    return localStorage.getItem("tvbx-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function ThemeToggle() {
  /**
   * Starts as "light" so the server and the first client render agree, then corrects in
   * the effect below. Reading localStorage during render would make the markup depend on
   * something the server cannot see, which is a hydration mismatch.
   */
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const el = document.documentElement;
    // Trust the attribute the inline script set, and fall back to storage.
    const current = (el.getAttribute("data-tvtheme") as Theme | null) ?? read();
    setTheme(current);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute("data-tvtheme", next);
    try {
      localStorage.setItem("tvbx-theme", next);
    } catch {
      /* preference is not persisted; the page still works */
    }
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      style={sx(
        "display:flex;border-radius:9px;overflow:hidden;flex:none",
        { border: "1px solid var(--border)" },
      )}
    >
      {([
        ["light", Sun, "Light theme"],
        ["dark", Moon, "Dark theme"],
      ] as const).map(([value, Icon, label]) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            style={sx(
              "width:32px;height:30px;display:flex;align-items:center;justify-content:center;border:0;cursor:pointer;padding:0",
              {
                background: active ? "var(--brand-tint)" : "var(--surface)",
                color: active ? "var(--brand-ink)" : "var(--t4)",
              },
            )}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
