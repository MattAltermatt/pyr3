import { describe, expect, it } from 'vitest';
import { interpolate, pickKeyframes } from './interpolate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform } from './genome';
import { linear as linearVar, julian, V } from './variations';
import { PYRE_PALETTE } from './palette';

// ── test helpers ───────────────────────────────────────────────────────────

const id = (): Xform => ({
  a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
  weight: 1, color: 0, colorSpeed: 0.5,
  variations: [linearVar(1)],
});

const baseGenome = (overrides: Partial<Genome> = {}): Genome => ({
  name: 'k',
  xforms: [id()],
  scale: 100, cx: 0, cy: 0,
  palette: PYRE_PALETTE,
  ...overrides,
});

const anim = (k0: Genome, k1: Genome, overrides: Partial<Animation> = {}): Animation => ({
  ...FLAM3_ANIMATION_DEFAULTS,
  keyframes: [k0, k1],
  ...overrides,
});

// ── pickKeyframes ──────────────────────────────────────────────────────────

describe('pickKeyframes', () => {
  it('throws when fewer than 2 keyframes', () => {
    expect(() => pickKeyframes([baseGenome()], 0.5)).toThrow(/N >= 2/);
  });

  it('clamps to first 2 when t before first keyframe', () => {
    const ks = [baseGenome({ time: 1 }), baseGenome({ time: 2 }), baseGenome({ time: 3 })];
    const p = pickKeyframes(ks, 0);
    expect(p.i1).toBe(0);
    expect(p.i2).toBe(1);
  });

  it('clamps to last 2 when t after last keyframe', () => {
    const ks = [baseGenome({ time: 1 }), baseGenome({ time: 2 }), baseGenome({ time: 3 })];
    const p = pickKeyframes(ks, 10);
    expect(p.i1).toBe(1);
    expect(p.i2).toBe(2);
  });

  it('returns midpoint weights at t=midpoint', () => {
    const ks = [baseGenome({ time: 0 }), baseGenome({ time: 1 })];
    const p = pickKeyframes(ks, 0.5);
    expect(p.c0).toBeCloseTo(0.5);
    expect(p.c1).toBeCloseTo(0.5);
  });

  it('c0 = 1 at exact first keyframe time', () => {
    const ks = [baseGenome({ time: 0 }), baseGenome({ time: 1 })];
    const p = pickKeyframes(ks, 0);
    expect(p.c0).toBeCloseTo(1);
    expect(p.c1).toBeCloseTo(0);
  });

  it('finds the right bracket among 3 keyframes', () => {
    const ks = [
      baseGenome({ time: 0 }),
      baseGenome({ time: 1 }),
      baseGenome({ time: 2 }),
    ];
    const p = pickKeyframes(ks, 1.5);
    expect(p.i1).toBe(1);
    expect(p.i2).toBe(2);
    expect(p.c0).toBeCloseTo(0.5);
  });

  it('treats undefined time as 0', () => {
    const ks = [baseGenome(), baseGenome({ time: 1 })];
    const p = pickKeyframes(ks, 0.5);
    expect(p.c0).toBeCloseTo(0.5);
  });
});

// ── interpolate: degenerate cases ───────────────────────────────────────────

describe('interpolate — degenerate cases', () => {
  it('throws when keyframes.length < 2', () => {
    const a: Animation = { ...FLAM3_ANIMATION_DEFAULTS, keyframes: [baseGenome()] };
    expect(() => interpolate(a, 0)).toThrow(/keyframes.length >= 2/);
  });

  it('two identical keyframes at any t → matching scalar fields', () => {
    const k = baseGenome({ scale: 123, cx: 4.5, cy: -2 });
    const a = anim(k, k);
    for (const t of [-1, 0, 0.5, 1, 100]) {
      const r = interpolate(a, t);
      expect(r.scale).toBeCloseTo(123);
      expect(r.cx).toBeCloseTo(4.5);
      expect(r.cy).toBeCloseTo(-2);
    }
  });
});

// ── interpolate: linear scalar fields ───────────────────────────────────────

describe('interpolate — scalar fields', () => {
  it('cx/cy/scale interp linearly at midpoint', () => {
    const k0 = baseGenome({ time: 0, scale: 100, cx: 0, cy: 0 });
    const k1 = baseGenome({ time: 1, scale: 200, cx: 10, cy: -5 });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.scale).toBeCloseTo(150);
    expect(r.cx).toBeCloseTo(5);
    expect(r.cy).toBeCloseTo(-2.5);
  });

  it('carries result.time = the input t', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1 });
    expect(interpolate(anim(k0, k1), 0.3).time).toBeCloseTo(0.3);
  });

  it('carries rotate when either keyframe has non-zero rotate', () => {
    const k0 = baseGenome({ time: 0, rotate: 0 });
    const k1 = baseGenome({ time: 1, rotate: 90 });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.rotate).toBeCloseTo(45);
  });

  it('omits rotate when both keyframes have rotate=0', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1 });
    expect(interpolate(anim(k0, k1), 0.5).rotate).toBeUndefined();
  });
});

// ── interpolate: xform alignment ────────────────────────────────────────────

describe('interpolate — xform alignment', () => {
  it('same xform count → no padding', () => {
    const k0 = baseGenome({ time: 0, xforms: [id(), id()] });
    const k1 = baseGenome({ time: 1, xforms: [id(), id()] });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.xforms).toHaveLength(2);
  });

  it('mismatched xform counts → pad shorter with identity', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1 = baseGenome({ time: 1, xforms: [id(), id(), id()] });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.xforms).toHaveLength(3);
  });

  it('padded identity xform has weight=0 (never picked in chaos)', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1Xform: Xform = { ...id(), weight: 1 };
    const k1 = baseGenome({ time: 1, xforms: [k1Xform, k1Xform] });
    const r = interpolate(anim(k0, k1), 0);   // fully k0 → second xform is the padded identity
    // At t=0, c0=1 fully → result equals k0 with the second xform from the padding.
    // padded xform has weight=0; result xform[1].weight should also be 0 (lerp of 0 and 1, weighted to 0).
    expect(r.xforms[1]!.weight).toBeCloseTo(0);
  });

  it('finalxform present in one, absent in other → padded with identity', () => {
    const k0 = baseGenome({ time: 0, finalxform: id() });
    const k1 = baseGenome({ time: 1 });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.finalxform).toBeDefined();
  });
});

// ── interpolate: affine — linear vs log-polar ───────────────────────────────

describe('interpolate — affine linear', () => {
  it('with interpolation_type=linear, midpoint = simple average of coefs', () => {
    const x0: Xform = { ...id(), a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    const x1: Xform = { ...id(), a: 3, b: 2, c: 4, d: -1, e: 5, f: 6 };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const a = anim(k0, k1, { interpolation_type: 'linear' });
    const r = interpolate(a, 0.5);
    const X = r.xforms[0]!;
    expect(X.a).toBeCloseTo(2);
    expect(X.b).toBeCloseTo(1);
    expect(X.c).toBeCloseTo(2);
    expect(X.d).toBeCloseTo(-0.5);
    expect(X.e).toBeCloseTo(3);
    expect(X.f).toBeCloseTo(3);
  });
});

describe('interpolate — affine log-polar', () => {
  // pyr3 affine (a, b, c, d, e, f): new_x = a*x + b*y + c; new_y = d*x + e*y + f
  // For a pure rotation by θ, the matrix is:
  //   a = cos θ, b = -sin θ
  //   d = sin θ, e =  cos θ
  // flam3 stores column-major c[3][2]; pyr3 col 0 = (a, d), col 1 = (b, e), col 2 = (c, f).
  // Column 0 polar form: angle = atan2(d, a) = θ; magnitude = sqrt(a² + d²) = 1.

  const rotXform = (theta: number): Xform => ({
    ...id(),
    a: Math.cos(theta), b: -Math.sin(theta),
    d: Math.sin(theta), e: Math.cos(theta),
  });

  it('log-polar rotation 0° → 90° at t=0.5 gives 45° rotation', () => {
    const k0 = baseGenome({ time: 0, xforms: [rotXform(0)] });
    const k1 = baseGenome({ time: 1, xforms: [rotXform(Math.PI / 2)] });
    const a = anim(k0, k1, { interpolation_type: 'log' });
    const r = interpolate(a, 0.5);
    const x = r.xforms[0]!;
    // 45° rotation: a = cos45 ≈ 0.707, d = sin45 ≈ 0.707
    expect(x.a).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    expect(x.d).toBeCloseTo(Math.sin(Math.PI / 4), 5);
  });

  it('log-polar takes the short arc: 350° → 10° goes via 0°, not 180°', () => {
    const k0 = baseGenome({ time: 0, xforms: [rotXform((350 * Math.PI) / 180)] });
    const k1 = baseGenome({ time: 1, xforms: [rotXform((10 * Math.PI) / 180)] });
    const a = anim(k0, k1, { interpolation_type: 'log' });
    const r = interpolate(a, 0.5);
    const x = r.xforms[0]!;
    // Short arc through 360°/0°: midpoint should be ~0°, NOT ~180°.
    // 0°: a=1, d=0.   180°: a=-1, d=0. We expect a>0.
    expect(x.a).toBeGreaterThan(0.9);
  });

  it('log-polar preserves magnitude through interp', () => {
    // Both keyframes have magnitude-2 affine columns.
    const x0: Xform = { ...id(), a: 2, b: 0, c: 0, d: 0, e: 2, f: 0 };
    const x1: Xform = { ...id(), a: 0, b: -2, c: 0, d: 2, e: 0, f: 0 }; // 90° rotation, mag=2
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const a = anim(k0, k1, { interpolation_type: 'log' });
    const r = interpolate(a, 0.5);
    const x = r.xforms[0]!;
    const mag = Math.hypot(x.a, x.d);
    expect(mag).toBeCloseTo(2, 5);
  });
});

// ── interpolate: variations ─────────────────────────────────────────────────

describe('interpolate — variations', () => {
  it('matching single variation interp weights', () => {
    const x0: Xform = { ...id(), variations: [linearVar(1)] };
    const x1: Xform = { ...id(), variations: [linearVar(3)] };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1), 0.5);
    const v = r.xforms[0]!.variations[0]!;
    expect(v.index).toBe(V.linear);
    expect(v.weight).toBeCloseTo(2);
  });

  it('variation present only in k0 lerps weight toward 0', () => {
    const x0: Xform = { ...id(), variations: [linearVar(1), julian(2, 3, 1)] };
    const x1: Xform = { ...id(), variations: [linearVar(1)] };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1), 0.5);
    const vs = r.xforms[0]!.variations;
    expect(vs).toHaveLength(2);
    const julianResult = vs.find((v) => v.index === V.julian)!;
    expect(julianResult.weight).toBeCloseTo(1);   // lerp 2 → 0 at t=0.5
  });

  it('parametric variation params lerp linearly', () => {
    const x0: Xform = { ...id(), variations: [julian(1, /* power */ 2, /* dist */ 1)] };
    const x1: Xform = { ...id(), variations: [julian(1, /* power */ 4, /* dist */ 3)] };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1), 0.5);
    const v = r.xforms[0]!.variations[0]!;
    expect(v.index).toBe(V.julian);
    expect(v.param0).toBeCloseTo(3);  // power: 2 → 4
    expect(v.param1).toBeCloseTo(2);  // dist:  1 → 3
  });

  it('empty union → linear(1) fallback', () => {
    // Doesn't really happen with the importer (always at least one variation),
    // but guard the contract for hand-crafted Animations.
    const x0: Xform = { ...id(), variations: [] };
    const x1: Xform = { ...id(), variations: [] };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.xforms[0]!.variations).toHaveLength(1);
    expect(r.xforms[0]!.variations[0]!.index).toBe(V.linear);
  });
});

// ── interpolate: palette ────────────────────────────────────────────────────

describe('interpolate — palette', () => {
  it('returns 256-stop palette', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1 });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.palette.stops).toHaveLength(256);
  });

  it('two identical palettes interp to ~the same palette', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1 });
    const r = interpolate(anim(k0, k1), 0.5);
    const refLut = k0.palette.stops;
    // Stop 0 (black-end) and stop 255 (white-end) should ~match across.
    const refStop0 = refLut[0]!;
    // Resulting stops are 256-entry positional; t=0 should give same RGB as the
    // 0th sample of the baked LUT — close but exact-match dependent on bake fn.
    // We assert the structural promise + that colors are valid [0, 1].
    for (const s of r.palette.stops) {
      expect(s.r).toBeGreaterThanOrEqual(0);
      expect(s.r).toBeLessThanOrEqual(1);
      expect(s.g).toBeGreaterThanOrEqual(0);
      expect(s.b).toBeLessThanOrEqual(1);
    }
    // First stop should approximately mirror PYRE's first color.
    expect(r.palette.stops[0]!.r).toBeCloseTo(refStop0.r, 5);
  });

  it('RGB-mode palette interp midpoint is per-channel average', () => {
    // Synthesize two simple palettes (one black, one white).
    const blackPalette = {
      name: 'b',
      stops: [{ t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 0, g: 0, b: 0 }],
    };
    const whitePalette = {
      name: 'w',
      stops: [{ t: 0, r: 1, g: 1, b: 1 }, { t: 1, r: 1, g: 1, b: 1 }],
    };
    const k0 = baseGenome({ time: 0, palette: blackPalette });
    const k1 = baseGenome({ time: 1, palette: whitePalette });
    const a = anim(k0, k1, { palette_interpolation: 'rgb' });
    const r = interpolate(a, 0.5);
    // Every stop should be ~mid-gray.
    for (const s of r.palette.stops) {
      expect(s.r).toBeCloseTo(0.5, 5);
      expect(s.g).toBeCloseTo(0.5, 5);
      expect(s.b).toBeCloseTo(0.5, 5);
    }
  });
});

// ── interpolate: tonemap ────────────────────────────────────────────────────

describe('interpolate — tonemap', () => {
  it('interpolates linearly when both keyframes have tonemap', () => {
    const k0 = baseGenome({
      time: 0,
      tonemap: { gamma: 2, brightness: 4, vibrancy: 0, highlightPower: -1, gammaThreshold: 0.01 },
    });
    const k1 = baseGenome({
      time: 1,
      tonemap: { gamma: 4, brightness: 8, vibrancy: 1, highlightPower: 1, gammaThreshold: 0.05 },
    });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.tonemap!.gamma).toBeCloseTo(3);
    expect(r.tonemap!.brightness).toBeCloseTo(6);
    expect(r.tonemap!.vibrancy).toBeCloseTo(0.5);
    expect(r.tonemap!.highlightPower).toBeCloseTo(0);
  });

  it('omits tonemap when both keyframes lack it', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1 });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.tonemap).toBeUndefined();
  });
});

// ── interpolate: carry-forward fields ───────────────────────────────────────

describe('interpolate — carry-forward fields', () => {
  it('carries density / spatialFilter / background from first keyframe', () => {
    const k0 = baseGenome({
      time: 0,
      density: { maxRad: 9, minRad: 0, curve: 0.4 },
      background: [0.1, 0.2, 0.3],
    });
    const k1 = baseGenome({ time: 1 });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.density).toEqual(k0.density);
    expect(r.background).toEqual(k0.background);
  });
});
