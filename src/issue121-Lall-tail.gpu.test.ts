// @vitest-environment node
//
// #163 — companion to issue121-Lall.gpu.test.ts. Covers the tail
// 15 variations V199-V213 in a separate test file (= separate vitest
// worker fork = fresh Dawn-node init) — the main file's worker
// exhausts after ~47 cumulative dispatches; splitting across files is
// the only workaround that holds.
//
// Same shape as the main file: ONE shader bundle, idx in uniform
// buffer, 15 dispatches with catalog-default params. Finite-output
// smoke only; not parity.

import { describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();

const SHADER_SRC = CHAOS_WGSL;
const startMarker = '\n// ---------------------------------------------------------------------\n// #121 batch L1';
const endMarker = '\nfn apply_variation';
const V152_V213_REGION = SHADER_SRC.slice(
  SHADER_SRC.indexOf(startMarker),
  SHADER_SRC.indexOf(endMarker),
);

// #259 — extract the shipped helpers from chaos.wgsl (see issue121-Lall.gpu.test.ts
// for the full rationale). The old prelude supplied 7 of the ~19 helpers the
// V152-V219 region depends on, so the assembled shader was INVALID and this
// finite-on-zero smoke passed on the no-op dispatch's zero output. HELPER_FNS is
// the transitive closure of shared primitives; rand01 stays hand-written (the
// engine's reads the isaac_states binding). The compile guard in the test body
// fails loudly on any invalid shader. WGSL module-scope fns are order-independent.
const HELPER_FNS = [
  'hash01', 'safe_sin', 'safe_cos', 'safe_tan', 'safe_tanh',
  'complex_mul', 'complex_sqr', 'complex_div', 'complex_recip', 'complex_sqrt',
  'complex_log', 'complex_exp', 'complex_pow', 'complex_sin',
  'to_upper_half_plane', 'modular_nome', 'theta3', 'theta2', 'hsl_to_rgb',
];
const EXTRACTED_HELPERS = HELPER_FNS.map((fn) => extractWgslFn(SHADER_SRC, fn)).join('\n');

const PRELUDE = `
const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const EPS: f32 = 1e-10;
const SIN_SAFE_MAX: f32 = 1.0e6;
const TANH_SAFE_MAX: f32 = 20.0;
${EXTRACTED_HELPERS}
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
  p0: f32, p1: f32, p2: f32, p3: f32, p4: f32, p5: f32, p6: f32, p7: f32, p8: f32, p9: f32,
  wi: u32) -> vec2f {
  switch (idx) {
    case 199u: { return var_tancos(p, w); }
    case 200u: { return var_twoface(p, w); }
    case 201u: { return var_e_julia(p, w, p0, wi); }
    case 202u: { return var_cannabis_curve_wf(p, w, p0, wi); }
    case 203u: { return var_e_collide(p, w, p0, p1); }
    case 204u: { return var_e_mod(p, w, p0, p1); }
    case 205u: { return var_intersection(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, wi); }
    case 206u: { return var_inv_squircular(p, w); }
    case 207u: { return var_lozi(p, w, p0, p1, p2); }
    case 208u: { return var_hypershift(p, w, p0, p1); }
    case 209u: { return var_hex_modulus(p, w, p0); }
    case 210u: { return var_boarders2(p, w, p0, p1, p2, wi); }
    case 211u: { return var_b_mod(p, w, p0, p1); }
    case 212u: { return var_b_transform(p, w, p0, p1, p2, p3, wi); }
    case 213u: { return var_parallel(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, wi); }
    case 214u: { return var_waves3(p, w, p0, p1, p2, p3, p4, p5); }
    case 215u: { return var_waves4(p, w, p0, p1, p2, p3, p4, p5); }
    case 216u: { return var_scry2(p, w, p0, p1, p2); }
    case 217u: { return var_ennepers2(p, w, p0, p1, p2); }
    case 218u: { return var_apollony(p, w, wi); }
    case 219u: { return var_circlecrop(p, w, p0, p1, p2, p3, p4, wi); }
    default:   { return vec2f(0.0, 0.0); }
  }
}

@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&smoke_pts)) { return; }
  smoke_out[i] = smoke_dispatch(smoke_u.idx, smoke_pts[i], 1.0,
    smoke_u.p0123.x, smoke_u.p0123.y, smoke_u.p0123.z, smoke_u.p0123.w,
    smoke_u.p4567.x, smoke_u.p4567.y, smoke_u.p4567.z, smoke_u.p4567.w,
    smoke_u.p89.x, smoke_u.p89.y, i);
}
`;
const SMOKE_SHADER = PRELUDE + V152_V213_REGION + DISPATCHER;

const VAR_PARAMS_TSV = [
  '199 tancos',
  '200 twoface',
  '201 e_julia 2.0',
  '202 cannabis_curve_wf 1.0',
  '203 e_collide 1.0 0.0',
  '204 e_mod 1.0 0.0',
  '205 intersection 1.0 0.0 0.5 1.0 0.5 1.0 0.5 0.5 0.0 0.5',
  '206 inv_squircular',
  '207 lozi 1.7 0.5 0.5',
  '208 hypershift 0.5 1.0',
  '209 hex_modulus 0.5',
  '210 boarders2 0.4 0.65 0.35',
  '211 b_mod 1.0 0.0',
  '212 b_transform 1.0 0.0 0.0 0.0',
  '213 parallel 0.5 0.5 1.0 1.0 0.0 0.0 0.0 0.0 0.0 0.0',
  '214 waves3 0.05 0.05 7.0 13.0 0.0 2.0',
  '215 waves4 0.05 0.05 7.0 13.0 0.0 0.1',
  '216 scry2 4 0.15 0.25',
  '217 ennepers2 1.0 0.3333 0.075',
  '218 apollony',
  '219 circlecrop 1.0 0.0 0.0 0.0 1',
];

describe.skipIf(!device)('#163/#170 L1-L14 V199-V219 — compile + finite smoke (tail)', () => {
  it('every variation V199-V219 emits finite output at catalog defaults', async () => {
    const dev = device!;
    // #259/#263 — compileChecked fails loudly on an invalid shader (see
    // src/gpu-compile-guard.ts). Without it, a non-compiling module makes the
    // dispatch a no-op, leaving outBuf zero and Number.isFinite(0) passing every
    // variation — the false-positive that hid 12+ missing helpers here.
    const mod = await compileChecked(dev, SMOKE_SHADER);
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const N = 7;
    const uBuf = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const ptsBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
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
