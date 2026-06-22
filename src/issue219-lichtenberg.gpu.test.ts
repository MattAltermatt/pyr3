// @vitest-environment node
//
// #219 — lichtenberg (V314). Stateless ridge-attraction filament warp. The
// TS↔WGSL bit-identical guard below mirrors the periodic value-noise + Newton
// step (Math.imul/>>>0 unsigned hash discipline, incl. negative lattice cells).
// Harness mirrors src/issue132-exotic.gpu.test.ts (explicit bind-group layout —
// layout:'auto' would strip the unused binding to all-zero; await compileChecked
// surfaces WGSL compile errors that would otherwise silently no-op the smoke).
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const VCORNER = extractWgslFn(SHADER_SRC, 'vnoise_corner');
const LWRAP = extractWgslFn(SHADER_SRC, 'lich_wrap');
const VNOISEP = extractWgslFn(SHADER_SRC, 'value_noise2_periodic');
const LFIELD = extractWgslFn(SHADER_SRC, 'lich_field');

// Module consts don't survive extractWgslFn — redeclare them in the prelude.
const PRELUDE = `
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
const LICH_MAX_STEP: f32 = 2.0;
const LICH_H: f32 = 1.0e-2;
const LICH_R_EPS: f32 = 1.0e-4;
const LICH_G_EPS: f32 = 1.0e-3;
${HASH01}
${VCORNER}
${LWRAP}
${VNOISEP}
${LFIELD}
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

// ── JS oracle (mirrors the WGSL exactly) ──
const jsHash01 = (n: number) => { let h = n >>> 0; h = (h ^ (h >>> 17)) >>> 0; h = Math.imul(h, 0xed5ad4bb) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = Math.imul(h, 0xac4c1b51) >>> 0; h = (h ^ (h >>> 15)) >>> 0; return h / 4294967296; };
const jsCorner = (ix: number, iy: number) => { const ux = Math.imul(ix >>> 0, 0x9e3779b1) >>> 0; const uy = Math.imul(iy >>> 0, 0x85ebca77) >>> 0; return jsHash01((ux ^ uy) >>> 0) * 2 - 1; };
const jsWrap = (i: number, period: number) => { const m = i % period; return m < 0 ? m + period : m; };
const jsVnP = (px: number, py: number, period: number) => {
  const fx = Math.floor(px), fy = Math.floor(py);
  const ix = fx | 0, iy = fy | 0;
  const tx = px - fx, ty = py - fy;
  const ux = tx*tx*(3-2*tx), uy = ty*ty*(3-2*ty);
  const ix0 = jsWrap(ix, period), ix1 = jsWrap(ix + 1, period);
  const c00 = jsCorner(ix0, iy), c10 = jsCorner(ix1, iy);
  const c01 = jsCorner(ix0, iy+1), c11 = jsCorner(ix1, iy+1);
  const bottom = c00 + (c10-c00)*ux, top = c01 + (c11-c01)*ux;
  return bottom + (top-bottom)*uy;
};
const TAU = 6.28318530717958647692;
function jsField(x: number, y: number, freq: number, branches: number, radial: number, octaves: number) {
  const r = Math.hypot(x, y);
  const ang = Math.atan2(y, x) / TAU;
  const uP = (ang + 0.5) * branches, vP = r * freq;
  const uI = x * freq, vI = y * freq;
  let u = uI + (uP - uI) * radial, v = vI + (vP - vI) * radial;
  let period = Math.max(Math.round(branches), 1);
  let sum = 0, amp = 1, tot = 0;
  for (let k = 0; k < octaves; k++) {
    sum += amp * jsVnP(u, v, period);
    tot += amp; amp *= 0.5; u *= 2; v *= 2; period *= 2;
  }
  return sum / tot;
}
function jsLich(x: number, y: number, freqIn: number, branchesIn: number, radialIn: number, detailIn: number, strengthIn: number): [number, number] {
  const freq = Math.max(freqIn, 1e-3);
  const branches = Math.min(Math.max(Math.round(branchesIn), 1), 16);
  const radial = Math.min(Math.max(radialIn, 0), 1);
  const octaves = Math.min(Math.max(Math.round(detailIn), 1), 4);
  const strength = Math.max(strengthIn, 0);
  if (Math.hypot(x, y) < 1e-4) return [x, y];
  const H = 1e-2;
  const f0 = jsField(x, y, freq, branches, radial, octaves);
  const fxp = jsField(x+H, y, freq, branches, radial, octaves);
  const fxm = jsField(x-H, y, freq, branches, radial, octaves);
  const fyp = jsField(x, y+H, freq, branches, radial, octaves);
  const fym = jsField(x, y-H, freq, branches, radial, octaves);
  const gx = (fxp - fxm) / (2*H), gy = (fyp - fym) / (2*H);
  const g2 = Math.max(gx*gx + gy*gy, 1e-3);
  let sx = -(f0 / g2) * gx, sy = -(f0 / g2) * gy;
  const slen = Math.hypot(sx, sy);
  if (slen > 2.0) { sx *= 2.0/slen; sy *= 2.0/slen; }
  return [x + strength*sx, y + strength*sy];
}

const P = '1.5, 5.0, 0.8, 3.0, 0.5';   // freq, branches, radial, detail, strength

describe('V314 lichtenberg', () => {
  it('matches the periodic value-noise Newton oracle (TS↔WGSL, incl. negative cells)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_lichtenberg');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [-1.2, -0.9], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_lichtenberg', fnBody, pts, P);
    for (let i = 0; i < pts.length; i++) {
      const e = jsLich(pts[i]![0], pts[i]![1], 1.5, 5.0, 0.8, 3.0, 0.5);
      expect(out[i*2]).toBeCloseTo(e[0], 3);
      expect(out[i*2+1]).toBeCloseTo(e[1], 3);
    }
  });

  it('strength=0 is the identity', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_lichtenberg');
    const pts = [[0.5, 0.3], [-0.7, 0.4]] as const;
    const out = await dispatchKernel('var_lichtenberg', fnBody, pts, '1.5, 5.0, 0.8, 3.0, 0.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 5);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 5);
    }
  });

  it('deterministic + bounded displacement (<= strength*MAX_STEP)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_lichtenberg');
    const pts: Array<[number, number]> = [];
    for (let a = 0; a < 6.2; a += 0.4) pts.push([Math.cos(a) * 1.3, Math.sin(a) * 1.3]);
    const out1 = await dispatchKernel('var_lichtenberg', fnBody, pts, P);
    const out2 = await dispatchKernel('var_lichtenberg', fnBody, pts, P);
    const bound = 0.5 * 2.0 + 1e-3;   // strength*MAX_STEP + slack
    for (let i = 0; i < pts.length; i++) {
      expect(out1[i*2]).toBeCloseTo(out2[i*2]!, 6);   // determinism
      const dlen = Math.hypot(out1[i*2]! - pts[i]![0], out1[i*2+1]! - pts[i]![1]);
      expect(dlen).toBeLessThanOrEqual(bound);
      expect(Number.isFinite(out1[i*2]!)).toBe(true);
      expect(Number.isFinite(out1[i*2+1]!)).toBe(true);
    }
  });

  it('finite at the origin (R_EPS guard)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_lichtenberg');
    const out = await dispatchKernel('var_lichtenberg', fnBody, [[0.0, 0.0]], P);
    expect(out[0]).toBeCloseTo(0.0, 6);
    expect(out[1]).toBeCloseTo(0.0, 6);
  });
});
