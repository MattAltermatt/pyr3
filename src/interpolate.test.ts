import { describe, expect, it } from 'vitest';
import { interpolate, pickKeyframes } from './interpolate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform, type ChannelCurves, type CurvePoint, type Symmetry } from './genome';
import { linear as linearVar, julian, V, type VariationIndex } from './variations';
import { PYRE_PALETTE } from './palette';
import { expandGenomeForGPU } from './symmetry';
import { type EasingCurve } from './easing';
import { resolveSegmentPermutation } from './interpolate';

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

  it('zero-magnitude column inherits the sibling column angle (#248)', () => {
    // x0 col0 = (0,1) → angle 90°, mag 1; col1 = (0,0) → zero-length, must
    // inherit col0's 90°. x1 col1 = (1,0) → angle 0°, mag 1.
    const x0: Xform = { ...id(), a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const x1: Xform = { ...id(), a: 0, b: 1, c: 0, d: 1, e: 0, f: 0 };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const a = anim(k0, k1, { interpolation_type: 'log' });
    const x = interpolate(a, 0.5).xforms[0]!;
    // With inheritance: col1 angle blends 90°→0° = 45°, mag 0→1 (linear) = 0.5,
    // so (b,e) = 0.5·(cos45, sin45) ≈ (0.3536, 0.3536). WITHOUT inheritance the
    // zero column's angle reads as 0°, giving (b,e) = (0.5, 0).
    expect(x.b).toBeCloseTo(0.35355, 4);
    expect(x.e).toBeCloseTo(0.35355, 4);
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

// ── interpolate: active flag carry-through (#260) ───────────────────────────
// An xform / variation deactivated in the editor (active:false → packer zeros
// its weight and skips dc_flag) must STAY deactivated across a keyframe tween.
// Dropping the flag silently re-activates the entry — and re-enables Direct
// Color recoloring for DC variations — mid-animation.

describe('interpolate — active flag (#260)', () => {
  const findVar = (g: Genome, xf: number, index: number) =>
    g.xforms[xf]!.variations.find((v) => v.index === index);

  it('keeps a variation inactive when active:false on both keyframes', () => {
    const off = (): Xform => ({
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
      weight: 1, color: 0, colorSpeed: 0.5,
      variations: [linearVar(1), { index: V.dc_linear, weight: 0.8, active: false }],
    });
    const k0 = baseGenome({ time: 0, xforms: [off()] });
    const k1 = baseGenome({ time: 1, xforms: [off()] });
    const r = interpolate(anim(k0, k1), 0.5);
    const dc = findVar(r, 0, V.dc_linear);
    expect(dc).toBeDefined();
    // Stays off: flagged inactive AND effective weight 0 (so the packer zeros
    // it and never sets dc_flag — no surprise recoloring mid-tween).
    expect(dc!.active).toBe(false);
    expect(dc!.weight).toBe(0);
  });

  it('keeps an xform inactive when active:false on both keyframes', () => {
    const off = (): Xform => ({
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
      weight: 0.7, color: 0, colorSpeed: 0.5, active: false,
      variations: [linearVar(1)],
    });
    const k0 = baseGenome({ time: 0, xforms: [id(), off()] });
    const k1 = baseGenome({ time: 1, xforms: [id(), off()] });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.xforms[1]!.active).toBe(false);
    expect(r.xforms[1]!.weight).toBe(0);
  });

  it('ramps a variation that activates between keyframes (off → on)', () => {
    const k0 = baseGenome({
      time: 0,
      xforms: [{ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
        variations: [linearVar(1), { index: V.dc_linear, weight: 0.8, active: false }] }],
    });
    const k1 = baseGenome({
      time: 1,
      xforms: [{ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
        variations: [linearVar(1), { index: V.dc_linear, weight: 0.8 }] }],
    });
    const r = interpolate(anim(k0, k1), 0.5);
    const dc = findVar(r, 0, V.dc_linear);
    expect(dc).toBeDefined();
    // Effective weight ramps from 0 (inactive endpoint) toward 0.8 → ~0.4 at mid.
    expect(dc!.weight).toBeCloseTo(0.4, 5);
    // Mid-tween it is genuinely becoming active — not flagged inactive.
    expect(dc!.active).not.toBe(false);
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

  it('interpolates continuous render fields when BOTH keyframes carry them (#248)', () => {
    const k0 = baseGenome({
      time: 0,
      quality: 10, oversample: 1,
      background: [0, 0, 0],
      size: { width: 100, height: 100 },
      spatialFilter: { radius: 1, shape: 'gaussian' },
      density: { maxRad: 9, minRad: 0, curve: 0.4 },
    });
    const k1 = baseGenome({
      time: 1,
      quality: 30, oversample: 3,
      background: [1, 1, 1],
      size: { width: 200, height: 300 },
      spatialFilter: { radius: 3, shape: 'gaussian' },
      density: { maxRad: 5, minRad: 0, curve: 0.6 },
    });
    const r = interpolate(anim(k0, k1), 0.5);
    expect(r.quality).toBeCloseTo(20);                       // 0.5·10 + 0.5·30
    expect(r.oversample).toBe(2);                            // round(0.5·1 + 0.5·3)
    expect(r.background).toEqual([0.5, 0.5, 0.5]);
    expect(r.size).toEqual({ width: 150, height: 200 });     // rounded INTERI
    expect(r.spatialFilter!.radius).toBeCloseTo(2);          // radius INTERPs
    expect(r.spatialFilter!.shape).toBe('gaussian');         // shape carry-forward
    expect(r.density!.maxRad).toBeCloseTo(7);                // 0.5·9 + 0.5·5
    expect(r.density!.curve).toBeCloseTo(0.5);               // 0.5·0.4 + 0.5·0.6
  });
});

// ── #224 segmentEasing ───────────────────────────────────────────────────────

describe('interpolate — segmentEasing (#224)', () => {
  const seg = (k0cx: number, k1cx: number) =>
    [baseGenome({ time: 0, cx: k0cx }), baseGenome({ time: 1, cx: k1cx })] as const;

  it('absent segmentEasing is byte-identical to linear (cx=5 at midpoint)', () => {
    const [k0, k1] = seg(0, 10);
    expect(interpolate(anim(k0, k1), 0.5).cx).toBeCloseTo(5);
  });

  it("an explicit 'linear' curve matches the absent default", () => {
    const [k0, k1] = seg(0, 10);
    const r = interpolate(anim(k0, k1, { segmentEasing: [{ kind: 'preset', name: 'linear' }] }), 0.5);
    expect(r.cx).toBeCloseTo(5);
  });

  it('easeIn pulls the midpoint toward k0 (eased c1 = 0.25 → cx = 2.5)', () => {
    const [k0, k1] = seg(0, 10);
    const r = interpolate(anim(k0, k1, { segmentEasing: [{ kind: 'preset', name: 'easeIn' }] }), 0.5);
    expect(r.cx).toBeCloseTo(2.5);
  });

  it('endpoint extrapolation (t>last, rawC1>1) skips easing', () => {
    const [k0, k1] = seg(0, 10);
    const plain = interpolate(anim(k0, k1), 1.5).cx;
    const eased = interpolate(anim(k0, k1, { segmentEasing: [{ kind: 'preset', name: 'easeIn' }] }), 1.5).cx;
    expect(eased).toBeCloseTo(plain);
    expect(eased).toBeCloseTo(15);
  });

  it('a short/sparse segmentEasing array treats missing entries as linear', () => {
    const [k0, k1] = seg(0, 10);
    expect(interpolate(anim(k0, k1, { segmentEasing: [] }), 0.5).cx).toBeCloseTo(5);
  });
});

// ── #225 segmentPermutation ──────────────────────────────────────────────────
describe('interpolate — segmentPermutation (#225)', () => {
  // Two keyframes whose xforms carry a distinguishing tag in `c` (affine
  // translate-x) so we can assert which source paired with which target.
  const tagged = (tags: number[], time: number): Genome =>
    baseGenome({
      time,
      xforms: tags.map((t) => ({
        a: 1, b: 0, c: t, d: 0, e: 1, f: 0,
        weight: 1, color: 0, colorSpeed: 0.5,
        variations: [linearVar(1)],
      })),
    });

  it('absent segmentPermutation is byte-identical to positional', () => {
    const k0 = tagged([10, 20, 30], 0);
    const k1 = tagged([11, 21, 31], 1);
    const positional = interpolate(anim(k0, k1), 0.5);
    const identity = interpolate(anim(k0, k1, { segmentPermutation: [[0, 1, 2]] }), 0.5);
    expect(identity.xforms.map((x) => x.c)).toEqual(positional.xforms.map((x) => x.c));
    expect(positional.xforms.map((x) => x.c)).toEqual([10.5, 20.5, 30.5]);
  });

  it('reverse permutation pairs A.x0↔B.x2, A.x1↔B.x1, A.x2↔B.x0', () => {
    const k0 = tagged([10, 20, 30], 0);
    const k1 = tagged([11, 21, 31], 1);
    const r = interpolate(anim(k0, k1, { segmentPermutation: [[2, 1, 0]] }), 0.5);
    // slot0: mean(A.x0=10, B.x2=31)=20.5 ; slot1: mean(20,21)=20.5 ; slot2: mean(30,11)=20.5
    expect(r.xforms.map((x) => x.c)).toEqual([20.5, 20.5, 20.5]);
  });

  it('non-self-inverse permutation ([1,2,0]) applies the correct gather direction', () => {
    // Distinct expected values pin the gather direction — a scattered (inverted)
    // impl would yield [15, 5, 10] instead. Anchor A all-zero so result = ½·B.
    const k0 = tagged([0, 0, 0], 0);
    const k1 = tagged([10, 20, 30], 1);
    const r = interpolate(anim(k0, k1, { segmentPermutation: [[1, 2, 0]] }), 0.5);
    // slot0 → aligned1.xforms[1]=20 → mean(0,20)=10
    // slot1 → aligned1.xforms[2]=30 → mean(0,30)=15
    // slot2 → aligned1.xforms[0]=10 → mean(0,10)=5
    expect(r.xforms.map((x) => x.c)).toEqual([10, 15, 5]);
  });

  it('sparse array: a missing entry for the active segment is positional', () => {
    const k0 = tagged([10, 20, 30], 0);
    const k1 = tagged([11, 21, 31], 1);
    const r = interpolate(anim(k0, k1, { segmentPermutation: [] }), 0.5);
    expect(r.xforms.map((x) => x.c)).toEqual([10.5, 20.5, 30.5]);
  });

  it('maps a real xform onto a padded slot → that xform fades out (weight→0)', () => {
    const k0 = tagged([10, 20], 0); // A: 2 real xforms, weight 1 each
    const k1 = baseGenome({ time: 1, xforms: [
      { a: 1, b: 0, c: 99, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5, variations: [linearVar(1)] },
    ] }); // B: 1 real xform → aligned length 2 (padded with zero-weight id)
    // perm=[1,0]: slot0 pairs A.x0 with B.aligned[1] (the padded zero-weight slot).
    const r = interpolate(anim(k0, k1, { segmentPermutation: [[1, 0]] }), 0.5);
    expect(r.xforms[0]!.weight).toBeCloseTo(0.5); // ramps toward 0 over the segment
    expect(r.xforms[1]!.c).toBeCloseTo((20 + 99) / 2); // A.x1 ↔ B's real xform
  });

  it('permutation does not disturb finalxform blending', () => {
    const finalA: Xform = { a: 1, b: 0, c: 5, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5, variations: [linearVar(1)] };
    const finalB: Xform = { a: 1, b: 0, c: 7, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5, variations: [linearVar(1)] };
    const k0 = { ...tagged([10, 20], 0), finalxform: finalA };
    const k1 = { ...tagged([11, 21], 1), finalxform: finalB };
    const r = interpolate(anim(k0, k1, { segmentPermutation: [[1, 0]] }), 0.5);
    expect(r.finalxform).toBeDefined();
    expect(r.finalxform!.c).toBeCloseTo(6); // mean(5,7) — unaffected by xform-array permutation
  });

  it('invalid permutation (wrong length) degrades to positional', () => {
    const k0 = tagged([10, 20, 30], 0);
    const k1 = tagged([11, 21, 31], 1);
    // [0,1] over 3 aligned xforms extends to the identity [0,1,2] (#412) ⇒ positional.
    expect(interpolate(anim(k0, k1, { segmentPermutation: [[0, 1]] }), 0.5).xforms.map((x) => x.c))
      .toEqual([10.5, 20.5, 30.5]);
  });

  it('#412 — a short permutation applies on a SYMMETRY-baked flame (identity tail)', () => {
    // bakeSymmetryXforms (#291) grows the xform count past the original 2 before
    // the blend, so a length-2 UI permutation must still reorder the originals
    // (the appended symmetry xforms stay positional). Regression for the bug
    // where isPermutation(perm, alignedLen) silently dropped the perm.
    const sym: Symmetry = { kind: 'rotational', n: 4 };
    const k0: Genome = { ...tagged([10, 20], 0), symmetry: sym };
    const k1: Genome = { ...tagged([11, 21], 1), symmetry: sym };
    const positional = interpolate(anim(k0, k1), 0.5);
    const swapped = interpolate(anim(k0, k1, { segmentPermutation: [[1, 0]] }), 0.5);
    // Symmetry must actually have grown the count (else this proves nothing).
    expect(positional.xforms.length).toBeGreaterThan(2);
    // Original slot0/slot1 morph differently under the swap:
    //   positional slot0 = mean(A.x0=10, B.x0=11) = 10.5
    //   swapped    slot0 = mean(A.x0=10, B.x1=21) = 15.5
    expect(positional.xforms[0]!.c).toBeCloseTo(10.5);
    expect(swapped.xforms[0]!.c).toBeCloseTo(15.5);
    expect(swapped.xforms[1]!.c).toBeCloseTo(15.5); // mean(A.x1=20, B.x0=11)
    expect(swapped.xforms[0]!.c).not.toBeCloseTo(positional.xforms[0]!.c);
  });

  it('invalid permutation (duplicate target) degrades to positional', () => {
    const k0 = tagged([10, 20, 30], 0);
    const k1 = tagged([11, 21, 31], 1);
    expect(interpolate(anim(k0, k1, { segmentPermutation: [[0, 0, 1]] }), 0.5).xforms.map((x) => x.c))
      .toEqual([10.5, 20.5, 30.5]);
  });

  it('invalid permutation (out-of-range index) degrades to positional', () => {
    const k0 = tagged([10, 20, 30], 0);
    const k1 = tagged([11, 21, 31], 1);
    expect(interpolate(anim(k0, k1, { segmentPermutation: [[0, 1, 5]] }), 0.5).xforms.map((x) => x.c))
      .toEqual([10.5, 20.5, 30.5]);
  });
});

// ── #213 Part 3: flipped-identity padding ────────────────────────────────────
describe('interpolate — flipped-identity padding (#213)', () => {
  // pyr3 indices: spherical=2, polar=5, julian=14, ngon=39, juliascope=48,
  // wedge_sph=89, wedge_julia=96.
  const withVar = (idx: number): Xform => ({
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
    variations: [{ index: idx as VariationIndex, weight: 1 }],
  });

  it('pads flipped identity when other side has spherical (log interp)', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });                 // short side
    const k1 = baseGenome({ time: 1, xforms: [id(), withVar(2)] });     // longer (spherical at idx 1)
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0); // fully k0 → padded slot
    expect(r.xforms[1]!.a).toBeCloseTo(-1);
    expect(r.xforms[1]!.e).toBeCloseTo(-1);
  });

  it('pads flipped identity for each of the 7 listed variations (log)', () => {
    for (const idx of [2, 5, 14, 39, 48, 89, 96]) {
      const k0 = baseGenome({ time: 0, xforms: [id()] });
      const k1 = baseGenome({ time: 1, xforms: [id(), withVar(idx)] });
      const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0);
      expect(r.xforms[1]!.a).toBeCloseTo(-1);
      expect(r.xforms[1]!.e).toBeCloseTo(-1);
    }
  });

  it('flips when a listed variation is NOT in slot 0 (scans all slots)', () => {
    // spherical(2) listed second after linear — flam3 checks any positive slot.
    const xf: Xform = {
      a: 1, b: 0, c: 0, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
      variations: [linearVar(0.5), { index: 2 as VariationIndex, weight: 0.5 }],
    };
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1 = baseGenome({ time: 1, xforms: [id(), xf] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0);
    expect(r.xforms[1]!.a).toBeCloseTo(-1);
    expect(r.xforms[1]!.e).toBeCloseTo(-1);
  });

  it('pads plain identity when other side has no listed variation', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1 = baseGenome({ time: 1, xforms: [id(), id()] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0);
    expect(r.xforms[1]!.a).toBeCloseTo(1);
    expect(r.xforms[1]!.e).toBeCloseTo(1);
  });

  it('pads plain identity under linear interp even with spherical (flipped is log-only)', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1 = baseGenome({ time: 1, xforms: [id(), withVar(2)] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0);
    expect(r.xforms[1]!.a).toBeCloseTo(1);
    expect(r.xforms[1]!.e).toBeCloseTo(1);
  });
});

// ── #213 Part 2: asymmetric wind refangles ───────────────────────────────────
describe('interpolate — asymmetric wind (#213)', () => {
  // Pure rotation by `deg`: col0 = (a,d) = (cosθ, sinθ) → angle θ.
  const rot = (deg: number, animate?: number): Xform => {
    const th = (deg * Math.PI) / 180;
    const x: Xform = {
      a: Math.cos(th), b: -Math.sin(th), c: 0, d: Math.sin(th), e: Math.cos(th), f: 0,
      weight: 1, color: 0, colorSpeed: 0.5, variations: [linearVar(1)],
    };
    if (animate !== undefined) x.animate = animate;
    return x;
  };

  it('symmetric pair (both animated) takes the short arc — no wind', () => {
    const k0 = baseGenome({ time: 0, xforms: [rot(10, 1)] });
    const k1 = baseGenome({ time: 1, xforms: [rot(-10, 1)] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0.5).xforms[0]!;
    // short arc through 0° → col0 ≈ (1, 0)
    expect(r.a).toBeCloseTo(1, 3);
    expect(r.d).toBeCloseTo(0, 3);
  });

  it('asymmetric pair (one animate=0) winds the long way via the reference angle', () => {
    const k0 = baseGenome({ time: 0, xforms: [rot(10, 1)] });   // animated
    const k1 = baseGenome({ time: 1, xforms: [rot(-10, 0)] });  // stationary
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0.5).xforms[0]!;
    // wind constrains both angles into [refang, refang+2π] → mid ≈ 180° → col0 ≈ (-1, 0)
    expect(r.a).toBeCloseTo(-1, 3);
    expect(r.d).toBeCloseTo(0, 3);
  });

  it('final xform is exempt from wind (takes the short arc)', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()], finalxform: rot(10, 1) });
    const k1 = baseGenome({ time: 1, xforms: [id()], finalxform: rot(-10, 0) });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0.5);
    expect(r.finalxform!.a).toBeCloseTo(1, 3); // NOT -1
  });
});

// ── #213 Part 1: Catmull-Rom smooth interp ───────────────────────────────────
import { catmullRomWeights } from './interpolate';

describe('catmullRomWeights (#213)', () => {
  it('sums to 1 for all t', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(catmullRomWeights(t).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
  });
  it('passes through inner control points at t=0 and t=1', () => {
    expect(catmullRomWeights(0)).toEqual([0, 1, 0, 0]);
    expect(catmullRomWeights(1)).toEqual([0, 0, 1, 0]);
  });
});

describe('interpolate — Catmull-Rom smooth (#213)', () => {
  const line = (cx: number, t: number): Genome => baseGenome({ time: t, cx });
  const ks = () => [line(0, 0), line(10, 1), line(40, 2), line(90, 3)];
  const smooth = (overrides = {}) => ({ interpolation: 'smooth' as const, keyframes: ks(), ...overrides });

  it('passes through inner keyframes at segment endpoints', () => {
    const a = anim(ks()[0]!, ks()[1]!, smooth());
    expect(interpolate(a, 1).cx).toBeCloseTo(10); // keyframes[1]
    expect(interpolate(a, 2).cx).toBeCloseTo(40); // keyframes[2]
  });

  it('smooth on the first segment falls back to linear', () => {
    const a = anim(ks()[0]!, ks()[1]!, smooth());
    expect(interpolate(a, 0.5).cx).toBeCloseTo(5); // linear midpoint of [0,10]
  });

  it('smooth on the last segment falls back to linear', () => {
    const a = anim(ks()[0]!, ks()[1]!, smooth());
    expect(interpolate(a, 2.5).cx).toBeCloseTo(65); // linear midpoint of [40,90]
  });

  it('linear interpolation is unaffected (regression guard)', () => {
    const a = anim(ks()[0]!, ks()[1]!, { interpolation: 'linear', keyframes: ks() });
    expect(interpolate(a, 1.5).cx).toBeCloseTo(25); // pure linear midpoint of [10,40]
  });

  it('mid-segment smooth value differs from linear (curve is cubic)', () => {
    const lin = interpolate(anim(ks()[0]!, ks()[1]!, { interpolation: 'linear', keyframes: ks() }), 1.5).cx;
    const sm = interpolate(anim(ks()[0]!, ks()[1]!, smooth()), 1.5).cx;
    expect(sm).toBeCloseTo(22.5); // cmc(0.5)·[0,10,40,90]
    expect(sm).not.toBeCloseTo(lin, 2);
  });
});

// ── #291: symmetry must blend with the morph, not be carried from k0 only ────
describe('#291 symmetry is baked before interpolation (direction-symmetric)', () => {
  // A flame with 4-fold rotational symmetry and one whose only difference is
  // that it has none. Morphing between them must behave the SAME in either
  // direction — today symmetry is copied from k0 only, so the result depends
  // on which flame is first (the spiral→flower "black frame" bug).
  const plain = (time: number): Genome => baseGenome({ name: 'plain', time });
  const symm = (time: number): Genome =>
    baseGenome({ name: 'symm', time, symmetry: { kind: 'rotational', n: 4 } });

  it('carries symmetry into the mid-morph regardless of direction', () => {
    const ab = expandGenomeForGPU(interpolate(anim(plain(0), symm(1)), 0.5));
    const ba = expandGenomeForGPU(interpolate(anim(symm(0), plain(1)), 0.5));
    // Same geometry at the symmetric midpoint → same packed xform count both ways.
    expect(ab.xforms.length).toBe(ba.xforms.length);
    // And the n=4 rotation xforms must actually be present mid-morph (not dropped).
    expect(ab.xforms.length).toBeGreaterThan(plain(0).xforms.length);
  });

  it('clears the symmetry field on the interpolated genome (baked, not carried)', () => {
    const mid = interpolate(anim(symm(0), plain(1)), 0.5);
    // Symmetry is expanded into xforms during interpolation; the declarative
    // field must not survive (else the packer would double-apply it).
    expect(mid.symmetry).toBeUndefined();
  });
});

// ── #292: color grading (channelCurves + hslAdjust) must interpolate ─────────
// Same bug class as #291 — structured genome fields silently dropped by
// interpolate(), so an animated graded flame loses its grading. These fields
// FADE from/to identity when one keyframe lacks them (not carry-forward), so
// the grading ramps in/out rather than popping.
describe('#292 hslAdjust interpolation', () => {
  const idAdj = { hue: 0, sat: 100, light: 0 };

  it('blends hue/sat/light when both keyframes carry it', () => {
    const k0 = baseGenome({ time: 0, hslAdjust: { hue: 0, sat: 100, light: 0 } });
    const k1 = baseGenome({ time: 1, hslAdjust: { hue: 60, sat: 200, light: 50 } });
    const mid = interpolate(anim(k0, k1), 0.5);
    expect(mid.hslAdjust).toBeDefined();
    expect(mid.hslAdjust!.hue).toBeCloseTo(30);
    expect(mid.hslAdjust!.sat).toBeCloseTo(150);
    expect(mid.hslAdjust!.light).toBeCloseTo(25);
  });

  it('fades from identity when only the second keyframe carries it', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1, hslAdjust: { hue: 60, sat: 200, light: 50 } });
    const mid = interpolate(anim(k0, k1), 0.5);
    // Halfway from identity {0,100,0} to {60,200,50}.
    expect(mid.hslAdjust!.hue).toBeCloseTo(30);
    expect(mid.hslAdjust!.sat).toBeCloseTo(150);
    expect(mid.hslAdjust!.light).toBeCloseTo(25);
  });

  it('takes the shorter arc across the ±180 hue wrap', () => {
    const k0 = baseGenome({ time: 0, hslAdjust: { ...idAdj, hue: 170 } });
    const k1 = baseGenome({ time: 1, hslAdjust: { ...idAdj, hue: -170 } });
    const mid = interpolate(anim(k0, k1), 0.5);
    // 170 → -170 is a 20° hop across 180, not a 340° sweep through 0.
    expect(Math.abs(mid.hslAdjust!.hue)).toBeCloseTo(180);
  });

  it('is direction-symmetric: interp(A→B, s) === interp(B→A, 1−s)', () => {
    const a = { hue: -40, sat: 80, light: -30 };
    const b = { hue: 50, sat: 160, light: 40 };
    const ab = interpolate(anim(baseGenome({ time: 0, hslAdjust: a }), baseGenome({ time: 1, hslAdjust: b })), 0.3);
    const ba = interpolate(anim(baseGenome({ time: 0, hslAdjust: b }), baseGenome({ time: 1, hslAdjust: a })), 0.7);
    expect(ab.hslAdjust!.hue).toBeCloseTo(ba.hslAdjust!.hue);
    expect(ab.hslAdjust!.sat).toBeCloseTo(ba.hslAdjust!.sat);
    expect(ab.hslAdjust!.light).toBeCloseTo(ba.hslAdjust!.light);
  });

  it('produces no hslAdjust when neither keyframe carries it', () => {
    const mid = interpolate(anim(baseGenome({ time: 0 }), baseGenome({ time: 1 })), 0.5);
    expect(mid.hslAdjust).toBeUndefined();
  });
});

describe('#292 channelCurves interpolation', () => {
  const idPts = (): CurvePoint[] => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const curves = (override: Partial<ChannelCurves> = {}): ChannelCurves => ({
    composite: idPts(), r: idPts(), g: idPts(), b: idPts(), luma: idPts(), ...override,
  });
  // A composite curve lifting the midtones: at x=0.5 it reads y≈0.8.
  const lifted: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }];

  it('blends the curve y per shared x when both keyframes carry it', () => {
    const k0 = baseGenome({ time: 0, channelCurves: curves() });
    const k1 = baseGenome({ time: 1, channelCurves: curves({ composite: lifted }) });
    const mid = interpolate(anim(k0, k1), 0.5);
    expect(mid.channelCurves).toBeDefined();
    const comp = mid.channelCurves!.composite;
    const at = (x: number) => comp.find((p) => Math.abs(p.x - x) < 1e-9)!.y;
    // identity(0.5)=0.5 blended with lifted(0.5)=0.8 → 0.65.
    expect(at(0.5)).toBeCloseTo(0.65);
    expect(at(0)).toBeCloseTo(0);
    expect(at(1)).toBeCloseTo(1);
  });

  it('fades from identity when only the second keyframe carries it', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1, channelCurves: curves({ composite: lifted }) });
    const mid = interpolate(anim(k0, k1), 0.5);
    const comp = mid.channelCurves!.composite;
    const at = (x: number) => comp.find((p) => Math.abs(p.x - x) < 1e-9)!.y;
    // Halfway from identity(0.5)=0.5 to lifted(0.5)=0.8 → 0.65.
    expect(at(0.5)).toBeCloseTo(0.65);
  });

  it('is direction-symmetric: interp(A→B, s) === interp(B→A, 1−s)', () => {
    const a = curves({ composite: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.3 }, { x: 1, y: 0.9 }] });
    const b = curves({ composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] });
    const ab = interpolate(anim(baseGenome({ time: 0, channelCurves: a }), baseGenome({ time: 1, channelCurves: b })), 0.3);
    const ba = interpolate(anim(baseGenome({ time: 0, channelCurves: b }), baseGenome({ time: 1, channelCurves: a })), 0.7);
    const yAt = (g: Genome, x: number) =>
      g.channelCurves!.composite.find((p) => Math.abs(p.x - x) < 1e-9)!.y;
    for (const x of [0, 0.5, 1]) expect(yAt(ab, x)).toBeCloseTo(yAt(ba, x));
  });

  it('produces no channelCurves when neither keyframe carries it', () => {
    const mid = interpolate(anim(baseGenome({ time: 0 }), baseGenome({ time: 1 })), 0.5);
    expect(mid.channelCurves).toBeUndefined();
  });
});

// ── #292 guardrail: field-completeness — every Genome field has an explicit
// interpolation disposition. Adding a new field to the Genome interface without
// a decision here is a COMPILE error (the Record<keyof Genome, …> below fails to
// typecheck on a missing key) — closing the "silently dropped structured field"
// bug class for good. The runtime check asserts the disposition map and the
// list of fields interpolate() actually emits stay in lockstep.
describe('#292 guardrail: interpolate handles every Genome field', () => {
  // Disposition for each Genome field. 'structural' = re-derived (name/time/
  // xforms/scale/cx/cy/palette); 'blend' = numerically interpolated; 'carry' =
  // intentionally carried from a dominant keyframe; 'bake' = expanded into
  // xforms before blending. The Record<keyof Genome, …> type forces this map to
  // be EXHAUSTIVE — a new Genome field breaks the build until it lands here.
  type Disposition = 'structural' | 'blend' | 'carry' | 'bake';
  const DISPOSITION = {
    name: 'structural', nick: 'carry', xforms: 'structural', scale: 'blend',
    cx: 'blend', cy: 'blend', palette: 'blend', finalxform: 'blend',
    symmetry: 'bake', density: 'blend', tonemap: 'blend', rotate: 'blend',
    quality: 'blend', oversample: 'blend', size: 'blend', spatialFilter: 'blend',
    background: 'blend', paletteMode: 'carry', channelCurves: 'blend',
    hslAdjust: 'blend', time: 'structural',
  } satisfies Record<keyof Genome, Disposition>;

  it('emits every grading/structured field for a fully-populated A→B blend', () => {
    const full = (time: number): Genome => baseGenome({
      time,
      channelCurves: {
        composite: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        r: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        g: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        b: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        luma: [{ x: 0, y: 0 }, { x: 1, y: 0.9 }],
      },
      hslAdjust: { hue: 20, sat: 120, light: 10 },
    });
    const mid = interpolate(anim(full(0), full(1)), 0.5);
    // Both grading fields survive the blend (the #292 regression target).
    expect(mid.channelCurves).toBeDefined();
    expect(mid.hslAdjust).toBeDefined();
    // The disposition map must name exactly the Genome keys — no orphan, none missing.
    expect(Object.keys(DISPOSITION).sort()).toEqual(
      (['background', 'channelCurves', 'cx', 'cy', 'density', 'finalxform', 'hslAdjust',
        'name', 'nick', 'oversample', 'palette', 'paletteMode', 'quality', 'rotate',
        'scale', 'size', 'spatialFilter', 'symmetry', 'time', 'tonemap', 'xforms']),
    );
  });
});

// ── #414 cross-feature interaction matrix ────────────────────────────────────
// #412 lived because features were tested in isolation — no test combined the
// data-transforming passes that touch the same xform array. This matrix crosses
// symmetry × permutation, motion × permutation, and easing × symmetry. Through-
// line invariant: a valid NON-identity permutation MUST change a distinct-xform
// flame's mid-transition genome (and an identity permutation must NOT).
describe('interpolate — cross-feature interaction matrix (#414)', () => {
  // Distinct-xform flames: 3 xforms tagged in `c` so a reorder is observable.
  const tagged = (tags: number[], time: number): Genome =>
    baseGenome({
      time,
      xforms: tags.map((t) => ({
        a: 1, b: 0, c: t, d: 0, e: 1, f: 0,
        weight: 1, color: 0, colorSpeed: 0.5,
        variations: [linearVar(1)],
      })),
    });
  const withSym = (g: Genome, sym?: Symmetry): Genome => (sym ? { ...g, symmetry: sym } : g);
  const cs = (g: Genome): number[] => g.xforms.map((x) => x.c);
  // The 3 ORIGINAL slots; symmetry appends positional-paired slots after them.
  const orig = (arr: number[]): number[] => arr.slice(0, 3);

  const evalC = (overrides: Partial<Animation>, sym: Symmetry | undefined, t = 0.5): number[] =>
    cs(interpolate(anim(withSym(tagged([10, 20, 30], 0), sym), withSym(tagged([11, 21, 31], 1), sym), overrides), t));

  const SYMS: { name: string; sym?: Symmetry }[] = [
    { name: 'none', sym: undefined },
    { name: 'rotational n=4', sym: { kind: 'rotational', n: 4 } },
    { name: 'dihedral n=3', sym: { kind: 'dihedral', n: 3 } },
  ];
  const PERMS: { name: string; perm: number[] }[] = [
    { name: 'identity', perm: [0, 1, 2] },
    { name: 'swap', perm: [1, 0, 2] },
    { name: 'reverse', perm: [2, 1, 0] },
  ];

  // ── Matrix A: symmetry × permutation ──────────────────────────────────────
  describe.each(SYMS)('symmetry=$name', ({ sym }) => {
    it.each(PERMS)('perm=$name upholds the invariant', ({ name, perm }) => {
      const positional = evalC({}, sym);
      const permuted = evalC({ segmentPermutation: [perm] }, sym);
      if (name === 'identity') {
        expect(orig(permuted)).toEqual(orig(positional));
      } else {
        expect(orig(permuted)).not.toEqual(orig(positional));
      }
    });

    it('symmetry grows the baked xform count (guard — else the test proves nothing)', () => {
      const len = evalC({}, sym).length;
      if (sym) expect(len).toBeGreaterThan(3);
      else expect(len).toBe(3);
    });
  });

  // ── Matrix B: motion × permutation ────────────────────────────────────────
  // HILL overlay (motion_func 3) peaks at t=0.5, so motion is observable exactly
  // at mid — a sin/triangle overlay would zero-out there (sin(π)=0, triangle(0.5)=0).
  const motionXform = (c: number): Xform => ({
    a: 1, b: 0, c, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
    variations: [linearVar(1)],
    motion: [{
      a: 0, b: 0, c: 5, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0,
      variations: [], motion_func: 3, motion_freq: 1,
    }],
  });
  const taggedMotion = (tags: number[], time: number): Genome =>
    baseGenome({ time, xforms: tags.map((t) => motionXform(t)) });
  const motionMid = (overrides: Partial<Animation>): number[] =>
    cs(interpolate(anim(taggedMotion([10, 20, 30], 0), taggedMotion([11, 21, 31], 1), overrides), 0.5));
  const plainMid = (overrides: Partial<Animation>): number[] =>
    cs(interpolate(anim(tagged([10, 20, 30], 0), tagged([11, 21, 31], 1), overrides), 0.5));

  describe.each(PERMS)('motion × perm=$name', ({ name, perm }) => {
    it('motion shifts the blended xforms (motion not suppressed by the permutation)', () => {
      expect(motionMid({ segmentPermutation: [perm] })).not.toEqual(plainMid({ segmentPermutation: [perm] }));
    });

    it('permutation still changes mid while motion is active', () => {
      const positionalMotion = motionMid({});
      const permutedMotion = motionMid({ segmentPermutation: [perm] });
      if (name === 'identity') {
        expect(permutedMotion).toEqual(positionalMotion);
      } else {
        expect(permutedMotion).not.toEqual(positionalMotion);
      }
    });
  });

  // ── Matrix C: easing × symmetry ───────────────────────────────────────────
  // Evaluated OFF-mid at t=0.3: symmetric easings (easeInOut, a symmetric bezier)
  // both map 0.5→0.5, so easing is a no-op at exactly mid and would prove nothing.
  const EASINGS: { name: string; easing?: EasingCurve }[] = [
    { name: 'linear', easing: undefined },
    { name: 'easeInOut', easing: { kind: 'preset', name: 'easeInOut' } },
    { name: 'cubicBezier', easing: { kind: 'cubicBezier', x1: 0.2, y1: 0, x2: 0.8, y2: 1 } },
  ];
  const SYMS_C = SYMS.slice(0, 2); // none, rotational

  describe.each(SYMS_C)('easing × symmetry=$name', ({ sym }) => {
    it.each(EASINGS)('easing=$name: count stable, easing observable, invariant intact', ({ name, easing }) => {
      const T = 0.3;
      const linear = evalC({}, sym, T);
      const eased = evalC(easing ? { segmentEasing: [easing] } : {}, sym, T);

      // Symmetry-baked count is stable regardless of the easing curve.
      expect(eased.length).toBe(linear.length);

      // Easing reshapes the blend time (linear is the no-op baseline).
      if (name === 'linear') {
        expect(eased).toEqual(linear);
      } else {
        expect(eased).not.toEqual(linear);
      }

      // Through-line invariant holds under easing × symmetry too.
      const positional = evalC(easing ? { segmentEasing: [easing] } : {}, sym, T);
      const permuted = evalC(
        easing ? { segmentEasing: [easing], segmentPermutation: [[1, 0, 2]] } : { segmentPermutation: [[1, 0, 2]] },
        sym, T,
      );
      expect(orig(permuted)).not.toEqual(orig(positional));
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// #393A CHARACTERIZATION NET — pins the CURRENT 2-keyframe interpolate() output
// so the upcoming "collapse 2-kf helpers onto their N-keyframe twins" refactor
// cannot silently change behavior. Every assertion below MUST pass against the
// CURRENT code (it characterizes existing behavior, it does not change it). Off-
// midpoint t (t=0.3) with ASYMMETRIC inputs is used throughout — at t=0.5 with
// symmetric inputs many effects cancel and the tests would not discriminate.
// ═════════════════════════════════════════════════════════════════════════════

// 1 ── xaos two-sided per-cell interp (interpolate.ts:476-479 / interpolateXaos)
describe('#393A characterization — xaos interp', () => {
  it('two-sided per-cell lerp at t=0.3; shorter side padded with 1.0', () => {
    // k0 xaos = [0, 2, 4] (len 3); k1 xaos = [10, 20] (len 2, pad slot2 → 1.0).
    // At t=0.3: c0=0.7, c1=0.3.
    //   cell0: 0.7·0  + 0.3·10 = 3.0
    //   cell1: 0.7·2  + 0.3·20 = 7.4
    //   cell2: 0.7·4  + 0.3·1  = 3.1   (k1 cell2 padded to 1)
    const x0: Xform = { ...id(), xaos: [0, 2, 4] };
    const x1: Xform = { ...id(), xaos: [10, 20] };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3);
    const xaos = r.xforms[0]!.xaos!;
    expect(xaos).toHaveLength(3);
    expect(xaos[0]!).toBeCloseTo(3.0);
    expect(xaos[1]!).toBeCloseTo(7.4);
    expect(xaos[2]!).toBeCloseTo(3.1);
  });

  it('all-ones result → xaos field undefined', () => {
    // Both keyframes all-ones → blend is all-ones → identity xaos dropped.
    const x0: Xform = { ...id(), xaos: [1, 1] };
    const x1: Xform = { ...id(), xaos: [1, 1] };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3);
    expect(r.xforms[0]!.xaos).toBeUndefined();
  });

  it('absent on both keyframes → xaos field undefined', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1 = baseGenome({ time: 1, xforms: [id()] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3);
    expect(r.xforms[0]!.xaos).toBeUndefined();
  });
});

// 2 ── palette 'sweep' mode (interpolate.ts:691-704). The cut is at
// floor(256·c0)? No — the code picks lut0 for `i < PALETTE_SIZE * c0`, where
// PALETTE_SIZE=256 and at t=0.3 c0=0.7 → cut at i < 179.2 → indices 0..179 from
// k0, 180..255 from k1. (NOTE the prompt said floor(256·0.7)=179 → stops[0..178]
// from k0; the actual boundary is `i < 179.2`, i.e. i=179 is ALSO from k0. We
// pin the CURRENT behavior below.)
describe('#393A characterization — palette sweep mode', () => {
  // Solid single-color palettes so each per-index region is unambiguous.
  const solid = (name: string, r: number, g: number, b: number) => ({
    name, stops: [{ t: 0, r, g, b }, { t: 1, r, g, b }],
  });
  const red = () => solid('red', 1, 0, 0);
  const blue = () => solid('blue', 0, 0, 1);

  const sweepAt = (t: number) => {
    const k0 = baseGenome({ time: 0, palette: red() });
    const k1 = baseGenome({ time: 1, palette: blue() });
    return interpolate(anim(k0, k1, { palette_interpolation: 'sweep' }), t).palette.stops;
  };

  it('t=0.3: low indices from k0 (red), high indices from k1 (blue); cut near 179', () => {
    const stops = sweepAt(0.3);
    // c0 = 0.7 → src = lut0 when i < 256·0.7 = 179.2 → i=179 still k0, i=180 → k1.
    expect(stops[0]!.r).toBeCloseTo(1); expect(stops[0]!.b).toBeCloseTo(0);   // red
    expect(stops[178]!.r).toBeCloseTo(1); expect(stops[178]!.b).toBeCloseTo(0); // red
    expect(stops[179]!.r).toBeCloseTo(1); expect(stops[179]!.b).toBeCloseTo(0); // red (i<179.2)
    expect(stops[180]!.r).toBeCloseTo(0); expect(stops[180]!.b).toBeCloseTo(1); // blue
    expect(stops[255]!.r).toBeCloseTo(0); expect(stops[255]!.b).toBeCloseTo(1); // blue
  });

  it('t=0 (c0=1): every stop from k0 (red)', () => {
    const stops = sweepAt(0);
    expect(stops[0]!.r).toBeCloseTo(1);
    expect(stops[255]!.r).toBeCloseTo(1);
    expect(stops[255]!.b).toBeCloseTo(0);
  });

  it('t=0.5 (c0=0.5): split at index 128 (i<128 red, i>=128 blue)', () => {
    const stops = sweepAt(0.5);
    expect(stops[127]!.r).toBeCloseTo(1); expect(stops[127]!.b).toBeCloseTo(0); // red
    expect(stops[128]!.r).toBeCloseTo(0); expect(stops[128]!.b).toBeCloseTo(1); // blue
  });
});

// 3 ── palette 'hsv_circular' mode (interpolate.ts:735-747). red→blue at t=0.3
// must take the SHORT hue arc (red↔blue is a 4/6 vs 2/6 wheel gap; the ±6
// correction picks the short way). We pin that stops[0] stays reddish at t=0.3
// (r > 0.5), i.e. NOT the long-arc purple, and identical palettes → identity.
describe('#393A characterization — palette hsv_circular mode', () => {
  const solid = (name: string, r: number, g: number, b: number) => ({
    name, stops: [{ t: 0, r, g, b }, { t: 1, r, g, b }],
  });

  it('red→blue at t=0.3 takes the short arc (stops[0].r stays > 0.5)', () => {
    const k0 = baseGenome({ time: 0, palette: solid('red', 1, 0, 0) });
    const k1 = baseGenome({ time: 1, palette: solid('blue', 0, 0, 1) });
    const r = interpolate(anim(k0, k1, { palette_interpolation: 'hsv_circular' }), 0.3);
    expect(r.palette.stops[0]!.r).toBeGreaterThan(0.5);
  });

  it('identical palettes → identity (stops match the source color)', () => {
    const k0 = baseGenome({ time: 0, palette: solid('red', 1, 0, 0) });
    const k1 = baseGenome({ time: 1, palette: solid('red', 1, 0, 0) });
    const r = interpolate(anim(k0, k1, { palette_interpolation: 'hsv_circular' }), 0.3);
    expect(r.palette.stops[0]!.r).toBeCloseTo(1, 5);
    expect(r.palette.stops[0]!.g).toBeCloseTo(0, 5);
    expect(r.palette.stops[0]!.b).toBeCloseTo(0, 5);
  });
});

// 4 ── post-affine interp (interpolate.ts:439-461). Result-identity → post
// omitted; identity-on-both → no post; post on one side only → interp vs identity.
describe('#393A characterization — post-affine interp', () => {
  const post = (a: number, b: number, c: number, d: number, e: number, f: number) => ({ a, b, c, d, e, f });

  it('non-identity post on both → interp at t=0.3 (linear interp_type)', () => {
    // c0=0.7, c1=0.3.  post0=(2,0,1,0,2,1), post1=(4,0,3,0,4,3).
    //   a: 0.7·2 + 0.3·4 = 2.6 ; c: 0.7·1 + 0.3·3 = 1.6
    //   e: 0.7·2 + 0.3·4 = 2.6 ; f: 0.7·1 + 0.3·3 = 1.6
    const x0: Xform = { ...id(), post: post(2, 0, 1, 0, 2, 1) };
    const x1: Xform = { ...id(), post: post(4, 0, 3, 0, 4, 3) };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!;
    expect(r.post).toBeDefined();
    expect(r.post!.a).toBeCloseTo(2.6);
    expect(r.post!.c).toBeCloseTo(1.6);
    expect(r.post!.e).toBeCloseTo(2.6);
    expect(r.post!.f).toBeCloseTo(1.6);
  });

  it('identity post on both → no post field', () => {
    const x0: Xform = { ...id(), post: post(1, 0, 0, 0, 1, 0) };
    const x1: Xform = { ...id(), post: post(1, 0, 0, 0, 1, 0) };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!;
    expect(r.post).toBeUndefined();
  });

  it('post on k0 only → interp against identity at t=0.3', () => {
    // post0=(2,0,4,0,2,0), post1 absent → IDENTITY_AFFINE (1,0,0,0,1,0).
    //   a: 0.7·2 + 0.3·1 = 1.7 ; c: 0.7·4 + 0.3·0 = 2.8 ; e: 0.7·2 + 0.3·1 = 1.7
    const x0: Xform = { ...id(), post: post(2, 0, 4, 0, 2, 0) };
    const x1: Xform = { ...id() };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!;
    expect(r.post).toBeDefined();
    expect(r.post!.a).toBeCloseTo(1.7);
    expect(r.post!.c).toBeCloseTo(2.8);
    expect(r.post!.e).toBeCloseTo(1.7);
  });

  it('result lands on identity (post on k0, k1 identity, t=1) → post omitted', () => {
    // At t=1 fully k1 (identity post) → interp == identity → field dropped.
    const x0: Xform = { ...id(), post: post(2, 0, 4, 0, 2, 0) };
    const x1: Xform = { ...id() };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 1).xforms[0]!;
    expect(r.post).toBeUndefined();
  });
});

// 5 ── xform opacity (interpolate.ts:426 / :471). Lerps; result==1.0 suppressed;
// absent-both suppressed.
describe('#393A characterization — xform opacity', () => {
  it('lerps at t=0.3 (0.2 → 0.7 → 0.35)', () => {
    // c0=0.7, c1=0.3 → 0.7·0.2 + 0.3·0.7 = 0.14 + 0.21 = 0.35.
    const x0: Xform = { ...id(), opacity: 0.2 };
    const x1: Xform = { ...id(), opacity: 0.7 };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!;
    expect(r.opacity).toBeCloseTo(0.35);
  });

  it('result == 1.0 → opacity field suppressed', () => {
    const x0: Xform = { ...id(), opacity: 1 };
    const x1: Xform = { ...id(), opacity: 1 };
    const k0 = baseGenome({ time: 0, xforms: [x0] });
    const k1 = baseGenome({ time: 1, xforms: [x1] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!;
    expect(r.opacity).toBeUndefined();
  });

  it('absent on both keyframes → opacity field suppressed (defaults to 1)', () => {
    const k0 = baseGenome({ time: 0, xforms: [id()] });
    const k1 = baseGenome({ time: 1, xforms: [id()] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!;
    expect(r.opacity).toBeUndefined();
  });
});

// 6 ── tonemap one-present fallback (interpolate.ts:171-173 / :804-823). Only k0
// has tonemap → the missing side fills with INTERP_TONEMAP_FALLBACK
// {gamma:4, brightness:4, vibrancy:1, highlightPower:-1, gammaThreshold:0.01}.
describe('#393A characterization — tonemap one-present fallback', () => {
  it('only k0 has tonemap → blends k0 vs INTERP_TONEMAP_FALLBACK at t=0.3', () => {
    // c0=0.7, c1=0.3. k0 tonemap = {gamma:2, brightness:8, vibrancy:0,
    //   highlightPower:1, gammaThreshold:0.05}. Fallback = {4,4,1,-1,0.01}.
    //   gamma:          0.7·2    + 0.3·4    = 2.6
    //   brightness:     0.7·8    + 0.3·4    = 6.8
    //   vibrancy:       0.7·0    + 0.3·1    = 0.3
    //   highlightPower: 0.7·1    + 0.3·(-1) = 0.4
    //   gammaThreshold: 0.7·0.05 + 0.3·0.01 = 0.038
    const k0 = baseGenome({
      time: 0,
      tonemap: { gamma: 2, brightness: 8, vibrancy: 0, highlightPower: 1, gammaThreshold: 0.05 },
    });
    const k1 = baseGenome({ time: 1 });
    const r = interpolate(anim(k0, k1), 0.3);
    expect(r.tonemap).toBeDefined();
    expect(r.tonemap!.gamma).toBeCloseTo(2.6);
    expect(r.tonemap!.brightness).toBeCloseTo(6.8);
    expect(r.tonemap!.vibrancy).toBeCloseTo(0.3);
    expect(r.tonemap!.highlightPower).toBeCloseTo(0.4);
    expect(r.tonemap!.gammaThreshold).toBeCloseTo(0.038);
  });

  it('only k1 has tonemap → blends INTERP_TONEMAP_FALLBACK vs k1 at t=0.3', () => {
    // c0=0.7 (fallback side), c1=0.3 (k1).
    //   gamma:          0.7·4    + 0.3·2    = 3.4
    //   brightness:     0.7·4    + 0.3·8    = 5.2
    //   vibrancy:       0.7·1    + 0.3·0    = 0.7
    //   highlightPower: 0.7·(-1) + 0.3·1    = -0.4
    //   gammaThreshold: 0.7·0.01 + 0.3·0.05 = 0.022
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({
      time: 1,
      tonemap: { gamma: 2, brightness: 8, vibrancy: 0, highlightPower: 1, gammaThreshold: 0.05 },
    });
    const r = interpolate(anim(k0, k1), 0.3);
    expect(r.tonemap!.gamma).toBeCloseTo(3.4);
    expect(r.tonemap!.brightness).toBeCloseTo(5.2);
    expect(r.tonemap!.vibrancy).toBeCloseTo(0.7);
    expect(r.tonemap!.highlightPower).toBeCloseTo(-0.4);
    expect(r.tonemap!.gammaThreshold).toBeCloseTo(0.022);
  });
});

// 7 ── asymmetric wind (interpolation_type:'log', interpolate.ts:131 /
// establishWind / blendPolarColumn wind branch). A stationary (animate:0) vs an
// animated rotation xform winds the LONG way; a symmetric pair takes the short
// arc. We pin the SIGN of result.a (and that the symmetric control stays a>0.99).
describe('#393A characterization — asymmetric wind (log)', () => {
  const rot = (deg: number, animate?: number): Xform => {
    const th = (deg * Math.PI) / 180;
    const x: Xform = {
      a: Math.cos(th), b: -Math.sin(th), c: 0, d: Math.sin(th), e: Math.cos(th), f: 0,
      weight: 1, color: 0, colorSpeed: 0.5, variations: [linearVar(1)],
    };
    if (animate !== undefined) x.animate = animate;
    return x;
  };

  it('stationary(animate:0) vs animated at t=0.3 winds the long way (a < 0)', () => {
    // k0 = rot(20, animate:1), k1 = rot(-20, animate:0). Wind constrains both
    // angles into [refang, refang+2π] (refang = k0's angle since k1 stationary),
    // so the blend sweeps the long arc → mid lands near 180° → a < 0.
    const k0 = baseGenome({ time: 0, xforms: [rot(20, 1)] });
    const k1 = baseGenome({ time: 1, xforms: [rot(-20, 0)] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0.3).xforms[0]!;
    expect(r.a).toBeLessThan(0);   // SNAPSHOT: pins current behavior (long-arc wind)
  });

  it('symmetric control (both animated) takes the short arc (a > 0.99)', () => {
    const k0 = baseGenome({ time: 0, xforms: [rot(20, 1)] });
    const k1 = baseGenome({ time: 1, xforms: [rot(-20, 1)] });
    const r = interpolate(anim(k0, k1, { interpolation_type: 'log' }), 0.3).xforms[0]!;
    expect(r.a).toBeGreaterThan(0.99);
  });
});

// 8 ── motion clock uses rawC1 not the eased c1 (interpolate.ts:142-143 — the
// motion overlay is applied with rawC1, while the blend weights are eased). A
// HILL motion (motion_func 3, peaks at raw t=0.5) under an easeIn segmentEasing
// proves the motion sampled the RAW segment clock: with easeIn the eased weight
// at raw t=0.5 is 0.25, so an EASED motion clock would sample HILL(0.25) ≠ peak,
// whereas the RAW clock samples HILL(0.5) = peak.
describe('#393A characterization — motion clock uses rawC1 (not eased c1)', () => {
  // motion overlay adds c=5 with motion_func HILL (3), motion_freq 1. The base
  // xform carries c=20; the motion adds a HILL-weighted +5. At raw t=0.5 HILL
  // peaks → full +5 contribution on EACH keyframe → both keyframes read c=25,
  // blend = 25. An eased clock (raw 0.5 → eased 0.25) would attenuate HILL.
  const motionXform = (c: number): Xform => ({
    a: 1, b: 0, c, d: 0, e: 1, f: 0, weight: 1, color: 0, colorSpeed: 0.5,
    variations: [linearVar(1)],
    motion: [{
      a: 0, b: 0, c: 5, d: 0, e: 0, f: 0, weight: 0, color: 0, colorSpeed: 0,
      variations: [], motion_func: 3, motion_freq: 1,
    }],
  });

  it('HILL motion + easeIn: motion peaks at RAW t=0.5 (c=25, not the eased-clock 20)', () => {
    // Evaluate at the segment midpoint t=0.5: rawC1=0.5 (HILL peak). easeIn warps
    // the BLEND to eased c1=0.25, but the motion clock stays raw → HILL full.
    // Both keyframes get +5 → c=20+5=25 on each → blend (any weights) = 25.
    const k0 = baseGenome({ time: 0, xforms: [motionXform(20)] });
    const k1 = baseGenome({ time: 1, xforms: [motionXform(20)] });
    const r = interpolate(
      anim(k0, k1, { segmentEasing: [{ kind: 'preset', name: 'easeIn' }] }),
      0.5,
    ).xforms[0]!;
    expect(r.c).toBeCloseTo(25);   // SNAPSHOT: pins current behavior (raw motion clock)
  });

  it('control without motion: easeIn DOES warp the plain blend at t=0.3', () => {
    // No motion → the eased blend applies. c0=20, c1=30; raw c1@t=0.3 = 0.3,
    // easeIn(0.3) attenuates toward k0. Pin that easing actually moved it off the
    // linear 23 (= 0.7·20 + 0.3·30) — proving easeIn is live in this harness.
    const k0 = baseGenome({ time: 0, xforms: [{ ...id(), c: 20 }] });
    const k1 = baseGenome({ time: 1, xforms: [{ ...id(), c: 30 }] });
    const linear = interpolate(anim(k0, k1, { interpolation_type: 'linear' }), 0.3).xforms[0]!.c;
    const eased = interpolate(
      anim(k0, k1, { interpolation_type: 'linear', segmentEasing: [{ kind: 'preset', name: 'easeIn' }] }),
      0.3,
    ).xforms[0]!.c;
    expect(linear).toBeCloseTo(23);
    expect(eased).not.toBeCloseTo(linear, 2);
    expect(eased).toBeLessThan(linear);  // easeIn pulls toward k0 (=20)
  });
});

// 9 ── paletteMode carry-forward from k0, not k1 (interpolate.ts:223). Absent on
// k0 → not emitted (even if present on k1).
describe('#393A characterization — paletteMode carry-forward', () => {
  it('carries paletteMode from k0 when both differ', () => {
    const k0 = baseGenome({ time: 0, paletteMode: 'step' });
    const k1 = baseGenome({ time: 1, paletteMode: 'smooth' });
    const r = interpolate(anim(k0, k1), 0.3);
    expect(r.paletteMode).toBe('step');   // from k0, not k1
  });

  it('absent on k0 (present on k1) → paletteMode not emitted', () => {
    const k0 = baseGenome({ time: 0 });
    const k1 = baseGenome({ time: 1, paletteMode: 'smooth' });
    const r = interpolate(anim(k0, k1), 0.3);
    expect(r.paletteMode).toBeUndefined();
  });
});

// 10 ── spatialFilter.shape carry from k0 when both differ; radius still lerps
// (interpolate.ts:198-204).
describe('#393A characterization — spatialFilter shape carry / radius lerp', () => {
  it('shape carries from k0 (gaussian over hamming); radius lerps at t=0.3', () => {
    // c0=0.7, c1=0.3. radius: 0.7·1 + 0.3·5 = 0.7 + 1.5 = 2.2. shape from k0.
    const k0 = baseGenome({ time: 0, spatialFilter: { radius: 1, shape: 'gaussian' } });
    const k1 = baseGenome({ time: 1, spatialFilter: { radius: 5, shape: 'hamming' } });
    const r = interpolate(anim(k0, k1), 0.3);
    expect(r.spatialFilter!.shape).toBe('gaussian');   // from k0, not k1
    expect(r.spatialFilter!.radius).toBeCloseTo(2.2);
  });
});

// 11 ── resolveSegmentPermutation unit (exported; interpolate.ts:1349-1358).
describe('#393A characterization — resolveSegmentPermutation unit', () => {
  it('undefined → undefined', () => {
    expect(resolveSegmentPermutation(undefined, 4)).toBeUndefined();
  });

  it('empty array → undefined', () => {
    expect(resolveSegmentPermutation([], 4)).toBeUndefined();
  });

  it('full-length valid perm → returned verbatim', () => {
    expect(resolveSegmentPermutation([2, 0, 1], 3)).toEqual([2, 0, 1]);
  });

  it('short valid perm → extended with identity tail ([1,0]/n=4 → [1,0,2,3])', () => {
    expect(resolveSegmentPermutation([1, 0], 4)).toEqual([1, 0, 2, 3]);
  });

  it('duplicate index → undefined', () => {
    expect(resolveSegmentPermutation([0, 0, 1], 3)).toBeUndefined();
  });

  it('out-of-range index → undefined', () => {
    expect(resolveSegmentPermutation([0, 1, 5], 3)).toBeUndefined();
  });

  it('full-length perm with a duplicate → undefined', () => {
    expect(resolveSegmentPermutation([1, 1, 2, 3], 4)).toBeUndefined();
  });

  it('short array that is not itself a permutation → undefined', () => {
    // length 2 < n=4 but [0,3] is not a permutation of [0,1) range it covers
    // (3 out of range for length-2 perm) → undefined.
    expect(resolveSegmentPermutation([0, 3], 4)).toBeUndefined();
  });
});
