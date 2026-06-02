import { describe, expect, it } from 'vitest';
import {
  parseJitterFromSearch,
  resolveWalkerJitter,
  DEFAULT_WALKER_JITTER,
} from './walker-jitter';

describe('#65 Tier 1 — DEFAULT_WALKER_JITTER', () => {
  it('locks the shipped post-#6 amplitude at 1e-10', () => {
    // This constant is load-bearing: it's the post-#6 value that lands all
    // existing parity-rig expectedR / thresholdR baselines. Any change to it
    // must come with a 25-fixture re-baseline + meta.json update, not a quiet
    // edit. The chaos.wgsl uniform default mirror lives in chaos.ts.
    expect(DEFAULT_WALKER_JITTER).toBe(1e-10);
  });
});

describe('#65 Tier 1 — parseJitterFromSearch', () => {
  it('returns null when no `?jitter=` param is present', () => {
    expect(parseJitterFromSearch('')).toBeNull();
    expect(parseJitterFromSearch('?')).toBeNull();
    expect(parseJitterFromSearch('?seed=42')).toBeNull();
    expect(parseJitterFromSearch('?ship=procgen&mute=1')).toBeNull();
  });

  it('parses scientific-notation amplitudes', () => {
    expect(parseJitterFromSearch('?jitter=1e-10')).toBe(1e-10);
    expect(parseJitterFromSearch('?jitter=1E-20')).toBe(1e-20);
    expect(parseJitterFromSearch('?jitter=5.5e-15')).toBe(5.5e-15);
  });

  it('parses decimal amplitudes', () => {
    expect(parseJitterFromSearch('?jitter=0.0000000001')).toBeCloseTo(1e-10, 20);
    expect(parseJitterFromSearch('?jitter=0.5')).toBe(0.5);
  });

  it('parses zero (jitter-off — the f32-collapse-cliff probe)', () => {
    expect(parseJitterFromSearch('?jitter=0')).toBe(0);
    expect(parseJitterFromSearch('?jitter=0.0')).toBe(0);
  });

  it('composes with other URL params', () => {
    expect(parseJitterFromSearch('?seed=42&jitter=1e-20')).toBe(1e-20);
    expect(parseJitterFromSearch('?jitter=1e-20&mute=1')).toBe(1e-20);
    expect(parseJitterFromSearch('?ship=procgen&jitter=1e-20&seed=42')).toBe(1e-20);
  });

  it('rejects negative amplitudes', () => {
    expect(parseJitterFromSearch('?jitter=-1e-10')).toBeNull();
    expect(parseJitterFromSearch('?jitter=-0.5')).toBeNull();
  });

  it('rejects unparseable amplitudes', () => {
    expect(parseJitterFromSearch('?jitter=foo')).toBeNull();
    expect(parseJitterFromSearch('?jitter=')).toBeNull();
    expect(parseJitterFromSearch('?jitter=NaN')).toBeNull();
    expect(parseJitterFromSearch('?jitter=Infinity')).toBeNull();
    expect(parseJitterFromSearch('?jitter=-Infinity')).toBeNull();
  });
});

describe('#65 Tier 1 — resolveWalkerJitter', () => {
  it('returns the parsed amplitude when `?jitter=` is valid', () => {
    expect(resolveWalkerJitter('?jitter=1e-20')).toBe(1e-20);
    expect(resolveWalkerJitter('?jitter=0')).toBe(0);
  });

  it('falls back to DEFAULT_WALKER_JITTER when no param', () => {
    expect(resolveWalkerJitter('')).toBe(DEFAULT_WALKER_JITTER);
    expect(resolveWalkerJitter('?seed=42')).toBe(DEFAULT_WALKER_JITTER);
  });

  it('falls back to DEFAULT_WALKER_JITTER when param is invalid', () => {
    expect(resolveWalkerJitter('?jitter=foo')).toBe(DEFAULT_WALKER_JITTER);
    expect(resolveWalkerJitter('?jitter=-1e-10')).toBe(DEFAULT_WALKER_JITTER);
  });
});
