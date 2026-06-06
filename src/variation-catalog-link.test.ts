import { describe, it, expect } from 'vitest';
import { linkToEditor, parseCatalogEntry, type CatalogEntry } from './variation-catalog-link';
import { V } from './variations';

describe('linkToEditor', () => {
  it('builds bare URL with no params', () => {
    expect(linkToEditor({ idx: V.linear, weight: 1, params: [] }))
      .toBe('/v1/edit?from=catalog&v=0&w=1');
  });

  it('encodes weight + positional params', () => {
    expect(linkToEditor({ idx: V.julian, weight: 0.8, params: [5, 0.7] }))
      .toBe('/v1/edit?from=catalog&v=14&w=0.8&p=5,0.7');
  });
});

describe('parseCatalogEntry', () => {
  function q(s: string): URLSearchParams { return new URLSearchParams(s); }

  it('returns null when from!=catalog', () => {
    expect(parseCatalogEntry(q(''))).toBeNull();
    expect(parseCatalogEntry(q('from=other&v=1'))).toBeNull();
  });

  it('returns null when v is missing or invalid', () => {
    expect(parseCatalogEntry(q('from=catalog'))).toBeNull();
    expect(parseCatalogEntry(q('from=catalog&v=abc'))).toBeNull();
    expect(parseCatalogEntry(q('from=catalog&v=-1'))).toBeNull();
    expect(parseCatalogEntry(q('from=catalog&v=1.5'))).toBeNull();
  });

  it('rejects out-of-range variation indices (review finding #1)', () => {
    const maxIdx = Math.max(...Object.values(V));
    expect(parseCatalogEntry(q('from=catalog&v=9999'))).toBeNull();
    expect(parseCatalogEntry(q(`from=catalog&v=${maxIdx + 1}`))).toBeNull();
    expect(parseCatalogEntry(q(`from=catalog&v=${maxIdx}`))).not.toBeNull();
  });

  it('defaults weight to 1 when missing', () => {
    expect(parseCatalogEntry(q('from=catalog&v=14')))
      .toEqual({ idx: 14, weight: 1, params: [] });
  });

  it('returns null when w is malformed', () => {
    expect(parseCatalogEntry(q('from=catalog&v=14&w=abc'))).toBeNull();
  });

  it('returns null when a param is malformed', () => {
    expect(parseCatalogEntry(q('from=catalog&v=14&w=1&p=5,abc'))).toBeNull();
  });

  it('parses idx + weight + params', () => {
    expect(parseCatalogEntry(q('from=catalog&v=14&w=0.8&p=5,0.7')))
      .toEqual({ idx: 14, weight: 0.8, params: [5, 0.7] });
  });
});

describe('linkToEditor ↔ parseCatalogEntry round-trip', () => {
  const cases: CatalogEntry[] = [
    { idx: V.linear, weight: 1, params: [] },
    { idx: V.julian, weight: 0.8, params: [5, 0.7] },
    { idx: V.cpow, weight: 0.5, params: [1.5, 0.2, 2] },
    { idx: V.mobius, weight: 0.42, params: [1, 0, 0, 1, 0, 0, 0, 0] },
  ];

  it.each(cases)('round-trips $idx', e => {
    const url = new URL('http://_' + linkToEditor(e));
    expect(parseCatalogEntry(url.searchParams)).toEqual(e);
  });
});
