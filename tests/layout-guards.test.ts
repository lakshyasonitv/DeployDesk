/**
 * Static guards for layout bugs that type-check, build clean, and only show up on screen.
 *
 * This file exists because of one reported bug. The client shortlist rendered
 * `<ScoreBars sections={...} width={9999} />`, and `ScoreBars` turned that into
 * `width: 9999px`. The cards sat in a `repeat(3, 1fr)` grid, and `1fr` is
 * `minmax(auto, 1fr)` — so each column's MINIMUM became its child's min-content width.
 * The cards stretched far past the viewport and carried their own buttons off screen,
 * which is why the screen also looked like it was not working.
 *
 * Nothing caught it: the types were satisfied (`width?: number`), the build was clean, the
 * server-rendered HTML was correct, and no test renders a DOM. It was reported by a person
 * looking at the page — the same shape as the search crash, which is why the fix is a lint
 * rather than a behaviour test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

const files = ["app", "src"].flatMap((r) => walk(join(ROOT, r)));

/**
 * Wider than any real viewport this product targets. The design handoff tops out at
 * 1280px and the tables declare explicit `min-width` values in the 700–900px range, so a
 * single dimension above this is a sentinel value standing in for "as wide as possible" —
 * which is what CSS percentages are for.
 */
const ABSURD_PX = 2000;

describe("no element is given a hardcoded width wider than a screen", () => {
  it("has no absurd pixel width in an inline style or a component prop", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");

      lines.forEach((line, i) => {
        // `width: 9999` / `width:9999px` / `minWidth: 4000` in an inline style object or
        // a style string, and `width={9999}` as a prop.
        const patterns = [
          /\b(?:min-width|width|max-width)\s*:\s*(\d{4,})\s*px/gi,
          /\b(?:minWidth|width|maxWidth)\s*:\s*(\d{4,})\b/g,
          /\bwidth=\{(\d{4,})\}/g,
        ];
        for (const re of patterns) {
          for (const m of line.matchAll(re)) {
            const px = Number(m[1]);
            if (px > ABSURD_PX) {
              offenders.push(
                `${relative(ROOT, file)}:${i + 1} sets ${px}px — use a percentage, or "100%" `
                + `if the intent is "fill the container". A value this large becomes the `
                + `min-content width of its parent and will blow out a 1fr grid track.`,
              );
            }
          }
        }
      });
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("lets ScoreBars express full width without a sentinel number", () => {
    // The API gap is what produced the bug: full width was unrepresentable, so a number
    // stood in for it. Keep the string form available.
    const shell = readFileSync(join(ROOT, "src", "lib", "ui", "Shell.tsx"), "utf8");
    expect(shell).toMatch(/width\?:\s*number\s*\|\s*string/);
    expect(shell).toMatch(/typeof width === "number"/);
  });
});
