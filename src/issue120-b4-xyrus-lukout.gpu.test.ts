// @vitest-environment node
//
// #120 batch B4 — GPU tests for Xyrus02 + Lu-Kout remainders.
//   - curl_sp + murl2: deterministic → full f64 oracle parity at defaults
//   - lissajous + spirograph + waffle: RNG-driven → finite-output smoke
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { ISAAC_STATE_U32, packIsaacStates } from './isaac';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const STRUCT_MATCH = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\};/);
if (!STRUCT_MATCH) throw new Error('chaos.wgsl: struct IsaacState not found');
const ISAAC_STRUCT = STRUCT_MATCH[0];
const ISAAC_ROUND = extractWgslFn(SHADER_SRC, 'isaac_round');
const ISAAC_IRAND = extractWgslFn(SHADER_SRC, 'isaac_irand');
const RAND01 = extractWgslFn(SHADER_SRC, 'rand01');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');

const PRELUDE = `const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const SIN_SAFE_MAX: f32 = 1e6;
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

async function dispatch(code: string, seed: number): Promise<Float32Array> {
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
  const stateBuf = dev.createBuffer({
    size: N * ISAAC_STATE_U32 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(stateBuf, 0, packIsaacStates(N, seed));
  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const mod = await compileChecked(dev, code);
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: stateBuf } },
      { binding: 1, resource: { buffer: ptsBuf } },
      { binding: 2, resource: { buffer: outBuf } },
    ],
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
  ptsBuf.destroy(); stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

function makeKernel(varBody: string, varCall: string): string {
  // Tickle isaac_states from main so layout:'auto' keeps binding 0 alive
  // even for deterministic vars.
  return `${PRELUDE}
${varBody}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  if (i == 0xffffffffu) { out[0] = vec2f(f32(isaac_states[0].randcnt)); }
  out[i] = ${varCall};
}`;
}

describe.skipIf(!device)('#120 B4 — Xyrus02 + Lu-Kout remainders', () => {
  it('var_curl_sp matches f64 oracle at defaults (pow=1, c1=-0.01, c2=0.03, sx=sy=0)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_curl_sp');
    const code = makeKernel(fn, 'var_curl_sp(pts[i], 1.0, 1.0, -0.01, 0.03, 0.0, 0.0)');
    const out = await dispatch(code, 0xc0ffee);
    for (let i = 0; i < N; i++) {
      const x = TEST_POINTS[i]![0], y = TEST_POINTS[i]![1];
      // Oracle (defaults)
      const c1 = -0.01, c2 = 0.03;
      const xp = Math.pow(Math.abs(x), 1.0) * Math.sign(x);
      const yp = Math.pow(Math.abs(y), 1.0) * Math.sign(y);
      const d = xp * xp - yp * yp;
      const s1a = c1 * xp + c2 * d;
      const re = Math.sqrt(s1a * s1a) * (s1a > 0 ? 1 : -1) + 1.0;
      const s2a = c1 * yp + 2.0 * c2 * xp * yp;
      const im = Math.sqrt(s2a * s2a) * (s2a > 0 ? 1 : -1);
      const c = Math.pow(Math.abs(re * re + im * im), 1.0);
      const r = 1.0 / Math.max(c, 1e-30);
      const ox = (xp * re + yp * im) * r;
      const oy = (yp * re - xp * im) * r;
      // Loose tolerance: at boundary cases (s1a == 0 etc) the sign rule can
      // flip vs strict spec; allow 1e-3.
      if (Number.isFinite(ox)) expect(out[i * 2]).toBeCloseTo(ox, 3);
      if (Number.isFinite(oy)) expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('var_murl2 matches f64 oracle at defaults (c=0.1, power=3)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_murl2');
    const code = makeKernel(fn, 'var_murl2(pts[i], 1.0, 0.1, 3.0)');
    const out = await dispatch(code, 0xfacade);
    for (let i = 0; i < N; i++) {
      const x = TEST_POINTS[i]![0], y = TEST_POINTS[i]![1];
      const c = 0.1, safe_pow = 3.0;
      const p2 = safe_pow * 0.5;
      const invp = 1.0 / safe_pow;
      const cp1 = c + 1.0;
      const vp = Math.pow(Math.abs(cp1), 2.0 * invp) * (cp1 >= 0 ? 1 : -1);
      const a1 = Math.atan2(y, x) * safe_pow;
      const r0 = c * Math.pow(Math.abs(x * x + y * y), p2);
      const re0 = r0 * Math.cos(a1) + 1.0;
      const im0 = r0 * Math.sin(a1);
      const r1 = Math.pow(Math.abs(re0 * re0 + im0 * im0), invp);
      const a2 = Math.atan2(im0, re0) * 2.0 * invp;
      const re1 = r1 * Math.cos(a2);
      const im1 = r1 * Math.sin(a2);
      const rl = vp / Math.max(r1 * r1, 1e-30);
      const ox = rl * (x * re1 + y * im1);
      const oy = rl * (y * re1 - x * im1);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('var_lissajous produces finite output (RNG path)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_lissajous');
    const code = makeKernel(fn, 'var_lissajous(pts[i], 1.0, -3.14159, 3.14159, 3.0, 2.0, 0.0, 0.0, 0.0, i)');
    const out = await dispatch(code, 0xdeadbeef);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('var_spirograph produces finite output (9 params, RNG)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_spirograph');
    const code = makeKernel(fn, 'var_spirograph(pts[i], 1.0, 3.0, 2.0, 0.0, -1.0, 1.0, -1.0, 1.0, 0.0, 0.0, i)');
    const out = await dispatch(code, 0xbadf00d);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('var_waffle produces finite output across all 5 RNG modes', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_waffle');
    const code = makeKernel(fn, 'var_waffle(pts[i], 1.0, 6.0, 0.5, 0.5, 0.0, i)');
    const out = await dispatch(code, 0x12345678);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
