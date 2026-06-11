// @vitest-environment node
//
// #163 — GPU smoke coverage for V152-V198 (47 of 62 L1-L14 variations
// from #121). One single shader bundles V152-V213 region + dispatcher;
// the test loops every variation with idx written to a uniform buffer.
//
// Coverage gap: V199-V213 (the final 15) are covered in
// issue121-Lall-tail.gpu.test.ts (separate file → own worker fork).
// Empirically Dawn-node + vitest exhaust some native resource after
// ~47 cumulative dispatches in a single worker — the next dispatch
// kills the worker SIGABRT with "mutex lock failed". Outside vitest
// the same shader + dispatch sequence runs the full 62 fine; inside
// vitest, splitting across two files (= two workers = two reset
// cycles) is the only workaround that avoids the crash.
//
// Strategy of each file: ONE shader bundle, idx in uniform buffer,
// 47-or-15 dispatches with catalog-default params. The smoke gate:
// every variation emits finite output on N test points. NOT parity.
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';

Object.assign(globalThis, globals);

const _gpu = create([]);
const adapter = await _gpu.requestAdapter();
const device = adapter ? await adapter.requestDevice() : null;

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);
const startMarker = '\n// ---------------------------------------------------------------------\n// #121 batch L1';
const endMarker = '\nfn apply_variation';
const V152_V213_REGION = SHADER_SRC.slice(
  SHADER_SRC.indexOf(startMarker),
  SHADER_SRC.indexOf(endMarker),
);

// #259 — extract the shipped helpers from chaos.wgsl rather than redefining
// weaker private copies. The old prelude hand-rolled only 7 of the ~19 helpers
// the V152-V213 region actually depends on (and a far weaker `&0xff/256` hash01
// vs the shipped 3-round mix), so the assembled shader referenced 12+ undefined
// symbols and was INVALID — yet the finite-on-zero smoke passed on the no-op
// dispatch's zero-initialized output. The compile guard in the test body below
// now fails loudly on any such invalid shader.
//
// HELPER_FNS is the full transitive closure of shared primitives the region
// calls (computed by walking each helper's own calls until only builtins +
// rand01 remain). rand01 stays hand-written: the engine's rand01 reads the
// isaac_states binding (isaac_irand) the test doesn't provide. Module-scope
// consts do NOT travel with extractWgslFn — mirror chaos.wgsl's exact values.
// WGSL module-scope fn declarations are order-independent, so concatenation
// order doesn't matter; we list them roughly in dependency order anyway.
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
    case 152u: { return var_ennepers(p, w); }
    case 153u: { return var_erf(p, w); }
    case 154u: { return var_circus(p, w, p0); }
    case 155u: { return var_asteria(p, w, p0, wi); }
    case 156u: { return var_clifford_js(p, w, p0, p1, p2, p3); }
    case 157u: { return var_devil_warp(p, w, p0, p1, p2, p3, p4, p5); }
    case 158u: { return var_voron(p, w, p0, p1, p2, p3, p4); }
    case 159u: { return var_henon(p, w, p0, p1, p2); }
    case 160u: { return var_atan(p, w, p0, p1); }
    case 161u: { return var_cardioid(p, w, p0); }
    case 162u: { return var_chrysanthemum(p, w, wi); }
    case 163u: { return var_bcollide(p, w, p0, p1); }
    case 164u: { return var_bsplit(p, w, p0, p1); }
    case 165u: { return var_bulge(p, w, p0); }
    case 166u: { return var_checks(p, w, p0, p1, p2, p3, wi); }
    case 167u: { return var_circular(p, w, p0, p1, wi); }
    case 168u: { return var_circular2(p, w, p0, p1, p2, p3, wi); }
    case 169u: { return var_corners(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8); }
    case 170u: { return var_circleblur(p, w, wi); }
    case 171u: { return var_fibonacci2(p, w, p0, p1); }
    case 172u: { return var_hypertile(p, w, p0, p1, p2); }
    case 173u: { return var_hypertile1(p, w, p0, p1, wi); }
    case 174u: { return var_hypertile2(p, w, p0, p1, wi); }
    case 175u: { return var_idisc(p, w); }
    case 176u: { return var_hole(p, w, p0, p1); }
    case 177u: { return var_kaleidoscope(p, w, p0, p1, p2, p3, p4); }
    case 178u: { return var_layered_spiral(p, w, p0); }
    case 179u: { return var_linear_t(p, w, p0, p1); }
    case 180u: { return var_line(p, w, p0, p1, wi); }
    case 181u: { return var_ovoid(p, w, p0, p1); }
    case 182u: { return var_phoenix_julia(p, w, p0, p1, p2, p3, wi); }
    case 183u: { return var_unpolar(p, w); }
    case 184u: { return var_shredrad(p, w, p0, p1); }
    case 185u: { return var_vogel(p, w, p0, p1, wi); }
    case 186u: { return var_yin_yang(p, w, p0, p1, p2, p3, p4, wi); }
    case 187u: { return var_squish(p, w, p0, wi); }
    case 188u: { return var_target(p, w, p0, p1, p2); }
    case 189u: { return var_funnel(p, w, p0); }
    case 190u: { return var_holesq(p, w); }
    case 191u: { return var_hole2(p, w, p0, p1, p2, p3, p4, p5); }
    case 192u: { return var_lace_js(p, w, wi); }
    case 193u: { return var_julia_outside(p, w, p0, p1, p2, wi); }
    case 194u: { return var_fourth(p, w, p0, p1, p2, p3, p4); }
    case 195u: { return var_pulse(p, w, p0, p1, p2, p3); }
    case 196u: { return var_rays1(p, w); }
    case 197u: { return var_rays2(p, w); }
    case 198u: { return var_rays3(p, w); }
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
  '152 ennepers',
  '153 erf',
  '154 circus 0.92',
  '155 asteria 0.5',
  '156 clifford_js -1.4 1.6 1.0 0.7',
  '157 devil_warp 1.0 1.0 1.5 0.07 0.005 0.005',
  '158 voron 1.0 12.0 1.0 0.0 0.0',
  '159 henon 1.4 0.3 0.6',
  '160 atan 0.0 1.0',
  '161 cardioid 1.0',
  '162 chrysanthemum',
  '163 bcollide 1.0 1.0',
  '164 bsplit 0.0 0.0',
  '165 bulge 1.0',
  '166 checks 0.3 0.3 0.0 0.0',
  '167 circular 30.0 0.0',
  '168 circular2 30.0 0.0 12.9898 78.233',
  '169 corners 0.0 0.0 1.0 1.0 1.0 1.0 0.0 0.0 2.71828',
  '170 circleblur',
  '171 fibonacci2 1.0 1.0',
  '172 hypertile 3.0 7.0 0.0',
  '173 hypertile1 3.0 7.0',
  '174 hypertile2 3.0 7.0',
  '175 idisc',
  '176 hole 1.0 0.0',
  '177 kaleidoscope 1.0 1.0 1.0 0.0 0.0',
  '178 layered_spiral 1.0',
  '179 linear_t 1.0 1.0',
  '180 line 0.5 0.5',
  '181 ovoid 1.0 1.0',
  '182 phoenix_julia 2.0 1.0 0.0 0.0',
  '183 unpolar',
  '184 shredrad 4.0 0.5',
  '185 vogel 8.0 0.3',
  '186 yin_yang 1.0 1.0 0.5 0.5 0.5',
  '187 squish 2.0',
  '188 target 1.0 2.0 0.0',
  '189 funnel 4.0',
  '190 holesq',
  '191 hole2 1.0 0.0 0.0 0.0 0.5 0.5',
  '192 lace_js',
  '193 julia_outside 2.0 0.0 0.0',
  '194 fourth 1.0 1.0 1.0 1.0 1.0',
  '195 pulse 1.0 1.0 0.1 0.1',
  '196 rays1',
  '197 rays2',
  '198 rays3',
];

describe.skipIf(!device)('#163 L1-L14 V152-V198 — compile + finite smoke', () => {
  it('every variation V152-V198 emits finite output at catalog defaults', async () => {
    const dev = device!;
    const mod = dev.createShaderModule({ code: SMOKE_SHADER });
    // #259 — fail loudly on an invalid shader. Without this, a non-compiling
    // module makes the dispatch a no-op, leaving outBuf zero-initialized, and
    // `Number.isFinite(0)` passes every variation — a false-positive that hid
    // 12+ missing helpers (the whole point of this smoke). getCompilationInfo
    // surfaces error-severity messages the silent createShaderModule swallows.
    const ci = await mod.getCompilationInfo();
    const compileErrors = ci.messages.filter((m) => m.type === 'error');
    expect(compileErrors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`)).toEqual([]);
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
