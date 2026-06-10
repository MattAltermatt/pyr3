import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { proxyTargetFor, makeAssetHandler } from './assets';
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
