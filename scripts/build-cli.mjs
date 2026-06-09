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

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import {
  writeFileSync,
  copyFileSync,
  chmodSync,
  statSync,
  mkdirSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { platform, homedir } from 'node:os';

import { bundleCli, KNOWN_BINARIES } from './bundle-cli.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');

// postject sentinel — required by Node SEA to find the blob slot. Don't
// change unless the Node SEA spec changes.
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

// Pinned Node version used when the host Node lacks the SEA fuse sentinel
// (notably Homebrew's Node, which strips it). Auto-downloaded to
// ~/.cache/pyr3/node and reused across builds. Bump this with intent.
const PINNED_NODE_VERSION = 'v26.0.0';

function isMacOS() {
  return platform() === 'darwin';
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

/** True if the given binary contains the SEA fuse sentinel (postject can inject into it). */
function hasSeaFuse(nodePath) {
  try {
    const count = execFileSync('grep', ['-aoc', SEA_FUSE, nodePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
    return parseInt(count, 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Path to the platform-matching Dawn-node binding from node_modules/webgpu.
 * Mirrors the lookup in `node_modules/webgpu/index.js`:
 *   - darwin → "darwin-universal.dawn.node" (Apple ships universal binaries)
 *   - linux/win → "<platform>-<arch>.dawn.node"
 */
/**
 * Walk a directory tree and return { 'viewer/<rel-path>': '<abs-path>' }
 * suitable for spreading into the SEA `assets` map. Skips `.map` files —
 * source maps inflate the binary and aren't load-bearing for the served
 * viewer.
 */
function collectViewerAssets(distDir) {
  const out = {};
  function walk(dir, relBase) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.map')) continue;
        out[`viewer/${rel}`] = full;
      }
    }
  }
  walk(distDir, '');
  return out;
}

function resolveDawnNodeForHost() {
  const plat = platform();
  const arch = plat === 'darwin' ? 'universal' : process.arch;
  const fileName = `${plat}-${arch}.dawn.node`;
  const fullPath = join(REPO_ROOT, 'node_modules', 'webgpu', 'dist', fileName);
  if (!existsSync(fullPath)) {
    throw new Error(
      `build-cli: Dawn-node binding not found at ${fullPath}. ` +
        `Did you run \`npm ci\`? Platform: ${plat}/${process.arch}.`,
    );
  }
  return fullPath;
}

function nodejsOrgArtifact() {
  const plat = platform();
  const arch = process.arch;
  if (plat === 'darwin' && arch === 'arm64') {
    return { name: `node-${PINNED_NODE_VERSION}-darwin-arm64`, ext: 'tar.gz' };
  }
  if (plat === 'darwin' && arch === 'x64') {
    return { name: `node-${PINNED_NODE_VERSION}-darwin-x64`, ext: 'tar.gz' };
  }
  if (plat === 'linux' && arch === 'x64') {
    return { name: `node-${PINNED_NODE_VERSION}-linux-x64`, ext: 'tar.xz' };
  }
  if (plat === 'linux' && arch === 'arm64') {
    return { name: `node-${PINNED_NODE_VERSION}-linux-arm64`, ext: 'tar.xz' };
  }
  throw new Error(
    `build-cli: unsupported platform/arch: ${plat}/${arch}. ` +
      `Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64.`,
  );
}

/**
 * Return the path to a Node binary with SEA fuse support, downloading + caching
 * the official nodejs.org build on first use if the host Node lacks the fuse
 * (e.g. Homebrew Node, which strips it). Idempotent across builds.
 */
async function ensureFusedNode() {
  if (hasSeaFuse(process.execPath)) {
    return process.execPath;
  }

  const { name, ext } = nodejsOrgArtifact();
  const cacheRoot = join(homedir(), '.cache', 'pyr3', 'node');
  const artifactDir = join(cacheRoot, name);
  const cachedNode = join(artifactDir, 'bin', 'node');

  if (existsSync(cachedNode) && hasSeaFuse(cachedNode)) {
    return cachedNode;
  }

  console.log(
    `📥 System Node (${process.execPath}) lacks SEA fuse — downloading ${name} …`,
  );
  mkdirSync(cacheRoot, { recursive: true });
  const tarballPath = join(cacheRoot, `${name}.${ext}`);
  const tarballUrl = `https://nodejs.org/dist/${PINNED_NODE_VERSION}/${name}.${ext}`;

  run('curl', ['-fsSL', '-o', tarballPath, tarballUrl]);
  run('tar', ['-xf', tarballPath, '-C', cacheRoot]);
  rmSync(tarballPath);

  if (!hasSeaFuse(cachedNode)) {
    throw new Error(
      `build-cli: extracted Node still lacks SEA fuse: ${cachedNode}. ` +
        `Likely platform mismatch — please file an issue.`,
    );
  }

  console.log(`   ✓ cached at ${cachedNode}`);
  return cachedNode;
}

async function buildCli(name) {
  if (!KNOWN_BINARIES[name]) {
    throw new Error(
      `build-cli: unknown binary "${name}". Known: ${Object.keys(KNOWN_BINARIES).join(', ')}`,
    );
  }

  // ── 1. Bundle (T1, #125) ─────────────────────────────────────────────
  console.log(`📦 Bundling bin/pyr3-${name}.ts → CJS …`);
  const { outFile: cjsPath, sizeBytes: cjsBytes, wallMs: bundleMs } = await bundleCli(name);
  const cjsMB = (cjsBytes / 1024 / 1024).toFixed(2);
  console.log(`   ✓ ${cjsMB} MB (${bundleMs.toFixed(0)} ms)`);

  const buildDir = join(REPO_ROOT, 'build');
  const tmpDir = join(buildDir, '.tmp');
  mkdirSync(tmpDir, { recursive: true });
  const binPath = join(buildDir, `pyr3-${name}`);
  const seaConfigPath = join(tmpDir, `sea-config-${name}.json`);
  const seaBlobPath = join(tmpDir, `sea-prep-${name}.blob`);

  // ── 2. sea-config.json ───────────────────────────────────────────────
  // The Dawn-node native binding for the host platform is bundled as a
  // SEA asset under the key "dawn.node". bin/host.ts:loadWebgpu() extracts
  // it to ~/.cache/pyr3/dawn-<sha>.node on first launch.
  // For `serve` (#201), additionally bundle the built viewer (`dist/**`)
  // as SEA assets under `viewer/<rel-path>` keys; bin/serve/assets.ts
  // reads them at runtime to host the browser UI.
  const dawnNodePath = resolveDawnNodeForHost();
  const assets = {
    'dawn.node': dawnNodePath,
    'package.json': join(REPO_ROOT, 'package.json'),
  };
  if (name === 'serve') {
    const distDir = join(REPO_ROOT, 'dist');
    if (!existsSync(distDir)) {
      throw new Error(
        `build-cli serve: ${distDir} not found. Run \`npm run build\` first to produce the viewer bundle.`,
      );
    }
    const viewerAssets = collectViewerAssets(distDir);
    const viewerCount = Object.keys(viewerAssets).length;
    if (viewerCount === 0) {
      throw new Error(`build-cli serve: ${distDir} is empty.`);
    }
    Object.assign(assets, viewerAssets);
    console.log(`   ✓ bundling ${viewerCount} viewer assets from dist/`);
  }
  const seaConfig = {
    main: cjsPath,
    output: seaBlobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets,
  };
  writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

  // ── 3. Generate sea-prep.blob ───────────────────────────────────────
  console.log('🔧 Generating SEA blob …');
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

  // ── 4. Resolve a Node binary with SEA fuse support, then copy ───────
  // Homebrew Node 26 strips the SEA fuse sentinel; official nodejs.org
  // Node ships it. ensureFusedNode() handles auto-download + cache.
  const fusedNode = await ensureFusedNode();
  console.log(`📋 Copying ${fusedNode} → ${binPath} …`);
  copyFileSync(fusedNode, binPath);
  chmodSync(binPath, 0o755);

  // ── 5. macOS: strip existing signature (postject needs an unsigned binary) ─
  if (isMacOS()) {
    console.log('🔓 Stripping existing macOS signature …');
    try {
      execFileSync('codesign', ['--remove-signature', binPath], { stdio: 'pipe' });
    } catch {
      // Already unsigned — no-op.
    }
  }

  // ── 6. postject the blob ─────────────────────────────────────────────
  console.log('💉 Injecting SEA blob …');
  const postjectArgs = [
    'postject',
    binPath,
    'NODE_SEA_BLOB',
    seaBlobPath,
    '--sentinel-fuse',
    SEA_FUSE,
  ];
  if (isMacOS()) {
    // macOS Mach-O requires the segment name for the injected resource.
    postjectArgs.push('--macho-segment-name', 'NODE_SEA');
  }
  run('npx', postjectArgs);

  // ── 7. macOS: ad-hoc re-sign ─────────────────────────────────────────
  if (isMacOS()) {
    console.log('🔏 Ad-hoc codesigning …');
    execFileSync('codesign', ['--sign', '-', binPath], { stdio: 'pipe' });
  }

  // ── 8. Result ───────────────────────────────────────────────────────
  const binSize = statSync(binPath).size;
  const binMB = (binSize / 1024 / 1024).toFixed(1);
  console.log(`\n✅ ${binPath}`);
  console.log(`   ${binMB} MB (Node runtime + bundled JS + Dawn-node asset)`);
  console.log('');
  console.log(`   Try it:`);
  console.log(`     ${binPath} public/fixtures/electricsheep.247.19679.flam3 hero.png`);
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
