import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The write-path tests import Next route handlers directly, and those use the "@/..."
  // alias that tsconfig declares. Vitest does not read tsconfig paths on its own.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    /**
     * One file at a time. Every suite here talks to the SAME database.
     *
     * Found by a flake: `dual-role-ui.test.ts` acceptance test 6 deliberately flips
     * Cygnet's `can_hire` off and restores it — that IS the test — while
     * `search.test.ts` asserts the same organisation reads as "Both sides". Run in
     * parallel, the search suite occasionally read Cygnet mid-flip and failed with
     * "expected 'Supplies' to be 'Both sides'".
     *
     * The alternative was forbidding tests from mutating shared rows, but acceptance
     * test 6 cannot be written any other way: the whole point is that flipping a real
     * capability moves a real workspace. Serial files cost a few seconds and remove the
     * class of problem.
     */
    fileParallelism: false,
  },
});
