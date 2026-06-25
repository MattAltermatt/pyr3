import { describe, expect, it } from 'vitest';
import { PRIMARY_ELIGIBLE, SURPRISE_PRIMARY_EXCLUDE, pickStratifiedPrimaries } from './surprise-seed-pool';
import { V, DC_VARIATION_SET } from './variations';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('PRIMARY_ELIGIBLE', () => {
  it('is far broader than the legacy 31-variation pool', () => {
    expect(PRIMARY_ELIGIBLE.length).toBeGreaterThan(100);
  });
  it('excludes every direct-color variation', () => {
    for (const idx of PRIMARY_ELIGIBLE) expect(DC_VARIATION_SET.has(idx)).toBe(false);
  });
  it('excludes hand-listed blur/scatter variations', () => {
    expect(PRIMARY_ELIGIBLE).not.toContain(V.blur);
    expect(PRIMARY_ELIGIBLE).not.toContain(V.gaussian_blur);
    expect(PRIMARY_ELIGIBLE).not.toContain(V.noise);
    for (const idx of SURPRISE_PRIMARY_EXCLUDE) expect(PRIMARY_ELIGIBLE).not.toContain(idx);
  });
  it('includes classic structural shapers', () => {
    expect(PRIMARY_ELIGIBLE).toContain(V.swirl);
    expect(PRIMARY_ELIGIBLE).toContain(V.julian);
  });
});

describe('pickStratifiedPrimaries', () => {
  it('returns exactly n indices', () => {
    expect(pickStratifiedPrimaries(seededRng(1), 16)).toHaveLength(16);
  });
  it('is deterministic for the same rng seed', () => {
    expect(pickStratifiedPrimaries(seededRng(7), 16)).toEqual(pickStratifiedPrimaries(seededRng(7), 16));
  });
  it('yields all-distinct picks when n <= pool size (no clumping)', () => {
    const picks = pickStratifiedPrimaries(seededRng(3), 16);
    expect(new Set(picks).size).toBe(16);
  });
  it('only returns eligible indices', () => {
    for (const idx of pickStratifiedPrimaries(seededRng(9), 24)) expect(PRIMARY_ELIGIBLE).toContain(idx);
  });
});

describe('preferred featured|only (#surprise-v2, #450)', () => {
  const rng = () => 0.5;
  it('only-mode draws the primary exclusively from the preferred set', () => {
    const pref = [V.spherical, V.swirl];
    const got = pickStratifiedPrimaries(rng, 8, { preferred: pref, preferMode: 'only' });
    for (const idx of got) expect(pref).toContain(idx);
  });
  it('featured-mode also forces the primary from the preferred set (lead guaranteed)', () => {
    // #450 — featured + only share primary selection; they diverge only in the
    // blend pool (handled in surprise-seed). The lead is always a preferred var.
    const pref = [V.spherical, V.swirl];
    const got = pickStratifiedPrimaries(() => Math.random(), 32, { preferred: pref, preferMode: 'featured' });
    for (const idx of got) expect(pref).toContain(idx);
  });
  it('empty preferred + only → falls back to the broad pool (never empty)', () => {
    expect(pickStratifiedPrimaries(rng, 8, { preferred: [], preferMode: 'only' }).length).toBe(8);
  });
  it('empty preferred + featured → falls back to the broad pool (never empty)', () => {
    expect(pickStratifiedPrimaries(rng, 8, { preferred: [], preferMode: 'featured' }).length).toBe(8);
  });
  it('no options → unchanged broad stratified behavior', () => {
    expect(pickStratifiedPrimaries(rng, 8).length).toBe(8);
  });
});
