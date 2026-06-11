// @vitest-environment node
//
// #114 batch 2b-a — GPU kernel tests for juliaq / glynnia / loonie3 /
// falloff / falloff2 / falloff3.
//
// - loonie3 (no RNG): full f64 oracle parity check against the WGSL formula.
// - juliaq / glynnia / falloff trio (RNG): finite-output smoke. Full
//   ISAAC-mirrored parity deferred alongside the rand-capture infra
//   (BACKLOG, same as batch 1 cpow2/cpow3/epispiral-thickness>0).
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { ISAAC_STATE_U32, packIsaacStates } from './isaac';

Object.assign(globalThis, globals);

let _gpu: ReturnType<typeof create> | null = null;
let device: GPUDevice | null = null;
try {
  _gpu = create([]);
  const adapter = await _gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);

const STRUCT_MATCH = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\};/);
if (!STRUCT_MATCH) throw new Error('chaos.wgsl: struct IsaacState not found');
const ISAAC_STRUCT = STRUCT_MATCH[0];
const ISAAC_ROUND = extractWgslFn(SHADER_SRC, 'isaac_round');
const ISAAC_IRAND = extractWgslFn(SHADER_SRC, 'isaac_irand');
const RAND01 = extractWgslFn(SHADER_SRC, 'rand01');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const PRELUDE_CONSTS = `const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const SIN_SAFE_MAX: f32 = 1e6;
`;

const KERNEL_PRELUDE = `
${PRELUDE_CONSTS}
${ISAAC_STRUCT}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read> pts: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> out: array<vec2f>;
${ISAAC_ROUND}
${ISAAC_IRAND}
${RAND01}
${HASH01}
${SAFE_SIN}
${SAFE_COS}
`;

const TEST_POINTS: ReadonlyArray<readonly [number, number]> = [
  [ 0.5,  0.3],
  [-0.5,  0.7],
  [ 1.2, -0.4],
  [-1.0, -1.0],
  [ 0.1,  0.05],
  [ 2.0,  0.0],
  [ 0.0,  2.0],
  [-2.5,  1.7],
];
const N = TEST_POINTS.length;

async function dispatch(code: string, walkers: number, seed: number, useRng: boolean): Promise<Float32Array> {
  const dev = device!;
  const ptsFlat = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    ptsFlat[i * 2] = TEST_POINTS[i]![0];
    ptsFlat[i * 2 + 1] = TEST_POINTS[i]![1];
  }
  const ptsBuf = dev.createBuffer({
    size: ptsFlat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(ptsBuf, 0, ptsFlat);

  let stateBuf: GPUBuffer | null = null;
  if (useRng) {
    stateBuf = dev.createBuffer({
      size: walkers * ISAAC_STATE_U32 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const packed = packIsaacStates(walkers, seed);
    dev.queue.writeBuffer(stateBuf, 0, packed);
  }

  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  dev.pushErrorScope('validation');
  const mod = await compileChecked(dev, code);
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const valErr = await dev.popErrorScope();
  if (valErr) throw new Error(`#263 — pipeline validation error: ${valErr.message}`);
  const entries: GPUBindGroupEntry[] = [
    { binding: 1, resource: { buffer: ptsBuf } },
    { binding: 2, resource: { buffer: outBuf } },
  ];
  if (useRng && stateBuf) entries.unshift({ binding: 0, resource: { buffer: stateBuf } });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries,
  });
  const encoder = dev.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  const readback = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  ptsBuf.destroy(); stateBuf?.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

// =====================================================================
// loonie3 — no RNG, deterministic. Full f64 oracle parity.
// =====================================================================

function loonie3Oracle(x: number, y: number, w: number): [number, number] {
  const sqrvvar = w * w;
  const SMALL_EPSILON = 1e-30;
  let r2 = 2 * sqrvvar;
  if (x > SMALL_EPSILON) {
    const num = x * x + y * y;
    const q = num / x;
    r2 = q * q;
  }
  if (r2 < sqrvvar) {
    const r = w * Math.sqrt(sqrvvar / r2 - 1);
    return [r * x, r * y];
  }
  return [w * x, w * y];
}

describe.skipIf(!device)('#114 batch 2b-a — var_loonie3', () => {
  it('matches f64 oracle within 1e-3 (default w=1.0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_loonie3');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_loonie3(pts[i], 1.0);
}`;
    const out = await dispatch(code, 1, 0xc0ffee, false);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = loonie3Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('produces finite output across the half-plane gating boundary', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_loonie3');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_loonie3(pts[i], 0.7);
}`;
    const out = await dispatch(code, 1, 0xc0ffee, false);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

// =====================================================================
// juliaq — RNG-driven branch picker.
// =====================================================================

describe.skipIf(!device)('#114 batch 2b-a — var_juliaq (smoke)', () => {
  it('produces finite output at default params (power=3, divisor=2)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_juliaq');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_juliaq(pts[i], 1.0, 3.0, 2.0, i);
}`;
    const out = await dispatch(code, N, 0x12345678, true);
    let finiteCount = 0;
    for (let i = 0; i < N * 2; i++) if (Number.isFinite(out[i]!)) finiteCount++;
    // Allow a couple of non-finite at extreme inputs (p≈0 → pow diverges).
    expect(finiteCount).toBeGreaterThanOrEqual(N * 2 - 4);
  });
});

// =====================================================================
// glynnia — coin-flip + inside/outside disk branches.
// =====================================================================

describe.skipIf(!device)('#114 batch 2b-a — var_glynnia (smoke)', () => {
  it('produces finite output (default, w=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_glynnia');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_glynnia(pts[i], 1.0, i);
}`;
    const out = await dispatch(code, N, 0xc0debabe, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

// =====================================================================
// falloff trio — RNG-driven distance-weighted scatter.
// =====================================================================

describe.skipIf(!device)('#114 batch 2b-a — var_falloff (smoke)', () => {
  it('produces finite output (defaults)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_falloff');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_falloff(pts[i], 1.0, 1.0, 0.5, 1.0, 1.0, 0.0, 0.0, i);
}`;
    const out = await dispatch(code, N, 0xfa11, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

describe.skipIf(!device)('#114 batch 2b-a — var_falloff2 (smoke, all 3 type branches)', () => {
  it('type=0 default produces finite output', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_falloff2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_falloff2(pts[i], 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.5, i);
}`;
    const out = await dispatch(code, N, 0xfa12, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('type=1 radial produces finite output', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_falloff2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_falloff2(pts[i], 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.5, i);
}`;
    const out = await dispatch(code, N, 0xfa13, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('type=2 gaussian produces finite output', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_falloff2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_falloff2(pts[i], 1.0, 1.0, 2.0, 1.0, 1.0, 0.0, 0.0, 0.5, i);
}`;
    const out = await dispatch(code, N, 0xfa14, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

describe.skipIf(!device)('#114 batch 2b-a — var_falloff3 (smoke)', () => {
  it('produces finite output (defaults, invert=0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_falloff3');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_falloff3(pts[i], 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.5, 0.0, i);
}`;
    const out = await dispatch(code, N, 0xfa15, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('produces finite output with invert=1', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_falloff3');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_falloff3(pts[i], 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.5, 1.0, i);
}`;
    const out = await dispatch(code, N, 0xfa16, true);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
