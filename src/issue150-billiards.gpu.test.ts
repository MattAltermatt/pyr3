// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import {
  ts_var_billiard_circle,
  ts_var_billiard_stadium,
  ts_var_billiard_sinai,
  ts_var_billiard_polygon,
} from './variations';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

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
  for (let i = 0; i < N; i++) {
    flat[i * 4]     = inputs[i]![0];
    flat[i * 4 + 1] = inputs[i]![1];
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
  // Explicit pipeline layout — `layout: 'auto'` silently strips bindings the
  // shader doesn't statically reference, producing all-zero output without
  // an error if a future edit short-circuits a write path.
  const bindGroupLayout = dev.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = dev.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = dev.createComputePipeline({
    layout: pipelineLayout,
    compute: { module: mod, entryPoint: 'main' },
  });
  const bg = dev.createBindGroup({
    layout: bindGroupLayout,
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

  const readBuf = dev.createBuffer({
    size: N * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 8);
  dev.queue.submit([enc.finish(), enc2.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  return res;
}

describe('V258 billiard_circle', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_billiard_circle');
    const pts = [
      [0.0, 0.0],
      [0.5, 0.0],
      [0.9, 0.1],
      [1.2, -0.5], // outside start
    ] as const;
    const out = await dispatchKernel('var_billiard_circle', fnBody, pts, '1.0, 0.5, 0.0');

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const expected = ts_var_billiard_circle({
        tx: px,
        ty: py,
        weight: 1.0,
        params: { radius: 1.0, step: 0.5, angle: 0.0 },
      });
      expect(out[i * 2]).toBeCloseTo(expected.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(expected.y, 4);
    }
  });
});

describe('V259 billiard_stadium', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_billiard_stadium');
    const pts = [
      [0.0, 0.0],
      [0.7, 0.4],
      [1.0, -0.2],
      [-1.5, 1.2], // outside start
    ] as const;
    const out = await dispatchKernel('var_billiard_stadium', fnBody, pts, '1.5, 1.0, 0.5, 0.5');

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const expected = ts_var_billiard_stadium({
        tx: px,
        ty: py,
        weight: 1.0,
        params: { width: 1.5, height: 1.0, step: 0.5, angle: 0.5 },
      });
      expect(out[i * 2]).toBeCloseTo(expected.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(expected.y, 4);
    }
  });
});

describe('V260 billiard_sinai', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_billiard_sinai');
    const pts = [
      [0.0, 0.0],  // inside obstacle start
      [0.7, 0.7],
      [-0.9, -0.9],
      [0.3, 0.4],  // near obstacle
    ] as const;
    const out = await dispatchKernel('var_billiard_sinai', fnBody, pts, '2.0, 0.5, 0.5, 0.3');

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const expected = ts_var_billiard_sinai({
        tx: px,
        ty: py,
        weight: 1.0,
        params: { length: 2.0, radius: 0.5, step: 0.5, angle: 0.3 },
      });
      expect(out[i * 2]).toBeCloseTo(expected.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(expected.y, 4);
    }
  });
});

describe('V261 billiard_polygon', () => {
  it('matches expected math', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_billiard_polygon');
    const pts = [
      [0.0, 0.0],
      [0.5, -0.2],
      [-0.8, 0.8],
    ] as const;
    const out = await dispatchKernel('var_billiard_polygon', fnBody, pts, '5.0, 1.0, 0.5, 0.7');

    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i]!;
      const expected = ts_var_billiard_polygon({
        tx: px,
        ty: py,
        weight: 1.0,
        params: { sides: 5, radius: 1.0, step: 0.5, angle: 0.7 },
      });
      expect(out[i * 2]).toBeCloseTo(expected.x, 4);
      expect(out[i * 2 + 1]).toBeCloseTo(expected.y, 4);
    }
  });
});
