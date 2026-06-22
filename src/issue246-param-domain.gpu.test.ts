// @vitest-environment node
//
// #246 regression — param-domain / behavior fixes reachable off-default or via
// import. Three shader-side fixes, each verified against JWildfire source:
//   1. atan V160 — out-of-range mode is a no-op (JWF AtanFunc empty `default`),
//      not a fall-through to dual-atan.
//   2. shredrad V184 — width is clamped to [-1,1] (JWF Tools.limitValue).
//   5. hydrogen_orbital V291 m<0 — sph_harmonic must use |m| (assoc_legendre is
//      defined only for 0<=m<=l), so |Y_l^{-m}| == |Y_l^m|.
// extractWgslFn + compileChecked per the chaos.wgsl GPU-test convention.

import { describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();

const SRC = CHAOS_WGSL;
const HELPERS = ['hash01', 'safe_sin', 'safe_cos', 'assoc_legendre', 'sph_harmonic', 'var_atan', 'var_shredrad']
  .map((fn) => extractWgslFn(SRC, fn)).join('\n');

const PRELUDE = `
const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const SIN_SAFE_MAX: f32 = 1.0e6;
var<private> rand_counter: u32 = 0u;
fn rand01(wi: u32) -> f32 { rand_counter = rand_counter + 1u; return f32((wi * 2654435769u + rand_counter) & 0xffffu) / 65536.0; }
`;

const DISPATCH = `
struct U { idx: u32, pi0: i32, pi1: i32, pad: u32, pf: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> pts: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> outp: array<vec2f>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= arrayLength(&pts)) { return; }
  let p = pts[i];
  switch (u.idx) {
    case 1u: { outp[i] = var_atan(p, 1.0, u.pf.x, u.pf.y); }            // pf.x=mode, pf.y=stretch
    case 2u: { outp[i] = var_shredrad(p, 1.0, u.pf.x, u.pf.y); }        // pf.x=n, pf.y=width
    case 3u: { outp[i] = vec2f(sph_harmonic(p.x, u.pi0, u.pi1), 0.0); } // p.x=theta, pi0=l, pi1=m
    default: { outp[i] = vec2f(0.0, 0.0); }
  }
}`;

const SHADER = PRELUDE + HELPERS + DISPATCH;
const PTS = new Float32Array([0.5, 0.3, -0.6, 0.7, 1.1, -0.4, 0.2, 0.9]);
const N = PTS.length / 2;
let pipeline: GPUComputePipeline, ptsBuf: GPUBuffer, uBuf: GPUBuffer, outBuf: GPUBuffer, readback: GPUBuffer;

async function setup() {
  const dev = device!;
  const mod = await compileChecked(dev, SHADER);
  pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  uBuf = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  ptsBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  readback = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  dev.queue.writeBuffer(ptsBuf, 0, PTS);
}

async function run(idx: number, pi0: number, pi1: number, pf0: number, pf1: number): Promise<Float32Array> {
  const dev = device!;
  dev.queue.writeBuffer(uBuf, 0, new Int32Array([idx, pi0, pi1, 0]));
  dev.queue.writeBuffer(uBuf, 16, new Float32Array([pf0, pf1, 0, 0]));
  const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uBuf } },
    { binding: 1, resource: { buffer: ptsBuf } },
    { binding: 2, resource: { buffer: outBuf } },
  ]});
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N); pass.end();
  enc.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  return out;
}

describe.skipIf(!device)('#246 param-domain fixes', () => {
  it('atan: out-of-range mode is a no-op (0,0); modes 0/1/2 still produce output', async () => {
    await setup();
    const m2 = await run(1, 0, 0, 2.0, 1.0);     // mode 2 = dual atan
    const m5 = await run(1, 0, 0, 5.0, 1.0);     // out-of-range -> (0,0)
    let m2nonzero = false;
    for (let i = 0; i < N * 2; i++) {
      expect(m5[i]!, `mode=5 out comp ${i}`).toBe(0);
      if (Math.abs(m2[i]!) > 1e-6) m2nonzero = true;
    }
    expect(m2nonzero, 'mode=2 should produce nonzero output').toBe(true);
  });

  it('shredrad: width is clamped to [-1,1] (width=2 behaves as width=1)', async () => {
    const w2 = await run(2, 0, 0, 4.0, 2.0);  // width=2 -> clamps to 1
    const w1 = await run(2, 0, 0, 4.0, 1.0);  // width=1
    const wHalf = await run(2, 0, 0, 4.0, 0.5);
    let differsFromHalf = false;
    for (let i = 0; i < N * 2; i++) {
      expect(w2[i]!, `width2 vs width1 comp ${i}`).toBeCloseTo(w1[i]!, 5);
      if (Math.abs(w2[i]! - wHalf[i]!) > 1e-4) differsFromHalf = true;
    }
    expect(differsFromHalf, 'width=0.5 (in range) should differ from clamped width=2').toBe(true);
  });

  it('sph_harmonic: |m| symmetry — m<0 matches +|m| (assoc_legendre domain)', async () => {
    const mNeg = await run(3, 2, -2, 0, 0);  // l=2, m=-2
    const mPos = await run(3, 2, 2, 0, 0);   // l=2, m=+2
    let anyNonzero = false;
    for (let i = 0; i < N; i++) {
      expect(mNeg[i * 2]!, `sph m=-2 vs m=+2 pt ${i}`).toBeCloseTo(mPos[i * 2]!, 5);
      if (Math.abs(mPos[i * 2]!) > 1e-6) anyNonzero = true;
    }
    expect(anyNonzero, 'sph_harmonic l=2,m=2 should be nonzero somewhere').toBe(true);
  });
});
