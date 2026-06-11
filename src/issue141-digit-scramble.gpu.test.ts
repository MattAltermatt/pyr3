// @vitest-environment node
//
// #141 — Quasi-random & digit-scramble warps (V277–V279): radical_inverse,
// gray_code, morton_zorder. Pure u32 bit ops over the shared fp_encode/decode
// codec. Two dispatchers: a vec2f-warp path (oracle parity + boundedness) and a
// scalar u32 path that pins the exact bit identities (reverse_bits_n,
// gray_encode, morton_code) called out in the spec.
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

const BITS_MASK = extractWgslFn(SHADER_SRC, 'bits_mask');
const FP_ENC = extractWgslFn(SHADER_SRC, 'fp_encode');
const FP_DEC = extractWgslFn(SHADER_SRC, 'fp_decode');
const REVB = extractWgslFn(SHADER_SRC, 'reverse_bits_n');
const GRAY = extractWgslFn(SHADER_SRC, 'gray_encode');
const PART = extractWgslFn(SHADER_SRC, 'part1by1');
const MORTON = extractWgslFn(SHADER_SRC, 'morton_code');

const PRELUDE = `
${BITS_MASK}
${FP_ENC}
${FP_DEC}
${REVB}
${GRAY}
${PART}
${MORTON}
`;

async function dispatchWarp(
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
  return runCompute(code, inBuf, outBuf, N, Float32Array);
}

async function dispatchU32(
  callExpr: string,            // uses `a` and `b` (the two u32 inputs)
  inputs: ReadonlyArray<readonly [number, number]>,
): Promise<Uint32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Uint32Array(N * 2);
  for (let i = 0; i < N; i++) { flat[i * 2] = inputs[i]![0] >>> 0; flat[i * 2 + 1] = inputs[i]![1] >>> 0; }
  const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const code = `${PRELUDE}
@group(0) @binding(0) var<storage, read> ins: array<vec2u>;
@group(0) @binding(1) var<storage, read_write> outs: array<u32>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let a = ins[i].x;
  let b = ins[i].y;
  outs[i] = ${callExpr};
}`;
  return runCompute(code, inBuf, outBuf, N, Uint32Array);
}

async function runCompute<T extends Float32Array | Uint32Array>(
  code: string, inBuf: GPUBuffer, outBuf: GPUBuffer, N: number,
  Ctor: { new (b: ArrayBuffer): T },
): Promise<T> {
  const dev = device!;
  const mod = await compileChecked(dev, code);
  const bgl = dev.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pl = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipeline = dev.createComputePipeline({ layout: pl, compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: inBuf } },
    { binding: 1, resource: { buffer: outBuf } },
  ] });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N); pass.end();
  const bytes = outBuf.size;
  const readBuf = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, bytes);
  dev.queue.submit([enc.finish(), enc2.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Ctor(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  return res;
}

// ── JS oracles (mirror the WGSL) ──
const makeOracle = (bits: number, extent: number, perm: (v: number) => number) => (x: number, y: number): [number, number] => {
  const levels = Math.pow(2, bits); const s = Math.max(extent, 1e-4); const mask = (Math.pow(2, bits) - 1) >>> 0;
  const enc = (c: number) => { const norm = (c + s) / (2 * s); const folded = norm - Math.floor(norm); return Math.min((folded * levels) | 0, levels - 1) >>> 0; };
  const dec = (i: number) => ((i + 0.5) / levels) * 2 * s - s;
  return [dec(perm(enc(x)) & mask), dec(perm(enc(y)) & mask)];
};
const jsRev = (bits: number) => (v: number) => { let r = 0; for (let k = 0; k < bits; k++) { r = ((r << 1) | (v & 1)) >>> 0; v = v >>> 1; } return r >>> 0; };
const jsGray = (v: number) => (v ^ (v >>> 1)) >>> 0;

describe('V277 radical_inverse', () => {
  it('reverse_bits_n known + involution (scalar)', async () => {
    if (!device) return;
    // a = value, b = bits
    const out = await dispatchU32('reverse_bits_n(a, b)', [[1, 4], [8, 4], [0b1011, 4]]);
    expect(out[0]).toBe(8);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(13);            // 0b1011 -> 0b1101
    const back = await dispatchU32('reverse_bits_n(a, b)', [[13, 4]]);
    expect(back[0]).toBe(0b1011);       // involution at fixed width
  });
  it('matches warpFn oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_radical_inverse');
    const oracle = makeOracle(12, 1.0, jsRev(12));
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5], [0.13, 0.77]] as const;
    const out = await dispatchWarp('var_radical_inverse', fnBody, pts, '1.0, 12.0');
    for (let i = 0; i < pts.length; i++) {
      const e = oracle(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
    }
  });
  it('bounded inside extent across [-3,3] sweep', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_radical_inverse');
    const pts: Array<[number, number]> = [];
    for (let v = -3; v <= 3; v += 0.5) pts.push([v, -v]);
    const out = await dispatchWarp('var_radical_inverse', fnBody, pts, '1.0, 12.0');
    for (let i = 0; i < pts.length * 2; i++) { expect(Number.isFinite(out[i]!)).toBe(true); expect(Math.abs(out[i]!)).toBeLessThan(1.0); }
  });
});

describe('V278 gray_code', () => {
  it('gray_encode canonical 3-bit sequence + single-bit adjacency (scalar)', async () => {
    if (!device) return;
    const out = await dispatchU32('gray_encode(a)', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
    expect(Array.from(out)).toEqual([0, 1, 3, 2, 6, 7]);
    // adjacency: popcount(g(i) ^ g(i+1)) == 1 for i=0..7
    const adj = await dispatchU32('gray_encode(a) ^ gray_encode(b)', Array.from({ length: 8 }, (_, i) => [i, i + 1] as [number, number]));
    for (const v of adj) { expect(v & (v - 1)).toBe(0); expect(v).not.toBe(0); }   // exactly one bit set
  });
  it('matches warpFn oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_gray_code');
    const oracle = makeOracle(12, 1.0, jsGray);
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchWarp('var_gray_code', fnBody, pts, '1.0, 12.0');
    for (let i = 0; i < pts.length; i++) {
      const e = oracle(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
    }
  });
});

describe('V279 morton_zorder', () => {
  it('morton_code known interleave + corner fixed points (scalar)', async () => {
    if (!device) return;
    // call form: morton_code(a, b, 2)
    const out = await dispatchU32('morton_code(a, b, 2u)', [[0b11, 0b00], [0b00, 0b11], [0, 0], [3, 3]]);
    expect(out[0]).toBe(5);    // x=0b11 -> even positions 0b0101
    expect(out[1]).toBe(10);   // y=0b11 -> odd positions  0b1010
    expect(out[2]).toBe(0);    // origin
    expect(out[3]).toBe(15);   // all-ones (m=3) interleaves to 2^4-1
  });
  it('matches warpFn oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_morton_zorder');
    // oracle for morton is the split-fold, not a simple permutation
    const bits = 8, extent = 1.0;
    const levels = Math.pow(2, bits), s = Math.max(extent, 1e-4), mask = (Math.pow(2, bits) - 1) >>> 0;
    const enc = (c: number) => { const norm = (c + s) / (2 * s); const folded = norm - Math.floor(norm); return Math.min((folded * levels) | 0, levels - 1) >>> 0; };
    const part = (v: number) => { let r = 0; for (let i = 0; i < bits; i++) { r = (r | (((v >>> i) & 1) << (i * 2))) >>> 0; } return r >>> 0; };
    const dec = (i: number) => ((i + 0.5) / levels) * 2 * s - s;
    const oracle = (x: number, y: number): [number, number] => { const code = (part(enc(x)) | (part(enc(y)) << 1)) >>> 0; return [dec(code & mask), dec((code >>> bits) & mask)]; };
    const pts = [[0.5, 0.3], [-0.7, 0.4], [0.9, -0.5]] as const;
    const out = await dispatchWarp('var_morton_zorder', fnBody, pts, '1.0, 8.0');
    for (let i = 0; i < pts.length; i++) {
      const e = oracle(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
    }
  });
  it('bounded inside extent across [-3,3] sweep', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_morton_zorder');
    const pts: Array<[number, number]> = [];
    for (let v = -3; v <= 3; v += 0.5) pts.push([v, -v]);
    const out = await dispatchWarp('var_morton_zorder', fnBody, pts, '1.0, 8.0');
    for (let i = 0; i < pts.length * 2; i++) { expect(Number.isFinite(out[i]!)).toBe(true); expect(Math.abs(out[i]!)).toBeLessThan(1.0); }
  });
});
