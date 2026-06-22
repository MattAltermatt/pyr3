// @vitest-environment node
//
// #243 — GPU smoke coverage for the two shipped reachable kernels that had
// ZERO test of any kind: var_bwraps (V107) and var_crackle (V108). The #114
// "batch 2a" pair sits in the gap between the well-covered V103-106 and V109+
// batches — there was no batch2a test file, and neither kernel appears in the
// flam3-C parity corpus (`grep bwraps2=|crackle= fixtures/flam3-goldens` is
// empty), so the 91s/13min rigs never exercised them either. They are among
// the most algorithmically complex untested kernels (9-cell RNG voronoi;
// hyperbolic-gain bubble distortion) — exactly the class where a silent WGSL
// math/packing regression escapes every fast gate.
//
// Strategy mirrors issue121-Lall.gpu.test.ts: ONE shader bundle, idx in a
// uniform buffer, catalog-default params written as runtime args (constant
// args would let the compiler fold the trig cliff away — see #72). The smoke
// gate: every variation emits finite output on the canonical 7-point set.
// compileChecked fails loudly on an invalid shader so a non-compiling module
// can't pass as a zero-output no-op (the #259/#263 false-positive class).
//
// NOT parity — these two have no flam3-C reference. Skips when no GPU adapter.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);
// perlin2d (+ its PERLIN_PERM const, perlin_fade, perlin_grad2) lives in a
// separate file that chaos.ts prepends at module assembly. var_crackle calls
// perlin2d via _crackle_cell_centre, so include the whole file verbatim — the
// module-scope const array doesn't travel through extractWgslFn.
const PERLIN_SRC = readFileSync(
  new URL('./shaders/noise_perlin.wgsl', import.meta.url), 'utf8',
);

// hash01 backs safe_sin/safe_cos (the cliff-spread path); the two kernels'
// private helpers must be pulled in alongside the kernels themselves. WGSL
// module-scope fn declarations are order-independent, so order doesn't matter.
const CHAOS_FNS = [
  'hash01', 'safe_sin', 'safe_cos',
  'var_bwraps', '_crackle_cell_centre', '_crackle_vratio', 'var_crackle',
];
const EXTRACTED = CHAOS_FNS.map((fn) => extractWgslFn(SHADER_SRC, fn)).join('\n');

const PRELUDE = `
const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const EPS: f32 = 1e-10;
const SIN_SAFE_MAX: f32 = 1.0e6;
${PERLIN_SRC}
${EXTRACTED}
var<private> rand_counter: u32 = 0u;
fn rand01(wi: u32) -> f32 {
  rand_counter = rand_counter + 1u;
  return f32((wi * 2654435769u + rand_counter) & 0xffffu) / 65536.0;
}
`;

const DISPATCHER = `
struct SmokeUniforms { idx: u32, pad0: u32, pad1: u32, pad2: u32, p0123: vec4f, p4567: vec4f, p89: vec4f };
@group(0) @binding(0) var<uniform> smoke_u: SmokeUniforms;
@group(0) @binding(1) var<storage, read> smoke_pts: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> smoke_out: array<vec2f>;

fn smoke_dispatch(idx: u32, p: vec2f, w: f32,
  p0: f32, p1: f32, p2: f32, p3: f32, p4: f32, wi: u32) -> vec2f {
  switch (idx) {
    case 107u: { return var_bwraps(p, w, p0, p1, p2, p3, p4); }
    case 108u: { return var_crackle(p, w, p0, p1, p2, p3, wi); }
    default:   { return vec2f(0.0, 0.0); }
  }
}

@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&smoke_pts)) { return; }
  smoke_out[i] = smoke_dispatch(smoke_u.idx, smoke_pts[i], 1.0,
    smoke_u.p0123.x, smoke_u.p0123.y, smoke_u.p0123.z, smoke_u.p0123.w,
    smoke_u.p4567.x, i);
}
`;
const SMOKE_SHADER = PRELUDE + DISPATCHER;

// idx, name, then up to 5 params. Two crackle rows: distort=0 (catalog
// default) and distort=1 (exercises the perlin2d cell-centre perturbation).
const VAR_PARAMS_TSV = [
  '107 bwraps 1 0 1 -1.04 0.71',
  '108 crackle 1 0.2 0 1',
  '108 crackle-distort 1 0.2 1 1',
];

describe.skipIf(!device)('#243 batch-2a — var_bwraps + var_crackle finite smoke', () => {
  it('var_bwraps (V107) + var_crackle (V108) emit finite output at catalog defaults', async () => {
    const dev = device!;
    const mod = await compileChecked(dev, SMOKE_SHADER);
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const N = 7;
    const uBuf = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const ptsBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    // Canonical 7-point set: a spread of magnitudes/quadrants incl. (-1,-1)
    // (lands outside a unit bubble for bwraps) and the origin.
    dev.queue.writeBuffer(ptsBuf, 0, new Float32Array([0.5, 0.3, -0.5, 0.7, 1.2, -0.4, -1, -1, 0.1, 0.05, 0, 2, -2.5, 1.7]));
    const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uBuf } },
      { binding: 1, resource: { buffer: ptsBuf } },
      { binding: 2, resource: { buffer: outBuf } },
    ]});
    for (const row of VAR_PARAMS_TSV) {
      const parts = row.split(' ');
      const idx = parseInt(parts[0] || '0', 10);
      const name = parts[1] || '';
      dev.queue.writeBuffer(uBuf, 0, new Uint32Array([idx, 0, 0, 0]));
      const pArr = new Float32Array(12);
      for (let pi = 0; pi < 10; pi++) {
        const s = parts[2 + pi];
        pArr[pi] = s !== undefined ? parseFloat(s) : 0.0;
      }
      dev.queue.writeBuffer(uBuf, 16, pArr);
      const encoder = dev.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(N); pass.end();
      encoder.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
      dev.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      for (let i = 0; i < N * 2; i++) {
        expect(Number.isFinite(out[i]), `V${idx} var_${name} comp ${i}: got ${out[i]}`).toBe(true);
      }
    }
  });
});
