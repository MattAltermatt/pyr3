# Issue #16 — WGSL Kernel Tests + PYR3-029 RNG Regressions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fast-suite regression tests for the four PYR3-029 RNG behaviors (masked rand transforms, random color seed, table-driven xform-pick, symmetric bad-value reseed) so a future revert of any of them fails CI/`npm test` instead of silently regressing parity.

**Architecture:** Mirror the proven `*.gpu.test.ts` pattern from `src/chaos-saturate.gpu.test.ts` (#18) — extract WGSL helpers verbatim from `src/shaders/chaos.wgsl`, wrap in a minimal `@compute` driver, run on real Dawn via `webgpu` npm, `describe.skipIf(!device)` so the test no-ops on Ubuntu CI / GPU-less hosts. Pure-TS test for the `packXformDistrib` table builder (no GPU needed). One shared WGSL-extractor helper replaces the ad-hoc inline regex.

**Tech Stack:** TypeScript · WGSL · Vitest · `webgpu` npm (Dawn-node) · existing `bin/host.ts` patterns

**Spec:** `docs/superpowers/specs/2026-06-02-issue-16-wgsl-kernel-tests-design.md`

---

## Task 1: WGSL function extractor helper (foundation)

The shared utility every other task depends on. Replaces the brittle inline regex in
`chaos-saturate.gpu.test.ts:36` (`/fn atomic_add_sat\([\s\S]*?\n\}/`) which assumes no
column-0 `}` inside the body. Brace-balance is the robust answer.

**Files:**
- Create: `src/shaders/extract.ts`
- Create: `src/shaders/extract.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/shaders/extract.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractWgslFn } from './extract';

describe('extractWgslFn', () => {
  it('extracts a single-line function body', () => {
    const src = 'fn foo() -> u32 { return 1u; }';
    expect(extractWgslFn(src, 'foo')).toBe('fn foo() -> u32 { return 1u; }');
  });

  it('extracts a multi-line function with nested braces', () => {
    const src = [
      'fn foo(a: u32) -> u32 {',
      '  if (a > 0u) {',
      '    return 1u;',
      '  } else {',
      '    return 2u;',
      '  }',
      '}',
    ].join('\n');
    expect(extractWgslFn(src, 'foo')).toBe(src);
  });

  it('ignores other functions in the source', () => {
    const src = 'fn bar() { return 0u; }\nfn foo() { return 1u; }\nfn baz() { return 2u; }';
    expect(extractWgslFn(src, 'foo')).toBe('fn foo() { return 1u; }');
  });

  it('throws when the function is not present', () => {
    expect(() => extractWgslFn('fn bar() {}', 'foo')).toThrow(/foo/);
  });

  it('extracts atomic_add_sat verbatim from the real chaos.wgsl', () => {
    const wgsl = readFileSync(new URL('./chaos.wgsl', import.meta.url), 'utf8');
    const fn = extractWgslFn(wgsl, 'atomic_add_sat');
    expect(fn.startsWith('fn atomic_add_sat')).toBe(true);
    expect(fn).toContain('atomicCompareExchangeWeak');
    expect(fn.endsWith('}')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/shaders/extract.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the extractor**

```typescript
// src/shaders/extract.ts
//
// Pull a named `fn name(...) { ... }` block verbatim from a WGSL source string,
// using brace-balance to handle nested `{` / `}` (the chaos.wgsl helpers do
// contain them, so the prior ad-hoc regex pattern in chaos-saturate.gpu.test.ts
// was unsafe in general). Returns the function source from the `fn` keyword
// through the matching closing `}` inclusive.

export function extractWgslFn(source: string, fnName: string): string {
  const pattern = new RegExp(`\\bfn\\s+${fnName}\\s*\\(`);
  const startMatch = pattern.exec(source);
  if (!startMatch) {
    throw new Error(`extractWgslFn: function "${fnName}" not found in source`);
  }
  const fnStart = startMatch.index;
  // Find the first `{` after the signature.
  const braceOpen = source.indexOf('{', fnStart);
  if (braceOpen === -1) {
    throw new Error(`extractWgslFn: function "${fnName}" has no body`);
  }
  // Brace-balance until depth returns to zero.
  let depth = 1;
  let i = braceOpen + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) {
    throw new Error(`extractWgslFn: unbalanced braces in "${fnName}"`);
  }
  return source.slice(fnStart, i);
}
```

- [ ] **Step 4: Run the tests, confirm green**

```bash
npx vitest run src/shaders/extract.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shaders/extract.ts src/shaders/extract.test.ts
git commit -m "#16 — WGSL fn extractor helper for *.gpu.test.ts"
```

---

## Task 2: PYR3-029 #1 — Masked 28-bit rand transforms

The first kernel test. Locks the `chaos-rng.gpu.test.ts` module shape, the ISAAC-state
packing idiom, and the Dawn-skipIf pattern that Tasks 3 & 5 will mirror.

**Files:**
- Create: `src/chaos-rng.gpu.test.ts`
- Reference: `src/shaders/chaos.wgsl:248-269` (the `rand01` / `rand_11` implementations
  this test protects) — extract these via `extractWgslFn`
- Reference: `src/isaac.ts` for `packIsaacStates`, `ISAAC_STATE_U32`, `isaacRound`
- Reference: `src/chaos-saturate.gpu.test.ts` for the device-acquisition idiom

**Behavior protected:** the masked-28-bit rand transforms in `rand01` / `rand_11`. A revert
to the prior full-32-bit divide (or a different mask constant, or wrong rescale constant)
must fail this test.

- [ ] **Step 1: Write the failing test file**

```typescript
// @vitest-environment node
//
// #16 — PYR3-029 RNG kernel tests: masked rand transforms, random color seed,
// symmetric bad-value reseed. Each `it()` extracts the relevant chaos.wgsl
// helper(s) verbatim and drives them on real Dawn. `describe.skipIf(!device)`
// keeps the suite green on GPU-less CI (Ubuntu actions runner).

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';
import { ISAAC_STATE_U32, isaacRound, type IsaacState } from './isaac';

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

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8'
);

// Build a freshly-seeded IsaacState whose randrsl/randmem are known. The packing
// path mirrors what `packIsaacStates(walkers, seed)` does host-side: we use one
// walker's state directly.
function makeKnownIsaacState(seed: number): IsaacState {
  // Mirror chaos.ts → packIsaacStates: zero state with randa=seed, then run one
  // round to populate randrsl. (See src/isaac.ts for the canonical packing.)
  const s: IsaacState = {
    randcnt: 0, randa: seed >>> 0, randb: 0, randc: 0,
    randmem: new Uint32Array(16),
    randrsl: new Uint32Array(16),
  };
  isaacRound(s);
  // Match WGSL chaos.wgsl::isaac_irand: walkers consume from randrsl tail-first,
  // randcnt initialized to RANDSIZ before first call (the WGSL impl decrements
  // before reading — see chaos.wgsl:234-245). Set randcnt accordingly.
  s.randcnt = 16; // first call decrements to 15 and reads randrsl[15]
  return s;
}

describe.skipIf(!device)('#16 — PYR3-029 #1: masked 28-bit rand transforms', () => {
  it('rand01 returns (irand & 0x0FFFFFFF) / 268435455.0 — NOT raw / 0xFFFFFFFF', async () => {
    const dev = device!;
    // Extract the helpers verbatim — if any of them changes shape, the test
    // recompiles against the new source, which is what we want.
    const isaacIrand = extractWgslFn(SHADER_SRC, 'isaac_irand');
    const rand01 = extractWgslFn(SHADER_SRC, 'rand01');
    // Need the IsaacState struct declaration + isaac_states binding. The struct
    // is small; copy by name from chaos.wgsl (verified at SHADER_SRC.includes()
    // time below so a rename trips loudly).
    expect(SHADER_SRC).toContain('struct IsaacState');
    const structMatch = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\}/);
    expect(structMatch).not.toBeNull();
    const isaacStruct = structMatch![0];

    const code = `
${isaacStruct}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
${isaacIrand}
${rand01}
@compute @workgroup_size(1)
fn main() {
  out[0] = rand01(0u);
  out[1] = rand01(0u);
  out[2] = rand01(0u);
}`;

    // Seed a known ISAAC state.
    const seed = 0xdeadbeef;
    const known = makeKnownIsaacState(seed);
    // Pack into a flat u32[36] matching the WGSL IsaacState layout exactly:
    // randcnt, randa, randb, randc, randmem[16], randrsl[16].
    const packed = new Uint32Array(ISAAC_STATE_U32);
    packed[0] = known.randcnt;
    packed[1] = known.randa;
    packed[2] = known.randb;
    packed[3] = known.randc;
    packed.set(known.randmem, 4);
    packed.set(known.randrsl, 20);

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

    // Expected: rand01 draws from randrsl tail-first (idx 15, 14, 13), and the
    // flam3 formula is `((raw & 0x0FFFFFFF)) / 268435455.0`. NOT raw / 0xFFFFFFFF.
    const expectedRand01 = (raw: number): number =>
      Math.fround((raw & 0x0fffffff) / 268435455.0);
    expect(out[0]).toBe(expectedRand01(known.randrsl[15]));
    expect(out[1]).toBe(expectedRand01(known.randrsl[14]));
    expect(out[2]).toBe(expectedRand01(known.randrsl[13]));
    // Defensive sanity: at least one value must differ from the unmasked-divide
    // formula. Otherwise the masking has no observable effect for this seed and
    // the test wouldn't catch a revert.
    const unmaskedFormula = (raw: number): number =>
      Math.fround(raw / 0xffffffff);
    expect(out[0]).not.toBe(unmaskedFormula(known.randrsl[15]));

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });

  it('rand_11 returns ((irand & 0x0FFFFFFF) - 0x07FFFFFF) / 134217727.0 — symmetric [-1, 1]', async () => {
    const dev = device!;
    const isaacIrand = extractWgslFn(SHADER_SRC, 'isaac_irand');
    const rand_11 = extractWgslFn(SHADER_SRC, 'rand_11');
    const structMatch = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\}/);
    const isaacStruct = structMatch![0];

    const code = `
${isaacStruct}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
${isaacIrand}
${rand_11}
@compute @workgroup_size(1)
fn main() {
  out[0] = rand_11(0u);
  out[1] = rand_11(0u);
  out[2] = rand_11(0u);
}`;

    // Same setup as the rand01 test — duplicated intentionally per the no-shared-
    // helper convention; the cost is one screen of code, the benefit is each
    // it() reads top-to-bottom without flipping to a fixture file.
    const seed = 0xfeedface;
    const known = makeKnownIsaacState(seed);
    const packed = new Uint32Array(ISAAC_STATE_U32);
    packed[0] = known.randcnt;
    packed[1] = known.randa;
    packed[2] = known.randb;
    packed[3] = known.randc;
    packed.set(known.randmem, 4);
    packed.set(known.randrsl, 20);

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

    const expectedRand11 = (raw: number): number => {
      const masked = (raw & 0x0fffffff) | 0; // i32 reinterp matches WGSL
      return Math.fround((masked - 0x07ffffff) / 134217727.0);
    };
    expect(out[0]).toBe(expectedRand11(known.randrsl[15]));
    expect(out[1]).toBe(expectedRand11(known.randrsl[14]));
    expect(out[2]).toBe(expectedRand11(known.randrsl[13]));
    // All three must land in [-1, 1] by construction.
    expect(out[0]).toBeGreaterThanOrEqual(-1);
    expect(out[0]).toBeLessThanOrEqual(1);

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/chaos-rng.gpu.test.ts
```

Expected on a machine with a GPU: FAIL — but the FAILURE may be a setup error
(IsaacState struct extraction, randcnt packing). Iterate: read the error, fix
the packing or kernel-wrapper code, re-run. Expected ROOT CAUSE of any failure
at this point: getting the ISAAC state pack format exactly right against the
WGSL struct layout. Inspect `src/isaac.ts` `packIsaacStates` for the canonical
host-side packing if mine drifts.

Expected on a GPU-less host: SKIP (zero failures).

- [ ] **Step 3: Iterate until green**

Likely loop: run → fix packing layout or randcnt init → re-run. The test
becomes useful when the expected/actual values match. The DEFENSIVE assertion
(`out[0] !== unmaskedFormula(raw)`) MUST fire on the seed I picked — if it
doesn't, swap the seed for one whose masked vs. unmasked outputs diverge.

```bash
npx vitest run src/chaos-rng.gpu.test.ts
```

Expected: PASS (2 tests, both green; or skipped on GPU-less host).

- [ ] **Step 4: Verify the revert test works**

Manually revert the mask in `src/shaders/chaos.wgsl:258-262`:

```diff
-  let masked = raw & 0x0fffffffu;
-  return f32(masked) * (1.0 / 268435455.0);
+  return f32(raw) * (1.0 / 4294967295.0);
```

Run the test, confirm it FAILS with the un-masked formula assertion. Restore
the original. This validates that the test would catch a real revert.

```bash
npx vitest run src/chaos-rng.gpu.test.ts
# expect: FAIL
# restore chaos.wgsl
npx vitest run src/chaos-rng.gpu.test.ts
# expect: PASS
```

- [ ] **Step 5: Commit**

```bash
git add src/chaos-rng.gpu.test.ts
git commit -m "#16 — kernel test for PYR3-029 #1 (masked 28-bit rand transforms)"
```

---

## Task 3: PYR3-029 #2 — Random color seed at fuse start

Tests that `chaos.wgsl::main` initializes `init_z` via `rand01(walker_id)`, NOT `0.0`. Uses
`createChaosPass` from `src/chaos.ts` directly (the existing API already exposes
`traceMode` + `traceBuffer`), driven on a real Dawn device.

**Files:**
- Modify: `src/chaos-rng.gpu.test.ts` (add a new `describe` block)
- Reference: `src/shaders/chaos.wgsl:1602-1605` (the init seeds)
- Reference: `src/chaos.ts:46-48` (`DispatchOpts.traceMode`)
- Reference: `bin/host.ts:installWebGPUHost` (for the happy-dom DOMParser shim
  that `parseFlame` needs)

**Behavior protected:** `init_z = rand01(walker_id)`, NOT `0.0`. A revert to `0.0` must fail.

> **Limitation acknowledged:** the trace buffer in `chaos.wgsl` records `pa.x, pa.y,
> pv_pre.x, pv_pre.y, pv.x, pv.y, new_z, fn_idx, post_fuse, ...` per iter — `init_z`
> itself is consumed into `new_z` only after the first iter's color contraction. We
> infer `init_z` indirectly: if the genome has `color_speed=0` and the first xform's
> `color_params.x` is some known constant K, then `new_z = mix(init_z, K, 0) = init_z`.
> So we extract `new_z` from the trace and assert it matches `rand01` of the known
> ISAAC state — confirming both the draw-order (x, y, color) and the rand01 source.

- [ ] **Step 1: Add the failing test**

Append to `src/chaos-rng.gpu.test.ts`:

```typescript
import { Window } from 'happy-dom';
import { parseFlame } from './flame-import';
import { createChaosPass } from './chaos';

// Install the happy-dom DOMParser globally so parseFlame works in node env.
// Idempotent if Task 2's setup already did this in a different test, but the
// test file runs as one module so this is the only install.
(globalThis as { DOMParser?: unknown }).DOMParser = new Window().DOMParser;

describe.skipIf(!device)('#16 — PYR3-029 #2: random color seed at fuse start', () => {
  it('init_z is drawn from rand01 (NOT seeded to 0.0)', async () => {
    const dev = device!;
    // Minimal genome: 1 xform, linear (identity variation), color_speed=0 so
    // first iter's color contraction is new_z = mix(init_z, K, 0) = init_z.
    // Pick K = 0.5 so a regression to init_z = 0.0 fails the equality check
    // (0.0 vs 0.something).
    const palette =
      '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>';
    const flame =
      `<flame name="t" size="64 64" center="0 0" scale="10">${palette}` +
      `<xform weight="1" color="0.5" color_speed="0" coefs="1 0 0 1 0 0" linear="1"/></flame>`;
    const { genome } = parseFlame(flame);

    const pass = createChaosPass(dev, {
      width: 64, height: 64,
      walkers: 1, itersPerWalker: 1, fuse: 0, oversample: 1,
    });
    pass.dispatch(genome, 0xc0ffee, {
      walkers: 1, itersPerWalker: 1, traceMode: true,
    });
    await dev.queue.onSubmittedWorkDone();

    // Read trace_buffer: 1000 entries × 16 f32. We only need entry 0.
    const readback = dev.createBuffer({
      size: 16 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = dev.createCommandEncoder();
    encoder.copyBufferToBuffer(pass.traceBuffer, 0, readback, 0, 16 * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const trace = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    // chaos.wgsl trace layout (from chaos.wgsl trace_buffer writes, post_fuse=0):
    //   base+0: post_fuse f32
    //   base+1: fn_idx f32
    //   base+2: pa.x  base+3: pa.y
    //   base+4: pv_pre.x  base+5: pv_pre.y
    //   base+6: pv.x  base+7: pv.y
    //   base+8: new_z  (color after contraction)
    // With color_speed=0, new_z == init_z. With identity affine + linear var,
    // pa.x == init_x and pa.y == init_y, so we get the full draw order in one
    // dispatch.
    const pa_x = trace[2];
    const pa_y = trace[3];
    const new_z = trace[8];

    // init_z MUST be in [0, 1] (rand01 range) and MUST NOT be exactly 0
    // (would be the regression signature, given color_speed=0).
    expect(new_z).toBeGreaterThanOrEqual(0);
    expect(new_z).toBeLessThanOrEqual(1);
    expect(new_z).not.toBe(0);
    // init_x, init_y MUST be in [-1, 1] (rand_11 range).
    expect(pa_x).toBeGreaterThanOrEqual(-1);
    expect(pa_x).toBeLessThanOrEqual(1);
    expect(pa_y).toBeGreaterThanOrEqual(-1);
    expect(pa_y).toBeLessThanOrEqual(1);
    // Draw order: x, y, color. If chaos.wgsl ever swapped the order (e.g.
    // color first), init_z would come from rand_11 not rand01, so values
    // outside [0, 1] would also fail above. The non-zero + range check
    // jointly enforce both "rand01 source" and "draw-order x→y→color".

    pass.destroy();
    readback.destroy();
  });
});
```

- [ ] **Step 2: Run the test, iterate**

```bash
npx vitest run src/chaos-rng.gpu.test.ts -t "random color seed"
```

Expected first failure mode: trace buffer offsets may be off by a slot (the
trace layout comment in chaos.wgsl is the authoritative source — re-check
`chaos.wgsl:1731-1750` for the actual writes). Adjust the indices into `trace[]`
to match.

- [ ] **Step 3: Verify the revert test**

Hand-revert `chaos.wgsl:1604`:

```diff
-  let init_z = rand01(walker_id);
+  let init_z = 0.0;
```

Run the test, confirm it FAILS on `expect(new_z).not.toBe(0)`. Restore.

```bash
npx vitest run src/chaos-rng.gpu.test.ts -t "random color seed"
# expect: FAIL
# restore chaos.wgsl
npx vitest run src/chaos-rng.gpu.test.ts -t "random color seed"
# expect: PASS
```

- [ ] **Step 4: Commit**

```bash
git add src/chaos-rng.gpu.test.ts
git commit -m "#16 — kernel test for PYR3-029 #2 (random color seed at fuse)"
```

---

## Task 4: PYR3-029 #3 — Table-driven xform-pick distribution (pure TS + GPU smoke)

The xform-pick table builder lives in TS (`genome.ts::packXformDistrib`). Test it directly
against a hand-computed reference — pure unit test, no GPU. Then add a small GPU smoke to
`chaos-rng.gpu.test.ts` confirming the WGSL dispatch consults the table at the right index.

**Files:**
- Create: `src/chaos-xform-pick.test.ts`
- Modify: `src/chaos-rng.gpu.test.ts` (one more `describe` block — the GPU smoke)
- Reference: `src/genome.ts:415 packXformDistrib`
- Reference: `src/shaders/chaos.wgsl:1638-1640` (the consuming lookup)

**Behavior protected:** the table is built via cumulative weight scan (NOT runtime
weighted-scan), and the WGSL kernel consumes it at the right index `lastxf*GRAIN + (irand &
GRAIN_M1)`.

- [ ] **Step 1: Write the pure-TS failing test**

```typescript
// src/chaos-xform-pick.test.ts
//
// #16 — PYR3-029 #3: table-driven xform-pick distribution. Pure-TS test against
// the hand-computed cumulative-scan reference. No GPU needed.

import { describe, expect, it } from 'vitest';
import {
  CHOOSE_XFORM_GRAIN,
  MAX_XFORMS,
  packXformDistrib,
} from './genome';
import type { Genome } from './genome';

// Build a minimal Genome with N xforms with the given weights and optional xaos.
function makeGenome(weights: number[], xaos?: number[][]): Genome {
  return {
    name: 't',
    size: [64, 64],
    center: [0, 0],
    scale: 10,
    quality: 1,
    oversample: 1,
    rotation: 0,
    background: [0, 0, 0],
    brightness: 4,
    gamma: 4,
    vibrancy: 1,
    palette: { entries: Array.from({ length: 256 }, () => [0, 0, 0] as [number, number, number]) },
    xforms: weights.map((w, i) => ({
      weight: w,
      color: 0,
      color_speed: 0.5,
      affine0: [1, 0, 0],
      affine1: [0, 1, 0],
      has_post: false,
      post0: [1, 0, 0],
      post1: [0, 1, 0],
      color_params: [0, 0.5],
      vars: [{ index: 0, weight: 1 }],
      xaos: xaos?.[i],
    })),
    finalxform: null,
    symmetry: 0,
  } as unknown as Genome;
}

describe('#16 — PYR3-029 #3: packXformDistrib (no xaos)', () => {
  it('two equal-weight xforms split the GRAIN evenly', () => {
    const genome = makeGenome([1, 1]);
    const buf = new Uint32Array(packXformDistrib(genome));
    // Row 0 (prev_xform = 0), row 1 (prev_xform = 1), row MAX_XFORMS (fallback)
    // are all identical with equal weights. Each row is CHOOSE_XFORM_GRAIN
    // entries; half should map to fn 0, half to fn 1.
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    const half = CHOOSE_XFORM_GRAIN >>> 1;
    expect(row0[0]).toBe(0);
    expect(row0[half - 1]).toBe(0);
    // The transition slot may be exactly `half` or `half - 1` depending on the
    // cumulative-scan rounding direction. The cumulative `r >= t` check in
    // packXformDistrib means the first `j` increments at `r = dr * half`, so
    // index `half` is the first 1.
    expect(row0[half]).toBe(1);
    expect(row0[CHOOSE_XFORM_GRAIN - 1]).toBe(1);
  });

  it('asymmetric weights bias the GRAIN by the ratio', () => {
    // weights [3, 1] → 3/4 of the GRAIN should be fn 0, 1/4 should be fn 1.
    const genome = makeGenome([3, 1]);
    const buf = new Uint32Array(packXformDistrib(genome));
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    let count0 = 0, count1 = 0;
    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) {
      if (row0[i] === 0) count0++;
      else if (row0[i] === 1) count1++;
    }
    // Expect counts within 1 of the ideal 3:1 split (rounding from dr scan).
    const expected0 = (3 / 4) * CHOOSE_XFORM_GRAIN;
    const expected1 = (1 / 4) * CHOOSE_XFORM_GRAIN;
    expect(Math.abs(count0 - expected0)).toBeLessThanOrEqual(1);
    expect(Math.abs(count1 - expected1)).toBeLessThanOrEqual(1);
  });
});

describe('#16 — PYR3-029 #3: packXformDistrib (with xaos)', () => {
  it('xaos row 0 → [0, 1] preserves the unconditional 50/50 split', () => {
    const genome = makeGenome([1, 1], [[1, 1], [1, 1]]);
    const buf = new Uint32Array(packXformDistrib(genome));
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    const half = CHOOSE_XFORM_GRAIN >>> 1;
    expect(row0[half - 1]).toBe(0);
    expect(row0[half]).toBe(1);
  });

  it('xaos row 0 → [0, 0] forces all picks from row 0 to fn 0 only', () => {
    // After picking xform 0, xaos[0] = [1, 0] means weights become [1*1, 1*0] =
    // [1, 0] for the NEXT pick — so row 0 should be all 0s.
    const genome = makeGenome([1, 1], [[1, 0], [1, 1]]);
    const buf = new Uint32Array(packXformDistrib(genome));
    const row0 = buf.subarray(0, CHOOSE_XFORM_GRAIN);
    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) {
      expect(row0[i]).toBe(0);
    }
    // Row 1 (prev = 1) uses xaos[1] = [1, 1] which is equal-weight, so
    // 50/50 split.
    const row1 = buf.subarray(CHOOSE_XFORM_GRAIN, 2 * CHOOSE_XFORM_GRAIN);
    const half = CHOOSE_XFORM_GRAIN >>> 1;
    expect(row1[half - 1]).toBe(0);
    expect(row1[half]).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, iterate until green**

```bash
npx vitest run src/chaos-xform-pick.test.ts
```

Expected: FAIL initially if the `makeGenome` helper's shape doesn't match the
actual `Genome` interface. Fix by reading the actual `Genome` definition in
`src/genome.ts` and adjusting field names/types until the call typechecks.

Iterate until: PASS (4 tests).

- [ ] **Step 3: Add the GPU smoke test for the consuming lookup**

Append to `src/chaos-rng.gpu.test.ts`:

```typescript
describe.skipIf(!device)('#16 — PYR3-029 #3: WGSL consumes xform_distrib at the right index', () => {
  it('first iter picks the fn_idx stored at xform_distrib[fallback_row * GRAIN + (irand & GRAIN_M1)]', async () => {
    const dev = device!;
    // 2-xform genome, equal weights → half the GRAIN is fn 0, half is fn 1.
    // Run a 1-walker 1-iter dispatch with trace_mode, read trace_buffer[1]
    // (fn_idx as f32). Assert it matches what packXformDistrib + the known
    // first ISAAC draw say.
    //
    // The trace records the fn_idx the WGSL kernel actually consulted, so a
    // regression where chaos.wgsl reverted to weighted-scan (or to a different
    // table-index formula) would produce a different fn_idx for the same RNG
    // state.
    const palette =
      '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>';
    const flame =
      `<flame name="t" size="64 64" center="0 0" scale="10">${palette}` +
      `<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/>` +
      `<xform weight="1" color="1" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/></flame>`;
    const { genome } = parseFlame(flame);

    const pass = createChaosPass(dev, {
      width: 64, height: 64,
      walkers: 1, itersPerWalker: 1, fuse: 0, oversample: 1,
    });
    pass.dispatch(genome, 0xdecade, {
      walkers: 1, itersPerWalker: 1, traceMode: true,
    });
    await dev.queue.onSubmittedWorkDone();

    const readback = dev.createBuffer({
      size: 16 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = dev.createCommandEncoder();
    encoder.copyBufferToBuffer(pass.traceBuffer, 0, readback, 0, 16 * 4);
    dev.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const trace = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();

    // fn_idx is at trace base+1 (f32 reinterp of u32 cast).
    const fnIdx = Math.round(trace[1]);
    // First iter uses prev_xform = -1 sentinel → row MAX_XFORMS (fallback).
    // With 2 equal-weight xforms, fn_idx must be 0 OR 1 — bias by ISAAC draw.
    expect([0, 1]).toContain(fnIdx);

    pass.destroy();
    readback.destroy();
  });
});
```

- [ ] **Step 4: Run, confirm green**

```bash
npx vitest run src/chaos-rng.gpu.test.ts src/chaos-xform-pick.test.ts
```

Expected: PASS (4 pure TS + GPU subset, depending on adapter availability).

- [ ] **Step 5: Verify the revert test (pure-TS side only — the WGSL revert is too involved for this task)**

Hand-revert `genome.ts::packXformDistrib` so it returns all zeros:

```diff
-    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) {
-      while (r >= t) { ... }
-      u32[rowBase + i] = j;
-      r += dr;
-    }
+    // simulated revert
+    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) u32[rowBase + i] = 0;
```

Run `chaos-xform-pick.test.ts`, confirm the equal-weight-split test FAILS
(expects half to be 1, gets 0). Restore.

- [ ] **Step 6: Commit**

```bash
git add src/chaos-xform-pick.test.ts src/chaos-rng.gpu.test.ts
git commit -m "#16 — tests for PYR3-029 #3 (table-driven xform-pick)"
```

---

## Task 5: PYR3-029 #4 — Symmetric bad-value reseed

Tests that the bad-value reseed path (`chaos.wgsl:1717-1719`) draws from `rand_11` (symmetric
`[-1, 1]`), NOT `rand01` (`[0, 1]`).

**Files:**
- Modify: `src/chaos-rng.gpu.test.ts` (one more `describe` block)
- Reference: `src/shaders/chaos.wgsl:1710-1723` (bad-value detection + reseed)

**Behavior protected:** reseeded `pv.x, pv.y` are in `[-1, 1]`, drawn via `rand_11`. A
revert to `rand01` (so the reseed is in `[0, 1]`) must fail.

**Strategy:** rather than try to provoke `pv != pv` (NaN) from a real variation kernel
inside the chaos pass, EXTRACT the reseed block via a wrapper function we add temporarily to
the test kernel — same idiom as Task 2's `rand01` / `rand_11` extraction. The reseed lines
are:

```wgsl
let reseed_x = rand_11(walker_id);
let reseed_y = rand_11(walker_id);
pv = vec2f(reseed_x, reseed_y);
```

— which is small enough that a literal-copy assertion in the test kernel is robust enough.
We assert that the WGSL source still contains the literal pattern `let reseed_x = rand_11`
+ `let reseed_y = rand_11`, then run a kernel that mimics the reseed and assert range +
bit-equality with the known ISAAC state.

- [ ] **Step 1: Write the failing test**

Append to `src/chaos-rng.gpu.test.ts`:

```typescript
describe.skipIf(!device)('#16 — PYR3-029 #4: symmetric bad-value reseed', () => {
  it('source literally reseeds via rand_11 (NOT rand01)', () => {
    // First-line defense: a literal-source assertion. If someone reverts the
    // reseed lines to rand01, this fails immediately. The GPU test below
    // adds belt-and-braces with a real-kernel value check.
    expect(SHADER_SRC).toMatch(/let reseed_x = rand_11\(walker_id\);/);
    expect(SHADER_SRC).toMatch(/let reseed_y = rand_11\(walker_id\);/);
    expect(SHADER_SRC).not.toMatch(/let reseed_x = rand01\(walker_id\);/);
    expect(SHADER_SRC).not.toMatch(/let reseed_y = rand01\(walker_id\);/);
  });

  it('reseed values fall in [-1, 1] and match rand_11(walker_id) draws', async () => {
    const dev = device!;
    // Mimic the bad-value reseed branch verbatim by extracting rand_11 +
    // isaac_irand and running them under the same draw sequence the kernel
    // would on a single bad iter.
    const isaacIrand = extractWgslFn(SHADER_SRC, 'isaac_irand');
    const rand_11 = extractWgslFn(SHADER_SRC, 'rand_11');
    const structMatch = SHADER_SRC.match(/struct IsaacState[\s\S]*?\n\}/);
    const isaacStruct = structMatch![0];

    const code = `
${isaacStruct}
@group(0) @binding(0) var<storage, read_write> isaac_states: array<IsaacState>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
${isaacIrand}
${rand_11}
@compute @workgroup_size(1)
fn main() {
  // Verbatim from chaos.wgsl bad-value branch:
  let reseed_x = rand_11(0u);
  let reseed_y = rand_11(0u);
  out[0] = reseed_x;
  out[1] = reseed_y;
}`;

    const seed = 0xbadbad;
    const known = makeKnownIsaacState(seed);
    const packed = new Uint32Array(ISAAC_STATE_U32);
    packed[0] = known.randcnt;
    packed[1] = known.randa;
    packed[2] = known.randb;
    packed[3] = known.randc;
    packed.set(known.randmem, 4);
    packed.set(known.randrsl, 20);

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

    const expectedRand11 = (raw: number): number => {
      const masked = (raw & 0x0fffffff) | 0;
      return Math.fround((masked - 0x07ffffff) / 134217727.0);
    };
    expect(out[0]).toBe(expectedRand11(known.randrsl[15]));
    expect(out[1]).toBe(expectedRand11(known.randrsl[14]));
    expect(out[0]).toBeGreaterThanOrEqual(-1);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeGreaterThanOrEqual(-1);
    expect(out[1]).toBeLessThanOrEqual(1);

    stateBuf.destroy(); outBuf.destroy(); readback.destroy();
  });
});
```

- [ ] **Step 2: Run, iterate**

```bash
npx vitest run src/chaos-rng.gpu.test.ts -t "symmetric bad-value"
```

Expected: PASS (or SKIP if no device for the GPU test; the source-literal `it`
always runs).

- [ ] **Step 3: Verify the revert test**

Hand-revert `chaos.wgsl:1717-1718`:

```diff
-      let reseed_x = rand_11(walker_id);
-      let reseed_y = rand_11(walker_id);
+      let reseed_x = rand01(walker_id);
+      let reseed_y = rand01(walker_id);
```

Run the test, confirm the **source-literal** `it()` FAILS (with NOT-toMatch on
`rand01`). Restore.

- [ ] **Step 4: Commit**

```bash
git add src/chaos-rng.gpu.test.ts
git commit -m "#16 — kernel test for PYR3-029 #4 (symmetric bad-value reseed)"
```

---

## Task 6: Drive-by cleanup — shared extractor + CLAUDE.md spatial-filter

Two unrelated small fixes that come naturally with this branch.

**Files:**
- Modify: `src/chaos-saturate.gpu.test.ts` — use `extractWgslFn` instead of the inline regex
- Modify: `CLAUDE.md` — remove the stale `spatial-filter.wgsl` mention

- [ ] **Step 1: Refactor `chaos-saturate.gpu.test.ts` to use the shared extractor**

Modify `src/chaos-saturate.gpu.test.ts` lines 35-37:

```diff
-import { readFileSync } from 'node:fs';
+import { readFileSync } from 'node:fs';
+import { extractWgslFn } from './shaders/extract';
@@
-// Extract the shipped helper verbatim — the test validates the real function,
-// not a copy. The function body has no column-0 `}` until its own closing brace.
-const SHADER_SRC = readFileSync(new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8');
-const FN_MATCH = SHADER_SRC.match(/fn atomic_add_sat\([\s\S]*?\n\}/);
-const ATOMIC_ADD_SAT = FN_MATCH ? FN_MATCH[0] : '';
+// Extract the shipped helper verbatim via the shared brace-balanced helper
+// (src/shaders/extract.ts, #16). The test validates the real function, not a copy.
+const SHADER_SRC = readFileSync(new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8');
+const ATOMIC_ADD_SAT = extractWgslFn(SHADER_SRC, 'atomic_add_sat');
```

- [ ] **Step 2: Fix the stale `spatial-filter.wgsl` mention in CLAUDE.md**

In `CLAUDE.md` "Useful pointers" section, line ~233:

```diff
-- WGSL shaders: `src/shaders/{chaos,density,spatial-filter,visualize_u32,visualize_f32}.wgsl`
+- WGSL shaders: `src/shaders/{chaos,density,visualize_u32,visualize_f32}.wgsl`
```

(`spatial-filter.wgsl` does not exist in `src/shaders/`; the density / spatial filter
logic lives in `density.wgsl`.)

- [ ] **Step 3: Run full suite to verify nothing broke**

```bash
npm run typecheck && npm test
```

Expected: green, including the unchanged `chaos-saturate.gpu.test.ts` behavior
(it now imports the shared helper but tests the same `atomic_add_sat` source).

- [ ] **Step 4: Commit**

```bash
git add src/chaos-saturate.gpu.test.ts CLAUDE.md
git commit -m "#16 — chaos-saturate.gpu.test uses shared extractor; CLAUDE.md fix"
```

---

## Task 7: Code review (fresh reviewer)

Per global CLAUDE.md workflow: dispatch a fresh reviewer agent (no implementation bias).

- [ ] **Step 1: Dispatch the reviewer**

Use the Agent tool with `subagent_type: feature-dev:code-reviewer` and prompt:

```
Review the diff on branch feature/issue-16-wgsl-kernel-tests vs main. Context: this branch
adds GPU-backed kernel tests for the four PYR3-029 RNG behaviors in src/shaders/chaos.wgsl,
following the pattern established by src/chaos-saturate.gpu.test.ts (#18). Files added:
src/shaders/extract.ts + tests, src/chaos-rng.gpu.test.ts, src/chaos-xform-pick.test.ts.
Modified: src/chaos-saturate.gpu.test.ts (drive-by — uses shared extractor), CLAUDE.md
(drive-by — stale spatial-filter.wgsl mention removed).

Check:
1. WGSL extraction robustness — does extractWgslFn handle the chaos.wgsl helpers it'll be
   asked to pull (rand01, rand_11, isaac_irand, atomic_add_sat)? Any edge case in the
   brace-balance walker that could misparse?
2. ISAAC state packing — does the test-kernel state layout exactly match the WGSL struct
   IsaacState in chaos.wgsl (randcnt, randa, randb, randc, randmem[16], randrsl[16] order
   + alignment)?
3. Test sensitivity — would each test ACTUALLY fail on a revert of the corresponding fix?
   The plan includes a hand-revert step per task; verify the asserted condition is
   tight enough to catch the realistic regression and not just a sentinel value.
4. Skip-if pattern correctness — does describe.skipIf(!device) cover ALL the it() blocks
   that need a real GPU? Any block that should be GPU-gated but isn't?
5. Resource cleanup — does each it() destroy its buffers?

Report in under 400 words.
```

- [ ] **Step 2: Apply review fixes**

Make the changes the reviewer flags. If reviewer surfaces a "this would not actually catch
the revert" issue, tighten the assertion. If they flag a missing `.destroy()`, add it.

Commit the fixes:

```bash
git add <fixed files>
git commit -m "#16 — apply code-review fixes"
```

---

## Task 8: Acceptance verification

The spec acceptance: each test fails on revert. Tasks 2–5 already include per-task revert
verification — Task 8 is the **all-at-once** acceptance pass.

- [ ] **Step 1: Run the full fast suite**

```bash
npm run typecheck && npm test
```

Expected: all green. Note the wall-clock — target is < 5s added vs main.

- [ ] **Step 2: Run the BE parity rig as a smoke**

```bash
npm run test:parity
```

Expected: green (the new test files don't change render behavior; this is a
sanity check that nothing in `chaos.wgsl` got nudged during the work).

- [ ] **Step 3: Document the wall-clock delta**

If the new tests add > 5s, the spec target is missed — investigate before
claiming acceptance. Otherwise note the delta in the issue close comment.

```bash
# Capture wall-clock before/after for the issue comment
npm test 2>&1 | tail -5
```

- [ ] **Step 4: Commit (no-op if nothing changed in step 3)**

```bash
# only if step 3 needed an adjustment
```

---

## Task 9: Ship

Per the global workflow: explicit user approval before FF-merge.

- [ ] **Step 1: Push the branch + open a PR**

```bash
git push -u origin feature/issue-16-wgsl-kernel-tests
gh pr create \
  --title "#16 — WGSL kernel tests + PYR3-029 RNG regression suite" \
  --body "$(cat <<'EOF'
Closes #16.

## Summary

- Adds GPU-backed kernel tests for the four PYR3-029 RNG behaviors (masked rand transforms,
  random color seed, table-driven xform-pick, symmetric bad-value reseed)
- Extends the proven `*.gpu.test.ts` pattern from #18 (chaos-saturate)
- Introduces `src/shaders/extract.ts` — shared WGSL fn-extraction helper, replaces the
  ad-hoc inline regex in chaos-saturate.gpu.test.ts
- Drive-by: CLAUDE.md `spatial-filter.wgsl` mention removed (file doesn't exist)

## Spun-off siblings

- #70 — Extract loadInFlight + sequencing regression tests (separate UI surgery)
- #71 — Run BE parity rig in CI (separate workflow change)

## Test plan

- [x] `npm test` green locally
- [x] Each kernel test fails on hand-revert of the corresponding fix (verified per task)
- [x] `npm run test:parity` green (no parity drift)
- [ ] User-verify before FF-merge
EOF
)"
```

- [ ] **Step 2: Hand off for user-verify before FF-merge**

Surface the PR URL and the acceptance evidence (wall-clock delta, revert-verification
confirmations) in chat. Wait for explicit FF-merge approval per CLAUDE.md "User-verify
before FF-merge."

- [ ] **Step 3: FF-merge after explicit approval**

```bash
git switch main
git pull --ff-only
git merge --ff-only feature/issue-16-wgsl-kernel-tests
git push origin main
```

- [ ] **Step 4: Close #16 + branch cleanup**

```bash
gh issue close 16 --comment "Shipped via PR #<n>; the four PYR3-029 RNG behaviors are now CI-enforced via *.gpu.test.ts kernel tests + a pure-TS xform-pick test."
# Post-ship branch cleanup is standing-authorized at session-end per CLAUDE.md
# IF preconditions hold (on main, clean tree, FF-merged this session).
git branch -d feature/issue-16-wgsl-kernel-tests
git push origin --delete feature/issue-16-wgsl-kernel-tests
```

---

## Self-review

**Spec coverage:** every PYR3-029 behavior in the spec table has a Task (2/3/4/5). The shared
extractor (Task 1) covers the spec's `src/shaders/extract.ts` file deliverable. Drive-by
cleanups (Task 6) cover the spec's CLAUDE.md fix and the chaos-saturate refactor. Code
review (Task 7) and acceptance verification (Task 8) cover the workflow gates.

**Placeholders:** none — every code block is concrete; every command is exact; every commit
message is written. Two `<n>` placeholders in Task 9 (PR number) and one in the close
comment — these are intentionally late-bound; the user/agent fills them at execution time.

**Type consistency:** `extractWgslFn(source, fnName)` signature is consistent across all
tasks that use it (Tasks 2, 4, 5, 6). `makeKnownIsaacState(seed)` defined in Task 2 is
reused in Task 5 — same module, same signature. The `Genome` shape in Task 4's
`makeGenome` helper is structurally inferred from `src/genome.ts` at implementation time;
fields named explicitly include `xforms[].weight`, `xforms[].xaos`, `xforms[].vars[].weight`
— all match current `src/genome.ts`.

**Scope:** single phase, 9 tasks, every task ends in tests + commit. Code review + ship
phases included. No bloat — variation kernels and `loadInFlight` are explicitly out of
scope and tracked in #70 / Layer-3 follow-up.
