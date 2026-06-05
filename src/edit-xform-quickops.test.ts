import { describe, expect, it } from 'vitest';
import {
  applyQuickOp,
  QUICK_OPS_DEFS,
  type DecomposedAffine,
  type QuickOpId,
} from './edit-xform-quickops';

const ident: DecomposedAffine = { scaleX: 1, scaleY: 1, rotation: 0, shear: 0, posX: 0, posY: 0 };

describe('applyQuickOp', () => {
  it('rotate+45 adds 45 to current rotation, modular 360', () => {
    const d: DecomposedAffine = { ...ident, rotation: 30 };
    const next = applyQuickOp('rotate+45', d);
    expect(next.rotation).toBe(75);
  });

  it('rotate+45 wraps past 360', () => {
    const d: DecomposedAffine = { ...ident, rotation: 350 };
    const next = applyQuickOp('rotate+45', d);
    expect(next.rotation).toBe(35);
  });

  it('rotate-45 subtracts 45 modular 360', () => {
    const d: DecomposedAffine = { ...ident, rotation: 30 };
    const next = applyQuickOp('rotate-45', d);
    expect(next.rotation).toBe(345);
  });

  it('scaleHalf divides both scaleX and scaleY by 2', () => {
    const d: DecomposedAffine = { ...ident, scaleX: 2, scaleY: 4 };
    const next = applyQuickOp('scaleHalf', d);
    expect(next.scaleX).toBe(1);
    expect(next.scaleY).toBe(2);
  });

  it('scale2x multiplies both scaleX and scaleY by 2', () => {
    const d: DecomposedAffine = { ...ident, scaleX: 0.5, scaleY: 1.5 };
    const next = applyQuickOp('scale2x', d);
    expect(next.scaleX).toBe(1);
    expect(next.scaleY).toBe(3);
  });

  it('flipY negates scaleY only', () => {
    const d: DecomposedAffine = { ...ident, scaleX: 1.2, scaleY: 1.7 };
    const next = applyQuickOp('flipY', d);
    expect(next.scaleY).toBe(-1.7);
    expect(next.scaleX).toBe(1.2);
  });

  it('flipX negates scaleX only', () => {
    const d: DecomposedAffine = { ...ident, scaleX: 1.2, scaleY: 1.7 };
    const next = applyQuickOp('flipX', d);
    expect(next.scaleX).toBe(-1.2);
    expect(next.scaleY).toBe(1.7);
  });

  it('shear+0.1 adds 0.1 to current shear', () => {
    const d: DecomposedAffine = { ...ident, shear: 0.2 };
    const next = applyQuickOp('shear+0.1', d);
    expect(next.shear).toBeCloseTo(0.3, 12);
  });

  it('preserves position fields untouched', () => {
    const d: DecomposedAffine = { ...ident, posX: 0.42, posY: -0.7, rotation: 10 };
    const ops: QuickOpId[] = ['rotate+45', 'rotate-45', 'scale2x', 'scaleHalf', 'flipX', 'flipY', 'shear+0.1'];
    for (const op of ops) {
      const next = applyQuickOp(op, d);
      expect(next.posX).toBe(0.42);
      expect(next.posY).toBe(-0.7);
    }
  });

  it('returns a new object (does not mutate input)', () => {
    const d: DecomposedAffine = { ...ident, rotation: 30 };
    const next = applyQuickOp('rotate+45', d);
    expect(d.rotation).toBe(30);
    expect(next).not.toBe(d);
  });
});

describe('QUICK_OPS_DEFS', () => {
  it('has exactly 7 ops in spec order (no rotate+90°)', () => {
    expect(QUICK_OPS_DEFS.map((q) => q.id)).toEqual([
      'rotate+45', 'rotate-45',
      'scale2x', 'scaleHalf',
      'flipY', 'flipX',
      'shear+0.1',
    ]);
  });

  it('every entry has id, label, delta, icon', () => {
    for (const q of QUICK_OPS_DEFS) {
      expect(typeof q.id).toBe('string');
      expect(typeof q.label).toBe('string');
      expect(typeof q.delta).toBe('string');
      expect(typeof q.icon).toBe('string');
    }
  });

  it('does NOT include rotate+90°', () => {
    expect(QUICK_OPS_DEFS.find((q) => q.delta.includes('90'))).toBeUndefined();
  });
});
