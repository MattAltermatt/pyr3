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
    // cjsRequire (not the embedder) is needed here — absolute filesystem paths.
    return cjsRequire(cachedPath);
  }

  // Non-SEA: builtinRequire walks up from the bundle / source dir and finds
  // node_modules/webgpu. cjsRequire's fallback base path is the Node binary
  // itself, which would walk away from the repo.
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

/** Acquire a Dawn-node WebGPU device with the browser-matching requiredLimits + a device.lost handler. */
export async function acquireDawnDevice(toolName: string): Promise<GPUDevice> {
  _pinnedNavigator = { gpu: create([]) };
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
  kind: LoadKind;
  dropped: number;
  ignored: number;
}

/** Parse a flame XML or pyr3 JSON file (sniffed by filename + content) into a Genome + drop/ignore counts. */
export function parseGenomeText(text: string, filename: string): ParsedGenome {
  const kind = sniffKind(filename, text);
  if (kind === 'flame') {
    const { genome, report } = parseFlame(text);
    return {
      genome,
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
