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

/**
 * Rewrite a Windows PE `.node`'s import-table DLL name `node.exe` → `hostName`
 * so the loader binds the addon's N-API imports to the running (renamed) host
 * process instead of a stray node.exe on PATH. See the call site (#399) for why
 * Dawn-node needs this and node-gyp addons don't.
 *
 * Two strategies, picked by length:
 *   - `hostName` (incl. NUL) fits the existing `node.exe` slot → overwrite in
 *     place, NUL-padding any leftover bytes.
 *   - longer → APPEND a fresh, dedicated section holding the name and repoint
 *     the import descriptor's Name RVA at it. (Hunting incidental zero runs to
 *     reuse is unsafe — a zero region inside .rdata can be live zero-initialised
 *     data, not slack; a new section can never clobber existing image bytes.)
 *
 * Idempotent: returns the buffer unchanged if the import already is `hostName`.
 * Returns a possibly-larger Buffer (append path grows it); the original `bytes`
 * may be mutated in place (overwrite path). win32-x64 only — never called off
 * win32. Throws on a malformed PE or no node.exe import (a real, loud bug).
 */
export function patchWindowsNodeImport(bytes: Buffer, hostName: string): Buffer {
  const want = Buffer.from(hostName + '\0', 'latin1');
  const eLfanew = bytes.readUInt32LE(0x3c);
  const coff = eLfanew + 4;
  const numSections = bytes.readUInt16LE(coff + 2);
  const optSize = bytes.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const pe32plus = bytes.readUInt16LE(opt) === 0x20b;
  const ddStart = opt + (pe32plus ? 112 : 96);
  const importRva = bytes.readUInt32LE(ddStart + 8); // data dir [1] = import table
  const secHdr = opt + optSize;

  interface Sec {
    vaddr: number;
    vsize: number;
    praw: number;
    rsize: number;
  }
  const sections: Sec[] = [];
  for (let i = 0; i < numSections; i++) {
    const o = secHdr + i * 40;
    sections.push({
      vsize: bytes.readUInt32LE(o + 8),
      vaddr: bytes.readUInt32LE(o + 12),
      rsize: bytes.readUInt32LE(o + 16),
      praw: bytes.readUInt32LE(o + 20),
    });
  }
  const rva2off = (rva: number): number => {
    for (const s of sections) {
      if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rsize)) {
        return s.praw + (rva - s.vaddr);
      }
    }
    return -1;
  };
  const cstrLen = (off: number): number => {
    let e = off;
    while (bytes[e]) e++;
    return e - off;
  };

  // Walk the import descriptors (20 bytes each, Name RVA at +12) for node.exe.
  let descOff = -1;
  let nameOff = -1;
  let oldLen = 0;
  for (let o = rva2off(importRva); ; o += 20) {
    const nameRva = bytes.readUInt32LE(o + 12);
    if (nameRva === 0) break;
    const off = rva2off(nameRva);
    const name = bytes.toString('latin1', off, off + cstrLen(off));
    if (name === hostName) return bytes; // already patched — idempotent
    if (name.toLowerCase() === 'node.exe') {
      descOff = o;
      nameOff = off;
      oldLen = name.length;
    }
  }
  if (descOff < 0) throw new Error('patchWindowsNodeImport: no node.exe import descriptor');

  // In-place: fits the old string + its NUL terminator.
  if (want.length <= oldLen + 1) {
    want.copy(bytes, nameOff);
    for (let i = want.length; i <= oldLen; i++) bytes[nameOff + i] = 0;
    return bytes;
  }

  // Append a new section for the longer name.
  const align = (n: number, a: number): number => Math.ceil(n / a) * a;
  const secAlign = bytes.readUInt32LE(opt + 32);
  const fileAlign = bytes.readUInt32LE(opt + 36);
  const hdrEnd = secHdr + numSections * 40;
  let firstRaw = Infinity;
  let maxVEnd = 0;
  for (const s of sections) {
    if (s.praw > 0) firstRaw = Math.min(firstRaw, s.praw);
    maxVEnd = Math.max(maxVEnd, s.vaddr + s.vsize);
  }
  if (firstRaw - hdrEnd < 40) {
    throw new Error('patchWindowsNodeImport: no header slack for a new section');
  }

  const newVaddr = align(maxVEnd, secAlign);
  const newPraw = align(bytes.length, fileAlign);
  const newRawSize = align(want.length, fileAlign);
  const grown = Buffer.alloc(newPraw + newRawSize);
  bytes.copy(grown, 0);
  want.copy(grown, newPraw);

  const nh = hdrEnd; // new section header slot
  grown.write('.pyr3nm\0', nh, 'latin1'); // 8-byte Name field
  grown.writeUInt32LE(want.length, nh + 8); // VirtualSize
  grown.writeUInt32LE(newVaddr, nh + 12); // VirtualAddress
  grown.writeUInt32LE(newRawSize, nh + 16); // SizeOfRawData
  grown.writeUInt32LE(newPraw, nh + 20); // PointerToRawData
  grown.writeUInt32LE(0x40000040, nh + 36); // MEM_READ | CNT_INITIALIZED_DATA
  grown.writeUInt16LE(numSections + 1, coff + 2); // NumberOfSections
  grown.writeUInt32LE(align(newVaddr + want.length, secAlign), opt + 56); // SizeOfImage
  grown.writeUInt32LE(newVaddr, descOff + 12); // repoint import Name RVA
  return grown;
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
    const { join, basename } = builtinRequire('node:path') as typeof import('node:path');

    let bytes: Buffer = Buffer.from(buf);
    // Windows: win32-x64.dawn.node statically imports its N-API symbols from a
    // DLL literally named `node.exe` (it's a GN/CMake build with no node-gyp
    // delay-load hook). Under a SEA the host exe is NOT named node.exe, so the
    // Windows loader can't bind that import to THIS process and instead resolves
    // a *different* node.exe found on PATH — a second, uninitialized V8/N-API
    // runtime — into which the addon registers, faulting (0xC0000005) the moment
    // its init touches a napi entrypoint. Rewrite the import's DLL name to the
    // running host's own basename so it binds to this process's exports. No-op
    // off win32 and when the host already is node.exe (the from-source path).
    // See #399. The cache key (hash below) is taken over the PATCHED bytes, so
    // distinct host names (pyr3-render.exe vs pyr3-serve.exe, or a user rename)
    // get distinct cache files automatically — no collision.
    if (process.platform === 'win32') {
      const hostName = basename(process.execPath);
      if (hostName.toLowerCase() !== 'node.exe') {
        bytes = patchWindowsNodeImport(bytes, hostName);
      }
    }
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
    // require(): inside a SEA binary the native `require` is the embedder
    // require, which only knows builtins and throws on an absolute .node path.
    // process.dlopen — the primitive require() itself calls — loads it directly.
    // We pass a fresh module object and read its `.exports`, exactly as the CJS
    // loader would. (On Windows this only succeeds because the import name was
    // rewritten above; an unpatched node.exe import faults here regardless of
    // whether require() or dlopen() drives the load — #399.)
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
