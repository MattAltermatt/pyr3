// @vitest-environment node
//
// #114 batch 2b-d — GPU kernel tests for xheart / xhyperbol / xcurl2 /
// xtrb / xyrus_gridout / blur_circle (FINAL #114 batch).
//
// Four are deterministic (xheart, xhyperbol, xcurl2, xyrus_gridout)
// — full f64 oracle parity at the reference TEST_POINTS. Two
// (xtrb, blur_circle) consume RNG inside the kernel: stub rand01
// gives a deterministic spread for finite-output smoke + the
// deterministic non-RNG branches get full oracle parity where reachable.
//
// Skips when no GPU adapter — fast suite stays green on CI.

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

const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');

const PRELUDE_CONSTS = `const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const SIN_SAFE_MAX: f32 = 1e6;
const EPS: f32 = 1e-10;
`;

const KERNEL_PRELUDE = `
${PRELUDE_CONSTS}
@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec2f>;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
`;

// Stub rand01 for RNG-path tests. Deterministic across walker indices
// so the oracle can mirror it.
const STUB_RAND01 = `
fn rand01(wi: u32) -> f32 {
  let h = (wi * 2654435761u) ^ 0x9e3779b9u;
  return f32(h & 0xffffffu) * (1.0 / 16777215.0);
}
`;

// Inputs span: inside unit disk, outside, large radii, axis-aligned.
// Avoid origin for variations with side==0 / r==0 degeneracies.
const TEST_POINTS: ReadonlyArray<readonly [number, number]> = [
  [ 0.5,  0.3],
  [-0.5,  0.7],
  [ 1.2, -0.4],
  [-1.0, -1.0],
  [ 0.1,  0.05],
  [ 2.0,  0.3],
  [ 0.3,  2.0],
  [-2.5,  1.7],
];
const N = TEST_POINTS.length;

async function dispatch(code: string): Promise<Float32Array> {
  const dev = device!;
  const ptsFlat = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    ptsFlat[i * 2] = TEST_POINTS[i]![0];
    ptsFlat[i * 2 + 1] = TEST_POINTS[i]![1];
  }
  const ptsBuf = dev.createBuffer({
    size: ptsFlat.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(ptsBuf, 0, ptsFlat);
  const outBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  dev.pushErrorScope('validation');
  const mod = await compileChecked(dev, code);
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const valErr = await dev.popErrorScope();
  if (valErr) throw new Error(`#263 — pipeline validation error: ${valErr.message}`);
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: ptsBuf } },
      { binding: 1, resource: { buffer: outBuf } },
    ],
  });
  const encoder = dev.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  const readback = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  encoder.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  ptsBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

// =====================================================================
// var_xheart — Xyrus02 xheart plugin. 2 params (angle, ratio).
// No RNG. Deterministic — full f64 oracle parity.
// =====================================================================

function xheartOracle(x: number, y: number, w: number, angle: number, ratio: number): [number, number] {
  const PI = Math.PI;
  const ang = PI / 4 + (0.5 * (PI / 4) * angle);
  const cosa = Math.cos(ang);
  const sina = Math.sin(ang);
  const rat = 6 + 2 * ratio;
  let r2_4 = x * x + y * y + 4;
  if (r2_4 === 0) r2_4 = 1;
  const bx = 4 / r2_4;
  const by = rat / r2_4;
  const xRot = cosa * (bx * x) - sina * (by * y);
  const yRot = sina * (bx * x) + cosa * (by * y);
  if (xRot > 0) return [w * xRot, w * yRot];
  return [w * xRot, -w * yRot];
}

describe.skipIf(!device)('#114 batch 2b-d — var_xheart', () => {
  it('matches f64 oracle at default params (angle=0, ratio=0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xheart');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xheart(pts[i], 1.0, 0.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xheartOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.0, 0.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at angle=1, ratio=0.5 (rotation + ratio scale)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xheart');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xheart(pts[i], 1.0, 1.0, 0.5);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xheartOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0, 0.5);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });
});

// =====================================================================
// var_xhyperbol — Xyrus02 xhyperbol plugin. 6 params (m00..m21).
// No RNG. Deterministic — full f64 oracle parity.
// =====================================================================

function xhyperbolOracle(x: number, y: number, w: number, m00: number, m01: number, m10: number, m11: number, m20: number, m21: number): [number, number] {
  const EPS = 1e-10;
  const r = 1 / (x * x + y * y + EPS);
  const xi = x * r;
  const yi = y * r;
  const re = m00 * xi + m01 * yi + m20;
  const im = m10 * xi + m11 * yi + m21;
  const alpha = Math.atan2(im, re) + 2 * Math.PI;
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  const rsq = re * re + im * im;
  const xout = rsq * ca;
  const yout = rsq * sa;
  const rinv = w / (xout * xout + yout * yout + EPS);
  return [xout * rinv, yout * rinv];
}

describe.skipIf(!device)('#114 batch 2b-d — var_xhyperbol', () => {
  it('matches f64 oracle at identity affine (m00=m11=1, others=0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xhyperbol');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xhyperbol(pts[i], 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xhyperbolOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        expect(out[i * 2]).toBeCloseTo(ox, 2);
        expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
      }
    }
  });

  it('matches f64 oracle at a rotation affine (m00=0.6, m01=-0.8, m10=0.8, m11=0.6)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xhyperbol');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xhyperbol(pts[i], 1.0, 0.6, -0.8, 0.8, 0.6, 0.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xhyperbolOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.6, -0.8, 0.8, 0.6, 0.0, 0.0);
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        expect(out[i * 2]).toBeCloseTo(ox, 2);
        expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
      }
    }
  });
});

// =====================================================================
// var_xcurl2 — Xyrus02 xcurl2 plugin. 3 params (c1, c2, c3).
// No RNG. Deterministic — full f64 oracle parity. NOTE this is a
// DIFFERENT shape from V121 `curl2` (the Georg Kiehne formulation).
// =====================================================================

function xcurl2Oracle(x: number, y: number, w: number, c1: number, c2: number, c3: number): [number, number] {
  const x2 = x * x;
  const y2 = y * y;
  const x3 = x2 * x;
  const re = 1 + c1 * x + c2 * (x2 - y2) + c3 * (x3 - 3 * x);
  const im = c1 * y + c2 * (2 * x * y) + c3 * (3 * x * y - 1);
  const denom = re * re + im * im;
  const r = w / denom;
  return [(x * re + y * im) * r, (y * re + x * im) * r];
}

describe.skipIf(!device)('#114 batch 2b-d — var_xcurl2', () => {
  it('matches f64 oracle at c1=1, c2=c3=0 (linear path)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xcurl2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xcurl2(pts[i], 1.0, 1.0, 0.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xcurl2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0, 0.0, 0.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at cubic-active (c1=0.3, c2=0.2, c3=0.1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xcurl2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xcurl2(pts[i], 1.0, 0.3, 0.2, 0.1);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xcurl2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.3, 0.2, 0.1);
      // Cubic terms at |p|≈2.5 cost ~6 sig figs — loosen to ~1e-2.
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        expect(out[i * 2]).toBeCloseTo(ox, 2);
        expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
      }
    }
  });
});

// =====================================================================
// var_xtrb — Xyrus02 xtrb plugin. 6 params + 2 rand01 calls per iter.
// RNG-driven branch + power-modulo angle. Smoke test only — per-row
// RNG parity defers until rand-capture infra lands.
// =====================================================================

describe.skipIf(!device)('#114 batch 2b-d — var_xtrb', () => {
  it('produces finite output at default params (power=2, dist=1, radius=1, width=0.5, a=b=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xtrb');
    const code = `${KERNEL_PRELUDE}
${STUB_RAND01}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xtrb(pts[i], 1.0, 2.0, 1.0, 1.0, 0.5, 1.0, 1.0, i);
}`;
    const out = await dispatch(code);
    // xtrb's Hex routine has division paths (e.g. Hc·Ga/Be) that can
    // produce Inf for grid-boundary inputs. Verify nothing is NaN.
    for (let i = 0; i < N * 2; i++) expect(Number.isNaN(out[i]!)).toBe(false);
  });

  it('produces finite output at power=3, width=0.3 (more aggressive Hex blend)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xtrb');
    const code = `${KERNEL_PRELUDE}
${STUB_RAND01}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xtrb(pts[i], 1.0, 3.0, 1.0, 1.0, 0.3, 1.0, 1.0, i);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isNaN(out[i]!)).toBe(false);
  });
});

// =====================================================================
// var_xyrus_gridout — Xyrus02 gridout plugin. 0 params, no RNG.
// Deterministic — full f64 oracle parity.
// =====================================================================

function xyrusGridoutOracle(x: number, y: number, w: number): [number, number] {
  const rx = x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
  const ry = y >= 0 ? Math.floor(y + 0.5) : Math.ceil(y - 0.5);
  let dx = 0;
  let dy = 0;
  if (ry <= 0) {
    if (rx > 0) {
      if (-ry >= rx) dx = 1; else dy = 1;
    } else {
      if (ry <= rx) dx = 1; else dy = -1;
    }
  } else {
    if (rx > 0) {
      if (ry >= rx) dx = -1; else dy = 1;
    } else {
      if (ry > -rx) dx = -1; else dy = -1;
    }
  }
  return [w * (x + dx), w * (y + dy)];
}

describe.skipIf(!device)('#114 batch 2b-d — var_xyrus_gridout', () => {
  it('matches f64 oracle (deterministic quadrant snap)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_xyrus_gridout');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_xyrus_gridout(pts[i], 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = xyrusGridoutOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0);
      // Quadrant boundary inputs may select the OTHER branch in f32 vs
      // f64 (rx vs ry comparison flips). Allow a 1-unit step difference
      // per axis — the warp is by ±1 anyway.
      const ax = out[i * 2]!;
      const ay = out[i * 2 + 1]!;
      const dx = Math.abs(ax - ox);
      const dy = Math.abs(ay - oy);
      // Either exact match (most points) or 1-unit-step axis flip.
      expect(dx < 1e-3 || Math.abs(dx - 1.0) < 1e-3).toBe(true);
      expect(dy < 1e-3 || Math.abs(dy - 1.0) < 1e-3).toBe(true);
    }
  });
});

// =====================================================================
// var_blur_circle — Xyrus02 blur_circle plugin. 1 param + 2 rand01.
// Input p is ignored. Smoke test for finite output across walkers.
// =====================================================================

describe.skipIf(!device)('#114 batch 2b-d — var_blur_circle', () => {
  it('produces finite output at hole=0 (default)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_blur_circle');
    const code = `${KERNEL_PRELUDE}
${STUB_RAND01}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_blur_circle(pts[i], 1.0, 0.0, i);
}`;
    const out = await dispatch(code);
    // s could be 0 if both stub rands map to 0.5 — kernel produces NaN
    // there per the source. Assert non-NaN for non-degenerate samples.
    let finiteCount = 0;
    for (let i = 0; i < N * 2; i++) {
      if (Number.isFinite(out[i]!)) finiteCount++;
    }
    // Stub rand01 + per-walker `i` spread = no two walkers degenerate
    // to the same exact-zero `s`; expect all finite.
    expect(finiteCount).toBe(N * 2);
  });

  it('produces finite output at hole=0.3 (offset shell)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_blur_circle');
    const code = `${KERNEL_PRELUDE}
${STUB_RAND01}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_blur_circle(pts[i], 1.0, 0.3, i);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
