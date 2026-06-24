import { describe, it, expect } from 'vitest';
import { brotliCompressSync } from 'node:zlib';
import { decodeAvail, exists, readVarints, encodeAvailRaw } from './avail';

// encodeAvailRaw emits PRE-brotli delta varints; the bake brotli-compresses
// them into avail.flam3idx, which decodeAvail brotli-decompresses + cumsums
// back to ids. Exercise that full round-trip.
async function roundTrip(ids: number[]): Promise<number[]> {
  const z = brotliCompressSync(Buffer.from(encodeAvailRaw(ids)));
  return decodeAvail(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
}

describe('encodeAvailRaw', () => {
  it('round-trips a sorted id list through brotli + decodeAvail', async () => {
    const ids = [0, 1, 5, 256, 257, 1000, 40000, 41234];
    expect(await roundTrip(ids)).toEqual(ids);
  });
  it('handles an empty list', async () => {
    expect(await roundTrip([])).toEqual([]);
  });
  it('handles a single id', async () => {
    expect(await roundTrip([42])).toEqual([42]);
  });
  it('stays exact for ids beyond 2^28', async () => {
    const ids = [0, 2 ** 28, 2 ** 28 + 1, 2 ** 30];
    expect(await roundTrip(ids)).toEqual(ids);
  });
  it('emits raw deltas readVarints can read directly', () => {
    expect(readVarints(encodeAvailRaw([0, 1, 5, 256]))).toEqual([0, 1, 4, 251]);
  });
});

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

describe('readVarints (#325 truncation guard)', () => {
  it('decodes well-formed multi-byte varints', () => {
    // 300 = 0xAC 0x02 (LEB128); 5 = 0x05.
    expect(readVarints(Uint8Array.from([0x05, 0xac, 0x02]))).toEqual([5, 300]);
  });
  it('throws on a buffer ending mid-varint (continuation bit set on last byte)', () => {
    // 0xac has the 0x80 continuation bit set but no following byte.
    expect(() => readVarints(Uint8Array.from([0x05, 0xac]))).toThrow(/truncated/);
  });
  it('decodes an empty buffer to []', () => {
    expect(readVarints(new Uint8Array(0))).toEqual([]);
  });
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
