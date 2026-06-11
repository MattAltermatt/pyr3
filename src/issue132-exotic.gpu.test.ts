// @vitest-environment node
//
// #132 — Exotic warps (V271–V272): nbody_lensing, curl_noise. nbody is pure
// softened-gravity arithmetic; curl_noise depends on a bit-identical TS↔WGSL
// hash mirror (Math.imul + >>>0 unsigned discipline) for its value-noise
// potential — the cross-check below is the load-bearing guard on that mirror,
// including negative-coordinate lattice cells.
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

const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
const VCORNER = extractWgslFn(SHADER_SRC, 'vnoise_corner');
const VNOISE = extractWgslFn(SHADER_SRC, 'value_noise2');
const NPULL = extractWgslFn(SHADER_SRC, 'nbody_pull');

const PRELUDE = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.28318530717958647692;
${HASH01}
${VCORNER}
${VNOISE}
${NPULL}
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

// ── JS oracles ──
function jsNbody(x: number, y: number): [number, number] {
  const c1x=-0.4,c1y=0.0,c2x=0.4,c2y=0.0,m1=0.06,m2=0.06,g=1.0;
  const e=Math.max(0.05,5e-3);
  const pull=(cx: number,cy: number,m: number): [number, number]=>{ const dx=cx-x, dy=cy-y; const r2=dx*dx+dy*dy+e; const inv=g*m/(r2*Math.sqrt(r2)); return [inv*dx, inv*dy]; };
  const a=pull(c1x,c1y,m1); const b=pull(c2x,c2y,m2);
  return [x+a[0]+b[0], y+a[1]+b[1]];
}
const jsHash01 = (n: number) => { let h = n >>> 0; h = (h ^ (h >>> 17)) >>> 0; h = Math.imul(h, 0xed5ad4bb) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = Math.imul(h, 0xac4c1b51) >>> 0; h = (h ^ (h >>> 15)) >>> 0; return h / 4294967296; };
const jsCorner = (ix: number, iy: number) => { const ux = Math.imul(ix >>> 0, 0x9e3779b1) >>> 0; const uy = Math.imul(iy >>> 0, 0x85ebca77) >>> 0; return jsHash01((ux ^ uy) >>> 0) * 2 - 1; };
const jsVn = (px: number, py: number) => { const fx = Math.floor(px), fy = Math.floor(py); const ix = fx | 0, iy = fy | 0; const tx = px - fx, ty = py - fy; const ux = tx*tx*(3-2*tx), uy = ty*ty*(3-2*ty); const c00 = jsCorner(ix, iy), c10 = jsCorner(ix+1, iy), c01 = jsCorner(ix, iy+1), c11 = jsCorner(ix+1, iy+1); const bottom = c00 + (c10-c00)*ux, top = c01 + (c11-c01)*ux; return bottom + (top-bottom)*uy; };
function jsCurl(x: number, y: number): [number, number] {
  const f = Math.max(2.5, 1e-3), amp = 0.3; const sx = x*f, sy = y*f, h = 1e-2;
  const ddx = (jsVn(sx+h,sy)-jsVn(sx-h,sy))/(2*h);
  const ddy = (jsVn(sx,sy+h)-jsVn(sx,sy-h))/(2*h);
  let dx = ddy, dy = -ddx;
  dx = Math.max(-8, Math.min(8, dx)); dy = Math.max(-8, Math.min(8, dy));
  return [x + amp*dx, y + amp*dy];
}

describe('V271 nbody_lensing', () => {
  const P = '-0.4, 0.0, 0.4, 0.0, 0.06, 0.06, 1.0, 0.05';
  it('matches softened-gravity oracle (TS↔WGSL)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_nbody_lensing');
    const pts = [[0.5, 0.3], [-0.7, 0.4], [1.0, -0.5], [0.2, 0.6]] as const;
    const out = await dispatchKernel('var_nbody_lensing', fnBody, pts, P);
    for (let i = 0; i < pts.length; i++) {
      const e = jsNbody(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(e[0], 4);
      expect(out[i*2+1]).toBeCloseTo(e[1], 4);
    }
  });
  it('y-axis symmetry: zero net x-displacement', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_nbody_lensing');
    const out = await dispatchKernel('var_nbody_lensing', fnBody, [[0.0, 0.5]], P);
    expect(Math.abs(out[0]!)).toBeLessThan(1e-4);
  });
  it('m1=m2=0 is the identity', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_nbody_lensing');
    const pts = [[0.3, 0.4], [-0.6, 0.2]] as const;
    const out = await dispatchKernel('var_nbody_lensing', fnBody, pts, '-0.4, 0.0, 0.4, 0.0, 0.0, 0.0, 1.0, 0.05');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 5);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 5);
    }
  });
  it('finite at an exact attractor (ε softening)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_nbody_lensing');
    const out = await dispatchKernel('var_nbody_lensing', fnBody, [[-0.4, 0.0]], '-0.4, 0.0, 0.4, 0.0, 1.0, 1.0, 4.0, 0.005');
    expect(Number.isFinite(out[0]!)).toBe(true);
    expect(Number.isFinite(out[1]!)).toBe(true);
  });
});

describe('V272 curl_noise', () => {
  it('matches value-noise curl oracle, incl. negative-coordinate cells (hash mirror)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_curl_noise');
    // Mix of positive and negative coords to exercise the negative-lattice
    // bitcast<u32>(i32) ↔ JS (n>>>0) two's-complement mirror.
    const pts = [[0.5, 0.3], [-0.7, 0.4], [-1.2, -0.9], [0.9, -0.5]] as const;
    const out = await dispatchKernel('var_curl_noise', fnBody, pts, '2.5, 0.3');
    for (let i = 0; i < pts.length; i++) {
      const e = jsCurl(pts[i]![0], pts[i]![1]);
      expect(out[i*2]).toBeCloseTo(e[0], 3);
      expect(out[i*2+1]).toBeCloseTo(e[1], 3);
    }
  });
  it('amp=0 is the identity', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_curl_noise');
    const pts = [[0.5, 0.3], [-0.7, 0.4]] as const;
    const out = await dispatchKernel('var_curl_noise', fnBody, pts, '2.5, 0.0');
    for (let i = 0; i < pts.length; i++) {
      expect(out[i*2]).toBeCloseTo(pts[i]![0], 6);
      expect(out[i*2+1]).toBeCloseTo(pts[i]![1], 6);
    }
  });
  it('deterministic + bounded displacement (< 3.4 at default amp)', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_curl_noise');
    const pts: Array<[number, number]> = [];
    for (let a = 0; a < 6.2; a += 0.5) pts.push([Math.cos(a), Math.sin(a)]);
    const out1 = await dispatchKernel('var_curl_noise', fnBody, pts, '2.5, 0.3');
    const out2 = await dispatchKernel('var_curl_noise', fnBody, pts, '2.5, 0.3');
    for (let i = 0; i < pts.length; i++) {
      expect(out1[i*2]).toBeCloseTo(out2[i*2]!, 6);   // determinism
      const dlen = Math.hypot(out1[i*2]! - pts[i]![0], out1[i*2+1]! - pts[i]![1]);
      expect(dlen).toBeLessThan(3.4);
    }
  });
});
