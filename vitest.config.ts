import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const includeParity = process.env.VITEST_INCLUDE_PARITY === '1';
const includeParityFeBe = process.env.VITEST_INCLUDE_PARITY_FE_BE === '1';

// Mirror vite.config's __PYR3_VERSION__ define so any test that touches code
// referencing the build constant resolves it (vitest doesn't load vite.config).
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  define: {
    __PYR3_VERSION__: JSON.stringify(version),
  },
  test: {
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
    ],
  },
});
