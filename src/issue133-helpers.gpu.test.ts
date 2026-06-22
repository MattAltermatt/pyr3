// @vitest-environment node
//
// #133 — Complex helpers (complex_exp / complex_pow / complex_sin).
// Foundational for V223 complex_gamma (uses all 3 + reflection branch)
// and V224 lambert_w (uses complex_exp inside Halley iteration).
//
// Strategy:
//   - Canonical-point sanity (Euler identity, sin(π/2)=1, etc.)
//   - Large-argument safety: Dawn f32 trig cliff (#46/#72) guarded via
//     safe_sin/cos; verify the helpers don't degenerate to 0 + Im axis.
//   - F64 oracle parity for the Γ-relevant compositions.
//
// extractWgslFn runtime-args pattern (#46/#72): all arguments threaded
// through uniform/storage buffers so the WGSL compiler can't fold them.
// Constants in arg position mask the trig cliff because Dawn evaluates
// sin/cos of constants at compile time.

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
const CPX_MUL = extractWgslFn(SHADER_SRC, 'complex_mul');
const CPX_LOG = extractWgslFn(SHADER_SRC, 'complex_log');
const CPX_EXP = extractWgslFn(SHADER_SRC, 'complex_exp');
const CPX_POW = extractWgslFn(SHADER_SRC, 'complex_pow');
const CPX_SIN = extractWgslFn(SHADER_SRC, 'complex_sin');

const PRELUDE = `const TAU: f32 = 6.28318530717958647692;
const SIN_SAFE_MAX: f32 = 1.0e6;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${CPX_MUL}
${CPX_LOG}
${CPX_EXP}
${CPX_POW}
${CPX_SIN}
`;

async function dispatch1(call: string, inputs: ReadonlyArray<readonly [number, number]>): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const inFlat = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    inFlat[i * 2] = inputs[i]![0];
    inFlat[i * 2 + 1] = inputs[i]![1];
  }
  const inBuf = dev.createBuffer({
    size: inFlat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(inBuf, 0, inFlat);
  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const code = `${PRELUDE}
@group(0) @binding(0) var<storage, read> ins: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  outs[i] = ${call};
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

async function dispatch2(call: string, pairs: ReadonlyArray<readonly [[number, number], [number, number]]>): Promise<Float32Array> {
  const dev = device!;
  const N = pairs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = pairs[i]![0]![0];
    flat[i * 4 + 1] = pairs[i]![0]![1];
    flat[i * 4 + 2] = pairs[i]![1]![0];
    flat[i * 4 + 3] = pairs[i]![1]![1];
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
  let pair = ins[i];
  let a = pair.xy;
  let b = pair.zw;
  outs[i] = ${call};
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

describe.skipIf(!device)('#133 — complex_exp helper', () => {
  it('matches Euler identity at canonical inputs', async () => {
    const out = await dispatch1('complex_exp(ins[i])', [
      [0, 0],        // e^0 = 1 + 0i
      [1, 0],        // e^1 = e + 0i
      [0, Math.PI / 2],  // e^(iπ/2) = i
      [0, Math.PI],      // e^(iπ) = -1 + 0i
      [1, Math.PI],      // e^(1+iπ) = -e + 0i
    ]);
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[1]).toBeCloseTo(0, 4);
    expect(out[2]).toBeCloseTo(Math.E, 3);
    expect(out[3]).toBeCloseTo(0, 4);
    expect(out[4]).toBeCloseTo(0, 3);
    expect(out[5]).toBeCloseTo(1, 3);
    expect(out[6]).toBeCloseTo(-1, 3);
    expect(out[7]).toBeCloseTo(0, 3);
    expect(out[8]).toBeCloseTo(-Math.E, 2);
    expect(out[9]).toBeCloseTo(0, 2);
  });

  it('stays finite past the Dawn f32 trig cliff (large Im arg)', async () => {
    // Im(z) = 1e8 is well past SIN_SAFE_MAX = 1e6. With raw sin/cos, Dawn
    // returns 0 → complex_exp would produce (e^Re, 0). With safe_sin/cos,
    // we get a deterministic hash-spread within [-1, 1], so magnitude
    // ≈ e^Re (unit Euler factor times the real scaling).
    const out = await dispatch1('complex_exp(ins[i])', [
      [0, 1e8],
      [0, -1e8],
      [-1, 1e9],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
    // Magnitude at Re=0 should still be ~1 (Euler factor is unit even via safe_*).
    const mag0 = Math.hypot(out[0]!, out[1]!);
    const mag1 = Math.hypot(out[2]!, out[3]!);
    expect(mag0).toBeCloseTo(1, 2);
    expect(mag1).toBeCloseTo(1, 2);
  });

  it('clamps Re argument to ±20 to avoid f32 overflow', async () => {
    // exp(100) would overflow f32 (max ~3.4e38; e^100 ≈ 2.7e43).
    // Clamp at 20 → e^20 ≈ 4.85e8, well within f32 range.
    const out = await dispatch1('complex_exp(ins[i])', [
      [100, 0],
      [-100, 0],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
    // Re=100 clamped to 20 → exp(20) ≈ 4.85e8
    expect(out[0]).toBeCloseTo(Math.exp(20), -7);
    // Re=-100 clamped to -20 → exp(-20) ≈ 2.06e-9
    expect(out[2]).toBeCloseTo(Math.exp(-20), 7);
  });
});

describe.skipIf(!device)('#133 — complex_pow helper', () => {
  it('handles real positive bases at integer exponents', async () => {
    const out = await dispatch2('complex_pow(a, b)', [
      [[2, 0], [3, 0]],   // 2³ = 8
      [[3, 0], [2, 0]],   // 3² = 9
      [[Math.E, 0], [1, 0]],  // e¹ = e
      [[1, 0], [42, 0]],  // 1ⁿ = 1
    ]);
    expect(out[0]).toBeCloseTo(8, 2);
    expect(out[1]).toBeCloseTo(0, 4);
    expect(out[2]).toBeCloseTo(9, 2);
    expect(out[3]).toBeCloseTo(0, 4);
    expect(out[4]).toBeCloseTo(Math.E, 3);
    expect(out[5]).toBeCloseTo(0, 4);
    expect(out[6]).toBeCloseTo(1, 4);
    expect(out[7]).toBeCloseTo(0, 4);
  });

  it('produces principal-branch root via complex_log', async () => {
    // (-1)^0.5 = i  via principal branch (atan2(0,-1) = π)
    const out = await dispatch2('complex_pow(a, b)', [
      [[-1, 0], [0.5, 0]],   // expect (0, 1) = i
      [[4, 0], [0.5, 0]],    // expect (2, 0)
    ]);
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[1]).toBeCloseTo(1, 3);
    expect(out[2]).toBeCloseTo(2, 3);
    expect(out[3]).toBeCloseTo(0, 3);
  });
});

describe.skipIf(!device)('#133 — complex_sin helper', () => {
  it('matches real-axis sine at canonical inputs', async () => {
    const out = await dispatch1('complex_sin(ins[i])', [
      [0, 0],
      [Math.PI / 2, 0],
      [Math.PI, 0],
      [-Math.PI / 2, 0],
    ]);
    expect(out[0]).toBeCloseTo(0, 4);
    expect(out[1]).toBeCloseTo(0, 4);
    expect(out[2]).toBeCloseTo(1, 4);
    expect(out[3]).toBeCloseTo(0, 4);
    expect(out[4]).toBeCloseTo(0, 4);
    expect(out[5]).toBeCloseTo(0, 4);
    expect(out[6]).toBeCloseTo(-1, 4);
    expect(out[7]).toBeCloseTo(0, 4);
  });

  it('handles pure-imaginary input via sinh/cosh', async () => {
    // sin(iy) = i sinh(y). Re = sin(0) * cosh(y) = 0; Im = cos(0) * sinh(y) = sinh(y).
    const out = await dispatch1('complex_sin(ins[i])', [
      [0, 1],   // expect (0, sinh(1)) ≈ (0, 1.1752)
      [0, 2],   // expect (0, sinh(2)) ≈ (0, 3.6269)
    ]);
    expect(out[0]).toBeCloseTo(0, 4);
    expect(out[1]).toBeCloseTo(Math.sinh(1), 3);
    expect(out[2]).toBeCloseTo(0, 4);
    expect(out[3]).toBeCloseTo(Math.sinh(2), 2);
  });

  it('clamps Im to ±20 to avoid sinh/cosh overflow', async () => {
    // sinh(100) ≈ 1.34e43 overflows f32. Clamp at 20 → sinh(20) ≈ 2.43e8.
    const out = await dispatch1('complex_sin(ins[i])', [
      [0, 100],
      [Math.PI / 2, 50],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
    // Im clamped to 20 → sinh(20) ≈ 2.43e8
    expect(out[1]).toBeCloseTo(Math.sinh(20), -7);
  });
});
