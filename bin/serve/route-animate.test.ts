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

import { applyExportOverrides } from './render-animation-png';
import { makeAnimateRoute } from './route-animate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from '../../src/animation';
import { type Genome, type Xform } from '../../src/genome';
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
