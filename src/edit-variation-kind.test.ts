// Unit tests for the variation-kind helpers that back the editor's variation
// picker (#236 param-leak, #237 cancel/revert param-loss). The picker wiring
// itself (wireVariationKindButton) is covered by the DOM integration tests in
// edit-section-xforms.test.ts; here we pin the pure param logic.
import { describe, expect, it } from 'vitest';
import { applyVariationKind, restoreVariation } from './edit-variation-kind';
import { type Variation, V } from './variations';
import { PARAM_KEYS } from './serialize';

// Build a variation with every param slot dirtied to a sentinel, so a failure
// to clear a slot shows up as the sentinel leaking through.
function dirty(index: number): Variation {
  const v = { index, weight: 1 } as unknown as Record<string, number>;
  for (const pk of PARAM_KEYS) v[pk] = 99;
  return v as unknown as Variation;
}

const slot = (v: Variation, pk: string) => (v as unknown as Record<string, number | undefined>)[pk];

describe('applyVariationKind (#236 — no stale param leak)', () => {
  it('clears ALL param slots, not just param0..param2', () => {
    const v = dirty(V.spirograph); // 9 params, all set to the sentinel
    applyVariationKind(v, V.julian); // julian has 2 default params [1, 1]
    expect(v.index).toBe(V.julian);
    expect(slot(v, 'param0')).toBe(1); // julian default power
    expect(slot(v, 'param1')).toBe(1); // julian default dist
    // param2..param9 must be cleared — NOT the spirograph sentinel.
    for (let i = 2; i < PARAM_KEYS.length; i++) {
      expect(slot(v, `param${i}`)).toBeUndefined();
    }
  });

  it('spirograph → ngon: param3 is ngon default (corners), not the leaked value', () => {
    const v = dirty(V.spirograph);
    applyVariationKind(v, V.ngon); // ngon defaults [5, 3, 1, 2] (4 params)
    expect(slot(v, 'param0')).toBe(5);
    expect(slot(v, 'param1')).toBe(3);
    expect(slot(v, 'param2')).toBe(1);
    expect(slot(v, 'param3')).toBe(2); // corners — old bug left the sentinel here
    for (let i = 4; i < PARAM_KEYS.length; i++) {
      expect(slot(v, `param${i}`)).toBeUndefined();
    }
  });

  it('parameterless variation clears every slot', () => {
    const v = dirty(V.spherical); // spherical takes no params
    applyVariationKind(v, V.spherical);
    for (const pk of PARAM_KEYS) expect(slot(v, pk)).toBeUndefined();
  });
});

describe('restoreVariation (#237 — lossless cancel/revert)', () => {
  it('restores index AND every tuned param from the snapshot', () => {
    const v = { index: V.julian, weight: 1, param0: 2, param1: 0.5 } as unknown as Variation;
    const snap = structuredClone(v);
    // Simulate destructive previews while the picker is open.
    applyVariationKind(v, V.spirograph);
    expect(v.index).toBe(V.spirograph);
    // Now cancel/revert.
    restoreVariation(v, snap);
    expect(v.index).toBe(V.julian);
    expect(slot(v, 'param0')).toBe(2);
    expect(slot(v, 'param1')).toBe(0.5);
    // Slots the snapshot never had stay clear (no spirograph leftovers).
    for (let i = 2; i < PARAM_KEYS.length; i++) {
      expect(slot(v, `param${i}`)).toBeUndefined();
    }
  });
});
