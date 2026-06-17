// @vitest-environment node
//
// #334 — readHistogramRgba() reads back the full RGBA accumulation histogram
// for linear-HDR EXR export. We verify the READBACK PLUMBING (copyBufferToBuffer
// + mapAsync) by writing known values straight into the chaos histogram buffer
// and asserting they round-trip — deliberately NO full-kernel dispatch (those
// crash under Dawn+vitest; see the dispatch-crash note). The collapse/normalize
// math is covered separately by export-linear.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { create, globals } from 'webgpu';
import { createChaosPass } from './chaos';

Object.assign(globalThis, globals);

let device: GPUDevice | null = null;
try {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}

afterAll(() => device?.destroy());

describe.skipIf(!device)('readHistogramRgba', () => {
  it('reads back raw RGBA histogram values at super-resolution', async () => {
    const dev = device!;
    const width = 2, height = 2, oversample = 1;
    const pass = createChaosPass(dev, {
      width, height, walkers: 16, itersPerWalker: 16, fuse: 10, oversample,
    });
    // 4 super-pixels × (R,G,B,count) u32 = 16 u32.
    const known = new Uint32Array([
      255, 0, 0, 1,   0, 255, 0, 2,
      0, 0, 255, 3,   100, 100, 100, 4,
    ]);
    dev.queue.writeBuffer(pass.histogram, 0, known);

    const { rgba, superW, superH } = await pass.readHistogramRgba();
    expect(superW).toBe(width);
    expect(superH).toBe(height);
    expect(rgba.length).toBe(width * height * 4);
    expect([...rgba]).toEqual([...known]);

    pass.destroy();
  });
});
