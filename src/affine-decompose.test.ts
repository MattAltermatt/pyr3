import { describe, expect, it } from 'vitest';
import {
  decomposedToRaw,
  rawToDecomposed,
  type DecomposedAffine,
} from './affine-decompose';

const RAD = Math.PI / 180;

describe('decomposedToRaw — forward', () => {
  it('identity (rotation=0, scales=1, shear=0, position=0) → identity matrix', () => {
    const r = decomposedToRaw({ scaleX: 1, scaleY: 1, rotation: 0, shear: 0, positionX: 0, positionY: 0 });
    expect(r.a).toBeCloseTo(1, 12);
    expect(r.b).toBeCloseTo(0, 12);
    expect(r.c).toBe(0);
    expect(r.d).toBeCloseTo(0, 12);
    expect(r.e).toBeCloseTo(1, 12);
    expect(r.f).toBe(0);
  });

  it('rotation=45°, scales=0.7 matches the spec example', () => {
    const r = decomposedToRaw({
      scaleX: 0.7, scaleY: 0.7, rotation: 45 * RAD, shear: 0, positionX: 0.3, positionY: -0.2,
    });
    expect(r.a).toBeCloseTo(0.495, 3);
    expect(r.b).toBeCloseTo(-0.495, 3);
    expect(r.c).toBe(0.3);
    expect(r.d).toBeCloseTo(0.495, 3);
    expect(r.e).toBeCloseTo(0.495, 3);
    expect(r.f).toBe(-0.2);
  });

  it('pure rotation 90° → matrix [0 -1; 1 0]', () => {
    const r = decomposedToRaw({ scaleX: 1, scaleY: 1, rotation: 90 * RAD, shear: 0, positionX: 0, positionY: 0 });
    expect(r.a).toBeCloseTo(0, 12);
    expect(r.b).toBeCloseTo(-1, 12);
    expect(r.d).toBeCloseTo(1, 12);
    expect(r.e).toBeCloseTo(0, 12);
  });

  it('flip y (scaleY=-1) → matrix [1 0; 0 -1]', () => {
    const r = decomposedToRaw({ scaleX: 1, scaleY: -1, rotation: 0, shear: 0, positionX: 0, positionY: 0 });
    expect(r.a).toBeCloseTo(1, 12);
    expect(r.e).toBeCloseTo(-1, 12);
  });

  it('shear-only (shear=0.5) → matrix [1 0.5; 0 1]', () => {
    const r = decomposedToRaw({ scaleX: 1, scaleY: 1, rotation: 0, shear: 0.5, positionX: 0, positionY: 0 });
    expect(r.a).toBeCloseTo(1, 12);
    expect(r.b).toBeCloseTo(0.5, 12);
    expect(r.d).toBeCloseTo(0, 12);
    expect(r.e).toBeCloseTo(1, 12);
  });
});

describe('rawToDecomposed — inverse', () => {
  it('identity matrix → all-zero / unit decomposed', () => {
    const d = rawToDecomposed({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 });
    expect(d.scaleX).toBeCloseTo(1, 12);
    expect(d.scaleY).toBeCloseTo(1, 12);
    expect(d.rotation).toBeCloseTo(0, 12);
    expect(d.shear).toBeCloseTo(0, 12);
    expect(d.positionX).toBe(0);
    expect(d.positionY).toBe(0);
  });

  it('matrix from 45°+0.7 example → recovers decomposed', () => {
    const d = rawToDecomposed({ a: 0.495, b: -0.495, c: 0.3, d: 0.495, e: 0.495, f: -0.2 });
    expect(d.scaleX).toBeCloseTo(0.7, 2);
    expect(d.scaleY).toBeCloseTo(0.7, 2);
    expect(d.rotation).toBeCloseTo(45 * RAD, 3);
    expect(d.shear).toBeCloseTo(0, 6);
  });

  it('flip-y matrix → negative scaleY, zero rotation', () => {
    const d = rawToDecomposed({ a: 1, b: 0, c: 0, d: 0, e: -1, f: 0 });
    expect(d.scaleX).toBeCloseTo(1, 12);
    expect(d.scaleY).toBeCloseTo(-1, 12);
    expect(d.rotation).toBeCloseTo(0, 12);
  });

  it('singular matrix (a=d=0) → scaleX=0, sentinel shear/scaleY', () => {
    const d = rawToDecomposed({ a: 0, b: 1, c: 0, d: 0, e: 1, f: 0 });
    expect(d.scaleX).toBe(0);
    expect(d.scaleY).toBe(0);
    expect(d.shear).toBe(0);
    expect(d.rotation).toBe(0);
  });
});

describe('round-trip', () => {
  it('100 random decomposed → raw → decomposed round-trips within 1e-10', () => {
    // Deterministic LCG so failures reproduce.
    let s = 12345;
    const rng = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 0x100000000;
    };
    for (let i = 0; i < 100; i++) {
      // Avoid scaleX=0 which is intentionally non-invertible (canonical-form
      // sentinel; round-trip would land at the identity).
      const orig: DecomposedAffine = {
        scaleX: 0.1 + rng() * 2,
        scaleY: (rng() < 0.5 ? -1 : 1) * (0.1 + rng() * 2),
        rotation: (rng() - 0.5) * Math.PI * 2,
        shear: (rng() - 0.5) * 2,
        positionX: (rng() - 0.5) * 4,
        positionY: (rng() - 0.5) * 4,
      };
      const raw = decomposedToRaw(orig);
      const round = rawToDecomposed(raw);
      const raw2 = decomposedToRaw(round);
      // The matrix itself must round-trip exactly (the decomposition isn't
      // unique, but the matrix is). Tolerance accounts for fp32 ε.
      expect(raw2.a).toBeCloseTo(raw.a, 10);
      expect(raw2.b).toBeCloseTo(raw.b, 10);
      expect(raw2.c).toBeCloseTo(raw.c, 10);
      expect(raw2.d).toBeCloseTo(raw.d, 10);
      expect(raw2.e).toBeCloseTo(raw.e, 10);
      expect(raw2.f).toBeCloseTo(raw.f, 10);
    }
  });
});
