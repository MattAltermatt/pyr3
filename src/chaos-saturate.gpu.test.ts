// @vitest-environment node
//
// #18 (PYR3-058) — the chaos histogram deposit must SATURATE at u32::MAX, not
// wrap. A wrapped count channel reads as low density at the brightest pixel, so
// the density estimator + log tonemap punch a black hole through the peak
// (reachable on a pathological single-pixel attractor at the 4K preset).
//
// This runs the REAL `atomic_add_sat` extracted verbatim from chaos.wgsl on a
// live GPU (dawn via the `webgpu` npm — same runtime as the BE CLI). It skips
// cleanly when no adapter is present (e.g. a GPU-less CI box), keeping the fast
// `npm test` suite green without a GPU while still validating the actual shader
// source locally.
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

// Acquire a device at collection time so describe.skipIf can gate on it.
const { gpu: _gpu, device } = await acquireTestGpu();

afterAll(() => {
  device?.destroy?.();
});

// Extract the shipped helper verbatim — the test validates the real function,
// not a copy. Uses the brace-balanced `extractWgslFn` helper so nested `{`/`}`
// inside the function body are handled correctly (the prior inline regex
// assumed no column-0 `}` until the closing brace, which doesn't generalize).
const SHADER_SRC = CHAOS_WGSL;
const ATOMIC_ADD_SAT = extractWgslFn(SHADER_SRC, 'atomic_add_sat');

describe('#18 — chaos histogram deposit saturates (shader source)', () => {
  it('chaos.wgsl ships a CAS-based atomic_add_sat helper (not plain atomicAdd)', () => {
    expect(ATOMIC_ADD_SAT).toContain('atomicCompareExchangeWeak');
    // The deposit site must route all four channels through the saturating add.
    expect(SHADER_SRC).toContain('atomic_add_sat(base + 3u, count_add)');
    expect(SHADER_SRC).not.toMatch(/atomicAdd\(&hist\[/);
  });
});

describe.skipIf(!device)('#18 — atomic_add_sat pins at u32::MAX on a real GPU', () => {
  it('saturates past 2^32 instead of wrapping (single-pixel-attractor case)', async () => {
    const dev = device!;
    const code = `
@group(0) @binding(0) var<storage, read_write> hist: array<atomic<u32>>;
${ATOMIC_ADD_SAT}
@compute @workgroup_size(1)
fn main() {
  atomic_add_sat(0u, 255u); // bucket near MAX: would wrap -> must saturate
  atomic_add_sat(1u, 255u); // headroom: normal add
  atomic_add_sat(2u, 0u);   // delta==0: no-op fast path
  atomic_add_sat(3u, 255u); // exact boundary: lands on MAX precisely
  atomic_add_sat(4u, 256u); // one past boundary: must saturate, not wrap to 0
}`;
    const N = 8;
    const buf = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const MAX = 0xffffffff;
    const init = new Uint32Array(N);
    init[0] = MAX - 100; // + 255 overflows by 154
    init[1] = 1000; // + 255 = 1255
    init[2] = 500; // + 0 = 500
    init[3] = MAX - 255; // + 255 = exactly MAX
    init[4] = MAX - 255; // + 256 overflows by 1
    dev.queue.writeBuffer(buf, 0, init);

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: await compileChecked(dev, code), entryPoint: 'main' },
    });
    const bindGroup = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    const readback = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(buf, 0, readback, 0, N * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    expect(out[0]).toBe(MAX); // saturated (NOT 154 — the wrap the bug produced)
    expect(out[1]).toBe(1255); // normal add unaffected
    expect(out[2]).toBe(500); // delta==0 no-op
    expect(out[3]).toBe(MAX); // exact boundary lands on MAX
    expect(out[4]).toBe(MAX); // one-past saturates (NOT 0)

    buf.destroy();
    readback.destroy();
  });
});
