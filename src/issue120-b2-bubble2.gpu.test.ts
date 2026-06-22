// @vitest-environment node
//
// #120 batch B2 — GPU kernel test for var_bubble2 (2D projection of
// JWildfire Bubble2Func). RNG-free → full f64 oracle parity check at
// default (1,1) — should match var_bubble (V20) — and at anisotropic
// (2.0, 0.5) — should differ from var_bubble.
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

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

function bubble2Oracle(x: number, y: number, w: number, xs: number, ys: number): [number, number] {
  const r = w / (0.25 * (x * x + y * y) + 1.0);
  return [x * r * xs, y * r * ys];
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

describe.skipIf(!device)('#120 B2 — var_bubble2', () => {
  it('matches f64 oracle within 1e-5 at default params (x=1, y=1) — should also match var_bubble', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bubble2');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bubble2(pts[i], 1.0, 1.0, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = bubble2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0, 1.0);
      expect(out[i * 2]).toBeCloseTo(ox, 5);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 5);
    }
  });

  it('matches f64 oracle within 1e-5 at anisotropic params (x=2.0, y=0.5)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bubble2');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bubble2(pts[i], 1.0, 2.0, 0.5);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = bubble2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 2.0, 0.5);
      expect(out[i * 2]).toBeCloseTo(ox, 5);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 5);
    }
  });

  it('outputs are finite across the canonical test points (smoke at non-default scales)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bubble2');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bubble2(pts[i], 1.0, -1.5, 1.7);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
