#!/usr/bin/env node
// scripts/bundle-cli.mjs — bundle a pyr3 CLI entry point into a single-file
// CommonJS module under build/.tmp/.
//
// Usage:
//   node scripts/bundle-cli.mjs [name]      (default: render)
//
// Produces build/.tmp/pyr3-<name>.cjs. The bundled output runs under plain
// `node` without tsx, without ./bin/wgsl-loader-register.mjs, and without
// multi-file module resolution at runtime.
//
// `webgpu` (Dawn-node) stays external — it's a native .node binding that
// can't be statically linked. The eventual pyr3-render binary (#31) bundles
// the matching .node as a SEA asset and require()s it at runtime; for now
// (npm-installed users) it resolves out of node_modules/webgpu normally.
//
// WGSL imports of the form `import s from './x.wgsl?raw'` are routed through
// a tiny esbuild plugin that strips the `?raw` query and loads as text.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { mkdirSync, readFileSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// Parametric allowlist. Future pyr3-animate / pyr3-genome land as additional
// entries here; everything else (build script, esbuild config, WGSL plugin)
// stays unchanged.
const KNOWN_BINARIES = {
  render: 'bin/pyr3-render.ts',
};

// esbuild plugin: `import s from './x.wgsl?raw'` → inline the file contents
// as a string. Mirrors the Vite ?raw convention used in src/*.ts.
const wgslRawPlugin = {
  name: 'pyr3-wgsl-raw',
  setup(b) {
    b.onResolve({ filter: /\.wgsl\?raw$/ }, (args) => ({
      path: resolvePath(args.resolveDir, args.path.replace(/\?raw$/, '')),
      namespace: 'wgsl-raw',
    }));
    b.onLoad({ filter: /\.wgsl$/, namespace: 'wgsl-raw' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

async function main() {
  const name = process.argv[2] ?? 'render';
  const entry = KNOWN_BINARIES[name];
  if (!entry) {
    console.error(
      `bundle-cli: unknown binary "${name}". Known: ${Object.keys(KNOWN_BINARIES).join(', ')}`,
    );
    process.exit(1);
  }

  const outDir = join(REPO_ROOT, 'build', '.tmp');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `pyr3-${name}.cjs`);

  const t0 = performance.now();
  await build({
    entryPoints: [join(REPO_ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22', // forward-compat; we run on Node 26 but node22 ES target is conservative
    outfile: outFile,
    external: ['webgpu'], // Dawn-node native binding — resolved at runtime
    plugins: [wgslRawPlugin],
    minify: false,
    sourcemap: false,
    logLevel: 'info',
  });

  const wallMs = performance.now() - t0;
  const sizeBytes = statSync(outFile).size;
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
  console.log(`\n✅ ${outFile}`);
  console.log(`   ${sizeMB} MB · bundled in ${wallMs.toFixed(0)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
