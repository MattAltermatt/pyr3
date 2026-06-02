// @vitest-environment node
//
// #72 — safe_sin / safe_cos guard against Dawn's f32 trig range cliff.
//
// Dawn's f32 `sin`/`cos` return exactly 0 for |arg| ≳ 1e7 (their range-reduction
// limit). Variations that feed trig a non-angle-bounded argument (waves with a
// degenerate coef → sin(p·1e10), swirl's sin(r²), disc's sin(π·r), …) therefore
// silently degenerate on the GPU — e.g. waves → the identity transform, which
// collapsed electricsheep.248.25703's attractor coverage 3× (R 14→2.2 once
// fixed). `safe_sin`/`safe_cos` use Dawn's trig below a safe threshold and a
// deterministic, bounded pseudo-spread above it.
//
// This validates the SHIPPED helpers extracted verbatim from chaos.wgsl on a
// live GPU (Dawn via the `webgpu` npm — same runtime as the BE CLI). Skips
// cleanly when no adapter is present, so the GPU-less fast suite stays green
// while still asserting the source-level invariant below.
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';

Object.assign(globalThis, globals);

let device: GPUDevice | null = null;
try {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8');

describe('#72 — chaos.wgsl ships safe_sin/safe_cos (source invariant)', () => {
  it('var_waves routes trig through safe_sin (not raw sin)', () => {
    const waves = extractWgslFn(SHADER_SRC, 'var_waves');
    expect(waves).toContain('safe_sin(');
    expect(waves).not.toMatch(/[^_]\bsin\(/); // no un-wrapped sin( in waves
  });
  it('defines safe_sin and safe_cos', () => {
    expect(SHADER_SRC).toContain('fn safe_sin(');
    expect(SHADER_SRC).toContain('fn safe_cos(');
  });
});

describe.skipIf(!device)('#72 — safe_sin/safe_cos tame Dawn f32 trig cliff (real GPU)', () => {
  it('Dawn sin/cos cliff to 0 at 1e10, but safe_* stay bounded and non-zero', async () => {
    const dev = device!;
    const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
    const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
    const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
    // Args MUST come from a buffer (runtime values). A literal like `sin(1.0e10)`
    // is constant-folded by the WGSL compiler at full host precision (→ correct
    // result), which masks the runtime f32 trig cliff this test is about.
    const code = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TAU: f32 = 6.2831853071795864769;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(1)
fn main() {
  let big = a[0];   // 1e10 — past Dawn's range-reduction limit
  let small = a[1]; // 0.5  — well within range
  o[0] = sin(big);         // raw Dawn → expect 0 (the cliff)
  o[1] = safe_sin(big);    // fixed → non-zero, bounded
  o[2] = cos(big);         // raw Dawn → expect 0
  o[3] = safe_cos(big);    // fixed → non-zero, bounded
  o[4] = safe_sin(small);  // below threshold → must equal sin(small)
  o[5] = sin(small);
  o[6] = safe_cos(small);  // below threshold → must equal cos(small)
  o[7] = cos(small);
}`;
    const N = 8;
    const inBuf = dev.createBuffer({ size: 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(inBuf, 0, new Float32Array([1e10, 0.5]));
    const buf = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' } });
    const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: buf } }] });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
    const rb = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(buf, 0, rb, 0, N * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const o = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap(); buf.destroy(); rb.destroy();

    const [rawSinBig, safeSinBig, rawCosBig, safeCosBig, safeSinSmall, sinSmall, safeCosSmall, cosSmall] =
      o as [number, number, number, number, number, number, number, number];

    // Dawn's raw f32 trig cliffs to 0 for the huge argument (the documented bug).
    expect(rawSinBig).toBe(0);
    expect(rawCosBig).toBe(0);
    // safe_* recover a bounded, non-zero spread.
    expect(Math.abs(safeSinBig)).toBeGreaterThan(0);
    expect(Math.abs(safeSinBig)).toBeLessThanOrEqual(1);
    expect(Math.abs(safeCosBig)).toBeGreaterThan(0);
    expect(Math.abs(safeCosBig)).toBeLessThanOrEqual(1);
    // safe_sin/safe_cos of the SAME huge arg share one hashed angle → (sin,cos)
    // stays a consistent unit-circle pair.
    expect(safeSinBig * safeSinBig + safeCosBig * safeCosBig).toBeCloseTo(1, 4);
    // Below the threshold safe_* are exactly the native trig (faithful path).
    expect(safeSinSmall).toBe(sinSmall);
    expect(safeCosSmall).toBe(cosSmall);
  });
});
