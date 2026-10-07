import { s, sx, GROUP_LABEL, BRAND } from "./style";
import { NAV_COUNT, type Portal } from "./Shell";
import { DeployDeskLogo } from "./DeployDeskLogo";

/**
 * Navigation feedback.
 *
 * Every page is `force-dynamic` and queries Postgres, so a click used to leave the
 * previous screen on display until the server finished — anywhere from 130ms to several
 * hundred, during which the app looked frozen. Next renders the nearest `loading.tsx`
 * immediately on navigation, so the shell appears at once and only the content area
 * waits.
 *
 * This is a perceived-performance fix, not a real one: the server takes exactly as long
 * either way. It is still the single biggest thing that makes the app feel responsive,
 * because the alternative is a dead click.
 *
 * The sidebar and top bar here are a static copy of the real ones' GEOMETRY — 260px
 * sidebar, 30px logo tile, 38px search and nav rows, 60px top bar. If Shell.tsx's
 * measurements change, change them here too, or the layout visibly jumps when the real
 * shell replaces this one.
 *
 * It deliberately shows no user name, org or badge counts — those come from the database,
 * and inventing them in a skeleton would flash wrong data before the real values arrive.
 *
 * One trap worth naming: the v1 sidebar was dark with white text, so the wordmark was
 * `#fff`. A blanket hex-to-token conversion turned that into `var(--surface)`, which on a
 * now-`--surface` sidebar is invisible. Text in here is `--t1`/`--t3`, never `--surface`.
 */
export function ShellSkeleton({ portal }: { portal: Portal }) {
  return (
    <div style={s("display:flex;height:100vh;min-height:720px;background:var(--bg);overflow:hidden")}>
      {/* ---- sidebar: real geometry, no fabricated content ---- */}
      <div style={s("width:260px;flex:none;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:16px 0")}>
        <div style={s("padding:0 16px 14px;display:flex;align-items:center;gap:10px")}>
          <DeployDeskLogo size={32} />
          <div style={s("min-width:0")}>
            <div style={s("font-size:14.5px;font-weight:800;letter-spacing:-.3px;white-space:nowrap;color:var(--t1)")}>
              {BRAND.name}
            </div>
            <div style={s("font-size:11.5px;color:var(--t3);white-space:nowrap")}>by {BRAND.by}</div>
          </div>
        </div>

        <div style={s("margin:0 12px 14px;height:38px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px")} />

        <div style={s("padding:0 12px 6px;font-size:10.5px;font-weight:700;letter-spacing:.09em;color:var(--t4)")}>
          {GROUP_LABEL[portal]}
        </div>

        <div style={s("padding:0 8px;display:flex;flex-direction:column;gap:2px")}>
          {Array.from({ length: NAV_COUNT[portal] }, (_, i) => i).map((i) => (
            <div
              key={i}
              style={sx("height:38px;border-radius:10px;display:flex;align-items:center;gap:10px;padding:0 10px", {
                background: i === 0 ? "var(--brand-tint)" : "transparent",
              })}
            >
              <div style={s("width:17px;height:17px;border-radius:5px;background:var(--surface-3);flex:none")} />
              <div style={sx("height:9px;border-radius:4px;background:var(--surface-3)", { width: `${54 - i * 5}%` })} />
            </div>
          ))}
        </div>

        <div style={s("margin:18px 12px 0;padding-top:14px;border-top:1px solid var(--border)")} />
        <div style={s("padding:9px 12px;display:flex;flex-direction:column;gap:9px")}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={s("display:flex;align-items:center;gap:8px")}>
              <div style={s("width:6px;height:6px;border-radius:50%;flex:none;background:var(--surface-3)")} />
              <div style={sx("height:8px;border-radius:4px;background:var(--surface-3)", { width: `${70 - i * 12}%` })} />
            </div>
          ))}
        </div>

        <div style={s("margin-top:auto;padding:12px 14px 2px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px")}>
          <div style={s("width:32px;height:32px;border-radius:50%;background:var(--surface-3);flex:none")} />
          <div style={s("flex:1")}>
            <div style={s("height:9px;width:72%;border-radius:4px;background:var(--surface-3)")} />
            <div style={s("height:8px;width:52%;border-radius:4px;background:var(--surface-3);margin-top:5px")} />
          </div>
        </div>
      </div>

      {/* ---- content column ---- */}
      <div style={s("flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden")}>
        {/* top bar, 60px — matches Shell */}
        <div style={s("height:60px;flex:none;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;padding:0 24px")}>
          <Bar w="220px" h="11px" />
          <div style={s("flex:1")} />
          <div style={s("width:150px;height:32px;border:1px solid var(--border);border-radius:9px;flex:none")} />
          <div style={s("width:64px;height:30px;border:1px solid var(--border);border-radius:9px;flex:none")} />
          <div style={s("width:32px;height:30px;border:1px solid var(--border);border-radius:9px;flex:none")} />
        </div>

        <div style={s("padding:22px 24px 18px;background:var(--surface);border-bottom:1px solid var(--border);flex:none")}>
          <Bar w="270px" h="26px" />
          <div style={s("margin-top:9px")}><Bar w="430px" h="12px" /></div>
        </div>

        <div style={s("flex:1;overflow:hidden;padding:20px 24px 32px")}>
          <div style={s("display:grid;grid-template-columns:repeat(auto-fit,minmax(198px,1fr));gap:14px")}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={s("background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:17px;box-shadow:var(--sh)")}>
                <Bar w="60%" h="10px" />
                <div style={s("margin-top:10px")}><Bar w="42%" h="26px" /></div>
                <div style={s("margin-top:8px")}><Bar w="78%" h="10px" /></div>
              </div>
            ))}
          </div>
          <div style={s("margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:18px;box-shadow:var(--sh)")}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={sx("display:flex;align-items:center;gap:14px;padding:12px 0", { borderBottom: i < 5 ? "1px solid var(--border)" : "none" })}>
                <Bar w="84px" h="12px" />
                <div style={s("flex:1")}><Bar w={`${68 - i * 4}%`} h="12px" /></div>
                <Bar w="94px" h="12px" />
                <Bar w="64px" h="12px" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One shimmering placeholder bar. */
function Bar({ w, h }: { w: string; h: string }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: "5px",
        background: "linear-gradient(90deg,var(--surface-3) 25%,var(--surface-2) 50%,var(--surface-3) 75%)",
        backgroundSize: "400% 100%",
        animation: "tv-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}
