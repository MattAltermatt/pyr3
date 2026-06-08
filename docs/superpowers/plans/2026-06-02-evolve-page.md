# /v1/evolve — Picbreeder-style flame creator — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for Phase 1 and Phase 2 pure-logic tasks; switch to **lead-inline** for Phase 3 (DOM + dev server + Chrome) and Phase 4 (review + ship). Steps use checkbox (`- [ ]`) syntax.

**Issue:** #73 — /v1/evolve — Picbreeder-style flame creator page (+ pyr3.json as save format)
**Spec:** `docs/superpowers/specs/2026-06-02-evolve-page-design.md`
**Goal:** Ship `/v1/evolve` — a Picbreeder-style page where a user evolves a fractal flame from a random seed via labeled mutations, and `.pyr3.json` becomes the native save format with viewer + BE CLI load support.
**Architecture:** Pure-logic foundation (seeder + 8 mutation samplers + state machine, all deterministic given a seeded RNG) → small save/load wiring on viewer + BE CLI → UI layer that mounts at `/v1/evolve`, orchestrates 9 quick-mode renders per generation, and exposes save-to-disk.
**Tech stack:** TypeScript + WebGPU + Vite (FE) · Node + `webgpu` npm (BE) · Vitest (tests) · existing `Genome` shape + `genomeToJson` / `genomeFromJson` from `src/serialize.ts` · existing `flam3-palettes` palette bank.

---

## Phase 1 — Pure-logic foundation (subagent-driven)

Each task is a logical increment: code + tests + green run + commit. No DOM, no GPU dispatch — pure TS testable under the fast `npm test` suite. Tests must be deterministic: every public function takes an `rng: () => number` parameter so the test seeds it.

### Task 1.1 — Add `src/rng.ts` (seedable mulberry32 RNG)

**Files:**
- Create: `src/rng.ts`
- Test: `src/rng.test.ts`

- [ ] **Step 1: Write `src/rng.ts`**

```ts
// Seedable mulberry32 — small, fast, good enough for design tooling.
// Used wherever determinism-under-test matters (evolve samplers, seed gen).
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
```

- [ ] **Step 2: Write `src/rng.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mulberry32, randomSeed } from './rng';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });
  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a() === b()) same++;
    expect(same).toBeLessThan(5);
  });
  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randomSeed', () => {
  it('returns a u32', () => {
    const s = randomSeed();
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(s)).toBe(true);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test -- src/rng.test.ts && \
  git add src/rng.ts src/rng.test.ts && \
  git commit -m "#73 — add seedable mulberry32 RNG primitive"
```

---

### Task 1.2 — Add `src/evolve-seed.ts` (procedural Genome seed)

**Files:**
- Create: `src/evolve-seed.ts`
- Test: `src/evolve-seed.test.ts`

Reference the existing `Genome` / `Xform` / `Variation` shapes in `src/genome.ts` + the variation indices in `src/variations.ts` + palette lookup `getLibraryStops` + `FLAM3_PALETTE_COUNT` from `src/flam3-palettes.ts`.

- [ ] **Step 1: Define seed-bias variation set**

A curated subset of the 99 variations that the procedural seeder samples from (avoids cell-shocking the user with `var_pre_blur` etc. on the first frame). Place this in `evolve-seed.ts`:

```ts
import { V } from './variations';

// Visually-friendly subset for the random starting seed.
export const SEED_BIAS_VARIATIONS: number[] = [
  V.linear, V.sinusoidal, V.spherical, V.swirl, V.horseshoe,
  V.polar, V.heart, V.disc, V.spiral, V.hyperbolic, V.diamond,
  V.ex, V.julia, V.bent, V.waves, V.fisheye,
];
```

- [ ] **Step 2: Write `evolveSeed(rng: () => number): Genome`**

Produces a valid Genome:
- 3 xforms (deterministic given rng)
- Each xform: 1–2 variations sampled from `SEED_BIAS_VARIATIONS` with weights in `[0.4, 1.0]`
- Each xform's affine: identity perturbed by ±0.5 in each of a..f
- xform.weight: uniform sample in `[0.5, 1.0]`
- xform.color: uniform in `[0, 1]`
- xform.colorSpeed: 0.5
- palette: random library palette via `getLibraryStops(Math.floor(rng() * FLAM3_PALETTE_COUNT))`
- viewport: `scale 1.5 cx 0 cy 0 rotate 0`
- no symmetry, no finalxform, no spatialFilter, no density override (uses defaults)

Detailed signature + body shape:

```ts
import { type Genome, type Xform } from './genome';
import { getLibraryStops, FLAM3_PALETTE_COUNT } from './flam3-palettes';
import { paletteFromStops } from './palette';

export function evolveSeed(rng: () => number): Genome {
  const xformCount = 3;
  const xforms: Xform[] = [];
  for (let i = 0; i < xformCount; i++) {
    xforms.push(buildSeedXform(rng));
  }
  const paletteIndex = Math.floor(rng() * FLAM3_PALETTE_COUNT);
  const stops = getLibraryStops(paletteIndex) ?? getLibraryStops(0)!;
  return {
    name: 'evolve seed',
    xforms,
    viewport: { scale: 1.5, cx: 0, cy: 0 },
    palette: paletteFromStops(`flam3-${paletteIndex}`, stops),
    // omit finalxform / symmetry / density / tonemap / rotate / size / spatialFilter
  };
}
// buildSeedXform builds one Xform per spec — implementation detail per signature above.
```

- [ ] **Step 3: Write `src/evolve-seed.test.ts`**

Deterministic-given-seed test, structural-validity test, palette-bank test, smoke-test that it serializes via `genomeToJson` without throwing.

```ts
import { describe, expect, it } from 'vitest';
import { evolveSeed, SEED_BIAS_VARIATIONS } from './evolve-seed';
import { mulberry32 } from './rng';
import { genomeToJson } from './serialize';

describe('evolveSeed', () => {
  it('is deterministic for the same seed', () => {
    const g1 = evolveSeed(mulberry32(42));
    const g2 = evolveSeed(mulberry32(42));
    expect(g1).toEqual(g2);
  });
  it('produces 3 xforms', () => {
    const g = evolveSeed(mulberry32(1));
    expect(g.xforms).toHaveLength(3);
  });
  it('each xform has 1 or 2 variations from the seed-bias set', () => {
    const g = evolveSeed(mulberry32(1));
    for (const x of g.xforms) {
      expect(x.variations.length).toBeGreaterThanOrEqual(1);
      expect(x.variations.length).toBeLessThanOrEqual(2);
      for (const v of x.variations) {
        expect(SEED_BIAS_VARIATIONS).toContain(v.index);
      }
    }
  });
  it('viewport defaults to scale 1.5 / 0 / 0', () => {
    const g = evolveSeed(mulberry32(1));
    expect(g.viewport).toEqual({ scale: 1.5, cx: 0, cy: 0 });
  });
  it('serializes via genomeToJson without throwing', () => {
    const g = evolveSeed(mulberry32(1));
    expect(() => genomeToJson(g)).not.toThrow();
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-seed.test.ts && \
  git add src/evolve-seed.ts src/evolve-seed.test.ts && \
  git commit -m "#73 — add procedural Genome seed (evolve-seed)"
```

---

### Task 1.3 — `src/evolve-mutate.ts` skeleton + 3 mutation kinds (weight nudge, add, swap)

**Files:**
- Create: `src/evolve-mutate.ts`
- Test: `src/evolve-mutate.test.ts`

The module defines a `GuideState` type and exports one function per mutation kind + a `sampleMutation` dispatcher (deferred to Task 1.6). This task lands 3 kinds and the type scaffolding.

- [ ] **Step 1: Module scaffolding**

```ts
import { type Genome, type Xform } from './genome';
import { type Variation, VARIATION_NAMES, V } from './variations';
import { getLibraryStops, FLAM3_PALETTE_COUNT } from './flam3-palettes';
import { paletteFromStops, type PaletteMode } from './palette';

export type MutationKind =
  | 'variationWeightNudge'
  | 'addVariation'
  | 'swapVariation'
  | 'viewportZoom'
  | 'viewportRotate'
  | 'paletteSwap'
  | 'addXform'
  | 'removeXform';

export interface MutationResult {
  genome: Genome;
  label: string;
  kind: MutationKind;
}

export interface GuideState {
  variationBias: Map<number, number>; // index → weight in [0, 1], default 0.5
  paletteFamily: 'any' | 'warm' | 'cool' | { paletteIndex: number };
  cameraLock: { zoom: boolean; rotate: boolean };
  complexity: { xformsMin: number; xformsMax: number; lockSymmetry: boolean };
}

export const DEFAULT_GUIDE: GuideState = {
  variationBias: new Map(),
  paletteFamily: 'any',
  cameraLock: { zoom: false, rotate: false },
  complexity: { xformsMin: 1, xformsMax: 8, lockSymmetry: false },
};
```

- [ ] **Step 2: Implement 3 mutation kinds**

```ts
// Picks a random xform + random variation in it; nudges weight by ±20–40%.
// Label: "stronger julia 0.7" or "weaker spiral 0.3".
export function mutateVariationWeightNudge(
  source: Genome, guide: GuideState, rng: () => number,
): MutationResult { /* clone, pick, nudge, label */ }

// Picks a random xform; adds a new variation (bias-weighted sample from all 99)
// at low starting weight ~0.2. Label: "+ heart 0.2".
export function mutateAddVariation(
  source: Genome, guide: GuideState, rng: () => number,
): MutationResult { /* clone, pick xform, sample new variation, append */ }

// Picks a random xform with ≥2 variations; replaces one with a bias-weighted sample.
// Label: "swap julia → bubble".
export function mutateSwapVariation(
  source: Genome, guide: GuideState, rng: () => number,
): MutationResult { /* clone, pick xform with multi-variations, swap */ }
```

Implementations: deep-clone via `structuredClone(source)`, mutate the clone, return.

The variation-name lookup for labels uses `VARIATION_NAMES[index]`.

- [ ] **Step 3: Tests — determinism, structural validity, label format**

```ts
import { describe, expect, it } from 'vitest';
import {
  mutateVariationWeightNudge, mutateAddVariation, mutateSwapVariation,
  DEFAULT_GUIDE,
} from './evolve-mutate';
import { evolveSeed } from './evolve-seed';
import { mulberry32 } from './rng';

describe('mutateVariationWeightNudge', () => {
  it('is deterministic given seed', () => {
    const src = evolveSeed(mulberry32(1));
    const a = mutateVariationWeightNudge(src, DEFAULT_GUIDE, mulberry32(99));
    const b = mutateVariationWeightNudge(src, DEFAULT_GUIDE, mulberry32(99));
    expect(a).toEqual(b);
  });
  it('does not mutate the source', () => {
    const src = evolveSeed(mulberry32(1));
    const before = JSON.stringify(src);
    mutateVariationWeightNudge(src, DEFAULT_GUIDE, mulberry32(7));
    expect(JSON.stringify(src)).toBe(before);
  });
  it('label starts with stronger or weaker', () => {
    const r = mutateVariationWeightNudge(
      evolveSeed(mulberry32(1)), DEFAULT_GUIDE, mulberry32(7),
    );
    expect(r.label).toMatch(/^(stronger|weaker)\s/);
  });
  it('xform count unchanged', () => {
    const src = evolveSeed(mulberry32(1));
    const r = mutateVariationWeightNudge(src, DEFAULT_GUIDE, mulberry32(7));
    expect(r.genome.xforms.length).toBe(src.xforms.length);
  });
});

// Same shape of tests for mutateAddVariation: label starts with "+", target xform's
// variation count increased by 1.
// Same shape for mutateSwapVariation: label matches /^swap \w+ → \w+$/,
// xform count unchanged, variation count unchanged.
```

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-mutate.test.ts && \
  git add src/evolve-mutate.ts src/evolve-mutate.test.ts && \
  git commit -m "#73 — add evolve-mutate scaffolding + 3 variation mutation kinds"
```

---

### Task 1.4 — 3 viewport/palette mutation kinds (zoom, rotate, paletteSwap)

**Files:**
- Modify: `src/evolve-mutate.ts`
- Modify: `src/evolve-mutate.test.ts`

- [ ] **Step 1: Implement**

```ts
// scale × (1 ± rng()*0.2 + 0.1) — i.e. ±10–30%.
// Label: "zoom +20%" or "zoom −15%".
export function mutateViewportZoom(...): MutationResult

// rotate += (rng() - 0.5) * 2 * range, range ∈ [10°, 20°].
// Label: "rotate +15°" or "rotate −12°".
export function mutateViewportRotate(...): MutationResult

// Pick random palette from flam3-palettes filtered by guide.paletteFamily.
// Label: "palette: <name>".
// (Warm = palette indices that load_palette_warm() identifies — Task 1.4 step 3.)
export function mutatePaletteSwap(...): MutationResult
```

- [ ] **Step 2: Implement palette-family filtering**

For v1, classify each library palette as warm / cool / neutral by inspecting its
mean R-vs-B at LUT mid (cheap, deterministic).

```ts
// Returns the indices of palettes that match the family hint.
export function palettesForFamily(family: GuideState['paletteFamily']): number[]
```

`'any'` returns `[0..FLAM3_PALETTE_COUNT-1]`. `'warm'` / `'cool'` use the
R-vs-B classification. `{ paletteIndex }` returns `[paletteIndex]` (single
choice → idempotent palette swap; still a valid mutation kind).

- [ ] **Step 3: Tests**

Same shape: determinism, source-untouched, label regex, structural validity.

- `mutateViewportZoom`: `r.genome.viewport.scale !== src.viewport.scale`; label matches `/^zoom [+−][0-9]+%$/`.
- `mutateViewportRotate`: viewport.rotate changed by ≤20°; label matches `/^rotate [+−][0-9]+°$/`.
- `mutatePaletteSwap`: palette swapped (palette.name differs); label matches `/^palette: /`.
- `palettesForFamily('any').length === FLAM3_PALETTE_COUNT`; `'warm'.length > 0`; `'cool'.length > 0`.

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-mutate.test.ts && \
  git add src/evolve-mutate.ts src/evolve-mutate.test.ts && \
  git commit -m "#73 — viewport zoom/rotate + palette-swap mutation kinds"
```

---

### Task 1.5 — 2 xform-count mutation kinds (addXform, removeXform)

**Files:**
- Modify: `src/evolve-mutate.ts`
- Modify: `src/evolve-mutate.test.ts`

- [ ] **Step 1: Implement**

```ts
// Insert a new xform with random affine + 1 variation from SEED_BIAS_VARIATIONS.
// Label: "+ xform (N→N+1)".
export function mutateAddXform(
  source: Genome, guide: GuideState, rng: () => number,
): MutationResult

// Remove the lowest-weight xform (deterministic-tie: lowest index).
// Label: "− xform (N→N−1)".
export function mutateRemoveXform(...): MutationResult
```

`mutateAddXform` throws if `source.xforms.length >= guide.complexity.xformsMax`;
`mutateRemoveXform` throws if `source.xforms.length <= guide.complexity.xformsMin`.
The dispatcher (Task 1.6) is responsible for not picking these kinds when constraints would throw.

- [ ] **Step 2: Tests**

```ts
describe('mutateAddXform', () => {
  it('adds one xform with at least one variation', () => {
    const src = evolveSeed(mulberry32(1));
    const r = mutateAddXform(src, DEFAULT_GUIDE, mulberry32(7));
    expect(r.genome.xforms.length).toBe(src.xforms.length + 1);
    expect(r.genome.xforms[r.genome.xforms.length - 1].variations.length).toBeGreaterThanOrEqual(1);
    expect(r.label).toMatch(/^\+ xform/);
  });
  it('throws at xforms max', () => {
    const src = evolveSeed(mulberry32(1));
    const guide = { ...DEFAULT_GUIDE, complexity: { ...DEFAULT_GUIDE.complexity, xformsMax: src.xforms.length } };
    expect(() => mutateAddXform(src, guide, mulberry32(7))).toThrow();
  });
});

describe('mutateRemoveXform', () => {
  it('removes one xform', () => { /* ... */ });
  it('removes the lowest-weight xform', () => { /* construct genome with known weights */ });
  it('throws at xforms min', () => { /* ... */ });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-mutate.test.ts && \
  git add src/evolve-mutate.ts src/evolve-mutate.test.ts && \
  git commit -m "#73 — add/remove xform mutation kinds"
```

---

### Task 1.6 — `sampleMutation` dispatcher with guide constraints

**Files:**
- Modify: `src/evolve-mutate.ts`
- Modify: `src/evolve-mutate.test.ts`

- [ ] **Step 1: Implement**

```ts
// Picks an admissible kind based on guide state + source genome, dispatches.
// Retries up to 5x if the chosen mutation throws (degenerate genome guard).
// On exhaustion, returns a no-op clone with label "no change".
export function sampleMutation(
  source: Genome, guide: GuideState, rng: () => number,
): MutationResult {
  const candidates: MutationKind[] = ['variationWeightNudge', 'addVariation', 'swapVariation', 'paletteSwap'];
  if (!guide.cameraLock.zoom) candidates.push('viewportZoom');
  if (!guide.cameraLock.rotate) candidates.push('viewportRotate');
  if (source.xforms.length < guide.complexity.xformsMax) candidates.push('addXform');
  if (source.xforms.length > guide.complexity.xformsMin) candidates.push('removeXform');
  // pick uniformly from candidates; retry on throw; fall back to no-op.
  // ...
}
```

- [ ] **Step 2: Tests**

```ts
describe('sampleMutation', () => {
  it('respects camera-zoom lock', () => {
    const guide = { ...DEFAULT_GUIDE, cameraLock: { zoom: true, rotate: false } };
    for (let s = 0; s < 50; s++) {
      const r = sampleMutation(evolveSeed(mulberry32(s)), guide, mulberry32(s + 1));
      expect(r.kind).not.toBe('viewportZoom');
    }
  });
  it('never emits addXform at max', () => {
    const src = evolveSeed(mulberry32(1));
    const guide = { ...DEFAULT_GUIDE, complexity: { ...DEFAULT_GUIDE.complexity, xformsMax: src.xforms.length } };
    for (let s = 0; s < 50; s++) {
      const r = sampleMutation(src, guide, mulberry32(s));
      expect(r.kind).not.toBe('addXform');
    }
  });
  it('falls back to no-op label on exhaustion', () => {
    // Construct a guide that excludes EVERYTHING; should return label "no change".
    // ...
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-mutate.test.ts && \
  git add src/evolve-mutate.ts src/evolve-mutate.test.ts && \
  git commit -m "#73 — sampleMutation dispatcher with guide constraints"
```

---

### Task 1.7 — `src/evolve-state.ts` (state machine + lineage cache)

**Files:**
- Create: `src/evolve-state.ts`
- Test: `src/evolve-state.test.ts`

- [ ] **Step 1: Implement**

```ts
import { type Genome } from './genome';
import { type GuideState, DEFAULT_GUIDE, sampleMutation } from './evolve-mutate';
import { evolveSeed } from './evolve-seed';
import { mulberry32, randomSeed } from './rng';

export interface SurroundingCell {
  genome: Genome;
  label: string;
}
export interface LineageEntry {
  center: Genome;
  centerLabel: string;
  surrounding: SurroundingCell[];
}

export class EvolveState {
  center: Genome;
  centerLabel: string = 'seed';
  surrounding: SurroundingCell[];
  lineage: LineageEntry[] = []; // oldest first; current state NOT included
  guide: GuideState = structuredClone(DEFAULT_GUIDE);
  private rng: () => number;

  constructor(seedRngValue: number = randomSeed()) {
    this.rng = mulberry32(seedRngValue);
    this.center = evolveSeed(this.rng);
    this.surrounding = this.sampleSurrounding();
  }

  pickSurrounding(index: number): void {
    this.lineage.push({ center: this.center, centerLabel: this.centerLabel, surrounding: this.surrounding });
    const picked = this.surrounding[index];
    this.center = picked.genome;
    this.centerLabel = picked.label;
    this.surrounding = this.sampleSurrounding();
  }

  rewindToLineage(index: number): void {
    const entry = this.lineage[index];
    this.center = entry.center;
    this.centerLabel = entry.centerLabel;
    this.surrounding = entry.surrounding;
    this.lineage = this.lineage.slice(0, index);
  }

  rerollSurroundings(): void {
    this.surrounding = this.sampleSurrounding();
  }

  loadGenome(g: Genome, label = 'opened'): void {
    this.center = g;
    this.centerLabel = label;
    this.lineage = [];
    this.surrounding = this.sampleSurrounding();
  }

  private sampleSurrounding(): SurroundingCell[] {
    const cells: SurroundingCell[] = [];
    for (let i = 0; i < 8; i++) {
      const r = sampleMutation(this.center, this.guide, this.rng);
      cells.push({ genome: r.genome, label: r.label });
    }
    return cells;
  }
}
```

- [ ] **Step 2: Tests**

```ts
describe('EvolveState', () => {
  it('initializes with a procedural seed center + 8 surrounding', () => {
    const s = new EvolveState(42);
    expect(s.center).toBeDefined();
    expect(s.surrounding).toHaveLength(8);
    expect(s.lineage).toHaveLength(0);
    expect(s.centerLabel).toBe('seed');
  });
  it('pickSurrounding advances center + lineage', () => {
    const s = new EvolveState(42);
    const prevCenter = s.center;
    const picked = s.surrounding[3];
    s.pickSurrounding(3);
    expect(s.center).toEqual(picked.genome);
    expect(s.centerLabel).toBe(picked.label);
    expect(s.lineage).toHaveLength(1);
    expect(s.lineage[0].center).toEqual(prevCenter);
  });
  it('rewindToLineage restores prior center + surrounding', () => {
    const s = new EvolveState(42);
    const beforeCenter = s.center;
    const beforeSurr = s.surrounding;
    s.pickSurrounding(0);
    s.pickSurrounding(0);
    s.rewindToLineage(0);
    expect(s.center).toEqual(beforeCenter);
    expect(s.surrounding).toEqual(beforeSurr);
    expect(s.lineage).toHaveLength(0);
  });
  it('rerollSurroundings preserves center', () => {
    const s = new EvolveState(42);
    const center = s.center;
    const before = s.surrounding;
    s.rerollSurroundings();
    expect(s.center).toEqual(center);
    expect(s.surrounding).not.toEqual(before);
  });
  it('loadGenome resets lineage', () => {
    const s = new EvolveState(42);
    s.pickSurrounding(0);
    const fresh = evolveSeed(mulberry32(7));
    s.loadGenome(fresh);
    expect(s.center).toEqual(fresh);
    expect(s.lineage).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-state.test.ts && \
  git add src/evolve-state.ts src/evolve-state.test.ts && \
  git commit -m "#73 — EvolveState machine with lineage cache (Ctrl-Z)"
```

---

### Task 1.8 — pyr3.json round-trip test for evolve-produced genomes

**Files:**
- Modify: `src/serialize.test.ts`

- [ ] **Step 1: Add round-trip test**

```ts
import { evolveSeed } from './evolve-seed';
import { mulberry32 } from './rng';
import { sampleMutation, DEFAULT_GUIDE } from './evolve-mutate';

describe('pyr3.json round-trip for evolve-produced genomes', () => {
  it('seed genome round-trips', () => {
    const g = evolveSeed(mulberry32(1));
    const back = genomeFromJson(JSON.parse(JSON.stringify(genomeToJson(g))));
    expect(back).toEqual(g);
  });
  it('mutated genome round-trips through every mutation kind', () => {
    let g = evolveSeed(mulberry32(1));
    const rng = mulberry32(99);
    for (let i = 0; i < 20; i++) {
      const r = sampleMutation(g, DEFAULT_GUIDE, rng);
      g = r.genome;
      const back = genomeFromJson(JSON.parse(JSON.stringify(genomeToJson(g))));
      expect(back).toEqual(g);
    }
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run typecheck && npm test -- src/serialize.test.ts && \
  git add src/serialize.test.ts && \
  git commit -m "#73 — pyr3.json round-trip test for evolve-produced genomes"
```

---

## Phase 2 — Save/load wiring outside evolve (subagent-driven)

Two small file-edit tasks. Each enables a downstream consumer of evolve's `.pyr3.json` save.

### Task 2.1 — Viewer's Open picker accepts `.pyr3.json` (kind ii)

**Files:**
- Modify: `src/main.ts:787` (the `openFilePicker = (): void => { ... }` body)

- [ ] **Step 1: Find the dispatch site**

The picker currently calls `parseFlame(xml).genome` after reading the file. Add an
extension branch: if the picked file's name ends in `.pyr3.json`, parse as JSON
and call `genomeFromJson(JSON.parse(text))`; else call `parseFlame(text).genome`.

Add `.pyr3.json` and `.json` to the input's `accept=` attribute alongside `.flame`.

- [ ] **Step 2: Smoke test**

`bin/flame-to-json.ts` already produces valid pyr3.json from any corpus `.flame`.
Use that as the integration smoke: render `electricsheep.247.19679.flame`,
serialize to `out.pyr3.json`, manually drag it into the viewer in Chrome,
confirm it renders identically.

(This step is a manual Chrome verify — surface as TODO note in the commit; the
automated round-trip test in Task 1.8 already proves the genome round-trips.)

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && npm test && \
  git add src/main.ts && \
  git commit -m "#73 — viewer Open picker accepts .pyr3.json"
```

---

### Task 2.2 — BE CLI `npm run render` accepts `.pyr3.json` (kind iv)

**Files:**
- Modify: `bin/pyr3-render.ts`
- Test: `bin/pyr3-render.test.ts` (if it exists; else just smoke at runtime)

- [ ] **Step 1: Switch on file extension**

`bin/pyr3-render.ts` currently calls `parseFlame(xml)`. Add the branch:

```ts
const ext = inPath.toLowerCase().endsWith('.pyr3.json') ? 'json' : 'flame';
const genome = ext === 'json'
  ? genomeFromJson(JSON.parse(readFileSync(inPath, 'utf8')))
  : parseFlame(readFileSync(inPath, 'utf8')).genome;
```

- [ ] **Step 2: Manual smoke**

```bash
node --import tsx/esm --import ./bin/wgsl-loader-register.mjs bin/flame-to-json.ts \
  /path/to/electricsheep.247.19679.flame /tmp/sheep.pyr3.json
npm run render -- /tmp/sheep.pyr3.json /tmp/sheep.pyr3.png
# expect: PNG identical to running render on the original .flame
```

- [ ] **Step 3: Run + commit**

```bash
npm run typecheck && \
  git add bin/pyr3-render.ts && \
  git commit -m "#73 — BE CLI accepts .pyr3.json input"
```

---

## Phase 3 — UI + page (lead-Inline)

Phase 3 needs: a running dev server (`npm run dev` background), Chrome via `chrome-devtools-mcp` for the verify steps, and DOM-heavy code that's easier to iterate inline. Run these tasks in the lead session.

### Task 3.1 — `src/evolve-render.ts` (9-cell render orchestrator)

**Files:**
- Create: `src/evolve-render.ts`
- Test: `src/evolve-render.test.ts` (DOM-level smoke; GPU mocked or skipped)

- [ ] **Step 1: Define interface**

```ts
import { type Genome } from './genome';

export interface EvolveRenderHandle {
  cancel(): void;
  isBusy(): boolean;
}

// Render 9 genomes into 9 canvases sequentially.
// Calls onComplete(index) as each finishes. cancel() drops in-flight work.
export function renderGrid(
  device: GPUDevice,
  format: GPUTextureFormat,
  cells: { genome: Genome; canvas: HTMLCanvasElement }[],
  onComplete?: (index: number) => void,
): EvolveRenderHandle
```

- [ ] **Step 2: Implement using existing `createRenderer`**

Reuse `createRenderer(device, format, { quickMode: true })` per cell. Each
canvas gets its own renderer instance. The orchestrator iterates the 9 cells,
awaiting each render before starting the next (sequential — simplest correctness).

- [ ] **Step 3: Tests**

Smoke-test that calling `renderGrid` with 9 fake cells calls `onComplete` 9 times in order; `cancel()` stops further callbacks.

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-render.test.ts && \
  git add src/evolve-render.ts src/evolve-render.test.ts && \
  git commit -m "#73 — 9-cell render orchestrator"
```

---

### Task 3.2 — `src/evolve-ui.ts` (DOM: grid + guide + breadcrumb)

**Files:**
- Create: `src/evolve-ui.ts`
- Test: `src/evolve-ui.test.ts`

- [ ] **Step 1: Define mount surface**

```ts
import { type EvolveState } from './evolve-state';

export interface EvolveUiHandle {
  destroy(): void;
  // Re-renders the grid, guide panel, and breadcrumb from current state.
  refresh(): void;
}

export interface EvolveUiCallbacks {
  onPickSurrounding(index: number): void;
  onRewindToLineage(index: number): void;
  onRerollSurroundings(): void;
  onGuideChange(): void;  // state.guide already mutated by the change handler
  onSave(): void;
  onOpen(): void;
  onNewSeed(): void;
}

export function mountEvolveUi(
  root: HTMLElement,
  state: EvolveState,
  callbacks: EvolveUiCallbacks,
): EvolveUiHandle
```

- [ ] **Step 2: Implement DOM construction**

Following `src/gallery-mount.ts` + `src/gallery-filter-ui.ts` patterns:
- top bar: `🎲 new seed · 📂 open · 💾 save .pyr3.json`
- main row: 3×3 grid (center cell visually marked) + right-rail guide panel
- bottom row: hover-genome readout (left) + lineage breadcrumb (right)
- All class names prefixed `pyr3-evolve-*` for CSS scoping
- Inline styles via `style.cssText` per the existing pattern; main CSS in `src/main.ts` block

- [ ] **Step 3: Tests**

```ts
describe('mountEvolveUi', () => {
  it('mounts 9 canvases for the 3×3 grid', () => {
    const root = document.createElement('div');
    const state = new EvolveState(42);
    mountEvolveUi(root, state, makeStubCallbacks());
    expect(root.querySelectorAll('canvas.pyr3-evolve-cell')).toHaveLength(9);
  });
  it('mounts the guide panel sections', () => {
    /* assert 4 sections present */
  });
  it('mounts the breadcrumb with the current entry highlighted', () => {
    /* construct state with lineage, assert breadcrumb DOM */
  });
  it('onPickSurrounding fires with the clicked cell index', () => {
    /* simulate click on the cell, assert callback */
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-ui.test.ts && \
  git add src/evolve-ui.ts src/evolve-ui.test.ts && \
  git commit -m "#73 — evolve UI: 3×3 grid + guide panel + lineage breadcrumb"
```

---

### Task 3.3 — `src/evolve-mount.ts` (page lifecycle + top bar wiring)

**Files:**
- Create: `src/evolve-mount.ts`
- Test: `src/evolve-mount.test.ts`

- [ ] **Step 1: Define page lifecycle**

```ts
export interface EvolveMountOpts {
  device: GPUDevice;
  format: GPUTextureFormat;
  initialSeedFlame?: { gen: number; id: number };  // for ?seed=GEN/ID
}
export interface EvolveMountHandle {
  cancel(): void;       // unmount; cancel any in-flight renders
}
export function mountEvolve(
  root: HTMLElement,
  opts: EvolveMountOpts,
): EvolveMountHandle
```

- [ ] **Step 2: Implement wiring**

- Construct `EvolveState` (procedural seed unless `initialSeedFlame` given —
  in which case fetch via `chunkFetchGenome` first).
- Mount UI via `mountEvolveUi`.
- After every state-change callback, fire a render-cycle: call
  `renderGrid(device, format, [center + 8 surrounding].map(zip-to-canvas))`.
- `onSave`: `const blob = new Blob([JSON.stringify(genomeToJson(state.center))], { type: 'application/json' });` → anchor-click download with filename `evolved-${new Date().toISOString().slice(0,16).replace(/[:T-]/g,'-')}.pyr3.json`.
- `onOpen`: file picker, accept `.pyr3.json`, on file → `state.loadGenome(genomeFromJson(JSON.parse(text)))` + refresh.
- `onNewSeed`: re-construct `EvolveState` with a fresh `randomSeed()`.

- [ ] **Step 3: Tests**

DOM smoke (renderer mocked).

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- src/evolve-mount.test.ts && \
  git add src/evolve-mount.ts src/evolve-mount.test.ts && \
  git commit -m "#73 — evolve mount: lifecycle, save (i), open (iii), new-seed wiring"
```

---

### Task 3.4 — Wire `/v1/evolve` route + `evolve` pill in viewer bar

**Files:**
- Modify: `src/main.ts` (route dispatch + `currentSurface` extension)
- Modify: `src/ui-bar.ts` (new `evolve` pill in `BarOpts` / `mountBar`)

- [ ] **Step 1: Add `/v1/evolve` route in `main.ts`**

Locate the route-dispatch path (the same place that switches into `gallery`
surface on `/v1/gallery`). Add an `evolve` branch:
- on entry, hide the viewer canvas, clear the bar's viewer-specific buttons, mount evolve via `mountEvolve`
- on exit, call the returned `cancel()`

`?seed=GEN/ID` parsing: if present, pass `initialSeedFlame` to `mountEvolve`.

- [ ] **Step 2: Add the `evolve` pill in `src/ui-bar.ts`**

Add a small `evolve` link to the bar's left-zone, between `gallery` and the
flame-name slot. URL: `/v1/evolve`. Same affordance pattern as the existing
`gallery` link. Persisted across all three surfaces (viewer / gallery / evolve).

- [ ] **Step 3: Tests**

Existing bar test gets a new assertion: the `evolve` pill is mounted with
href `/v1/evolve`.

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test && \
  git add src/main.ts src/ui-bar.ts src/ui-bar.test.ts && \
  git commit -m "#73 — wire /v1/evolve route + evolve pill in viewer bar"
```

---

### Task 3.5 — Chrome verify + manual save/reopen + BE 4K render

**Files:**
- Create: `.remember/verify/evolve-handoff.html` — 3-up comparison page (seed render · evolved render · BE 4K render of the saved file)

- [ ] **Step 1: Background the dev server**

```bash
npm run dev &
# wait for "Local: http://localhost:5173/" — check actual port
```

- [ ] **Step 2: Chrome MCP walkthrough**

Drive `chrome-devtools-mcp`:
- Navigate to `http://localhost:5173/v1/evolve`
- Confirm 9 cells render within ~5s
- Click any surrounding cell; confirm new center + 8 fresh candidates
- Repeat for 5 generations
- Click the breadcrumb's second-most-recent thumb; confirm prior center restored
- Crank `variationBias` for `heart`; reroll; confirm `heart` appears in labels
- Toggle `cameraLock.zoom`; reroll; confirm no `zoom ±` labels appear
- Click `💾 save`; confirm file lands in `~/Downloads/evolved-*.pyr3.json`
- Reload `/v1/evolve`; click `📂 open`; pick the saved file; confirm same center renders
- Drag the saved file into the viewer (`/`); confirm renders correctly

- [ ] **Step 3: BE 4K render of the saved file**

```bash
npm run render -- --preset 4k ~/Downloads/evolved-2026-06-02-*.pyr3.json /tmp/evolved-4k.png
```

Confirm output ~9.6 MB PNG, opens, looks correct.

- [ ] **Step 4: Build the eyeball-verify HTML page**

`.remember/verify/evolve-handoff.html`: 3 columns (seed quickmode, evolved quickmode after 5 generations, BE 4K). Path absolutes per the project pattern. Surface the URL.

- [ ] **Step 5: Hand off to user**

Surface:
- `http://localhost:5173/v1/evolve`
- `file:///Users/matt/dev/MattAltermatt/pyr3/.remember/verify/evolve-handoff.html`

Wait for user `ok` before proceeding to Phase 4.

---

## Phase 4 — Code review + ship (lead-Inline)

### Task 4.1 — Dispatch reviewer agent

- [ ] Dispatch `feature-dev:code-reviewer` against the cumulative diff `main..feature/issue-73`. Focus areas: deterministic-given-seed test discipline; structural-validity of every mutation kind's output; lineage-cache correctness; save/load round-trip; seam-respect (`src/evolve-*.ts` contain no environment branching).

### Task 4.2 — Address findings, re-run gates

- [ ] Iterate per the review until findings resolved. Re-run:

```bash
npm run typecheck && npm test && npm run test:parity
```

`test:parity` must remain 25/25 — evolve does not touch the renderer or
importer, so any regression there is a flag.

### Task 4.3 — Docs

- [ ] **Update `CLAUDE.md`** — Quick-commands block: mention `/v1/evolve` route. Locked decisions: add evolve to the page-surface list.
- [ ] **Update `README.md`** if it advertises pages (gallery / showcase / viewer) — add evolve.
- [ ] **Update `HISTORY.md`** — append the v1.5 (or chosen version) entry capturing #73 ship.
- [ ] **Bump `package.json` version** per the release flow.

### Task 4.4 — User-verify + FF-merge

- [ ] Hand the user the `.remember/verify/evolve-handoff.html` page and the `/v1/evolve` URL one more time. Wait for explicit `ok`.
- [ ] FF-merge `feature/issue-73` into `main` (squash-commit per the workflow).
- [ ] Tag the release per `/pyr3-release` skill.
- [ ] Close issue #73 via `/pyr3-issue-close 73`.

---

## Execution mode — per-task split

Per CLAUDE.md project-type heuristic (code-only TS/Vite project), the recommended split is:

```text
Phase           tasks        mode           reasoning
-------------   ----------   ------------   -----------------------------------------------
1 (foundation)  1.1 – 1.8    Subagent       pure logic, fast vitest suite, deterministic
2 (save/load)   2.1 – 2.2    Subagent       file edits + fast tests
3 (UI + page)   3.1 – 3.4    Subagent       DOM construction; vitest happy-dom tests
3 (verify)      3.5          Inline         dev server bg + chrome-devtools-mcp drive
4 (review)      4.1 – 4.4    Inline         agent dispatch + doc edits + FF-merge
```

The handoff in Phase 3.5 is the natural Chrome-verify gate the user signs off on.

---

## Self-review

**Spec coverage:** every section of the spec mapped to a task —
- Mechanic + layout → Phase 3.2 + 3.3
- 8 mutation kinds → Phase 1.3–1.5 (one task per group)
- Guide panel + sampler constraints → Phase 1.4 (`palettesForFamily`), 1.6 (dispatcher)
- Procedural starting seed → Phase 1.2
- 9-cell render strategy → Phase 3.1
- Save bundle (i)/(ii)/(iii)/(iv) → 3.3 (i+iii), 2.1 (ii), 2.2 (iv)
- pyr3.json round-trip test → 1.8
- Viewer-bar `evolve` pill → 3.4
- Route + nav → 3.4
- #17 isolation → structural (evolve never touches parseFlame)
- Test plan → covered per-task

**Placeholder scan:** no TBDs, all type names locked (`MutationKind`, `MutationResult`, `GuideState`, `SurroundingCell`, `LineageEntry`, `EvolveState`, `EvolveUiHandle`, `EvolveMountHandle`).

**Type consistency:** `sampleMutation` returns `MutationResult` in 1.6 and is consumed by `EvolveState.sampleSurrounding` in 1.7. `Genome` shape unchanged across phases. `GuideState` defined in 1.3 step 1 and referenced everywhere downstream.
