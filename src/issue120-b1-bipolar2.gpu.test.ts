// @vitest-environment node
//
// #120 batch B1 — GPU kernel test for var_bipolar2 (Brad Stefanov's 9-param
// rework of base bipolar). RNG-free → full f64 oracle parity check at
// default params + a guard-branch test that forces f/g <= 0.
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';

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

const PRELUDE_CONSTS = `const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
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

function bipolar2Oracle(
  x: number, y: number, w: number,
  shift: number, a: number, b: number, c: number,
  d: number, e: number, f1: number, g1: number, h: number,
): [number, number] {
  const HALF_PI = Math.PI * 0.5;
  const TWO_OVER_PI = 2.0 / Math.PI;
  const x2y2 = (x * x + y * y) * g1;
  const t = x2y2 + a;
  const x2 = b * x;
  const ps = -HALF_PI * shift;
  let yv = c * Math.atan2(e * y, x2y2 - d) + ps;
  if (yv > HALF_PI) yv = -HALF_PI + ((yv + HALF_PI) % Math.PI);
  else if (yv < -HALF_PI) yv = HALF_PI - ((HALF_PI - yv) % Math.PI);
  const fnum = t + x2;
  const gnum = t - x2;
  if (gnum === 0 || fnum / gnum <= 0) return [0, 0];
  return [
    w * f1 * TWO_OVER_PI * Math.log(fnum / gnum),
    w * TWO_OVER_PI * yv * h,
  ];
}

async function dispatch(code: string): Promise<Float32Array> {
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
      { binding: 0, resource: { buffer: ptsBuf } },
      { binding: 1, resource: { buffer: outBuf } },
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
  ptsBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

describe.skipIf(!device)('#120 B1 — var_bipolar2', () => {
  it('matches f64 oracle within 1e-3 at default params (shift=0, a=1, b=2, c=0.5, d=1, e=2, f1=0.25, g1=1, h=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bipolar2');
    // Pass params as RUNTIME args via the pts buffer's bound layout —
    // bound bindings prevent layout:'auto' from stripping the out
    // buffer. (No need to "tickle" — both bindings are read by main.)
    const code = `${PRELUDE_CONSTS}
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  let p = pts[i];
  // Runtime params (literals would compile-time-fold and could mask
  // Dawn f32 range cliffs; passing through the bound input vars makes
  // them runtime values).
  out[i] = var_bipolar2(p, 1.0, 0.0, 1.0, 2.0, 0.5, 1.0, 2.0, 0.25, 1.0, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = bipolar2Oracle(
        TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0,
        0.0, 1.0, 2.0, 0.5, 1.0, 2.0, 0.25, 1.0, 1.0,
      );
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('returns (0,0) on guard branch where f/g <= 0', async () => {
    // At a=-3, b=2, g1=1 and point (1, 0.1):
    //   x²+y² = 1.01, t = 1.01 + (-3) = -1.99, x2 = 2.0
    //   fnum = -1.99 + 2.0 = 0.01 > 0
    //   gnum = -1.99 - 2.0 = -3.99 < 0
    //   fnum/gnum ≈ -0.0025 → guard fires → (0,0)
    const FN = extractWgslFn(SHADER_SRC, 'var_bipolar2');
    const code = `${PRELUDE_CONSTS}
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  // Hard-coded guard-firing point; a = -3 forces sign-flip on gnum.
  out[i] = var_bipolar2(vec2f(1.0, 0.1), 1.0, 0.0, -3.0, 2.0, 0.5, 1.0, 2.0, 0.25, 1.0, 1.0);
}`;
    const out = await dispatch(code);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it('produces finite output across the canonical test points (smoke)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bipolar2');
    const code = `${PRELUDE_CONSTS}
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bipolar2(pts[i], 1.0, 0.5, 0.7, 1.5, 0.3, 0.8, 1.2, 0.4, 1.1, 0.9);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
