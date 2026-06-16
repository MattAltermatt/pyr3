import { describe, it, expect } from 'vitest';
import { COLORS } from './ui-tokens';

// #332 — a real invariant, not a snapshot-of-self: every leaf token must be a
// well-formed lowercase #rrggbb hex string. Catches a malformed/typo'd color
// (e.g. a 3-digit shorthand, a stray named color, an uppercase or 8-digit value)
// that the type system — which only knows these are `string` literals — cannot.
const HEX6 = /^#[0-9a-f]{6}$/;

function leafColors(node: unknown, path = 'COLORS'): Array<[string, unknown]> {
  if (typeof node === 'string') return [[path, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => leafColors(v, `${path}.${k}`));
  }
  return [[path, node]];
}

describe('ui-tokens', () => {
  const leaves = leafColors(COLORS);

  it('exposes a non-trivial set of tokens', () => {
    expect(leaves.length).toBeGreaterThan(10);
  });

  it.each(leaves)('%s is a valid lowercase #rrggbb color', (_path, value) => {
    expect(value).toMatch(HEX6);
  });
});
