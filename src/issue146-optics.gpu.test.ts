// @vitest-environment node
//
// #146 — Optics warps (V284–V286): snell_refraction, grin_lens, caustic_fold.
// Snell + GRIN are trig-free; caustic_fold routes its freq-scaled coordinate
// through safe_sin (Dawn f32 trig cliff), exercised here with RUNTIME args so
// constant-folding can't mask the cliff path.
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
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
  const mod = await compileChecked(dev, code);
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

describe('V284 snell_refraction', () => {
  it('preserves magnitude |out| = |p|', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_snell_refraction');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5], [0.2, 0.95]] as const;
    const out = await dispatchKernel('var_snell_refraction', fnBody, pts, '0.67, 1.0');
    for (let i = 0; i < pts.length; i++) {
      expect(Math.hypot(out[i*2]!, out[i*2+1]!)).toBeCloseTo(Math.hypot(pts[i]![0], pts[i]![1]), 4);
    }
  });
  it('n_ratio=1, strength=1 leaves direction unchanged', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_snell_refraction');
    const pts = [[0.5, 0.3], [0.9, -0.4]] as const;
    const out = await dispatchKernel('var_snell_refraction', fnBody, pts, '1.0, 1.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 4);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 4);
    }
  });
  it('total internal reflection flips the normal (y) component', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_snell_refraction');
    // (0.95, 0.31): sin1≈0.951, nr·sin1≈1.9 ≥ 1 → TIR → out.y sign flips
    const out = await dispatchKernel('var_snell_refraction', fnBody, [[0.95, 0.31]], '2.0, 1.0');
    expect(Math.sign(out[1]!)).toBe(-Math.sign(0.31));
    expect(Math.hypot(out[0]!, out[1]!)).toBeCloseTo(Math.hypot(0.95, 0.31), 4);
  });
});

describe('V285 grin_lens', () => {
  it('preserves direction (collinear with input)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_grin_lens');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_grin_lens', fnBody, pts, '0.6, 0.15');
    for (let i = 0; i < pts.length; i++) {
      const cross = out[i*2]! * pts[i]![1] - out[i*2+1]! * pts[i]![0];
      expect(Math.abs(cross)).toBeLessThan(1e-4);
    }
  });
  it('origin fixed point + bounded near focus (no 1/f blow-up)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_grin_lens');
    const out = await dispatchKernel('var_grin_lens', fnBody, [[0, 0], [0.001, 0]], '0.6, 0.15');
    expect(out[0]).toBe(0); expect(out[1]).toBe(0);
    expect(Number.isFinite(out[2]!)).toBe(true);
    expect(Math.abs(out[2]!)).toBeLessThan(1.0);
  });
  it('recovers the thin lens at large r (pull vanishes)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_grin_lens');
    const out = await dispatchKernel('var_grin_lens', fnBody, [[2.0, 0]], '0.6, 0.15');
    expect(Math.abs(out[0]! - 2.0)).toBeLessThan(0.02);
  });
});

describe('V286 caustic_fold', () => {
  it('bounded displacement ≤ amp·√2', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_caustic_fold');
    const amp = 0.35;
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5], [1.2, 0.8]] as const;
    const out = await dispatchKernel('var_caustic_fold', fnBody, pts, `2.5, ${amp}, 0.0`);
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(out[i*2]! - pts[i]![0], out[i*2+1]! - pts[i]![1]);
      expect(d).toBeLessThanOrEqual(amp * Math.SQRT2 + 1e-4);
    }
  });
  it('amp=0 is the identity', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_caustic_fold');
    const pts = [[0.5, 0.3], [-0.7, 0.4]] as const;
    const out = await dispatchKernel('var_caustic_fold', fnBody, pts, '2.5, 0.0, 0.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 5);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 5);
    }
  });
  it('separable: x-displacement depends only on x', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_caustic_fold');
    const a = await dispatchKernel('var_caustic_fold', fnBody, [[0.5, 0.3]], '2.5, 0.35, 0.0');
    const b = await dispatchKernel('var_caustic_fold', fnBody, [[0.5, -0.9]], '2.5, 0.35, 0.0');
    expect(a[0]! - 0.5).toBeCloseTo(b[0]! - 0.5, 5);   // same x-displacement
  });
  it('safe_sin native branch matches Math.sin at freq=8 (runtime arg)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_caustic_fold');
    // k·x = 8·5 = 40 < SIN_SAFE_MAX → native branch, exact value
    const out = await dispatchKernel('var_caustic_fold', fnBody, [[5.0, 0.0]], '8.0, 0.35, 0.0');
    const expX = 5.0 + 0.35 * (-Math.sin(8 * 5.0));
    expect(out[0]).toBeCloseTo(expX, 3);
  });
});
