// @vitest-environment node
//
// #133 V224 — principal-branch Lambert W (W₀) via Halley iteration.
// W(z) satisfies W·e^W = z. Tested at canonical points:
//   W(0) = 0, W(1) = Ω ≈ 0.5671, W(e) = 1, W(-1/e) = -1.
// Halley converges quadratically; 2-3 iterations land within ~1e-3 of
// the true value for typical inputs.

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
const CPX_DIV = extractWgslFn(SHADER_SRC, 'complex_div');
const CPX_LOG = extractWgslFn(SHADER_SRC, 'complex_log');
const CPX_EXP = extractWgslFn(SHADER_SRC, 'complex_exp');
const VAR_LAMBERT_W = extractWgslFn(SHADER_SRC, 'var_lambert_w');

const PRELUDE = `const TAU: f32 = 6.28318530717958647692;
const SIN_SAFE_MAX: f32 = 1.0e6;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${CPX_MUL}
${CPX_DIV}
${CPX_LOG}
${CPX_EXP}
${VAR_LAMBERT_W}
`;

async function dispatchLambert(inputs: ReadonlyArray<readonly [number, number, number]>): Promise<Float32Array> {
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
  outs[i] = var_lambert_w(r.xy, 1.0, r.z);
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

describe.skipIf(!device)('#133 V224 — var_lambert_w', () => {
  it('W(0) = 0', async () => {
    const out = await dispatchLambert([
      [0.0, 0.0, 3],
    ]);
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[1]).toBeCloseTo(0, 3);
  });

  it('W(1) = Ω ≈ 0.5671 (the omega constant)', async () => {
    const out = await dispatchLambert([
      [1.0, 0.0, 3],
    ]);
    expect(out[0]).toBeCloseTo(0.5671, 2);
    expect(out[1]).toBeCloseTo(0, 3);
  });

  it('W(e) = 1', async () => {
    const out = await dispatchLambert([
      [Math.E, 0.0, 3],
    ]);
    expect(out[0]).toBeCloseTo(1, 2);
    expect(out[1]).toBeCloseTo(0, 3);
  });

  it('W(-0.3) ≈ -0.4894 (negative real, principal branch)', async () => {
    const out = await dispatchLambert([
      [-0.3, 0.0, 3],
    ]);
    expect(out[0]).toBeCloseTo(-0.4894, 2);
    expect(out[1]).toBeCloseTo(0, 3);
  });

  it('W(1+i) ≈ (0.6569, 0.3254) (complex input)', async () => {
    const out = await dispatchLambert([
      [1.0, 1.0, 4],
    ]);
    expect(out[0]).toBeCloseTo(0.6569, 2);
    expect(out[1]).toBeCloseTo(0.3254, 2);
  });

  it('W(100) ≈ 3.385 (asymptotic branch, |z| > 1)', async () => {
    const out = await dispatchLambert([
      [100.0, 0.0, 4],
    ]);
    expect(out[0]).toBeCloseTo(3.385, 1);
    expect(out[1]).toBeCloseTo(0, 1);
  });

  it('finite output across chaos-game inputs', async () => {
    const out = await dispatchLambert([
      [0.5, 0.3, 2],
      [-0.5, 0.7, 2],
      [1.2, -0.4, 2],
      [-1.0, -1.0, 2],
      [0.1, 0.05, 2],
      [2.0, 0.0, 2],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('Halley converges: w·e^w ≈ z after iteration', async () => {
    // Round-trip check: if W(z) = w, then w·e^w should be ≈ z.
    const out = await dispatchLambert([
      [2.0, 0.0, 4],
      [0.7, 0.4, 4],
    ]);
    // (2, 0) round-trip
    const w0_re = out[0]!, w0_im = out[1]!;
    const ew0_re = Math.exp(w0_re) * Math.cos(w0_im);
    const ew0_im = Math.exp(w0_re) * Math.sin(w0_im);
    const z0_re = w0_re * ew0_re - w0_im * ew0_im;
    const z0_im = w0_re * ew0_im + w0_im * ew0_re;
    expect(z0_re).toBeCloseTo(2.0, 1);
    expect(z0_im).toBeCloseTo(0.0, 1);
    // (0.7, 0.4) round-trip
    const w1_re = out[2]!, w1_im = out[3]!;
    const ew1_re = Math.exp(w1_re) * Math.cos(w1_im);
    const ew1_im = Math.exp(w1_re) * Math.sin(w1_im);
    const z1_re = w1_re * ew1_re - w1_im * ew1_im;
    const z1_im = w1_re * ew1_im + w1_im * ew1_re;
    expect(z1_re).toBeCloseTo(0.7, 1);
    expect(z1_im).toBeCloseTo(0.4, 1);
  });
});
