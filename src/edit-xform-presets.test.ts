import { describe, expect, it } from 'vitest';
import { SHAPE_PRESETS, type ShapePreset } from './edit-xform-presets';

const RAD = Math.PI / 180;

describe('SHAPE_PRESETS', () => {
  it('has exactly 8 presets in spec order', () => {
    expect(SHAPE_PRESETS.map(p => p.key)).toEqual([
      'identity', 'half-scale', 'rotate-30', 'rotate-45', 'rotate-90',
      'flip-y', 'flip-x', 'shear-right',
    ]);
  });

  it('every preset has a label and an apply function', () => {
    for (const p of SHAPE_PRESETS) {
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.apply).toBe('function');
    }
  });

  it("identity preserves position, sets scales=1, rotation=shear=0", () => {
    const apply = SHAPE_PRESETS.find(p => p.key === 'identity')!.apply;
    const out = apply({ positionX: 0.42, positionY: -0.7 });
    expect(out).toEqual({ scaleX: 1, scaleY: 1, rotation: 0, shear: 0, positionX: 0.42, positionY: -0.7 });
  });

  it("rotate-45 sets rotation to 45° and uniform scale", () => {
    const apply = SHAPE_PRESETS.find(p => p.key === 'rotate-45')!.apply;
    const out = apply({ positionX: 0, positionY: 0 });
    expect(out.rotation).toBeCloseTo(45 * RAD, 12);
    expect(out.scaleX).toBe(1);
    expect(out.scaleY).toBe(1);
  });

  it("flip-y sets scaleY=-1 and preserves the rest", () => {
    const apply = SHAPE_PRESETS.find(p => p.key === 'flip-y')!.apply;
    const out = apply({ positionX: 1, positionY: 2 });
    expect(out.scaleY).toBe(-1);
    expect(out.scaleX).toBe(1);
    expect(out.rotation).toBe(0);
    expect(out.positionX).toBe(1);
    expect(out.positionY).toBe(2);
  });

  it("shear-right sets shear to 0.5", () => {
    const apply = SHAPE_PRESETS.find(p => p.key === 'shear-right')!.apply;
    const out = apply({ positionX: 0, positionY: 0 });
    expect(out.shear).toBe(0.5);
  });
});
