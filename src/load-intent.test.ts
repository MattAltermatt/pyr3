import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLoadIntent } from './load-intent';

// Shorthand: p(pathname, search?) → parseLoadIntent
const p = (pathname: string, search = '') => parseLoadIntent({ pathname, search });

// ── Legacy ?flame= cases (adapted from original — new signature) ──────────

describe('parseLoadIntent – legacy ?flame= (path-unrecognized)', () => {
  it('returns {kind:"default"} when search is empty', () => {
    expect(p('/')).toEqual({ kind: 'default' });
  });

  it('returns {kind:"default"} when ?flame is not set', () => {
    expect(p('/', '?other=1&another=2')).toEqual({ kind: 'default' });
  });

  it('extracts ?flame=<payload> as a flame intent', () => {
    expect(p('/', '?flame=v1:AAAA')).toEqual({ kind: 'flame', payload: 'v1:AAAA' });
  });

  it('treats a leading question mark as optional (URLSearchParams handles either)', () => {
    expect(p('/', 'flame=v1:x')).toEqual({ kind: 'flame', payload: 'v1:x' });
  });

  it('preserves URL-safe base64 characters in the flame payload', () => {
    const payload = 'v1:abc-def_ghi-jkl';
    expect(p('/', `?flame=${payload}`)).toEqual({ kind: 'flame', payload });
  });

  it('ignores unrecognized params (e.g. legacy ?fixture= no longer honored)', () => {
    expect(p('/', '?fixture=247')).toEqual({ kind: 'default' });
  });

  it('non-v1 path still honors ?flame=', () => {
    expect(p('/whatever', '?flame=v1:q')).toEqual({ kind: 'flame', payload: 'v1:q' });
  });
});

// ── /v1 path grammar ─────────────────────────────────────────────────────

describe('parseLoadIntent – /v1 path grammar', () => {
  it('corpus leaf', () => {
    expect(p('/v1/gen/247/id/12345')).toEqual({ kind: 'corpus', gen: 247, id: 12345 });
  });

  it('gen list', () => {
    expect(p('/v1/gen')).toEqual({ kind: 'gen-list' });
  });

  it('gen list trailing slash', () => {
    expect(p('/v1/gen/')).toEqual({ kind: 'gen-list' });
  });

  it('gen browse', () => {
    expect(p('/v1/gen/247')).toEqual({ kind: 'gen-browse', gen: 247 });
  });

  it('custom reserved', () => {
    expect(p('/v1/flame/abc')).toEqual({ kind: 'custom-reserved' });
  });

  it('custom reserved – deeper path', () => {
    expect(p('/v1/flame/a/b/c')).toEqual({ kind: 'custom-reserved' });
  });

  it('root → default', () => {
    expect(p('/')).toEqual({ kind: 'default' });
  });

  it('garbage gen/id → default', () => {
    expect(p('/v1/gen/abc/id/x')).toEqual({ kind: 'default' });
  });

  it('non-v1 path → default', () => {
    expect(p('/about.html')).toEqual({ kind: 'default' });
  });

  it('legacy ?flame= wins when /v1 path is unrecognized', () => {
    expect(p('/v1/unknown/path', '?flame=v1:xyz')).toEqual({ kind: 'flame', payload: 'v1:xyz' });
  });

  it('gen 0 is valid (non-negative integer)', () => {
    expect(p('/v1/gen/0')).toEqual({ kind: 'gen-browse', gen: 0 });
  });

  it('id 0 is valid', () => {
    expect(p('/v1/gen/248/id/0')).toEqual({ kind: 'corpus', gen: 248, id: 0 });
  });

  it('negative gen falls through to default', () => {
    expect(p('/v1/gen/-1')).toEqual({ kind: 'default' });
  });

  it('float gen falls through to default', () => {
    expect(p('/v1/gen/1.5')).toEqual({ kind: 'default' });
  });

  it('extra segments after gen/id → default', () => {
    expect(p('/v1/gen/247/id/12345/extra')).toEqual({ kind: 'default' });
  });

  it('/v1 itself (no subpath) → default', () => {
    expect(p('/v1')).toEqual({ kind: 'default' });
  });

  it('/v1/ (trailing slash only) → default', () => {
    expect(p('/v1/')).toEqual({ kind: 'default' });
  });
});

// ── Base-prefix stripping (project-Pages /pyr3/ deploy) ──────────────────
// On the live project-Pages site the pathname is "/pyr3/v1/...". parseLoadIntent
// strips import.meta.env.BASE_URL before matching. (In the default test env
// BASE_URL is "/", so the regular cases above already cover the apex base.)

describe('parseLoadIntent – under a non-root base (/pyr3/)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('strips the /pyr3 base prefix before matching /v1', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    expect(p('/pyr3/v1/gen/247/id/12345')).toEqual({ kind: 'corpus', gen: 247, id: 12345 });
    expect(p('/pyr3/v1/gen')).toEqual({ kind: 'gen-list' });
    expect(p('/pyr3/v1/gen/247')).toEqual({ kind: 'gen-browse', gen: 247 });
  });

  it('maps the base root (with and without trailing slash) to default', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    expect(p('/pyr3/')).toEqual({ kind: 'default' });
    expect(p('/pyr3')).toEqual({ kind: 'default' });
  });

  it('still honors legacy ?flame= under a base', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    expect(p('/pyr3/', '?flame=v1:z')).toEqual({ kind: 'flame', payload: 'v1:z' });
  });
});
