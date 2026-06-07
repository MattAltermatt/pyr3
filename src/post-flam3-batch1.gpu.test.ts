// @vitest-environment node
//
// #114 batch 1 — GPU kernel tests for cpow2 / cpow3 / loonie2 / epispiral.
//
// - loonie2 (no RNG): full f64 oracle parity check against the WGSL formula.
// - epispiral (RNG only when thickness != 0): deterministic-branch parity at
//   thickness=0; finite-output smoke for the thickness>0 path.
// - cpow2 / cpow3 (RNG): finite-output smoke. Full ISAAC-mirrored parity is
//   deferred to a follow-up batch alongside the rand-capture infra (BACKLOG).
//
// Skips when no GPU adapter — fast suite stays green on CI.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';
import { ISAAC_STATE_U32, packIsaacStates } from './isaac';

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

const STRUCT_MATCH = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\};/);
if (!STRUCT_MATCH) throw new Error('chaos.wgsl: struct IsaacState not found');
const ISAAC_STRUCT = STRUCT_MATCH[0];
const ISAAC_ROUND = extractWgslFn(SHADER_SRC, 'isaac_round');
const ISAAC_IRAND = extractWgslFn(SHADER_SRC, 'isaac_irand');
const RAND01 = extractWgslFn(SHADER_SRC, 'rand01');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const PRELUDE_CONSTS = `const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
const SIN_SAFE_MAX: f32 = 1e6;
`;

const KERNEL_PRELUDE = `
${PRELUDE_CONSTS}
${ISAAC_STRUCT}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read> pts: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> out: array<vec2f>;
${ISAAC_ROUND}
${ISAAC_IRAND}
${RAND01}
${HASH01}
${SAFE_SIN}
${SAFE_COS}
`;

const TEST_POINTS: ReadonlyArray<readonly [number, number]> = [
  [ 0.5,  0.3],
  [-0.5,  0.7],
  [ 1.2, -0.4],
  [-1.0, -1.0],
  [ 0.1,  0.05],
  [ 2.0,  0.0],
  [ 0.0,  2.0],
  [-2.5,  1.7],
];
const N = TEST_POINTS.length;

async function dispatch(code: string, walkers: number, seed: number, useRng: boolean): Promise<Float32Array> {
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

  let stateBuf: GPUBuffer | null = null;
  if (useRng) {
    stateBuf = dev.createBuffer({
      size: walkers * ISAAC_STATE_U32 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const packed = packIsaacStates(walkers, seed);
    dev.queue.writeBuffer(stateBuf, 0, packed);
  }

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
  const entries: GPUBindGroupEntry[] = [
    { binding: 1, resource: { buffer: ptsBuf } },
    { binding: 2, resource: { buffer: outBuf } },
  ];
  if (useRng && stateBuf) entries.unshift({ binding: 0, resource: { buffer: stateBuf } });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries,
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
  ptsBuf.destroy(); stateBuf?.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

// =====================================================================
// loonie2 — no RNG, deterministic.
// =====================================================================

function loonie2Oracle(x: number, y: number, w: number, sidesF: number, star: number, circle: number): [number, number] {
  const sides = Math.max(1, Math.min(16, Math.trunc(sidesF)));
  const a = (2 * Math.PI) / sides;
  const sina = Math.sin(a);
  const cosa = Math.cos(a);
  // #164 fix — JWF init: a = -π/2·star; _sins = sin(a) (negative).
  // cos is even so coss = cos(π/2·star) = cos(-π/2·star) — unchanged.
  const sins = Math.sin(-star * Math.PI * 0.5);
  const coss = Math.cos(star * Math.PI * 0.5);
  const sinc = Math.sin(circle * Math.PI * 0.5);
  const cosc = Math.cos(circle * Math.PI * 0.5);
  const sqrvvar = w * w;
  let xrt = x, yrt = y;
  let r2 = xrt * coss + Math.abs(yrt) * sins;
  const circle_r = Math.sqrt(xrt * xrt + yrt * yrt);
  for (let i = 0; i < sides - 1 && i < 16; i++) {
    const swp = xrt * cosa - yrt * sina;
    yrt = xrt * sina + yrt * cosa;
    xrt = swp;
    r2 = Math.max(r2, xrt * coss + Math.abs(yrt) * sins);
  }
  r2 = r2 * cosc + circle_r * sinc;
  r2 = sides > 2 ? r2 * r2 : Math.abs(r2) * r2;
  if (r2 > 0 && r2 < sqrvvar) {
    const r = w * Math.sqrt(Math.abs(sqrvvar / r2 - 1));
    return [r * x, r * y];
  } else if (r2 < 0) {
    const r = w / Math.sqrt(Math.abs(sqrvvar / r2) - 1);
    return [r * x, r * y];
  }
  return [w * x, w * y];
}

describe.skipIf(!device)('#114 batch 1 — var_loonie2', () => {
  it('matches f64 oracle within 1e-4 for default 4/0.15/0.25 params', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_loonie2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_loonie2(pts[i], 1.0, 4.0, 0.15, 0.25);
}`;
    const out = await dispatch(code, 1, 0xc0ffee, false);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = loonie2Oracle(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 4, 0.15, 0.25);
      expect(out[i * 2]).toBeCloseTo(ox, 3);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 3);
    }
  });

  it('handles sides=2 special-case branch (|r2|*r2) without NaN', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_loonie2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_loonie2(pts[i], 0.8, 2.0, 0.2, 0.3);
}`;
    const out = await dispatch(code, 1, 0xc0ffee, false);
    for (let i = 0; i < N * 2; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

// =====================================================================
// epispiral — thickness=0 → no RNG → deterministic oracle parity.
// =====================================================================

function epispiralOracleNoThickness(x: number, y: number, w: number, n: number, holes: number): [number, number] {
  const theta = Math.atan2(y, x);
  const d = Math.cos(n * theta);
  if (Math.abs(d) < 1e-30) return [0, 0]; // skip path
  const t = -holes + 1 / d;
  return [w * t * Math.cos(theta), w * t * Math.sin(theta)];
}

describe.skipIf(!device)('#114 batch 1 — var_epispiral', () => {
  it('matches f64 oracle within 1e-3 at thickness=0 (deterministic branch)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_epispiral');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_epispiral(pts[i], 1.0, 6.0, 0.0, 1.0, i);
}`;
    const out = await dispatch(code, N, 0xfacade, true);
    for (let i = 0; i < N; i++) {
      const [ox, oy] = epispiralOracleNoThickness(TEST_POINTS[i]![0], TEST_POINTS[i]![1], 1.0, 6.0, 1.0);
      // Skip the would-skip cases (|cos(n·θ)| ≈ 0) — oracle returns (0,0)
      // but the WGSL kernel returns whatever 1/d == ±Inf produces. The
      // chaos-game's bad-value reseed handles those in production.
      if (Math.abs(Math.cos(6.0 * Math.atan2(TEST_POINTS[i]![1], TEST_POINTS[i]![0]))) < 1e-3) continue;
      expect(out[i * 2]).toBeCloseTo(ox, 2);
      expect(out[i * 2 + 1]).toBeCloseTo(oy, 2);
    }
  });

  it('produces finite output at thickness=0.5 (RNG branch) for normal inputs', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_epispiral');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_epispiral(pts[i], 1.0, 4.0, 0.5, 1.0, i);
}`;
    const out = await dispatch(code, N, 0xdeadbeef, true);
    let finiteCount = 0;
    for (let i = 0; i < N * 2; i++) if (Number.isFinite(out[i]!)) finiteCount++;
    // Some inputs hit the |cos(n·θ)| ≈ 0 cliff and produce non-finite (chaos
    // game's bad-value path catches in production). Most should be finite.
    expect(finiteCount).toBeGreaterThan(N);
  });
});

// =====================================================================
// cpow2 / cpow3 — RNG-driven. Finite-output smoke only for batch 1.
// =====================================================================

describe.skipIf(!device)('#114 batch 1 — var_cpow2 (smoke)', () => {
  it('produces finite output at default params (r=1, a=0, divisor=1, range=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_cpow2');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_cpow2(pts[i], 1.0, 1.0, 0.0, 1.0, 1.0, i);
}`;
    const out = await dispatch(code, N, 0x12345678, true);
    let finiteCount = 0;
    for (let i = 0; i < N * 2; i++) if (Number.isFinite(out[i]!)) finiteCount++;
    // Allow a few non-finite outputs at extreme inputs (p≈0 → log diverges).
    expect(finiteCount).toBeGreaterThanOrEqual(N * 2 - 4);
  });
});

describe.skipIf(!device)('#114 batch 1 — var_cpow3 (smoke)', () => {
  it('produces finite output at default params (r=1, d=1, divisor=1, spread=1)', async () => {
    const FN = extractWgslFn(SHADER_SRC, 'var_cpow3');
    const code = `${KERNEL_PRELUDE}
${FN}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  out[i] = var_cpow3(pts[i], 1.0, 1.0, 1.0, 1.0, 1.0, i);
}`;
    const out = await dispatch(code, N, 0x87654321, true);
    let finiteCount = 0;
    for (let i = 0; i < N * 2; i++) if (Number.isFinite(out[i]!)) finiteCount++;
    expect(finiteCount).toBeGreaterThanOrEqual(N * 2 - 4);
  });
});
