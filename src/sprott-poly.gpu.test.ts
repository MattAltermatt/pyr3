// @vitest-environment node
//
// #470 V323 sprott_poly — 2D quadratic Sprott map. Novel (no flam3-C/JWF ref).
// GPU smoke: matches the closed-form polynomial on sample coords, and a CPU↔GPU
// parity guard (ts_var_sprott_poly ≈ var_sprott_poly) so the deliberate dual
// impl can't silently drift. Pure +/-/* → no trig-cliff prelude needed.
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';
import { ts_var_sprott_poly, type VarInput } from './variations';

const { device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;
const NAMES = ['a1', 'a2', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'b5'];

// sprott_poly needs no module consts/helpers — empty prelude.
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
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length) throw new Error('WGSL compile error: ' + errs.map((m) => m.message).join('; '));
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

// WGSL f32 literal list (force a decimal point so integer coeffs aren't AbstractInt).
const wgslArgs = (a: number[]) => a.map((c) => (Number.isInteger(c) ? c.toFixed(1) : String(c))).join(', ');
const cpuOut = (x: number, y: number, a: number[]) =>
  ts_var_sprott_poly({ tx: x, ty: y, weight: 1, params: Object.fromEntries(NAMES.map((n, i) => [n, a[i]!])) } as VarInput);

describe('V323 sprott_poly (WGSL)', () => {
  const a = [0.5, -0.3, 0.2, 0.9, -0.4, 0.1, 0.6, -0.7, 0.3, 0.8];
  const pts: ReadonlyArray<readonly [number, number]> = [[0.4, -0.2], [-0.7, 0.5], [0.1, 0.9]];

  it('matches the closed-form quadratic map', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_sprott_poly');
    const out = await dispatchKernel('var_sprott_poly', fn, pts, wgslArgs(a));
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]!;
      const x2 = x * x, xy = x * y, y2 = y * y;
      const ex = a[0]! * x + a[1]! * x2 + a[2]! * xy + a[3]! * y + a[4]! * y2;
      const ey = a[5]! * x + a[6]! * x2 + a[7]! * xy + a[8]! * y + a[9]! * y2;
      expect(out[i * 2]!).toBeCloseTo(ex, 4);
      expect(out[i * 2 + 1]!).toBeCloseTo(ey, 4);
    }
  });
});

describe('V323 sprott_poly CPU↔GPU parity (dual-impl sync guard)', () => {
  it('ts_var_sprott_poly matches var_sprott_poly on sample coords', async () => {
    if (!device) return;
    const fn = extractWgslFn(SHADER_SRC, 'var_sprott_poly');
    const a = [0.31, 0.88, -0.42, 0.17, -0.93, 0.55, -0.21, 0.64, 0.39, -0.76];
    const pts: ReadonlyArray<readonly [number, number]> = [[0.3, 0.7], [-0.5, -0.1], [0.9, -0.6]];
    const out = await dispatchKernel('var_sprott_poly', fn, pts, wgslArgs(a));
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i]!;
      const cpu = cpuOut(x, y, a);
      expect(out[i * 2]!).toBeCloseTo(cpu.x, 4);
      expect(out[i * 2 + 1]!).toBeCloseTo(cpu.y, 4);
    }
  });
});
