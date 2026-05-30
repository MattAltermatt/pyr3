import { describe, it, expect, vi } from 'vitest';
import { loadAvail, neighbors } from './avail-client';

// ── neighbors (pure) ──────────────────────────────────────────────────────
describe('neighbors', () => {
  const ids = [10, 20, 30];

  it('id in a gap → surrounding present, nearest by distance', () => {
    expect(neighbors(ids, 25)).toEqual({ prev: 20, next: 30, nearest: 20, isPresent: false });
  });

  it('present id → flanking present, nearest = self', () => {
    expect(neighbors(ids, 20)).toEqual({ prev: 10, next: 30, nearest: 20, isPresent: true });
  });

  it('below the minimum', () => {
    expect(neighbors(ids, 5)).toEqual({ prev: null, next: 10, nearest: 10, isPresent: false });
  });

  it('above the maximum', () => {
    expect(neighbors(ids, 99)).toEqual({ prev: 30, next: null, nearest: 30, isPresent: false });
  });

  it('empty list → all null', () => {
    expect(neighbors([], 5)).toEqual({ prev: null, next: null, nearest: null, isPresent: false });
  });

  it('single present element', () => {
    expect(neighbors([10], 10)).toEqual({ prev: null, next: null, nearest: 10, isPresent: true });
  });

  it('nearest ties → lower id', () => {
    expect(neighbors([10, 20], 15)).toEqual({ prev: 10, next: 20, nearest: 10, isPresent: false });
  });
});

// ── loadAvail (cached fetch + decode; injectable fetch) ─────────────────────
// 'iwGAAAWnAgM=' is REAL ESF encode_avail([0,5,300]) output (see avail.test.ts).
const SMALL_B64 = 'iwGAAAWnAgM=';
const SMALL_IDS = [0, 5, 300];
const okResponse = () => new Response(Uint8Array.from(atob(SMALL_B64), (c) => c.charCodeAt(0)).buffer);

describe('loadAvail', () => {
  it('fetches + decodes a gen manifest', async () => {
    const f = vi.fn(async () => okResponse());
    expect(await loadAvail(9001, f as unknown as typeof fetch)).toEqual(SMALL_IDS);
  });

  it('caches per gen — second call does not re-fetch', async () => {
    const f = vi.fn(async () => okResponse());
    await loadAvail(9002, f as unknown as typeof fetch);
    await loadAvail(9002, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent in-flight calls', async () => {
    const f = vi.fn(async () => okResponse());
    await Promise.all([
      loadAvail(9003, f as unknown as typeof fetch),
      loadAvail(9003, f as unknown as typeof fetch),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('non-ok response → [] (never throws)', async () => {
    const f = vi.fn(async () => new Response(null, { status: 404 }));
    expect(await loadAvail(9004, f as unknown as typeof fetch)).toEqual([]);
  });

  it('caches an absent (404) manifest — no re-fetch', async () => {
    const f = vi.fn(async () => new Response(null, { status: 404 }));
    await loadAvail(9006, f as unknown as typeof fetch);
    await loadAvail(9006, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache a transient throw — retries on next call', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    await loadAvail(9007, f as unknown as typeof fetch);
    await loadAvail(9007, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('fetch throw → [] (never throws into boot)', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadAvail(9005, f as unknown as typeof fetch)).toEqual([]);
  });
});
