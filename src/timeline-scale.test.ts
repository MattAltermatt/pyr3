import { describe, it, expect } from 'vitest';
import { linearScale, tickLayout, fitPxPerSec, segmentScale } from './timeline-scale';

describe('linearScale', () => {
  it('maps time→x at the given px/sec and inverts', () => {
    const s = linearScale(10, 50); // 10 s @ 50 px/s
    expect(s.timeToX(0)).toBe(0);
    expect(s.timeToX(10)).toBe(500);
    expect(s.contentWidth).toBe(500);
    expect(s.xToTime(250)).toBeCloseTo(5, 9);
  });
  it('clamps xToTime into [0, duration]', () => {
    const s = linearScale(10, 50);
    expect(s.xToTime(-30)).toBe(0);
    expect(s.xToTime(99999)).toBeCloseTo(10, 9);
  });
});

describe('fitPxPerSec', () => {
  it('fits the whole duration into the viewport', () => {
    expect(fitPxPerSec(10, 500)).toBeCloseTo(50, 9);
  });
  it('never returns a non-finite or zero scale for zero duration', () => {
    const px = fitPxPerSec(0, 500);
    expect(Number.isFinite(px)).toBe(true);
    expect(px).toBeGreaterThan(0);
  });
});

describe('tickLayout', () => {
  it('picks a coarse interval when zoomed out so labels never collide', () => {
    // 60 s across 300 px = 5 px/s; 1 s ticks would be 5 px apart (collide).
    const { major } = tickLayout(60, 5, 300);
    const gaps = major.slice(1).map((m, i) => m.x - major[i]!.x);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(40);
  });
  it('uses fine intervals when zoomed in', () => {
    // 4 s across 800 px = 200 px/s; expect ≤1 s major spacing.
    const { major } = tickLayout(4, 200, 800);
    const interval = major[1]!.t - major[0]!.t;
    expect(interval).toBeLessThanOrEqual(1);
  });
  it('labels each major tick with its time', () => {
    const { major } = tickLayout(10, 50, 500);
    expect(major[0]).toMatchObject({ t: 0, x: 0 });
    expect(major.every((m) => typeof m.label === 'string')).toBe(true);
  });
});

const segs = [
  { x: 0, w: 64, tStart: 0, tEnd: 0 },     // node, pause 0
  { x: 64, w: 100, tStart: 0, tEnd: 30 },  // edge, evolve 30 s over 100 px
  { x: 164, w: 64, tStart: 30, tEnd: 32 }, // node, pause 2 s (terminal hold)
];

describe('segmentScale', () => {
  it('maps time to x piecewise across node/edge segments', () => {
    const s = segmentScale(segs);
    expect(s.timeToX(0)).toBe(0);     // left edge of first thumbnail (matches legacy playheadX)
    expect(s.timeToX(15)).toBe(114);  // halfway through the 30 s edge
    expect(s.timeToX(30)).toBe(164);  // end of edge / start of terminal node
    expect(s.contentWidth).toBe(228);
  });
  it('inverts x back to time, clamped to the span', () => {
    const s = segmentScale(segs);
    expect(s.xToTime(114)).toBeCloseTo(15, 6);
    expect(s.xToTime(-5)).toBe(0);
    expect(s.xToTime(9999)).toBeCloseTo(32, 6);
  });
});
