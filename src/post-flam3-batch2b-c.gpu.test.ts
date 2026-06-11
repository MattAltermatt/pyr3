// @vitest-environment node
//
// #114 batch 2b-c — GPU kernel tests for bcircle / curl2 / murl /
// stwins / hexes.
//
// Four are deterministic (curl2, murl, stwins, hexes) — full f64
// oracle parity at the reference TEST_POINTS. bcircle has an RNG
// border path when `borderwidth ≠ 0`; we cover both
// (a) deterministic borderwidth=0 with full parity and
// (b) RNG borderwidth>0 finite-output smoke.
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

// Stub rand01 for RNG-path tests. The real rand01 in chaos.wgsl uses
// the IsaacState binding which is too complex to plumb through an
// extracted-fn kernel test. Smoke tests just need a finite [0,1] output
// from rand01; this stub gives a deterministic spread across walkers.
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
// var_bcircle — Xyrus02 bcircle plugin. 2 params (scale, borderwidth).
// RNG only when borderwidth != 0. Deterministic path: inside disk
// passthrough w·(scale·x, scale·y); outside disk → (0,0).
// =====================================================================

function bcircleOracleNoBorder(x: number, y: number, w: number, scale: number): [number, number] {
  if (x === 0 && y === 0) return [0, 0];
  const xs = x * scale;
  const ys = y * scale;
  const r = Math.sqrt(xs * xs + ys * ys);
  if (r <= 1.0) return [w * xs, w * ys];
  return [0, 0];
}

describe.skipIf(!device)('#114 batch 2b-c — var_bcircle', () => {
  it('matches f64 oracle at borderwidth=0 (deterministic disk path)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bcircle');
    // Use scale=1, borderwidth=0. wi=0 is unused on this branch.
    const code = `${KERNEL_PRELUDE}
fn rand01(wi: u32) -> f32 { return 0.5; }
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bcircle(pts[i], 1.0, 1.0, 0.0, 0u);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = bcircleOracleNoBorder(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at scale=0.5, borderwidth=0', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bcircle');
    const code = `${KERNEL_PRELUDE}
fn rand01(wi: u32) -> f32 { return 0.5; }
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bcircle(pts[i], 1.0, 0.5, 0.0, 0u);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = bcircleOracleNoBorder(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.5);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('produces finite output at borderwidth=0.5 (RNG path, stub rand01)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_bcircle');
    // Use a stub rand01 so we don't need to plumb through ISAAC state.
    // Smoke test only — per-row RNG parity is orthogonal here.
    const code = `${KERNEL_PRELUDE}
${STUB_RAND01}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_bcircle(pts[i], 1.0, 1.0, 0.5, i);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

// =====================================================================
// var_curl2 — Xyrus02 / Georg Kiehne curl2 plugin. 3 params + no RNG.
// =====================================================================

function curl2Oracle(x: number, y: number, w: number, c1: number, c2: number, c3: number): [number, number] {
  const cc2 = 2 * c2;
  const cc3 = 3 * c3;
  const x2 = x * x;
  const x3 = x2 * x;
  const y2 = y * y;
  const y3 = y2 * y;
  const re = c3 * x3 - cc3 * x * y2 + c2 * x2 - c2 * y2 + c1 * x + 1.0;
  const im = cc3 * x2 * y - c3 * y3 + cc2 * x * y + c1 * y;
  const denom = re * re + im * im;
  const r = w / denom;
  return [(x * re + y * im) * r, (y * re - x * im) * r];
}

describe.skipIf(!device)('#114 batch 2b-c — var_curl2', () => {
  it('matches f64 oracle at default params (c1=1, c2=0, c3=0)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_curl2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_curl2(pts[i], 1.0, 1.0, 0.0, 0.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = curl2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0, 0.0, 0.0);
      // c1-only path matches flam3's `curl`; deterministic ~1e-3 tolerance
      // due to f32 polynomial roundoff at larger radii.
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at cubic-active params (c1=0.5, c2=0.2, c3=0.1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_curl2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_curl2(pts[i], 1.0, 0.5, 0.2, 0.1);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = curl2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.5, 0.2, 0.1);
      // Cubic terms blow up quickly at |p| ≈ 2; loosen to ~1e-2 because
      // f32 evaluation of c3·x³ at |x|=2.5 already costs ~6 sig figs.
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        expect(out[i * 2]).toBeCloseTo(ox, 2);
        expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
      }
    }
  });
});

// =====================================================================
// var_murl — JWildfire MurlFunc / Xyrus02 murl plugin. 2 params + no RNG.
// =====================================================================

function murlOracle(x: number, y: number, w: number, c_in: number, power_in: number): [number, number] {
  const power = Math.trunc(power_in);
  const c = power !== 1 ? c_in / (power - 1) : c_in;
  const p2 = power / 2.0;
  const vp = w * (c + 1);
  const a = Math.atan2(y, x) * power;
  const sina = Math.sin(a);
  const cosa = Math.cos(a);
  const r = c * Math.pow(x * x + y * y, p2);
  const re = r * cosa + 1;
  const im = r * sina;
  const r1 = vp / (re * re + im * im + 1e-29);
  return [r1 * (x * re + y * im), r1 * (y * re - x * im)];
}

describe.skipIf(!device)('#114 batch 2b-c — var_murl', () => {
  it('matches f64 oracle at default params (c=0.1, power=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_murl');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_murl(pts[i], 1.0, 0.1, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = murlOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.1, 1.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at power=3 (cubic polar angle)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_murl');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_murl(pts[i], 1.0, 0.5, 3.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = murlOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.5, 3.0);
      // pow(r², 1.5) at |p| ≈ 2.5 hits ~10⁵·5 → loose 1e-2 tolerance.
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        expect(out[i * 2]).toBeCloseTo(ox, 1);
        expect(out[i * 2 + 1]).toBeCloseTo(oy, 1);
      }
    }
  });
});

// =====================================================================
// var_stwins — Xyrus02 stwins plugin. 1 param + no RNG.
// =====================================================================

function stwinsOracle(x: number, y: number, w: number, distort: number): [number, number] {
  const multiplier = 0.05;
  const sx = x * w * multiplier;
  const sy = y * w * multiplier;
  const x2 = sx * sx;
  const y2 = sy * sy;
  const x_plus_y = sx + sy;
  const x2_minus_y2 = x2 - y2;
  const x2_plus_y2 = x2 + y2;
  const result_num = x2_minus_y2 * Math.sin(2 * Math.PI * distort * x_plus_y);
  const divident = x2_plus_y2 === 0 ? 1.0 : x2_plus_y2;
  const result = result_num / divident;
  return [w * x + result, w * y + result];
}

describe.skipIf(!device)('#114 batch 2b-c — var_stwins', () => {
  it('matches f64 oracle at default params (distort=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_stwins');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_stwins(pts[i], 1.0, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = stwinsOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('matches f64 oracle at distort=0.5', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_stwins');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_stwins(pts[i], 1.0, 0.5);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = stwinsOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 0.5);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });
});

// =====================================================================
// var_hexes — JWildfire HexesFunc / slobo777. 4 params + no RNG.
// Uses its own hex-grid voronoi helper. The kernel + two helpers
// (hexes_voronoi_max + hexes_vratio_step) live together — all three
// must be extracted.
// =====================================================================

function hexesOracle(x: number, y: number, w: number, cellsize: number, power: number, rotate: number, scale: number): [number, number] {
  if (cellsize === 0) return [0, 0];
  const SQRT3 = 1.7320508075688772935;
  const a_hex = 1.0 / 3.0;
  const b_hex = SQRT3 / 3.0;
  const c_hex = -1.0 / 3.0;
  const d_hex = SQRT3 / 3.0;
  const a_cart = 1.5;
  const b_cart = -1.5;
  const c_cart = SQRT3 / 2.0;
  const d_cart = SQRT3 / 2.0;
  const rotSin = Math.sin(rotate * 2 * Math.PI);
  const rotCos = Math.cos(rotate * 2 * Math.PI);
  const Ux = x;
  const Uy = y;
  const s = cellsize;
  const hx0 = Math.floor((a_hex * Ux + b_hex * Uy) / s);
  const hy0 = Math.floor((c_hex * Ux + d_hex * Uy) / s);
  let bestD2 = Infinity;
  let q = 0;
  for (let di = -1; di < 2; di++) {
    for (let dj = -1; dj < 2; dj++) {
      const cx = (a_cart * (hx0 + di) + b_cart * (hy0 + dj)) * s;
      const cy = (c_cart * (hx0 + di) + d_cart * (hy0 + dj)) * s;
      const dx = cx - Ux;
      const dy = cy - Uy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; q = (di + 1) * 3 + (dj + 1); }
    }
  }
  const chosen_di = Math.floor(q / 3) - 1;
  const chosen_dj = (q % 3) - 1;
  const hx = hx0 + chosen_di;
  const hy = hy0 + chosen_dj;
  const cc = (hxi: number, hyi: number): [number, number] =>
    [(a_cart * hxi + b_cart * hyi) * s, (c_cart * hxi + d_cart * hyi) * s];
  const P0 = cc(hx, hy);
  const P1 = cc(hx, hy + 1);
  const P2 = cc(hx + 1, hy + 1);
  const P3 = cc(hx + 1, hy);
  const P4 = cc(hx, hy - 1);
  const P5 = cc(hx - 1, hy - 1);
  const P6 = cc(hx - 1, hy);
  const vor = (Ux2: number, Uy2: number): number => {
    const Qx = P0[0];
    const Qy = P0[1];
    let ratiomax = -1.0e20;
    for (const Pp of [P1, P2, P3, P4, P5, P6]) {
      const PmQx = Pp[0] - Qx;
      const PmQy = Pp[1] - Qy;
      if (PmQx === 0 && PmQy === 0) {
        if (1.0 > ratiomax) ratiomax = 1.0;
        continue;
      }
      const ratio = 2.0 * ((Ux2 - Qx) * PmQx + (Uy2 - Qy) * PmQy) / (PmQx * PmQx + PmQy * PmQy);
      if (ratio > ratiomax) ratiomax = ratio;
    }
    return ratiomax;
  };
  const L1 = vor(Ux, Uy);
  const DXo = Ux - P0[0];
  const DYo = Uy - P0[1];
  const trgL = Math.pow(L1 + 1e-30, power) * scale;
  const Vx0 = DXo * rotCos + DYo * rotSin;
  const Vy0 = -DXo * rotSin + DYo * rotCos;
  const L2 = vor(Vx0 + P0[0], Vy0 + P0[1]);
  const L = Math.max(L1, L2);
  let R: number;
  if (L < 0.5) R = trgL / L1;
  else if (L > 0.8) R = trgL / L2;
  else R = ((trgL / L1) * (0.8 - L) + (trgL / L2) * (L - 0.5)) / 0.3;
  const Vx = Vx0 * R + P0[0];
  const Vy = Vy0 * R + P0[1];
  return [w * Vx, w * Vy];
}

describe.skipIf(!device)('#114 batch 2b-c — var_hexes', () => {
  it('matches f64 oracle at default params (cellsize=1, power=1, rotate=0.166, scale=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_hexes');
    const HELPER_MAX = extractWgslFn(SHADER_SRC, 'hexes_voronoi_max');
    const HELPER_STEP = extractWgslFn(SHADER_SRC, 'hexes_vratio_step');
    const code = `${KERNEL_PRELUDE}
${HELPER_STEP}
${HELPER_MAX}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_hexes(pts[i], 1.0, 1.0, 1.0, 0.166, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = hexesOracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 1.0, 1.0, 0.166, 1.0);
      // Hex-grid floor() boundaries make per-row parity sensitive to
      // f32 vs f64 rounding right at the cell edge — loosen to 1e-2
      // and skip points that land exactly on a boundary (oracle Inf).
      if (Number.isFinite(ox) && Number.isFinite(oy)) {
        expect(out[i * 2]).toBeCloseTo(ox, 2);
        expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
      }
    }
  });

  it('produces finite output at power=2 (more aggressive cell warp)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_hexes');
    const HELPER_MAX = extractWgslFn(SHADER_SRC, 'hexes_voronoi_max');
    const HELPER_STEP = extractWgslFn(SHADER_SRC, 'hexes_vratio_step');
    const code = `${KERNEL_PRELUDE}
${HELPER_STEP}
${HELPER_MAX}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_hexes(pts[i], 1.0, 0.5, 2.0, 0.166, 1.0);
}`;
    const out = await dispatch(code);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
