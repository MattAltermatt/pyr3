// pyr3 — host shim + CLI helpers shared by every Dawn-driven bin/ tool.
//
// The seam: engine code (src/*) sees no environment branching. CLI hosts
// stamp WebGPU globals onto globalThis here so the engine runs unmodified.

import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

import { sniffKind, type LoadKind } from '../src/loader';
import { parseFlame } from '../src/flame-import';
import { genomeFromJson } from '../src/serialize';
import { type Genome } from '../src/genome';

/** Stamp happy-dom DOMParser + webgpu globals onto globalThis. */
export function installWebGPUHost(): void {
  const win = new Window();
  (globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
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
