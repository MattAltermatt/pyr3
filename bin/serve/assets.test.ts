import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { proxyTargetFor, makeAssetHandler, FsAssetSource } from './assets';
import type { AssetSource } from './assets';

describe('proxyTargetFor', () => {
  it('maps a chunks path to the pyr3.app upstream URL', () => {
    expect(proxyTargetFor('chunks/247/00000.flam3chunk', '/chunks/247/00000.flam3chunk'))
      .toBe('https://pyr3.app/chunks/247/00000.flam3chunk');
  });

  it('maps each proxied prefix', () => {
    expect(proxyTargetFor('showcase/index.html', '/showcase/index.html'))
      .toBe('https://pyr3.app/showcase/index.html');
    expect(proxyTargetFor('variation-thumbs/foo.png', '/variation-thumbs/foo.png'))
      .toBe('https://pyr3.app/variation-thumbs/foo.png');
  });

  it('preserves the query string', () => {
    expect(proxyTargetFor('chunks/247/avail.flam3idx', '/chunks/247/avail.flam3idx?x=1'))
      .toBe('https://pyr3.app/chunks/247/avail.flam3idx?x=1');
  });

  it('returns null for a non-proxied path', () => {
    expect(proxyTargetFor('foo.png', '/foo.png')).toBeNull();
    expect(proxyTargetFor('index.html', '/index.html')).toBeNull();
  });

  it('honors an explicit origin override', () => {
    expect(proxyTargetFor('chunks/x', '/chunks/x', 'http://example.test'))
      .toBe('http://example.test/chunks/x');
  });
});

function fakeReq(url: string): IncomingMessage {
  return { method: 'GET', url } as IncomingMessage;
}

function fakeRes(): ServerResponse & { _status: number; _headers: Record<string, string>; _ended: string } {
  const res = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _ended: '',
    statusCode: 200,
    headersSent: false,
    setHeader(k: string, v: string) { this._headers[k.toLowerCase()] = v; },
    end(text?: string) { this._ended = text ?? ''; this._status = this.statusCode; },
  };
  return res as unknown as ServerResponse & { _status: number; _headers: Record<string, string>; _ended: string };
}

/** Stub source: returns bytes for exactly `presentPath`, null otherwise. */
function stubSource(presentPath: string): AssetSource {
  return { read: (p: string) => (p === presentPath ? new Uint8Array([1, 2, 3]) : null) };
}

describe('makeAssetHandler — corpus proxy fallback', () => {
  it('serves a present asset 200 and never redirects (additive-only invariant)', () => {
    const handler = makeAssetHandler(stubSource('chunks/165/00000.flam3chunk'));
    const res = fakeRes();
    handler(fakeReq('/chunks/165/00000.flam3chunk'), res);
    expect(res._status).toBe(200);
    expect(res._headers['location']).toBeUndefined();
  });

  it('302-redirects a prefix miss to the pyr3.app upstream', () => {
    const handler = makeAssetHandler(stubSource('nothing'));
    const res = fakeRes();
    handler(fakeReq('/chunks/999/00000.flam3chunk'), res);
    expect(res._status).toBe(302);
    expect(res._headers['location']).toBe('https://pyr3.app/chunks/999/00000.flam3chunk');
    expect(res._headers['cache-control']).toBe('no-store');
  });

  it('404s a non-prefix miss (proxy does not fire)', () => {
    const handler = makeAssetHandler(stubSource('nothing'));
    const res = fakeRes();
    handler(fakeReq('/foo.png'), res);
    expect(res._status).toBe(404);
    expect(res._headers['location']).toBeUndefined();
  });

  it('503s when given an explicit null source (guard still fires)', () => {
    const handler = makeAssetHandler(null);
    const res = fakeRes();
    handler(fakeReq('/chunks/999/00000.flam3chunk'), res);
    expect(res._status).toBe(503);
  });
});

// #319 — a bare proxy-root request (no trailing slash) must redirect to its
// trailing-slash form so it proxies to pyr3.app like `/showcase/` does, rather
// than falling through the extensionless SPA fallback and serving the shell.
describe('makeAssetHandler — bare proxy-root redirect (#319)', () => {
  it('301-redirects bare /showcase to /showcase/ instead of serving the SPA shell', () => {
    // index.html present — the bug served THIS for /showcase; assert we don't.
    const handler = makeAssetHandler(stubSource('index.html'));
    const res = fakeRes();
    handler(fakeReq('/showcase'), res);
    expect(res._status).toBe(301);
    expect(res._headers['location']).toBe('/showcase/');
  });

  it('redirects bare /chunks and /variation-thumbs the same way', () => {
    const handler = makeAssetHandler(stubSource('index.html'));
    for (const root of ['chunks', 'variation-thumbs']) {
      const res = fakeRes();
      handler(fakeReq(`/${root}`), res);
      expect(res._status).toBe(301);
      expect(res._headers['location']).toBe(`/${root}/`);
    }
  });

  it('still serves index.html for a genuine extensionless app route', () => {
    const handler = makeAssetHandler(stubSource('index.html'));
    const res = fakeRes();
    handler(fakeReq('/editor'), res);
    expect(res._status).toBe(200);
    expect(res._headers['location']).toBeUndefined();
  });
});

// #258 — FsAssetSource path-traversal guard must use the separator boundary,
// or a sibling directory sharing the root's name prefix (`/abs/dist-secret`
// vs root `/abs/dist`) leaks through `..`.
describe('FsAssetSource — sibling-prefix traversal guard (#258)', () => {
  let base: string;
  let root: string;

  beforeAll(() => {
    // realpath the tmp base so macOS /var → /private/var doesn't defeat the
    // FsAssetSource(resolve(root)) containment check under test.
    base = realpathSync(mkdtempSync(join(tmpdir(), 'pyr3-assets-')));
    root = join(base, 'dist');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), 'inside');
    // Sibling dir whose name shares the `dist` prefix — the bypass target.
    mkdirSync(join(base, 'dist-secret'), { recursive: true });
    writeFileSync(join(base, 'dist-secret', 'leak.txt'), 'secret');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reads a legitimate file inside the root', () => {
    const src = new FsAssetSource(root);
    expect(src.read('index.html')).not.toBeNull();
  });

  it('blocks `..`-traversal into a sibling dir sharing the name prefix', () => {
    const src = new FsAssetSource(root);
    // `dist/../dist-secret/leak.txt` resolves to `<base>/dist-secret/leak.txt`,
    // which startsWith(`<base>/dist`) lexically but is NOT under `<base>/dist/`.
    expect(src.read('../dist-secret/leak.txt')).toBeNull();
  });
});
