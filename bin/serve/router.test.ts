import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Router } from './router';

function fakeReq(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

function fakeReqH(method: string, url: string, headers: Record<string, string>): IncomingMessage {
  return { method, url, headers } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { _ended: string; _status: number; _headers: Record<string, string> } {
  const res = {
    _status: 0,
    _ended: '',
    _headers: {} as Record<string, string>,
    statusCode: 200,
    setHeader(k: string, v: string) { this._headers[k] = v; },
    end(text?: string) { this._ended = text ?? ''; this._status = this.statusCode; },
  };
  return res as unknown as ServerResponse & { _ended: string; _status: number; _headers: Record<string, string> };
}

describe('Router', () => {
  it('routes a literal GET path to the matching handler', async () => {
    const r = new Router();
    const handler = vi.fn((_req, res: ServerResponse) => {
      res.statusCode = 200;
      res.end('ok');
    });
    r.add('GET', '/api/capabilities', handler);
    const res = fakeRes();
    await r.dispatch(fakeReq('GET', '/api/capabilities'), res);
    expect(handler).toHaveBeenCalled();
    expect(res._ended).toBe('ok');
  });

  it('extracts :param segments and passes them to the handler', async () => {
    const r = new Router();
    let seen: Record<string, string> | null = null;
    r.add('POST', '/api/cancel/:id', (_req, res, params) => {
      seen = params;
      res.end('ok');
    });
    await r.dispatch(fakeReq('POST', '/api/cancel/abc-123'), fakeRes());
    expect(seen).toEqual({ id: 'abc-123' });
  });

  it('decodes %-encoded param values', async () => {
    const r = new Router();
    let seen: Record<string, string> | null = null;
    r.add('GET', '/x/:name', (_req, res, params) => {
      seen = params;
      res.end('ok');
    });
    await r.dispatch(fakeReq('GET', '/x/a%2Fb'), fakeRes());
    expect(seen).toEqual({ name: 'a/b' });
  });

  it('strips the query string before matching', async () => {
    const r = new Router();
    const handler = vi.fn((_req, res: ServerResponse) => { res.end('ok'); });
    r.add('GET', '/api/capabilities', handler);
    await r.dispatch(fakeReq('GET', '/api/capabilities?foo=bar'), fakeRes());
    expect(handler).toHaveBeenCalled();
  });

  it('falls back to setFallback when no route matches', async () => {
    const r = new Router();
    r.add('GET', '/api/capabilities', () => {
      throw new Error('should not be called');
    });
    const fb = vi.fn((_req, res: ServerResponse) => { res.end('fallback'); });
    r.setFallback(fb);
    const res = fakeRes();
    await r.dispatch(fakeReq('GET', '/index.html'), res);
    expect(fb).toHaveBeenCalled();
    expect(res._ended).toBe('fallback');
  });

  it('returns 404 when no route matches and no fallback is set', async () => {
    const r = new Router();
    const res = fakeRes();
    await r.dispatch(fakeReq('GET', '/nope'), res);
    expect(res._status).toBe(404);
  });

  it('matches on method too — POST should not hit a GET route', async () => {
    const r = new Router();
    const get = vi.fn((_req, res: ServerResponse) => { res.end('get'); });
    r.add('GET', '/api/capabilities', get);
    const res = fakeRes();
    await r.dispatch(fakeReq('POST', '/api/capabilities'), res);
    expect(get).not.toHaveBeenCalled();
    expect(res._status).toBe(404);
  });
});

describe('Router — guard (#230)', () => {
  it('rejects a matched route 403 when the guard returns a reason', async () => {
    const r = new Router();
    const handler = vi.fn((_req, res: ServerResponse) => { res.end('ok'); });
    r.add('POST', '/api/render', handler);
    r.setGuard((req) => (req.headers.host === 'evil.com' ? 'non-loopback Host' : null));
    const res = fakeRes();
    await r.dispatch(fakeReqH('POST', '/api/render', { host: 'evil.com' }), res);
    expect(handler).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    expect(JSON.parse(res._ended).error).toMatch(/forbidden: non-loopback Host/);
  });

  it('lets a same-origin request through to the handler', async () => {
    const r = new Router();
    const handler = vi.fn((_req, res: ServerResponse) => { res.end('ok'); });
    r.add('POST', '/api/render', handler);
    r.setGuard((req) => (req.headers.host === 'evil.com' ? 'non-loopback Host' : null));
    const res = fakeRes();
    await r.dispatch(fakeReqH('POST', '/api/render', { host: '127.0.0.1:5174' }), res);
    expect(handler).toHaveBeenCalled();
    expect(res._ended).toBe('ok');
  });

  it('does NOT guard the static-asset fallback (assets stay reachable)', async () => {
    const r = new Router();
    const fb = vi.fn((_req, res: ServerResponse) => { res.end('asset'); });
    r.setFallback(fb);
    r.setGuard(() => 'should never run on fallback');
    const res = fakeRes();
    await r.dispatch(fakeReqH('GET', '/index.html', { host: 'evil.com' }), res);
    expect(fb).toHaveBeenCalled();
    expect(res._ended).toBe('asset');
  });
});
