// @vitest-environment node
//
// #133 V220 — Newton fractal step on zⁿ − 1. Tests:
//   - position warp: roots are fixed points (within EPS guard); known
//     real-axis values; pole-guard finiteness.
//   - DC color: each of the 3 roots (n=3) maps to its expected RGB.
//     Hue=k/n via the existing hsl_to_rgb (saturation 1, lightness 0.55).

import { afterAll, describe, expect, it } from 'vitest';
import { extractWgslFn } from './shaders/extract';
import { compileChecked } from './gpu-compile-guard';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const CPX_MUL = extractWgslFn(SHADER_SRC, 'complex_mul');
const CPX_SQR = extractWgslFn(SHADER_SRC, 'complex_sqr');
const CPX_DIV = extractWgslFn(SHADER_SRC, 'complex_div');
const HSL_TO_RGB = extractWgslFn(SHADER_SRC, 'hsl_to_rgb');
const CPX_POW_INT = extractWgslFn(SHADER_SRC, 'complex_pow_int');
const VAR_NEWTON = extractWgslFn(SHADER_SRC, 'var_newton');
const VAR_NEWTON_COLOR = extractWgslFn(SHADER_SRC, 'var_newton_color');

const PRELUDE = `const TAU: f32 = 6.28318530717958647692;
const SIN_SAFE_MAX: f32 = 1.0e6;
const EPS: f32 = 1.0e-10;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${CPX_MUL}
${CPX_SQR}
${CPX_DIV}
${HSL_TO_RGB}
${CPX_POW_INT}
${VAR_NEWTON}
${VAR_NEWTON_COLOR}
`;

async function dispatchNewton(inputs: ReadonlyArray<readonly [number, number, number]>): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];  // p.x
    flat[i * 4 + 1] = inputs[i]![1];  // p.y
    flat[i * 4 + 2] = inputs[i]![2];  // n
    flat[i * 4 + 3] = 0;              // pad
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
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = var_newton(r.xy, 1.0, r.z);
}`;
  const mod = await compileChecked(dev, code);
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
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
  const readback = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  enc.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  inBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

async function dispatchNewtonColor(inputs: ReadonlyArray<readonly [number, number, number]>): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
    flat[i * 4 + 2] = inputs[i]![2];
    flat[i * 4 + 3] = 0;
  }
  const inBuf = dev.createBuffer({
    size: flat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({
    size: N * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const code = `${PRELUDE}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec4f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  let rgb = var_newton_color(r.xy, r.z);
  outs[i] = vec4f(rgb, 0.0);
}`;
  const mod = await compileChecked(dev, code);
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
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
  const readback = dev.createBuffer({
    size: N * 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  enc.copyBufferToBuffer(outBuf, 0, readback, 0, N * 16);
  dev.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  inBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

describe.skipIf(!device)('#133 V220 — var_newton (position warp)', () => {
  it('keeps roots near themselves (n=3, z ≈ root)', async () => {
    // Newton step at a root: z' should land at the root (fixed point of
    // Newton iteration). z=1 is a root of z³−1; we expect (1, 0) back
    // within reasonable tolerance. (Not exact — single-step approx.)
    const out = await dispatchNewton([
      [1.0, 0.0, 3],
    ]);
    expect(out[0]).toBeCloseTo(1.0, 4);
    expect(out[1]).toBeCloseTo(0.0, 4);
  });

  it('matches known real-axis values for n=3', async () => {
    // z' = ((n-1)z^n + 1) / (n z^(n-1))
    // At z=2, n=3: (2·8 + 1) / (3·4) = 17/12 ≈ 1.41667
    const out = await dispatchNewton([
      [2.0, 0.0, 3],
    ]);
    expect(out[0]).toBeCloseTo(17 / 12, 3);
    expect(out[1]).toBeCloseTo(0.0, 4);
  });

  it('guards the z=0 pole with finite output', async () => {
    const out = await dispatchNewton([
      [0.0, 0.0, 3],
      [1e-9, 0.0, 3],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('handles n=4 (root at 1 still a root of z⁴−1)', async () => {
    const out = await dispatchNewton([
      [1.0, 0.0, 4],
    ]);
    expect(out[0]).toBeCloseTo(1.0, 4);
    expect(out[1]).toBeCloseTo(0.0, 4);
  });

  it('produces finite output at complex inputs', async () => {
    const out = await dispatchNewton([
      [0.5, 0.5, 3],
      [-0.3, 0.7, 3],
      [1.2, -0.4, 5],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

describe.skipIf(!device)('#133 V220 — var_newton_color (DC basin)', () => {
  // n=3 roots: r₀ = (1, 0); r₁ = (cos(2π/3), sin(2π/3)) ≈ (-0.5, 0.866);
  // r₂ = (cos(4π/3), sin(4π/3)) ≈ (-0.5, -0.866). One Newton step
  // lookahead from any near-root input keeps us near that root, so the
  // dominant channel of the HSL color tells us which basin.

  it('points near root 0 (z ≈ 1) get k=0 hue → reddish RGB', async () => {
    const out = await dispatchNewtonColor([
      [0.95, 0.0, 3],
    ]);
    // hue=0/3=0, sat=1, lit=0.55 → HSL(0, 1, 0.55) → RGB pure red ≈ (1, 0.1, 0.1)
    // R dominates G and B
    expect(out[0]).toBeGreaterThan(out[1]!);
    expect(out[0]).toBeGreaterThan(out[2]!);
    // Red should be ~1.0
    expect(out[0]).toBeGreaterThan(0.9);
  });

  it('points near root 1 (z ≈ -0.5 + 0.866i) get k=1 hue → greenish', async () => {
    const out = await dispatchNewtonColor([
      [-0.5, 0.85, 3],
    ]);
    // hue=1/3, sat=1, lit=0.55 → HSL(0.333, 1, 0.55) → green
    expect(out[1]).toBeGreaterThan(out[0]!);
    expect(out[1]).toBeGreaterThan(out[2]!);
  });

  it('points near root 2 (z ≈ -0.5 - 0.866i) get k=2 hue → bluish', async () => {
    const out = await dispatchNewtonColor([
      [-0.5, -0.85, 3],
    ]);
    // hue=2/3, sat=1, lit=0.55 → HSL(0.666, 1, 0.55) → blue
    expect(out[2]).toBeGreaterThan(out[0]!);
    expect(out[2]).toBeGreaterThan(out[1]!);
  });

  it('all 3 basin colors are distinct for n=3', async () => {
    const out = await dispatchNewtonColor([
      [0.95, 0.0, 3],
      [-0.5, 0.85, 3],
      [-0.5, -0.85, 3],
    ]);
    // Use vec4 stride
    const c0 = [out[0]!, out[1]!, out[2]!];
    const c1 = [out[4]!, out[5]!, out[6]!];
    const c2 = [out[8]!, out[9]!, out[10]!];
    // Each pair must differ by more than 0.1 in at least one channel.
    function distinct(a: number[], b: number[]): boolean {
      return a.some((v, i) => Math.abs(v - b[i]!) > 0.1);
    }
    expect(distinct(c0, c1)).toBe(true);
    expect(distinct(c1, c2)).toBe(true);
    expect(distinct(c0, c2)).toBe(true);
  });

  it('produces 4 distinct basin colors at n=4', async () => {
    // n=4 roots: 1, i, -1, -i
    const out = await dispatchNewtonColor([
      [0.95, 0.0, 4],
      [0.0, 0.95, 4],
      [-0.95, 0.0, 4],
      [0.0, -0.95, 4],
    ]);
    const cols = [
      [out[0]!, out[1]!, out[2]!],
      [out[4]!, out[5]!, out[6]!],
      [out[8]!, out[9]!, out[10]!],
      [out[12]!, out[13]!, out[14]!],
    ];
    function distinct(a: number[], b: number[]): boolean {
      return a.some((v, i) => Math.abs(v - b[i]!) > 0.1);
    }
    // Pairwise distinctness: 4·3/2 = 6 comparisons.
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        expect(distinct(cols[i]!, cols[j]!)).toBe(true);
      }
    }
  });
});
