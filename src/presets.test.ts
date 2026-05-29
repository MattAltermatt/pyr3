import { describe, expect, it } from 'vitest';
import type { Genome } from './genome';
import { PRESETS, applyPreset, isPresetName } from './presets';

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
