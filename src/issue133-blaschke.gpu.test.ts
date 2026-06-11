// @vitest-environment node
//
// #133 V221 — Blaschke product, 2-to-1 form. B(z) = z·(z−a)/(1−ā·z).
// Two zeros (origin + a). The unit circle is invariant (|B(z)| = 1
// when |z| = 1). Pole at z = 1/ā lies outside the unit disk when |a|<1.

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

const CPX_MUL = extractWgslFn(SHADER_SRC, 'complex_mul');
const CPX_DIV = extractWgslFn(SHADER_SRC, 'complex_div');
const VAR_BLASCHKE = extractWgslFn(SHADER_SRC, 'var_blaschke');

const PRELUDE = `${CPX_MUL}
${CPX_DIV}
${VAR_BLASCHKE}
`;

async function dispatchBlaschke(inputs: ReadonlyArray<readonly [number, number, number, number]>): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];  // p.x
    flat[i * 4 + 1] = inputs[i]![1];  // p.y
    flat[i * 4 + 2] = inputs[i]![2];  // a.x
    flat[i * 4 + 3] = inputs[i]![3];  // a.y
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
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = var_blaschke(r.xy, 1.0, r.z, r.w);
}`;
  const mod = await compileChecked(dev, code);
  const pipeline = dev.createComputePipeline({
    layout: 'auto',
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
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
  const readback = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  enc.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  inBuf.destroy(); outBuf.destroy(); readback.destroy();
  return out;
}

describe.skipIf(!device)('#133 V221 — var_blaschke', () => {
  it('vanishes at the two zeros (origin and a)', async () => {
    const out = await dispatchBlaschke([
      [0.0, 0.0, 0.5, 0.0],   // B(0) = 0
      [0.5, 0.0, 0.5, 0.0],   // B(a) = 0
    ]);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
    expect(out[3]).toBeCloseTo(0, 5);
  });

  it('preserves |B(z)| = 1 on the unit circle (z = 1, a = 0.5)', async () => {
    // B(1) = 1 · (1 − 0.5) / (1 − 0.5 · 1) = 0.5 / 0.5 = 1
    const out = await dispatchBlaschke([
      [1.0, 0.0, 0.5, 0.0],
    ]);
    expect(out[0]).toBeCloseTo(1, 4);
    expect(out[1]).toBeCloseTo(0, 4);
  });

  it('keeps unit-circle inputs on the unit circle (|B(i)| = 1)', async () => {
    const out = await dispatchBlaschke([
      [0.0, 1.0, 0.5, 0.0],    // |z|=1
      [-1.0, 0.0, 0.3, 0.2],   // |z|=1
      [0.6, 0.8, 0.4, 0.1],    // |z|=1
    ]);
    expect(Math.hypot(out[0]!, out[1]!)).toBeCloseTo(1, 2);
    expect(Math.hypot(out[2]!, out[3]!)).toBeCloseTo(1, 2);
    expect(Math.hypot(out[4]!, out[5]!)).toBeCloseTo(1, 2);
  });

  it('stays finite near the external pole z = 1/ā (a = 0.5)', async () => {
    // a = (0.5, 0) → 1/ā = (2, 0). Input near (2, 0) is past the disk.
    const out = await dispatchBlaschke([
      [2.0, 0.0, 0.5, 0.0],
      [1.95, 0.01, 0.5, 0.0],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });

  it('produces finite output across the interior + complex a', async () => {
    const out = await dispatchBlaschke([
      [0.3, 0.4, 0.5, 0.3],
      [-0.6, 0.2, 0.1, -0.4],
      [0.7, -0.5, 0.8, 0.0],
      [0.2, 0.9, -0.3, 0.5],
    ]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
