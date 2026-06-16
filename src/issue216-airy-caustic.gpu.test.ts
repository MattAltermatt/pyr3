// @vitest-environment node
//
// #216 — airy_caustic (V304). Supernumerary-ring caustic profile: the radius is
// modulated by 1 + amp·Ai(scale·(r − r0)), reusing #137's airy_ai_eval. The
// load-bearing properties: the envelope is clamped positive [0.05, 3.0] (never
// folds through the origin), and far from the turning point Ai decays so the
// warp relaxes to the identity·env→1. airy_ai_eval routes through safe_sin/cos,
// so the prelude stamps hash01 + SIN_SAFE_MAX + PI + TAU.
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

const SHADER_SRC = readFileSync(new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8');
const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const AIRY = extractWgslFn(SHADER_SRC, 'airy_ai_eval');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${AIRY}
`;

async function dispatchKernel(
  fnName: string, fnBody: string,
  inputs: ReadonlyArray<readonly [number, number]>, paramsCall: string,
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

// JS oracle mirroring chaos.wgsl airy_ai_eval + var_airy_caustic.
function jsAiry(xx: number): number {
  if (xx > 4.0) { const xi = (2/3)*Math.pow(xx,1.5); return Math.exp(-xi)/(2*1.7724539*Math.pow(xx,0.25)); }
  if (xx < -5.0) { const axx = -xx; const xi = (2/3)*Math.pow(axx,1.5); return Math.sin(xi+0.78539816)/(1.7724539*Math.pow(axx,0.25)); }
  const c1=0.355028053887817,c2=0.258819403792807; const x3=xx*xx*xx;
  let f=1,tf=1,g=xx,tg=xx;
  for (let k=1;k<12;k++){ tf*=x3/((3*k-1)*(3*k)); f+=tf; tg*=x3/((3*k)*(3*k+1)); g+=tg; }
  return c1*f - c2*g;
}
function jsCaustic(x: number, y: number, scale: number, r0: number, amp: number): [number, number] {
  const r = Math.hypot(x, y);
  const a = jsAiry(scale * (r - r0));
  const env = Math.max(0.05, Math.min(3.0, 1 + amp * a));
  return [env * x, env * y];
}
const mag = (out: Float32Array, i: number) => Math.hypot(out[i*2]!, out[i*2+1]!);

describe('V304 airy_caustic', () => {
  it('airy_ai_eval(0) ≈ 0.3550280 (oracle sanity)', () => {
    expect(jsAiry(0)).toBeCloseTo(0.3550280, 5);
  });
  it('matches the TS↔WGSL caustic oracle across the disk', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_airy_caustic');
    const scale = 4.5, r0 = 1.1, amp = 2.2;
    const pts = [[0.3, 0], [0, 0.7], [0.9, 0.4], [1.1, 0], [1.5, -0.6]] as const;
    const out = await dispatchKernel('var_airy_caustic', fnBody, pts, `${scale}, ${r0}, ${amp}`);
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = jsCaustic(pts[i]![0], pts[i]![1], scale, r0, amp);
      expect(out[i*2]!).toBeCloseTo(ex, 4);
      expect(out[i*2+1]!).toBeCloseTo(ey, 4);
    }
  });
  it('envelope clamp: |out| never exceeds 3·|p| (no fold-through)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_airy_caustic');
    const pts = [[0.05, 0], [0.5, 0], [1.0, 0], [2.0, 0], [5.0, 0]] as const;
    const out = await dispatchKernel('var_airy_caustic', fnBody, pts, `4.5, 1.1, 2.2`);
    for (let i = 0; i < pts.length; i++) {
      const rin = Math.hypot(pts[i]![0], pts[i]![1]);
      expect(mag(out, i)).toBeLessThanOrEqual(3.0 * rin + 1e-4);
      expect(mag(out, i)).toBeGreaterThanOrEqual(0.05 * rin - 1e-4);
    }
  });
  it('far from the turning point Ai decays → envelope relaxes toward identity', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_airy_caustic');
    const out = await dispatchKernel('var_airy_caustic', fnBody, [[6.0, 0]], `4.5, 1.1, 2.2`);
    // scale·(6−1.1)=22 → Ai≈0 → env≈1 → out≈p
    expect(out[0]!).toBeCloseTo(6.0, 2);
  });
});
