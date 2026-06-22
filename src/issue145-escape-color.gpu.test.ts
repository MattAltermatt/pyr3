// @vitest-environment node
//
// #145 — DC escape-band coloring for V310–V313 via the shared escape_color
// helper. escape_color re-iterates the SAME map ≤12 times from the post-step
// point and smooth-colors by escape/convergence depth. Split into its own
// file from the position tests to respect the per-worker ~47-dispatch SIGABRT
// cap (reference-dawn-vitest-dispatch-count-limit). Load-bearing properties:
// in-gamut RGB output, and that distinct escape regimes (fast-escaper vs
// converger) map to distinct colors (the whole point of option A).
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;
const HSL = extractWgslFn(SHADER_SRC, 'hsl_to_rgb');
const CMUL = extractWgslFn(SHADER_SRC, 'complex_mul');
const CSQR = extractWgslFn(SHADER_SRC, 'complex_sqr');
const CDIV = extractWgslFn(SHADER_SRC, 'complex_div');
const CPOWI = extractWgslFn(SHADER_SRC, 'complex_pow_int');
const BSHIP = extractWgslFn(SHADER_SRC, 'var_burning_ship');
const MAG = extractWgslFn(SHADER_SRC, 'var_magnet1');
const NOVA = extractWgslFn(SHADER_SRC, 'var_nova');
const HAL = extractWgslFn(SHADER_SRC, 'var_halley');
// escape_color (the fn under test) is inserted by dispatchColor as fnBody —
// NOT here, to avoid a double-definition.
const PRELUDE = `\n${HSL}\n${CMUL}\n${CSQR}\n${CDIV}\n${CPOWI}\n${BSHIP}\n${MAG}\n${NOVA}\n${HAL}\n`;
const ESC = extractWgslFn(SHADER_SRC, 'escape_color');

// Inputs as r.xy, runtime cx/cy as r.zw. paramsCall is the arg list after
// (r.xy, …), e.g. '310u, r.z, r.w, 0.0'. Output is vec3f RGB (stride 16).
async function dispatchColor(
  paramsCall: string,
  inputs: ReadonlyArray<readonly [number, number]>,
  cxcy: ReadonlyArray<readonly [number, number]>,
): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4] = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
    flat[i * 4 + 2] = cxcy[i]![0];
    flat[i * 4 + 3] = cxcy[i]![1];
  }
  const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const code = `${PRELUDE}
${ESC}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec3f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = escape_color(r.xy, ${paramsCall});
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
  const readBuf = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 16);
  dev.queue.submit([enc.finish(), enc2.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  return res;
}

// Read the RGB triple for element 0 (vec3f stride 16 = 4 floats; skip the pad).
function rgb0(buf: Float32Array): [number, number, number] {
  return [buf[0]!, buf[1]!, buf[2]!];
}

describe('#145 escape_color DC band', () => {
  it('returns in-gamut RGB for burning_ship', async () => {
    if (!device) return;
    const out = rgb0(await dispatchColor('310u, r.z, r.w, 0.0', [[0.3, 0.4]], [[-0.5, -0.5]]));
    for (const ch of out) { expect(ch).toBeGreaterThanOrEqual(0.0); expect(ch).toBeLessThanOrEqual(1.0); }
  });

  it('bands burning_ship: a fast-escaper and a converger get different hues', async () => {
    if (!device) return;
    const fast = rgb0(await dispatchColor('310u, r.z, r.w, 0.0', [[3.0, 3.0]], [[-0.5, -0.5]]));
    const slow = rgb0(await dispatchColor('310u, r.z, r.w, 0.0', [[0.0, 0.0]], [[-0.5, -0.5]]));
    const diff = Math.abs(fast[0] - slow[0]) + Math.abs(fast[1] - slow[1]) + Math.abs(fast[2] - slow[2]);
    expect(diff).toBeGreaterThan(0.05);
  });

  it('all four var families produce finite, in-gamut color', async () => {
    if (!device) return;
    const cases = [
      ['310u, r.z, r.w, 0.0', [-0.5, -0.5]],
      ['311u, r.z, r.w, 0.0', [0.5, 0.3]],
      ['312u, r.z, r.w, 1.0', [0.0, 0.0]],
      ['313u, r.z, r.w, 0.0', [0.0, 0.0]],
    ] as const;
    for (const [call, c] of cases) {
      const out = rgb0(await dispatchColor(call, [[0.4, -0.3]], [c as [number, number]]));
      for (const ch of out) {
        expect(Number.isFinite(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0.0);
        expect(ch).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
