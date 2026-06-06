// @vitest-environment node
//
// #114 — Perlin noise WGSL helpers (noise_perlin.wgsl) must match the JS
// f64 oracle (noise-perlin-oracle.ts) within f32 tolerance.
//
// dc_perlin (chaos.wgsl) calls perlin_fbm to color a flame xform by a 2D
// noise field. If WGSL and JS disagree, BE-CLI vs FE-viewer renders
// diverge (the same flame would look different in headless vs browser),
// breaking the "single engine, two consumers" invariant. This test runs
// the SHIPPED noise WGSL on real Dawn (same runtime as the BE CLI) and
// asserts bit-near equality at a handful of sample points.
//
// Pattern: include the full noise_perlin.wgsl source verbatim (it has no
// entry point, just const PERLIN_PERM + perlin_fade/grad2/2d/fbm) and
// add a tiny @compute main that drives a fixed sample-points buffer.
// Skips when no GPU adapter — keeps GPU-less CI green.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { perlin2d, perlinFbm } from './noise-perlin-oracle';

Object.assign(globalThis, globals);

let device: GPUDevice | null = null;
try {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const NOISE_SRC = readFileSync(
  new URL('./shaders/noise_perlin.wgsl', import.meta.url), 'utf8',
);

// Sample points spread across the noise field's natural range
// (Math.floor(x) & 255 wraps at 256, so try inside, edge, negative,
// and wrap-around regions).
const POINTS_2D: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.1, 0.1],
  [0.5, 0.5],
  [1.5, 2.7],
  [-3.3, 4.8],
  [10.0, 10.0],
  [127.5, 127.5],
  [-127.5, 127.5],
  [255.999, 255.999],
];

const FBM_POINTS: ReadonlyArray<readonly [number, number, number, number]> = [
  // (x, y, octaves, scale)
  [0.0, 0.0, 1, 1.0],
  [0.5, 0.5, 3, 1.0],
  [1.0, 2.0, 3, 2.0],
  [5.5, -3.3, 4, 0.5],
  [10.0, 10.0, 5, 1.0],
  [-7.7, 4.2, 3, 3.0],
];

describe.skipIf(!device)('#114 — noise_perlin.wgsl matches JS oracle', () => {
  it('perlin2d matches oracle at sample points within f32 tolerance', async () => {
    const dev = device!;
    const code = `
${NOISE_SRC}

@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = perlin2d(pts[i]);
}`;
    const N = POINTS_2D.length;

    // vec2f in std430 storage layout = 8 bytes, but Dawn requires 16-byte
    // alignment for array<vec2f> on some backends — pad each to vec4f-ish
    // by sending a flat Float32Array of (x, y, 0, 0) per point.
    // Actually std430 array<vec2f> is tightly packed at 8 bytes/element;
    // verify by sending only x,y and trusting Dawn's std430 layout.
    const ptsFlat = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const [x, y] = POINTS_2D[i]!;
      ptsFlat[i * 2 + 0] = x;
      ptsFlat[i * 2 + 1] = y;
    }
    const ptsBuf = dev.createBuffer({
      size: ptsFlat.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(ptsBuf, 0, ptsFlat);

    const outBuf = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bg = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ptsBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
    const rb = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyBufferToBuffer(outBuf, 0, rb, 0, N * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const got = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap();
    ptsBuf.destroy();
    outBuf.destroy();
    rb.destroy();

    for (let i = 0; i < N; i++) {
      const [x, y] = POINTS_2D[i]!;
      const expected = perlin2d(x, y);
      // f32 vs f64; toBeCloseTo(n) = within 5×10^-(n+1), so 4 = within 5e-5.
      // Tight enough to catch a real impl bug (gradient table mismatch
      // would give differences ≥ 0.1); loose enough for f32 rounding noise.
      expect(got[i]).toBeCloseTo(expected, 4);
    }
  });

  it('perlin_fbm matches oracle at sample points within f32 tolerance', async () => {
    const dev = device!;
    const code = `
${NOISE_SRC}

struct FbmIn {
  p: vec2f,
  octaves: f32,
  scale: f32,
};
@group(0) @binding(0) var<storage, read> pts: array<FbmIn>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  let q = pts[i];
  out[i] = perlin_fbm(q.p, q.octaves, q.scale);
}`;
    const N = FBM_POINTS.length;

    // FbmIn = vec2f(8) + f32(4) + f32(4) = 16 bytes, std430-aligned.
    const ptsFlat = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const [x, y, oct, sc] = FBM_POINTS[i]!;
      ptsFlat[i * 4 + 0] = x;
      ptsFlat[i * 4 + 1] = y;
      ptsFlat[i * 4 + 2] = oct;
      ptsFlat[i * 4 + 3] = sc;
    }
    const ptsBuf = dev.createBuffer({
      size: ptsFlat.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(ptsBuf, 0, ptsFlat);

    const outBuf = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bg = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ptsBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(N / 64));
    pass.end();
    const rb = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyBufferToBuffer(outBuf, 0, rb, 0, N * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const got = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap();
    ptsBuf.destroy();
    outBuf.destroy();
    rb.destroy();

    for (let i = 0; i < N; i++) {
      const [x, y, oct, sc] = FBM_POINTS[i]!;
      const expected = perlinFbm(x, y, oct, sc);
      // f32 vs f64 across multiple octaves accumulates rounding; 5e-5.
      expect(got[i]).toBeCloseTo(expected, 4);
    }
  });
});

describe('#114 — noise_perlin.wgsl source invariants', () => {
  it('exports perlin_fbm as the public entry for chaos.wgsl', () => {
    expect(NOISE_SRC).toContain('fn perlin_fbm(');
  });
  it('PERLIN_PERM is the full 512-entry table', () => {
    // Cheap sanity: count u32 entries by counting `u,` followed by a digit
    // is fragile; instead match the literal opening and a count.
    const match = NOISE_SRC.match(/array<u32,\s*512>/);
    expect(match).toBeTruthy();
  });
});
