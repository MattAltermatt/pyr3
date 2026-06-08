# #114 — DC (direct-color) variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 direct-color variations (`dc_linear`, `dc_perlin`, `dc_gridout`, `dc_cylinder` at indices 99-102) that color a flame xform by computing RGB from spatial position instead of looking up `palette[color_index]`. Override-semantics matching JWildfire; zero genome-schema break.

**Architecture:** Per-xform `dc_flag` baked into the existing xform pack (free slot at `o + 11`, previously pad). Chaos kernel iterates the variation chain as today; when a DC variation runs, it writes to a thread-local `rgb_override: vec3f`. After the chain, the histogram write picks `rgb_override` instead of `palette[color_index]` when `dc_flag > 0.5`. The 4 DC variations are just new entries in `VARIATION_NAMES` / `VARIATION_PARAMS` — no `Xform` schema change. Editor gets a "Direct color" picker category with banner + tooltips + external docs link.

**Tech Stack:** TypeScript + WGSL + WebGPU (Dawn via `webgpu` for CLI, navigator.gpu for browser). Vitest + tsx for tests. The 26-fixture parity rig (`npm run test:parity`) is the safety net — DC additions must not change its output.

**Spec:** `docs/superpowers/specs/2026-06-06-issue-114-dc-variations-design.md`

**Execution split (per CLAUDE.md heuristic):**

| Task | Mode | Reason |
|------|------|--------|
| 1. Perlin noise WGSL utility + JS oracle | **inline** | Locks the noise-test idiom; foundational |
| 2. DC override mechanism end-to-end via `dc_linear` | **inline** | Locks ABI shape (pack slot, kernel branch, variation registration) |
| 3. `dc_perlin` | **subagent** | Replicable on Task 1's noise utility |
| 4. `dc_gridout` + `dc_cylinder` | **subagent** | Replicable on Task 2's pattern |
| 5. Importer round-trip | **subagent** | Pure logic + test |
| 6. Editor: picker category + banner + tooltips | **inline** | Chrome verify for hover/click |
| 7. Editor: in-xform DC indicator + color annotation | **inline** | Chrome verify |
| 8. Help page DC section | **subagent** | Pure content |
| 9. Showcase comparison pair + README link | **inline** | Runs `npm run render` twice; dev-server orchestration |
| 10. Final verify + user gate + FF-merge | **inline** | Parity rig + Chrome eyeball + ship gate |

---

## Task 1: Perlin noise WGSL utility + JS oracle

**Files:**
- Create: `src/shaders/noise_perlin.wgsl` (standalone WGSL functions)
- Create: `src/noise-perlin-oracle.ts` (JS f64 reference impl for tests)
- Create: `src/noise-perlin.gpu.test.ts` (WGSL vs oracle test via `extractWgslFn`)
- Modify: `src/shaders/chaos.wgsl` — `#include` or inline `noise_perlin.wgsl` (depending on existing pattern; check how `safe_sin` is shared today)

**Why first:** `dc_perlin` is the hero variation; Perlin noise is the riskiest WGSL piece (gradient table, 2D interpolation, fBm octaves ≈ 80 LOC). Land + test in isolation before any DC plumbing. Establishes the `extractWgslFn` test pattern for the rest of the plan.

- [ ] **Step 1: Write the JS oracle (f64 reference)**

```typescript
// src/noise-perlin-oracle.ts
// Classic Perlin (Ken Perlin 2002 improved noise) — 2D variant.
// Reference for WGSL implementation; never used at render time.

const PERM = new Uint8Array(512);
const P_BASE = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
for (let i = 0; i < 256; i++) PERM[i] = P_BASE[i]!;
for (let i = 0; i < 256; i++) PERM[256 + i] = P_BASE[i]!;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);

function grad2(hash: number, x: number, y: number): number {
  // 8 gradient vectors on the 2D plane (subset of 12 used in 3D Perlin)
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
}

export function perlin2d(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const A = (PERM[X]! + Y) & 255;
  const B = (PERM[X + 1]! + Y) & 255;
  const g00 = grad2(PERM[A]!, xf, yf);
  const g10 = grad2(PERM[B]!, xf - 1, yf);
  const g01 = grad2(PERM[A + 1]!, xf, yf - 1);
  const g11 = grad2(PERM[B + 1]!, xf - 1, yf - 1);
  return lerp(lerp(g00, g10, u), lerp(g01, g11, u), v);
}

export function perlinFbm(x: number, y: number, octaves: number, scale = 1): number {
  let total = 0;
  let amp = 1;
  let freq = scale;
  let max = 0;
  const O = Math.max(1, Math.min(8, Math.floor(octaves)));
  for (let i = 0; i < O; i++) {
    total += perlin2d(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / max;
}
```

- [ ] **Step 2: Write WGSL counterpart**

```wgsl
// src/shaders/noise_perlin.wgsl
// 2D classic Perlin (Ken Perlin 2002 improved noise). Permutation table is
// the canonical Perlin reference table, hard-coded to keep determinism
// identical across browser + Node CLI. See noise-perlin-oracle.ts for the
// JS reference this matches bit-for-bit (within f32 vs f64 tolerance).

const PERM: array<u32, 512> = array<u32, 512>(
  151u, 160u, 137u, 91u, 90u, 15u, /* ... full 256 + repeat ... */
  // Full table — repeat from oracle PERM_BASE, twice
);

fn fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn grad2(hash: u32, x: f32, y: f32) -> f32 {
  let h = hash & 7u;
  let u = select(y, x, h < 4u);
  let v = select(x, y, h < 4u);
  let a = select(u, -u, (h & 1u) != 0u);
  let b = select(2.0 * v, -2.0 * v, (h & 2u) != 0u);
  return a + b;
}

fn perlin2d(p: vec2f) -> f32 {
  let pxf = floor(p.x);
  let pyf = floor(p.y);
  let X = u32(i32(pxf) & 255);
  let Y = u32(i32(pyf) & 255);
  let xf = p.x - pxf;
  let yf = p.y - pyf;
  let u = fade(xf);
  let v = fade(yf);
  let A = (PERM[X] + Y) & 255u;
  let B = (PERM[X + 1u] + Y) & 255u;
  let g00 = grad2(PERM[A], xf, yf);
  let g10 = grad2(PERM[B], xf - 1.0, yf);
  let g01 = grad2(PERM[A + 1u], xf, yf - 1.0);
  let g11 = grad2(PERM[B + 1u], xf - 1.0, yf - 1.0);
  return mix(mix(g00, g10, u), mix(g01, g11, u), v);
}

fn perlin_fbm(p: vec2f, octaves: f32, scale: f32) -> f32 {
  var total: f32 = 0.0;
  var amp: f32 = 1.0;
  var freq: f32 = scale;
  var maxv: f32 = 0.0;
  let O = u32(clamp(octaves, 1.0, 8.0));
  for (var i = 0u; i < O; i = i + 1u) {
    total = total + perlin2d(p * freq) * amp;
    maxv = maxv + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  return total / maxv;
}
```

The PERM array body must be the full 512 entries (256 from `P_BASE` then repeat). Spelled out in full when writing the file.

- [ ] **Step 3: Write the GPU test (extract pattern, NOT full dispatch)**

```typescript
// src/noise-perlin.gpu.test.ts
import { describe, it, expect } from 'vitest';
import { extractWgslFn } from './extract';   // existing utility
import { perlin2d, perlinFbm } from './noise-perlin-oracle';
import { runWgslFn } from './gpu-test-host'; // existing utility per #16 pattern

describe('perlin2d WGSL matches oracle', () => {
  const samples = [
    [0.1, 0.1], [1.5, 2.7], [-3.3, 4.8], [10.0, 10.0],
    [0.0, 0.0], [255.5, 255.5], [-255.5, -255.5],
  ];
  for (const [x, y] of samples) {
    it(`perlin2d(${x}, ${y}) matches JS oracle within 1e-5`, async () => {
      const expected = perlin2d(x, y);
      const actual = await runWgslFn('perlin2d', { p: [x, y] }, 'noise_perlin.wgsl');
      expect(actual).toBeCloseTo(expected, 5);
    });
  }
});
```

Pattern lifted from existing `*.gpu.test.ts` (per [[reference-dawn-vitest-full-kernel-dispatch-crash]] — extract via `extractWgslFn`, never dispatch full kernel in vitest).

- [ ] **Step 4: Run tests**

```bash
npm test -- noise-perlin.gpu --run
```

Expected: all sample points within 1e-5 of oracle. If `runWgslFn` or `extractWgslFn` have a different exact signature in pyr3's current test infra, adapt — the principle (extract WGSL fn, run on tiny dispatch, compare to JS oracle) is what matters.

- [ ] **Step 5: Commit**

```bash
git add src/shaders/noise_perlin.wgsl src/noise-perlin-oracle.ts src/noise-perlin.gpu.test.ts
git commit -m "feat(#114): Perlin noise WGSL utility + JS oracle"
```

---

## Task 2: DC override mechanism end-to-end (via dc_linear)

**Files:**
- Modify: `src/variations.ts` — add indices 99-102 to `V` enum, names + params, export `DC_VARIATION_SET`
- Modify: `src/genome.ts:packXformInto` — bake `dc_flag` into slot `o + 11` (currently pad)
- Modify: `src/shaders/chaos.wgsl` — add `var_dc_linear`, override branch in histogram write
- Create: `src/dc-flag-pack.test.ts` — assert `packXforms` sets slot 11 = 1 iff chain has DC variation
- Create: `src/dc-variations.gpu.test.ts` — initial test for `dc_linear` RGB output

**Why now:** Lock the ABI shape end-to-end with the simplest possible DC variation (`dc_linear`). Once this works, the remaining 3 are just adding WGSL functions and registry entries.

- [ ] **Step 1: Extend the variations registry**

```typescript
// src/variations.ts — append to V
export const V = {
  // ... existing 0-98 ...
  mobius: 98,
  // Phase #114: DC (direct-color) variations
  dc_linear: 99,
  dc_perlin: 100,
  dc_gridout: 101,
  dc_cylinder: 102,
} as const;

// Append to VARIATION_NAMES + VARIATION_PARAMS
// (auto-generated from V in current code? check; if so, just registering V is enough)

export const DC_VARIATION_SET: ReadonlySet<number> = new Set([
  V.dc_linear, V.dc_perlin, V.dc_gridout, V.dc_cylinder,
]);

// Per-variation params:
// VARIATION_PARAMS['dc_linear']   = [];
// VARIATION_PARAMS['dc_perlin']   = ['scale', 'octaves', 'color_seed'];
// VARIATION_PARAMS['dc_gridout']  = ['cells'];
// VARIATION_PARAMS['dc_cylinder'] = [];
```

Check existing pattern — `VARIATION_NAMES` may auto-derive from `V`; if so just add to `V`. Otherwise add the four name entries explicitly. `VARIATION_PARAMS` definitely needs the four entries.

- [ ] **Step 2: Write dc_flag-pack test**

```typescript
// src/dc-flag-pack.test.ts
import { describe, it, expect } from 'vitest';
import { packXforms, XFORM_FLOATS } from './genome';
import { V, DC_VARIATION_SET } from './variations';
import type { Genome, Xform } from './genome';

function makeXform(variations: { index: number; weight: number }[]): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1, color: 0.5, colorSpeed: 0, opacity: 1,
    variations,
  } as Xform;
}

function genome(xforms: Xform[]): Genome {
  return {
    xforms, scale: 1, cx: 0, cy: 0, rotate: 0,
    palette: new Array(256).fill([0,0,0,1]),
  } as unknown as Genome;
}

describe('dc_flag packing', () => {
  it('sets dc_flag = 0 for an xform with only linear', () => {
    const g = genome([makeXform([{ index: V.linear, weight: 1 }])]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[11]).toBe(0);  // slot 11 = dc_flag
  });

  it('sets dc_flag = 1 for an xform with dc_linear in chain', () => {
    const g = genome([makeXform([
      { index: V.linear, weight: 0.5 },
      { index: V.dc_linear, weight: 1 },
    ])]);
    const buf = new Float32Array(packXforms(g));
    expect(buf[11]).toBe(1);
  });

  it('sets dc_flag = 1 for any DC variation', () => {
    for (const dcIdx of DC_VARIATION_SET) {
      const g = genome([makeXform([{ index: dcIdx, weight: 1 }])]);
      const buf = new Float32Array(packXforms(g));
      expect(buf[11]).toBe(1);
    }
  });
});
```

- [ ] **Step 3: Run — verify it fails (dc_flag write not yet wired)**

```bash
npm test -- dc-flag-pack --run
```

Expected: all three tests fail with `buf[11] === 0` for the DC cases.

- [ ] **Step 4: Bake dc_flag into packXformInto**

```typescript
// src/genome.ts — replace the line "// 11 is pad (already zero from ArrayBuffer init)"
// with:

import { DC_VARIATION_SET } from './variations';   // add this import at top

// inside packXformInto, after slot 10 (opacity) and before slot 12 (post matrix):
const hasDc = x.variations.some(v => DC_VARIATION_SET.has(v.index));
buf[o + 11] = hasDc ? 1.0 : 0.0;
```

- [ ] **Step 5: Run — tests pass**

```bash
npm test -- dc-flag-pack --run
```

Expected: all three pass.

- [ ] **Step 6: Add dc_linear WGSL function + override branch**

Edit `src/shaders/chaos.wgsl`:

1. Add `var_dc_linear` near the other `var_*` functions:

```wgsl
// DC (direct-color) variations — override the per-scatter RGB write.
// All var_dc_* functions return position contribution (always vec2f) AND
// write to thread-local rgb_override via the dc_color output parameter.
// Position output for dc_linear is identity (it only affects color).

fn var_dc_linear_color(p: vec2f) -> vec3f {
  // Map (x, y) to (R, G, B) via a simple coord-to-color affine.
  // Clamped to [0, 1].
  return clamp(vec3f(
    0.5 + 0.5 * p.x,
    0.5 + 0.5 * p.y,
    0.5 - 0.25 * (p.x + p.y)
  ), vec3f(0.0), vec3f(1.0));
}
```

2. In the main chaos loop, add a thread-local `var rgb_override: vec3f = vec3f(0.0);` and add a branch in the variation-dispatch switch:

```wgsl
case 99u: {
  // dc_linear — position is identity, color overrides
  rgb_override = var_dc_linear_color(p_in);
  // No position contribution.
}
```

3. In the histogram write site, read `dc_flag` from xform buffer (`xforms[xi].color_params.dc_flag` — adjust to actual access pattern) and pick the color:

```wgsl
let color_rgb = select(
  palette_sample(color_index),  // existing path
  rgb_override,                 // DC override
  dc_flag > 0.5
);
```

Exact access patterns depend on how `chaos.wgsl` is currently structured — the engineer adapts the snippets to the existing variable names and buffer access conventions. The PRINCIPLE is: read slot 11 as `dc_flag`, track `rgb_override` per scatter, pick at write time.

- [ ] **Step 7: Write minimal GPU test for dc_linear**

```typescript
// src/dc-variations.gpu.test.ts
import { describe, it, expect } from 'vitest';
import { runWgslFn } from './gpu-test-host';

describe('dc_linear WGSL', () => {
  it('returns RGB for sample positions', async () => {
    const result = await runWgslFn('var_dc_linear_color', { p: [0, 0] }, 'chaos.wgsl');
    expect(result).toEqual([0.5, 0.5, 0.5]);
  });
  it('clamps at extremes', async () => {
    const result = await runWgslFn('var_dc_linear_color', { p: [10, 10] }, 'chaos.wgsl');
    expect(result).toEqual([1.0, 1.0, expect.any(Number)]);
  });
});
```

- [ ] **Step 8: Run all tests + typecheck + parity rig**

```bash
npm run typecheck && npm test -- --run
npm run test:parity     # 91s — the safety net
```

Expected: typecheck clean, unit suite green, parity rig still passes (DC additions are dead code for the 26 fixtures because none use DC variations).

- [ ] **Step 9: Chrome verify — render a hand-authored dc_linear flame**

Author a tiny .flam3 with one xform that uses `dc_linear`. Start dev server (`npm run dev`), navigate Chrome via `chrome-devtools-mcp` to `http://localhost:5173/?ship=editor` (or however the editor route loads), load the flame, screenshot. Should render with a coord-gradient color across the canvas — NOT the genome's palette colors. Save screenshot to `.remember/verify/`.

- [ ] **Step 10: Commit**

```bash
git add src/variations.ts src/genome.ts src/dc-flag-pack.test.ts src/shaders/chaos.wgsl src/dc-variations.gpu.test.ts
git commit -m "feat(#114): DC override mechanism end-to-end via dc_linear

- V enum + DC_VARIATION_SET (indices 99-102)
- dc_flag baked into xform pack slot 11 (was pad)
- chaos.wgsl override branch in histogram write
- dc_linear as simplest DC variation (coord-to-color)
- Parity rig unchanged (dc_flag=0 for all existing fixtures)"
```

---

## Task 3: dc_perlin

**Files:**
- Modify: `src/shaders/chaos.wgsl` — add `var_dc_perlin_color`, register case 100
- Modify: `src/dc-variations.gpu.test.ts` — sample tests
- Test: a hand-authored dc_perlin flame via Chrome

**Mode:** subagent (replicable now that Task 1's noise utility and Task 2's override path are in place).

- [ ] **Step 1: Add dc_perlin to chaos.wgsl**

```wgsl
fn var_dc_perlin_color(p: vec2f, scale: f32, octaves: f32, color_seed: f32) -> vec3f {
  let n = perlin_fbm(p, octaves, scale);
  // Map noise [-1, 1] → hue [0, 1], full saturation, mid lightness
  let hue = fract(0.5 + 0.5 * n + color_seed);
  return hsl_to_rgb(vec3f(hue, 1.0, 0.55));
}

// Standard HSL→RGB if not already present in chaos.wgsl:
fn hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x; let s = hsl.y; let l = hsl.z;
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
  let m = l - c * 0.5;
  var rgb: vec3f;
  let h6 = h * 6.0;
  if (h6 < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (h6 < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (h6 < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (h6 < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (h6 < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(m);
}
```

Add `case 100u` to the variation-dispatch switch reading `params.scale`, `params.octaves`, `params.color_seed` from the per-variation param slots.

- [ ] **Step 2: Add GPU tests for dc_perlin**

Sample 5-10 points; compare to JS oracle composed of `perlinFbm` + the same HSL→RGB.

- [ ] **Step 3: Test + parity rig**

```bash
npm test -- --run
npm run test:parity
```

- [ ] **Step 4: Chrome verify with hand-authored dc_perlin flame**

Render and screenshot. The output should be visually similar to wolfepaw's perlin-spiral pieces — multicolored noise texture across the chaos game scatter.

- [ ] **Step 5: Commit**

```bash
git add src/shaders/chaos.wgsl src/dc-variations.gpu.test.ts
git commit -m "feat(#114): dc_perlin — Perlin-noise direct color"
```

---

## Task 4: dc_gridout + dc_cylinder

**Files:**
- Modify: `src/shaders/chaos.wgsl` — add `var_dc_gridout_color`, `var_dc_cylinder` (position warp + color)
- Modify: `src/dc-variations.gpu.test.ts` — sample tests
- Test: Chrome verify with hand-authored flames

**Mode:** subagent.

- [ ] **Step 1: dc_gridout — discrete quadrant coloring**

```wgsl
fn var_dc_gridout_color(p: vec2f, cells: f32) -> vec3f {
  let n = max(cells, 1.0);
  let cx = floor(p.x * n);
  let cy = floor(p.y * n);
  // Hash cell index to RGB
  let h = hash_u32(u32(i32(cx) * 73856093 ^ i32(cy) * 19349663));
  return vec3f(
    f32((h >> 0u)  & 0xFFu) / 255.0,
    f32((h >> 8u)  & 0xFFu) / 255.0,
    f32((h >> 16u) & 0xFFu) / 255.0
  );
}
```

`hash_u32` should already exist in chaos.wgsl (used elsewhere); reuse it.

- [ ] **Step 2: dc_cylinder — position AND color tied to cylinder mapping**

```wgsl
// Position: same as existing var_cylinder (out = (sin(x), y))
fn var_dc_cylinder_pos(p: vec2f) -> vec2f {
  return vec2f(safe_sin(p.x), p.y);
}

fn var_dc_cylinder_color(p_out: vec2f) -> vec3f {
  // theta + height → hue + lightness
  let hue = fract(0.5 + 0.5 * p_out.x);
  let lit = clamp(0.5 + 0.25 * p_out.y, 0.2, 0.8);
  return hsl_to_rgb(vec3f(hue, 0.9, lit));
}
```

`dc_cylinder` is the only first-wave DC that warps position too — the dispatch case writes BOTH position contribution and `rgb_override`.

`safe_sin` use per [[reference-dawn-f32-trig-range-cliff]].

- [ ] **Step 3: Register cases 101 (dc_gridout) and 102 (dc_cylinder) in dispatch switch**

- [ ] **Step 4: Add GPU tests for both**

- [ ] **Step 5: Test + parity + Chrome verify for each**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(#114): dc_gridout + dc_cylinder — quadrant + shape-tied DC"
```

---

## Task 5: Importer round-trip

**Files:**
- Modify: `src/flame-import.ts` — verify the 4 new names are recognized (should be automatic if importer matches against `VARIATION_NAMES`; if not, add explicit cases)
- Modify: `src/flame-import.test.ts` — add round-trip test for a sample JWildfire `<flame>` with `dc_perlin`

**Mode:** subagent.

- [ ] **Step 1: Write a fixture flame XML using dc_perlin**

```xml
<!-- src/__fixtures__/dc-perlin-sample.flame -->
<flame name="dc_perlin_test" size="512 512" center="0 0" scale="100" quality="50">
  <xform weight="1" color="0" dc_perlin="1.0" dc_perlin_scale="2.0" dc_perlin_octaves="3" dc_perlin_color_seed="0.0" coefs="1 0 0 0 1 0"/>
  <palette count="256" format="RGB">FFFFFF...</palette>
</flame>
```

- [ ] **Step 2: Write the round-trip test**

```typescript
// src/flame-import.test.ts — append
it('round-trips dc_perlin variation', () => {
  const xml = readFileSync('src/__fixtures__/dc-perlin-sample.flame', 'utf-8');
  const genome = importFlame(xml);
  const xform = genome.xforms[0]!;
  const dcVar = xform.variations.find(v => v.index === V.dc_perlin);
  expect(dcVar).toBeDefined();
  expect(dcVar!.weight).toBe(1.0);
  // params: scale, octaves, color_seed
  expect(dcVar!.param0).toBe(2.0);
  expect(dcVar!.param1).toBe(3);
  expect(dcVar!.param2).toBe(0.0);
});
```

- [ ] **Step 3: Run — fails if importer doesn't recognize name**

If failing, add `dc_perlin`, `dc_linear`, `dc_gridout`, `dc_cylinder` and their params to whatever lookup table the importer uses (most likely the `VARIATION_PARAMS` registry already drives this).

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(#114): flame importer recognizes dc_* variations + round-trip test"
```

---

## Task 6: Editor — Direct color picker category + banner + tooltips

**Files:**
- Modify: `src/edit-variation-picker.ts` — add "Direct color" category with the 4 DC variations
- Modify: same file or related CSS — banner block + per-tile tooltip + "Learn more ↗" external link
- Modify: `src/edit-variation-picker.test.ts` — assert the category renders + the learn-more link target

**Mode:** inline (Chrome verify for hover/click).

- [ ] **Step 1: Add category entry**

In the existing categories object (per `src/edit-variation-picker.ts:52` example in spec):

```typescript
'Direct color': [V.dc_linear, V.dc_perlin, V.dc_gridout, V.dc_cylinder],
```

- [ ] **Step 2: Add a category-banner rendering path**

The picker today probably renders categories as plain headers. Add an optional `categoryBanner` map:

```typescript
const CATEGORY_BANNERS: Record<string, { description: string; learnMoreUrl: string }> = {
  'Direct color': {
    description: 'These variations color the xform directly from spatial position, bypassing the palette. Originally from JWildfire.',
    learnMoreUrl: 'https://fractalformulas.wordpress.com/flame-variations/dc_perlin/',
  },
};
```

Render banner above the tile grid when present. Learn-more is an `<a target="_blank" rel="noopener noreferrer">Learn more ↗</a>`.

- [ ] **Step 3: Add per-tile tooltips**

A `VARIATION_TOOLTIPS: Record<string, string>` map. Set on the tile element via `title="..."` attribute (or whatever the picker uses for tooltips today).

- [ ] **Step 4: Test**

```typescript
// src/edit-variation-picker.test.ts — append
it('renders Direct color category with banner', () => {
  const picker = mountPicker();
  const banner = picker.querySelector('[data-category-banner="Direct color"]');
  expect(banner).toBeTruthy();
  const link = banner!.querySelector('a[href*="fractalformulas"]');
  expect(link?.getAttribute('target')).toBe('_blank');
  expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
});
```

- [ ] **Step 5: Chrome verify**

Start dev server, navigate to editor, open variation picker, screenshot the "Direct color" category. Click "Learn more ↗" → verify it opens the fractalformulas page in a new tab.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(#114): editor — Direct color picker category with banner + tooltips"
```

---

## Task 7: Editor — in-xform DC indicator + color/color_speed annotation

**Files:**
- Modify: `src/edit-section-xforms.ts` — ℹ️ chip next to a DC variation in the chain; "(overridden by dc_*)" annotation on color/color_speed rows
- Modify: `src/edit-section-xforms.test.ts` — assertions

**Mode:** inline (Chrome verify).

- [ ] **Step 1: Detect DC presence in the rendered xform**

```typescript
import { DC_VARIATION_SET, VARIATION_NAMES } from './variations';

function dcVariationInChain(xform: Xform): string | null {
  const dc = xform.variations.find(v => DC_VARIATION_SET.has(v.index));
  return dc ? VARIATION_NAMES[dc.index]! : null;
}
```

- [ ] **Step 2: Render the ℹ️ chip on the DC row in the chain list**

Next to the DC variation's row in the existing chain rendering, add:

```typescript
const dcChip = document.createElement('span');
dcChip.className = 'pyr3-edit-dc-chip';
dcChip.textContent = 'ⓘ';
dcChip.title = `This xform's color is computed from position by ${kindName} instead of the palette.`;
dcChip.style.cursor = 'pointer';
dcChip.addEventListener('click', () => {
  window.open('https://fractalformulas.wordpress.com/flame-variations/dc_perlin/', '_blank', 'noopener,noreferrer');
});
row.appendChild(dcChip);
```

- [ ] **Step 3: Annotate color / color_speed rows**

When `dcVariationInChain(xform)` is non-null, render the color row label as:

```typescript
const dcName = dcVariationInChain(xform);
const labelText = dcName
  ? `color (overridden by ${dcName})`
  : 'color';
```

Inputs stay enabled (values persist; not deleted), but the label signals the override.

- [ ] **Step 4: Test**

```typescript
it('shows DC indicator chip when xform has a dc_* variation', () => {
  const mount = renderXformSection({
    xform: makeXform([{ index: V.dc_perlin, weight: 1 }]),
    // ... other args ...
  });
  expect(mount.querySelector('.pyr3-edit-dc-chip')).toBeTruthy();
});

it('annotates color row label when DC override is active', () => {
  const mount = renderXformSection({ xform: makeXform([{ index: V.dc_perlin, weight: 1 }]), /* ... */ });
  const colorLabel = mount.querySelector('[data-row-label="color"]');
  expect(colorLabel?.textContent).toContain('overridden by dc_perlin');
});
```

- [ ] **Step 5: Chrome verify**

Open editor with a flame containing a DC variation; verify chip + annotation render; remove the DC variation and verify they disappear and the color value persists.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(#114): editor — DC chip + color/color_speed override annotation"
```

---

## Task 8: Help-page DC section

**Files:**
- Modify: existing help page (location determined by grepping for "help" or by checking the #104 commit `84e2dc7`)
- Add: a "Direct color variations" section

**Mode:** subagent (pure content).

- [ ] **Step 1: Locate the help page**

```bash
grep -rln "help" src/ | grep -iE "help|template" | head -5
```

Find the module that renders the help / templates page added in #104. Confirm its rendering pattern (string templates? HTML literals? a markdown→DOM converter?).

- [ ] **Step 2: Add the DC section**

Content (adapt to the existing rendering style):

```markdown
## Direct color variations

Most variations color the flame by looking up a palette entry (the
xform's `color` value picks a slot in the 256-stop palette). **Direct
color (DC) variations** instead compute RGB from spatial position,
overriding the palette for any xform that contains one.

DC variations are the signature look of JWildfire (originally from
Neil Slater's Apophysis plugin pack). pyr3 ships four:

- **dc_linear** — color from spatial coord (simplest)
- **dc_perlin** — color from a Perlin noise field (marbled / painterly)
- **dc_gridout** — color by canvas quadrant
- **dc_cylinder** — direct-color version of cylinder

Examples in the wild:
- [LogTile Perlin Spiral by wolfepaw](https://www.deviantart.com/wolfepaw/art/LogTile-Perlin-Spiral-903174997)
- [Sparkly Perlin Spiral by wolfepaw](https://www.deviantart.com/wolfepaw/art/Sparkly-Perlin-Spiral-882594970)

Learn more: [fractalformulas: dc_perlin](https://fractalformulas.wordpress.com/flame-variations/dc_perlin/).
```

- [ ] **Step 3: Run tests + Chrome verify**

Open help page; verify section renders; click external link → opens in new tab.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(#114): help page — Direct color variations section"
```

---

## Task 9: Showcase comparison pair + README link

**Files:**
- Create: `fixtures/showcase/dc-comparison/base.flam3` — base genome
- Create: `fixtures/showcase/dc-comparison/with-dc-perlin.flam3` — same genome with a dc_perlin final-xform
- Create: `fixtures/showcase/dc-comparison/base.png` (rendered)
- Create: `fixtures/showcase/dc-comparison/with-dc-perlin.png` (rendered)
- Create: `fixtures/showcase/dc-comparison/README.md` — explains the comparison
- Modify: project README — link to the comparison

**Mode:** inline (runs `npm run render` twice).

- [ ] **Step 1: Author the base genome**

Pick a clean, visually-interesting genome from the existing showcase corpus as the base. Hand-author the with-dc-perlin variant by adding a dc_perlin final-xform (or modifying one xform's chain).

- [ ] **Step 2: Render both via BE CLI**

```bash
npm run render -- --preset quick fixtures/showcase/dc-comparison/base.flam3 fixtures/showcase/dc-comparison/base.png
npm run render -- --preset quick fixtures/showcase/dc-comparison/with-dc-perlin.flam3 fixtures/showcase/dc-comparison/with-dc-perlin.png
```

- [ ] **Step 3: Write the README**

```markdown
# DC (direct-color) comparison

The same genome rendered with and without a `dc_perlin` final-xform.
Demonstrates the visual delta DC variations unlock — see #114.

| Without DC | With dc_perlin final-xform |
|---|---|
| ![base](base.png) | ![dc](with-dc-perlin.png) |
```

- [ ] **Step 4: Link from project README**

Append to README's features/showcase section: "See [the DC comparison](fixtures/showcase/dc-comparison/) for an example of what direct-color variations unlock."

- [ ] **Step 5: Commit**

```bash
git add fixtures/showcase/dc-comparison/ README.md
git commit -m "feat(#114): showcase — DC comparison pair"
```

⚠️ **Per [[project-repo-debloat-no-artifacts]]**: PNG showcase artifacts must NOT be committed if they're large or if the project hosts them via Release assets. Verify pyr3's convention. Likely path: commit the .flam3 files; render PNGs locally as proof; document the render command in the README; let the showcase auto-bake from the .flam3 sources at deploy time. Adjust commit content accordingly.

---

## Task 10: Final verify + user gate + FF-merge

**Mode:** inline.

- [ ] **Step 1: Full local verification**

```bash
npm run typecheck       # must pass
npm test -- --run        # must pass
npm run test:fe-be-smoke # 3-fixture FE↔BE smoke (~90s) — viewer-path change
npm run test:parity     # 26-fixture parity rig (~91s) — must be UNCHANGED
```

Use `echo $?` after each per [[feedback-no-tail-for-passfail]]. Any failure → fix → re-run.

- [ ] **Step 2: Chrome eyeball — all 4 DC variations live**

Author or load 4 flames each highlighting one of dc_linear / dc_perlin / dc_gridout / dc_cylinder. Verify in Chrome via the editor and the viewer. Screenshot each. Build `.remember/verify/issue-114-dc-variations.html` (3-column pattern per CLAUDE.md verify convention) and hand the user the absolute `file:///...` path.

- [ ] **Step 3: Dispatch a code-review subagent**

Per CLAUDE.md "Code review is a required phase" — dispatch a fresh `feature-dev:code-reviewer` agent (no implementation bias) over the branch diff. Surface any issues; fix or queue as follow-ups.

- [ ] **Step 4: User verify gate**

Hand user the `file:///` URL + a short QA checklist (working / deferred-to-v2 / known-broken per [[feedback-qa-checklist-after-ship]]). WAIT for explicit `y` / `ship` / `merge` before any FF-merge to main.

- [ ] **Step 5: FF-merge + cleanup**

Once user approves:

```bash
git checkout main
git merge --ff-only feature/issue-114-dc-variations
git push origin main
git branch -d feature/issue-114-dc-variations
git push origin --delete feature/issue-114-dc-variations
gh issue close 114 --comment "Shipped in <commit-sha>. See \`docs/superpowers/specs/2026-06-06-issue-114-dc-variations-design.md\` for design, fixtures/showcase/dc-comparison/ for the visual proof."
```

Per CLAUDE.md "Post-ship branch cleanup is standing-authorized at session-end" (when on main, tree clean, branch FF-merged this session).

- [ ] **Step 6: Verify deploy live**

pyr3.app auto-deploys on push to main. Watch the Actions deploy run; once green, open https://pyr3.app/?ship=editor in Chrome; load a DC sample; verify it renders the DC look (not the palette colors). Per [[feedback-verify-live-before-claiming-ship]] — never report shipped from CI green alone.

---

## Out-of-band notes

- **Worktree:** the user's prior session collision memory ([[feedback-shared-checkout-collision]]) means subagent-driven tasks should run via worktree or with strictly-scoped `git add` paths. The branch is already checked out in the main checkout — subagents that don't touch overlapping files (Tasks 3, 4, 5, 8) are safe to run inline-of-this-session.
- **`/effort` advisory:** Task 1-2 are design-shape locking → `xhigh` recommended. Tasks 3-8 are mechanical impl on a locked seam → `medium`. Tasks 9-10 are verify/ship → `low`. The lead should surface the recommendation at phase boundaries but not pause for the flip (auto-continue per the original plan-approval directive, if the user gave one).
- **Memory candidates:** if the dc_flag pack slot (11) works cleanly, that may be worth a `reference-xform-pack-slot-11-dc-flag.md` memory for the next time someone wants to add a per-xform flag. Decide at end of Task 2.

---

## Self-review checklist (run after writing this plan, before exec)

- [x] Spec coverage: every locked decision in the spec maps to a task. WGSL ABI → Task 2. Override semantics → Task 2. Genome schema → Task 2 / 5. First-wave variations → Tasks 2/3/4. Editor UX → Tasks 6/7. Help page → Task 8. Showcase → Task 9. Parity contract → Tasks 2/10.
- [x] No placeholders. Code is shown where steps modify code. Exact files and commands listed.
- [x] Type consistency: `DC_VARIATION_SET`, `V.dc_*`, slot `o + 11`, `rgb_override` used consistently throughout.
- [x] Scope: 10 tasks, each a logical increment with a commit. Inline/subagent split named per task.
