// @vitest-environment node
//
// #120 batch B6 — GPU oracle tests for Faber/Xyrus02/zephyrtronium
// novelties. All four (flipy, eclipse, barycentroid, chunk) are
// deterministic → full f64 oracle parity.
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
  [ 1.2, -0.4],
  [-1.0, -1.0],
  [ 0.1,  0.05],
  [ 0.0,  2.0],
  [-2.5,  1.7],
];
const N = TEST_POINTS.length;

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

describe.skipIf(!device)('#120 B6 — Faber/Xyrus02/zephyrtronium novelties', () => {
  it('var_flipy matches f64 oracle (x > 0 → -y, else +y)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_flipy');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${fn}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_flipy(pts[i], 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [x, y] = TEST_POINTS[i]!;
      const ys = x > 0 ? -1 : 1;
      expect(out[i * 2]).toBeCloseTo(x, 5);
      expect(out[i * 2 + 1]).toBeCloseTo(y * ys, 5);
    }
  });

  it('var_eclipse matches f64 oracle at shift=0', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_eclipse');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${fn}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_eclipse(pts[i], 1.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [x, y] = TEST_POINTS[i]!;
      const w = 1.0, shift = 0.0;
      let ox: number, oy: number;
      if (Math.abs(y) <= w) {
        const c2 = Math.sqrt(Math.max(w * w - y * y, 0));
        if (Math.abs(x) <= c2) {
          const xs = x + shift * w;
          ox = Math.abs(xs) >= c2 ? -w * x : w * xs;
        } else {
          ox = w * x;
        }
        oy = w * y;
      } else {
        ox = w * x;
        oy = w * y;
      }
      expect(out[i * 2]).toBeCloseTo(ox, 5);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 5);
    }
  });

  it('var_barycentroid matches f64 oracle at identity basis (a=d=1, b=c=0)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_barycentroid');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${fn}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_barycentroid(pts[i], 1.0, 1.0, 0.0, 0.0, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [x, y] = TEST_POINTS[i]!;
      const a = 1, b = 0, c = 0, d = 1;
      const dot00 = a * a + b * b;
      const dot01 = a * c + b * d;
      const dot02 = a * x + b * y;
      const dot11 = c * c + d * d;
      const dot12 = c * x + d * y;
      const denom = dot00 * dot11 - dot01 * dot01;
      let ox: number, oy: number;
      if (Math.abs(denom) < 1e-30) { ox = x; oy = y; }
      else {
        const inv = 1.0 / denom;
        const u = (dot11 * dot02 - dot01 * dot12) * inv;
        const v = (dot00 * dot12 - dot01 * dot02) * inv;
        ox = Math.sqrt(u * u + x * x) * Math.sign(u);
        oy = Math.sqrt(v * v + y * y) * Math.sign(v);
      }
      expect(out[i * 2]).toBeCloseTo(ox, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 4);
    }
  });

  it('var_chunk emits passthrough inside unit circle (mode 0, a=c=1, f=-1)', async () => {
    const fn = extractWgslFn(SHADER_SRC, 'var_chunk');
    const code = `
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${fn}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_chunk(pts[i], 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [x, y] = TEST_POINTS[i]!;
      const r = x * x + y * y - 1.0; // w=1, a=c=1, b=d=e=0, f=-1
      if (r <= 0) {
        // Inside disc → passthrough
        expect(out[i * 2]).toBeCloseTo(x, 5);
        expect(out[i * 2 + 1]).toBeCloseTo(y, 5);
      } else {
        // Outside → zero
        expect(out[i * 2]).toBe(0);
        expect(out[i * 2 + 1]).toBe(0);
      }
    }
  });
});
