// @vitest-environment node
//
// #145 — Escape-time fractal single-steps V310–V313 (burning_ship, magnet1,
// nova, halley). Each is a single step of a classic escape-time iteration,
// expressed with the complex helpers. No trig → prelude is just the complex
// helpers + the 4 var fns. RUNTIME params: cx/cy are threaded through r.z/r.w
// (and relax as a literal in the params-call string) so they are NOT
// compiler-folded. Load-bearing properties: closed-form match at sample
// points, passthrough at the guarded pole, fixed-point identity at the cube
// roots of unity (nova/halley), and finiteness across a grid (boundedness).
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;
const CMUL = extractWgslFn(SHADER_SRC, 'complex_mul');
const CSQR = extractWgslFn(SHADER_SRC, 'complex_sqr');
const CDIV = extractWgslFn(SHADER_SRC, 'complex_div');
const CPOWI = extractWgslFn(SHADER_SRC, 'complex_pow_int');
// PRELUDE = complex helpers ONLY. The var fn under test is inserted by
// dispatchKernel as fnBody — including it here too would double-define it.
const PRELUDE = `\n${CMUL}\n${CSQR}\n${CDIV}\n${CPOWI}\n`;
const BSHIP = extractWgslFn(SHADER_SRC, 'var_burning_ship');
const MAG = extractWgslFn(SHADER_SRC, 'var_magnet1');
const NOVA = extractWgslFn(SHADER_SRC, 'var_nova');
const HAL = extractWgslFn(SHADER_SRC, 'var_halley');

// Threads inputs as r.xy and (optional) runtime params as r.zw. paramsCall is
// the WGSL argument list after (r.xy, 1.0, …), e.g. 'r.z, r.w' or 'r.z, r.w, 1.0'.
async function dispatchKernel(
  fnName: string, fnBody: string,
  inputs: ReadonlyArray<readonly [number, number]>, paramsCall: string,
  cxcy?: ReadonlyArray<readonly [number, number]>,
): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4] = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
    if (cxcy) { flat[i * 4 + 2] = cxcy[i]![0]; flat[i * 4 + 3] = cxcy[i]![1]; }
  }
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

describe('#145 escape-time single-steps V310–V313', () => {
  it('burning_ship: (|Re|+i|Im|)²+c at z=(0.3,0.4), c=(−0.5,−0.5)', async () => {
    if (!device) return;
    // za=(0.3,0.4); za²=(0.09−0.16, 2·0.12)=(−0.07,0.24); +c=(−0.57,−0.26)
    const out = await dispatchKernel('var_burning_ship', BSHIP, [[0.3, 0.4]], 'r.z, r.w', [[-0.5, -0.5]]);
    expect(out[0]!).toBeCloseTo(-0.57, 4);
    expect(out[1]!).toBeCloseTo(-0.26, 4);
  });

  it('burning_ship: abs folds a negative quadrant to the same value as its mirror', async () => {
    if (!device) return;
    const a = await dispatchKernel('var_burning_ship', BSHIP, [[-0.3, 0.4]], 'r.z, r.w', [[0.0, 0.0]]);
    const b = await dispatchKernel('var_burning_ship', BSHIP, [[0.3, -0.4]], 'r.z, r.w', [[0.0, 0.0]]);
    expect(a[0]!).toBeCloseTo(b[0]!, 5);
    expect(a[1]!).toBeCloseTo(b[1]!, 5);
  });

  it('magnet1: passthrough at the pole 2z+c−2=0 (c=0 ⇒ z=1)', async () => {
    if (!device) return;
    const out = await dispatchKernel('var_magnet1', MAG, [[1.0, 0.0]], 'r.z, r.w', [[0.0, 0.0]]);
    expect(out[0]!).toBeCloseTo(1.0, 4);
    expect(out[1]!).toBeCloseTo(0.0, 4);
  });

  it('magnet1: closed-form at z=(0.5,0), c=0 ⇒ ((z²−1)/(2z−2))² = ((z+1)/2)²', async () => {
    if (!device) return;
    // z=0.5: (z+1)/2 = 0.75; squared = 0.5625
    const out = await dispatchKernel('var_magnet1', MAG, [[0.5, 0.0]], 'r.z, r.w', [[0.0, 0.0]]);
    expect(out[0]!).toBeCloseTo(0.5625, 4);
    expect(out[1]!).toBeCloseTo(0.0, 4);
  });

  it('nova: cube root of unity is a fixed point (relax=1, c=0): z=1 → 1', async () => {
    if (!device) return;
    const out = await dispatchKernel('var_nova', NOVA, [[1.0, 0.0]], 'r.z, r.w, 1.0', [[0.0, 0.0]]);
    expect(out[0]!).toBeCloseTo(1.0, 4);
    expect(out[1]!).toBeCloseTo(0.0, 4);
  });

  it('nova: passthrough at the pole z=0 (f′=3z²→0)', async () => {
    if (!device) return;
    const out = await dispatchKernel('var_nova', NOVA, [[0.0, 0.0]], 'r.z, r.w, 1.0', [[0.0, 0.0]]);
    expect(out[0]!).toBeCloseTo(0.0, 6);
    expect(out[1]!).toBeCloseTo(0.0, 6);
  });

  it('halley: cube root of unity is a fixed point (c=0): z=1 → 1', async () => {
    if (!device) return;
    const out = await dispatchKernel('var_halley', HAL, [[1.0, 0.0]], 'r.z, r.w', [[0.0, 0.0]]);
    expect(out[0]!).toBeCloseTo(1.0, 4);
    expect(out[1]!).toBeCloseTo(0.0, 4);
  });

  it('all four stay finite across a grid (no NaN / Inf)', async () => {
    if (!device) return;
    const grid: [number, number][] = [];
    for (let x = -1.2; x <= 1.2; x += 0.3) for (let y = -1.2; y <= 1.2; y += 0.3) grid.push([x, y]);
    const cases = [
      ['var_burning_ship', BSHIP, 'r.z, r.w', [-0.5, -0.5]],
      ['var_magnet1', MAG, 'r.z, r.w', [0.5, 0.3]],
      ['var_nova', NOVA, 'r.z, r.w, 1.0', [0.0, 0.0]],
      ['var_halley', HAL, 'r.z, r.w', [0.0, 0.0]],
    ] as const;
    for (const [fn, body, call, c] of cases) {
      const out = await dispatchKernel(fn, body, grid, call, grid.map(() => c as [number, number]));
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
