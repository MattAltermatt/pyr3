// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import {
  ts_var_lorentz_boost,
  ts_var_schwarzschild_lensing,
  ts_var_field_dipole,
  ts_var_magnetic_pendulum,
} from './variations';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');

// safe_sin/safe_cos depend on SIN_SAFE_MAX, PI, TAU (module-scope const trap —
// they do NOT extract with the function) and call into hash01 on the cliff
// branch. Stamp the prelude with the same constants + helper the engine uses.
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
  // Explicit pipeline layout — `layout: 'auto'` silently strips bindings the
  // shader doesn't statically reference, producing all-zero output without
  // an error (see reference-wgsl-extract-and-test-layout).
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

describe('V262 lorentz_boost', () => {
  it('matches expected math (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_lorentz_boost');
    const pts = [
      [0.0, 0.0],
      [0.5, 0.0],
      [0.3, 0.4],
      [-1.2, 0.7],
    ] as const;
    const out = await dispatchKernel('var_lorentz_boost', fnBody, pts, '0.5, 0.3');
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const exp = ts_var_lorentz_boost({
        tx: px, ty: py, weight: 1.0,
        params: { rapidity: 0.5, angle: 0.3 },
      });
      expect(out[i * 2]).toBeCloseTo(exp.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(exp.y, 4);
    }
  });

  it('reduces to identity at rapidity=0', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_lorentz_boost');
    const pts = [[0.4, 0.6], [-0.3, 0.2], [1.1, -0.8]] as const;
    const out = await dispatchKernel('var_lorentz_boost', fnBody, pts, '0.0, 0.5');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i * 2]).toBeCloseTo(pts[i]![0], 5);
      expect(out[i * 2 + 1]).toBeCloseTo(pts[i]![1], 5);
    }
  });
});

describe('V263 schwarzschild_lensing', () => {
  it('matches expected math (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_schwarzschild_lensing');
    const pts = [
      [0.0, 0.0],
      [0.5, 0.0],
      [0.3, 0.4],
      [-1.2, 0.7],
    ] as const;
    // mass=0.5, eps=0.05 → α = 0.5/(|p|+0.05) stays in [0.4, 10], well below
    // the safe_* cliff, so native Math (TS) and safe_* (WGSL) agree.
    const out = await dispatchKernel('var_schwarzschild_lensing', fnBody, pts, '0.5, 0.05');
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const exp = ts_var_schwarzschild_lensing({
        tx: px, ty: py, weight: 1.0,
        params: { mass: 0.5, eps: 0.05 },
      });
      expect(out[i * 2]).toBeCloseTo(exp.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(exp.y, 4);
    }
  });

  it('deflects angularly — preserves radius (NOT a radial squeeze)', async () => {
    if (!device) return;
    // The spec form is a rotation by α(b); a pure rotation conserves |p|.
    // This is the exact property the dropped V263 (a radial squeeze) failed.
    const fnBody = extractWgslFn(SHADER_SRC, 'var_schwarzschild_lensing');
    const pts = [[0.4, 0.6], [-0.3, 0.2], [1.1, -0.8]] as const;
    const out = await dispatchKernel('var_schwarzschild_lensing', fnBody, pts, '0.7, 0.05');
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const rIn = Math.hypot(px, py);
      const rOut = Math.hypot(out[i * 2]!, out[i * 2 + 1]!);
      expect(rOut).toBeCloseTo(rIn, 4);
    }
  });

  it('stays finite near the lens core (safe_* cliff path)', async () => {
    if (!device) return;
    // eps=0 + a sub-µm radius drives α = mass/b above SIN_SAFE_MAX (1e6),
    // exercising safe_sin/safe_cos's deterministic hash branch. Output must
    // be finite (no NaN/Inf), not bit-matched to native Math here.
    const fnBody = extractWgslFn(SHADER_SRC, 'var_schwarzschild_lensing');
    const pts = [[1e-7, 0.0], [0.0, -1e-7], [3e-7, 4e-7]] as const;
    const out = await dispatchKernel('var_schwarzschild_lensing', fnBody, pts, '2.0, 0.0');
    for (let i = 0; i < pts.length * 2; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }
  });
});

describe('V264 field_dipole', () => {
  it('matches expected math (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_field_dipole');
    // Avoid sampling exactly on the dipole poles (±0.25, 0) — the 1e-4 eps
    // produces TS/WGSL-equivalent finite values, but precision near r=0
    // amplifies last-bit ULP differences past the 1e-4 toBeCloseTo tolerance.
    const pts = [
      [0.5, 0.3],
      [-0.7, 0.4],
      [1.0, -0.5],
      [0.0, 0.6],
    ] as const;
    const out = await dispatchKernel('var_field_dipole', fnBody, pts, '1.0, 0.5, 0.2, 0.0');
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const exp = ts_var_field_dipole({
        tx: px, ty: py, weight: 1.0,
        params: { charge: 1.0, separation: 0.5, step: 0.2, angle: 0.0 },
      });
      expect(out[i * 2]).toBeCloseTo(exp.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(exp.y, 4);
    }
  });

  it('produces finite output near (but not on) a charge core', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_field_dipole');
    // 0.05 from the +charge core — close enough to exercise the eps-softened
    // 1/r³ branch but not so close that ULP noise dominates.
    const pts = [[0.25 + 0.05, 0.05], [-0.25 - 0.05, -0.05]] as const;
    const out = await dispatchKernel('var_field_dipole', fnBody, pts, '1.0, 0.5, 0.2, 0.0');
    for (let i = 0; i < pts.length * 2; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }
  });
});

describe('V265 magnetic_pendulum', () => {
  it('matches expected math (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_magnetic_pendulum_pos');
    const pts = [
      [0.0, 0.0],
      [0.5, 0.3],
      [-0.7, 0.8],
      [1.2, -0.5],
    ] as const;
    // 3 magnets, radius 1.0, strength 0.5, damping 0.1 — the catalog defaults.
    const out = await dispatchKernel('var_magnetic_pendulum_pos', fnBody, pts, '3.0, 1.0, 0.5, 0.1');
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const exp = ts_var_magnetic_pendulum({
        tx: px, ty: py, weight: 1.0,
        params: { magnets: 3, radius: 1.0, strength: 0.5, damping: 0.1 },
      });
      expect(out[i * 2]).toBeCloseTo(exp.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(exp.y, 4);
    }
  });

  it('produces finite output with N=6 magnets', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_magnetic_pendulum_pos');
    const pts = [[0.4, 0.2], [-0.6, 0.7], [0.1, -1.0]] as const;
    const out = await dispatchKernel('var_magnetic_pendulum_pos', fnBody, pts, '6.0, 1.0, 0.5, 0.1');
    for (let i = 0; i < pts.length * 2; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }
  });

  it('clamp on `magnets` keeps N in [3,6] (out-of-range request stays bounded)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_magnetic_pendulum_pos');
    const pts = [[0.3, 0.4]] as const;
    // magnets=15.0 should clamp to 6; magnets=1.0 should clamp to 3.
    const outHigh = await dispatchKernel('var_magnetic_pendulum_pos', fnBody, pts, '15.0, 1.0, 0.5, 0.1');
    const outRefHigh = await dispatchKernel('var_magnetic_pendulum_pos', fnBody, pts, '6.0, 1.0, 0.5, 0.1');
    expect(outHigh[0]).toBeCloseTo(outRefHigh[0]!, 5);
    expect(outHigh[1]).toBeCloseTo(outRefHigh[1]!, 5);

    const outLow = await dispatchKernel('var_magnetic_pendulum_pos', fnBody, pts, '1.0, 1.0, 0.5, 0.1');
    const outRefLow = await dispatchKernel('var_magnetic_pendulum_pos', fnBody, pts, '3.0, 1.0, 0.5, 0.1');
    expect(outLow[0]).toBeCloseTo(outRefLow[0]!, 5);
    expect(outLow[1]).toBeCloseTo(outRefLow[1]!, 5);
  });
});
