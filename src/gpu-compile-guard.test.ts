// @vitest-environment node
//
// #306 L18 — structural meta-guard for the compile-error convention (#263).
//
// A finite-output GPU smoke that hand-assembles WGSL and asserts only
// `Number.isFinite(output)` SILENTLY PASSES when the shader fails to compile:
// Dawn defers compile errors, so an invalid module makes the dispatch a no-op,
// the output reads back zero-initialized, and `isFinite(0)` is true for every
// case (the #259 false-positive). `compileChecked` (gpu-compile-guard.ts) is the
// drop-in for `dev.createShaderModule({ code })` that throws on a bad shader.
//
// This meta-test makes that convention STRUCTURAL rather than incidental: no
// `*.gpu.test.ts` may call `dev.createShaderModule` directly — every GPU smoke
// must route compilation through `compileChecked` so the assertion is impossible
// to forget. (The lone legitimate `createShaderModule` lives inside
// `compileChecked` itself, which is not a `*.gpu.test.ts` file.)
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function gpuTestFiles(): string[] {
  return readdirSync(SRC_DIR).filter((f) => f.endsWith('.gpu.test.ts'));
}

// Strip line + block comments so a `// createShaderModule` mention doesn't trip it.
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('#306 L18 — every *.gpu.test.ts routes compilation through compileChecked', () => {
  const files = gpuTestFiles();

  it('finds the GPU test suite (sanity: the scan ran)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no *.gpu.test.ts calls dev.createShaderModule directly', () => {
    const offenders = files.filter((f) =>
      /\bcreateShaderModule\s*\(/.test(stripComments(readFileSync(join(SRC_DIR, f), 'utf8'))),
    );
    expect(
      offenders,
      `These GPU smokes call createShaderModule directly — a shader that fails ` +
        `to compile would silently pass (#259). Replace ` +
        `\`dev.createShaderModule({ code })\` with \`await compileChecked(dev, code)\`:\n  ` +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
