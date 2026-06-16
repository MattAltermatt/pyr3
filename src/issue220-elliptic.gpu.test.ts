// @vitest-environment node
//
// #220 — complete elliptic integral radial warps (V305 elliptic_E, V306
// elliptic_K). Both are radial inverse-profile remaps (#151 idiom): u = m =
// r²/(1+r²) ∈ (0,1) drives the integral; angle preserved; origin → origin.
// E(m) ∈ [1, π/2] is inherently bounded; K(m) diverges logarithmically as
// m → 1, so elliptic_K_eval floors m1 at 1e-3 and var_elliptic_K hard-clamps
// r′ to tail_clamp. No trig → minimal prelude (the two A&S poly helpers only).
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
const E_EVAL = extractWgslFn(SHADER_SRC, 'elliptic_E_eval');
const K_EVAL = extractWgslFn(SHADER_SRC, 'elliptic_K_eval');
const PRELUDE = `\n${E_EVAL}\n${K_EVAL}\n`;

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

const mag = (out: Float32Array, i: number) => Math.hypot(out[i*2]!, out[i*2+1]!);
function jsE(m: number): number { const m1 = Math.max(0, Math.min(1, 1-m)); const l = Math.log(1/Math.max(m1,1e-6)); return (1 + m1*(0.4630151 + m1*0.1077812)) + m1*(0.2452727 + m1*0.0412496)*l; }
function jsK(m: number): number { const m1 = Math.max(1e-3, Math.min(1, 1-m)); const l = Math.log(1/m1); return (1.3862944 + m1*(0.1119723 + m1*0.0725296)) + (0.5 + m1*(0.1213478 + m1*0.0288729))*l; }

describe('V305 elliptic_E', () => {
  it('E(0) ≈ π/2, E(1) = 1 (helper sanity)', () => {
    expect(jsE(0)).toBeCloseTo(Math.PI / 2, 3);
    expect(jsE(1)).toBeCloseTo(1.0, 4);
  });
  it('origin → origin, radial purity, closed-form match, bounded', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_elliptic_E');
    const scale = 0.8;
    const pts = [[0, 0], [0.5, 0], [0, 0.7], [2.0, 0]] as const;
    const out = await dispatchKernel('var_elliptic_E', fnBody, pts, `${scale}`);
    expect(mag(out, 0)).toBeLessThan(1e-6);                  // origin
    expect(Math.abs(out[1*2+1]!)).toBeLessThan(1e-5);        // (0.5,0) → out.y≈0
    expect(Math.abs(out[2*2]!)).toBeLessThan(1e-5);          // (0,0.7) → out.x≈0
    const m = 0.25 / 1.25; expect(mag(out, 1)).toBeCloseTo(scale * jsE(m), 4);
    // E ∈ [1, π/2] so r' ∈ [scale, scale·π/2] — strictly bounded.
    expect(mag(out, 3)).toBeLessThanOrEqual(scale * (Math.PI / 2) + 1e-3);
  });
});

describe('V306 elliptic_K', () => {
  it('K(0) ≈ π/2 (helper sanity)', () => {
    expect(jsK(0)).toBeCloseTo(Math.PI / 2, 3);
  });
  it('closed-form in the interior, HARD tail clamp at the rim', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_elliptic_K');
    const scale = 0.5, cap = 1.5;
    const out = await dispatchKernel('var_elliptic_K', fnBody, [[0.5, 0], [40.0, 0]], `${scale}, ${cap}`);
    const m = 0.25 / 1.25; expect(out[0]!).toBeCloseTo(scale * jsK(m), 4);
    // r=40 → m≈1 → K≈4.84 → scale·K≈2.42 > cap → pinned to exactly cap.
    expect(mag(out, 1)).toBeCloseTo(cap, 4);
  });
});
