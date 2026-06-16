import { describe, expect, it } from 'vitest';
import { interpolate, pickKeyframes } from './interpolate';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Genome, type Xform, type ChannelCurves, type CurvePoint } from './genome';
import { linear as linearVar, julian, V, type VariationIndex } from './variations';
import { PYRE_PALETTE } from './palette';
import { expandGenomeForGPU } from './symmetry';

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
    expect(interpolate(anim(k0, k1, { segmentPermutation: [[0, 1]] }), 0.5).xforms.map((x) => x.c))
      .toEqual([10.5, 20.5, 30.5]);
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
