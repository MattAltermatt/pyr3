import { describe, it, expect } from 'vitest';
import {
  timelineDuration,
  timelineSegmentAt,
  timelineGenomeAt,
  sectionTransitionMidpoint,
  animationToTimeline,
  type Timeline,
} from './timeline';
import { interpolate } from './interpolate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform } from './genome';
import { linear as linearVar } from './variations';
import { PYRE_PALETTE } from './palette';

// ── test helpers (mirror src/interpolate.test.ts) ────────────────────────────

const id = (c = 0): Xform => ({
  a: 1, b: 0, c, d: 0, e: 1, f: 0,
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

/** Build a timeline from [duration, transitionDuration] pairs (distinct flames). */
function tl(durations: Array<[number, number]>): Timeline {
  return {
    ...FLAM3_ANIMATION_DEFAULTS,
    clips: durations.map(([duration, transitionDuration], i) => ({
      flame: { genome: baseGenome({ time: i }) },
      duration,
      transitionDuration,
    })),
  };
}

function stripTime(g: Genome): Genome {
  const { time: _t, ...rest } = g as Genome & { time?: number };
  return rest as Genome;
}

// ── timelineDuration ─────────────────────────────────────────────────────────

describe('timelineDuration', () => {
  it('sums clip durations', () => {
    expect(timelineDuration(tl([[2, 1], [3, 1], [0, 0]]))).toBe(5);
  });
  it('treats negative durations as zero', () => {
    expect(timelineDuration(tl([[2, 0], [-4, 0]]))).toBe(2);
  });
});

// ── timelineSegmentAt ────────────────────────────────────────────────────────

describe('timelineSegmentAt', () => {
  // clip0: 2s, 1s hold then 1s xfade → clip1; clip1: terminal 2s hold.
  const t2 = tl([[2, 1], [2, 0]]);

  it('returns flame[0] (localTime 0) during clip 0 hold', () => {
    const seg = timelineSegmentAt(t2, 0.5);
    expect(seg.localTime).toBe(0);
    expect(seg.animation.keyframes[0]!.time).toBe(0); // [flame0, flame0]
    expect(seg.animation.keyframes).toHaveLength(2);
  });

  it('returns flame[0]→flame[1] transition with positive localTime', () => {
    const seg = timelineSegmentAt(t2, 1.5); // 0.5s into the 1s transition window
    expect(seg.localTime).toBeCloseTo(0.5, 9);
    expect(seg.animation.keyframes[0]!.time).toBe(0);
    expect(seg.animation.keyframes[1]!.time).toBe(1); // transitionDuration
  });

  it('holds the terminal clip', () => {
    const seg = timelineSegmentAt(t2, 3.5);
    expect(seg.localTime).toBe(0);
  });

  it('clamps t past the end onto the terminal clip', () => {
    const seg = timelineSegmentAt(t2, 999);
    expect(seg.localTime).toBe(0);
  });

  it('carries the clip permutation onto the transition segment', () => {
    const withMeta: Timeline = {
      ...t2,
      clips: [{ ...t2.clips[0]!, permutation: [1, 0] }, t2.clips[1]!],
    };
    const seg = timelineSegmentAt(withMeta, 1.5);
    expect(seg.animation.segmentPermutation).toEqual([[1, 0]]);
  });

  it('throws on an empty timeline', () => {
    expect(() => timelineSegmentAt({ ...t2, clips: [] }, 0)).toThrow(/>= 1/);
  });

  it('respects a non-zero hold before the transition window (holdDur > 0)', () => {
    // clip0: 3s box = 2s hold then 1s xfade → clip1.
    const withHold = tl([[3, 1], [2, 0]]);
    // Within the hold (t < 2): steady flame[0].
    expect(timelineSegmentAt(withHold, 1.9).localTime).toBe(0);
    // Exactly at the hold/transition boundary (t == holdDur): still hold.
    expect(timelineSegmentAt(withHold, 2.0).localTime).toBe(0);
    // Just past the boundary: transition begins with a small positive localTime.
    const seg = timelineSegmentAt(withHold, 2.25);
    expect(seg.localTime).toBeCloseTo(0.25, 9);
    expect(seg.animation.keyframes[1]!.time).toBe(1); // transitionDuration
  });
});

// ── sectionTransitionMidpoint (#410) ─────────────────────────────────────────

describe('sectionTransitionMidpoint', () => {
  it('full cross-fade (no hold): midpoint is clipStart + dur/2', () => {
    // clip0: 2s box, full 2s xfade.
    expect(sectionTransitionMidpoint(tl([[2, 2], [2, 0]]), 0)).toBeCloseTo(1.0, 9);
  });

  it('hold then morph: midpoint is clipStart + holdDur + trans/2', () => {
    // clip0: 2s box = 1s hold then 1s xfade → midpoint = 0 + 1 + 0.5.
    expect(sectionTransitionMidpoint(tl([[2, 1], [2, 0]]), 0)).toBeCloseTo(1.5, 9);
  });

  it('offsets a later section by the preceding clip durations', () => {
    // clip0: 2s; clip1: 3s box = 1s hold then 2s xfade → midpoint = 2 + 1 + 1.
    expect(sectionTransitionMidpoint(tl([[2, 1], [3, 2], [0, 0]]), 1)).toBeCloseTo(4.0, 9);
  });

  it('lands strictly INSIDE the transition window (where edits are visible)', () => {
    // The whole point of #410: a section edit re-renders here, not at a keyframe.
    const t = tl([[2, 2], [2, 0]]);
    const mid = sectionTransitionMidpoint(t, 0);
    const seg = timelineSegmentAt(t, mid);
    // localTime strictly between 0 (first keyframe) and trans (second keyframe).
    expect(seg.localTime).toBeGreaterThan(0);
    expect(seg.localTime).toBeLessThan(2);
  });
});

// ── timelineGenomeAt ─────────────────────────────────────────────────────────

describe('timelineGenomeAt', () => {
  const t2 = tl([[2, 1], [2, 0]]);

  it('equals interpolate() of the segment it produces', () => {
    const seg = timelineSegmentAt(t2, 1.5);
    expect(timelineGenomeAt(t2, 1.5)).toEqual(interpolate(seg.animation, seg.localTime));
  });
});

// ── animationToTimeline (byte-identical seam) ────────────────────────────────

describe('animationToTimeline (byte-identical seam)', () => {
  const anim: Animation = {
    ...FLAM3_ANIMATION_DEFAULTS,
    keyframes: [
      baseGenome({ time: 0, xforms: [id(0)] }),
      baseGenome({ time: 1, xforms: [id(2)] }),
      baseGenome({ time: 2, xforms: [id(-1)] }),
    ],
  };

  it('produces N clips for N keyframes; last is a zero-duration terminal', () => {
    const tlc = animationToTimeline(anim);
    expect(tlc.clips).toHaveLength(3);
    expect(tlc.clips[0]).toMatchObject({ duration: 1, transitionDuration: 1 });
    expect(tlc.clips[2]).toMatchObject({ duration: 0, transitionDuration: 0 });
    expect(timelineDuration(tlc)).toBe(2);
  });

  it('renders the same genome as interpolate() at every sampled instant', () => {
    const tlc = animationToTimeline(anim);
    const t0 = anim.keyframes[0]!.time ?? 0;
    for (const s of [0, 0.25, 0.5, 0.999, 1, 1.5, 2]) {
      const fromTimeline = stripTime(timelineGenomeAt(tlc, s));
      const fromAnim = stripTime(interpolate(anim, t0 + s));
      expect(fromTimeline).toEqual(fromAnim);
    }
  });

  it('carries segmentEasing/segmentPermutation onto the matching clips', () => {
    const withMeta: Animation = { ...anim, segmentPermutation: [[0], undefined] };
    const tlc = animationToTimeline(withMeta);
    expect(tlc.clips[0]!.permutation).toEqual([0]);
    expect(tlc.clips[1]!.permutation).toBeUndefined();
  });

  it('carries the interpolation mode onto the timeline', () => {
    expect(animationToTimeline({ ...anim, interpolation: 'smooth' }).interpolation).toBe('smooth');
  });

  // DOCUMENTED LIMITATION (#227): smooth interp degrades to per-pair linear across
  // clips. The ephemeral 2-keyframe segment is always an endpoint pair, so
  // interpolate()'s Catmull-Rom path never fires. Catmull-Rom needs an INTERIOR
  // segment (≥4 keyframes), so this uses a 4-keyframe smooth animation: the raw
  // animation blends the kf1→kf2 interior segment with Catmull-Rom, but the
  // timeline blends that same clip pair linearly → they diverge. (In LINEAR mode
  // the same data is byte-identical, asserted above.) If this test ever flips to
  // "equal", cross-clip Catmull-Rom was wired in (an intended future enhancement).
  it('smooth interp diverges on the interior segment (per-pair linear)', () => {
    const smooth: Animation = {
      ...FLAM3_ANIMATION_DEFAULTS,
      interpolation: 'smooth',
      keyframes: [
        baseGenome({ time: 0, xforms: [id(0)] }),
        baseGenome({ time: 1, xforms: [id(2)] }),
        baseGenome({ time: 2, xforms: [id(-1)] }),
        baseGenome({ time: 3, xforms: [id(3)] }),
      ],
    };
    const tlc = animationToTimeline(smooth);
    const t0 = smooth.keyframes[0]!.time ?? 0;
    // s=1.5 lands in the interior (kf1→kf2) segment where Catmull-Rom applies.
    const fromTimeline = stripTime(timelineGenomeAt(tlc, 1.5));
    const fromAnim = stripTime(interpolate(smooth, t0 + 1.5));
    expect(fromTimeline).not.toEqual(fromAnim);
  });
});
