import { describe, it, expect } from 'vitest';
import { parseEasingFlag } from './pyr3-animate-args';

describe('parseEasingFlag', () => {
  it('returns undefined when --easing is absent', () => {
    expect(parseEasingFlag(['in.flam3', 'out'])).toBeUndefined();
  });
  it('parses a JSON array after --easing', () => {
    expect(parseEasingFlag(['in.flam3', 'out', '--easing', '[{"kind":"preset","name":"hold"}]']))
      .toEqual([{ kind: 'preset', name: 'hold' }]);
  });
  it('throws on malformed JSON', () => {
    expect(() => parseEasingFlag(['--easing', '{bad'])).toThrow();
  });
  it('treats a flag-lookalike next token as a missing argument', () => {
    expect(() => parseEasingFlag(['--easing', '--verbose']))
      .toThrow(/requires a JSON argument/);
  });
});
