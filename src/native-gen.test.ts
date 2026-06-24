import { describe, it, expect } from 'vitest';
import { PYR3_NATIVE_GEN, formatGenLabel, parseGenSegment } from './native-gen';

describe('formatGenLabel', () => {
  it('maps the pyr3-native gen to "pyr3"', () => {
    expect(formatGenLabel(PYR3_NATIVE_GEN)).toBe('pyr3');
  });

  it('shows ESF gens as their raw number', () => {
    expect(formatGenLabel(248)).toBe('248');
    expect(formatGenLabel(165)).toBe('165');
  });

  it('reserves a gen above every ESF gen so pyr3 leads newest-first', () => {
    expect(PYR3_NATIVE_GEN).toBeGreaterThan(248);
  });
});

describe('parseGenSegment', () => {
  it('maps "pyr3" → the native gen', () => {
    expect(parseGenSegment('pyr3')).toBe(PYR3_NATIVE_GEN);
  });
  it('parses a numeric segment to its number', () => {
    expect(parseGenSegment('247')).toBe(247);
    expect(parseGenSegment('0')).toBe(0);
  });
  it('rejects anything else with null', () => {
    expect(parseGenSegment('esf')).toBeNull();
    expect(parseGenSegment('-1')).toBeNull();
    expect(parseGenSegment('1.5')).toBeNull();
    expect(parseGenSegment('')).toBeNull();
  });
  it('round-trips formatGenLabel → parseGenSegment', () => {
    for (const g of [PYR3_NATIVE_GEN, 247, 165, 0]) {
      expect(parseGenSegment(formatGenLabel(g))).toBe(g);
    }
  });
});
