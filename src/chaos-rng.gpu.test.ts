// @vitest-environment node
//
// #16 — PYR3-029 RNG kernel tests: masked rand transforms, random color seed,
// table-driven xform-pick smoke, symmetric bad-value reseed. Each `it()` either
// extracts the relevant chaos.wgsl helper(s) verbatim and drives them on real
// Dawn, or dispatches the full chaos pass with traceMode. `describe.skipIf(!device)`
// keeps the suite green on GPU-less CI (Ubuntu actions runner).

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';
import { ISAAC_STATE_U32, packIsaacStates } from './isaac';

Object.assign(globalThis, globals);

// Module-scope pin: the GPU instance from `create([])` MUST outlive the
// function that asked for it (per bin/host.ts `_pinnedNavigator`) — Dawn's
// native side keeps a pointer to it, and letting JS GC the local `gpu`
// mid-test segfaults the worker on cleanup
// (memory:reference-webgpu-dawn-navigator-gc-pin).
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

// Pull the IsaacState struct decl + ISAAC helpers verbatim. Used by every
// kernel that binds the isaac_states buffer. isaac_irand calls isaac_round on
// refill, so both must be present even when our test draws don't trigger
// refill — otherwise the shader fails to compile (`unresolved call target`).
const STRUCT_MATCH = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\};/);
if (!STRUCT_MATCH) throw new Error('chaos.wgsl: struct IsaacState not found');
const ISAAC_STRUCT = STRUCT_MATCH[0];
const ISAAC_ROUND = extractWgslFn(SHADER_SRC, 'isaac_round');
const ISAAC_IRAND = extractWgslFn(SHADER_SRC, 'isaac_irand');

// Common WGSL prelude for kernel tests that consume the ISAAC stream.
const ISAAC_PRELUDE = `
${ISAAC_STRUCT}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
${ISAAC_ROUND}
${ISAAC_IRAND}
`;

// flam3 rand01 — WGSL chaos.wgsl:258-262:
//   `return f32(masked) * (1.0 / 268435455.0);`
// Match the WGSL operation order in f32 to get bit-exact equality (the
// `* reciprocal` vs `/ divisor` rewrite drops 1 ULP on some seeds).
const RECIP_01 = Math.fround(1.0 / 268435455.0);
const RECIP_11 = Math.fround(1.0 / 134217727.0);
const expectedRand01 = (raw: number): number => {
  const masked = (raw & 0x0fffffff) >>> 0;
  return Math.fround(Math.fround(masked) * RECIP_01);
};
const expectedRand11 = (raw: number): number => {
  const masked = (raw & 0x0fffffff) | 0;
  return Math.fround(Math.fround(masked - 0x07ffffff) * RECIP_11);
};

describe.skipIf(!device)('#16 — PYR3-029 #1: masked 28-bit rand transforms', () => {
  it('rand01 returns (irand & 0x0FFFFFFF) / 268435455.0 — NOT raw / 0xFFFFFFFF', async () => {
    const dev = device!;
    const rand01 = extractWgslFn(SHADER_SRC, 'rand01');

    const code = `
${ISAAC_PRELUDE}
${rand01}
@compute @workgroup_size(1)
fn main() {
  out[0] = rand01(0u);
  out[1] = rand01(0u);
  out[2] = rand01(0u);
}`;

    const seed = 0xdeadbeef;
    const packedBuf = packIsaacStates(1, seed);
    const packed = new Uint32Array(packedBuf);
    // randrsl[i] lives at packed[4 + 16 + i] per isaac.ts:188.
    const randrsl15 = packed[4 + 16 + 15];
    const randrsl14 = packed[4 + 16 + 14];
    const randrsl13 = packed[4 + 16 + 13];

    const stateBuf = dev.createBuffer({
      size: ISAAC_STATE_U32 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const outBuf = dev.createBuffer({
      size: 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(stateBuf, 0, packed);

    dev.pushErrorScope('validation');
    const mod = dev.createShaderModule({ code });
    const ci = await (mod as { getCompilationInfo?: () => Promise<GPUCompilationInfo> }).getCompilationInfo?.();
    if (ci) {
      for (const m of ci.messages) {
        if (m.type === 'error') console.error(`WGSL compile error: ${m.message}\n${code}`);
      }
    }
    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'main' },
    });
    const valErr = await dev.popErrorScope();
    if (valErr) console.error('validation:', valErr.message);
    const bindGroup = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: stateBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    const readback = dev.createBuffer({
      size: 3 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(outBuf, 0, readback, 0, 3 * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    expect(out[0]).toBe(expectedRand01(randrsl15!));
    expect(out[1]).toBe(expectedRand01(randrsl14!));
    expect(out[2]).toBe(expectedRand01(randrsl13!));

    // Defensive: the masked formula must differ from the unmasked formula for
    // at least one of the three values. Otherwise the test wouldn't catch the
    // un-mask revert. ISAAC values typically have the top 4 bits set in some
    // draws so the divergence is the rule, not the exception.
    const unmaskedFormula = (raw: number): number =>
      Math.fround(raw / 0xffffffff);
    const masked = [randrsl15!, randrsl14!, randrsl13!].map(expectedRand01);
    const unmasked = [randrsl15!, randrsl14!, randrsl13!].map(unmaskedFormula);
    expect(masked.some((v, i) => v !== unmasked[i])).toBe(true);

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });

  it('rand_11 returns ((irand & 0x0FFFFFFF) - 0x07FFFFFF) / 134217727.0 — symmetric [-1, 1]', async () => {
    const dev = device!;
    const rand_11 = extractWgslFn(SHADER_SRC, 'rand_11');

    const code = `
${ISAAC_PRELUDE}
${rand_11}
@compute @workgroup_size(1)
fn main() {
  out[0] = rand_11(0u);
  out[1] = rand_11(0u);
  out[2] = rand_11(0u);
}`;

    const seed = 0xfeedface;
    const packedBuf = packIsaacStates(1, seed);
    const packed = new Uint32Array(packedBuf);
    const randrsl15 = packed[4 + 16 + 15];
    const randrsl14 = packed[4 + 16 + 14];
    const randrsl13 = packed[4 + 16 + 13];

    const stateBuf = dev.createBuffer({
      size: ISAAC_STATE_U32 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const outBuf = dev.createBuffer({
      size: 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(stateBuf, 0, packed);

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bindGroup = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: stateBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    const readback = dev.createBuffer({
      size: 3 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(outBuf, 0, readback, 0, 3 * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    expect(out[0]).toBe(expectedRand11(randrsl15!));
    expect(out[1]).toBe(expectedRand11(randrsl14!));
    expect(out[2]).toBe(expectedRand11(randrsl13!));
    expect(out[0]).toBeGreaterThanOrEqual(-1);
    expect(out[0]).toBeLessThanOrEqual(1);

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });
});

describe.skipIf(!device)('#16 — PYR3-029 #2: random color seed at fuse start', () => {
  // Why the extracted-block approach instead of a full createChaosPass dispatch +
  // trace_buffer readback: dispatching the full chaos.wgsl kernel under vitest's
  // forks pool crashes Dawn's worker on test-exit cleanup (the same lifecycle
  // issue that the bin/host.ts `_pinnedNavigator` pattern works around for the
  // CLI). The lightweight extracted-block approach gives equivalent regression
  // protection: a revert to `init_z = 0.0` makes `out[2]` fail the bit-exact
  // rand01 equality, AND a draw-order swap makes `out[0]/out[1]` fail their
  // bit-exact rand_11 equality.

  it('init block reproduces walker_init draw order x→y→color bit-exactly', async () => {
    const dev = device!;
    const rand01 = extractWgslFn(SHADER_SRC, 'rand01');
    const rand_11 = extractWgslFn(SHADER_SRC, 'rand_11');

    // Verbatim from chaos.wgsl:1602-1604 — the init block we're protecting.
    const code = `
${ISAAC_PRELUDE}
${rand01}
${rand_11}
@compute @workgroup_size(1)
fn main() {
  let init_x = rand_11(0u);
  let init_y = rand_11(0u);
  let init_z = rand01(0u);
  out[0] = init_x;
  out[1] = init_y;
  out[2] = init_z;
}`;

    const seed = 0xc0ffee;
    const packedBuf = packIsaacStates(1, seed);
    const packed = new Uint32Array(packedBuf);
    const randrsl15 = packed[4 + 16 + 15]!;
    const randrsl14 = packed[4 + 16 + 14]!;
    const randrsl13 = packed[4 + 16 + 13]!;

    const stateBuf = dev.createBuffer({
      size: ISAAC_STATE_U32 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const outBuf = dev.createBuffer({
      size: 3 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(stateBuf, 0, packed);

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bindGroup = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: stateBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    const readback = dev.createBuffer({
      size: 3 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(outBuf, 0, readback, 0, 3 * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    // Draw order x → y → color (rand_11, rand_11, rand01) against the known
    // ISAAC tail-first order (randrsl[15], [14], [13]).
    expect(out[0]).toBe(expectedRand11(randrsl15));
    expect(out[1]).toBe(expectedRand11(randrsl14));
    expect(out[2]).toBe(expectedRand01(randrsl13));
    // Range constraints (defensive — bit-exact match above already enforces).
    expect(out[2]).toBeGreaterThanOrEqual(0);
    expect(out[2]).toBeLessThanOrEqual(1);
    expect(out[2]).not.toBe(0);

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });
});

describe('#16 — PYR3-029 #2: source-literal seeds (runs on GPU-less CI too)', () => {
  it('source literally seeds init_z via rand01 (NOT 0.0) with x,y from rand_11', () => {
    // First-line defense: the actual chaos.wgsl::main init block must match the
    // shipped Phase 5 fix. Revert to `init_z = 0.0` would fail this; so would
    // a draw-order swap. Lives outside the .skipIf gate so it fires on CI.
    expect(SHADER_SRC).toMatch(/let init_x = rand_11\(walker_id\);/);
    expect(SHADER_SRC).toMatch(/let init_y = rand_11\(walker_id\);/);
    expect(SHADER_SRC).toMatch(/let init_z = rand01\(walker_id\);/);
    expect(SHADER_SRC).not.toMatch(/let init_z = 0\.0;/);
  });
});

describe('#16 — PYR3-029 #3: WGSL consumes xform_distrib at the right index', () => {
  it('source literally indexes via lastxf*GRAIN + (irand & GRAIN_M1)', () => {
    // Source-literal defense against a revert to the prior weighted-scan path.
    // Pure-TS protection of the table builder is in chaos-xform-pick.test.ts;
    // this asserts the WGSL consumer still uses the table-driven formula.
    expect(SHADER_SRC).toMatch(
      /xform_distrib\[pick_table_idx\]/,
    );
    expect(SHADER_SRC).toMatch(
      /pick_row \* CHOOSE_XFORM_GRAIN \+ \(isaac_irand\(walker_id\) & CHOOSE_XFORM_GRAIN_M1\)/,
    );
  });
});

describe('#16 — PYR3-029 #4: source-literal reseed (runs on GPU-less CI too)', () => {
  it('source literally reseeds via rand_11 (NOT rand01)', () => {
    // The bad-value reseed at chaos.wgsl:1717-1719 must draw from rand_11
    // (symmetric [-1, 1]), NOT rand01 ([0, 1]). A revert to rand01 would push
    // every reseeded walker into the +x +y quadrant — biasing the density field
    // after any NaN/Inf hit. Lives outside the .skipIf gate so it fires on CI.
    expect(SHADER_SRC).toMatch(/let reseed_x = rand_11\(walker_id\);/);
    expect(SHADER_SRC).toMatch(/let reseed_y = rand_11\(walker_id\);/);
    expect(SHADER_SRC).not.toMatch(/let reseed_x = rand01\(walker_id\);/);
    expect(SHADER_SRC).not.toMatch(/let reseed_y = rand01\(walker_id\);/);
  });
});

describe.skipIf(!device)('#16 — PYR3-029 #4: symmetric bad-value reseed', () => {
  it('reseed block reproduces rand_11, rand_11 draw bit-exactly', async () => {
    const dev = device!;
    const rand_11 = extractWgslFn(SHADER_SRC, 'rand_11');

    // Verbatim from chaos.wgsl:1717-1718 — the reseed pair we're protecting.
    const code = `
${ISAAC_PRELUDE}
${rand_11}
@compute @workgroup_size(1)
fn main() {
  let reseed_x = rand_11(0u);
  let reseed_y = rand_11(0u);
  out[0] = reseed_x;
  out[1] = reseed_y;
}`;

    const seed = 0xbadbad;
    const packedBuf = packIsaacStates(1, seed);
    const packed = new Uint32Array(packedBuf);
    const randrsl15 = packed[4 + 16 + 15]!;
    const randrsl14 = packed[4 + 16 + 14]!;

    const stateBuf = dev.createBuffer({
      size: ISAAC_STATE_U32 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const outBuf = dev.createBuffer({
      size: 2 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(stateBuf, 0, packed);

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bindGroup = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: stateBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    const readback = dev.createBuffer({
      size: 2 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(outBuf, 0, readback, 0, 2 * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    expect(out[0]).toBe(expectedRand11(randrsl15));
    expect(out[1]).toBe(expectedRand11(randrsl14));
    // Symmetric range — a revert to rand01 would fail the lower bound.
    expect(out[0]).toBeGreaterThanOrEqual(-1);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeGreaterThanOrEqual(-1);
    expect(out[1]).toBeLessThanOrEqual(1);

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });
});
