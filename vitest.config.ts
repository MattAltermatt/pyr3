import { defineConfig } from 'vitest/config';

const includeParity = process.env.VITEST_INCLUDE_PARITY === '1';

export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      'dist/**',
      ...(includeParity ? [] : ['src/parity.test.ts']),
    ],
  },
});
