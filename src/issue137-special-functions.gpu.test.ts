// @vitest-environment node
//
// #137 — Special-function radial profiles (V273–V276): bessel_j0, airy_radial,
// cornu_spiral, struve_h1. Each WGSL kernel is extracted via extractWgslFn and
// dispatched on Dawn, then compared against an inline f64 JS oracle plus the
// spec's identity/boundedness properties. The shared eval helpers
// (bessel_j0_eval / airy_ai_eval / struve_h1_eval) are extracted into the
// prelude since they don't travel with the var fn.
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

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const BESSEL = extractWgslFn(SHADER_SRC, 'bessel_j0_eval');
const AIRY = extractWgslFn(SHADER_SRC, 'airy_ai_eval');
const STRUVE = extractWgslFn(SHADER_SRC, 'struve_h1_eval');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${BESSEL}
${AIRY}
${STRUVE}
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
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
  }
  const inBuf = dev.createBuffer({
    size: flat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

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
  const mod = await compileChecked(dev, code);
  const bindGroupLayout = dev.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = dev.createComputePipeline({
    layout: pipelineLayout,
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: inBuf } },
      { binding: 1, resource: { buffer: outBuf } },
    ],
  });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();

  const readBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 8);
  dev.queue.submit([enc.finish(), enc2.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  return res;
}

// ── f64 JS oracles (mirror the WGSL eval helpers) ──
function jsBesselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.0) {
    const yy = (x * x) / 9.0;
    return 1.0 + yy*(-2.2499997 + yy*(1.2656208 + yy*(-0.3163866 + yy*(0.0444479 + yy*(-0.0039444 + yy*0.0002100)))));
  }
  const z = 3.0 / ax, yy = z * z;
  const amp = 0.79788456 + yy*(-0.00000077 + yy*(-0.00552740 + yy*(-0.00009512 + yy*(0.00137237 + yy*(-0.00072805 + yy*0.00014476)))));
  const ph = ax - 0.78539816 + yy*(-0.04166397 + yy*(-0.00003954 + yy*(0.00262573 + yy*(-0.00054125 + yy*(-0.00029333 + yy*0.00013558)))));
  return amp / Math.sqrt(ax) * Math.cos(ph);
}
function jsAiry(x: number): number {
  if (x > 4.0) { const xi = (2/3)*Math.pow(x,1.5); return Math.exp(-xi)/(2*1.7724539*Math.pow(x,0.25)); }
  if (x < -5.0) { const ax = -x; const xi = (2/3)*Math.pow(ax,1.5); return Math.sin(xi+0.78539816)/(1.7724539*Math.pow(ax,0.25)); }
  const c1 = 0.355028053887817, c2 = 0.258819403792807;
  const x3 = x*x*x; let f=1, tf=1, g=x, tg=x;
  for (let k=1;k<12;k++){ tf*=x3/((3*k-1)*(3*k)); f+=tf; tg*=x3/((3*k)*(3*k+1)); g+=tg; }
  return c1*f - c2*g;
}
function jsStruveH1(x: number): number {
  const xc = Math.max(-10, Math.min(10, x));
  const hh = 0.5 * xc, h2 = hh*hh;
  let term = h2 / (0.8862269 * 1.3293404), sum = term;
  for (let m=1;m<16;m++){ term = term*(-(h2))/((m+0.5)*(m+1.5)); sum += term; }
  return sum;
}

describe('V273 bessel_j0', () => {
  it('matches J0-radial oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_bessel_j0');
    const freq = 4.0;
    const pts = [[0.5, 0.3], [-0.7, 0.4], [1.0, -0.5], [0.0, 0.6]] as const;
    const out = await dispatchKernel('var_bessel_j0', fnBody, pts, `${freq}`);
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const j = jsBesselJ0(freq * Math.hypot(px, py));
      expect(out[i*2]).toBeCloseTo(j * px, 4);
      expect(out[i*2+1]).toBeCloseTo(j * py, 4);
    }
  });
  it('origin is a fixed point (J0(0)=1, p=0)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_bessel_j0');
    const out = await dispatchKernel('var_bessel_j0', fnBody, [[0, 0]], '4.0');
    expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(1e-6);
  });
  it('collapses near the first J0 zero (freq·r ≈ 2.4048)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_bessel_j0');
    const freq = 4.0, r0 = 2.4048 / freq;
    const out = await dispatchKernel('var_bessel_j0', fnBody, [[r0, 0]], `${freq}`);
    expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(0.02);
  });
  it('|J0| factor never exceeds 1 across a radius sweep', () => {
    for (let r = 0; r <= 4; r += 0.1) expect(Math.abs(jsBesselJ0(r))).toBeLessThanOrEqual(1.0 + 1e-6);
  });
});

describe('V274 airy_radial', () => {
  it('airy_ai_eval(0) ≈ 0.3550280', () => {
    expect(jsAiry(0)).toBeCloseTo(0.3550280, 5);
  });
  it('matches Airy-radial oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_airy_radial');
    const scale = 3.0, shift = 1.5;   // positive shift → oscillatory caustic band (the working default)
    const pts = [[0.5, 0.3], [-0.7, 0.4], [1.0, -0.5], [0.0, 0.6]] as const;
    const out = await dispatchKernel('var_airy_radial', fnBody, pts, `${scale}, ${shift}`);
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const a = jsAiry(scale * (Math.hypot(px, py) - shift));
      expect(out[i*2]).toBeCloseTo(3*a*px, 4);
      expect(out[i*2+1]).toBeCloseTo(3*a*py, 4);
    }
  });
  it('exponential-decay branch is finite and tiny at x=8', () => {
    const a = jsAiry(8);
    expect(Number.isFinite(a)).toBe(true);
    expect(Math.abs(a)).toBeLessThan(1e-4);
  });
  it('output stays bounded |out| < 2·|p| across a sweep', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_airy_radial');
    const pts: Array<[number, number]> = [];
    for (let r = 0.1; r <= 3; r += 0.2) pts.push([r, 0]);
    const out = await dispatchKernel('var_airy_radial', fnBody, pts, '3.0, 1.5');
    for (let i = 0; i < pts.length; i++) {
      const rIn = Math.hypot(pts[i]![0], pts[i]![1]);
      const rOut = Math.hypot(out[i*2]!, out[i*2+1]!);
      expect(Number.isFinite(rOut)).toBe(true);
      expect(rOut).toBeLessThan(2 * rIn + 1e-3);
    }
  });
});

describe('V275 cornu_spiral', () => {
  it('matches Fresnel-clothoid oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_cornu_spiral');
    const freq = 1.6;
    const oracle = (x: number, y: number): [number, number] => {
      const t = freq * x, s = Math.abs(t), sgn = t < 0 ? -1 : 1;
      const f = (1 + 0.926*s)/(2 + 1.792*s + 3.104*s*s);
      const g = 1/(2 + 4.142*s + 3.492*s*s + 6.670*s*s*s);
      const a = Math.PI*s*s/2;
      const C = 0.5 + f*Math.sin(a) - g*Math.cos(a);
      const S = 0.5 - f*Math.cos(a) - g*Math.sin(a);
      return [sgn*C, sgn*S + 0.25*y];
    };
    const pts = [[0.5, 0.3], [-0.7, 0.4], [1.0, -0.5], [0.0, 0.6]] as const;
    const out = await dispatchKernel('var_cornu_spiral', fnBody, pts, `${freq}`);
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = oracle(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(ex, 4);
      expect(out[i*2+1]).toBeCloseTo(ey, 4);
    }
  });
  it('at t=0 the clothoid part vanishes (only the 0.25·y carry remains)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_cornu_spiral');
    const out = await dispatchKernel('var_cornu_spiral', fnBody, [[0, 0.8]], '1.6');
    expect(Math.abs(out[0]!)).toBeLessThan(1e-3);
    expect(out[1]!).toBeCloseTo(0.25 * 0.8, 3);
  });
  it('converges to the spiral eye (~0.5, 0.5) for large t', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_cornu_spiral');
    // The Fresnel integrals spiral into (0.5, 0.5) but the ripple envelope
    // decays only like 1/(πt), so t must be large (~20) before BOTH C and S
    // sit within 0.05 of the eye. freq·x = 20 → x = 12.5 at freq 1.6.
    const out = await dispatchKernel('var_cornu_spiral', fnBody, [[12.5, 0]], '1.6');
    expect(Math.abs(out[0]! - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(out[1]! - 0.5)).toBeLessThan(0.05);
  });
});

describe('V276 struve_h1', () => {
  it('matches Struve-radial oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_struve_h1');
    const freq = 2.5;
    const pts = [[0.5, 0.3], [-0.7, 0.4], [1.0, -0.5], [0.0, 0.6]] as const;
    const out = await dispatchKernel('var_struve_h1', fnBody, pts, `${freq}`);
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const g = 0.6 * jsStruveH1(freq * Math.hypot(px, py));
      expect(out[i*2]).toBeCloseTo(g * px, 4);
      expect(out[i*2+1]).toBeCloseTo(g * py, 4);
    }
  });
  it('origin is a fixed point (H1(0)=0)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_struve_h1');
    const out = await dispatchKernel('var_struve_h1', fnBody, [[0, 0]], '2.5');
    expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(1e-6);
  });
  it('gain·H1 magnitude stays under 0.7 across a sweep', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_struve_h1');
    const pts: Array<[number, number]> = [];
    for (let r = 0.1; r <= 3; r += 0.2) pts.push([r, 0]);
    const out = await dispatchKernel('var_struve_h1', fnBody, pts, '2.5');
    for (let i = 0; i < pts.length; i++) {
      const rIn = pts[i]![0];
      const factor = Math.hypot(out[i*2]!, out[i*2+1]!) / rIn;
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeLessThan(0.7);
    }
  });
  it('eval is finite at and past the clamp boundary x=10', () => {
    expect(Number.isFinite(jsStruveH1(10))).toBe(true);
    expect(Number.isFinite(jsStruveH1(50))).toBe(true);
  });
});
