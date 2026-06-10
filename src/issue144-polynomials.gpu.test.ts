// @vitest-environment node
//
// #144 — Orthogonal-polynomial & harmonic warps (V280–V283): chebyshev,
// legendre, spherical_harmonic, fourier_warp. Extracted-fn GPU dispatch vs an
// inline f64 JS oracle + the spec's algebraic identities (T_n cosine identity,
// P_2 known value, direction preservation, boundedness, phase determinism).
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
const CHEB = extractWgslFn(SHADER_SRC, 'cheb_T');
const LEG = extractWgslFn(SHADER_SRC, 'legendre_P');
const ASSOC = extractWgslFn(SHADER_SRC, 'assoc_legendre');
const SPH = extractWgslFn(SHADER_SRC, 'sph_harmonic');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${CHEB}
${LEG}
${ASSOC}
${SPH}
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
  const mod = dev.createShaderModule({ code });
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

const jsT = (v: number, n: number): number => {
  const c = Math.max(-1, Math.min(1, v));
  if (n <= 0) return 1; if (n === 1) return c;
  let a = 1, b = c, t = c;
  for (let k = 2; k <= n; k++) { t = 2 * c * b - a; a = b; b = t; }
  return t;
};
const jsP = (v: number, n: number): number => {
  const c = Math.max(-1, Math.min(1, v));
  if (n <= 0) return 1; if (n === 1) return c;
  let a = 1, b = c, p = c;
  for (let k = 1; k < n; k++) { p = ((2 * k + 1) * c * b - k * a) / (k + 1); a = b; b = p; }
  return p;
};

describe('V280 chebyshev', () => {
  it('matches per-axis T_n oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chebyshev');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5], [1.4, -1.8]] as const;
    const out = await dispatchKernel('var_chebyshev', fnBody, pts, '4.0, 3.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(jsT(pts[i]![0], 4), 4);
      expect(out[i*2+1]).toBeCloseTo(jsT(pts[i]![1], 3), 4);
    }
  });
  it('cosine identity T_3(cos θ)=cos(3θ)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chebyshev');
    const out = await dispatchKernel('var_chebyshev', fnBody, [[Math.cos(0.4), 0]], '3.0, 0.0');
    expect(out[0]!).toBeCloseTo(Math.cos(3 * 0.4), 4);
  });
  it('parity: T_2 even (no sign flip), T_3 odd (sign flip)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chebyshev');
    const outP = await dispatchKernel('var_chebyshev', fnBody, [[0.6, 0.6]], '2.0, 3.0');
    const outN = await dispatchKernel('var_chebyshev', fnBody, [[-0.6, -0.6]], '2.0, 3.0');
    expect(outN[0]!).toBeCloseTo(outP[0]!, 4);        // even
    expect(outN[1]!).toBeCloseTo(-outP[1]!, 4);       // odd
  });
  it('bounded by 1 on [-1,1] across orders', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_chebyshev');
    const pts: Array<[number, number]> = [];
    for (let v = -1; v <= 1; v += 0.25) pts.push([v, v]);
    const out = await dispatchKernel('var_chebyshev', fnBody, pts, '12.0, 11.0');
    for (let i = 0; i < pts.length * 2; i++) expect(Math.abs(out[i]!)).toBeLessThanOrEqual(1 + 1e-5);
  });
});

describe('V281 legendre', () => {
  it('matches per-axis P_n oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_legendre');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_legendre', fnBody, pts, '5.0, 4.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(jsP(pts[i]![0], 5), 4);
      expect(out[i*2+1]).toBeCloseTo(jsP(pts[i]![1], 4), 4);
    }
  });
  it('known value P_2(0.6) = 0.04', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_legendre');
    const out = await dispatchKernel('var_legendre', fnBody, [[0.6, 0]], '2.0, 0.0');
    expect(out[0]!).toBeCloseTo(0.04, 4);
  });
  it('endpoint normalization P_5(1) = 1', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_legendre');
    const out = await dispatchKernel('var_legendre', fnBody, [[1.0, 0]], '5.0, 0.0');
    expect(out[0]!).toBeCloseTo(1.0, 4);
  });
  it('bounded by 1 on [-1,1]', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_legendre');
    const pts: Array<[number, number]> = [];
    for (let v = -1; v <= 1; v += 0.25) pts.push([v, v]);
    const out = await dispatchKernel('var_legendre', fnBody, pts, '9.0, 8.0');
    for (let i = 0; i < pts.length * 2; i++) expect(Math.abs(out[i]!)).toBeLessThanOrEqual(1 + 1e-5);
  });
});

describe('V282 spherical_harmonic', () => {
  it('l=0,m=0,amount=1 is the identity (Y=1)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_spherical_harmonic');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_spherical_harmonic', fnBody, pts, '0.0, 0.0, 1.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 4);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 4);
    }
  });
  it('preserves direction (out ∥ input)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_spherical_harmonic');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_spherical_harmonic', fnBody, pts, '3.0, 2.0, 1.0');
    for (let i = 0; i < pts.length; i++) {
      const cross = out[i*2]! * pts[i]![1] - out[i*2+1]! * pts[i]![0];
      expect(Math.abs(cross)).toBeLessThan(1e-4);
    }
  });
  it('origin guard returns (0,0) with no NaN', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_spherical_harmonic');
    const out = await dispatchKernel('var_spherical_harmonic', fnBody, [[0, 0]], '3.0, 2.0, 1.0');
    expect(out[0]!).toBe(0);
    expect(out[1]!).toBe(0);
  });
  it('bounded |out| ≤ 3·r across l,m sweep', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_spherical_harmonic');
    const pts: Array<[number, number]> = [];
    for (let r = 0.2; r <= 1.5; r += 0.3) pts.push([r * 0.6, r * 0.8]);
    const out = await dispatchKernel('var_spherical_harmonic', fnBody, pts, '6.0, 6.0, 2.0');
    for (let i = 0; i < pts.length; i++) {
      const rIn = Math.hypot(pts[i]![0], pts[i]![1]);
      const rOut = Math.hypot(out[i*2]!, out[i*2+1]!);
      expect(Number.isFinite(rOut)).toBe(true);
      expect(rOut).toBeLessThanOrEqual(3 * rIn + 1e-4);
    }
  });
});

describe('V283 fourier_warp', () => {
  it('amp=0 is the identity', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_fourier_warp');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_fourier_warp', fnBody, pts, '4.0, 0.0, 1.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 4);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 4);
    }
  });
  it('preserves direction and never sign-flips (dot(out,p) ≥ 0)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_fourier_warp');
    const pts: Array<[number, number]> = [];
    for (let a = 0; a < 6.2; a += 0.4) pts.push([Math.cos(a), Math.sin(a)]);
    const out = await dispatchKernel('var_fourier_warp', fnBody, pts, '4.0, 0.4, 1.0');
    for (let i = 0; i < pts.length; i++) {
      const cross = out[i*2]! * pts[i]![1] - out[i*2+1]! * pts[i]![0];
      const dot = out[i*2]! * pts[i]![0] + out[i*2+1]! * pts[i]![1];
      expect(Math.abs(cross)).toBeLessThan(1e-4);
      expect(dot).toBeGreaterThanOrEqual(0);
    }
  });
  it('different phase seeds give different envelopes', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_fourier_warp');
    const pts = [[0.7, 0.4], [-0.5, 0.6], [0.3, -0.9]] as const;
    const outA = await dispatchKernel('var_fourier_warp', fnBody, pts, '4.0, 0.4, 1.0');
    const outB = await dispatchKernel('var_fourier_warp', fnBody, pts, '4.0, 0.4, 7.0');
    let differs = false;
    for (let i = 0; i < pts.length * 2; i++) if (Math.abs(outA[i]! - outB[i]!) > 1e-4) differs = true;
    expect(differs).toBe(true);
  });
});
