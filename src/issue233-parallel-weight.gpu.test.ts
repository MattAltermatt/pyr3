// @vitest-environment node
//
// #233 regression — var_parallel must NOT scale its tile/height fold terms by
// the variation weight w. JWildfire ParallelFunc emits the per-axis tile and
// height terms with NO pAmount; only the additive move offset is scaled by
// pAmount (verified against ParallelFunc.java). pyr3 used to multiply EVERY
// term by w, so at any non-unit xform variation weight the whole tile lattice
// scaled with w instead of staying fixed — a geometry divergence invisible at
// the w=1.0 catalog default (the only weight the V199-V219 smoke exercises).
//
// Discriminator: D(out) = out(w=2) - 2*out(w=1).
//   - A term scaled by w   (buggy): out(2) = 2*out(1) -> D = 0.
//   - A term independent of w (correct): D = -(that term) != 0.
// Choosing x1width=x2width=0 zeroes the random round(x*log(rand)) tile offset
// (so the tile term is exactly tilesize*p.x, no RNG), and x1height=x2height=0.5
// makes the height contribution branch-independent. So the assertions hold for
// whichever of the two random branches a given invocation takes.

import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

const PRELUDE = `
var<private> rand_counter: u32 = 0u;
fn rand01(wi: u32) -> f32 {
  rand_counter = rand_counter + 1u;
  return f32((wi * 2654435769u + rand_counter) & 0xffffu) / 65536.0;
}
`;

const DISPATCHER = `
struct U { w: f32, pad0: f32, pad1: f32, pad2: f32, p0123: vec4f, p4567: vec4f, p89: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> pts: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> outp: array<vec2f>;

@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  outp[i] = var_parallel(pts[i], u.w,
    u.p0123.x, u.p0123.y, u.p0123.z, u.p0123.w,
    u.p4567.x, u.p4567.y, u.p4567.z, u.p4567.w,
    u.p89.x, u.p89.y, i);
}
`;

const SHADER = PRELUDE + extractWgslFn(SHADER_SRC, 'var_parallel') + DISPATCHER;

// params order: x1width, x1tilesize, x1mod1, x1mod2, x1height, x1move,
//               x2width, x2tilesize, x2mod1, x2mod2   (x2height=0.5, x2move=1 hardcoded)
const TILESIZE = 0.5;
const HEIGHT = 0.5; // == hardcoded x2height -> branch-independent height contribution
const PARAMS = new Float32Array([
  0.0, TILESIZE, 10.0, 1.0, HEIGHT, 3.0, // x1: width=0, mod1=10 (no fold for |p.y|<=10)
  0.0, TILESIZE, 10.0, 1.0,              // x2: width=0, mod1=10
  0.0, 0.0,
]);
// p.x, p.y both nonzero; |p.y| <= mod1 so we stay in the fold-free "else" branch.
const PTS = new Float32Array([0.7, 0.4, -0.6, 0.3, 0.9, -0.5, 1.2, 0.2]);
const N = PTS.length / 2;

async function run(w: number): Promise<Float32Array> {
  const dev = device!;
  const mod = await compileChecked(dev, SHADER);
  const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const uBuf = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ptsBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readback = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  dev.queue.writeBuffer(uBuf, 0, new Float32Array([w, 0, 0, 0]));
  dev.queue.writeBuffer(uBuf, 16, PARAMS);
  dev.queue.writeBuffer(ptsBuf, 0, PTS);
  const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: uBuf } },
    { binding: 1, resource: { buffer: ptsBuf } },
    { binding: 2, resource: { buffer: outBuf } },
  ]});
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N); pass.end();
  enc.copyBufferToBuffer(outBuf, 0, readback, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  return out;
}

describe.skipIf(!device)('#233 var_parallel weight invariant', () => {
  it('tile and height terms are independent of the variation weight w', async () => {
    const w1 = await run(1.0);
    const w2 = await run(2.0);
    for (let i = 0; i < N; i++) {
      const px = PTS[i * 2]!;
      const py = PTS[i * 2 + 1]!;
      // Tile term (x component) carries no w: out_x == tilesize*p.x at every weight.
      const expectedX = TILESIZE * px;
      expect(w1[i * 2]!, `pt ${i} out_x w=1`).toBeCloseTo(expectedX, 5);
      expect(w2[i * 2]!, `pt ${i} out_x w=2`).toBeCloseTo(expectedX, 5);
      // Height term (y component) carries no w; only the move offset does.
      // D = out_y(2) - 2*out_y(1) = -(height contribution) = -HEIGHT*p.y, NOT 0
      // (the buggy w*height form gives D == 0).
      const dY = w2[i * 2 + 1]! - 2 * w1[i * 2 + 1]!;
      expect(dY, `pt ${i} height-term weight leak`).toBeCloseTo(-HEIGHT * py, 5);
    }
  });
});
