import { describe, expect, it } from 'vitest';
import type { Genome } from './genome';
import {
  PRESETS,
  applyPreset,
  isPresetName,
  QUALITY_TIERS,
  DEFAULT_TIER,
  tierToSpec,
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

describe('PRESETS table', () => {
  it('has exactly quick and 4k', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['4k', 'quick']);
  });

  it('quick = 1024 / 16 / oversample=1 / round / cap', () => {
    expect(PRESETS.quick).toEqual({
      maxDim: 1024,
      maxSpp: 16,
      oversample: 1,
      shortEdgeRound: 'round',
      mode: 'cap',
    });
  });

  it('4k = 3840 / 200 / oversample=1 / floor / force', () => {
    expect(PRESETS['4k']).toEqual({
      maxDim: 3840,
      maxSpp: 200,
      oversample: 1,
      shortEdgeRound: 'floor',
      mode: 'force',
    });
  });
});

describe('isPresetName', () => {
  it('accepts quick and 4k', () => {
    expect(isPresetName('quick')).toBe(true);
    expect(isPresetName('4k')).toBe(true);
  });
  it('rejects others', () => {
    expect(isPresetName('SHOWCASE_4K')).toBe(false);
    expect(isPresetName('hd')).toBe(false);
    expect(isPresetName('')).toBe(false);
    expect(isPresetName('QUICK')).toBe(false);
  });
});

describe('applyPreset(quick) — cap mode (FE-parity, no-upscale)', () => {
  it('rescales 1280x720 down to 1024 long-edge with Math.round on the short edge', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 100 });
    const out = applyPreset(g, PRESETS.quick);
    // 1024 / 1280 = 0.8; short = round(1024 * 720 / 1280) = round(576) = 576
    expect(out.size).toEqual({ width: 1024, height: 576 });
    expect(out.scale).toBeCloseTo(80, 6);
    expect(out.oversample).toBe(1);
    expect(out.quality).toBe(16);
  });

  it('does NOT upscale when long-edge ≤ maxDim (800x592 stays as-is)', () => {
    const g = makeGenome({ size: { width: 800, height: 592 }, scale: 100 });
    const out = applyPreset(g, PRESETS.quick);
    expect(out.size).toEqual({ width: 800, height: 592 });
    expect(out.scale).toBe(100);
    expect(out.oversample).toBe(1);
    expect(out.quality).toBe(16);
  });

  it('does NOT rescale when long-edge already == maxDim', () => {
    const g = makeGenome({ size: { width: 1024, height: 768 }, scale: 50 });
    const out = applyPreset(g, PRESETS.quick);
    expect(out.size).toEqual({ width: 1024, height: 768 });
    expect(out.scale).toBe(50);
  });

  it('caps quality at maxSpp=16 (Math.min)', () => {
    const g1 = makeGenome({ quality: 1000 });
    expect(applyPreset(g1, PRESETS.quick).quality).toBe(16);
    const g2 = makeGenome({ quality: 8 });
    expect(applyPreset(g2, PRESETS.quick).quality).toBe(8);
  });

  it('does not mutate input genome', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 200, oversample: 4, quality: 500 });
    const before = JSON.stringify(g);
    applyPreset(g, PRESETS.quick);
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('applyPreset(4k) — force mode (always-rescale, upscales when needed)', () => {
  it('upscales 800x592 to 3840 long-edge with Math.floor on the short edge', () => {
    const g = makeGenome({ size: { width: 800, height: 592 }, scale: 220 });
    const out = applyPreset(g, PRESETS['4k']);
    // 3840 / 800 = 4.8; short = floor(3840 * 592 / 800) = floor(2841.6) = 2841
    // (matches the reference SHOWCASE_4K preset + pre-v0.20 wrapper script behavior)
    expect(out.size).toEqual({ width: 3840, height: 2841 });
    expect(out.scale).toBeCloseTo(220 * 4.8, 3);
    expect(out.oversample).toBe(1);
    expect(out.quality).toBe(200);
  });

  it('rescales 1280x720 to 3840 long-edge correctly', () => {
    const g = makeGenome({ size: { width: 1280, height: 720 }, scale: 355.352 });
    const out = applyPreset(g, PRESETS['4k']);
    // 3840 / 1280 = 3.0; short = floor(3840 * 720 / 1280) = floor(2160) = 2160
    expect(out.size).toEqual({ width: 3840, height: 2160 });
    expect(out.scale).toBeCloseTo(355.352 * 3.0, 3);
  });

  it('caps quality at maxSpp=200', () => {
    const g1 = makeGenome({ quality: 500 });
    expect(applyPreset(g1, PRESETS['4k']).quality).toBe(200);
    const g2 = makeGenome({ quality: 100 });
    expect(applyPreset(g2, PRESETS['4k']).quality).toBe(100);
  });

  it('forces oversample=1 even from supersample=4', () => {
    const g = makeGenome({ oversample: 4 });
    expect(applyPreset(g, PRESETS['4k']).oversample).toBe(1);
  });
});

describe('applyPreset (both presets)', () => {
  it('defaults missing genome dims to 1024x1024', () => {
    const g = makeGenome({ size: undefined });
    const out = applyPreset(g, PRESETS.quick);
    // 1024 is already at maxDim — no rescale.
    expect(out.size).toBeUndefined();
    expect(out.oversample).toBe(1);
  });

  it('defaults missing quality to maxSpp (genome.quality ?? maxSpp)', () => {
    const g = makeGenome({ quality: undefined });
    expect(applyPreset(g, PRESETS.quick).quality).toBe(16);
    expect(applyPreset(g, PRESETS['4k']).quality).toBe(200);
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

  it('Preview tier maps to the legacy quick preset values', () => {
    const preview = QUALITY_TIERS.find((t) => t.name === 'Preview')!;
    expect(tierToSpec(preview)).toEqual({
      maxDim: 1024,
      maxSpp: 16,
      oversample: 1,
      shortEdgeRound: 'round',
      mode: 'cap',
    });
    // ...and those match the legacy quick preset (dims/quality/oversample/mode).
    expect(PRESETS.quick.maxDim).toBe(preview.longEdge);
    expect(PRESETS.quick.maxSpp).toBe(preview.spp);
    expect(PRESETS.quick.oversample).toBe(preview.oversample);
    expect(PRESETS.quick.mode).toBe(preview.mode);
  });

  it('4K tier maps to the legacy 4k preset values', () => {
    const fourK = QUALITY_TIERS.find((t) => t.name === '4K')!;
    const spec = tierToSpec(fourK);
    expect(spec.maxDim).toBe(3840);
    expect(spec.maxSpp).toBe(200);
    expect(spec.mode).toBe('force');
    expect(spec.shortEdgeRound).toBe('floor');
    // ...and those match the legacy 4k preset.
    expect(PRESETS['4k'].maxDim).toBe(fourK.longEdge);
    expect(PRESETS['4k'].maxSpp).toBe(fourK.spp);
    expect(PRESETS['4k'].mode).toBe(fourK.mode);
    expect(PRESETS['4k'].shortEdgeRound).toBe('floor');
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
