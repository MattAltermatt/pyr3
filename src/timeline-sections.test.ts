import { describe, it, expect } from 'vitest';
import { sectionLayout, playheadX, type SectionLayoutOpts } from './timeline-sections';
import { appendFlame, createTimeline } from './timeline-edit';
import type { Genome } from './genome';

const g = {} as Genome;
const OPTS: SectionLayoutOpts = { nodeW: 60, edgeMinW: 30, edgePxPerSec: 40 };

describe('sectionLayout', () => {
  it('lays out node / edge / node for a 2-flame timeline', () => {
    const tl = appendFlame(appendFlame(createTimeline(), g), g); // clip0 evolve 2, clip1 terminal
    const segs = sectionLayout(tl, OPTS);
    // node0, edge0, node1
    expect(segs.map((s) => s.kind)).toEqual(['node', 'edge', 'node']);
    expect(segs[0]).toMatchObject({ kind: 'node', index: 0, x: 0, w: 60 });
    // edge width = max(edgeMinW, evolve*pxPerSec) = max(30, 2*40)=80, starts at 60.
    expect(segs[1]).toMatchObject({ kind: 'edge', index: 0, x: 60, w: 80 });
    expect(segs[2]).toMatchObject({ kind: 'node', index: 1, x: 140, w: 60 });
  });

  it('a single flame is one node, no edge', () => {
    const tl = appendFlame(createTimeline(), g);
    const segs = sectionLayout(tl, OPTS);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: 'node', index: 0 });
  });

  it('time spans: node0 covers pause, edge0 covers evolve', () => {
    const tl = appendFlame(appendFlame(createTimeline(), g), g); // pause0=0, evolve0=2, finalhold=2
    const segs = sectionLayout(tl, OPTS);
    expect(segs[0]).toMatchObject({ tStart: 0, tEnd: 0 });   // pause 0
    expect(segs[1]).toMatchObject({ tStart: 0, tEnd: 2 });   // evolve [0,2]
    expect(segs[2]).toMatchObject({ tStart: 2, tEnd: 4 });   // final hold [2,4]
  });
});

describe('playheadX', () => {
  it('interpolates x within the segment containing t', () => {
    const tl = appendFlame(appendFlame(createTimeline(), g), g);
    const segs = sectionLayout(tl, OPTS);
    // t=1 is halfway through edge0 (time [0,2], x [60,140]) → x=100.
    expect(playheadX(segs, 1)).toBeCloseTo(100, 6);
    // t=3 is halfway through node1 hold (time [2,4], x [140,200]) → x=170.
    expect(playheadX(segs, 3)).toBeCloseTo(170, 6);
  });
  it('clamps out-of-range t to the chain ends', () => {
    const tl = appendFlame(appendFlame(createTimeline(), g), g);
    const segs = sectionLayout(tl, OPTS);
    expect(playheadX(segs, -5)).toBe(0);
    expect(playheadX(segs, 999)).toBeCloseTo(200, 6); // last seg x+w
  });
});
