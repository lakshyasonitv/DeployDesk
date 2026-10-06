import { s, sx, TOKENS, ACCENT, ACCENT_GRADIENT, PORTAL_TAG, BRAND } from "./style";
import type { Portal } from "./Shell";

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
 * The sidebar here is a static copy of the real one's geometry. It deliberately shows no
 * user name, org or badge counts — those come from the database, and inventing them in a
 * skeleton would flash wrong data before the real values replace it.
 */
export function ShellSkeleton({ portal }: { portal: Portal }) {
  return (
    <div style={s("display:flex;height:100vh;min-height:720px;background:#f7f7f9;overflow:hidden")}>
      {/* sidebar — real geometry, no fabricated content */}
      <div style={s("width:222px;flex:none;background:#111114;display:flex;flex-direction:column;padding:16px 0")}>
        <div style={s("padding:0 16px 14px;display:flex;align-items:center;gap:9px")}>
          <div style={sx("width:22px;height:22px;border-radius:6px;flex:none", { background: ACCENT_GRADIENT[portal] })} />
          <div>
            <div style={s("font-weight:800;font-size:13px;letter-spacing:-.3px;color:#fff")}>{BRAND.name}</div>
            <div style={sx("font-size:9px;font-weight:600;letter-spacing:.12em;color:#6c6c78;margin-top:2px", { fontFamily: TOKENS.mono })}>
              {PORTAL_TAG[portal]}
            </div>
          </div>
        </div>
        <div style={s("margin:0 12px 12px;padding:6px 9px;border:1px solid #26262c;border-radius:7px;height:29px")} />
        <div style={s("padding:0 8px;display:flex;flex-direction:column;gap:2px")}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={sx("height:30px;border-radius:7px", { background: i === 0 ? "#1e1e26" : "transparent" })}>
              <div style={sx("height:9px;border-radius:4px;margin:10px 10px;background:#26262c", { width: `${54 - i * 5}%` })} />
            </div>
          ))}
        </div>
        <div style={s("margin:16px 12px 0;padding-top:13px;border-top:1px solid #26262c")} />
        <div style={s("padding:9px 12px;display:flex;flex-direction:column;gap:9px")}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={s("display:flex;align-items:center;gap:7px")}>
              <div style={sx("width:5px;height:5px;border-radius:50%;flex:none", { background: i === 0 ? ACCENT[portal] : "#3f3f4a" })} />
              <div style={sx("height:8px;border-radius:4px;background:#26262c", { width: `${70 - i * 12}%` })} />
            </div>
          ))}
        </div>
        <div style={s("margin-top:auto;padding:12px;border-top:1px solid #26262c")}>
          <div style={s("display:flex;align-items:center;gap:9px")}>
            <div style={s("width:24px;height:24px;border-radius:50%;background:#3b3b45;flex:none")} />
            <div style={s("flex:1")}>
              <div style={s("height:9px;width:72%;border-radius:4px;background:#26262c")} />
              <div style={s("height:8px;width:52%;border-radius:4px;background:#1e1e26;margin-top:5px")} />
            </div>
          </div>
        </div>
      </div>

      {/* content */}
      <div style={s("flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden")}>
        <div style={s("padding:20px 26px 16px;background:#fff;border-bottom:1px solid #e8e8ee;flex:none")}>
          <Bar w="270px" h="22px" />
          <div style={s("margin-top:9px")}><Bar w="430px" h="11px" /></div>
        </div>
        <div style={s("flex:1;overflow:hidden;padding:20px 26px")}>
          <div style={s("display:grid;grid-template-columns:repeat(4,1fr);gap:12px")}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={s("background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:15px")}>
                <Bar w="60%" h="9px" />
                <div style={s("margin-top:10px")}><Bar w="42%" h="22px" /></div>
                <div style={s("margin-top:8px")}><Bar w="78%" h="9px" /></div>
              </div>
            ))}
          </div>
          <div style={s("margin-top:16px;background:#fff;border:1px solid #e8e8ee;border-radius:12px;padding:15px")}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={sx("display:flex;align-items:center;gap:14px;padding:11px 0", { borderBottom: i < 5 ? "1px solid #f1f1f5" : "none" })}>
                <Bar w="84px" h="11px" />
                <div style={s("flex:1")}><Bar w={`${68 - i * 4}%`} h="11px" /></div>
                <Bar w="94px" h="11px" />
                <Bar w="64px" h="11px" />
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
        background: "linear-gradient(90deg,#eeeef3 25%,#f6f6fa 50%,#eeeef3 75%)",
        backgroundSize: "400% 100%",
        animation: "tv-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}
