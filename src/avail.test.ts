import { describe, it, expect } from 'vitest';
import { decodeAvail, exists } from './avail';

// base64 of REAL output from the ESF Python encode_avail(ids) — DO NOT CHANGE.
const FIX = {
  empty:  { ids: [],                                   b64: 'Ow==' },
  small:  { ids: [0, 5, 300],                          b64: 'iwGAAAWnAgM=' },
  sparse: { ids: [0, 1, 2, 3, 100, 101, 40000, 41234], b64: 'CwWAAAEBAWEB27cC0gkD' },
};
const ab = (b64: string) => {
  const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return u.buffer;
};

describe('decodeAvail (ESF-conformant)', () => {
  for (const [name, { ids, b64 }] of Object.entries(FIX)) {
    it(`decodes the ${name} fixture`, async () => {
      expect(await decodeAvail(ab(b64))).toEqual(ids);
    });
  }
});

describe('exists', () => {
  it('binary-searches a sorted list', () => {
    const ids = [0, 1, 2, 3, 100, 101, 40000, 41234];
    expect(exists(ids, 0)).toBe(true);
    expect(exists(ids, 41234)).toBe(true);
    expect(exists(ids, 100)).toBe(true);
    expect(exists(ids, 4)).toBe(false);
    expect(exists(ids, 99999)).toBe(false);
    expect(exists([], 5)).toBe(false);
  });
});
