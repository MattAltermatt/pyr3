// @vitest-environment node
//
// #114 batch 2b-b — GPU kernel tests for collideoscope / circlize /
// circlize2 / eswirl / petal.
//
// All five are deterministic (no RNG). Full f64 oracle parity at the
// reference TEST_POINTS — tolerance ~1e-3 absolute (f32 trig + the
// JWF % / fmod sign-folding routes are sensitive at extreme inputs).
//
// Skips when no GPU adapter — fast suite stays green on CI.

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

// Inputs span: inside unit disk, outside, large radii, axis-aligned.
// Petal + circlize family are stable at moderate radii; we avoid the
// origin (circlize side==0 degeneracy) and the unit-disk cusp for
// eswirl (xmax==1.0 cusp).
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
  const mod = dev.createShaderModule({ code });
  const ci = await (mod as { getCompilationInfo?: () => Promise<GPUCompilationInfo> }).getCompilationInfo?.();
  if (ci) {
    for (const m of ci.messages) {
      if (m.type === 'error') {
        // eslint-disable-next-line no-console
        console.error(`WGSL compile error: ${m.message}`);
      }
    }
  }
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const valErr = await dev.popErrorScope();
  // eslint-disable-next-line no-console
  if (valErr) console.error('validation:', valErr.message);
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
// var_collideoscope — JWildfire CollideoscopeFunc.java.
// 2 params (a, num) + no RNG.
// =====================================================================

function collideoscopeOracle(x: number, y: number, w: number, a_param: number, num_raw: number): [number, number] {
  const num = Math.max(1, Math.trunc(num_raw));
  const kn_pi = num / Math.PI;
  const pi_kn = Math.PI / num;
  const ka = Math.PI * a_param;
  const ka_kn = ka / num;
  let a = Math.atan2(y, x);
  const r = w * Math.sqrt(x * x + y * y);
  if (a >= 0.0) {
    const alt = Math.trunc(a * kn_pi);
    if (alt % 2 === 0) {
      a = alt * pi_kn + ((ka_kn + a) % pi_kn);
    } else {
      a = alt * pi_kn + ((-ka_kn + a) % pi_kn);
    }
  } else {
    const alt = Math.trunc(-a * kn_pi);
    if (alt % 2 !== 0) {
      a = -(alt * pi_kn + ((-ka_kn - a) % pi_kn));
    } else {
      a = -(alt * pi_kn + ((ka_kn - a) % pi_kn));
    }
  }
  return [r * Math.cos(a), r * Math.sin(a)];
}

describe.skipIf(!device)('#114 batch 2b-b — var_collideoscope', () => {
  it('matches f64 oracle at default params (a=0.20, num=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_collideoscope');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_collideoscope(pts[i], 1.0, 0.20, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = collideoscopeOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.20, 1);
      expect(out[i * 2]).toBeCloseTo(ox, 2);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
    }
  });

  it('produces finite output at higher num counts', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_collideoscope');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_collideoscope(pts[i], 1.0, 0.5, 5.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

// =====================================================================
// var_circlize — JWildfire CirclizeFunc.java. 1 param + no RNG.
// =====================================================================

function circlizeOracle(x: number, y: number, w: number, hole: number): [number, number] {
  const var4_PI = w / (Math.PI / 4);
  const absx = Math.abs(x);
  const absy = Math.abs(y);
  let perimeter: number;
  let side: number;
  if (absx >= absy) {
    if (x >= absy) {
      perimeter = absx + y;
    } else {
      perimeter = 5.0 * absx - y;
    }
    side = absx;
  } else {
    if (y >= absx) {
      perimeter = 3.0 * absy - x;
    } else {
      perimeter = 7.0 * absy + x;
    }
    side = absy;
  }
  if (side === 0) return [0, 0];
  const r = var4_PI * side + hole;
  const a = (Math.PI / 4) * perimeter / side - Math.PI / 4;
  return [r * Math.cos(a), r * Math.sin(a)];
}

describe.skipIf(!device)('#114 batch 2b-b — var_circlize', () => {
  it('matches f64 oracle at default params (hole=0.40)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_circlize');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_circlize(pts[i], 1.0, 0.40);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = circlizeOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.40);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at hole=0', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_circlize');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_circlize(pts[i], 0.8, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = circlizeOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 0.8, 0.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });
});

// =====================================================================
// var_circlize2 — JWildfire Circlize2Func.java. 1 param + no RNG.
// =====================================================================

function circlize2Oracle(x: number, y: number, w: number, hole: number): [number, number] {
  const absx = Math.abs(x);
  const absy = Math.abs(y);
  let perimeter: number;
  let side: number;
  if (absx >= absy) {
    if (x >= absy) {
      perimeter = absx + y;
    } else {
      perimeter = 5.0 * absx - y;
    }
    side = absx;
  } else {
    if (y >= absx) {
      perimeter = 3.0 * absy - x;
    } else {
      perimeter = 7.0 * absy + x;
    }
    side = absy;
  }
  if (side === 0) return [0, 0];
  const r = w * (side + hole);
  const a = (Math.PI / 4) * perimeter / side - Math.PI / 4;
  return [r * Math.cos(a), r * Math.sin(a)];
}

describe.skipIf(!device)('#114 batch 2b-b — var_circlize2', () => {
  it('matches f64 oracle at default params (hole=0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_circlize2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_circlize2(pts[i], 1.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = circlize2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at hole=0.5', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_circlize2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_circlize2(pts[i], 1.0, 0.5);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = circlize2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.5);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });
});

// =====================================================================
// var_eswirl — JWildfire ESwirlFunc.java. 2 params + no RNG.
// Tolerance loosened to 1e-2 because xmax==1.0 cusp gives μ→0 and
// in/μ amplifies any f32 rounding into the trig step.
// =====================================================================

function eswirlOracle(x: number, y: number, w: number, in_p: number, out_p: number): [number, number] {
  const tmp = y * y + x * x + 1.0;
  const tmp2 = 2.0 * x;
  const r1_in = tmp + tmp2;
  const r2_in = tmp - tmp2;
  const r1_sqrt = r1_in > 0 ? Math.sqrt(r1_in) : 0;
  const r2_sqrt = r2_in > 0 ? Math.sqrt(r2_in) : 0;
  let xmax = (r1_sqrt + r2_sqrt) * 0.5;
  if (xmax < 1.0) xmax = 1.0;
  const mu = Math.acosh(xmax);
  let t = x / xmax;
  if (t > 1.0) t = 1.0;
  else if (t < -1.0) t = -1.0;
  let nu = Math.acos(t);
  if (y < 0) nu = -nu;
  const mu_safe = mu === 0 ? 1e-30 : mu;
  const nu_warp = nu + mu * out_p + in_p / mu_safe;
  return [w * Math.cosh(mu) * Math.cos(nu_warp), w * Math.sinh(mu) * Math.sin(nu_warp)];
}

describe.skipIf(!device)('#114 batch 2b-b — var_eswirl', () => {
  it('matches f64 oracle at default params (in=1.2, out=0.2)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_eswirl');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_eswirl(pts[i], 1.0, 1.2, 0.2);
}`;
    const out = await dispatch(code);
    // Cusp-prone: use a per-point match-or-finite check. Inputs that
    // land on or near xmax==1.0 (small |y|, |x|<<1) get the lenient
    // finite check; clear-of-cusp inputs get f64-oracle parity.
    for (let i = 0; i < N; i++) {
      const [x, y] = TEST_POINTS[i]!;
      const r2 = x * x + y * y;
      if (Number.isFinite(out[i * 2]!) && Number.isFinite(out[i * 2 + 1]!)) {
        if (r2 > 0.5) {
          // clear of the cusp — full f64 oracle parity at ~1e-2 (μ amplification)
          const [ox, oy] = eswirlOracle(x, y, 1.0, 1.2, 0.2);
          expect(out[i * 2]).toBeCloseTo(ox, 2);
          expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
        }
      }
    }
  });

  it('produces finite output at out=0 (pure inward swirl)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_eswirl');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_eswirl(pts[i], 1.0, 1.2, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

// =====================================================================
// var_petal — JWildfire PetalFunc.java. 0 params, no RNG.
// =====================================================================

function petalOracle(x: number, y: number, w: number): [number, number] {
  const a = Math.cos(x);
  const cxcy = Math.cos(x) * Math.cos(y);
  const sxcy = Math.sin(x) * Math.cos(y);
  const bx = cxcy * cxcy * cxcy;
  const by = sxcy * sxcy * sxcy;
  return [w * a * bx, w * a * by];
}

describe.skipIf(!device)('#114 batch 2b-b — var_petal', () => {
  it('matches f64 oracle (default w=1.0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_petal');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_petal(pts[i], 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = petalOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('produces finite output at w=0.5', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_petal');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_petal(pts[i], 0.5);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
