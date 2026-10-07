/**
 * The server/client module boundary.
 *
 * This file exists because of one real crash. `src/lib/ui/Search.tsx` is a `"use client"`
 * module and it exported a plain constant, `SEARCH_EXAMPLES`. `Shell.tsx` is a server
 * component and read `SEARCH_EXAMPLES[portal]` to pass down as a prop.
 *
 * **Every export of a client module becomes a client REFERENCE when a server component
 * imports it.** It is not the object. So the lookup evaluated to `undefined` on the
 * server, arrived in the browser as `examples={undefined}`, and `examples.map(...)` threw
 * — but only on the code path that used it, which was the "nothing matched" empty state.
 * The result was an app that worked for every search that found something and crashed on
 * every search that did not.
 *
 * Nothing caught it: it type-checked (the types are real even when the runtime value is
 * not), it built cleanly, and the server-rendered HTML was fine because the empty state
 * only renders after a fetch.
 *
 * So this is a static check instead. It is deliberately a lint rather than a behaviour
 * test, because the failure mode is structural and a behaviour test would need a DOM and
 * would only cover the one component that happened to break.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const ROOTS = ["app", "src"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

const isClientModule = (text: string) => /^\s*["']use client["']/.test(text);

/** Non-type named exports of a module — the ones that exist at runtime. */
function runtimeExports(text: string): string[] {
  const names: string[] = [];
  const re = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm;
  for (const m of text.matchAll(re)) names.push(m[1]);
  return names;
}

/**
 * Named value imports from a given specifier. `import type {...}` is skipped — it is
 * erased at compile time and is the correct way for a client module to borrow a type from
 * a server one.
 */
function valueImportsFrom(text: string, specifierPart: string): string[] {
  const names: string[] = [];
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of text.matchAll(re)) {
    const [, typeOnly, clause, spec] = m;
    if (typeOnly) continue;
    if (!spec.includes(specifierPart)) continue;
    for (const raw of clause.split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      // `import { type Foo }` is also erased.
      if (!name || /^type\s/.test(raw.trim())) continue;
      names.push(name);
    }
  }
  return names;
}

describe("a server component never imports a runtime value from a client module", () => {
  it("has no such import anywhere in app/ or src/", () => {
    const clientModules = files.filter((f) => isClientModule(source.get(f)!));
    expect(clientModules.length).toBeGreaterThan(0); // the check would be vacuous otherwise

    const violations: string[] = [];

    for (const clientFile of clientModules) {
      const exported = new Set(runtimeExports(source.get(clientFile)!));
      if (!exported.size) continue;

      // The specifier a sibling would use, e.g. "./Search" for .../ui/Search.tsx.
      const base = clientFile.replace(/\.tsx?$/, "").split(/[\\/]/).pop()!;

      for (const [other, text] of source) {
        if (other === clientFile || isClientModule(text)) continue;

        for (const name of valueImportsFrom(text, base)) {
          // A component is the legitimate case: a server component rendering a client
          // component is the entire point of the boundary.
          const looksLikeComponent = /^[A-Z]/.test(name) && exported.has(name)
            && new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`).test(source.get(clientFile)!);
          if (looksLikeComponent) continue;

          if (exported.has(name)) {
            violations.push(
              `${relative(ROOT, other)} imports the value \`${name}\` from the client module `
              + `${relative(ROOT, clientFile)} — it will be a client reference, not the value.`,
            );
          }
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("allows `import type` across the boundary, which is how Portal is shared", () => {
    // Search.tsx and HowItWorks.tsx both borrow `Portal` from Shell.tsx this way. It is
    // erased at compile time, so there is no runtime import and no cycle.
    const search = source.get(join(ROOT, "src", "lib", "ui", "Search.tsx"));
    expect(search).toBeDefined();
    expect(search!).toMatch(/import type \{ Portal \} from "\.\/Shell"/);
  });

  it("keeps the database out of every client module", () => {
    // The other half of the same boundary, and a build error rather than a crash: Shell is
    // imported by client components, so importing a read model into it once dragged the
    // Postgres driver into the browser bundle and the build failed on `Can't resolve 'fs'`.
    const offenders: string[] = [];
    for (const [file, text] of source) {
      if (!isClientModule(text)) continue;
      // VALUE imports only. `import type { VendorRosterResource } from ".../vendor"` is
      // erased at compile time and pulls nothing into the bundle — four client components
      // legitimately borrow a read model's TYPE, which is how they stay in step with the
      // shape they are handed. An earlier version of this check flagged all four.
      for (const m of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        const [, typeOnly, clause, spec] = m;
        if (typeOnly) continue;
        if (!/\/(db\/client|read-models)/.test(spec)) continue;
        // `import { type Foo, bar }` — only `bar` is a runtime import.
        const runtime = clause.split(",")
          .map((x) => x.trim())
          .filter((x) => x && !/^type\s/.test(x));
        if (runtime.length) {
          offenders.push(`${relative(ROOT, file)} imports ${runtime.join(", ")} from ${spec}`);
        }
      }
      // A bare default or namespace import of the db client is never acceptable.
      if (/import\s+(?:\w+|\*\s+as\s+\w+)\s+from\s*["'][^"']*\/db\/client["']/.test(text)) {
        offenders.push(`${relative(ROOT, file)} imports the db client directly`);
      }
    }
    expect(offenders, offenders.join("; ")).toEqual([]);
  });
});
