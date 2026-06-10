import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { dawnTeardownUnhandledErrorFilter } from './src/dawn-teardown-filter';

const includeParity = process.env.VITEST_INCLUDE_PARITY === '1';
// Full 26-fixture FE↔BE sweep (~13min) — pre-release only per #58. The
// SMOKE variant (3 fixtures, ~90s) is gated separately + uses the same
// underlying test file; either flag includes it.
const includeParityFeBeFull = process.env.VITEST_INCLUDE_PARITY_FE_BE === '1';
const includeParityFeBeSmoke = process.env.VITEST_INCLUDE_PARITY_FE_BE_SMOKE === '1';
const includeParityFeBe = includeParityFeBeFull || includeParityFeBeSmoke;
// #201 P0 Task 8 — `pyr3 serve` integration test spawns the binary and
// requires a Dawn-node GPU. Gated; pre-release only.
const includeServe = process.env.VITEST_INCLUDE_SERVE === '1';

// Mirror vite.config's __PYR3_VERSION__ + __BUILD_DATE__ defines so any test
// that touches code referencing those build constants resolves them (vitest
// doesn't load vite.config). __BUILD_DATE__ added by #103 Phase 2 Task 2.5
// for the /about page's version chip.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  define: {
    __PYR3_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  test: {
    // #223 — Dawn-node's forked-worker teardown occasionally CRASHES (abnormal
    // child exit) after a `*.gpu.test.ts` file's tests all pass, because the
    // `create([])` instance has no disposal API and its native threads only
    // unwind at process exit. Vitest surfaces that as a pool-level unhandled
    // error ("Worker exited unexpectedly"), which flips the run's exit code to 1
    // on a 0-failure suite. We swallow ONLY that exact infrastructure signature
    // (see src/dawn-teardown-filter.ts) so real unhandled errors still fail the
    // run — the documented, surgical alternative to dangerouslyIgnoreUnhandledErrors.
    onUnhandledError: dawnTeardownUnhandledErrorFilter,
    // Companion knob for the genuinely-slow (non-crash) exit case: under
    // concurrent forks the heaviest GPU workers can take several seconds to
    // release native GPU resources. 30s gives Dawn room to unwind without
    // throttling fork parallelism (no wall-clock cost on a clean exit).
    teardownTimeout: 30000,
    exclude: [
      'node_modules/**',
      'dist/**',
      // Never reach into a sibling git worktree: a worktree under
      // .claude/worktrees/<name>/ carries its own copy of the heavy
      // parity*.test.ts, which the src/parity* excludes below don't match.
      // Without this, `npm test` from the main checkout globs the worktree
      // copies and balloons from ~2s to ~838s (issue #41).
      '**/.claude/**',
      ...(includeParity ? [] : ['src/parity.test.ts']),
      ...(includeParityFeBe ? [] : ['src/parity-fe-be.test.ts']),
      ...(includeServe ? [] : ['bin/serve/serve-integration.test.ts']),
    ],
  },
});
