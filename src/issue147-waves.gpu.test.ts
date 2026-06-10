// @vitest-environment node
//
// #147 — Wave & nodal-pattern warps (V287–V289): chladni, standing_wave, moire.
// chladni depends on the shared chladni_field_and_grad helper; all three route
// trig through safe_sin/safe_cos. Cross-checked against inline f64 oracles plus
// the spec's symmetry / boundedness / node identities.
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
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

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const CHLADNI_FG = extractWgslFn(SHADER_SRC, 'chladni_field_and_grad');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${CHLADNI_FG}
`;

async function dispatchKernel(
  fnName: string,
  fnBody: string,
  inputs: ReadonlyArray<readonly [number, number]>,
  paramsCall: string,
): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { flat[i * 4] = inputs[i]![0]; flat[i * 4 + 1] = inputs[i]![1]; }
  const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const code = `${PRELUDE}
${fnBody}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = ${fnName}(r.xy, 1.0, ${paramsCall});
}`;
  const mod = dev.createShaderModule({ code });
  const bgl = dev.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const pl = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipeline = dev.createComputePipeline({ layout: pl, compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: inBuf } },
    { binding: 1, resource: { buffer: outBuf } },
  ] });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N); pass.end();
  const readBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 8);
  dev.queue.submit([enc.finish(), enc2.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  return res;
}

// ── JS oracles ──
function jsChladni(x: number, y: number, n: number, m: number, step: number): [number, number] {
  const PI = Math.PI; const an = PI*n, am = PI*m;
  const cnx=Math.cos(an*x), snx=Math.sin(an*x); const cmy=Math.cos(am*y), smy=Math.sin(am*y);
  const cmx=Math.cos(am*x), smx=Math.sin(am*x); const cny=Math.cos(an*y), sny=Math.sin(an*y);
  const F=cnx*cmy - cmx*cny; let gx=-an*snx*cmy + am*smx*cny; let gy=-am*cnx*smy + an*cmx*sny;
  const s = F<0?-1:1; gx*=s; gy*=s; const gl=Math.hypot(gx,gy); const inv=1/(gl+1e-4);
  return [x - step*gx*inv, y - step*gy*inv];
}
function jsMoire(x: number, y: number): [number, number] {
  const freq=4.0, beat=0.6, angle=0.4, amp=0.25, PI=Math.PI;
  const ca=Math.cos(angle), sa=Math.sin(angle); const u=x*ca+y*sa, v=-x*sa+y*ca;
  const f1=freq, f2=freq+beat;
  const gx=Math.sin(f1*PI*x)*Math.sin(f2*PI*u); const gy=Math.sin(f1*PI*y)*Math.sin(f2*PI*v);
  return [x+amp*gx, y+amp*gy];
}

// raw-field wrapper for the diagonal-node identity
const CHLADNI_F_WRAP = `fn chladni_F(p: vec2f, w: f32, n: f32, m: f32) -> vec2f {
  let g = chladni_field_and_grad(p.x, p.y, n, m);
  return vec2f(g.x, 0.0);
}`;

describe('V287 chladni', () => {
  it('matches gradient-descent oracle (TS↔WGSL) away from nodes', async () => {
    if (!device) return;
    // Near a nodal line F≈0, sign(F) is a coin-flip between f32 (WGSL) and f64
    // (JS), so the descent DIRECTION is genuinely ambiguous there — only assert
    // the cross-check where |F| is comfortably nonzero.
    const jsF = (x: number, y: number, n: number, m: number) => {
      const PI = Math.PI; return Math.cos(PI*n*x)*Math.cos(PI*m*y) - Math.cos(PI*m*x)*Math.cos(PI*n*y);
    };
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chladni');
    const pts = [[0.37, 0.62], [-0.41, 0.23], [0.55, -0.71], [0.18, 0.44]] as const;
    const out = await dispatchKernel('var_chladni', fnBody, pts, '3.0, 5.0, 0.18');
    let checked = 0;
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(jsF(pts[i]![0], pts[i]![1], 3, 5)) < 0.15) continue;   // skip near-node
      const e = jsChladni(pts[i]![0], pts[i]![1], 3, 5, 0.18);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('(n,m) and (m,n) give the same descent (symmetric figure)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chladni');
    const pts = [[0.4, 0.7], [-0.6, 0.2]] as const;
    const a = await dispatchKernel('var_chladni', fnBody, pts, '3.0, 5.0, 0.18');
    const b = await dispatchKernel('var_chladni', fnBody, pts, '5.0, 3.0, 0.18');
    for (let i = 0; i < pts.length * 2; i++) expect(a[i]).toBeCloseTo(b[i]!, 4);
  });
  it('bounded step ≤ `step` + eps', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chladni');
    const pts: Array<[number, number]> = [];
    for (let x = -0.9; x <= 0.9; x += 0.3) for (let y = -0.9; y <= 0.9; y += 0.6) pts.push([x, y]);
    const out = await dispatchKernel('var_chladni', fnBody, pts, '3.0, 5.0, 0.18');
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(out[i*2]! - pts[i]![0], out[i*2+1]! - pts[i]![1]);
      expect(d).toBeLessThan(0.18 + 1e-3);
    }
  });
  it('diagonal y=x is a nodal line (F≈0)', async () => {
    if (!device) return;
    const pts = [[0.3, 0.3], [-0.6, -0.6], [0.85, 0.85]] as const;
    const out = await dispatchKernel('chladni_F', CHLADNI_F_WRAP, pts, '3.0, 5.0');
    for (let i = 0; i < pts.length; i++) expect(Math.abs(out[i*2]!)).toBeLessThan(1e-4);
  });
  it('mode flooring: n_in=3.4 and n_in=2.6 both quantize to 3', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chladni');
    const a = await dispatchKernel('var_chladni', fnBody, [[0.5, 0.3]], '3.4, 5.0, 0.18');
    const b = await dispatchKernel('var_chladni', fnBody, [[0.5, 0.3]], '2.6, 5.0, 0.18');
    expect(a[0]).toBeCloseTo(b[0]!, 5);
    expect(a[1]).toBeCloseTo(b[1]!, 5);
  });
});

describe('V288 standing_wave', () => {
  it('zero-amp identity + origin node', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_standing_wave');
    const z = await dispatchKernel('var_standing_wave', fnBody, [[0.5, 0.3], [-0.7, 0.4]], '3.0, 1.0, 0.0, 0.6');
    expect(z[0]).toBeCloseTo(0.5, 5); expect(z[1]).toBeCloseTo(0.3, 5);
    const o = await dispatchKernel('var_standing_wave', fnBody, [[0, 0]], '3.0, 1.0, 0.35, 0.6');
    expect(o[0]).toBe(0); expect(o[1]).toBe(0);
  });
  it('mode mask actually gates higher modes (1 ≠ 4)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_standing_wave');
    const pts = [[0.6, 0.4]] as const;
    const m1 = await dispatchKernel('var_standing_wave', fnBody, pts, '1.0, 1.0, 0.35, 0.6');
    const m4 = await dispatchKernel('var_standing_wave', fnBody, pts, '4.0, 1.0, 0.35, 0.6');
    expect(Math.abs(m1[0]! - m4[0]!) + Math.abs(m1[1]! - m4[1]!)).toBeGreaterThan(1e-4);
  });
  it('bounded displacement ≤ amp/(1−decay)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_standing_wave');
    const bound = 0.35 / (1 - 0.6);
    const pts: Array<[number, number]> = [];
    for (let x = -0.9; x <= 0.9; x += 0.45) for (let y = -0.9; y <= 0.9; y += 0.9) pts.push([x, y]);
    const out = await dispatchKernel('var_standing_wave', fnBody, pts, '3.0, 1.0, 0.35, 0.6');
    for (let i = 0; i < pts.length; i++) {
      expect(Math.abs(out[i*2]! - pts[i]![0])).toBeLessThan(bound + 1e-3);
      expect(Math.abs(out[i*2+1]! - pts[i]![1])).toBeLessThan(bound + 1e-3);
    }
  });
});

describe('V289 moire', () => {
  it('matches grating oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_moire');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_moire', fnBody, pts, '4.0, 0.6, 0.4, 0.25');
    for (let i = 0; i < pts.length; i++) {
      const e = jsMoire(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
    }
  });
  it('zero-amp identity + origin pin', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_moire');
    const z = await dispatchKernel('var_moire', fnBody, [[0.5, 0.3]], '4.0, 0.6, 0.4, 0.0');
    expect(z[0]).toBeCloseTo(0.5, 5); expect(z[1]).toBeCloseTo(0.3, 5);
    const o = await dispatchKernel('var_moire', fnBody, [[0, 0]], '4.0, 0.6, 0.4, 0.25');
    expect(o[0]).toBe(0); expect(o[1]).toBe(0);
  });
  it('bounded displacement ≤ amp per axis', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_moire');
    const pts: Array<[number, number]> = [];
    for (let x = -0.9; x <= 0.9; x += 0.45) for (let y = -0.9; y <= 0.9; y += 0.9) pts.push([x, y]);
    const out = await dispatchKernel('var_moire', fnBody, pts, '4.0, 0.6, 0.4, 0.25');
    for (let i = 0; i < pts.length; i++) {
      expect(Math.abs(out[i*2]! - pts[i]![0])).toBeLessThanOrEqual(0.25 + 1e-4);
      expect(Math.abs(out[i*2+1]! - pts[i]![1])).toBeLessThanOrEqual(0.25 + 1e-4);
    }
  });
});
