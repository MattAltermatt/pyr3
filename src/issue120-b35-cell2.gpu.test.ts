// @vitest-environment node
//
// #120 batch B3.5 — GPU oracle test for var_cell2 (V139).
// 6-param N/S asymmetric subset of JWildfire's 16-param Cell2Func.
// Deterministic in this subset (the dropped mirror flags were the
// only RNG source) → full f64 oracle parity check.
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

const TEST_POINTS: ReadonlyArray<readonly [number, number]> = [
  [ 0.5,  0.3],
  [-0.5,  0.7],
  [ 1.2, -0.4],   // y < 0 → south branch
  [-1.0, -1.0],   // south branch
  [ 0.1,  0.05],
  [ 2.0,  0.0],   // boundary (y === 0 → north branch per >= 0)
  [ 0.0,  2.0],
  [-2.5,  1.7],
];
const N = TEST_POINTS.length;

function cell2Oracle(
  x: number, y: number, w: number,
  size: number, a: number,
  snx: number, sny: number, ssx: number, ssy: number,
): [number, number] {
  const safe_size = Math.abs(size) < 1e-30 ? 1e-30 : size;
  const inv = a / safe_size;
  const cx = Math.floor(x * inv);
  const cy = Math.floor(y * inv);
  const dx = x - cx * safe_size;
  const dy = y - cy * safe_size;
  let sx = cx, sy = cy;
  if (sy >= 0) {
    sy = sy * sny;
    sx = sx * snx;
  } else {
    sy = -ssy * sy;
    sx = sx * ssx;
  }
  return [w * (dx + sx * safe_size), -w * (dy + sy * safe_size)];
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

describe.skipIf(!device)('#120 B3.5 — var_cell2', () => {
  it('matches f64 oracle within 1e-4 at default params (size=0.6, a=1, all space_*=2)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_cell2');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_cell2(pts[i], 1.0, 0.6, 1.0, 2.0, 2.0, 2.0, 2.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = cell2Oracle(
        TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0,
        0.6, 1.0, 2.0, 2.0, 2.0, 2.0,
      );
      expect(out[i * 2]).toBeCloseTo(ox, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 4);
    }
  });

  it('matches f64 oracle when N/S asymmetric (space_north_y=3, space_south_y=1.2)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_cell2');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_cell2(pts[i], 1.0, 0.5, 1.2, 1.7, 3.0, 0.8, 1.2);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = cell2Oracle(
        TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0,
        0.5, 1.2, 1.7, 3.0, 0.8, 1.2,
      );
      expect(out[i * 2]).toBeCloseTo(ox, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 4);
    }
  });

  it('produces finite output at degenerate size=0 (the EPS floor)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_cell2');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_cell2(pts[i], 1.0, 0.0, 1.0, 2.0, 2.0, 2.0, 2.0);
}`;
    const out = await dispatch(code);
    // At size=0 the floor flips to 1e-30 → cell coords saturate; output
    // is finite (chaos-game retry handles any NaN downstream).
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
