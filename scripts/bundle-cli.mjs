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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { mkdirSync, readFileSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// Parametric allowlist. Future pyr3-animate / pyr3-genome land as additional
// entries here; everything else (build script, esbuild config, WGSL plugin)
// stays unchanged.
export const KNOWN_BINARIES = {
  render: 'bin/pyr3-render.ts',
  serve: 'bin/pyr3-serve.ts',
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

/**
 * Bundle a pyr3 CLI entry into build/.tmp/pyr3-<name>.cjs. Returns the
 * absolute output path so callers (scripts/build-cli.mjs) can hand it
 * straight to a SEA pipeline without re-resolving.
 *
 * @param {string} name — one of KNOWN_BINARIES (default: "render")
 * @returns {Promise<{outFile: string, sizeBytes: number, wallMs: number}>}
 */
export async function bundleCli(name = 'render') {
  const entry = KNOWN_BINARIES[name];
  if (!entry) {
    throw new Error(
      `bundle-cli: unknown binary "${name}". Known: ${Object.keys(KNOWN_BINARIES).join(', ')}`,
    );
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
  return { outFile, sizeBytes, wallMs };
}

// Run as a script when invoked directly (npm run bundle:cli). When imported
// as a module (build-cli.mjs), the body below is skipped.
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  const name = process.argv[2] ?? 'render';
  bundleCli(name)
    .then(({ outFile, sizeBytes, wallMs }) => {
      const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
      console.log(`\n✅ ${outFile}`);
      console.log(`   ${sizeMB} MB · bundled in ${wallMs.toFixed(0)} ms`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
