// File-ops round-trip + slug helper tests for /editor Task 4.1.
//
// The full open/save DOM flow requires happy-dom; the round-trip itself is
// a pure logic check that exercises genomeToJson / genomeFromJson.

import { describe, expect, it } from 'vitest';
import { genomeToJson, genomeFromJson } from './serialize';
import { generateRandomGenome } from './edit-seed';
import { slugify } from './edit-mount';

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

describe('edit file-ops round-trip', () => {
  it('save → reopen produces an identical genome', () => {
    const g = generateRandomGenome(seededRng(7));
    const serialized = JSON.stringify(genomeToJson(g));
    const restored = genomeFromJson(JSON.parse(serialized));
    expect(restored).toEqual(g);
  });

  it('round-trip is stable across multiple saves', () => {
    const g = generateRandomGenome(seededRng(42));
    const once = genomeFromJson(JSON.parse(JSON.stringify(genomeToJson(g))));
    const twice = genomeFromJson(JSON.parse(JSON.stringify(genomeToJson(once))));
    expect(twice).toEqual(g);
  });
});

describe('slugify', () => {
  it('lowercases + replaces non-alphanumerics with single dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('Hello   World!!!')).toBe('hello-world');
    expect(slugify('Foo_Bar.Baz')).toBe('foo-bar-baz');
  });

  it('strips leading/trailing dashes', () => {
    expect(slugify('  !!!hello!!!  ')).toBe('hello');
  });

  it('empty or all-punctuation falls back to "flame"', () => {
    expect(slugify('')).toBe('flame');
    expect(slugify('!!!')).toBe('flame');
    expect(slugify('   ')).toBe('flame');
  });

  it('preserves digits', () => {
    expect(slugify('flame 42')).toBe('flame-42');
  });
});
