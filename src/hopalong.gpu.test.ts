// @vitest-environment node
//
// #466 V324 hopalong (Barry Martin). Novel single-map attractor (no flam3-C ref).
// GPU smoke: matches the closed-form map on sample coords + CPU↔GPU parity guard
// (ts_var_hopalong ≈ var_hopalong) so the deliberate dual impl can't silently
// drift. sqrt(abs(...)) is always in-domain → no trig-cliff / safe_* prelude.
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';
import { ts_var_hopalong, type VarInput } from './variations';

const { device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

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
  const code = `${fnBody}
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
  const pipe = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }] });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass(); pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N); pass.end();
  const read = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(outBuf, 0, read, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(read.getMappedRange().slice(0)); read.unmap();
  return out;
}

describe('var_hopalong V324', () => {
  it('GPU matches CPU oracle on runtime args', async () => {
    const a = 1.0, b = 2.0, c = 0.5;
    const fnBody = extractWgslFn(CHAOS_WGSL, 'var_hopalong');
    const inputs: [number, number][] = [[0.3, -0.7], [-1.2, 0.4], [0.0, 0.9], [-0.05, -0.05]];
    const gpu = await dispatchKernel('var_hopalong', fnBody, inputs, `${a}, ${b}, ${c}`);
    for (let i = 0; i < inputs.length; i++) {
      const inp: VarInput = { tx: inputs[i]![0], ty: inputs[i]![1], weight: 1, params: { a, b, c } };
      const o = ts_var_hopalong(inp);
      expect(gpu[i * 2]).toBeCloseTo(o.x, 4);
      expect(gpu[i * 2 + 1]).toBeCloseTo(o.y, 4);
    }
  });
});
