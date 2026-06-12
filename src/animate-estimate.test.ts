import { describe, expect, it } from 'vitest';
import {
  countFrames,
  totalSampleBudget,
  estimateSeconds,
  formatCount,
  formatEstTime,
  estimateExport,
  formatExportEstimate,
} from './animate-estimate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform } from './genome';
import { linear as linearVar } from './variations';
import { PYRE_PALETTE } from './palette';
import { computeDispatch } from './renderer';

// ── helpers (mirror interpolate.test.ts) ─────────────────────────────────────

const id = (): Xform => ({
  a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
  weight: 1, color: 0, colorSpeed: 0.5,
  variations: [linearVar(1)],
});

const baseGenome = (overrides: Partial<Genome> = {}): Genome => ({
  name: 'k',
  xforms: [id()],
  scale: 100, cx: 0, cy: 0,
  palette: PYRE_PALETTE,
  ...overrides,
});

/** Constant-dims/quality animation so the budget estimate is exact (the
 *  probe-averaging collapses to the single per-frame value). */
const constAnim = (size = { width: 100, height: 100 }, quality = 16): Animation => ({
  ...FLAM3_ANIMATION_DEFAULTS,
  keyframes: [
    baseGenome({ time: 0, size, quality }),
    baseGenome({ time: 100, size, quality }),
  ],
});

// ── countFrames ──────────────────────────────────────────────────────────────

describe('countFrames', () => {
  it('counts an inclusive begin..end range at stride 1', () => {
    expect(countFrames(0, 9, 1)).toBe(10);
  });
  it('counts a strided range (matches the CLI t<=end loop)', () => {
    // t = 0,3,6,9 → 4 frames
    expect(countFrames(0, 9, 3)).toBe(4);
    // t = 0,5,…,100 → 21 frames
    expect(countFrames(0, 100, 5)).toBe(21);
  });
  it('counts a single frame when begin == end', () => {
    expect(countFrames(5, 5, 1)).toBe(1);
  });
  it('returns 0 for a reversed range', () => {
    expect(countFrames(10, 0, 1)).toBe(0);
  });
  it('floors a fractional dtime to >= 1', () => {
    expect(countFrames(0, 9, 0.4)).toBe(10);
  });
});

// ── totalSampleBudget ────────────────────────────────────────────────────────

describe('totalSampleBudget', () => {
  it('= frames × per-frame computeDispatch budget for constant dims', () => {
    const anim = constAnim();
    const perFrame = computeDispatch(16, 100, 100).actualSamples;
    // 10 frames (t = 0..9)
    expect(totalSampleBudget(anim, { begin: 0, end: 9, dtime: 1, qs: 1 }))
      .toBe(perFrame * 10);
  });
  it('scales per-frame quality by qs', () => {
    const anim = constAnim();
    const perFrame = computeDispatch(16 * 2, 100, 100).actualSamples;
    expect(totalSampleBudget(anim, { begin: 0, end: 4, dtime: 1, qs: 2 }))
      .toBe(perFrame * 5);
  });
  it('is 0 for an empty range', () => {
    expect(totalSampleBudget(constAnim(), { begin: 10, end: 0, dtime: 1, qs: 1 })).toBe(0);
  });
  it('does NOT multiply by ntemporal_samples (temporal sampling redistributes a fixed budget)', () => {
    const single = constAnim();
    const blurred: Animation = { ...constAnim(), ntemporal_samples: 1000 };
    const range = { begin: 0, end: 9, dtime: 1, qs: 1 };
    expect(totalSampleBudget(blurred, range)).toBe(totalSampleBudget(single, range));
  });
});

// ── estimateSeconds ──────────────────────────────────────────────────────────

describe('estimateSeconds', () => {
  it('divides samples by throughput', () => {
    expect(estimateSeconds(1000, 500)).toBe(2);
  });
  it('returns null without a throughput anchor', () => {
    expect(estimateSeconds(1000, null)).toBeNull();
  });
  it('returns null for a non-positive throughput', () => {
    expect(estimateSeconds(1000, 0)).toBeNull();
  });
});

// ── formatCount ──────────────────────────────────────────────────────────────

describe('formatCount', () => {
  it('formats raw / k / M / B tiers', () => {
    expect(formatCount(850)).toBe('850');
    expect(formatCount(12_000)).toBe('12k');
    expect(formatCount(4_200_000)).toBe('4.2M');
    expect(formatCount(4_000_000)).toBe('4M');
    expect(formatCount(101_000_000_000)).toBe('101B');
  });
});

// ── formatEstTime ────────────────────────────────────────────────────────────

describe('formatEstTime', () => {
  it('formats sub-second / M:SS / H:MM:SS', () => {
    expect(formatEstTime(0.5)).toBe('<1s');
    expect(formatEstTime(45)).toBe('0:45');
    expect(formatEstTime(400)).toBe('6:40');
    expect(formatEstTime(3700)).toBe('1:01:40');
  });
  it('returns empty string for non-finite input', () => {
    expect(formatEstTime(NaN)).toBe('');
    expect(formatEstTime(-1)).toBe('');
  });
});

// ── estimateExport + formatExportEstimate ────────────────────────────────────

describe('estimateExport', () => {
  it('bundles frames, totalSamples, and seconds', () => {
    const anim = constAnim();
    const perFrame = computeDispatch(16, 100, 100).actualSamples;
    const est = estimateExport(anim, { begin: 0, end: 9, dtime: 1, qs: 1 }, perFrame);
    expect(est.frames).toBe(10);
    expect(est.totalSamples).toBe(perFrame * 10);
    expect(est.seconds).toBe(10); // perFrame*10 samples / perFrame per sec
  });
  it('reports null seconds without a throughput anchor', () => {
    const est = estimateExport(constAnim(), { begin: 0, end: 9, dtime: 1, qs: 1 }, null);
    expect(est.seconds).toBeNull();
  });
});

describe('formatExportEstimate', () => {
  it('spells out "est. time" and tags the machine when an anchor exists', () => {
    const s = formatExportEstimate({ frames: 120, totalSamples: 101e9, seconds: 228 });
    expect(s).toContain('120 frames');
    expect(s).toContain('101B samples');
    expect(s).toContain('est. time 3:48');
    expect(s).toContain('this machine');
    expect(s).not.toContain('~'); // no bare tilde — spelled out
  });
  it('falls back to a post-first-frame note without an anchor', () => {
    const s = formatExportEstimate({ frames: 120, totalSamples: 101e9, seconds: null });
    expect(s).toContain('120 frames');
    expect(s).toContain('est. time after first frame');
  });
  it('reports an empty range plainly', () => {
    expect(formatExportEstimate({ frames: 0, totalSamples: 0, seconds: null }))
      .toContain('no frames in range');
  });
});
