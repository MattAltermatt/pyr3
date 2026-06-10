// @vitest-environment node
//
// #148 — Atomic-orbital warps (V290–V291): radial_shell, hydrogen_orbital.
// radial_shell uses radial_psi2 (assoc_laguerre); hydrogen_orbital additionally
// reuses #144's sph_harmonic via the in-plane azimuth. Identities: 1s monotone
// decay, 2s radial node at r=n, lobe_mix=0 collapse to radial_shell, p-orbital
// angular node, boundedness ≤ 1.5, angle preservation.
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

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
const LAG = extractWgslFn(SHADER_SRC, 'assoc_laguerre');
const PSI2 = extractWgslFn(SHADER_SRC, 'radial_psi2');
const ASSOC_LEG = extractWgslFn(SHADER_SRC, 'assoc_legendre');
const SPH = extractWgslFn(SHADER_SRC, 'sph_harmonic');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${LAG}
${PSI2}
${ASSOC_LEG}
${SPH}
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
  const mod = dev.createShaderModule({ code });
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
  // Free GPU resources each call — the orbital kernels are heavy and the
  // accumulated buffers otherwise crash Dawn's worker on teardown.
  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  return res;
}

const rad = (out: Float32Array, i: number) => Math.hypot(out[i*2]!, out[i*2+1]!);

describe('V290 radial_shell', () => {
  it('1s (n=1,l=0) has no radial node — monotone decreasing', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_radial_shell');
    const out = await dispatchKernel('var_radial_shell', fnBody, [[0.2, 0], [0.8, 0], [1.5, 0]], '1.0, 0.0, 1.0');
    expect(rad(out, 0)).toBeGreaterThan(rad(out, 1));
    expect(rad(out, 1)).toBeGreaterThan(rad(out, 2));
  });
  it('2s (n=2,l=0) has a radial node near r=2 (L^1_1=2−rho zeros at rho=2)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_radial_shell');
    // rho = 2r/n = 2r/2 = r → node at r=2
    const out = await dispatchKernel('var_radial_shell', fnBody, [[2.0, 0], [0.5, 0]], '2.0, 0.0, 1.0');
    expect(rad(out, 0)).toBeLessThan(0.02);     // node → r_out ≈ 0
    expect(rad(out, 1)).toBeGreaterThan(0.05);  // off-node has structure
  });
  it('bounded ≤ 1.5 across (n,l) presets and r sweep', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_radial_shell');
    const presets = [[1, 0], [2, 1], [3, 0], [3, 2], [4, 3]];
    for (const [n, l] of presets) {
      const pts: Array<[number, number]> = [];
      for (let r = 0; r <= 5; r += 0.5) pts.push([r * 0.6, r * 0.8]);
      const out = await dispatchKernel('var_radial_shell', fnBody, pts, `${n}.0, ${l}.0, 1.0`);
      for (let i = 0; i < pts.length; i++) { expect(Number.isFinite(rad(out, i))).toBe(true); expect(rad(out, i)).toBeLessThanOrEqual(1.5 + 1e-4); }
    }
  });
  it('preserves angle (radius-only remap)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_radial_shell');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.2, -0.9]] as const;
    const out = await dispatchKernel('var_radial_shell', fnBody, pts, '3.0, 0.0, 1.0');
    for (let i = 0; i < pts.length; i++) {
      if (rad(out, i) < 1e-4) continue;
      expect(Math.atan2(out[i*2+1]!, out[i*2]!)).toBeCloseTo(Math.atan2(pts[i]![1], pts[i]![0]), 4);
    }
  });
});

describe('V291 hydrogen_orbital', () => {
  it('lobe_mix=0 collapses exactly to radial_shell', async () => {
    if (!device) return;
    const hBody = extractWgslFn(SHADER_SRC, 'var_hydrogen_orbital');
    const sBody = extractWgslFn(SHADER_SRC, 'var_radial_shell');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.2, -0.9]] as const;
    const h = await dispatchKernel('var_hydrogen_orbital', hBody, pts, '3.0, 2.0, 0.0, 1.0, 0.0');
    const s = await dispatchKernel('var_radial_shell', sBody, pts, '3.0, 2.0, 1.0');
    for (let i = 0; i < pts.length * 2; i++) expect(h[i]).toBeCloseTo(s[i]!, 5);
  });
  it('p-orbital (l=1,m=0) angular node on the y-axis', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_hydrogen_orbital');
    // cos(phi)=0 on +y axis → Y_1^0 ∝ cos(phi) = 0 → ang2=0 → r_out≈0
    const out = await dispatchKernel('var_hydrogen_orbital', fnBody, [[0.0, 0.5], [0.5, 0.0]], '2.0, 1.0, 0.0, 1.0, 1.0');
    expect(rad(out, 0)).toBeLessThan(0.02);     // node on y-axis
    expect(rad(out, 1)).toBeGreaterThan(0.02);  // lobe on x-axis
  });
  it('bounded ≤ 1.5 across presets and directions', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_hydrogen_orbital');
    const presets = [[1, 0, 0], [2, 1, 0], [3, 2, 0], [4, 3, 0]];
    for (const [n, l, m] of presets) {
      const pts: Array<[number, number]> = [];
      for (let r = 0.2; r <= 5; r += 0.6) for (let a = 0; a < 6.2; a += 0.78) pts.push([r * Math.cos(a), r * Math.sin(a)]);
      const out = await dispatchKernel('var_hydrogen_orbital', fnBody, pts, `${n}.0, ${l}.0, ${m}.0, 1.0, 1.0`);
      for (let i = 0; i < pts.length; i++) { expect(Number.isFinite(rad(out, i))).toBe(true); expect(rad(out, i)).toBeLessThanOrEqual(1.5 + 1e-4); }
    }
  });
});
