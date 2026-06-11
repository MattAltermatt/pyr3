// @vitest-environment node
//
// #155 — Knots & braids (V302–V303): torus_knot, braid_warp. torus_knot is a
// (p,q) rosette bounded by radius+tube; braid_warp preserves radius exactly
// (pure angular permutation). Both route coef-scaled trig through safe_*.
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

const mag = (out: Float32Array, i: number) => Math.hypot(out[i*2]!, out[i*2+1]!);

describe('V302 torus_knot', () => {
  it('bounded by radius+tube; origin sits on the radius circle', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_torus_knot');
    const pts: Array<[number, number]> = [[0, 0]];
    for (let x = -2; x <= 2; x += 0.5) for (let y = -2; y <= 2; y += 1) pts.push([x, y]);
    const out = await dispatchKernel('var_torus_knot', fnBody, pts, '3.0, 2.0, 0.6, 0.3');
    // At the origin amp=0 so |out|=rr=radius=0.6; the *angle* is undefined
    // (atan2(0,0) is implementation-defined on Dawn), so only the magnitude is.
    expect(mag(out, 0)).toBeCloseTo(0.6, 3);
    for (let i = 0; i < pts.length; i++) expect(mag(out, i)).toBeLessThanOrEqual(0.95);  // radius+tube
  });
  it('tube=0 → output lies exactly on the circle of radius `radius`', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_torus_knot');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_torus_knot', fnBody, pts, '3.0, 2.0, 0.6, 0.0');
    // 3 decimals: f32 cos²+sin² rounds to ~0.99985, so rr·√ ≈ 0.59991.
    for (let i = 0; i < pts.length; i++) expect(mag(out, i)).toBeCloseTo(0.6, 3);
  });
  it('p=3 three-fold angular symmetry (tube=0)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_torus_knot');
    const phi = 0.4, R = 0.8;
    const pa: [number, number] = [R * Math.cos(phi), R * Math.sin(phi)];
    const pb: [number, number] = [R * Math.cos(phi + 2 * Math.PI / 3), R * Math.sin(phi + 2 * Math.PI / 3)];
    const out = await dispatchKernel('var_torus_knot', fnBody, [pa, pb], '3.0, 2.0, 0.6, 0.0');
    expect(out[0]).toBeCloseTo(out[2]!, 3);
    expect(out[1]).toBeCloseTo(out[3]!, 3);
  });
});

describe('V303 braid_warp', () => {
  it('preserves radius exactly (pure angular permutation)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_braid_warp');
    const pts: Array<[number, number]> = [];
    for (let a = 0; a < 6.2; a += 0.4) for (const r of [0.3, 0.8, 1.5]) pts.push([r * Math.cos(a), r * Math.sin(a)]);
    const out = await dispatchKernel('var_braid_warp', fnBody, pts, '3.0, 0.6, 2.0');
    for (let i = 0; i < pts.length; i++) {
      const rIn = Math.hypot(pts[i]![0], pts[i]![1]);
      expect(mag(out, i)).toBeCloseTo(rIn, 4);
    }
  });
  it('lane-edge is identity (weave=0) + origin fixed', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_braid_warp');
    // a·n integer ⇒ laneFrac=0 ⇒ dtheta=0. n=3 → a=1/3 → θ = a·2π−π = -π/3.
    const theta = (1 / 3) * 2 * Math.PI - Math.PI;
    const r = 0.7;
    const pt: [number, number] = [r * Math.cos(theta), r * Math.sin(theta)];
    const out = await dispatchKernel('var_braid_warp', fnBody, [pt, [0, 0]], '3.0, 0.6, 2.0');
    expect(out[0]).toBeCloseTo(pt[0], 3); expect(out[1]).toBeCloseTo(pt[1], 3);  // lane edge
    expect(out[2]).toBe(0); expect(out[3]).toBe(0);                              // origin
  });
  it('bounded under twist extremes (no growth, no NaN)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_braid_warp');
    const pts: Array<[number, number]> = [];
    for (let a = 0; a < 6.2; a += 0.5) for (const r of [0.5, 1.0, 2.0]) pts.push([r * Math.cos(a), r * Math.sin(a)]);
    const out = await dispatchKernel('var_braid_warp', fnBody, pts, '2.0, 2.0, 8.0');
    for (let i = 0; i < pts.length; i++) {
      const rIn = Math.hypot(pts[i]![0], pts[i]![1]);
      expect(Number.isFinite(mag(out, i))).toBe(true);
      expect(mag(out, i)).toBeLessThanOrEqual(rIn + 1e-4);
    }
  });
});
