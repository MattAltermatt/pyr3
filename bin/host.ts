// pyr3 — host shim + CLI helpers shared by every Dawn-driven bin/ tool.
//
// The seam: engine code (src/*) sees no environment branching. CLI hosts
// stamp WebGPU globals onto globalThis here so the engine runs unmodified.

import { DOMParser } from 'linkedom';
import { createRequire } from 'node:module';

import { sniffKind, type LoadKind } from '../src/loader';
import { parseFlame } from '../src/flame-import';
import { genomeFromJson } from '../src/serialize';
import { type Genome } from '../src/genome';
import { type Animation } from '../src/animation';

// Two require flavors, picked by call site:
//   - `builtinRequire` resolves built-in modules (`node:sea`, `node:fs`, …).
//     Inside a SEA binary the native `require` is the embedder require, which
//     ONLY knows builtins — filesystem paths throw ERR_UNKNOWN_BUILTIN_MODULE.
//   - `cjsRequire` is the standard CommonJS require (from createRequire). It
//     CAN load absolute paths and walks node_modules. Used to dlopen the
//     extracted Dawn .node and to fall back to `require('webgpu')` outside SEA.
declare const require: NodeJS.Require | undefined;
const builtinRequire: NodeJS.Require =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);
const cjsRequire = createRequire(import.meta.url ?? `file://${process.execPath}`);

/**
 * Resolve the Dawn-node WebGPU binding in BOTH execution modes:
 *
 *   - **npm-installed** (`npm run render`, plain `node build/.tmp/*.cjs`):
 *     the `webgpu` package sits in `node_modules` and resolves normally.
 *   - **SEA binary** (`build/pyr3-render`): no node_modules exists; the
 *     platform's `.dawn.node` is bundled as a SEA asset by build-cli.mjs.
 *     Extract it to `~/.cache/pyr3/dawn-<sha>.node` (hash-cached so the
 *     write only happens once per binary build) and `require()` the path.
 *
 * Returns the same shape as `node_modules/webgpu/index.js`: `{ create, globals }`.
 */
/**
 * Windows: the Dawn Vulkan backend (which we force on win32 to dodge the FXC
 * hang — see DAWN_FEATURE_FLAGS) loads the Vulkan loader with
 * `LoadLibraryExA("vulkan-1.dll", …, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | …)`.
 * That search anchors to the directory of the .dawn.node making the call, NOT
 * System32 — a bare `vulkan-1.dll` from System32 fails with Windows Error 87
 * (ERROR_INVALID_PARAMETER). Empirically, dropping a copy of the loader next to
 * the .node makes the load succeed (same sidecar trick as d3dcompiler_47.dll).
 *
 * We copy the host's own System32 loader (ABI-stable; it finds the installed
 * GPU vendor ICD via the registry regardless of its file location) rather than
 * bundling one — so the cached loader always matches the target machine. No-op
 * off win32. Idempotent: skips if already present. Soft-fails with a hint if
 * the system has no Vulkan loader at all (then Dawn surfaces its own error).
 */
function ensureVulkanLoader(
  targetDir: string,
  fs: typeof import('node:fs'),
  join: typeof import('node:path')['join'],
): void {
  if (process.platform !== 'win32') return;
  const dest = join(targetDir, 'vulkan-1.dll');
  if (fs.existsSync(dest)) return;
  const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const src = join(sysRoot, 'System32', 'vulkan-1.dll');
  if (!fs.existsSync(src)) {
    console.error(
      'pyr3: Vulkan loader (vulkan-1.dll) not found in System32 — install ' +
        'your GPU vendor driver / Vulkan runtime to render on Windows.',
    );
    return;
  }
  try {
    fs.copyFileSync(src, dest);
  } catch (err) {
    console.error(
      `pyr3: failed to stage vulkan-1.dll into ${targetDir}: ` +
        `${err instanceof Error ? err.message : err}`,
    );
  }
}

function loadWebgpu(): { create: (flags: string[]) => { requestAdapter: () => Promise<GPUAdapter | null> }; globals: object } {
  // Probe for `node:sea`. Available inside a SEA binary; throws
  // ERR_UNKNOWN_BUILTIN_MODULE in normal Node, which we catch and fall
  // through to the npm-installed path. We DON'T wrap the SEA work itself
  // in try/catch — if SEA mode is active but extraction fails, that's a
  // real bug we want to see.
  let sea:
    | { isSea?: () => boolean; getAsset?: (key: string) => ArrayBuffer }
    | undefined;
  try {
    sea = builtinRequire('node:sea');
  } catch {
    // Not a SEA binary — fall through.
  }

  if (sea?.isSea?.()) {
    const buf = sea.getAsset!('dawn.node');
    const { createHash } = builtinRequire('node:crypto') as typeof import('node:crypto');
    const { homedir } = builtinRequire('node:os') as typeof import('node:os');
    const fs = builtinRequire('node:fs') as typeof import('node:fs');
    const { join } = builtinRequire('node:path') as typeof import('node:path');

    const bytes = Buffer.from(buf);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const cacheDir = join(homedir(), '.cache', 'pyr3');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cachedPath = join(cacheDir, `dawn-${hash}.node`);
    if (!fs.existsSync(cachedPath)) {
      fs.writeFileSync(cachedPath, bytes);
    }
    // Windows: win32-x64.dawn.node depends on a sibling d3dcompiler_47.dll
    // (Dawn's HLSL → DXBC compile path). process.dlopen searches the .node's
    // own directory for its dependents (LOAD_WITH_ALTERED_SEARCH_PATH), so the
    // DLL must be extracted next to the cached .node — otherwise the require()
    // below fails with ERR_DLOPEN_FAILED. Bundled as a SEA asset on win32 by
    // build-cli.mjs; absent on other platforms.
    if (process.platform === 'win32') {
      const dllBytes = Buffer.from(sea.getAsset!('d3dcompiler_47.dll'));
      const dllPath = join(cacheDir, 'd3dcompiler_47.dll');
      if (!fs.existsSync(dllPath)) {
        fs.writeFileSync(dllPath, dllBytes);
      }
      // Stage the Vulkan loader next to the extracted .node (win32 uses the
      // Vulkan backend — see DAWN_FEATURE_FLAGS).
      ensureVulkanLoader(cacheDir, fs, join);
    }
    // Load the native binding with the low-level process.dlopen rather than
    // require(): inside a SEA binary, createRequire()-based loading of an
    // absolute .node path segfaults (the embedder module system + native-addon
    // registration don't compose), whereas process.dlopen — the primitive
    // require() itself calls — loads it cleanly. We pass a fresh module object
    // and read its `.exports`, exactly as the CJS loader would.
    type WebgpuModule = ReturnType<typeof loadWebgpu>;
    const nodeMod: { exports: WebgpuModule } = { exports: {} as WebgpuModule };
    (process as unknown as { dlopen: (m: object, p: string) => void }).dlopen(
      nodeMod,
      cachedPath,
    );
    return nodeMod.exports;
  }

  // Non-SEA: builtinRequire walks up from the bundle / source dir and finds
  // node_modules/webgpu. cjsRequire's fallback base path is the Node binary
  // itself, which would walk away from the repo.
  if (process.platform === 'win32') {
    const fs = builtinRequire('node:fs') as typeof import('node:fs');
    const { join, dirname } = builtinRequire('node:path') as typeof import('node:path');
    // The win32 .dawn.node sits in node_modules/webgpu/dist; the Vulkan loader
    // must sit beside it for Dawn's LoadLibraryExA search to find it.
    const distDir = join(dirname(builtinRequire.resolve('webgpu')), 'dist');
    ensureVulkanLoader(distDir, fs, join);
  }
  return builtinRequire('webgpu');
}

const { create, globals } = loadWebgpu();

/** Stamp DOMParser + webgpu globals onto globalThis. */
export function installWebGPUHost(): void {
  (globalThis as { DOMParser: unknown }).DOMParser = DOMParser;
  Object.assign(globalThis, globals);
}

// Module-scope pin: the GPU instance from `create([])` must outlive the
// function that asked for it — Dawn's native side keeps a pointer to it,
// and letting JS GC the local `navigator` mid-render segfaults under V8.
let _pinnedNavigator: { gpu: ReturnType<typeof create> } | null = null;

// Dawn instance feature flags. On Windows the default D3D12 backend compiles
// WGSL→HLSL→DXBC through FXC (d3dcompiler_47.dll), which is single-threaded and
// pathologically slow on pyr3's large chaos shader (323-variation dispatch) —
// `createRenderer()` effectively hangs for minutes, CPU-pinned, GPU idle. DXC
// (the modern compiler) is hard-disabled in webgpu@0.4.0's Dawn build
// (`use_dxc` is force-toggled to 0), so we can't route around FXC on D3D12.
// Forcing the Vulkan backend (tint→SPIR-V→driver) bypasses FXC entirely; the
// first render pays a one-time, BOUNDED SPIR-V→ISA pipeline compile (~tens of
// seconds) instead of an unbounded FXC hang. macOS/Linux use Metal/Vulkan by
// default and are unaffected, so the override is Windows-only. The Vulkan
// loader is staged next to the .dawn.node by ensureVulkanLoader(). See
// node_modules/webgpu/README.md for the `enable-dawn-features` flag format.
const DAWN_FEATURE_FLAGS: string[] =
  process.platform === 'win32' ? ['backend=vulkan'] : [];

/**
 * Per-submit iters-per-walker cap for the chaos pass — keeps a single GPU
 * dispatch under the OS GPU watchdog (TDR, Timeout Detection & Recovery).
 *
 * On Windows a chaos dispatch that runs longer than ~2s is killed by TDR: the
 * driver resets the GPU and the histogram reads back ZEROED — a silent blank
 * render (no device-lost event, exit 0). Empirically, at 800px long-edge,
 * quality ≥ 300 (~130k iters/walker on 1024 walkers) already trips it; quality
 * 200 (~92k) is fine. So hosts must split a long dispatch into multiple shorter
 * submits, each an independent re-seeded batch accumulating into the shared
 * histogram — which preserves the long-trajectory parity model (walkers stay =
 * dispatchWalkers per chunk; only iters-per-submit is bounded).
 *
 * 32768 sits comfortably below the ~92k-works / ~130k-blanks band with margin
 * for heavier genomes (more variations per xform → higher per-iter cost → fewer
 * iters fit the 2s window). macOS Metal and Linux Vulkan tolerate the long
 * single dispatch (MAX_ITERS_PER_WALKER = 2^20 was already tuned to Metal's
 * TDR), so off-win32 the cap is Infinity → no extra chunking, byte-identical to
 * the historical single-shot on the parity-reference machine.
 *
 * Host-side (not in the engine) so src/* stays free of environment branching —
 * the "single engine, two consumers" seam.
 */
export const MAX_ITERS_PER_SUBMIT: number =
  process.platform === 'win32' ? 32768 : Infinity;

/** Acquire a Dawn-node WebGPU device with the browser-matching requiredLimits + a device.lost handler. */
export async function acquireDawnDevice(toolName: string): Promise<GPUDevice> {
  _pinnedNavigator = { gpu: create(DAWN_FEATURE_FLAGS) };
  const adapter = await _pinnedNavigator.gpu.requestAdapter();
  if (!adapter) throw new Error(`${toolName}: no GPU adapter from Dawn`);
  const limits = adapter.limits;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  });
  void device.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    console.error(
      `${toolName}: WebGPU device lost (${info.reason || 'unknown'}): ${info.message}`,
    );
    process.exitCode = 1;
  });
  return device;
}

export interface ParsedGenome {
  genome: Genome;
  /** Set only when the input was a multi-keyframe `.flam3`. Single-keyframe
   *  or `.pyr3.json` inputs leave this undefined. (Animation P1, #206). */
  animation?: Animation;
  kind: LoadKind;
  dropped: number;
  ignored: number;
}

/** Parse a flame XML or pyr3 JSON file (sniffed by filename + content) into a Genome + drop/ignore counts. */
export function parseGenomeText(text: string, filename: string): ParsedGenome {
  const kind = sniffKind(filename, text);
  if (kind === 'flame') {
    const { genome, animation, report } = parseFlame(text);
    return {
      genome,
      ...(animation ? { animation } : {}),
      kind,
      dropped: report.droppedVariations.length,
      ignored: report.ignoredFields.length,
    };
  }
  return { genome: genomeFromJson(JSON.parse(text)), kind, dropped: 0, ignored: 0 };
}

/** Parse a CLI flag value as a positive integer. Errors + exits on missing / NaN / sub-1. */
export function parsePositiveInt(value: string | undefined, flagName: string): number {
  const n = value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`${flagName} requires a positive integer argument`);
    process.exit(1);
  }
  return Math.max(1, Math.floor(n));
}
