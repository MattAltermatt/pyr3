// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createChaosPass, type ChaosConfig } from './chaos';
import { parseFlame } from './flame-import';
import { ISAAC_STATE_U32 } from './isaac';

const ISAAC_STATE_BYTES = ISAAC_STATE_U32 * 4;

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

interface CapturedBuffer {
  label: string;
  size: number;
}

// Minimal GPUDevice stub: captures queue.writeBuffer payloads (tagged by the
// buffer's label) and no-ops the rest of the compute-pass surface. Enough to
// drive createChaosPass + dispatch without a real GPU.
function makeMockDevice(writes: CapturedWrite[], buffers?: CapturedBuffer[]): GPUDevice {
  const noopPass = {
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups() {},
    end() {},
  };
  return {
    createBuffer: (d: { label?: string; size?: number }) => {
      buffers?.push({ label: d.label ?? '', size: d.size ?? 0 });
      return { label: d.label ?? '', destroy() {} };
    },
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

describe('issue #11 (PYR3-057) — chaos walker bound guard + ISAAC buffer sizing', () => {
  it('writes the real dispatch walker count to the walker_count uniform (slot 14)', () => {
    // The dispatch rounds the workgroup count up to a multiple of 64, so the
    // last workgroup spawns threads with no ISAAC stream. The shader needs the
    // EXACT walker count (not the rounded-up thread count) to bail those
    // threads before they contaminate the histogram with stale-RNG hits.
    const { genome } = parseFlame(FLAME);
    const writes: CapturedWrite[] = [];
    const pass = createChaosPass(makeMockDevice(writes), baseConfig(1)); // config.walkers = 4
    pass.dispatch(genome, 7, { walkers: 10, itersPerWalker: 8 });

    const u = writes.find((w) => w.label === 'pyr3.chaos.uniforms');
    expect(u).toBeDefined();
    const u32 = new Uint32Array(u!.data as ArrayBuffer);
    expect(u32[14]).toBe(10); // walker_count = real count, NOT ceil(10/64)*64
  });

  it('grows the ISAAC buffer so a dispatch with walkers > config.walkers never overruns it', () => {
    // config.walkers = 4 sizes the initial buffer at 4 streams. A dispatch
    // asking for 100 walkers must NOT writeBuffer 100 streams into a 4-stream
    // buffer (WebGPU validation error → silent blank/garbage). The buffer must
    // grow to fit.
    const { genome } = parseFlame(FLAME);
    const writes: CapturedWrite[] = [];
    const buffers: CapturedBuffer[] = [];
    const pass = createChaosPass(makeMockDevice(writes, buffers), baseConfig(1)); // config.walkers = 4
    pass.dispatch(genome, 7, { walkers: 100, itersPerWalker: 8 });

    const isaacWrite = writes.filter((w) => w.label === 'pyr3.chaos.isaac').at(-1);
    const isaacBuf = buffers.filter((b) => b.label === 'pyr3.chaos.isaac').at(-1);
    expect(isaacWrite).toBeDefined();
    expect(isaacBuf).toBeDefined();
    expect(isaacWrite!.data.byteLength).toBe(100 * ISAAC_STATE_BYTES);
    // The buffer the write lands in must be at least as large as the payload.
    expect(isaacBuf!.size).toBeGreaterThanOrEqual(isaacWrite!.data.byteLength);
  });

  it('reuses the ISAAC buffer when the dispatch fits the existing capacity', () => {
    const { genome } = parseFlame(FLAME);
    const writes: CapturedWrite[] = [];
    const buffers: CapturedBuffer[] = [];
    const pass = createChaosPass(makeMockDevice(writes, buffers), baseConfig(1)); // config.walkers = 4
    pass.dispatch(genome, 7, { walkers: 4, itersPerWalker: 8 });

    // Only the single creation-time ISAAC buffer — no growth needed.
    const isaacCreations = buffers.filter((b) => b.label === 'pyr3.chaos.isaac');
    expect(isaacCreations.length).toBe(1);
  });
});
