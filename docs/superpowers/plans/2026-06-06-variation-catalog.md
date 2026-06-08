# Variation Catalog Implementation Plan (#119)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live, interactive catalog page at `/v1/variations` that pairs every variation (V0-V106) with its formula, a deterministic warp diagram, and a live chaos-game flame render with inline weight + parameter tuning.

**Architecture:** Two-pane SPA surface (sticky sidebar + scrollable catalog). Single shared `Renderer` instance attached to whichever section is in viewport. Sierpinski 3-xform scaffold with full-substitution variation weighting. Per-variation data factored to a single `variation-catalog-data.ts` content file. "Open in editor" preserves full live state via URL params consumed by the editor's existing cold-start path.

**Tech Stack:** TypeScript + WebGPU + Vite (pyr3's standard). KaTeX as new npm dep for formula rendering. IntersectionObserver for scroll-spy + iterator gating.

**Spec:** `docs/superpowers/specs/2026-06-06-variation-catalog-design.md`
**Issue:** [#119](https://github.com/MattAltermatt/pyr3/issues/119)
**Branch:** `feature/issue-119-variation-catalog`
**Mockups:** `.remember/brainstorm/variation-catalog-{left,right,full}.html`

---

## File structure

**Create:**
- `src/variation-catalog-data.ts` — content for all 107 variations: formula (LaTeX string), blurb, param defaults, warp 2D-JS impl. ~700-1000 LOC of pure data, no logic.
- `src/variation-catalog-scaffold.ts` — sierpinski 3-xform genome builder. Single export: `buildCatalogGenome(idx, weight, params): Genome`.
- `src/variation-catalog-warp.ts` — SVG warp renderer. Takes a 2D-JS warp function and emits `<path>` data; handles the [-π, π] domain + clipping.
- `src/variation-catalog-link.ts` — URL builder. Catalog → editor: `linkToEditor({idx, weight, params}): string`.
- `src/variation-catalog-sidebar.ts` — sidebar component: search + collapsible sticky sections + scroll-spy.
- `src/variation-catalog-section.ts` — per-variation section component: header + source pill + formula + panes + blurb + controls + open-in-editor link.
- `src/variation-catalog-mount.ts` — page mounter. Wires sidebar + sections + Renderer attach/detach + IntersectionObserver iteration gating + keyboard nav.
- `src/variation-catalog-{data,scaffold,warp,link,sidebar,mount}.test.ts` — unit tests.

**Modify:**
- `index.html` — add `:root` token nothing-new (the page reuses existing tokens); add `#pyr3-variations` mount point sibling-of-canvas (same pattern as `#pyr3-gallery`, `#pyr3-edit`); add `body.pyr3-variations-mode` hide-other-surfaces selectors.
- `src/main.ts` — register `/v1/variations` in `SURFACE_FALLBACK`, `currentTabSurface()`, and the cold-boot dispatch (mirror the editor branch).
- `src/load-intent.ts` — parse `?from=catalog&v=&w=&p=` on `/v1/edit` paths and surface as a new `LoadIntent` kind `catalog-entry`.
- `src/edit-mount.ts` — handle the `catalog-entry` cold-start: build a sierpinski + variation + weight + params genome via the same scaffold builder, mount the editor as usual.
- `package.json` — add `katex@^0.16.9` dep.

---

## Phase A — Foundation

### Task 1: KaTeX dep + scaffold genome builder + URL contract

**Files:**
- Modify: `package.json` (add katex dep)
- Create: `src/variation-catalog-scaffold.ts`
- Create: `src/variation-catalog-scaffold.test.ts`
- Create: `src/variation-catalog-link.ts`
- Create: `src/variation-catalog-link.test.ts`
- Modify: `src/load-intent.ts` (parse `from=catalog` query)
- Create: tests for the load-intent parser additions in `src/load-intent.test.ts`
- Modify: `src/edit-mount.ts` (consume `catalog-entry` cold-start)

- [ ] **Step 1: Install KaTeX**

```bash
npm install --save katex@^0.16.9
npm install --save-dev @types/katex
```

Verify it's in `package.json` `dependencies` and `devDependencies` respectively.

- [ ] **Step 2: Write scaffold builder tests**

`src/variation-catalog-scaffold.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCatalogGenome, SIERPINSKI_CORNERS } from './variation-catalog-scaffold';
import { V } from './variations';

describe('buildCatalogGenome', () => {
  it('builds a 3-xform sierpinski with equal weights', () => {
    const g = buildCatalogGenome(V.linear, 1, []);
    expect(g.xforms).toHaveLength(3);
    expect(g.xforms.every(x => Math.abs(x.weight - 1/3) < 1e-9)).toBe(true);
  });

  it('places each xform at a sierpinski corner', () => {
    const g = buildCatalogGenome(V.linear, 1, []);
    // pre-affine matrix encodes 0.5 contraction toward corner
    g.xforms.forEach((x, i) => {
      const [vx, vy] = SIERPINSKI_CORNERS[i];
      expect(x.coefs).toMatchObject({ a: 0.5, b: 0, c: 0.5 * vx, d: 0, e: 0.5, f: 0.5 * vy });
    });
  });

  it('substitutes variation at weight=1 (linear weight=0)', () => {
    const g = buildCatalogGenome(V.sinusoidal, 1, []);
    g.xforms.forEach(x => {
      expect(x.variations[V.linear] ?? 0).toBe(0);
      expect(x.variations[V.sinusoidal]).toBe(1);
    });
  });

  it('interpolates weight=0.4 as linear=0.6 + variation=0.4', () => {
    const g = buildCatalogGenome(V.sinusoidal, 0.4, []);
    g.xforms.forEach(x => {
      expect(x.variations[V.linear]).toBeCloseTo(0.6);
      expect(x.variations[V.sinusoidal]).toBeCloseTo(0.4);
    });
  });

  it('applies params to parameterized variation slots', () => {
    const g = buildCatalogGenome(V.julian, 1, [5, 0.7]); // power=5, dist=0.7
    expect(g.xforms[0].varParams.julian).toEqual({ power: 5, dist: 0.7 });
  });

  it('V0 linear returns plain sierpinski regardless of weight', () => {
    const g0 = buildCatalogGenome(V.linear, 0, []);
    const g1 = buildCatalogGenome(V.linear, 1, []);
    expect(g0.xforms[0].variations[V.linear]).toBe(1);
    expect(g1.xforms[0].variations[V.linear]).toBe(1);
  });
});
```

- [ ] **Step 3: Implement scaffold builder**

`src/variation-catalog-scaffold.ts`:

```typescript
import type { Genome, Xform } from './genome';
import { V } from './variations';

const SQRT3_2 = Math.sqrt(3) / 2;

/** Three triangle vertices. xform i contracts halfway toward corner i. */
export const SIERPINSKI_CORNERS: readonly [number, number][] = [
  [0, 0],
  [1, 0],
  [0.5, SQRT3_2],
];

/** Params for parameterized variations, keyed by variation name. */
type VarParamMap = Record<string, Record<string, number>>;

/** Maps a flat positional param array to the named-param shape that
 *  src/variations.ts expects for the given variation. Single source of
 *  truth; consumed by the catalog UI + URL parser. */
export function paramsToNamed(idx: number, flat: readonly number[]): VarParamMap {
  // Encoded inline so this file owns the order contract. The shape of each
  // entry matches what genome.ts packs into the xform's vars_extra slots.
  switch (idx) {
    case V.julian:       return { julian:      { power: flat[0] ?? 2, dist: flat[1] ?? 1 } };
    case V.juliascope:   return { juliascope:  { power: flat[0] ?? 2, dist: flat[1] ?? 1 } };
    case V.cpow:         return { cpow:        { r: flat[0] ?? 1, i: flat[1] ?? 0, power: flat[2] ?? 1 } };
    case V.ngon:         return { ngon:        { power: flat[0] ?? 5, sides: flat[1] ?? 5, corners: flat[2] ?? 1, circle: flat[3] ?? 1 } };
    case V.wedge:        return { wedge:       { angle: flat[0] ?? 0, hole: flat[1] ?? 0, count: flat[2] ?? 1, swirl: flat[3] ?? 0 } };
    case V.blob:         return { blob:        { low: flat[0] ?? 1, high: flat[1] ?? 1, waves: flat[2] ?? 1 } };
    case V.rings2:       return { rings2:      { val: flat[0] ?? 1 } };
    case V.fan2:         return { fan2:        { x: flat[0] ?? 1, y: flat[1] ?? 0 } };
    case V.perspective:  return { perspective: { angle: flat[0] ?? 0, dist: flat[1] ?? 1 } };
    case V.bipolar:      return { bipolar:     { shift: flat[0] ?? 0 } };
    case V.curl:         return { curl:        { c1: flat[0] ?? 1, c2: flat[1] ?? 0 } };
    case V.rectangles:   return { rectangles:  { x: flat[0] ?? 1, y: flat[1] ?? 1 } };
    case V.curve:        return { curve:       { xamp: flat[0] ?? 1, yamp: flat[1] ?? 1, xlen: flat[2] ?? 1, ylen: flat[3] ?? 1 } };
    case V.radial_blur:  return { radial_blur: { angle: flat[0] ?? 0 } };
    case V.pdj:          return { pdj:         { a: flat[0] ?? 1, b: flat[1] ?? 1, c: flat[2] ?? 1, d: flat[3] ?? 1 } };
    case V.disc2:        return { disc2:       { rot: flat[0] ?? 1, twist: flat[1] ?? 1 } };
    case V.super_shape:  return { super_shape: { rnd: flat[0] ?? 0, m: flat[1] ?? 4, n1: flat[2] ?? 1, n2: flat[3] ?? 1, n3: flat[4] ?? 1, holes: flat[5] ?? 0 } };
    case V.flower:       return { flower:      { petals: flat[0] ?? 5, holes: flat[1] ?? 0 } };
    case V.conic:        return { conic:       { eccentricity: flat[0] ?? 1, holes: flat[1] ?? 0 } };
    case V.parabola:     return { parabola:    { height: flat[0] ?? 1, width: flat[1] ?? 1 } };
    case V.pie:          return { pie:         { slices: flat[0] ?? 6, rotation: flat[1] ?? 0, thickness: flat[2] ?? 0.5 } };
    case V.wedge_julia:  return { wedge_julia: { angle: flat[0] ?? 0, count: flat[1] ?? 1, power: flat[2] ?? 7, dist: flat[3] ?? 0 } };
    case V.mobius:       return { mobius:      { re_a: flat[0] ?? 1, re_b: flat[1] ?? 0, re_c: flat[2] ?? 0, re_d: flat[3] ?? 1, im_a: flat[4] ?? 0, im_b: flat[5] ?? 0, im_c: flat[6] ?? 0, im_d: flat[7] ?? 0 } };
    case V.cpow2:        return { cpow2:       { r: flat[0] ?? 1, a: flat[1] ?? 0, divisor: flat[2] ?? 1, spread: flat[3] ?? 1 } };
    case V.cpow3:        return { cpow3:       { r: flat[0] ?? 1, divisor: flat[1] ?? 1, spread: flat[2] ?? 1, discrete_spread: flat[3] ?? 1, spread2: flat[4] ?? 0, offset2: flat[5] ?? 0 } };
    case V.loonie2:      return { loonie2:     { sides: flat[0] ?? 4, star: flat[1] ?? 0.15, circle: flat[2] ?? 0.25 } };
    case V.epispiral:    return { epispiral:   { n: flat[0] ?? 6, thickness: flat[1] ?? 0, holes: flat[2] ?? 1 } };
    default:             return {};
  }
}

export function buildCatalogGenome(
  idx: number,
  weight: number,  // 0..1; full substitution at 1
  params: readonly number[],
): Genome {
  const w = Math.max(0, Math.min(1, weight));
  const namedParams = paramsToNamed(idx, params);
  const xforms: Xform[] = SIERPINSKI_CORNERS.map(([vx, vy]): Xform => ({
    weight: 1 / 3,
    color: vx,            // give each xform a distinct palette index
    coefs: { a: 0.5, b: 0, c: 0.5 * vx, d: 0, e: 0.5, f: 0.5 * vy },
    variations: idx === V.linear
      ? { [V.linear]: 1 }
      : { [V.linear]: 1 - w, [idx]: w },
    varParams: namedParams,
    active: true,
  }));
  return {
    name: `catalog · V${idx}`,
    palette: makeCatalogPalette(),
    xforms,
    finalXform: null,
    bgColor: [0, 0, 0],
    brightness: 4,
    gamma: 2.2,
    gammaThreshold: 0.01,
    vibrancy: 1,
    rotate: 0,
    scale: 96,            // arrange the [0,1]² sierpinski in viewport
    center: [0.5, SQRT3_2 / 2],
    size: [400, 400],
    quality: 1,
    filterRadius: 0.5,
    symmetry: 1,
  };
}

function makeCatalogPalette(): number[][] {
  // Soft 256-entry rainbow — same palette across every catalog tile for
  // consistency; variation character is the differentiator, not palette.
  const out: number[][] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const r = 0.5 + 0.4 * Math.cos(2 * Math.PI * (t + 0.0));
    const g = 0.5 + 0.4 * Math.cos(2 * Math.PI * (t + 0.33));
    const b = 0.5 + 0.4 * Math.cos(2 * Math.PI * (t + 0.66));
    out.push([r, g, b]);
  }
  return out;
}
```

Inspect `src/genome.ts` first to confirm the exact `Genome` / `Xform` shape and adjust the literal above to match (field names, optional fields, palette format). The test should fail on shape mismatches and guide the fix.

- [ ] **Step 4: Run scaffold tests**

```bash
npx vitest run src/variation-catalog-scaffold.test.ts
```

Expected: all PASS. If shape mismatches, iterate the literal until the test passes against the real `Genome` type.

- [ ] **Step 5: Write + implement URL link builder**

`src/variation-catalog-link.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { linkToEditor, parseCatalogEntry } from './variation-catalog-link';
import { V } from './variations';

describe('linkToEditor', () => {
  it('bare variation produces idx-only URL', () => {
    expect(linkToEditor({ idx: V.linear, weight: 1, params: [] }))
      .toBe('/v1/edit?from=catalog&v=0&w=1');
  });
  it('encodes weight + params', () => {
    expect(linkToEditor({ idx: V.julian, weight: 0.8, params: [5, 0.7] }))
      .toBe('/v1/edit?from=catalog&v=14&w=0.8&p=5,0.7');
  });
  it('round-trips through parser', () => {
    const original = { idx: V.cpow, weight: 0.5, params: [1.5, 0.2, 2] };
    const parsed = parseCatalogEntry(new URL('http://x' + linkToEditor(original)).searchParams);
    expect(parsed).toEqual(original);
  });
  it('parser returns null when not a catalog URL', () => {
    expect(parseCatalogEntry(new URLSearchParams())).toBeNull();
    expect(parseCatalogEntry(new URLSearchParams('from=elsewhere'))).toBeNull();
  });
});
```

`src/variation-catalog-link.ts`:

```typescript
export interface CatalogEntry {
  idx: number;
  weight: number;
  params: number[];
}

export function linkToEditor(e: CatalogEntry): string {
  const parts = [`from=catalog`, `v=${e.idx}`, `w=${e.weight}`];
  if (e.params.length > 0) parts.push(`p=${e.params.join(',')}`);
  return `/v1/edit?${parts.join('&')}`;
}

export function parseCatalogEntry(q: URLSearchParams): CatalogEntry | null {
  if (q.get('from') !== 'catalog') return null;
  const v = Number(q.get('v'));
  const w = Number(q.get('w') ?? '1');
  const pStr = q.get('p');
  const params = pStr ? pStr.split(',').map(Number) : [];
  if (!Number.isFinite(v) || !Number.isFinite(w)) return null;
  return { idx: v, weight: w, params };
}
```

- [ ] **Step 6: Wire load-intent + editor cold-start**

In `src/load-intent.ts`: extend the `LoadIntent` union with `{ kind: 'catalog-entry'; entry: CatalogEntry }`. Update `parseLoadIntent` to check `parseCatalogEntry(url.searchParams)` when the path is `/v1/edit`. Add tests in `src/load-intent.test.ts`:

```typescript
it('parses /v1/edit?from=catalog as catalog-entry intent', () => {
  expect(p('/v1/edit?from=catalog&v=14&w=0.8&p=5,0.7'))
    .toEqual({ kind: 'catalog-entry', entry: { idx: 14, weight: 0.8, params: [5, 0.7] } });
});
it('plain /v1/edit still resolves to edit', () => {
  expect(p('/v1/edit')).toEqual({ kind: 'edit' });
});
```

In `src/edit-mount.ts`: where `resolveColdStartGenomeWithSource` (or its caller) handles entry intents, add a branch for `kind === 'catalog-entry'` that calls `buildCatalogGenome(entry.idx, entry.weight, entry.params)` and mounts the editor with that genome (source = `catalog`).

- [ ] **Step 7: Run full test suite + commit**

```bash
npm run typecheck && npm test -- variation-catalog-scaffold variation-catalog-link load-intent
git add package.json package-lock.json src/variation-catalog-scaffold.{ts,test.ts} src/variation-catalog-link.{ts,test.ts} src/load-intent.{ts,test.ts} src/edit-mount.ts
git commit -m "feat(#119): catalog scaffold + url contract + editor cold-start"
```

Expected: all tests pass; typecheck clean.

---

### Task 2: Catalog data type + seed entries + warp builder

**Files:**
- Create: `src/variation-catalog-data.ts` (seed: V0/V1/V2/V3/V14 only; rest stub in Task 9)
- Create: `src/variation-catalog-data.test.ts`
- Create: `src/variation-catalog-warp.ts`
- Create: `src/variation-catalog-warp.test.ts`

- [ ] **Step 1: Define data types + write data tests**

`src/variation-catalog-data.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CATALOG_DATA, getCatalogDoc } from './variation-catalog-data';
import { V } from './variations';

describe('CATALOG_DATA seed entries', () => {
  it.each([V.linear, V.sinusoidal, V.spherical, V.swirl, V.julian])(
    'has a complete entry for V%i', idx => {
      const doc = getCatalogDoc(idx);
      expect(doc).toBeDefined();
      expect(doc!.name).toBeTruthy();
      expect(doc!.source).toMatch(/^(flam3|dc|jwf)$/);
      expect(doc!.formula).toBeTruthy();
      expect(doc!.blurb).toBeTruthy();
    },
  );

  it('julian declares its params with defaults', () => {
    const julian = getCatalogDoc(V.julian)!;
    expect(julian.params).toHaveLength(2);
    expect(julian.params![0]).toMatchObject({ name: 'power', default: 2 });
  });

  it('classifies dc_* entries as source=dc', () => {
    // Stub entries are fine; just verify the source classification helper.
    const dc = CATALOG_DATA.filter(d => d.source === 'dc');
    expect(dc.every(d => d.idx >= V.dc_linear && d.idx <= V.dc_cylinder)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement data structure (seed entries only)**

`src/variation-catalog-data.ts`:

```typescript
import { V } from './variations';

export type CatalogSource = 'flam3' | 'dc' | 'jwf';

export interface ParamDoc {
  name: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface VariationDoc {
  idx: number;
  name: string;
  source: CatalogSource;
  formula: string;       // LaTeX, KaTeX-ready
  blurb: string;         // 1-2 sentence description
  params?: ParamDoc[];   // only for parameterized variations
  warpFn?: (x: number, y: number) => [number, number];  // null for RNG-driven
}

function src(idx: number): CatalogSource {
  if (idx <= V.mobius) return 'flam3';
  if (idx <= V.dc_cylinder) return 'dc';
  return 'jwf';
}

export const CATALOG_DATA: readonly VariationDoc[] = [
  {
    idx: V.linear,
    name: 'linear',
    source: src(V.linear),
    formula: 'V_0(x, y) = (x, y)',
    blurb: 'Identity transform. Passes coordinates through unchanged — the reference baseline. The sierpinski scaffold runs unaltered.',
    warpFn: (x, y) => [x, y],
  },
  {
    idx: V.sinusoidal,
    name: 'sinusoidal',
    source: src(V.sinusoidal),
    formula: 'V_1(x, y) = (\\sin x, \\sin y)',
    blurb: 'Componentwise sine. Bounds outputs to [-1,1]² regardless of input magnitude — produces folded, woven structure.',
    warpFn: (x, y) => [Math.sin(x), Math.sin(y)],
  },
  {
    idx: V.spherical,
    name: 'spherical',
    source: src(V.spherical),
    formula: 'V_2(x, y) = \\frac{1}{r^2}(x, y),\\quad r^2 = x^2 + y^2',
    blurb: 'Inversion through the unit circle. Points inside the unit disk map outward and vice versa.',
    warpFn: (x, y) => {
      const r2 = Math.max(x * x + y * y, 1e-4);
      return [x / r2, y / r2];
    },
  },
  {
    idx: V.swirl,
    name: 'swirl',
    source: src(V.swirl),
    formula: 'V_3(x, y) = (x \\sin r^2 - y \\cos r^2,\\; x \\cos r^2 + y \\sin r^2)',
    blurb: 'Radius-dependent rotation. Outer rings rotate faster than inner ones.',
    warpFn: (x, y) => {
      const r2 = x * x + y * y;
      const s = Math.sin(r2), c = Math.cos(r2);
      return [x * s - y * c, x * c + y * s];
    },
  },
  {
    idx: V.julian,
    name: 'julian',
    source: src(V.julian),
    formula: 'V_{14}(x, y) = r^{c/n}\\,(\\cos t,\\, \\sin t),\\quad t = \\tfrac{\\phi + 2\\pi \\, \\mathrm{rand}(n)}{n}',
    blurb: 'Generalized Julia — splits each input into n rotationally symmetric branches, picked at random per iteration.',
    params: [
      { name: 'power', default: 2, min: -10, max: 10, step: 1 },
      { name: 'dist',  default: 1, min: -2,  max: 2,  step: 0.05 },
    ],
    warpFn: (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      const phi = Math.atan2(y, x);
      const n = 2, c = 1, t = phi / n, rad = Math.pow(r, c / n);
      return [rad * Math.cos(t), rad * Math.sin(t)];
    },
  },
];

const byIdx = new Map(CATALOG_DATA.map(d => [d.idx, d]));
export function getCatalogDoc(idx: number): VariationDoc | undefined {
  return byIdx.get(idx);
}
```

- [ ] **Step 3: Write + implement warp SVG builder**

`src/variation-catalog-warp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildWarpSvg } from './variation-catalog-warp';

describe('buildWarpSvg', () => {
  it('returns SVG path data for identity', () => {
    const svg = buildWarpSvg((x, y) => [x, y]);
    expect(svg).toContain('<path');
    expect(svg).toContain('viewBox');
  });
  it('clips paths that explode (e.g. spherical at origin)', () => {
    const svg = buildWarpSvg((x, y) => {
      const r2 = Math.max(x * x + y * y, 1e-9);
      return [x / r2, y / r2];
    });
    // No raw "Infinity" or "NaN" in path data
    expect(svg).not.toMatch(/Infinity|NaN/);
  });
});
```

`src/variation-catalog-warp.ts`:

```typescript
const GRID_N = 14;
const SAMPLES = 60;
const RANGE = Math.PI;
const CLIP = 50;

export function buildWarpSvg(fn: (x: number, y: number) => [number, number]): string {
  const lines: string[] = [];
  lines.push(`<line class="warp-axis" x1="${-RANGE}" y1="0" x2="${RANGE}" y2="0"/>`);
  lines.push(`<line class="warp-axis" x1="0" y1="${-RANGE}" x2="0" y2="${RANGE}"/>`);

  for (let dir = 0; dir < 2; dir++) {
    for (let i = 0; i <= GRID_N; i++) {
      const fixed = -RANGE + (2 * RANGE * i) / GRID_N;
      let d = '';
      for (let j = 0; j <= SAMPLES; j++) {
        const moving = -RANGE + (2 * RANGE * j) / SAMPLES;
        const [x0, y0] = dir === 0 ? [moving, fixed] : [fixed, moving];
        const [wx, wy] = fn(x0, y0);
        if (!Number.isFinite(wx) || !Number.isFinite(wy) || Math.abs(wx) > CLIP || Math.abs(wy) > CLIP) {
          d += ' M 0 0 ';  // pen-up, skip this segment
          continue;
        }
        d += (j === 0 ? 'M' : 'L') + ' ' + wx.toFixed(4) + ' ' + wy.toFixed(4) + ' ';
      }
      lines.push(`<path class="warp-line" d="${d}"/>`);
    }
  }

  return `<svg viewBox="-2 -2 4 4" preserveAspectRatio="xMidYMid meet">
            <g transform="scale(1,-1)">${lines.join('')}</g>
          </svg>`;
}
```

- [ ] **Step 4: Run + commit**

```bash
npm run typecheck && npm test -- variation-catalog-data variation-catalog-warp
git add src/variation-catalog-data.{ts,test.ts} src/variation-catalog-warp.{ts,test.ts}
git commit -m "feat(#119): catalog data shape + seed entries + warp svg builder"
```

---

## Phase B — Page chrome

### Task 3: Route + mount point + sidebar component

**Files:**
- Modify: `index.html` (add `#pyr3-variations` mount + hide-other-surfaces selectors)
- Modify: `src/main.ts` (register `/v1/variations` route + cold-boot dispatch)
- Create: `src/variation-catalog-sidebar.ts`
- Create: `src/variation-catalog-sidebar.test.ts`

- [ ] **Step 1: Add the mount point in `index.html`**

Mirror the `#pyr3-edit` block: an `absolute; inset: 0` div, hidden by default, with `body.pyr3-variations-mode #pyr3-canvas, …{display:none}` rules to swap surfaces. Inline styles for `.pyr3-variations-root` (the two-pane flex layout, sticky sidebar, scrolling catalog) — copy from `.remember/brainstorm/variation-catalog-full.html` and reuse pyr3's `:root` tokens.

- [ ] **Step 2: Register the route in `src/main.ts`**

Add `variations: '/v1/variations'` to `SURFACE_FALLBACK` and the discriminator `if (p === '/v1/variations' || p.startsWith('/v1/variations/')) return 'variations'`. In the cold-boot dispatch (where `/v1/edit`, `/v1/screensaver` etc. branch), add a branch that calls `mountVariationCatalog(rootEl)` (to be written in Task 4). For now, mount a stub that just sets `body.pyr3-variations-mode` and writes `"variations catalog — coming"` into the root.

- [ ] **Step 3: Write sidebar tests**

`src/variation-catalog-sidebar.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSidebar, type SidebarHandle } from './variation-catalog-sidebar';

describe('catalog sidebar', () => {
  let host: HTMLElement;
  let handle: SidebarHandle;

  beforeEach(() => {
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById('host')!;
    handle = mountSidebar(host, {
      onJump: () => {},
    });
  });

  it('renders all 107 variations across three sections', () => {
    expect(host.querySelectorAll('.item').length).toBe(107);
    expect(host.querySelectorAll('.group-head').length).toBe(3);
  });

  it('search filters by name and V-number', () => {
    handle.setSearch('jul');
    // julia, julian, juliascope, wedge_julia = 4 matches
    expect(host.querySelectorAll('.item').length).toBe(4);
    handle.setSearch('v10');
    // V100-V106 = 7 matches
    expect(host.querySelectorAll('.item').length).toBe(7);
  });

  it('clicking a group head toggles collapse', () => {
    const flam3Head = host.querySelector('.group-head[data-source="flam3"]') as HTMLElement;
    flam3Head.click();
    expect(flam3Head.classList.contains('collapsed')).toBe(true);
    // only DC + JWF items visible (8 total)
    expect(host.querySelectorAll('.item').length).toBe(8);
  });

  it('setActive updates the active row', () => {
    handle.setActive(14);
    const active = host.querySelector('.item.active');
    expect(active?.getAttribute('data-idx')).toBe('14');
  });

  it('onJump fires with the clicked variation idx', () => {
    let jumped = -1;
    handle = mountSidebar(host, { onJump: idx => { jumped = idx; } });
    const item = host.querySelector('.item[data-idx="14"]') as HTMLElement;
    item.click();
    expect(jumped).toBe(14);
  });
});
```

- [ ] **Step 4: Implement sidebar**

`src/variation-catalog-sidebar.ts` — port the logic from `.remember/brainstorm/variation-catalog-full.html` (the SOURCES array, `searchMatch`, render loop, click + collapse handlers). Public API:

```typescript
export interface SidebarOptions {
  onJump(idx: number): void;
}
export interface SidebarHandle {
  setActive(idx: number): void;
  setSearch(s: string): void;
  destroy(): void;
}
export function mountSidebar(host: HTMLElement, opts: SidebarOptions): SidebarHandle { … }
```

The full variation list is built by iterating `Object.entries(V)` from `src/variations.ts` (not duplicating it), filtering by index and classifying by source via the same helper as the data file.

- [ ] **Step 5: Run + commit**

```bash
npm run typecheck && npm test -- variation-catalog-sidebar
git add index.html src/main.ts src/variation-catalog-sidebar.{ts,test.ts}
git commit -m "feat(#119): route + mount point + sidebar component"
```

---

### Task 4: Per-section component + page mount

**Files:**
- Create: `src/variation-catalog-section.ts`
- Create: `src/variation-catalog-section.test.ts`
- Create: `src/variation-catalog-mount.ts`
- Create: `src/variation-catalog-mount.test.ts`

- [ ] **Step 1: Write section component tests**

`src/variation-catalog-section.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mountSection } from './variation-catalog-section';
import { getCatalogDoc } from './variation-catalog-data';
import { V } from './variations';

describe('catalog section', () => {
  it('renders header + source pill + formula + panes + blurb + link', () => {
    const host = document.createElement('div');
    const handle = mountSection(host, getCatalogDoc(V.sinusoidal)!, {
      onParamsChange: () => {},
    });
    expect(host.querySelector('.name')?.textContent).toContain('sinusoidal');
    expect(host.querySelector('.source')?.textContent).toContain('flam3');
    expect(host.querySelectorAll('.pane').length).toBe(2);
    expect(host.querySelector('.blurb')).toBeTruthy();
    expect(host.querySelector('.open-link')?.getAttribute('href')).toMatch(/from=catalog&v=1/);
  });

  it('renders weight slider for non-linear variations', () => {
    const host = document.createElement('div');
    mountSection(host, getCatalogDoc(V.sinusoidal)!, { onParamsChange: () => {} });
    expect(host.querySelector('input[data-control="weight"]')).toBeTruthy();
  });

  it('V0 linear renders the controls-empty note instead of sliders', () => {
    const host = document.createElement('div');
    mountSection(host, getCatalogDoc(V.linear)!, { onParamsChange: () => {} });
    expect(host.querySelector('input[data-control="weight"]')).toBeNull();
    expect(host.querySelector('.controls-empty')).toBeTruthy();
  });

  it('renders one scrubby per param for parameterized variations', () => {
    const host = document.createElement('div');
    mountSection(host, getCatalogDoc(V.julian)!, { onParamsChange: () => {} });
    expect(host.querySelectorAll('input[data-control="param"]').length).toBe(2);
  });

  it('emits onParamsChange when weight slider moves', () => {
    const host = document.createElement('div');
    let last: { weight: number; params: number[] } | null = null;
    mountSection(host, getCatalogDoc(V.sinusoidal)!, {
      onParamsChange: s => { last = s; },
    });
    const w = host.querySelector('input[data-control="weight"]') as HTMLInputElement;
    w.value = '0.4';
    w.dispatchEvent(new Event('input'));
    expect(last?.weight).toBeCloseTo(0.4);
  });
});
```

- [ ] **Step 2: Implement section component**

`src/variation-catalog-section.ts`:

```typescript
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { VariationDoc } from './variation-catalog-data';
import { buildWarpSvg } from './variation-catalog-warp';
import { linkToEditor } from './variation-catalog-link';

export interface SectionOptions {
  onParamsChange(state: { weight: number; params: number[] }): void;
}
export interface SectionHandle {
  setIterating(on: boolean): void;
  getFlameCanvas(): HTMLCanvasElement;
  getState(): { weight: number; params: number[] };
  destroy(): void;
}

const SOURCE_LABEL: Record<string, string> = {
  flam3: 'flam3 core',
  dc:    'DC family',
  jwf:   'JWildfire ports',
};

export function mountSection(
  host: HTMLElement,
  doc: VariationDoc,
  opts: SectionOptions,
): SectionHandle {
  const state = {
    weight: 1,
    params: (doc.params ?? []).map(p => p.default),
  };

  host.innerHTML = `
    <section class="section" id="v${doc.idx}-${doc.name}" data-idx="${doc.idx}">
      <div class="head">
        <div class="name">${doc.name}<span class="vnum">· V${doc.idx}</span></div>
        <span class="source">${SOURCE_LABEL[doc.source]}</span>
      </div>
      <div class="formula"></div>
      <div class="panes">
        <div class="col">
          <div class="pane warp-pane">${doc.warpFn ? '' : '<div class="warp-na">warp diagram not applicable (RNG-driven)</div>'}<span class="pane-label">grid warp · static</span></div>
        </div>
        <div class="col">
          <div class="pane flame-pane"><canvas class="flame-canvas"></canvas><span class="pane-label">flame · live</span><span class="live-dot hidden">iterating</span></div>
          <div class="controls-host"></div>
        </div>
      </div>
      <p class="blurb">${escapeHtml(doc.blurb)}</p>
      <a class="open-link" href="${linkToEditor({ idx: doc.idx, weight: 1, params: state.params })}">▸ Open in editor with this variation</a>
    </section>
  `;

  // Render formula with KaTeX
  const formulaEl = host.querySelector('.formula')!;
  katex.render(doc.formula, formulaEl as HTMLElement, { throwOnError: false });

  // Warp SVG
  if (doc.warpFn) {
    const warpPane = host.querySelector('.warp-pane')!;
    warpPane.insertAdjacentHTML('afterbegin', buildWarpSvg(doc.warpFn));
  }

  // Controls
  const ctrlHost = host.querySelector('.controls-host')!;
  if (doc.idx === 0 /* V.linear */) {
    ctrlHost.innerHTML = `<div class="controls-empty">no controls — linear is the reference (no warp to tune)</div>`;
  } else {
    ctrlHost.innerHTML = buildControlsHtml(doc, state);
    wireControls(ctrlHost as HTMLElement, doc, state, () => {
      // Sync link href on every change
      const link = host.querySelector('.open-link') as HTMLAnchorElement;
      link.href = linkToEditor({ idx: doc.idx, weight: state.weight, params: state.params });
      opts.onParamsChange({ weight: state.weight, params: [...state.params] });
    });
  }

  const flameCanvas = host.querySelector('canvas.flame-canvas') as HTMLCanvasElement;
  const liveDot = host.querySelector('.live-dot') as HTMLElement;

  return {
    setIterating(on) { liveDot.classList.toggle('hidden', !on); },
    getFlameCanvas() { return flameCanvas; },
    getState() { return { weight: state.weight, params: [...state.params] }; },
    destroy() { host.innerHTML = ''; },
  };
}

function buildControlsHtml(doc: VariationDoc, state: { weight: number; params: number[] }): string {
  const rows: string[] = [];
  rows.push(controlRow('weight', state.weight, 0, 1, 0.01, true));
  (doc.params ?? []).forEach((p, i) => {
    rows.push(controlRow(p.name, state.params[i], p.min, p.max, p.step, false));
  });
  return `<div class="controls">${rows.join('')}<div class="controls-footer"><button class="reset-all">reset all</button></div></div>`;
}

function controlRow(name: string, value: number, min: number, max: number, step: number, isWeight: boolean): string {
  const cls = isWeight ? 'weight' : '';
  const control = isWeight ? 'weight' : 'param';
  const display = step < 1 ? value.toFixed(2) : String(Math.round(value));
  return `
    <div class="control-row" data-name="${name}">
      <span class="label ${cls}">${name}</span>
      <input type="range" class="scrub" data-control="${control}" min="${min}" max="${max}" step="${step}" value="${value}" data-default="${value}"/>
      <span class="val">${display}</span>
      <span class="reset" title="reset">↻</span>
    </div>
  `;
}

function wireControls(host: HTMLElement, doc: VariationDoc, state: { weight: number; params: number[] }, onChange: () => void): void {
  host.querySelectorAll<HTMLInputElement>('input[type=range].scrub').forEach((input, idx) => {
    updateSlider(input);
    input.addEventListener('input', () => {
      updateSlider(input);
      const v = parseFloat(input.value);
      if (input.dataset.control === 'weight') state.weight = v;
      else {
        // idx is offset by 1 because weight is always the first row
        const paramIdx = idx - 1;
        state.params[paramIdx] = v;
      }
      onChange();
    });
  });
  host.querySelectorAll('.reset').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.control-row') as HTMLElement;
      const input = row.querySelector('input[type=range]') as HTMLInputElement;
      input.value = input.dataset.default!;
      input.dispatchEvent(new Event('input'));
    });
  });
  (host.querySelector('.reset-all') as HTMLButtonElement | null)?.addEventListener('click', () => {
    host.querySelectorAll('.reset').forEach(b => (b as HTMLElement).click());
  });
}

function updateSlider(input: HTMLInputElement) {
  const min = parseFloat(input.min), max = parseFloat(input.max), v = parseFloat(input.value);
  const pct = ((v - min) / (max - min)) * 100;
  input.style.setProperty('--p', pct + '%');
  const row = input.closest('.control-row')!;
  const valEl = row.querySelector('.val')!;
  const step = parseFloat(input.step || '1');
  valEl.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
}
```

- [ ] **Step 3: Write + implement page mount (sections + sidebar wired, no live rendering yet)**

`src/variation-catalog-mount.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mountVariationCatalog } from './variation-catalog-mount';
import { V } from './variations';

describe('mountVariationCatalog', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="host"></div>';
    host = document.getElementById('host')!;
    mountVariationCatalog(host, { device: null });  // null device = no live render
  });

  it('renders sidebar + catalog containers', () => {
    expect(host.querySelector('.pyr3-variations-sidebar')).toBeTruthy();
    expect(host.querySelector('.pyr3-variations-catalog')).toBeTruthy();
  });

  it('renders one section per variation in numeric order', () => {
    const sections = host.querySelectorAll('.section, .stub');
    expect(sections.length).toBe(107);
    const indices = Array.from(sections).map(s => parseInt((s as HTMLElement).dataset.idx!, 10));
    expect(indices).toEqual(indices.slice().sort((a, b) => a - b));
  });

  it('sidebar click scrolls catalog to anchor', () => {
    const item = host.querySelector('.item[data-idx="14"]') as HTMLElement;
    item.click();
    // verify the target section's id matches julian
    const section = document.getElementById(`v14-julian`);
    expect(section).toBeTruthy();
  });
});
```

`src/variation-catalog-mount.ts`:

```typescript
import { mountSidebar } from './variation-catalog-sidebar';
import { mountSection } from './variation-catalog-section';
import { getCatalogDoc, CATALOG_DATA } from './variation-catalog-data';
import { V } from './variations';

export interface MountOptions {
  device: GPUDevice | null;  // null = no live render (tests)
}

export interface MountHandle {
  destroy(): void;
}

export function mountVariationCatalog(host: HTMLElement, opts: MountOptions): MountHandle {
  host.innerHTML = `
    <div class="pyr3-variations-root">
      <aside class="pyr3-variations-sidebar"></aside>
      <main class="pyr3-variations-catalog"></main>
    </div>
  `;
  const sidebarHost = host.querySelector('.pyr3-variations-sidebar') as HTMLElement;
  const catalogHost = host.querySelector('.pyr3-variations-catalog') as HTMLElement;

  // Build all 107 section hosts in numeric order, filled either with a real
  // section or a stub placeholder for variations without content yet.
  const sectionHandles = new Map<number, ReturnType<typeof mountSection> | null>();
  for (const idx of Object.values(V).sort((a, b) => a - b) as number[]) {
    const wrap = document.createElement('div');
    wrap.dataset.idx = String(idx);
    catalogHost.appendChild(wrap);
    const doc = getCatalogDoc(idx);
    if (doc) {
      const h = mountSection(wrap, doc, { onParamsChange: () => {} });
      sectionHandles.set(idx, h);
    } else {
      // stub
      wrap.className = 'stub';
      wrap.id = `v${idx}-stub`;
      wrap.innerHTML = `<div class="stub-name">(V${idx} content pending)</div>`;
      sectionHandles.set(idx, null);
    }
  }

  const sidebar = mountSidebar(sidebarHost, {
    onJump: (idx) => {
      const target = catalogHost.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null;
      if (target) catalogHost.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
    },
  });

  return {
    destroy() {
      sidebar.destroy();
      sectionHandles.forEach(h => h?.destroy());
      host.innerHTML = '';
    },
  };
}
```

- [ ] **Step 4: Wire mount into main.ts** — replace the stub from Task 3 with a real call to `mountVariationCatalog(rootEl, { device })` where `device` is the GPU device pyr3 has already acquired for the viewer surface.

- [ ] **Step 5: Run + commit**

```bash
npm run typecheck && npm test -- variation-catalog
git add src/variation-catalog-{section,mount}.{ts,test.ts} src/main.ts
git commit -m "feat(#119): per-section component + page mount"
```

---

## Phase C — Live rendering

### Task 5: Live flame iteration via IntersectionObserver

**Files:**
- Modify: `src/variation-catalog-mount.ts` (add IntersectionObserver + Renderer attach/detach)
- Modify: `src/variation-catalog-mount.test.ts` (add iteration-gating tests with stubbed renderer)

- [ ] **Step 1: Write the iteration-gating test**

Add to `src/variation-catalog-mount.test.ts`:

```typescript
it('attaches renderer to the section closest to viewport center', () => {
  // Use a mock renderer that records attach/detach calls.
  const calls: { op: string; idx?: number }[] = [];
  const fakeRenderer = {
    attach: (canvas: HTMLCanvasElement) => calls.push({ op: 'attach', idx: parseInt((canvas.closest('[data-idx]') as HTMLElement).dataset.idx!, 10) }),
    detach: () => calls.push({ op: 'detach' }),
    iterate: () => {},
  };
  // … mount with this fake, simulate IntersectionObserver firing for section 14 …
  // expect calls === [{op:'attach', idx:14}]
});
```

Implementation note: IntersectionObserver is hard to drive in jsdom; either install `intersection-observer-polyfill` for tests or write the visibility logic as a pure function tested separately (`pickActiveSection(scrollTop, sectionGeometry)`) and have the observer just call it.

- [ ] **Step 2: Implement iteration gating**

Extend `mountVariationCatalog`:
- Single `Renderer` instance (or borrow pyr3's editor live-lane wrapper) acquired with the passed `device`.
- IntersectionObserver watching all section wrappers, root = the scrollable catalog container.
- When a section becomes the most-visible (closest to 35% viewport from top): renderer attaches to that section's canvas, calls `setIterating(true)`, kicks an iteration loop.
- When a section leaves viewport: `setIterating(false)`, renderer detaches.
- Iteration loop: rebuild the genome from current section state (`buildCatalogGenome(idx, weight, params)`) and submit to the renderer's live lane. Re-iterate on every slider change (debounced 80ms, matching editor live lane).

Reuse the editor's live-render lane infra by importing the relevant primitive from `src/edit-mount.ts` (likely `requestLiveRender` or its underlying function) if available, or refactor it out into a shared module if needed.

- [ ] **Step 3: Run + Chrome-verify the live iteration on the 5 seed sections**

Start dev server:

```bash
npm run dev
```

Hand the user: `http://localhost:5173/v1/variations`

Drive Chrome MCP to:
- Scroll to V0 — should iterate sierpinski (linear)
- Scroll to V1 — should iterate sinusoidal-warped sierpinski (visibly different)
- Drag V14 power slider — flame should re-render

- [ ] **Step 4: Commit**

```bash
git add src/variation-catalog-mount.{ts,test.ts}
git commit -m "feat(#119): live iteration gated by intersection observer"
```

---

### Task 6: Polish — keyboard nav + scroll-spy back to sidebar + visual sweep

**Files:**
- Modify: `src/variation-catalog-mount.ts` (keyboard listeners + scroll-spy → sidebar active)
- Modify: `src/variation-catalog-mount.test.ts`

- [ ] **Step 1: Tests for keyboard nav**

```typescript
it('arrow down jumps to next variation', () => {
  // mount, focus catalog, set active=V0, dispatch ArrowDown → expect active=V1
});
it('slash key focuses search box', () => {
  // mount, dispatch '/' on body → expect search input is focused
});
it('escape clears search', () => {
  // setSearch('jul'), dispatch Escape on search → expect search empty
});
```

- [ ] **Step 2: Implement keyboard nav**

Catalog container's `tabindex=-1`; listen for keydown on `window`:
- `ArrowDown` / `ArrowUp` when no input is focused: scroll to next/prev section (compute current active idx from scroll-spy)
- `/` when no input focused: prevent default + focus the sidebar search input
- `Escape` when the search input is focused: clear it + blur

- [ ] **Step 3: Implement scroll-spy → sidebar active**

In the IntersectionObserver callback (already present from Task 5): also call `sidebar.setActive(idx)` whenever the active section changes. Sidebar internally scrolls its own list to keep the active row visible (already implemented).

- [ ] **Step 4: Visual sweep in Chrome**

Drive the live page:
- Type `jul` in search → list narrows; click julian → catalog scrolls there
- Scroll catalog manually → sidebar active row tracks
- Press `↓` repeatedly → catalog steps through variations
- Collapse `flam3 ▾` → 99 items hide; sticky header stays

- [ ] **Step 5: Run tests + commit**

```bash
npm run typecheck && npm test -- variation-catalog
git add src/variation-catalog-mount.{ts,test.ts}
git commit -m "feat(#119): keyboard nav + scroll-spy → sidebar active"
```

---

## Phase D — Content fill

### Task 7: Author content for flam3 V4-V98 (95 entries)

**Files:**
- Modify: `src/variation-catalog-data.ts` (add 95 entries)
- Modify: `src/variation-catalog-data.test.ts` (assert all 107 idx present)

Content sources for each entry:
- **formula**: Draves & Reckase 2003 paper Appendix A (V0-V48) + flam3-C source comments (`flam3.c` `apply_xform` function — has the WGSL equivalent we shipped in `src/shaders/chaos.wgsl`)
- **blurb**: 1-2 sentences describing the visual character, derived from the paper or from observing the rendered flame
- **params**: extract from existing pyr3 default params; flam3 paper canonical values where they exist
- **warpFn**: deterministic 2D-JS impl of the variation; skip (leave `warpFn` undefined) for RNG-driven variations: `noise` (V43), `blur` (V44), `gaussian_blur` (V45), `radial_blur` (V47) (uses RNG), `square` (V49), `rays` (V50), `blade` (V51), `twintrian` (V52), `pre_blur` (V97), and any others whose WGSL kernel takes a `vec2<f32>` from `rand_*` calls

- [ ] **Step 1: Update data test to require all 99 flam3 entries**

```typescript
it('has an entry for every flam3 variation V0-V98', () => {
  for (let i = 0; i <= V.mobius; i++) {
    const doc = getCatalogDoc(i);
    expect(doc, `V${i} missing`).toBeDefined();
    expect(doc!.formula, `V${i} formula empty`).toBeTruthy();
    expect(doc!.blurb, `V${i} blurb empty`).toBeTruthy();
  }
});
```

- [ ] **Step 2: Add all 95 missing flam3 entries**

Bulk content authoring. For each variation:
- Look up the WGSL kernel in `src/shaders/chaos.wgsl` to confirm the math
- Encode the formula as LaTeX
- Write a 1-2 sentence blurb describing the warp character
- For parameterized variations, declare params with sensible min/max/step ranges (e.g., powers: −10 to 10 step 1; distances: −2 to 2 step 0.05; angles: −π to π step 0.05)
- Implement the warpFn in 2D JS (NOT in WGSL; pure JS) for non-RNG variations

This is bulk content work. Suggest splitting into 3 sub-batches of ~30 entries each within this task for review checkpoints, but a single commit at the end.

- [ ] **Step 3: Run tests + commit**

```bash
npm test -- variation-catalog-data
git add src/variation-catalog-data.{ts,test.ts}
git commit -m "feat(#119): content for flam3 V4-V98 (95 entries)"
```

---

### Task 8: Author content for DC family + JWildfire ports (V99-V106, 8 entries)

**Files:**
- Modify: `src/variation-catalog-data.ts`

These are pyr3-specific (DC) and post-flam3 (JWF). Sources:
- **DC family (V99-V102)**: Neil Slater's Apophysis 7X plugin pack docs + the WGSL kernels we shipped in #117
- **JWildfire ports (V103-V106)**: JWildfire source (`JWildfire/src/org/jwildfire/create/tina/variation/*Func.java`) + our shipped kernels from #114 batch 1
- Source pill should render `DC family` / `JWildfire ports` correctly (already wired)
- Include a "behavior note" in the blurb for the DC family explaining the direct-color override semantics
- Update `src/variation-catalog-data.test.ts` to require all 107 entries present

- [ ] **Step 1: Add 8 entries + tighten test to all 107**

- [ ] **Step 2: Commit**

```bash
npm test -- variation-catalog-data
git add src/variation-catalog-data.{ts,test.ts}
git commit -m "feat(#119): content for DC family + JWildfire ports (V99-V106)"
```

---

## Phase E — Review + ship

### Task 9: Code review subagent + fix findings

- [ ] **Step 1: Dispatch a fresh code-reviewer subagent**

Use `feature-dev:code-reviewer` agent on the full feature diff (everything from Task 1 through Task 8). Brief the reviewer on:
- This is a new page surface — check the engine seam isn't broken (engine modules stay environment-free; CLI host stays unmodified)
- Check the URL contract round-trip is robust (negative inputs, missing params, malformed `p=` list)
- Check the IntersectionObserver doesn't leak handlers on `destroy()`
- Check the Renderer attach/detach lifecycle doesn't leak GPU pipelines
- Check accessibility: keyboard nav, focus management, color contrast

- [ ] **Step 2: Triage findings**

Fix high-confidence findings inline. File new issues for anything out-of-scope or speculative. Note resolutions in the issue thread.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A   # only the files touched by review fixes
git commit -m "fix(#119): address review findings"
```

---

### Task 10: Chrome verify + docs + handoff

- [ ] **Step 1: Full Chrome verify with all 107 variations**

Start dev server, hand the URL `http://localhost:5173/v1/variations`. Drive:
- Sidebar shows three sections, all 107 in numeric order
- Search filters live (try `cpow`, `v10`, `dc_`, gibberish)
- All three sections collapse/expand correctly, sticky headers pin
- Scroll through all 107 sections; spot-check 10 random ones — each renders formula, warp (or "not applicable"), live flame, blurb, controls
- Click "Open in editor" on V14 julian after tweaking sliders → editor opens with same view
- Keyboard nav: `↓` steps through, `/` focuses search, `Escape` clears
- No console errors

- [ ] **Step 2: Update docs**

- Add a brief line to `README.md`'s features list mentioning the catalog at `/v1/variations`
- Add a one-line entry to the section about routes in `CLAUDE.md`
- Save a memory note (`reference-pyr3-variation-catalog.md`) capturing the route + scaffold pattern for future "how does the catalog work?" questions

- [ ] **Step 3: User-verify gate**

Per global workflow: hand the live URL to the user. Surface:
- What changed (new page + route + editor entry path)
- How to test it (the verify drive above)
- What to look at (sidebar layout, scroll-spy, slider responsiveness, "open in editor" round-trip)
- Specific things known broken / deferred (per the v2 list in the spec)

Wait for explicit FF-merge approval.

- [ ] **Step 4: On approval, ship**

```bash
git switch main
git pull --ff-only
git switch feature/issue-119-variation-catalog
git rebase main
# squash commits if many small ones — leave the conceptual ones
git switch main
git merge --ff-only feature/issue-119-variation-catalog
git push origin main
gh issue close 119 --comment "Shipped in <commit-sha>. Live at https://pyr3.app/v1/variations"
git branch -d feature/issue-119-variation-catalog
git push origin --delete feature/issue-119-variation-catalog
```

Watch deploy run; validate live URL.

---

## Notes for the executor

**Engine seam discipline.** Every file under `src/*.ts` (except CLI hosts and the `*.test.ts` files) must compile clean under `npm run typecheck:engine` — no `window`, `document`, `navigator` references outside the explicit DOM-wrapper modules. The catalog UI files (`*-sidebar.ts`, `*-section.ts`, `*-mount.ts`) ARE DOM-wrappers and are excluded from the engine typecheck — but `variation-catalog-data.ts`, `-scaffold.ts`, `-warp.ts`, `-link.ts` must stay environment-free (they're consumed by engine-side scaffold/parsing).

**No CPU fallback path.** GPU only, per pyr3 scope guardrail. If the user lacks WebGPU, the page should show the same fallback message as the viewer — reuse the existing fallback wiring in `index.html`.

**Test pollution.** Several tests mount into `document.body`. Use `beforeEach` to clear it; don't carry DOM state across tests.

**Vitest exclude glob.** Per pyr3's existing config, `**/.claude/**` is already excluded, so the `.remember/brainstorm/*.html` mockup files won't interfere.
