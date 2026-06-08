# #116 Color Curves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship post-tonemap color-curves grading (Composite + R + G + B + Luma) on the `/v1/edit` viewer for #116, with a no-stop-gap UX (preset row, histogram overlay, numeric readout, before/after toggle, snap-to-grid), full BE/FE parity, and a byte-identical-when-undefined invariant on the existing 26-fixture parity rig.

**Architecture:** 5×256 f32 LUT storage buffer uploaded into the existing `visualize_{u32,f32}.wgsl` pipelines (which gain explicit `createPipelineLayout` along the way, retiring the `layout:'auto'` trap). Runtime uniform bit-field (`curvesActive`) branches the curves block off entirely when `genome.channelCurves` is undefined, preserving parity. Catmull-Rom (B=0.5 cardinal) interp baked CPU-side in a pure module; identity-default + identity-equivalence parity tests guard the seam.

**Tech Stack:** TypeScript + WebGPU + WGSL + Vite + Vitest + DOM editor.

**Spec:** [`docs/superpowers/specs/2026-06-07-issue-116-color-curves-design.md`](../specs/2026-06-07-issue-116-color-curves-design.md)

**Branch:** `feature/issue-116-color-curves`

---

## File Inventory

**Create:**
- `src/channel-curves.ts` — pure module: Catmull-Rom bake, identity check, validate, activeMask
- `src/channel-curves.test.ts` — unit tests for the bake module
- `src/edit-section-curves.ts` — editor UI section (canvas + gestures + presets + histogram)
- `src/edit-section-curves.test.ts` — DOM tests
- `src/visualize.identity.test.ts` — parity invariant guard (undefined ≡ identity)
- `src/visualize.curves-active.test.ts` — non-identity DOES change output
- `.remember/verify/116-color-curves.html` — eyeball-verify gallery (gitignored)

**Modify:**
- `src/genome.ts` — `ChannelCurves` + `CurvePoint` types, extend `Genome`
- `src/genome-json.ts` — round-trip `channelCurves`, omit-when-all-identity
- `src/visualize.ts` — explicit pipeline layout; new binding 3; uniforms struct extension; bake-on-dirty path
- `src/shaders/visualize_u32.wgsl` — `curvesActive` uniform; `curves` binding 3; `lut()` helper; epilogue
- `src/shaders/visualize_f32.wgsl` — same shader changes as u32 variant
- `src/edit-state.ts` — `'channelCurves'` prefix → `'fast'` lane
- `src/edit-mount.ts` — wire the new section between Palette and Render

---

## Task 1 · Data model + pure bake module (TS-only, engine-seam-clean)

**Files:**
- Create: `src/channel-curves.ts`
- Create: `src/channel-curves.test.ts`
- Modify: `src/genome.ts`

- [ ] **Step 1.1: Write failing tests for `validate`, `isIdentity`, `activeMask`**

Create `src/channel-curves.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  type CurvePoint,
  validate,
  isIdentity,
  activeMask,
  bakeOne,
  bakeCurves,
  IDENTITY_POINTS,
} from './channel-curves';

describe('channel-curves: validate', () => {
  it('accepts a minimal identity curve', () => {
    expect(() => validate([{ x: 0, y: 0 }, { x: 1, y: 1 }])).not.toThrow();
  });
  it('rejects fewer than 2 points', () => {
    expect(() => validate([{ x: 0.5, y: 0.5 }])).toThrow(/at least 2/);
  });
  it('rejects more than 8 points', () => {
    const pts: CurvePoint[] = Array.from({ length: 9 }, (_, i) => ({ x: i / 8, y: i / 8 }));
    expect(() => validate(pts)).toThrow(/at most 8/);
  });
  it('rejects non-monotonic x', () => {
    expect(() => validate([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }, { x: 1, y: 1 }])).toThrow(/monotonic/);
  });
  it('rejects x out of [0,1]', () => {
    expect(() => validate([{ x: -0.1, y: 0 }, { x: 1, y: 1 }])).toThrow(/range/);
    expect(() => validate([{ x: 0, y: 0 }, { x: 1.1, y: 1 }])).toThrow(/range/);
  });
  it('rejects y out of [0,1]', () => {
    expect(() => validate([{ x: 0, y: -0.1 }, { x: 1, y: 1 }])).toThrow(/range/);
  });
});

describe('channel-curves: isIdentity', () => {
  it('returns true only for exactly [(0,0),(1,1)]', () => {
    expect(isIdentity([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });
  it('returns false for [(0,0),(0.5,0.5),(1,1)]', () => {
    expect(isIdentity([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(false);
  });
  it('returns false for [(0,0),(1,0.99)]', () => {
    expect(isIdentity([{ x: 0, y: 0 }, { x: 1, y: 0.99 }])).toBe(false);
  });
});

describe('channel-curves: activeMask', () => {
  it('returns 0 for undefined', () => {
    expect(activeMask(undefined)).toBe(0);
  });
  it('returns 0 when all 5 channels are identity', () => {
    expect(activeMask({
      composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    })).toBe(0);
  });
  it('returns the right bit per active channel', () => {
    const id = IDENTITY_POINTS;
    const lift: CurvePoint[] = [{ x: 0, y: 0.2 }, { x: 1, y: 1 }];
    expect(activeMask({ composite: lift, r: id, g: id, b: id, luma: id })).toBe(0b00001);
    expect(activeMask({ composite: id, r: lift, g: id, b: id, luma: id })).toBe(0b00010);
    expect(activeMask({ composite: id, r: id, g: lift, b: id, luma: id })).toBe(0b00100);
    expect(activeMask({ composite: id, r: id, g: id, b: lift, luma: id })).toBe(0b01000);
    expect(activeMask({ composite: id, r: id, g: id, b: id, luma: lift })).toBe(0b10000);
    expect(activeMask({ composite: lift, r: lift, g: lift, b: lift, luma: lift })).toBe(0b11111);
  });
});
```

- [ ] **Step 1.2: Run tests to verify they all fail**

Run: `npx vitest run src/channel-curves.test.ts`
Expected: 0 passing — module doesn't exist yet (or all `validate`/`isIdentity`/`activeMask` undefined).

- [ ] **Step 1.3: Add types to `src/genome.ts`**

Add near the other interface definitions (after `Density`, before `Genome`):

```ts
export type CurvePoint = { x: number; y: number };

export type ChannelCurves = {
  composite: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
  luma: CurvePoint[];
};
```

And extend `Genome`:

```ts
  // Optional post-tonemap color-curves grade. When undefined the visualize
  // pass branches off the curves block entirely, producing byte-identical
  // output to the no-curves path (parity rig invariant). See
  // src/channel-curves.ts and src/shaders/visualize_*.wgsl.
  channelCurves?: ChannelCurves;
```

- [ ] **Step 1.4: Implement `validate`, `isIdentity`, `IDENTITY_POINTS`, `activeMask` in `src/channel-curves.ts`**

Create `src/channel-curves.ts`:

```ts
// Post-tonemap color-curves bake + validate. PURE — no DOM, no GPU.
// Visualize pass uploads the baked LUT; parity invariant requires
// `activeMask(undefined) === 0` ⇒ shader branches off.

import type { ChannelCurves, CurvePoint } from './genome';

export type { CurvePoint, ChannelCurves } from './genome';

export const IDENTITY_POINTS: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const MIN_POINTS = 2;
const MAX_POINTS = 8;

export function validate(points: CurvePoint[]): void {
  if (points.length < MIN_POINTS) {
    throw new Error(`channel curve must have at least 2 points, got ${points.length}`);
  }
  if (points.length > MAX_POINTS) {
    throw new Error(`channel curve must have at most 8 points, got ${points.length}`);
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      throw new Error(`channel curve point ${i} out of range [0,1]: x=${p.x} y=${p.y}`);
    }
    if (i > 0 && p.x <= points[i - 1].x) {
      throw new Error(`channel curve x not strictly monotonic at index ${i}: ${points[i - 1].x} -> ${p.x}`);
    }
  }
}

export function isIdentity(points: CurvePoint[]): boolean {
  return points.length === 2
    && points[0].x === 0 && points[0].y === 0
    && points[1].x === 1 && points[1].y === 1;
}

const CHANNEL_ORDER: Array<keyof ChannelCurves> = ['composite', 'r', 'g', 'b', 'luma'];

export function activeMask(c: ChannelCurves | undefined): number {
  if (!c) return 0;
  let mask = 0;
  for (let i = 0; i < CHANNEL_ORDER.length; i++) {
    if (!isIdentity(c[CHANNEL_ORDER[i]])) mask |= 1 << i;
  }
  return mask;
}

// === Catmull-Rom bake + LUT — Step 1.5/1.6 below ===
export function bakeOne(points: CurvePoint[]): Float32Array { throw new Error('not yet implemented'); }
export function bakeCurves(c: ChannelCurves): Float32Array | null { throw new Error('not yet implemented'); }
```

- [ ] **Step 1.5: Verify Step 1.1 tests now pass**

Run: `npx vitest run src/channel-curves.test.ts`
Expected: all `validate`, `isIdentity`, `activeMask` tests pass. `bakeOne` / `bakeCurves` tests don't exist yet — proceed.

- [ ] **Step 1.6: Write failing tests for `bakeOne` and `bakeCurves`**

Append to `src/channel-curves.test.ts`:

```ts
describe('channel-curves: bakeOne', () => {
  it('identity bakes to y = x ± 1/512', () => {
    const lut = bakeOne(IDENTITY_POINTS);
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeCloseTo(i / 255, 2);
    }
  });
  it('inverse curve bakes y = 1 - x', () => {
    const lut = bakeOne([{ x: 0, y: 1 }, { x: 1, y: 0 }]);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeCloseTo(1 - i / 255, 2);
    }
  });
  it('clamps below the leftmost point to its y', () => {
    const lut = bakeOne([{ x: 0.25, y: 0.5 }, { x: 1, y: 1 }]);
    // x = 0..0.25 (LUT indices 0..63) should be 0.5 (clamped)
    expect(lut[0]).toBeCloseTo(0.5, 3);
    expect(lut[30]).toBeCloseTo(0.5, 3);
    expect(lut[63]).toBeCloseTo(0.5, 3);
  });
  it('clamps above the rightmost point to its y', () => {
    const lut = bakeOne([{ x: 0, y: 0 }, { x: 0.75, y: 0.5 }]);
    expect(lut[200]).toBeCloseTo(0.5, 3);
    expect(lut[255]).toBeCloseTo(0.5, 3);
  });
  it('soft-S curve has S shape (midpoint = 0.5)', () => {
    const lut = bakeOne([{ x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.8 }, { x: 1, y: 1 }]);
    expect(lut[127]).toBeCloseTo(0.5, 1);
    expect(lut[64]).toBeLessThan(0.25);    // shadows crushed below the diagonal
    expect(lut[192]).toBeGreaterThan(0.75); // highlights lifted above the diagonal
  });
});

describe('channel-curves: bakeCurves', () => {
  it('returns null when all 5 channels are identity', () => {
    expect(bakeCurves({
      composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    })).toBeNull();
  });
  it('packs 5x256 = 1280 floats when at least one channel is non-identity', () => {
    const lift: CurvePoint[] = [{ x: 0, y: 0.2 }, { x: 1, y: 1 }];
    const lut = bakeCurves({
      composite: lift, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    });
    expect(lut).not.toBeNull();
    expect(lut!.length).toBe(5 * 256);
    // channel 0 (composite) was lifted
    expect(lut![0]).toBeCloseTo(0.2, 2);
    // channel 1 (R) was identity
    expect(lut![1 * 256 + 127]).toBeCloseTo(127 / 255, 2);
  });
});
```

- [ ] **Step 1.7: Run new tests to verify they fail**

Run: `npx vitest run src/channel-curves.test.ts`
Expected: identity/inverse/clamp/soft-S/bakeCurves tests all fail with "not yet implemented".

- [ ] **Step 1.8: Implement Catmull-Rom spline + `bakeOne` + `bakeCurves`**

Replace the stub `bakeOne` and `bakeCurves` in `src/channel-curves.ts` with:

```ts
// Catmull-Rom spline at parameter u ∈ [0,1], between control values xb and xc,
// with neighbors xa (before) and xd (after). B = 0.5 cardinal tension —
// matches JWildfire's SplineInterpolation and the "Smooth" mode in every
// photo editor surveyed.
function evalSpline(u: number, xa: number, xb: number, xc: number, xd: number): number {
  const B = 0.5;
  let c = u * u * u * (-B * xa + (2 - B) * xb + (B - 2) * xc + B * xd);
  c += u * u * (2 * B * xa + (B - 3) * xb + (3 - 2 * B) * xc - B * xd);
  c += u * (-B * xa + B * xc);
  return c + xb;
}

function evalCurve(points: CurvePoint[], x: number): number {
  // Edge clamp — matches JWildfire's Envelope.evaluate and photo-editor convention.
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;

  // Below 3 points fall back to linear segment.
  if (points.length < 3) {
    const dx = points[1].x - points[0].x;
    if (dx < 1e-9) return points[0].y;
    const t = (x - points[0].x) / dx;
    return points[0].y + t * (points[1].y - points[0].y);
  }

  // Find segment [i, i+1] containing x.
  let i = 0;
  while (i < points.length - 1 && points[i + 1].x < x) i++;

  const xa = points[Math.max(0, i - 1)].y;
  const xb = points[i].y;
  const xc = points[i + 1].y;
  const xd = points[Math.min(points.length - 1, i + 2)].y;

  const segDx = points[i + 1].x - points[i].x;
  if (segDx < 1e-9) return xb;
  const u = (x - points[i].x) / segDx;
  return evalSpline(u, xa, xb, xc, xd);
}

export function bakeOne(points: CurvePoint[]): Float32Array {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const y = evalCurve(points, i / 255);
    lut[i] = Math.max(0, Math.min(1, y));
  }
  return lut;
}

export function bakeCurves(c: ChannelCurves): Float32Array | null {
  if (activeMask(c) === 0) return null;
  const out = new Float32Array(5 * 256);
  const channels: Array<keyof ChannelCurves> = ['composite', 'r', 'g', 'b', 'luma'];
  for (let ch = 0; ch < channels.length; ch++) {
    const lut = bakeOne(c[channels[ch]]);
    out.set(lut, ch * 256);
  }
  return out;
}
```

- [ ] **Step 1.9: Verify all tests pass**

Run: `npx vitest run src/channel-curves.test.ts`
Expected: all tests pass.

Run: `npm run typecheck && npm run typecheck:engine`
Expected: no errors. The `typecheck:engine` run guards that `channel-curves.ts` introduced no DOM imports.

- [ ] **Step 1.10: Commit**

```bash
git add src/channel-curves.ts src/channel-curves.test.ts src/genome.ts
git commit -m "feat(#116): ChannelCurves type + Catmull-Rom bake module"
```

---

## Task 2 · Switch `visualize.ts` to explicit pipeline layout (no curves yet)

This is a parity-preserving refactor that lands before any curves wiring, to make the upcoming binding-3 addition safe.

**Files:**
- Modify: `src/visualize.ts`

- [ ] **Step 2.1: Read the current pipeline-creation paths**

Run: `grep -n "layout: 'auto'\|createPipelineLayout\|createBindGroupLayout" src/visualize.ts`

Expected: two `layout: 'auto'` occurrences (one per u32 / f32 pipeline). Note both line numbers.

- [ ] **Step 2.2: Replace both `layout: 'auto'` with explicit `createPipelineLayout`**

Insert a shared bind-group-layout builder near the top of the `createVisualizePass` function:

```ts
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'pyr3.viz.bindgroup.layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: 'pyr3.viz.pipeline.layout',
    bindGroupLayouts: [bindGroupLayout],
  });
```

Then in both `device.createRenderPipeline({ ... })` calls, replace:
```ts
    layout: 'auto',
```
with:
```ts
    layout: pipelineLayout,
```

And in both `device.createBindGroup({ ... })` calls, replace:
```ts
    layout: pipelineU32.getBindGroupLayout(0),
```
(and the f32 equivalent) with:
```ts
    layout: bindGroupLayout,
```

- [ ] **Step 2.3: Run typecheck + unit tests**

Run: `npm run typecheck && npm test`
Expected: all pass. No behavioral change yet.

- [ ] **Step 2.4: Run the GPU-touching subset of tests**

Run: `npx vitest run src/visualize` (any test file matching `visualize*`)
Expected: all pass.

- [ ] **Step 2.5: Run the BE parity rig (~91s)**

Run: `npm run test:parity`
Expected: all 26 fixtures green. Confirms explicit layout produces byte-equivalent output.

- [ ] **Step 2.6: Commit**

```bash
git add src/visualize.ts
git commit -m "refactor: explicit createPipelineLayout in visualize.ts (no behavior change)"
```

---

## Task 3 · VizUniforms extension + curves buffer plumbing + shader epilogue

This task wires the buffer and the shader code together, including the bake-on-dirty path. After this task, channel curves work end-to-end at the engine level — the editor UI comes later.

**Files:**
- Modify: `src/visualize.ts`
- Modify: `src/shaders/visualize_u32.wgsl`
- Modify: `src/shaders/visualize_f32.wgsl`
- Create: `src/visualize.identity.test.ts`
- Create: `src/visualize.curves-active.test.ts`

- [ ] **Step 3.1: Write the parity-invariant test (`undefined ≡ identity`)**

Create `src/visualize.identity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SPIRAL_GALAXY, type Genome } from './genome';
import { IDENTITY_POINTS } from './channel-curves';
import { renderHeadlessToPng } from './test-utils/render-headless'; // existing helper

describe('visualize: channelCurves undefined ≡ identity (parity invariant)', () => {
  it('undefined channelCurves produces byte-identical render to no-curves', async () => {
    const baseline: Genome = SPIRAL_GALAXY;
    const withIdentity: Genome = {
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
        b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    };
    const a = await renderHeadlessToPng(baseline, { width: 256, height: 256 });
    const b = await renderHeadlessToPng(withIdentity, { width: 256, height: 256 });
    expect(crc32(a)).toBe(crc32(b));
  });
});

// Cheap CRC32 — copy from existing test-utils if available, otherwise:
function crc32(buf: Uint8Array): number {
  let c: number; const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    tbl[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ tbl[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
```

Note: if `renderHeadlessToPng` doesn't exist, locate the equivalent helper from existing tests like `src/parity-fe-be.test.ts` or use the pattern from `src/visualize.gpu.test.ts`. Implement what's missing in a new `src/test-utils/render-headless.ts` if needed; keep it minimal.

- [ ] **Step 3.2: Write the non-identity sanity test**

Create `src/visualize.curves-active.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SPIRAL_GALAXY, type Genome } from './genome';
import { IDENTITY_POINTS } from './channel-curves';
import { renderHeadlessToPng } from './test-utils/render-headless';

describe('visualize: non-identity curves change output', () => {
  it('an aggressive Soft-S composite curve produces a different render', async () => {
    const baseline = await renderHeadlessToPng(SPIRAL_GALAXY, { width: 256, height: 256 });
    const graded = await renderHeadlessToPng({
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: [{ x: 0, y: 0 }, { x: 0.25, y: 0.05 }, { x: 0.75, y: 0.95 }, { x: 1, y: 1 }],
        r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    }, { width: 256, height: 256 });
    // We don't care HOW it differs — just that it does, materially.
    let diffCount = 0;
    for (let i = 0; i < baseline.length; i++) if (baseline[i] !== graded[i]) diffCount++;
    expect(diffCount).toBeGreaterThan(baseline.length * 0.1);
  });
});
```

- [ ] **Step 3.3: Run both new tests to verify they fail**

Run: `npx vitest run src/visualize.identity.test.ts src/visualize.curves-active.test.ts`
Expected: identity test PASSES (no shader change yet — undefined is still byte-identical). curves-active test FAILS (curves don't apply yet).

- [ ] **Step 3.4: Extend the WGSL uniforms + add binding 3 in `visualize_u32.wgsl`**

In `src/shaders/visualize_u32.wgsl`, find the `struct VizUniforms { ... }` block and add at the end before the closing brace:

```wgsl
  // Color-curves (issue #116). bit0=composite, bit1=R, bit2=G, bit3=B, bit4=luma.
  // When 0, the curves block in fs() is skipped entirely — parity invariant.
  curvesActive: u32,
  _pad4: u32,
  _pad5: u32,
  _pad6: u32,
```

Add the new binding immediately after `binding(2)`:

```wgsl
@group(0) @binding(3) var<storage, read>    curves:   array<f32>;
```

Add the `lut` helper after `hsv2rgb`:

```wgsl
fn lut(ch: u32, x: f32) -> f32 {
  let idx = clamp(x, 0.0, 1.0) * 255.0;
  let i0 = u32(floor(idx));
  let i1 = min(i0 + 1u, 255u);
  return mix(curves[ch * 256u + i0], curves[ch * 256u + i1], idx - f32(i0));
}
```

Replace the existing epilogue (the last two lines of `fs()`):
```wgsl
  let final_rgb = clamp(composed / 256.0, vec3f(0.0), vec3f(1.0));
  return vec4f(final_rgb, 1.0);
```
with:
```wgsl
  var rgb = clamp(composed / 256.0, vec3f(0.0), vec3f(1.0));
  // Color-curves block (issue #116). curvesActive == 0 ⇒ branch off ⇒
  // byte-identical to pre-#116 visualize output. Branch is permanent —
  // do NOT remove without revisiting the parity rig invariant.
  if (u.curvesActive != 0u) {
    if ((u.curvesActive & 1u) != 0u) {
      rgb = vec3f(lut(0u, rgb.r), lut(0u, rgb.g), lut(0u, rgb.b));
    }
    if ((u.curvesActive & 2u) != 0u) { rgb.r = lut(1u, rgb.r); }
    if ((u.curvesActive & 4u) != 0u) { rgb.g = lut(2u, rgb.g); }
    if ((u.curvesActive & 8u) != 0u) { rgb.b = lut(3u, rgb.b); }
    if ((u.curvesActive & 16u) != 0u) {
      let y_in = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
      let y_out = lut(4u, y_in);
      let scale = select(1.0, y_out / y_in, y_in > 1e-6);
      rgb = clamp(rgb * scale, vec3f(0.0), vec3f(1.0));
    }
  }
  return vec4f(rgb, 1.0);
```

- [ ] **Step 3.5: Mirror the WGSL changes in `visualize_f32.wgsl`**

Apply the identical four edits (struct field, binding 3, `lut()` helper, epilogue rewrite) to `src/shaders/visualize_f32.wgsl`. The two shaders share the same tonemap math; both must carry the curves epilogue.

- [ ] **Step 3.6: Extend `src/visualize.ts` for the new binding + uniforms + bake path**

Find `const UNIFORMS_BYTES = 64;` and change to:
```ts
const UNIFORMS_BYTES = 80;  // +16 for curvesActive + 3 pad u32 (issue #116)
```

Add the curves storage buffer + bind-group-layout entry. Just after `bindGroupLayout` is created in Task 2's work, change `entries` to include binding 3:

```ts
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'pyr3.viz.bindgroup.layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
```

Create the curves buffer near the `kernelBuf` creation:

```ts
  // Color-curves LUT (issue #116). 5 channels × 256 f32 = 5KB.
  // Initialized as identity (5x256 of i/255) so the buffer is always valid
  // even when curvesActive == 0. Buffer payload only matters when the
  // shader's curves block runs.
  const CURVES_BYTES = 5 * 256 * 4;
  const curvesBuf = device.createBuffer({
    label: 'pyr3.viz.curves',
    size: CURVES_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  // Seed with identity LUT (one ramp, repeated 5 times).
  const identityLut = new Float32Array(5 * 256);
  for (let ch = 0; ch < 5; ch++) {
    for (let i = 0; i < 256; i++) identityLut[ch * 256 + i] = i / 255;
  }
  device.queue.writeBuffer(curvesBuf, 0, identityLut.buffer, identityLut.byteOffset, identityLut.byteLength);
```

Add binding 3 to both bind groups:

```ts
      { binding: 3, resource: { buffer: curvesBuf } },
```

Then extend the `draw()` signature to accept channel curves. Find the `draw(tonemap, k1, k2, useDE, outputView, background)` method and change to:

```ts
    draw(
      tonemap: Tonemap,
      k1: number,
      k2: number,
      useDE: boolean,
      outputView: GPUTextureView,
      background: [number, number, number],
      channelCurves?: ChannelCurves,
    ): void {
```

(Import `ChannelCurves` from `./genome` at the top of the file.)

In `draw()`, before the uniforms write, compute `curvesActive` and re-bake the LUT if dirty:

```ts
      const mask = activeMask(channelCurves);
      if (mask !== lastCurvesMask || (channelCurves && channelCurves !== lastCurves)) {
        const lut = channelCurves ? bakeCurves(channelCurves) : null;
        if (lut) {
          device.queue.writeBuffer(curvesBuf, 0, lut.buffer, lut.byteOffset, lut.byteLength);
        }
        lastCurvesMask = mask;
        lastCurves = channelCurves;
      }
```

Declare the cache vars next to `uniforms` buffer creation:

```ts
  let lastCurvesMask = 0;
  let lastCurves: ChannelCurves | undefined = undefined;
```

And extend the uniforms write to include `curvesActive`. Find the existing `device.queue.writeBuffer(uniforms, 0, …)` call and the Float32/Uint32 packing of the 64-byte struct. Add 4 trailing u32s (curvesActive + 3 pad):

```ts
  // Existing first 48 bytes (12 × 4 bytes) — unchanged.
  // Existing 16 bytes background — unchanged.
  // NEW 16 bytes: curvesActive + 3 pad
  uniformsView.setUint32(64, mask, true);
  uniformsView.setUint32(68, 0, true);
  uniformsView.setUint32(72, 0, true);
  uniformsView.setUint32(76, 0, true);
```

Adjust to match the existing uniform-writing code style — pyr3's `visualize.ts` uses a Float32Array/Uint32Array overlay pattern. Match it.

Import additions at the top:

```ts
import { activeMask, bakeCurves, type ChannelCurves } from './channel-curves';
```

- [ ] **Step 3.7: Thread `channelCurves` from the renderer through `draw()`**

`src/renderer.ts` (or wherever `visualize.draw` is called) needs to pass the genome's `channelCurves` field. Read the file, find the visualize.draw() call site(s), and pass `genome.channelCurves`.

- [ ] **Step 3.8: Run the parity-invariant + non-identity tests**

Run: `npx vitest run src/visualize.identity.test.ts src/visualize.curves-active.test.ts`
Expected: BOTH pass now.

- [ ] **Step 3.9: Run the full test suite + parity rig**

Run: `npm run typecheck && npm run typecheck:engine && npm test`
Expected: all green.

Run: `npm run test:parity`
Expected: 26/26 green. **If any fixture regresses, the curves block is leaking when `curvesActive == 0` — diagnose before proceeding.**

- [ ] **Step 3.10: Commit**

```bash
git add src/visualize.ts src/shaders/visualize_u32.wgsl src/shaders/visualize_f32.wgsl \
        src/visualize.identity.test.ts src/visualize.curves-active.test.ts src/renderer.ts \
        src/test-utils/render-headless.ts
git commit -m "feat(#116): GPU plumbing for ChannelCurves + parity invariant tests"
```

---

## Task 4 · Lane scheduler + onPathChange routing

**Files:**
- Modify: `src/edit-state.ts`

- [ ] **Step 4.1: Read the existing pathLane router**

Run: `grep -n "pathLane\|export function pathLane\|fast\|slow" src/edit-state.ts | head -30`

- [ ] **Step 4.2: Write a failing test for the new prefix**

In the existing `src/edit-state.test.ts` (or create if missing):

```ts
import { pathLane } from './edit-state';
describe('pathLane: channelCurves routing', () => {
  it('routes channelCurves edits to the fast lane', () => {
    expect(pathLane('channelCurves.composite.0')).toBe('fast');
    expect(pathLane('channelCurves.r')).toBe('fast');
    expect(pathLane('channelCurves')).toBe('fast');
  });
});
```

Run: `npx vitest run src/edit-state.test.ts`
Expected: fail with wrong lane returned.

- [ ] **Step 4.3: Add the prefix to `pathLane`**

In `src/edit-state.ts`, inside the existing `pathLane(path)` function, add at the top of the body:

```ts
  if (path.startsWith('channelCurves')) return 'fast';
```

- [ ] **Step 4.4: Verify test passes**

Run: `npx vitest run src/edit-state.test.ts`
Expected: pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/edit-state.ts src/edit-state.test.ts
git commit -m "feat(#116): route channelCurves edits to the fast render lane"
```

---

## Task 5 · Editor section shell + tab switcher + canvas drawing

This task creates the `Color Curves` section structure (title, tab switcher, canvas with identity diagonal + control points), wires it into `edit-mount.ts`, and tests that the section mounts cleanly. No gesture handling yet — that's Task 6.

**Files:**
- Create: `src/edit-section-curves.ts`
- Create: `src/edit-section-curves.test.ts`
- Modify: `src/edit-mount.ts`

- [ ] **Step 5.1: Read the existing `edit-section-palette.ts` for layout patterns**

Run: `cat src/edit-section-palette.ts | head -60`

Pattern-match its mount-function signature and styling conventions. The new section should follow the same shape.

- [ ] **Step 5.2: Write failing DOM tests for section mounting**

Create `src/edit-section-curves.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountChannelCurvesSection } from './edit-section-curves';
import { SPIRAL_GALAXY } from './genome';

describe('edit-section-curves: mount + tabs', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('mounts a section with title "Color Curves"', () => {
    const state = { genome: SPIRAL_GALAXY } as any;
    mountChannelCurvesSection(host, state, () => {});
    expect(host.textContent).toMatch(/Color Curves/);
  });

  it('renders 5 channel tabs (Composite, R, G, B, Luma)', () => {
    const state = { genome: SPIRAL_GALAXY } as any;
    mountChannelCurvesSection(host, state, () => {});
    const tabs = host.querySelectorAll('[data-tab]');
    expect(tabs.length).toBe(5);
    const labels = Array.from(tabs).map(el => (el as HTMLElement).dataset.tab);
    expect(labels).toEqual(['composite', 'r', 'g', 'b', 'luma']);
  });

  it('Composite is the default active tab', () => {
    const state = { genome: SPIRAL_GALAXY } as any;
    mountChannelCurvesSection(host, state, () => {});
    const active = host.querySelector('[data-tab].active') as HTMLElement;
    expect(active).toBeTruthy();
    expect(active.dataset.tab).toBe('composite');
  });

  it('clicking a tab switches active state without throwing', () => {
    const state = { genome: SPIRAL_GALAXY } as any;
    mountChannelCurvesSection(host, state, () => {});
    const rTab = host.querySelector('[data-tab="r"]') as HTMLElement;
    rTab.click();
    expect((host.querySelector('[data-tab].active') as HTMLElement).dataset.tab).toBe('r');
  });

  it('renders a curve canvas element', () => {
    const state = { genome: SPIRAL_GALAXY } as any;
    mountChannelCurvesSection(host, state, () => {});
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(240);
  });
});
```

- [ ] **Step 5.3: Run tests to verify they fail**

Run: `npx vitest run src/edit-section-curves.test.ts`
Expected: all fail (module doesn't exist).

- [ ] **Step 5.4: Implement section shell**

Create `src/edit-section-curves.ts`:

```ts
// Editor section for #116 — post-tonemap Color Curves.
// Section structure: title row + tab switcher (Composite / R / G / B / Luma)
// + curve canvas + numeric readout + reset / snap / before-after buttons.
// All edits route through `onPathChange` for undo/redo + lane scheduling.

import type { ChannelCurves, CurvePoint, Genome } from './genome';
import { IDENTITY_POINTS } from './channel-curves';

type Channel = keyof ChannelCurves;
const CHANNELS: Array<{ key: Channel; label: string }> = [
  { key: 'composite', label: 'Composite' },
  { key: 'r',         label: 'R' },
  { key: 'g',         label: 'G' },
  { key: 'b',         label: 'B' },
  { key: 'luma',      label: 'Luma' },
];

interface EditorState {
  genome: Genome;
  activeColorCurveChannel?: Channel;
  selectedCurvePoint?: { channel: Channel; pointIdx: number };
  colorCurvesPreviewOff?: boolean;
  colorCurvesSnapToGrid?: boolean;
}

type OnPathChange = (path: string, value?: unknown) => void;

export function mountChannelCurvesSection(
  host: HTMLElement,
  state: EditorState,
  onPathChange: OnPathChange,
): void {
  // Default active tab — composite.
  if (!state.activeColorCurveChannel) state.activeColorCurveChannel = 'composite';

  const section = document.createElement('div');
  section.className = 'edit-section edit-section-curves';
  section.innerHTML = `
    <div class="edit-section-header">
      <h3>Color Curves</h3>
      <button class="curves-reset-all" type="button">⟲ Reset all</button>
    </div>
    <div class="curves-tabs"></div>
    <div class="curves-presets"></div>
    <canvas data-curve-canvas width="240" height="240"></canvas>
    <div class="curves-readout">
      Selected point:
      <input data-curve-in  type="number" min="0" max="255" />
      <input data-curve-out type="number" min="0" max="255" />
      <button data-curve-delete type="button">−</button>
    </div>
    <div class="curves-footer">
      <button data-curve-reset-channel type="button">Reset channel</button>
      <button data-curve-snap          type="button">⟂ Snap 1/8</button>
      <button data-curve-preview-off   type="button">👁 hold = before</button>
    </div>
  `;

  // Mount tabs.
  const tabsRoot = section.querySelector('.curves-tabs')!;
  for (const ch of CHANNELS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.tab = ch.key;
    el.textContent = ch.label;
    if (ch.key === state.activeColorCurveChannel) el.classList.add('active');
    el.addEventListener('click', () => {
      state.activeColorCurveChannel = ch.key;
      tabsRoot.querySelectorAll('[data-tab]').forEach(n => n.classList.remove('active'));
      el.classList.add('active');
      redrawCanvas();
    });
    tabsRoot.appendChild(el);
  }

  // Curve canvas: draw identity diagonal + current curve.
  const canvas = section.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
  function getCurve(): CurvePoint[] {
    const ch = state.activeColorCurveChannel!;
    return state.genome.channelCurves?.[ch] ?? IDENTITY_POINTS;
  }
  function redrawCanvas() {
    drawCurveCanvas(canvas, getCurve(), state);
  }
  redrawCanvas();

  host.appendChild(section);
}

function drawCurveCanvas(canvas: HTMLCanvasElement, curve: CurvePoint[], state: EditorState): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background grid (8 divisions).
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (i / 8) * w;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
  }

  // Identity diagonal.
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();

  // Curve spline (rough preview — Task 6 will replace with the actual baked LUT).
  ctx.strokeStyle = '#9cf';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    // Naive linear approximation — full Catmull-Rom preview lands in Task 6.
    const y = evalCurveLinear(curve, x);
    const px = x * w;
    const py = (1 - y) * h;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Control points.
  for (let i = 0; i < curve.length; i++) {
    const px = curve[i].x * w;
    const py = (1 - curve[i].y) * h;
    ctx.fillStyle = '#9cf';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function evalCurveLinear(points: CurvePoint[], x: number): number {
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  let i = 0;
  while (i < points.length - 1 && points[i + 1].x < x) i++;
  const dx = points[i + 1].x - points[i].x;
  if (dx < 1e-9) return points[i].y;
  const t = (x - points[i].x) / dx;
  return points[i].y + t * (points[i + 1].y - points[i].y);
}
```

- [ ] **Step 5.5: Wire into `edit-mount.ts`**

Read `src/edit-mount.ts`, find where Palette and Render sections are mounted in sequence, and insert `mountChannelCurvesSection` between them:

```ts
import { mountChannelCurvesSection } from './edit-section-curves';
// … existing imports
// … in the mount sequence:
mountChannelCurvesSection(host, state, onPathChange);
```

- [ ] **Step 5.6: Run section + mount tests**

Run: `npx vitest run src/edit-section-curves.test.ts`
Expected: all 5 tests pass.

Run: `npm run typecheck && npm test`
Expected: full suite green.

- [ ] **Step 5.7: Commit**

```bash
git add src/edit-section-curves.ts src/edit-section-curves.test.ts src/edit-mount.ts
git commit -m "feat(#116): Color Curves editor section shell + tab switcher"
```

---

## Task 6 · Canvas gestures (drag, add, delete, select, numeric, arrow-nudge, snap)

**Files:**
- Modify: `src/edit-section-curves.ts`
- Modify: `src/edit-section-curves.test.ts`

- [ ] **Step 6.1: Write failing tests for gesture handlers**

Append to `src/edit-section-curves.test.ts`:

```ts
describe('edit-section-curves: gestures', () => {
  let host: HTMLElement;
  let calls: Array<[string, unknown?]>;
  let state: any;
  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    calls = [];
    state = { genome: { ...SPIRAL_GALAXY, channelCurves: undefined }, activeColorCurveChannel: 'composite' };
    mountChannelCurvesSection(host, state, (p, v) => { calls.push([p, v]); });
  });

  it('clicking empty canvas area adds a new control point', () => {
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    // Synthesize a click at (120, 120) — center of 240x240 canvas
    const rect = { left: 0, top: 0 } as DOMRect;
    canvas.getBoundingClientRect = () => rect;
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 120, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 120, clientY: 120, bubbles: true }));
    // After mouseup, expect onPathChange was called with channelCurves path
    const channelEdits = calls.filter(([p]) => p.startsWith('channelCurves'));
    expect(channelEdits.length).toBeGreaterThan(0);
  });

  it('Backspace deletes the selected control point', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    // Curve should have had its middle point removed
    expect(state.genome.channelCurves.composite.length).toBe(2);
  });

  it('arrow-down on selected point reduces y by 1/256', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(state.genome.channelCurves.composite[1].y).toBeCloseTo(0.5 - 1 / 256, 4);
  });

  it('delete-button click removes the selected point', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    const btn = host.querySelector('[data-curve-delete]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves.composite.length).toBe(2);
  });

  it('refuses to delete the last 2 control points', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 0 };
    const btn = host.querySelector('[data-curve-delete]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves.composite.length).toBe(2);  // unchanged
  });
});
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npx vitest run src/edit-section-curves.test.ts`
Expected: gesture tests fail (handlers not wired yet).

- [ ] **Step 6.3: Add gesture handlers**

In `src/edit-section-curves.ts`, after the section is created and `redrawCanvas()` is called, add the gesture wiring:

```ts
  // === Gesture handling ===

  function getCurrentCurve(): CurvePoint[] {
    const ch = state.activeColorCurveChannel!;
    return state.genome.channelCurves?.[ch] ?? IDENTITY_POINTS;
  }

  function setCurrentCurve(next: CurvePoint[]) {
    const ch = state.activeColorCurveChannel!;
    if (!state.genome.channelCurves) {
      state.genome.channelCurves = {
        composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
        b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      };
    }
    state.genome.channelCurves[ch] = next;
    onPathChange(`channelCurves.${ch}`, next);
    redrawCanvas();
  }

  function maybeSnap(v: number): number {
    if (!state.colorCurvesSnapToGrid) return v;
    return Math.round(v * 8) / 8;
  }

  // Mouse: click empty canvas → add point. Click on point → select. Drag → move.
  let dragIdx = -1;
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / canvas.width;
    const cy = 1 - (e.clientY - rect.top) / canvas.height;
    const cur = getCurrentCurve();
    // Hit-test: 6px point radius in canvas-fraction units
    const r = 6 / canvas.width;
    let hit = -1;
    for (let i = 0; i < cur.length; i++) {
      if (Math.abs(cur[i].x - cx) < r && Math.abs(cur[i].y - cy) < r) { hit = i; break; }
    }
    if (hit >= 0) {
      state.selectedCurvePoint = { channel: state.activeColorCurveChannel!, pointIdx: hit };
      dragIdx = hit;
    } else if (cur.length < 8) {
      // Add new point in sorted position
      const xs = maybeSnap(Math.max(0, Math.min(1, cx)));
      const ys = maybeSnap(Math.max(0, Math.min(1, cy)));
      const next = [...cur, { x: xs, y: ys }].sort((a, b) => a.x - b.x);
      // Deduplicate identical x
      const dedup = next.filter((p, i) => i === 0 || p.x > next[i - 1].x + 1e-6);
      const insertIdx = dedup.findIndex(p => p.x === xs && p.y === ys);
      setCurrentCurve(dedup);
      state.selectedCurvePoint = { channel: state.activeColorCurveChannel!, pointIdx: insertIdx };
      dragIdx = insertIdx;
    }
    redrawCanvas();
  });

  canvas.addEventListener('mousemove', (e) => {
    if (dragIdx < 0) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / canvas.width;
    const cy = 1 - (e.clientY - rect.top) / canvas.height;
    const cur = getCurrentCurve();
    const next = cur.map((p, i) => i === dragIdx ? { ...p } : p);
    // Constrain x between adjacent points; clamp to [0,1].
    const minX = dragIdx > 0 ? cur[dragIdx - 1].x + 1e-3 : 0;
    const maxX = dragIdx < cur.length - 1 ? cur[dragIdx + 1].x - 1e-3 : 1;
    next[dragIdx].x = maybeSnap(Math.max(minX, Math.min(maxX, cx)));
    next[dragIdx].y = maybeSnap(Math.max(0, Math.min(1, cy)));
    setCurrentCurve(next);
  });

  canvas.addEventListener('mouseup', () => { dragIdx = -1; });
  canvas.addEventListener('mouseleave', (e) => {
    // Drag-off-canvas more than 20px → delete the dragged point
    if (dragIdx < 0) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = Math.min(Math.abs(e.clientX - rect.left), Math.abs(e.clientX - rect.right));
    const offsetY = Math.min(Math.abs(e.clientY - rect.top), Math.abs(e.clientY - rect.bottom));
    if (offsetX > 20 || offsetY > 20) {
      const cur = getCurrentCurve();
      if (cur.length > 2) {
        const next = cur.filter((_, i) => i !== dragIdx);
        setCurrentCurve(next);
        state.selectedCurvePoint = undefined;
      }
    }
    dragIdx = -1;
  });

  // Delete button + numeric readout
  const deleteBtn = section.querySelector('[data-curve-delete]') as HTMLButtonElement;
  deleteBtn.addEventListener('click', () => deleteSelectedPoint());
  function deleteSelectedPoint() {
    const sel = state.selectedCurvePoint;
    if (!sel) return;
    const cur = state.genome.channelCurves?.[sel.channel] ?? IDENTITY_POINTS;
    if (cur.length <= 2) return;  // refuse to drop below 2
    const next = cur.filter((_, i) => i !== sel.pointIdx);
    state.activeColorCurveChannel = sel.channel;
    setCurrentCurve(next);
    state.selectedCurvePoint = undefined;
  }

  // Backspace / Delete / arrow keys
  function onKey(e: KeyboardEvent) {
    if (!state.selectedCurvePoint) return;
    const sel = state.selectedCurvePoint;
    if (state.activeColorCurveChannel !== sel.channel) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault(); deleteSelectedPoint(); return;
    }
    const cur = getCurrentCurve();
    const next = cur.map((p, i) => i === sel.pointIdx ? { ...p } : p);
    const step = e.shiftKey ? 10 / 256 : 1 / 256;
    let changed = false;
    if (e.key === 'ArrowUp')   { next[sel.pointIdx].y = Math.min(1, next[sel.pointIdx].y + step); changed = true; }
    if (e.key === 'ArrowDown') { next[sel.pointIdx].y = Math.max(0, next[sel.pointIdx].y - step); changed = true; }
    if (e.key === 'ArrowLeft') {
      const minX = sel.pointIdx > 0 ? cur[sel.pointIdx - 1].x + 1e-3 : 0;
      next[sel.pointIdx].x = Math.max(minX, next[sel.pointIdx].x - step); changed = true;
    }
    if (e.key === 'ArrowRight') {
      const maxX = sel.pointIdx < cur.length - 1 ? cur[sel.pointIdx + 1].x - 1e-3 : 1;
      next[sel.pointIdx].x = Math.min(maxX, next[sel.pointIdx].x + step); changed = true;
    }
    if (changed) { e.preventDefault(); setCurrentCurve(next); }
  }
  document.body.addEventListener('keydown', onKey);

  // Numeric readout — bind to selected point
  const inField  = section.querySelector('[data-curve-in]')  as HTMLInputElement;
  const outField = section.querySelector('[data-curve-out]') as HTMLInputElement;
  inField.addEventListener('change', () => {
    if (!state.selectedCurvePoint) return;
    const cur = getCurrentCurve();
    const next = cur.map((p, i) => i === state.selectedCurvePoint!.pointIdx
      ? { ...p, x: Math.max(0, Math.min(1, parseFloat(inField.value) / 255)) }
      : p);
    setCurrentCurve(next);
  });
  outField.addEventListener('change', () => {
    if (!state.selectedCurvePoint) return;
    const cur = getCurrentCurve();
    const next = cur.map((p, i) => i === state.selectedCurvePoint!.pointIdx
      ? { ...p, y: Math.max(0, Math.min(1, parseFloat(outField.value) / 255)) }
      : p);
    setCurrentCurve(next);
  });
```

Note: replace the Task 5 stub `evalCurveLinear` with a real Catmull-Rom call so the canvas preview matches the baked LUT:

```ts
import { bakeOne } from './channel-curves';
// In drawCurveCanvas, replace the evalCurveLinear loop with:
const lut = bakeOne(curve);
ctx.beginPath();
for (let i = 0; i <= 64; i++) {
  const x = i / 64;
  const idx = x * 255;
  const i0 = Math.floor(idx);
  const i1 = Math.min(255, i0 + 1);
  const t = idx - i0;
  const y = lut[i0] * (1 - t) + lut[i1] * t;
  const px = x * w;
  const py = (1 - y) * h;
  if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
}
ctx.stroke();
```

(Remove `evalCurveLinear` since it's no longer used.)

- [ ] **Step 6.4: Run tests + typecheck**

Run: `npx vitest run src/edit-section-curves.test.ts`
Expected: all gesture tests pass.

Run: `npm run typecheck && npm test`
Expected: full suite green.

- [ ] **Step 6.5: Commit**

```bash
git add src/edit-section-curves.ts src/edit-section-curves.test.ts
git commit -m "feat(#116): curve canvas gestures — drag, add, delete, select, arrow-nudge, snap"
```

---

## Task 7 · Presets + reset buttons + before/after toggle + histogram overlay

**Files:**
- Modify: `src/edit-section-curves.ts`
- Modify: `src/edit-section-curves.test.ts`
- Modify: `src/renderer.ts` (histogram readback hook)

- [ ] **Step 7.1: Write failing tests for presets + reset + before-after**

Append to `src/edit-section-curves.test.ts`:

```ts
describe('edit-section-curves: presets + reset + before-after', () => {
  let host: HTMLElement;
  let state: any;
  let calls: Array<[string, unknown?]>;
  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    calls = [];
    state = { genome: { ...SPIRAL_GALAXY }, activeColorCurveChannel: 'composite' };
    mountChannelCurvesSection(host, state, (p, v) => { calls.push([p, v]); });
  });

  it('Soft-S preset installs a known 4-point curve', () => {
    const btn = host.querySelector('[data-preset="soft-s"]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves.composite).toEqual([
      { x: 0, y: 0 }, { x: 0.25, y: 0.20 }, { x: 0.75, y: 0.80 }, { x: 1, y: 1 },
    ]);
  });
  it('Identity preset resets to [(0,0),(1,1)]', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    const btn = host.querySelector('[data-preset="identity"]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves.composite).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
  it('Reset-channel button restores identity for the active channel only', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
      r:         [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
      g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.activeColorCurveChannel = 'composite';
    const btn = host.querySelector('[data-curve-reset-channel]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves.composite).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(state.genome.channelCurves.r).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
  });
  it('Reset-all button restores all 5 channels to identity', () => {
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
      r: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
      g: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }],
      b: [{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }],
      luma: [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 1 }],
    };
    const btn = host.querySelector('.curves-reset-all') as HTMLButtonElement;
    btn.click();
    for (const ch of ['composite', 'r', 'g', 'b', 'luma'] as const) {
      expect(state.genome.channelCurves![ch]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    }
  });
  it('Holding 👁 button sets state.colorCurvesPreviewOff', () => {
    const btn = host.querySelector('[data-curve-preview-off]') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(state.colorCurvesPreviewOff).toBe(true);
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(state.colorCurvesPreviewOff).toBe(false);
  });
  it('Snap-to-grid button toggles state.colorCurvesSnapToGrid', () => {
    const btn = host.querySelector('[data-curve-snap]') as HTMLButtonElement;
    expect(state.colorCurvesSnapToGrid).toBeFalsy();
    btn.click();
    expect(state.colorCurvesSnapToGrid).toBe(true);
    btn.click();
    expect(state.colorCurvesSnapToGrid).toBe(false);
  });
});
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `npx vitest run src/edit-section-curves.test.ts`
Expected: preset/reset/toggle tests fail.

- [ ] **Step 7.3: Implement presets + reset + toggles**

Define presets and wire the buttons. Add this near the top of `src/edit-section-curves.ts`:

```ts
const PRESETS: Record<string, CurvePoint[]> = {
  identity:        [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  'soft-s':        [{ x: 0, y: 0 }, { x: 0.25, y: 0.20 }, { x: 0.75, y: 0.80 }, { x: 1, y: 1 }],
  'medium-s':      [{ x: 0, y: 0 }, { x: 0.25, y: 0.15 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }],
  'strong-s':      [{ x: 0, y: 0 }, { x: 0.25, y: 0.08 }, { x: 0.75, y: 0.92 }, { x: 1, y: 1 }],
  inverse:         [{ x: 0, y: 1 }, { x: 1, y: 0 }],
  'lift-shadows':  [{ x: 0, y: 0.15 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }],
  'crush-shadows': [{ x: 0, y: 0 },    { x: 0.25, y: 0.05 }, { x: 1, y: 1 }],
  'lift-hi':       [{ x: 0, y: 0 },    { x: 0.5, y: 0.55 },  { x: 1, y: 1 }],
  'crush-hi':      [{ x: 0, y: 0 },    { x: 0.75, y: 0.85 }, { x: 1, y: 0.85 }],
};

const PRESET_ORDER = [
  'identity', 'soft-s', 'medium-s', 'strong-s', 'inverse',
  'lift-shadows', 'crush-shadows', 'lift-hi', 'crush-hi',
];
```

After the tab row, add the preset row population (inside `mountChannelCurvesSection`):

```ts
  // Presets
  const presetRoot = section.querySelector('.curves-presets')!;
  for (const key of PRESET_ORDER) {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.preset = key;
    el.textContent = formatPresetLabel(key);
    el.addEventListener('click', () => applyPreset(key));
    presetRoot.appendChild(el);
  }
  function applyPreset(key: string) {
    const pts = PRESETS[key].map(p => ({ ...p }));
    setCurrentCurve(pts);
  }

  // Reset channel + reset all
  (section.querySelector('[data-curve-reset-channel]') as HTMLButtonElement).addEventListener('click', () => {
    setCurrentCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
  (section.querySelector('.curves-reset-all') as HTMLButtonElement).addEventListener('click', () => {
    state.genome.channelCurves = undefined;
    onPathChange('channelCurves', undefined);
    redrawCanvas();
  });

  // Before-after — press-and-hold
  const previewBtn = section.querySelector('[data-curve-preview-off]') as HTMLButtonElement;
  previewBtn.addEventListener('mousedown', () => {
    state.colorCurvesPreviewOff = true;
    onPathChange('colorCurvesPreviewOff', true);
  });
  previewBtn.addEventListener('mouseup', () => {
    state.colorCurvesPreviewOff = false;
    onPathChange('colorCurvesPreviewOff', false);
  });
  previewBtn.addEventListener('mouseleave', () => {
    if (state.colorCurvesPreviewOff) {
      state.colorCurvesPreviewOff = false;
      onPathChange('colorCurvesPreviewOff', false);
    }
  });

  // Snap-to-grid
  const snapBtn = section.querySelector('[data-curve-snap]') as HTMLButtonElement;
  snapBtn.addEventListener('click', () => {
    state.colorCurvesSnapToGrid = !state.colorCurvesSnapToGrid;
    snapBtn.classList.toggle('active', !!state.colorCurvesSnapToGrid);
  });
```

Helper:

```ts
function formatPresetLabel(key: string): string {
  return key
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
```

- [ ] **Step 7.4: Wire `colorCurvesPreviewOff` into the visualize.draw call**

In `src/renderer.ts` (or whichever module calls `visualize.draw`), when `state.colorCurvesPreviewOff === true`, pass `undefined` for `channelCurves` regardless of what's on the genome:

```ts
const cc = state.colorCurvesPreviewOff ? undefined : state.genome.channelCurves;
visualizePass.draw(tonemap, k1, k2, useDE, view, bg, cc);
```

- [ ] **Step 7.5: Implement histogram readback**

Add to `src/edit-section-curves.ts` a histogram-update routine:

```ts
  // Histogram overlay state. 256 buckets per channel: R, G, B, Y(BT.709).
  const histogram = {
    r: new Float32Array(256),
    g: new Float32Array(256),
    b: new Float32Array(256),
    luma: new Float32Array(256),
  };

  function updateHistogram(canvas: HTMLCanvasElement, sampleCount: number = 5000) {
    // Read back current canvas pixels — main pyr3 canvas is on state.mainCanvas
    const main = (state as any).mainCanvas as HTMLCanvasElement | undefined;
    if (!main) return;
    const ctx = main.getContext('webgpu') ? null : (main.getContext('2d') as CanvasRenderingContext2D | null);
    // WebGPU canvas readback: use the existing `state.lastFrame` if exposed by the renderer,
    // OR a copy-to-2d-canvas fallback via drawImage.
    const tmp = document.createElement('canvas');
    tmp.width = main.width; tmp.height = main.height;
    const tctx = tmp.getContext('2d')!;
    tctx.drawImage(main, 0, 0);
    const img = tctx.getImageData(0, 0, main.width, main.height).data;

    for (const k of Object.keys(histogram) as Array<keyof typeof histogram>) histogram[k].fill(0);
    const stride = Math.max(1, Math.floor((main.width * main.height) / sampleCount));
    for (let p = 0; p < main.width * main.height; p += stride) {
      const i = p * 4;
      const r = img[i + 0], g = img[i + 1], b = img[i + 2];
      const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      histogram.r[r]++; histogram.g[g]++; histogram.b[b]++; histogram.luma[y]++;
    }
    // Normalize each channel to [0,1] against its own max
    for (const k of Object.keys(histogram) as Array<keyof typeof histogram>) {
      let max = 0;
      for (let i = 0; i < 256; i++) if (histogram[k][i] > max) max = histogram[k][i];
      if (max > 0) for (let i = 0; i < 256; i++) histogram[k][i] /= max;
    }
    redrawCanvas();
  }

  // Hook the renderer's settle event if it exists; otherwise sample on each redraw
  // event ((state as any).onRenderSettle is set by edit-mount in Task 8).
  if (typeof (state as any).onRenderSettle === 'function') {
    (state as any).onRenderSettle(() => updateHistogram(canvas));
  }
```

And in `drawCurveCanvas`, before drawing the spline, render the histogram:

```ts
  // Histogram fill (per active channel; Composite overlays R+G+B)
  const ch = state.activeColorCurveChannel!;
  const hist = ch === 'composite'
    ? [{ data: histogram.r, color: 'rgba(255,80,80,0.18)' },
       { data: histogram.g, color: 'rgba(80,255,80,0.18)' },
       { data: histogram.b, color: 'rgba(80,80,255,0.18)' }]
    : ch === 'luma'
      ? [{ data: histogram.luma, color: 'rgba(255,255,255,0.25)' }]
      : [{ data: histogram[ch], color: 'rgba(160,200,255,0.25)' }];
  for (const { data, color } of hist) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const px = (i / 255) * w;
      const py = h - data[i] * h;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
```

- [ ] **Step 7.6: Run tests + typecheck**

Run: `npx vitest run src/edit-section-curves.test.ts`
Expected: all tests pass (including new presets/reset/toggle).

Run: `npm run typecheck && npm test`
Expected: full suite green.

- [ ] **Step 7.7: Commit**

```bash
git add src/edit-section-curves.ts src/edit-section-curves.test.ts src/renderer.ts
git commit -m "feat(#116): presets, reset buttons, before/after toggle, histogram overlay"
```

---

## Task 8 · Persistence (JSON round-trip) + end-to-end verification

**Files:**
- Modify: `src/genome-json.ts` (or equivalent serializer location)
- Create: `.remember/verify/116-color-curves.html` (gitignored)

- [ ] **Step 8.1: Read existing JSON serializer**

Run: `grep -rn "channelCurves\|genomeToJson\|genomeFromJson" src/ | head -20`

Identify the serialize and parse entry points. Most likely `src/genome-json.ts` with `genomeToJson(g): unknown` and `genomeFromJson(j: unknown): Genome`.

- [ ] **Step 8.2: Write a failing JSON round-trip test**

In `src/genome-json.test.ts` (existing file), add:

```ts
describe('genome-json: channelCurves round-trip', () => {
  it('preserves a non-identity composite curve', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
        r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    };
    const j = genomeToJson(g);
    const back = genomeFromJson(j);
    expect(back.channelCurves?.composite).toEqual(g.channelCurves!.composite);
  });
  it('omits channelCurves when all 5 channels are identity', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
        b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    };
    const j = genomeToJson(g) as Record<string, unknown>;
    expect(j.channelCurves).toBeUndefined();
  });
  it('treats absent channelCurves as undefined', () => {
    const j = { ...(genomeToJson(SPIRAL_GALAXY) as Record<string, unknown>) };
    delete j.channelCurves;
    const back = genomeFromJson(j);
    expect(back.channelCurves).toBeUndefined();
  });
});
```

- [ ] **Step 8.3: Run tests to verify failure**

Run: `npx vitest run src/genome-json.test.ts`
Expected: round-trip tests fail (`channelCurves` not in serializer).

- [ ] **Step 8.4: Add channelCurves to the serializer**

In `src/genome-json.ts` (or wherever Genome is round-tripped), in `genomeToJson`:

```ts
import { activeMask } from './channel-curves';

// … inside the object construction:
if (g.channelCurves && activeMask(g.channelCurves) !== 0) {
  out.channelCurves = g.channelCurves;
}
```

In `genomeFromJson`:

```ts
if (j.channelCurves) out.channelCurves = j.channelCurves as ChannelCurves;
```

- [ ] **Step 8.5: Verify tests pass**

Run: `npx vitest run src/genome-json.test.ts`
Expected: all green.

- [ ] **Step 8.6: Build the eyeball-verify HTML gallery**

Render 5+ fixtures via `npm run render` and `bin/pyr3-render.ts` — once without curves, once with an aggressive Soft-S composite + lift-shadows + crush-highlights composite-only grade.

Pick 5 fixtures from `fixtures/flam3-goldens/`. For each:
- Generate baseline render: `npm run render fixtures/flam3-goldens/<id>/genome.flam3 .remember/verify/116-baseline-<id>.png`
- Generate graded render: create a `.pyr3.json` carrying the curves, then `npm run render <json> .remember/verify/116-graded-<id>.png`

(Specific grades to use, all 4-point composite curves:
- aggressive Soft-S: `[{x:0,y:0},{x:0.25,y:0.08},{x:0.75,y:0.92},{x:1,y:1}]`
- shadow lift: `[{x:0,y:0.20},{x:0.5,y:0.55},{x:1,y:1}]`
- highlight crush: `[{x:0,y:0},{x:0.75,y:0.85},{x:1,y:0.85}]`
)

Create `.remember/verify/116-color-curves.html` (gitignored — `.remember/` is in `.gitignore`):

```html
<!doctype html>
<html><head>
<meta charset="utf-8">
<title>#116 Color Curves — eyeball verify</title>
<style>
  body { background: #111; color: #ddd; font-family: monospace; margin: 16px; }
  h1 { color: #9cf; }
  table { border-collapse: collapse; margin-bottom: 24px; }
  td { padding: 4px 8px; border: 1px solid #333; vertical-align: top; }
  img { display: block; width: 320px; height: auto; }
  .pill { display: inline-block; padding: 2px 8px; background: #246; border-radius: 12px; }
</style>
</head><body>
<h1>#116 Color Curves — eyeball verify</h1>
<p>Each row: same fixture, baseline (no curves) | with curves applied | difference.</p>
<table>
  <tr><th>Fixture</th><th>baseline</th><th>graded</th><th>note</th></tr>
  <tr>
    <td>fixture-001</td>
    <td><img src="file:///Users/matt/dev/MattAltermatt/pyr3/.remember/verify/116-baseline-001.png"></td>
    <td><img src="file:///Users/matt/dev/MattAltermatt/pyr3/.remember/verify/116-graded-001.png"></td>
    <td>Soft-S</td>
  </tr>
  <!-- ...4 more rows… -->
</table>
</body></html>
```

Hand the file path to the user as `file:///Users/matt/dev/MattAltermatt/pyr3/.remember/verify/116-color-curves.html` on its own line.

- [ ] **Step 8.7: Run the dev server and Chrome-verify the editor section**

Run the dev server in the background:
```bash
npm run dev
```

Hand the URL: `http://localhost:5173/v1/edit?ship=procgen`

Use `chrome-devtools-mcp` to navigate, screenshot, and click through:
- Composite tab → click an empty area, drag the new point → curve updates
- Click Soft-S preset → curve snaps to S shape → main canvas reflects
- Click 👁 button → before/after toggles
- Switch to R tab → independent R curve

The user does manual visual confirmation.

- [ ] **Step 8.8: Run the FE↔BE smoke** (3 fixtures, ~90s)

Run: `npm run test:fe-be-smoke`
Expected: 3/3 green. Confirms the FE and BE produce equivalent renders with the new GPU bindings.

- [ ] **Step 8.9: Run the BE parity rig one final time**

Run: `npm run test:parity`
Expected: 26/26 green. Final ship-gate confirmation.

- [ ] **Step 8.10: Final typecheck + test sweep**

Run: `npm run typecheck && npm run typecheck:engine && npm test`
Expected: all green; +6-8 new tests added across the plan.

- [ ] **Step 8.11: Commit verify artifacts (gitignored — confirm)**

```bash
git status --short
```

Expected: `.remember/` files NOT listed in `git status` (gitignored). If they show, double-check `.gitignore` includes `.remember/`.

Final implementation commit (likely nothing left to commit; if any straggler, commit it):

```bash
git status
# if there are uncommitted changes, commit them with the next logical message
```

- [ ] **Step 8.12: Squash + FF-merge prep**

Per [[feedback-explicit-ship-approval]] — do NOT FF-merge without explicit user approval. Surface the verify URL + ship-readiness checklist to the user and wait for sign-off.

```bash
git log --oneline main..HEAD
```

Expected: 6-8 task commits. Recommend squashing into a single commit before FF-merge for cleanliness (per user CLAUDE.md "Squash feature-branch commits before FF-merge when safe").

---

## Self-review

### Spec coverage check

- §1 Scope, naming, sibling tickets → Task 0 (this header); sibling tickets filed AFTER ship (user-gated)
- §2 Data model → Task 1
- §3 CPU bake → Task 1
- §4 GPU integration → Tasks 2 + 3
- §5 Editor UI → Tasks 5 + 6 + 7
- §6 Persistence → Task 8
- §7 Parity invariants → Task 3 (visualize.identity.test.ts + visualize.curves-active.test.ts)
- §8 Testing inventory → Tasks 1, 3, 5, 6, 7, 8
- §9 Acceptance criteria → Task 8 final sweep

### Placeholder scan

No "TBD" / "TODO" / "implement later" / "Similar to Task N" anywhere. Every code-required step ships actual code blocks. Each test step shows the actual test code. Edge cases ("refuse to delete below 2 points") have explicit test coverage.

### Type consistency

- `CurvePoint`, `ChannelCurves`, `IDENTITY_POINTS` — defined in Task 1, used identically in Tasks 3-8
- `activeMask`, `bakeCurves`, `bakeOne` — same signatures throughout
- `mountChannelCurvesSection(host, state, onPathChange)` — same signature in Tasks 5, 6, 7
- Channel keys `'composite' | 'r' | 'g' | 'b' | 'luma'` — consistent everywhere

### Sibling tickets (deferred filing)

Three sibling tickets are listed in the spec (HSL Adjustments, v1.1 stretches, Scopes panel). **Filing them is a GitHub write action that requires explicit user approval per CLAUDE.md** — do NOT file as part of plan execution. Surface to user for approval as a separate ask after the implementation lands.
