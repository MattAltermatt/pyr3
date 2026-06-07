#!/usr/bin/env node
// scripts/build-cli.mjs — build a pyr3 standalone CLI binary via Node SEA.
//
// Usage:
//   node scripts/build-cli.mjs [name]      (default: render)
//
// Pipeline:
//   1. Bundle bin/pyr3-<name>.ts → build/.tmp/pyr3-<name>.cjs   (T1, #125)
//   2. Generate sea-config.json + sea-prep.blob                  (T6, this issue)
//   3. Copy `node` binary → build/pyr3-<name>                    (T6)
//   4. postject sea-prep.blob into the copied Node binary        (T6)
//   5. Embed platform-matching webgpu/dist/*.dawn.node as asset  (T7)
//   6. macOS: ad-hoc `codesign -s -`                             (T6)
//
// Result: build/pyr3-<name> — a single executable that takes the same args
// as `npm run <name>` and doesn't need `npm install` / `node` / tsx to run.
//
// Matches flam3's distribution model: ship source, document the build, users
// produce their own platform-matching binary. Parametric so future
// pyr3-animate / pyr3-genome binaries are free once their KNOWN_BINARIES
// entry lands in bundle-cli.mjs.

import { pathToFileURL } from 'node:url';

import { bundleCli, KNOWN_BINARIES } from './bundle-cli.mjs';

async function buildCli(name) {
  if (!KNOWN_BINARIES[name]) {
    throw new Error(
      `build-cli: unknown binary "${name}". Known: ${Object.keys(KNOWN_BINARIES).join(', ')}`,
    );
  }

  console.log(`📦 Bundling bin/pyr3-${name}.ts → CJS …`);
  const { outFile: cjsPath, sizeBytes: cjsBytes, wallMs: bundleMs } = await bundleCli(name);
  const cjsMB = (cjsBytes / 1024 / 1024).toFixed(2);
  console.log(`   ✓ ${cjsMB} MB (${bundleMs.toFixed(0)} ms)`);

  // ── T6 — Node SEA pipeline (sea-prep.blob + postject + codesign) ─────
  // ── T7 — Dawn .node embedded as SEA asset + runtime extraction ────────
  // Both pending — for now, the bundled CJS is the artifact and can be run
  // as `node build/.tmp/pyr3-<name>.cjs ...`. The standalone binary at
  // build/pyr3-<name> arrives in T6+T7.

  console.log(`\n⏳ T6 (SEA wrap) + T7 (Dawn asset) — not yet implemented.`);
  console.log(`   For now run the bundled CJS directly:`);
  console.log(`     node ${cjsPath} <input.flam3 | input.pyr3.json> [output.png]`);
}

const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invokedDirectly) {
  const name = process.argv[2] ?? 'render';
  buildCli(name).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { buildCli };
