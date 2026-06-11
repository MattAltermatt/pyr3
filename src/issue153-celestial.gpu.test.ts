// @vitest-environment node
//
// #153 — Celestial-mechanics warps (V299–V301): kepler_orbit, restricted_3body,
// hill_epicyclic. kepler/hill route trig through safe_*; restricted_3body is
// algebraic with eps-softened wells + a hard step clamp. Cross-checked against
// inline f64 oracles + the spec's identities (e=0 circle, step cap, linearity).
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
  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  return res;
}

function jsKepler(x: number, y: number, e: number, scale: number): [number, number] {
  const M = Math.atan2(y, x); const a = scale * (Math.hypot(x, y) + 1e-6); let E = M;
  for (let k = 0; k < 2; k++) E = E - (E - e * Math.sin(E) - M) / Math.max(1 - e * Math.cos(E), 0.05);
  const b = Math.sqrt(Math.max(1 - e * e, 0));
  return [a * (Math.cos(E) - e), a * b * Math.sin(E)];
}
function js3body(x: number, y: number, mu: number, step: number, coriolis: number): [number, number] {
  const p1x = -mu, p2x = 1 - mu; const r1x = x - p1x, r1y = y, r2x = x - p2x, r2y = y;
  const d1 = Math.pow(r1x*r1x + r1y*r1y + 1e-3, 1.5); const d2 = Math.pow(r2x*r2x + r2y*r2y + 1e-3, 1.5);
  const gx = x - (1-mu)*(r1x/d1) - mu*(r2x/d2); const gy = y - (1-mu)*(r1y/d1) - mu*(r2y/d2);
  const gcx = -gy, gcy = gx; let dx = step*(gx + coriolis*gcx), dy = step*(gy + coriolis*gcy);
  const dl = Math.hypot(dx, dy), cap = 2.0; if (dl > cap) { dx *= cap/dl; dy *= cap/dl; }
  return [x + dx, y + dy];
}
function jsHill(x: number, y: number, kappa: number, phase: number, shear: number): [number, number] {
  const k = Math.min(Math.max(kappa, 0.2), 2.0); const phi = phase*k; const cf = Math.cos(phi), sf = Math.sin(phi);
  return [x*cf - (sf/k)*y, (2*k)*sf*x + y*cf + shear*x];
}

describe('V299 kepler_orbit', () => {
  it('e=0 degenerates to the circle scale·p', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_kepler_orbit');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_kepler_orbit', fnBody, pts, '0.0, 1.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 4);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 4);
    }
  });
  it('matches Kepler-solve oracle + perihelion focus', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_kepler_orbit');
    const pts = [[0.5, 0], [0.4, 0.6], [-0.8, 0.2]] as const;
    const out = await dispatchKernel('var_kepler_orbit', fnBody, pts, '0.5, 0.6');
    for (let i = 0; i < pts.length; i++) {
      const e = jsKepler(pts[i]![0], pts[i]![1], 0.5, 0.6);
      expect(out[i*2]).toBeCloseTo(e[0], 3);
      expect(out[i*2+1]).toBeCloseTo(e[1], 3);
    }
    // perihelion at M=0: x = a(1-e) = 0.6·0.5·0.5 = 0.15, y≈0
    expect(out[0]).toBeCloseTo(0.15, 3);
    expect(Math.abs(out[1]!)).toBeLessThan(1e-3);
  });
});

describe('V300 restricted_3body', () => {
  it('coriolis=0 matches pure-gradient oracle', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_restricted_3body');
    const pts = [[0.5, 0.3], [-0.4, 0.5], [0.2, -0.6]] as const;
    const out = await dispatchKernel('var_restricted_3body', fnBody, pts, '0.2, 0.15, 0.0');
    for (let i = 0; i < pts.length; i++) {
      const e = js3body(pts[i]![0], pts[i]![1], 0.2, 0.15, 0.0);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
    }
  });
  it('step cap bounds displacement; finite at a primary', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_restricted_3body');
    // p exactly on primary 2 = (1-mu, 0) = (0.8, 0)
    const out = await dispatchKernel('var_restricted_3body', fnBody, [[0.8, 0.0], [0.5, 0.3]], '0.2, 0.15, 0.4');
    for (let i = 0; i < 4; i++) expect(Number.isFinite(out[i]!)).toBe(true);
    const d = Math.hypot(out[2]! - 0.5, out[3]! - 0.3);
    expect(d).toBeLessThanOrEqual(0.15 * 2.0 + 1e-4);   // step·cap
  });
});

describe('V301 hill_epicyclic', () => {
  it('phase=0 is identity-plus-shear', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_hill_epicyclic');
    const shear = 0.5;
    const pts = [[0.5, 0.3], [-0.7, 0.4]] as const;
    const out = await dispatchKernel('var_hill_epicyclic', fnBody, pts, `1.0, 0.0, ${shear}`);
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 5);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1] + shear * pts[i]![0], 5);
    }
  });
  it('matches linear oracle + linearity var(2p)=2·var(p)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_hill_epicyclic');
    const pts = [[0.5, 0.3], [1.0, 0.6]] as const;   // second = 2× first
    const out = await dispatchKernel('var_hill_epicyclic', fnBody, pts, '1.0, 1.2, 0.5');
    const e = jsHill(0.5, 0.3, 1.0, 1.2, 0.5);
    expect(out[0]).toBeCloseTo(e[0], 4);
    expect(out[1]).toBeCloseTo(e[1], 4);
    expect(out[2]).toBeCloseTo(2 * out[0]!, 4);       // linearity
    expect(out[3]).toBeCloseTo(2 * out[1]!, 4);
  });
});
