import { defineConfig } from 'vitest/config';

const includeParity = process.env.VITEST_INCLUDE_PARITY === '1';
const includeParityFeBe = process.env.VITEST_INCLUDE_PARITY_FE_BE === '1';

export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      'dist/**',
      ...(includeParity ? [] : ['src/parity.test.ts']),
      ...(includeParityFeBe ? [] : ['src/parity-fe-be.test.ts']),
    ],
  },
});
