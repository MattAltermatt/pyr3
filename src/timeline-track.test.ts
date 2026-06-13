import { describe, it, expect } from 'vitest';
import { clipLayout, trackXToTime, timeToTrackX } from './timeline-track';
import type { Timeline, Clip } from './timeline';
import type { Genome } from './genome';

// Minimal genome stub — geometry never reads genome internals.
const g = {} as Genome;
function clip(duration: number, transitionDuration: number): Clip {
  return { flame: { genome: g }, duration, transitionDuration };
}
function tl(clips: Clip[]): Timeline {
  return {
    clips,
    interpolation: 'linear',
    interpolation_type: 'log',
    palette_interpolation: 'hsv',
    hsv_rgb_palette_blend: 0,
    ntemporal_samples: 1,
    temporal_filter_type: 'gaussian',
    temporal_filter_width: 1,
    temporal_filter_exp: 1,
  } as Timeline;
}

describe('clipLayout', () => {
  it('maps two equal clips to two half-width boxes', () => {
    const boxes = clipLayout(tl([clip(2, 1), clip(2, 0)]), 100);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ index: 0, xStart: 0, xEnd: 50 });
    expect(boxes[1]).toMatchObject({ index: 1, xStart: 50, xEnd: 100 });
  });

  it('places the wedge start at the hold/transition boundary', () => {
    // clip 0: duration 4, transition 1 → hold 3 → wedge starts 3/4 across its box.
    const boxes = clipLayout(tl([clip(4, 1), clip(4, 0)]), 80);
    // box 0 spans [0,40]; holdEndX = 0 + (3/4)*40 = 30.
    expect(boxes[0]!.holdEndX).toBeCloseTo(30, 6);
    // last clip has no transition → holdEndX === xEnd.
    expect(boxes[1]!.holdEndX).toBeCloseTo(boxes[1]!.xEnd, 6);
  });

  it('degenerate zero-total timeline gives equal-width boxes', () => {
    const boxes = clipLayout(tl([clip(0, 0), clip(0, 0)]), 100);
    expect(boxes[0]).toMatchObject({ xStart: 0, xEnd: 50 });
    expect(boxes[1]).toMatchObject({ xStart: 50, xEnd: 100 });
  });
});

describe('trackXToTime / timeToTrackX', () => {
  it('round-trips time↔x at the midpoint', () => {
    const t = tl([clip(2, 1), clip(2, 0)]); // total 4
    expect(trackXToTime(t, 50, 100)).toBeCloseTo(2, 6);
    expect(timeToTrackX(t, 2, 100)).toBeCloseTo(50, 6);
  });

  it('clamps x outside the track to the time range', () => {
    const t = tl([clip(2, 1), clip(2, 0)]); // total 4
    expect(trackXToTime(t, -10, 100)).toBe(0);
    expect(trackXToTime(t, 999, 100)).toBeCloseTo(4, 6);
  });

  it('zero-total timeline maps everything to t=0', () => {
    const t = tl([clip(0, 0)]);
    expect(trackXToTime(t, 37, 100)).toBe(0);
    expect(timeToTrackX(t, 5, 100)).toBe(0);
  });
});
