import { describe, it, expect } from 'vitest';
import { sectionLayout, type SectionLayoutOpts } from './timeline-sections';
import { segmentScale } from './timeline-scale';
import { createTimeline } from './timeline-edit';
import type { Timeline } from './timeline';
import type { Genome } from './genome';

const g = {} as Genome;
const OPTS: SectionLayoutOpts = { nodeW: 60, edgeMinW: 30, edgePxPerSec: 40 };

// Build the geometry inputs explicitly so these tests exercise sectionLayout's
// math, not the (UX-tunable) edit defaults: pause0=0, evolve0=2, final hold=2.
function twoFlame(): Timeline {
  return {
    ...createTimeline(),
    clips: [
      { flame: { genome: g }, duration: 2, transitionDuration: 2 }, // pause 0, evolve 2
      { flame: { genome: g }, duration: 2, transitionDuration: 0 }, // terminal hold 2
    ],
  };
}
function oneFlame(): Timeline {
  return { ...createTimeline(), clips: [{ flame: { genome: g }, duration: 2, transitionDuration: 0 }] };
}

describe('sectionLayout', () => {
  it('lays out node / edge / node for a 2-flame timeline', () => {
    const tl = twoFlame();
    const segs = sectionLayout(tl, OPTS);
    // node0, edge0, node1
    expect(segs.map((s) => s.kind)).toEqual(['node', 'edge', 'node']);
    expect(segs[0]).toMatchObject({ kind: 'node', index: 0, x: 0, w: 60 });
    // edge width = max(edgeMinW, evolve*pxPerSec) = max(30, 2*40)=80, starts at 60.
    expect(segs[1]).toMatchObject({ kind: 'edge', index: 0, x: 60, w: 80 });
    expect(segs[2]).toMatchObject({ kind: 'node', index: 1, x: 140, w: 60 });
  });

  it('a single flame is one node, no edge', () => {
    const tl = oneFlame();
    const segs = sectionLayout(tl, OPTS);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: 'node', index: 0 });
  });

  it('time spans: node0 covers pause, edge0 covers evolve', () => {
    const tl = twoFlame();
    const segs = sectionLayout(tl, OPTS);
    expect(segs[0]).toMatchObject({ tStart: 0, tEnd: 0 });   // pause 0
    expect(segs[1]).toMatchObject({ tStart: 0, tEnd: 2 });   // evolve [0,2]
    expect(segs[2]).toMatchObject({ tStart: 2, tEnd: 4 });   // final hold [2,4]
  });
});

// playhead placement now routes through segmentScale().timeToX (the playheadX
// helper was inlined in #425); these assert the section-layout integration.
describe('section playhead placement (segmentScale.timeToX)', () => {
  it('interpolates x within the segment containing t', () => {
    const tl = twoFlame();
    const scale = segmentScale(sectionLayout(tl, OPTS));
    // t=1 is halfway through edge0 (time [0,2], x [60,140]) → x=100.
    expect(scale.timeToX(1)).toBeCloseTo(100, 6);
    // t=3 is halfway through node1 hold (time [2,4], x [140,200]) → x=170.
    expect(scale.timeToX(3)).toBeCloseTo(170, 6);
  });
  it('clamps out-of-range t to the chain ends', () => {
    const tl = twoFlame();
    const scale = segmentScale(sectionLayout(tl, OPTS));
    expect(scale.timeToX(-5)).toBe(0);
    expect(scale.timeToX(999)).toBeCloseTo(200, 6); // last seg x+w
  });
});
