// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  frameCount,
  frameTimeSec,
  timelineTotalSec,
  timelineFromFlam3Xml,
  timelineFromText,
} from './screensaver-animation';
import { timelineToJson } from './timeline-serialize';

describe('animation frame math', () => {
  it('frameCount = round(duration / interval), min 1, guards interval ≤ 0', () => {
    expect(frameCount(300, 10)).toBe(30);
    expect(frameCount(5, 10)).toBe(1); // round(0.5) floored up to ≥1
    expect(frameCount(300, 0)).toBe(1); // div-by-zero guard
    expect(frameCount(300, -2)).toBe(1);
  });

  it('frameTimeSec spreads [0, total] evenly; single frame parks at 0', () => {
    expect(frameTimeSec(0, 30, 60)).toBe(0);
    expect(frameTimeSec(29, 30, 60)).toBeCloseTo(60);
    expect(frameTimeSec(15, 30, 60)).toBeCloseTo((15 / 29) * 60);
    expect(frameTimeSec(0, 1, 60)).toBe(0);
  });
});

const minPalette = '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>';
const minXform = '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/>';
const flame = (time: number) =>
  `<flame name="k${time}" size="256 256" center="0 0" scale="100" time="${time}">${minPalette}${minXform}</flame>`;

describe('timelineFromFlam3Xml', () => {
  it('returns null for a single-keyframe flame', () => {
    const single = readFileSync('fixtures/electricsheep.247.19679.flam3', 'utf8');
    expect(timelineFromFlam3Xml(single)).toBeNull();
  });

  it('builds a timeline from a 2-keyframe flam3 (querySelectorAll finds both)', () => {
    const xml = `<flames>${flame(0)}${flame(1)}</flames>`;
    const tl = timelineFromFlam3Xml(xml);
    expect(tl).not.toBeNull();
    expect(tl!.clips.length).toBeGreaterThanOrEqual(1);
    expect(timelineTotalSec(tl!)).toBeGreaterThan(0);
  });
});

describe('timelineFromText — routes JSON vs flam3 (#355 fix)', () => {
  it('accepts the /animate timeline_json export', () => {
    // round-trip: build from flam3 → serialize to the JSON export → load back.
    const built = timelineFromFlam3Xml(`<flames>${flame(0)}${flame(1)}</flames>`)!;
    const json = timelineToJson(built);
    expect(json).toContain('pyr3-timeline');
    const reloaded = timelineFromText(json);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.clips.length).toBe(built.clips.length);
  });

  it('still accepts a .flam3 multi-keyframe via the same entry', () => {
    expect(timelineFromText(`<flames>${flame(0)}${flame(1)}</flames>`)).not.toBeNull();
  });

  it('returns null for junk / non-timeline JSON', () => {
    expect(timelineFromText('{"not":"a timeline"}')).toBeNull();
    expect(timelineFromText('not json or xml at all')).toBeNull();
  });
});
