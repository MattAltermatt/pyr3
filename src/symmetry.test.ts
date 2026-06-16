import { describe, expect, it } from 'vitest';
import { type Genome, SPIRAL_GALAXY, MAX_XFORMS } from './genome';
import { expandGenomeForGPU, generateSymmetryXforms } from './symmetry';
import { V } from './variations';

const closeTo6 = (actual: number, expected: number) =>
  expect(actual).toBeCloseTo(expected, 6);

describe('generateSymmetryXforms', () => {
  it('rotational n=5 produces 4 rotation xforms', () => {
    const out = generateSymmetryXforms({ kind: 'rotational', n: 5 });
    expect(out).toHaveLength(4);
  });

  // #301 — flam3_add_symmetry sets animate=0 on every generated symmetry xform.
  // interpolate.ts establishWind() keys on xf.animate===0 (since #291 bakes
  // symmetry before interpolation), so omitting it would default animate=1 and
  // wind a log-polar morph the wrong way.
  it('stamps animate=0 on every generated xform (rotational + dihedral)', () => {
    for (const sym of [{ kind: 'rotational', n: 6 }, { kind: 'dihedral', n: 4 }] as const) {
      const out = generateSymmetryXforms(sym);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((xf) => xf.animate === 0)).toBe(true);
    }
  });

  it('dihedral n=5 produces 5 xforms (1 reflection + 4 rotations)', () => {
    const out = generateSymmetryXforms({ kind: 'dihedral', n: 5 });
    expect(out).toHaveLength(5);
    // Slot 0 = Y-axis reflection (flips X): a=-1, b=0, d=0, e=1.
    expect(out[0]!.a).toBe(-1);
    expect(out[0]!.b).toBe(0);
    expect(out[0]!.d).toBe(0);
    expect(out[0]!.e).toBe(1);
  });

  it('rotational n=1 is a no-op (0 xforms)', () => {
    expect(generateSymmetryXforms({ kind: 'rotational', n: 1 })).toEqual([]);
  });

  it('dihedral n=1 is bilateral-only (1 reflection xform)', () => {
    const out = generateSymmetryXforms({ kind: 'dihedral', n: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.a).toBe(-1);
    expect(out[0]!.e).toBe(1);
  });

  it('rotation matrices match CCW rotation by k·2π/n to 6 decimals (flam3-compat)', () => {
    const out = generateSymmetryXforms({ kind: 'rotational', n: 5 });
    const a = (2 * Math.PI) / 5;
    for (let k = 1; k < 5; k++) {
      const x = out[k - 1]!;
      const c = Math.round(Math.cos(k * a) * 1e6) / 1e6;
      const s = Math.round(Math.sin(k * a) * 1e6) / 1e6;
      // CCW rotation in pyr3 affine layout (new_x = cos*x - sin*y,
      // new_y = sin*x + cos*y): a=cos, b=-sin, d=sin, e=cos.
      closeTo6(x.a, c);
      closeTo6(x.b, -s);
      closeTo6(x.d, s);
      closeTo6(x.e, c);
    }
  });

  it('color spread for n>=3: (k-1)/(n-2) for k=1..n-1', () => {
    const out = generateSymmetryXforms({ kind: 'rotational', n: 5 });
    expect(out[0]!.color).toBe(0); // k=1 → (1-1)/(5-2) = 0
    closeTo6(out[1]!.color, 1 / 3);
    closeTo6(out[2]!.color, 2 / 3);
    expect(out[3]!.color).toBe(1); // k=4 → (4-1)/(5-2) = 1
  });

  it('color for n=2 rotational is 0.0 (degenerate-guard branch)', () => {
    const out = generateSymmetryXforms({ kind: 'rotational', n: 2 });
    expect(out).toHaveLength(1);
    expect(out[0]!.color).toBe(0);
  });

  it('all generated xforms have weight=1, colorSpeed=0, single linear(1) variation', () => {
    const out = generateSymmetryXforms({ kind: 'dihedral', n: 5 });
    for (const x of out) {
      expect(x.weight).toBe(1);
      expect(x.colorSpeed).toBe(0);
      expect(x.variations).toHaveLength(1);
      expect(x.variations[0]!.index).toBe(V.linear);
      expect(x.variations[0]!.weight).toBe(1);
    }
  });
});

describe('expandGenomeForGPU', () => {
  it('returns the same reference when symmetry is undefined (fast-path)', () => {
    const out = expandGenomeForGPU(SPIRAL_GALAXY);
    expect(out).toBe(SPIRAL_GALAXY);
  });

  it('appends symmetry xforms and clears the symmetry flag', () => {
    const g: Genome = { ...SPIRAL_GALAXY, symmetry: { kind: 'rotational', n: 5 } };
    const out = expandGenomeForGPU(g);
    expect(out).not.toBe(g);
    expect(out.xforms.length).toBe(SPIRAL_GALAXY.xforms.length + 4);
    expect(out.symmetry).toBeUndefined();
  });

  it('does not mutate the input genome', () => {
    const g: Genome = { ...SPIRAL_GALAXY, symmetry: { kind: 'dihedral', n: 5 } };
    const originalLen = g.xforms.length;
    const originalSymmetry = g.symmetry;
    expandGenomeForGPU(g);
    expect(g.xforms.length).toBe(originalLen);
    expect(g.symmetry).toBe(originalSymmetry);
  });

  it('rotational n=1 returns same reference (no-op fast-path)', () => {
    const g: Genome = { ...SPIRAL_GALAXY, symmetry: { kind: 'rotational', n: 1 } };
    const out = expandGenomeForGPU(g);
    expect(out).toBe(g);
  });

  it('throws when expansion would exceed MAX_XFORMS', () => {
    // SPIRAL_GALAXY has 3 xforms. dihedral n generates n xforms (1 reflection
    // + n-1 rotations). n = MAX_XFORMS → 3 + MAX_XFORMS > MAX_XFORMS. Must throw.
    // (Relative to MAX_XFORMS so it survives cap bumps — PYR3-033 raised it to 128.)
    const g: Genome = { ...SPIRAL_GALAXY, symmetry: { kind: 'dihedral', n: MAX_XFORMS } };
    expect(() => expandGenomeForGPU(g)).toThrow(/MAX_XFORMS/);
  });
});

describe('expandGenomeForGPU — inactive zeroing', () => {
  function makeMinimalGenome(): Genome {
    return JSON.parse(JSON.stringify(SPIRAL_GALAXY)) as Genome;
  }

  it('zeros packed weight when xform.active === false', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.weight = 0.75;
    g.xforms[0]!.active = false;
    const packed = expandGenomeForGPU(g);
    expect(packed.xforms[0]!.weight).toBe(0);
    // Original genome untouched
    expect(g.xforms[0]!.weight).toBe(0.75);
  });

  it('preserves weight when xform.active === undefined or true', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.weight = 0.5;
    g.xforms[0]!.active = true;
    g.xforms[1]!.weight = 0.5;
    g.xforms[1]!.active = undefined;
    const packed = expandGenomeForGPU(g);
    expect(packed.xforms[0]!.weight).toBe(0.5);
    expect(packed.xforms[1]!.weight).toBe(0.5);
  });

  it('zeros variation weight when variation.active === false', () => {
    const g = makeMinimalGenome();
    const xf = g.xforms[0]!;
    xf.variations[0]!.weight = 0.8;
    xf.variations[0]!.active = false;
    const packed = expandGenomeForGPU(g);
    expect(packed.xforms[0]!.variations[0]!.weight).toBe(0);
    expect(g.xforms[0]!.variations[0]!.weight).toBe(0.8);
  });
});
