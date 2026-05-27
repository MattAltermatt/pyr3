import { describe, expect, it } from 'vitest';
import { parseLoadIntent } from './load-intent';

describe('parseLoadIntent', () => {
  it('returns {kind:"default"} for an empty search string', () => {
    expect(parseLoadIntent('')).toEqual({ kind: 'default' });
  });

  it('returns {kind:"default"} when ?flame is not set', () => {
    expect(parseLoadIntent('?other=1&another=2')).toEqual({ kind: 'default' });
  });

  it('extracts ?flame=<payload> as a flame intent', () => {
    expect(parseLoadIntent('?flame=v1:AAAA')).toEqual({ kind: 'flame', payload: 'v1:AAAA' });
  });

  it('treats a leading question mark as optional (URLSearchParams handles either)', () => {
    expect(parseLoadIntent('flame=v1:x')).toEqual({ kind: 'flame', payload: 'v1:x' });
  });

  it('preserves URL-safe base64 characters in the flame payload', () => {
    const payload = 'v1:abc-def_ghi-jkl';
    expect(parseLoadIntent(`?flame=${payload}`)).toEqual({ kind: 'flame', payload });
  });

  it('ignores unrecognized params (e.g. legacy ?fixture= no longer honored)', () => {
    expect(parseLoadIntent('?fixture=247')).toEqual({ kind: 'default' });
  });
});
