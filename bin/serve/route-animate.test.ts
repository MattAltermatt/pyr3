// Unit-level coverage for /api/animate: body validation + applyExportOverrides.
// End-to-end SSE + PNG flow is gated behind VITEST_INCLUDE_SERVE=1 in
// serve-integration.test.ts (needs Dawn-node, ~5-15s GPU boot).

import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { DOMParser } from 'linkedom';

import { applyExportOverrides, applyTimelineExportOverrides, applyOutputSizeToAnimation, applyOutputSizeToTimeline } from './render-animation-png';
import { makeAnimateRoute, applySegmentEasing, computeTimelineFrames } from './route-animate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from '../../src/animation';
import { type Genome, type Xform } from '../../src/genome';
import { type Timeline } from '../../src/timeline';
import { linear as linearVar } from '../../src/variations';
import { PYRE_PALETTE } from '../../src/palette';

(globalThis as { DOMParser: unknown }).DOMParser = DOMParser;

const id = (): Xform => ({
  a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
  weight: 1, color: 0, colorSpeed: 0.5,
  variations: [linearVar(1)],
});

const baseGenome = (overrides: Partial<Genome> = {}): Genome => ({
  name: 'kf',
  xforms: [id()],
  scale: 100, cx: 0, cy: 0,
  palette: PYRE_PALETTE,
  ...overrides,
});

const anim = (overrides: Partial<Animation> = {}): Animation => ({
  ...FLAM3_ANIMATION_DEFAULTS,
  keyframes: [
    baseGenome({ time: 0, size: { width: 100, height: 100 }, quality: 50 }),
    baseGenome({ time: 1, size: { width: 100, height: 100 }, quality: 50 }),
  ],
  ...overrides,
});

function fakeReq(body: unknown): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
    req.emit('end');
  });
  return req;
}

function fakeRes() {
  const res = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    _ended: '' as string,
    _writes: '' as string,
    setHeader(k: string, v: string) { this._headers[k] = v; },
    flushHeaders() { /* no-op */ },
    write(s: string) { this._writes += s; return true; },
    end(s?: string) { this._ended = s ?? ''; },
  };
  return res as unknown as ServerResponse & {
    _ended: string;
    _writes: string;
    _headers: Record<string, string>;
    statusCode: number;
  };
}

const fakeDevice = () => ({}) as GPUDevice;

describe('applyExportOverrides', () => {
  it('returns the source unchanged when all overrides are neutral', () => {
    const a = anim();
    expect(applyExportOverrides(a, {})).toBe(a);
    expect(applyExportOverrides(a, { qs: 1.0, ss: 1.0 })).toBe(a);
  });

  it('scales each keyframe scale + size by ss', () => {
    const a = anim();
    const out = applyExportOverrides(a, { ss: 2.0 });
    expect(out.keyframes[0]!.scale).toBe(200);
    expect(out.keyframes[0]!.size?.width).toBe(200);
    expect(out.keyframes[0]!.size?.height).toBe(200);
    expect(a.keyframes[0]!.scale).toBe(100);
  });

  it('scales each keyframe quality by qs', () => {
    const a = anim();
    const out = applyExportOverrides(a, { qs: 2.5 });
    expect(out.keyframes[0]!.quality).toBe(125);
    expect(out.keyframes[1]!.quality).toBe(125);
  });

  it('overrides ntemporal_samples + temporal_filter_width when set', () => {
    const a = anim();
    const out = applyExportOverrides(a, { nsteps: 8, blurWidth: 2.5 });
    expect(out.ntemporal_samples).toBe(8);
    expect(out.temporal_filter_width).toBe(2.5);
  });
});

describe('applyExportOverrides — nsteps default in route', () => {
  // The route (route-animate.ts) defaults nsteps to 1 unless explicitly
  // provided. Pinning the seam here: if applyExportOverrides ever stops
  // accepting nsteps as an override, the route default needs to update.
  it('accepts nsteps=1 as a no-op override (proxies the default path)', () => {
    const a = anim({ ntemporal_samples: 1000 });
    const out = applyExportOverrides(a, { nsteps: 1 });
    expect(out.ntemporal_samples).toBe(1);
  });
});

describe('applySegmentEasing', () => {
  it('stamps segment_easing from the request body onto the animation', () => {
    const animation = { segmentEasing: undefined } as { segmentEasing?: unknown[] };
    applySegmentEasing(animation as never, { segment_easing: [{ kind: 'preset', name: 'easeIn' }] });
    expect(animation.segmentEasing).toEqual([{ kind: 'preset', name: 'easeIn' }]);
  });
  it('ignores a non-array segment_easing', () => {
    const animation = { segmentEasing: undefined } as { segmentEasing?: unknown[] };
    applySegmentEasing(animation as never, { segment_easing: 'nope' });
    expect(animation.segmentEasing).toBeUndefined();
  });
});

describe('makeAnimateRoute — body validation', () => {
  it('rejects missing flame_xml with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ out_dir: '/tmp/x' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res._ended).error).toMatch(/flame_xml/);
  });

  it('rejects empty flame_xml with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ flame_xml: '', out_dir: '/tmp/x' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing out_dir with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ flame_xml: '<flames><flame/></flames>' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res._ended).error).toMatch(/out_dir/);
  });

  it('rejects single-keyframe XML with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    const xml = `<flames><flame time="0" size="100 100" center="0 0" scale="50" quality="1" brightness="4" gamma="4">
      <xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>
      <palette count="256" format="RGB">${Array.from({ length: 256 }).map(() => '808080').join('\n')}</palette>
    </flame></flames>`;
    await handle(fakeReq({ flame_xml: xml, out_dir: '/tmp/x' }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res._ended).error).toMatch(/no animation surface/);
  });

  it('rejects prefix containing path separators (path-traversal guard)', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({
      flame_xml: '<flames><flame/></flames>',
      out_dir: '/tmp/x',
      prefix: '../../etc/passwd-',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res._ended).error).toMatch(/prefix.*path separators/);
  });

  it('rejects prefix containing literal slash', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({
      flame_xml: '<flames><flame/></flames>',
      out_dir: '/tmp/x',
      prefix: 'foo/bar-',
    }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON body with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    const req = new EventEmitter() as IncomingMessage;
    queueMicrotask(() => {
      req.emit('data', Buffer.from('{not json', 'utf8'));
      req.emit('end');
    });
    await handle(req, res);
    expect(res.statusCode).toBe(400);
  });

  // #303 — out_width/out_height must be both-or-neither and finite > 0; an
  // unvalidated value would reach device.createTexture and throw on a 200 SSE.
  it('rejects a partial output size (only out_width) with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ flame_xml: '<flames><flame/></flames>', out_dir: tmpdir(), out_width: 3840 }), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res._ended).error).toMatch(/both/);
  });

  it('rejects a non-finite / non-positive output size with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    for (const dims of [{ out_width: -100, out_height: 100 }, { out_width: 'x', out_height: 100 }]) {
      const res = fakeRes();
      await handle(fakeReq({ flame_xml: '<flames><flame/></flames>', out_dir: tmpdir(), ...dims }), res);
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res._ended).error).toMatch(/finite/);
    }
  });
});

describe('makeAnimateRoute — SSE handshake', () => {
  it('writes SSE headers + open event for valid input, then cancels cleanly', async () => {
    const xml2kf = readFileSync(
      resolve(__dirname, '..', '..', 'fixtures', 'flam3-goldens', '247.29388', '247.29388.flam3'),
      'utf8',
    );

    // No real GPU device available in the unit suite — render-time will
    // throw inside renderFrame, get caught, and surface as an SSE `error`
    // event. The assertion focuses on the SSE handshake (headers, jobId,
    // open event) which all fire BEFORE any device touch.
    const handle = makeAnimateRoute(fakeDevice);

    const req = new EventEmitter() as IncomingMessage;
    const res = fakeRes();
    queueMicrotask(() => {
      req.emit('data', Buffer.from(JSON.stringify({
        flame_xml: xml2kf,
        out_dir: tmpdir(),
        begin: 0,
        end: 0,
      }), 'utf8'));
      req.emit('end');
    });

    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await handle(req, res);
    } finally {
      consoleErr.mockRestore();
    }

    expect(res.statusCode).toBe(200);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
    expect(res._headers['X-Job-ID']).toMatch(/[0-9a-f-]+/);
    expect(res._writes).toMatch(/event: open/);
    // First-frame render fails (no real GPU); surface an error event.
    expect(res._writes).toMatch(/event: error/);
  });
});

// ── applyTimelineExportOverrides (#227 — absolute quality) ───────────────────

function twoClipTimeline(q1: number, q2: number): Timeline {
  return {
    ...FLAM3_ANIMATION_DEFAULTS,
    clips: [
      { flame: { genome: baseGenome({ time: 0, quality: q1 }) }, duration: 1, transitionDuration: 0.5 },
      { flame: { genome: baseGenome({ time: 1, quality: q2 }) }, duration: 1, transitionDuration: 0 },
    ],
  };
}

describe('applyTimelineExportOverrides', () => {
  it('sets every clip genome.quality to the absolute value', () => {
    const out = applyTimelineExportOverrides(twoClipTimeline(2000, 500), { quality: 200 });
    expect(out.clips.map((c) => c.flame.genome.quality)).toEqual([200, 200]);
  });
  it('collapses ntemporal_samples (guards the ESF 1000-sub-frame trap)', () => {
    const src = { ...twoClipTimeline(2000, 500), ntemporal_samples: 1000 };
    expect(applyTimelineExportOverrides(src, { nsteps: 1 }).ntemporal_samples).toBe(1);
    expect(applyTimelineExportOverrides(src, { quality: 200, nsteps: 4 }).ntemporal_samples).toBe(4);
  });
  it('returns the source unchanged when no overrides are given', () => {
    const src = twoClipTimeline(2000, 500);
    expect(applyTimelineExportOverrides(src, {})).toBe(src);
  });
});

// ── computeTimelineFrames + timeline-input validation (#227) ─────────────────

describe('computeTimelineFrames', () => {
  it('= max(1, round(duration×fps)) frames at time i/fps', () => {
    const frames = computeTimelineFrames(2, 30);
    expect(frames.length).toBe(60);
    expect(frames[0]).toEqual({ index: 0, time: 0 });
    expect(frames[1]!.time).toBeCloseTo(1 / 30, 6);
    expect(frames[59]!.index).toBe(59);
  });
  it('always yields at least one frame', () => {
    expect(computeTimelineFrames(0, 30).length).toBe(1);
  });
  it('defaults to 30fps for non-positive fps', () => {
    expect(computeTimelineFrames(1, 0).length).toBe(30);
  });
});

describe('makeAnimateRoute — timeline input validation', () => {
  it('rejects when both flame_xml and timeline_json are present', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ flame_xml: '<flame/>', timeline_json: '{}', out_dir: tmpdir() }), res);
    expect(res.statusCode).toBe(400);
  });
  it('rejects when neither flame_xml nor timeline_json is present', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ out_dir: tmpdir() }), res);
    expect(res.statusCode).toBe(400);
  });
  it('rejects a malformed timeline_json with 400', async () => {
    const handle = makeAnimateRoute(fakeDevice);
    const res = fakeRes();
    await handle(fakeReq({ timeline_json: 'not json', out_dir: tmpdir() }), res);
    expect(res.statusCode).toBe(400);
  });
});

// ── output-size override (#274 — absolute output dims, long-edge rescale) ─────

describe('applyOutputSizeToAnimation', () => {
  it('rescales each keyframe to the output dims (long-edge anchored)', () => {
    const a = anim({
      keyframes: [
        baseGenome({ time: 0, size: { width: 1920, height: 1080 }, scale: 100 }),
        baseGenome({ time: 1, size: { width: 1920, height: 1080 }, scale: 100 }),
      ],
    });
    const out = applyOutputSizeToAnimation(a, { width: 3840, height: 2160 });
    expect(out.keyframes[0]!.size).toEqual({ width: 3840, height: 2160 });
    expect(out.keyframes[0]!.scale).toBeCloseTo(200); // long-edge ratio 2×
    expect(out.keyframes[1]!.scale).toBeCloseTo(200);
  });
  it('is identity (same reference) when no output size is given', () => {
    const a = anim();
    expect(applyOutputSizeToAnimation(a, undefined)).toBe(a);
  });
});

describe('applyOutputSizeToTimeline', () => {
  it('rescales every clip genome to the output dims', () => {
    const tl: Timeline = {
      ...FLAM3_ANIMATION_DEFAULTS,
      clips: [
        { flame: { genome: baseGenome({ time: 0, size: { width: 1920, height: 1080 }, scale: 100 }) }, duration: 1, transitionDuration: 0 },
      ],
    };
    const out = applyOutputSizeToTimeline(tl, { width: 3840, height: 2160 });
    expect(out.clips[0]!.flame.genome.size).toEqual({ width: 3840, height: 2160 });
    expect(out.clips[0]!.flame.genome.scale).toBeCloseTo(200);
  });
  it('is identity (same reference) when no output size is given', () => {
    const tl = twoClipTimeline(50, 50);
    expect(applyOutputSizeToTimeline(tl, undefined)).toBe(tl);
  });
});
