import { describe, expect, it } from 'vitest';
import type { Genome } from './genome';
import {
  applyPreset,
  QUALITY_TIERS,
  DEFAULT_TIER,
  tierToSpec,
  customSpec,
  type PresetSpec,
} from './presets';

function makeGenome(opts: Partial<Genome> = {}): Genome {
  return {
    name: 'test',
    xforms: [],
    palette: { entries: [] },
    scale: 100,
    quality: 500,
    oversample: 4,
    size: { width: 800, height: 592 },
    ...opts,
  } as Genome;
}

// Local spec fixtures for the applyPreset behavior tests below — these are the
// cap-mode (Preview/"quick") and force-mode (4K) specs the viewer's quality
// ladder produces via tierToSpec. (#436 removed the named PRESETS table + the
// CLI `--preset` alias; applyPreset itself stays, driven by tierToSpec/customSpec.)
const QUICK_SPEC: PresetSpec = {
  maxDim: 1024, maxSpp: 16, oversample: 1, shortEdgeRound: 'round', mode: 'cap',
};
const FOURK_SPEC: PresetSpec = {
  maxDim: 3840, maxSpp: 200, oversample: 1, shortEdgeRound: 'floor', mode: 'force',
};

describe('applyPreset(quick) — cap mode (FE-parity, no-upscale)', () => {
  it('rescales 1280x720 down to 1024 long-edge with Math.round on the short edge', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 100 });
    const out = applyPreset(g, QUICK_SPEC);
    // 1024 / 1280 = 0.8; short = round(1024 * 720 / 1280) = round(576) = 576
    expect(out.size).toEqual({ width: 1024, height: 576 });
    expect(out.scale).toBeCloseTo(80, 6);
    expect(out.oversample).toBe(1);
    expect(out.quality).toBe(16);
  });

  it('does NOT upscale when long-edge ≤ maxDim (800x592 stays as-is)', () => {
    const g = makeGenome({ size: { width: 800, height: 592 }, scale: 100 });
    const out = applyPreset(g, QUICK_SPEC);
    expect(out.size).toEqual({ width: 800, height: 592 });
    expect(out.scale).toBe(100);
    expect(out.oversample).toBe(1);
    expect(out.quality).toBe(16);
  });

  it('does NOT rescale when long-edge already == maxDim', () => {
    const g = makeGenome({ size: { width: 1024, height: 768 }, scale: 50 });
    const out = applyPreset(g, QUICK_SPEC);
    expect(out.size).toEqual({ width: 1024, height: 768 });
    expect(out.scale).toBe(50);
  });

  it('caps quality at maxSpp=16 (Math.min)', () => {
    const g1 = makeGenome({ quality: 1000 });
    expect(applyPreset(g1, QUICK_SPEC).quality).toBe(16);
    const g2 = makeGenome({ quality: 8 });
    expect(applyPreset(g2, QUICK_SPEC).quality).toBe(8);
  });

  it('does not mutate input genome', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 200, oversample: 4, quality: 500 });
    const before = JSON.stringify(g);
    applyPreset(g, QUICK_SPEC);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('applyPreset(4k) — force mode (always-rescale, upscales when needed)', () => {
  it('upscales 800x592 to 3840 long-edge with Math.floor on the short edge', () => {
    const g = makeGenome({ size: { width: 800, height: 592 }, scale: 220 });
    const out = applyPreset(g, FOURK_SPEC);
    // 3840 / 800 = 4.8; short = floor(3840 * 592 / 800) = floor(2841.6) = 2841
    // (matches the reference SHOWCASE_4K preset + pre-v0.20 wrapper script behavior)
    expect(out.size).toEqual({ width: 3840, height: 2841 });
    expect(out.scale).toBeCloseTo(220 * 4.8, 3);
    expect(out.oversample).toBe(1);
    expect(out.quality).toBe(200);
  });

  it('rescales 1280x720 to 3840 long-edge correctly', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 355.352 });
    const out = applyPreset(g, FOURK_SPEC);
    // 3840 / 1280 = 3.0; short = floor(3840 * 720 / 1280) = floor(2160) = 2160
    expect(out.size).toEqual({ width: 3840, height: 2160 });
    expect(out.scale).toBeCloseTo(355.352 * 3.0, 3);
  });

  it('caps quality at maxSpp=200', () => {
    const g1 = makeGenome({ quality: 500 });
    expect(applyPreset(g1, FOURK_SPEC).quality).toBe(200);
    const g2 = makeGenome({ quality: 100 });
    expect(applyPreset(g2, FOURK_SPEC).quality).toBe(100);
  });

  it('forces oversample=1 even from supersample=4', () => {
    const g = makeGenome({ oversample: 4 });
    expect(applyPreset(g, FOURK_SPEC).oversample).toBe(1);
  });
});

describe('applyPreset (both presets)', () => {
  it('defaults missing genome dims to 1024x1024', () => {
    const g = makeGenome({ size: undefined });
    const out = applyPreset(g, QUICK_SPEC);
    // 1024 is already at maxDim — no rescale.
    expect(out.size).toBeUndefined();
    expect(out.oversample).toBe(1);
  });

  it('defaults missing quality to maxSpp (genome.quality ?? maxSpp)', () => {
    const g = makeGenome({ quality: undefined });
    expect(applyPreset(g, QUICK_SPEC).quality).toBe(16);
    expect(applyPreset(g, FOURK_SPEC).quality).toBe(200);
  });
});

describe('QUALITY_TIERS ladder (PYR3-050)', () => {
  it('has exactly 5 entries in order Draft → Preview → Standard → High → 4K', () => {
    expect(QUALITY_TIERS).toHaveLength(5);
    expect(QUALITY_TIERS.map((t) => t.name)).toEqual([
      'Draft',
      'Preview',
      'Standard',
      'High',
      '4K',
    ]);
  });

  it('longEdge is strictly increasing [512, 1024, 1920, 2560, 3840]', () => {
    const edges = QUALITY_TIERS.map((t) => t.longEdge);
    expect(edges).toEqual([512, 1024, 1920, 2560, 3840]);
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i]!).toBeGreaterThan(edges[i - 1]!);
    }
  });

  it('spp is strictly increasing [8, 16, 50, 100, 200] and every oversample === 1', () => {
    const spps = QUALITY_TIERS.map((t) => t.spp);
    expect(spps).toEqual([8, 16, 50, 100, 200]);
    for (let i = 1; i < spps.length; i++) {
      expect(spps[i]!).toBeGreaterThan(spps[i - 1]!);
    }
    for (const t of QUALITY_TIERS) {
      expect(t.oversample).toBe(1);
    }
  });

  it('Preview tier maps to a 1024 / 16 / cap / round spec', () => {
    const preview = QUALITY_TIERS.find((t) => t.name === 'Preview')!;
    expect(tierToSpec(preview)).toEqual({
      maxDim: 1024,
      maxSpp: 16,
      oversample: 1,
      shortEdgeRound: 'round',
      mode: 'cap',
    });
  });

  it('4K tier maps to a 3840 / 200 / force / floor spec', () => {
    const fourK = QUALITY_TIERS.find((t) => t.name === '4K')!;
    const spec = tierToSpec(fourK);
    expect(spec.maxDim).toBe(3840);
    expect(spec.maxSpp).toBe(200);
    expect(spec.mode).toBe('force');
    expect(spec.shortEdgeRound).toBe('floor');
  });

  it('DEFAULT_TIER is the Preview tier', () => {
    expect(DEFAULT_TIER.name).toBe('Preview');
    expect(DEFAULT_TIER).toBe(QUALITY_TIERS[1]);
  });

  it('round-trip: applyPreset(tierToSpec(Standard)) forces 800x600 long-edge to 1920 and caps spp', () => {
    const standard = QUALITY_TIERS.find((t) => t.name === 'Standard')!;
    const g = makeGenome({ size: { width: 800, height: 600 }, scale: 100, quality: 500 });
    const out = applyPreset(g, tierToSpec(standard));
    // force mode: long edge (width) → exactly 1920; short = floor(1920 * 600 / 800) = 1440.
    expect(out.size).toEqual({ width: standard.longEdge, height: 1440 });
    expect(Math.max(out.size!.width, out.size!.height)).toBe(standard.longEdge);
    expect(out.quality).toBe(standard.spp); // 500 capped to 50
    expect(out.oversample).toBe(1);
  });
});

describe('applyPreset — output-pixel radii scale with resolution (#477)', () => {
  // DE/spatial-filter radii are in OUTPUT-PIXEL units, so on a force-rescale they
  // must scale by sizeScale alongside `scale` (same image fraction at any
  // resolution), mirroring scalePreviewGenome (#352). `density.curve` is
  // dimensionless and stays put. Native-dim renders (sizeScale === 1) are
  // byte-identical so the BE↔flam3-C parity rig is unaffected.

  it('force-rescale scales density.maxRad/minRad and spatialFilter.radius by sizeScale, leaving curve untouched', () => {
    const g = makeGenome({
      size: { width: 1280, height: 720 },
      scale: 100,
      density: { maxRad: 9, minRad: 1.5, curve: 0.4 },
      spatialFilter: { radius: 2, shape: 'gaussian' },
    });
    const out = applyPreset(g, FOURK_SPEC);
    // 3840 / 1280 = 3.0
    expect(out.scale).toBeCloseTo(300, 6);
    expect(out.density!.maxRad).toBeCloseTo(27, 6);
    expect(out.density!.minRad).toBeCloseTo(4.5, 6);
    expect(out.density!.curve).toBe(0.4); // dimensionless — untouched
    expect(out.spatialFilter!.radius).toBeCloseTo(6, 6);
    expect(out.spatialFilter!.shape).toBe('gaussian');
  });

  it('cap-mode that DOES rescale (genome larger than cap) scales radii too', () => {
    const g = makeGenome({
      size: { width: 1280, height: 720 },
      scale: 100,
      density: { maxRad: 9, minRad: 1.5, curve: 0.4 },
      spatialFilter: { radius: 2, shape: 'gaussian' },
    });
    const out = applyPreset(g, QUICK_SPEC); // 1280 > 1024 → cap-mode rescale, ss = 0.8
    expect(out.scale).toBeCloseTo(80, 6);
    expect(out.density!.maxRad).toBeCloseTo(7.2, 6);
    expect(out.density!.minRad).toBeCloseTo(1.2, 6);
    expect(out.density!.curve).toBe(0.4);
    expect(out.spatialFilter!.radius).toBeCloseTo(1.6, 6);
  });

  it('cap-mode no-op (no rescale) leaves density/spatialFilter byte-identical', () => {
    const density = { maxRad: 9, minRad: 1.5, curve: 0.4 };
    const spatialFilter = { radius: 2, shape: 'gaussian' as const };
    const g = makeGenome({ size: { width: 800, height: 592 }, scale: 100, density, spatialFilter });
    const out = applyPreset(g, QUICK_SPEC); // 800 ≤ 1024 → no-op
    expect(out.density).toBe(density); // same reference — untouched
    expect(out.spatialFilter).toBe(spatialFilter);
  });

  it('force-mode at sizeScale === 1 (long-edge already == maxDim) leaves radii untouched', () => {
    const density = { maxRad: 9, minRad: 1.5, curve: 0.4 };
    const spatialFilter = { radius: 2, shape: 'gaussian' as const };
    const spec: PresetSpec = { maxDim: 1280, maxSpp: 200, oversample: 1, shortEdgeRound: 'floor', mode: 'force' };
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 100, density, spatialFilter });
    const out = applyPreset(g, spec);
    expect(out.scale).toBe(100); // sizeScale === 1
    expect(out.density).toBe(density); // same reference — byte-identical
    expect(out.spatialFilter).toBe(spatialFilter);
  });

  it('undefined density/spatialFilter is safe on a force-rescale', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 100 });
    expect(() => applyPreset(g, FOURK_SPEC)).not.toThrow();
    const out = applyPreset(g, FOURK_SPEC);
    expect(out.density).toBeUndefined();
    expect(out.spatialFilter).toBeUndefined();
  });

  it('does not mutate input genome density/spatialFilter on rescale', () => {
    const g = makeGenome({
      size: { width: 1280, height: 720 },
      scale: 100,
      density: { maxRad: 9, minRad: 1.5, curve: 0.4 },
      spatialFilter: { radius: 2, shape: 'gaussian' },
    });
    const before = JSON.stringify(g);
    applyPreset(g, FOURK_SPEC);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('customSpec — explicit --long-edge/--quality render spec (#25)', () => {
  it('customSpec builds a force-rescale spec at oversample 1', () => {
    expect(customSpec(1920, 50)).toEqual({
      maxDim: 1920,
      maxSpp: 50,
      oversample: 1,
      shortEdgeRound: 'floor',
      mode: 'force',
    });
  });
});
