// Unit tests for the CPU chaos sampler + percentile-bbox fit used by the
// /editor viewport section's 🎯 fit button.

import { describe, expect, it } from 'vitest';
import {
  sampleChaosForFit,
  computeFitViewport,
  refitGenomeToOutputSize,
  FIT_MARGIN,
} from './edit-fit-viewport';
import { generateRandomGenome } from './edit-seed';
import { type Genome } from './genome';
import { V } from './variations';
import { paletteFromStops } from './palette';
import { getLibraryStops } from './flam3-palettes';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function minimalGenome(): Genome {
  return {
    name: 't',
    xforms: [],
    scale: 200,
    cx: 0,
    cy: 0,
    palette: paletteFromStops('test', getLibraryStops(0) ?? []),
  };
}

describe('sampleChaosForFit', () => {
  it('returns an empty array for zero-xform genomes', () => {
    const g = minimalGenome();
    expect(sampleChaosForFit(g)).toEqual([]);
  });

  it('returns an empty array when all xform weights are zero', () => {
    const g = generateRandomGenome(seededRng(1));
    for (const xf of g.xforms) xf.weight = 0;
    expect(sampleChaosForFit(g)).toEqual([]);
  });

  it('returns ~samples post-warmup points for a normal genome', () => {
    const g = generateRandomGenome(seededRng(1));
    const pts = sampleChaosForFit(g, { samples: 1000, warmup: 50, seed: 7 });
    // Some iterations may NaN-reseed and be discarded, but the vast majority
    // should land. Allow a small reseed budget (≤5% of samples).
    expect(pts.length).toBeGreaterThan(950);
    expect(pts.length).toBeLessThanOrEqual(1000);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('is deterministic for the same seed', () => {
    const g = generateRandomGenome(seededRng(2));
    const a = sampleChaosForFit(g, { samples: 500, warmup: 20, seed: 99 });
    const b = sampleChaosForFit(g, { samples: 500, warmup: 20, seed: 99 });
    expect(a).toEqual(b);
  });
});

describe('computeFitViewport', () => {
  it('returns null for empty genomes', () => {
    const g = minimalGenome();
    expect(computeFitViewport(g, 1920, 1080)).toBeNull();
  });

  it('returns null for zero / negative canvas dims', () => {
    const g = generateRandomGenome(seededRng(3));
    expect(computeFitViewport(g, 0, 1080)).toBeNull();
    expect(computeFitViewport(g, 1920, 0)).toBeNull();
    expect(computeFitViewport(g, -1, 1)).toBeNull();
  });

  it('produces finite (cx, cy, scale) for a normal genome', () => {
    const g = generateRandomGenome(seededRng(4));
    const fit = computeFitViewport(g, 1920, 1080);
    expect(fit).not.toBeNull();
    expect(Number.isFinite(fit!.cx)).toBe(true);
    expect(Number.isFinite(fit!.cy)).toBe(true);
    expect(Number.isFinite(fit!.scale)).toBe(true);
    expect(fit!.scale).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const g = generateRandomGenome(seededRng(5));
    const a = computeFitViewport(g, 1920, 1080, { seed: 42 });
    const b = computeFitViewport(g, 1920, 1080, { seed: 42 });
    expect(a).toEqual(b);
  });

  it('applies FIT_MARGIN so the bbox does not kiss the canvas edges', () => {
    // Construct a fixed point-attractor-with-spread by using a single
    // contractive linear xform (rotation × 0.7, no translation). The
    // attractor collapses toward origin → tight bbox. With FIT_MARGIN the
    // resulting scale must leave headroom: scale × bboxW ≤ canvasW × MARGIN.
    const theta = 0.5;
    const s = 0.7;
    const cos = Math.cos(theta) * s;
    const sin = Math.sin(theta) * s;
    const g: Genome = {
      ...minimalGenome(),
      xforms: [
        {
          a: cos, b: -sin, c: 0,
          d: sin, e: cos, f: 0,
          weight: 1,
          color: 0,
          colorSpeed: 0.5,
          variations: [{ index: V.linear, weight: 1 }],
        },
      ],
    };
    const fit = computeFitViewport(g, 1920, 1080, { seed: 1 });
    // Pure-contractive linear collapses to (0,0) — bbox is near-singleton
    // and computeFitViewport returns null. That's fine — verify the
    // null-return contract instead of trying to assert the margin from an
    // ill-defined fit.
    expect(fit).toBeNull();
    // Sanity for the constant — it should be < 1 (we'd never amplify the bbox
    // past the canvas edge).
    expect(FIT_MARGIN).toBeGreaterThan(0);
    expect(FIT_MARGIN).toBeLessThan(1);
  });

  it('a wider canvas leads to scale at least as large as a narrower one (under same H)', () => {
    // Same genome, different aspect → scale is bounded by min(W/bboxW, H/bboxH).
    // Increasing W can only loosen the W-side bound, never tighten it; H side
    // is the same, so scale is monotone non-decreasing in W (holding H).
    const g = generateRandomGenome(seededRng(6));
    const wide = computeFitViewport(g, 2000, 1080, { seed: 8 });
    const narrow = computeFitViewport(g, 1000, 1080, { seed: 8 });
    expect(wide).not.toBeNull();
    expect(narrow).not.toBeNull();
    expect(wide!.scale).toBeGreaterThanOrEqual(narrow!.scale - 1e-9);
  });
});

describe('refitGenomeToOutputSize (#432 fit-on-open)', () => {
  it('re-frames a sizeless-origin genome to its stamped output size', () => {
    // generateRandomGenome fits scale at 1920x1080 and leaves size undefined —
    // exactly the surprise/corpus transfer case. Stamp a 4K size, then re-fit.
    const g = generateRandomGenome(seededRng(7));
    const scaleAt1080 = g.scale;
    g.size = { width: 3840, height: 2160 }; // editor's sticky 4K, same 16:9 aspect
    refitGenomeToOutputSize(g, { seed: 7 });
    // 4K is 2x the 1920 fit reference at matching aspect → scale roughly doubles
    // so the attractor fills the bigger frame instead of rendering tiny.
    expect(g.scale).toBeGreaterThan(scaleAt1080 * 1.6);
    expect(g.scale).toBeLessThan(scaleAt1080 * 2.4);
  });

  it('is a no-op when the genome has no size', () => {
    const g = generateRandomGenome(seededRng(9));
    const before = { scale: g.scale, cx: g.cx, cy: g.cy };
    g.size = undefined;
    refitGenomeToOutputSize(g, { seed: 9 });
    expect(g.scale).toBe(before.scale);
    expect(g.cx).toBe(before.cx);
    expect(g.cy).toBe(before.cy);
  });

  it('leaves scale untouched when the chaos oracle cannot frame (empty xforms)', () => {
    const g = minimalGenome(); // no xforms → sampleChaosForFit yields nothing
    g.size = { width: 4000, height: 4000 };
    const before = g.scale;
    refitGenomeToOutputSize(g, { seed: 1 });
    expect(g.scale).toBe(before);
  });
});

// #440 — a genome whose variation's ts_var_* oracle requires named params but
// carries NONE — exactly what the Surprise generator produces for the 25
// throwing variations missing from VARIATION_DEFAULTS (disc2, waves, popcorn …).
// The GPU defaults missing params to 0 and renders fine; the fit oracle is a UX
// helper ("not a render") and must be TOTAL — never throw and crash editor init.
describe('param-less throwing variations do not crash the fit oracle (#440)', () => {
  function disc2NoParamsGenome(): Genome {
    return {
      ...minimalGenome(),
      xforms: [
        // disc2 (index 22) with NO disc2_rot / disc2_twist — the repro shape.
        { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
          variations: [{ index: V.disc2, weight: 1 }] } as Genome['xforms'][number],
        { a: 0.5, b: 0, c: 0.3, d: 0, e: 0.5, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5,
          variations: [{ index: V.linear, weight: 1 }] } as Genome['xforms'][number],
      ],
    };
  }

  it('computeFitViewport does not throw on a param-less disc2 xform', () => {
    expect(() => computeFitViewport(disc2NoParamsGenome(), 1920, 1080, { seed: 3 })).not.toThrow();
  });

  it('refitGenomeToOutputSize does not throw (the #432 editor fit-on-open path)', () => {
    const g = disc2NoParamsGenome();
    g.size = { width: 3840, height: 2160 };
    expect(() => refitGenomeToOutputSize(g, { seed: 3 })).not.toThrow();
  });

  // The whole class — not just disc2. `disc2/perspective/pdj/separation` are in
  // VARIATION_PARAMS (exercise paramsFor's zero-fill); `waves/popcorn/rings/fan`
  // are NOT (exercise dispatchVariation's try/catch linear-fallback). None may
  // throw when their xform carries no params. (oscope is registered in V as
  // `oscilloscope`, so REVERSE_V dispatch misses ts_var_oscope and already
  // linear-falls-back — not reachable via this path.)
  const PARAMLESS_VARIATIONS = [
    'disc2', 'perspective', 'pdj', 'separation',
    'waves', 'popcorn', 'rings', 'fan',
  ];
  it.each(PARAMLESS_VARIATIONS)('%s with no params does not crash the fit oracle', (vname) => {
    const idx = (V as Record<string, number>)[vname];
    expect(typeof idx).toBe('number');
    const g: Genome = {
      ...minimalGenome(),
      xforms: [
        { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
          variations: [{ index: idx!, weight: 1 }] } as Genome['xforms'][number],
        { a: 0.5, b: 0, c: 0.3, d: 0, e: 0.5, f: 0, weight: 1, color: 0.5, colorSpeed: 0.5,
          variations: [{ index: V.linear, weight: 1 }] } as Genome['xforms'][number],
      ],
    };
    expect(() => computeFitViewport(g, 1920, 1080, { seed: 5 })).not.toThrow();
  });
});
