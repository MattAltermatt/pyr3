import { defineConfig } from 'vitest/config';

const includeParity = process.env.VITEST_INCLUDE_PARITY === '1';
const includeParityFeBe = process.env.VITEST_INCLUDE_PARITY_FE_BE === '1';

export default defineConfig({
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
