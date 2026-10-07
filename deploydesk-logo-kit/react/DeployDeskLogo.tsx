import * as React from "react";

type Props = {
  /** "mark" = icon only, "lockup" = icon + DeployDesk + tagline */
  variant?: "mark" | "lockup";
  /** "color" (default), "ink" (one-colour dark) or "white" (one-colour, for dark/brand backgrounds) */
  tone?: "color" | "ink" | "white";
  /** Height in px. Width follows the aspect ratio. */
  size?: number;
  /** Hide the "by Talentvibes" line in the lockup */
  hideTagline?: boolean;
  className?: string;
};

const COLOR_MARK = "<path d=\"M106.68 78.82L77.08 73.86L106.05 66.03A6.4 6.4 0 0 1 106.68 78.82Z\" fill=\"#ff5931\"></path><path d=\"M91.02 99.63L67.86 80.55L96.86 88.25A6.4 6.4 0 0 1 91.02 99.63Z\" fill=\"#f52e57\"></path><path d=\"M67.04 109.83L56.53 81.73L77.8 102.9A6.4 6.4 0 0 1 67.04 109.83Z\" fill=\"#e6007e\"></path><path d=\"M41.18 106.68L46.14 77.08L53.97 106.05A6.4 6.4 0 0 1 41.18 106.68Z\" fill=\"#7ac943\"></path><path d=\"M20.37 91.02L39.45 67.86L31.75 96.86A6.4 6.4 0 0 1 20.37 91.02Z\" fill=\"#18b78d\"></path><path d=\"M10.17 67.04L38.27 56.53L17.1 77.8A6.4 6.4 0 0 1 10.17 67.04Z\" fill=\"#1299c9\"></path><path d=\"M13.32 41.18L42.92 46.14L13.95 53.97A6.4 6.4 0 0 1 13.32 41.18Z\" fill=\"#2b72e0\"></path><path d=\"M28.98 20.37L52.14 39.45L23.14 31.75A6.4 6.4 0 0 1 28.98 20.37Z\" fill=\"#4b4dda\"></path><path d=\"M52.96 10.17L63.47 38.27L42.2 17.1A6.4 6.4 0 0 1 52.96 10.17Z\" fill=\"#7b3fe4\"></path><path d=\"M78.82 13.32L73.86 42.92L66.03 13.95A6.4 6.4 0 0 1 78.82 13.32Z\" fill=\"#ffc400\"></path><path d=\"M99.63 28.98L80.55 52.14L88.25 23.14A6.4 6.4 0 0 1 99.63 28.98Z\" fill=\"#ffa100\"></path><path d=\"M109.83 52.96L81.73 63.47L102.9 42.2A6.4 6.4 0 0 1 109.83 52.96Z\" fill=\"#ff7e0c\"></path><circle cx=\"60\" cy=\"60\" r=\"9\" fill=\"#0b6ed9\"></circle>";
const INK_MARK = "<path d=\"M106.68 78.82L77.08 73.86L106.05 66.03A6.4 6.4 0 0 1 106.68 78.82Z\" fill=\"#0f1729\"></path><path d=\"M91.02 99.63L67.86 80.55L96.86 88.25A6.4 6.4 0 0 1 91.02 99.63Z\" fill=\"#0f1729\"></path><path d=\"M67.04 109.83L56.53 81.73L77.8 102.9A6.4 6.4 0 0 1 67.04 109.83Z\" fill=\"#0f1729\"></path><path d=\"M41.18 106.68L46.14 77.08L53.97 106.05A6.4 6.4 0 0 1 41.18 106.68Z\" fill=\"#0f1729\"></path><path d=\"M20.37 91.02L39.45 67.86L31.75 96.86A6.4 6.4 0 0 1 20.37 91.02Z\" fill=\"#0f1729\"></path><path d=\"M10.17 67.04L38.27 56.53L17.1 77.8A6.4 6.4 0 0 1 10.17 67.04Z\" fill=\"#0f1729\"></path><path d=\"M13.32 41.18L42.92 46.14L13.95 53.97A6.4 6.4 0 0 1 13.32 41.18Z\" fill=\"#0f1729\"></path><path d=\"M28.98 20.37L52.14 39.45L23.14 31.75A6.4 6.4 0 0 1 28.98 20.37Z\" fill=\"#0f1729\"></path><path d=\"M52.96 10.17L63.47 38.27L42.2 17.1A6.4 6.4 0 0 1 52.96 10.17Z\" fill=\"#0f1729\"></path><path d=\"M78.82 13.32L73.86 42.92L66.03 13.95A6.4 6.4 0 0 1 78.82 13.32Z\" fill=\"#0f1729\"></path><path d=\"M99.63 28.98L80.55 52.14L88.25 23.14A6.4 6.4 0 0 1 99.63 28.98Z\" fill=\"#0f1729\"></path><path d=\"M109.83 52.96L81.73 63.47L102.9 42.2A6.4 6.4 0 0 1 109.83 52.96Z\" fill=\"#0f1729\"></path><circle cx=\"60\" cy=\"60\" r=\"9\" fill=\"#0b6ed9\"></circle>";
const WHITE_MARK = "<path d=\"M106.68 78.82L77.08 73.86L106.05 66.03A6.4 6.4 0 0 1 106.68 78.82Z\" fill=\"#ffffff\"></path><path d=\"M91.02 99.63L67.86 80.55L96.86 88.25A6.4 6.4 0 0 1 91.02 99.63Z\" fill=\"#ffffff\"></path><path d=\"M67.04 109.83L56.53 81.73L77.8 102.9A6.4 6.4 0 0 1 67.04 109.83Z\" fill=\"#ffffff\"></path><path d=\"M41.18 106.68L46.14 77.08L53.97 106.05A6.4 6.4 0 0 1 41.18 106.68Z\" fill=\"#ffffff\"></path><path d=\"M20.37 91.02L39.45 67.86L31.75 96.86A6.4 6.4 0 0 1 20.37 91.02Z\" fill=\"#ffffff\"></path><path d=\"M10.17 67.04L38.27 56.53L17.1 77.8A6.4 6.4 0 0 1 10.17 67.04Z\" fill=\"#ffffff\"></path><path d=\"M13.32 41.18L42.92 46.14L13.95 53.97A6.4 6.4 0 0 1 13.32 41.18Z\" fill=\"#ffffff\"></path><path d=\"M28.98 20.37L52.14 39.45L23.14 31.75A6.4 6.4 0 0 1 28.98 20.37Z\" fill=\"#ffffff\"></path><path d=\"M52.96 10.17L63.47 38.27L42.2 17.1A6.4 6.4 0 0 1 52.96 10.17Z\" fill=\"#ffffff\"></path><path d=\"M78.82 13.32L73.86 42.92L66.03 13.95A6.4 6.4 0 0 1 78.82 13.32Z\" fill=\"#ffffff\"></path><path d=\"M99.63 28.98L80.55 52.14L88.25 23.14A6.4 6.4 0 0 1 99.63 28.98Z\" fill=\"#ffffff\"></path><path d=\"M109.83 52.96L81.73 63.47L102.9 42.2A6.4 6.4 0 0 1 109.83 52.96Z\" fill=\"#ffffff\"></path><circle cx=\"60\" cy=\"60\" r=\"9\" fill=\"#ffffff\"></circle>";

export function DeployDeskLogo({ variant = "mark", tone = "color", size = 32, hideTagline = false, className }: Props) {
  const markSvg = tone === "ink" ? INK_MARK : tone === "white" ? WHITE_MARK : COLOR_MARK;
  const nameFill = tone === "white" ? "#ffffff" : "var(--t1, #0f1729)";
  const tagFill = tone === "white" ? "rgba(255,255,255,.75)" : "var(--t3, #6b7789)";

  if (variant === "mark") {
    return (
      <svg viewBox="0 0 120 120" height={size} width={size} role="img" aria-label="DeployDesk" className={className}
        dangerouslySetInnerHTML={{ __html: markSvg }} />
    );
  }
  return (
    <svg viewBox="0 0 440 120" height={size} width={(size * 440) / 120} role="img" aria-label="DeployDesk by Talentvibes" className={className}>
      <g dangerouslySetInnerHTML={{ __html: markSvg }} />
      <text x="136" y={hideTagline ? 78 : 68} fontSize="46" fontWeight={800} letterSpacing="-1.6" fill={nameFill}
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>DeployDesk</text>
      {!hideTagline && (
        <text x="138" y="96" fontSize="16" fontWeight={600} fill={tagFill}
          style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>by Talentvibes</text>
      )}
    </svg>
  );
}

export default DeployDeskLogo;
