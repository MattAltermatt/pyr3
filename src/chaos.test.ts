// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createChaosPass, type ChaosConfig } from './chaos';
import { parseFlame } from './flame-import';

// chaos.ts references GPUBufferUsage bitflags as globals; they don't exist in
// the happy-dom test env (only under a real GPU / dawn-node). The mock device
// ignores buffer `usage`, so any numeric stub keeps `GPUBufferUsage.X | ...`
// from throwing.
(globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage = new Proxy(
  {},
  { get: () => 0 },
);

// Minimal flame → a valid Genome that survives the dispatch packing path.
const minPalette = '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>';
const FLAME =
  `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}` +
  `<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/></flame>`;

interface CapturedWrite {
  label: string;
  data: ArrayBufferLike;
}

// Minimal GPUDevice stub: captures queue.writeBuffer payloads (tagged by the
// buffer's label) and no-ops the rest of the compute-pass surface. Enough to
// drive createChaosPass + dispatch without a real GPU.
function makeMockDevice(writes: CapturedWrite[]): GPUDevice {
  const noopPass = {
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups() {},
    end() {},
  };
  return {
    createBuffer: (d: { label?: string }) => ({ label: d.label ?? '', destroy() {} }),
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginComputePass: () => noopPass,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (buf: { label: string }, _off: number, data: ArrayBufferLike) =>
        writes.push({ label: buf.label, data }),
      submit() {},
    },
  } as unknown as GPUDevice;
}

const baseConfig = (oversample: number): ChaosConfig => ({
  width: 64,
  height: 64,
  walkers: 4,
  itersPerWalker: 8,
  fuse: 0,
  oversample,
});

describe('PYR3-008 — chaos splat scale reads pipeline oversample, not genome.oversample', () => {
  it('uses scale = genome.scale × CONFIG.oversample even when genome.oversample disagrees', () => {
    const { genome } = parseFlame(FLAME);
    genome.scale = 5;
    genome.oversample = 99; // stale/mismatched genome value — MUST be ignored

    const writes: CapturedWrite[] = [];
    const pass = createChaosPass(makeMockDevice(writes), baseConfig(2)); // pipeline authority = 2
    pass.dispatch(genome, 123);

    const uniformWrite = writes.find((w) => w.label === 'pyr3.chaos.uniforms');
    expect(uniformWrite).toBeDefined();
    // f32[4] is the splat-scale uniform written by chaos.ts dispatch.
    const f32 = new Float32Array(uniformWrite!.data as ArrayBuffer);
    expect(f32[4]).toBe(5 * 2); // pipeline oversample (2), NOT genome's 99
  });
});
