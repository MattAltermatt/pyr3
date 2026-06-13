import { describe, it, expect } from 'vitest';
import { timelineToJson, timelineFromJson, TIMELINE_FORMAT } from './timeline-serialize';
import { animationToTimeline, timelineGenomeAt } from './timeline';
import { FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform } from './genome';
import { linear as linearVar } from './variations';
import { PYRE_PALETTE } from './palette';

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

const tlc = animationToTimeline({
  ...FLAM3_ANIMATION_DEFAULTS,
  keyframes: [baseGenome({ time: 0, xforms: [id(0)] }), baseGenome({ time: 1, xforms: [id(2)] })],
});

describe('timeline serialize', () => {
  it('round-trips a timeline through JSON, preserving render output', () => {
    const restored = timelineFromJson(timelineToJson(tlc));
    expect(restored.clips).toHaveLength(tlc.clips.length);
    for (const s of [0, 0.5, 1]) {
      expect(timelineGenomeAt(restored, s)).toEqual(timelineGenomeAt(tlc, s));
    }
  });

  it('preserves the provenance source field', () => {
    const withSrc = {
      ...tlc,
      clips: [
        {
          ...tlc.clips[0]!,
          flame: { ...tlc.clips[0]!.flame, source: { kind: 'corpus', gen: 247, id: 19679 } as const },
        },
        tlc.clips[1]!,
      ],
    };
    const restored = timelineFromJson(timelineToJson(withSrc));
    expect(restored.clips[0]!.flame.source).toEqual({ kind: 'corpus', gen: 247, id: 19679 });
  });

  it('stamps format + version', () => {
    const doc = JSON.parse(timelineToJson(tlc));
    expect(doc.format).toBe(TIMELINE_FORMAT);
    expect(doc.version).toBe(1);
  });

  it('rejects a non-timeline doc', () => {
    expect(() => timelineFromJson('{"format":"pyr3","version":1}')).toThrow(/not a timeline/);
  });

  it('rejects an unsupported version', () => {
    expect(() =>
      timelineFromJson(JSON.stringify({ format: TIMELINE_FORMAT, version: 99, clips: [] })),
    ).toThrow(/version/);
  });

  it('rejects an empty clip list', () => {
    expect(() =>
      timelineFromJson(JSON.stringify({ format: TIMELINE_FORMAT, version: 1, clips: [] })),
    ).toThrow(/no clips/);
  });
});
