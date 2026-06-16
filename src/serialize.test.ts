import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { type Genome, SPIRAL_GALAXY, packXforms, XFORM_FLOATS } from './genome';
import {
  genomeToJson,
  genomeFromJson,
  PYR3_JSON_VERSION,
  VARIATION_PARAMS,
  VARIATION_DEFAULTS,
  MAX_VARIATION_PARAMS,
} from './serialize';
import { DEFAULT_DENSITY } from './density';
import { V, VARIATION_NAMES } from './variations';

describe('genomeToJson', () => {
  it('produces version 1', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.version).toBe(PYR3_JSON_VERSION);
    expect(json.version).toBe(1);
  });

  it('serializes name, viewport, palette, xforms shape', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.name).toBe('Spiral Galaxy');
    expect(json.viewport).toEqual({ scale: 220, cx: 0, cy: 0 });
    expect(json.palette.name).toBe('pyre');
    expect(json.palette.stops.length).toBe(6);
    expect(json.xforms.length).toBe(3);
  });

  it('serializes a parameterless variation without a params field', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const v = json.xforms[1]!.variations[0]!;
    expect(v.name).toBe('spherical');
    expect(v.weight).toBe(1);
    expect(v.params).toBeUndefined();
  });

  it('serializes julian with named params (power, dist)', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const v = json.xforms[0]!.variations[0]!;
    expect(v.name).toBe('julian');
    expect(v.weight).toBe(1);
    expect(v.params).toEqual({ power: 2, dist: 1 });
  });

  it('serializes affine fields nested under the affine key', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.xforms[0]!.affine).toEqual({
      a: 0.85, b: 0, c: 0, d: 0, e: 0.85, f: 0,
    });
  });

  it('omits palette.hue and palette.mode when undefined', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.palette.hue).toBeUndefined();
    expect(json.palette.mode).toBeUndefined();
  });

  it('serializes hslAdjust and omits when identity', () => {
    const genome = { ...SPIRAL_GALAXY, hslAdjust: { hue: -45, sat: 150, light: 25 } };
    const json = genomeToJson(genome);
    expect(json.hslAdjust).toEqual({ hue: -45, sat: 150, light: 25 });

    const identityGenome = { ...SPIRAL_GALAXY, hslAdjust: { hue: 0, sat: 100, light: 0 } };
    const identityJson = genomeToJson(identityGenome);
    expect(identityJson.hslAdjust).toBeUndefined();
  });
});

describe('genomeFromJson', () => {
  it('round-trips SPIRAL_GALAXY losslessly', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const reparsed = genomeFromJson(json);
    expect(reparsed).toEqual(SPIRAL_GALAXY);
  });

  it('throws on version mismatch', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, version: 2 };
    expect(() => genomeFromJson(bad)).toThrow(/version/);
  });

  it('clamps/normalizes out-of-range hslAdjust on import (#249)', () => {
    // Hand-edited / external JSON can carry values past the editor slider
    // ranges (hue -180..180, sat 0..200, light -100..100). Without clamping,
    // hue:720 reaches the shader and a single wrap leaves a wrong-but-defined
    // color. Normalize hue mod 360 into [-180,180]; clamp sat/light.
    const json = genomeToJson(SPIRAL_GALAXY);
    const reparsed = genomeFromJson({ ...json, hslAdjust: { hue: 720, sat: 500, light: 250 } });
    expect(reparsed.hslAdjust).toEqual({ hue: 0, sat: 200, light: 100 });

    const reparsed2 = genomeFromJson({ ...json, hslAdjust: { hue: 270, sat: -50, light: -250 } });
    // 270 → -90 (same rotation, in slider range); sat floored to 0; light to -100.
    expect(reparsed2.hslAdjust).toEqual({ hue: -90, sat: 0, light: -100 });
  });

  it('throws on unknown variation name', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = JSON.parse(JSON.stringify(json));
    bad.xforms[0].variations[0].name = 'made_up_variation';
    expect(() => genomeFromJson(bad)).toThrow(/made_up_variation/);
  });

  it('round-trips palette.hue when set', () => {
    const json = genomeToJson({
      ...SPIRAL_GALAXY,
      palette: { ...SPIRAL_GALAXY.palette, hue: 60 },
    });
    expect(json.palette.hue).toBe(60);
    const reparsed = genomeFromJson(json);
    expect(reparsed.palette.hue).toBe(60);
  });

  it("round-trips palette.mode='step' when set", () => {
    const json = genomeToJson({
      ...SPIRAL_GALAXY,
      palette: { ...SPIRAL_GALAXY.palette, mode: 'step' },
    });
    expect(json.palette.mode).toBe('step');
    const reparsed = genomeFromJson(json);
    expect(reparsed.palette.mode).toBe('step');
  });

  it("round-trips palette.mode='smooth' when set (#296)", () => {
    // The gradient editor lets users pick 'smooth'; genomeToJson wrote it but
    // genomeFromJson threw on reload, so smooth-gradient flames couldn't reopen.
    const json = genomeToJson({
      ...SPIRAL_GALAXY,
      palette: { ...SPIRAL_GALAXY.palette, mode: 'smooth' },
    });
    expect(json.palette.mode).toBe('smooth');
    const reparsed = genomeFromJson(json);
    expect(reparsed.palette.mode).toBe('smooth');
  });

  it('round-trips hslAdjust', () => {
    const json = genomeToJson({
      ...SPIRAL_GALAXY,
      hslAdjust: { hue: -45, sat: 150, light: 25 },
    });
    const reparsed = genomeFromJson(json);
    expect(reparsed.hslAdjust).toEqual({ hue: -45, sat: 150, light: 25 });
  });

  it('throws on missing required field (name)', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, name: undefined };
    expect(() => genomeFromJson(bad)).toThrow(/name/);
  });

  it('ignores unknown params on a known variation (forward-compat)', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const tweaked = JSON.parse(JSON.stringify(json));
    tweaked.xforms[1].variations[0].params = { future_field: 99 };
    expect(() => genomeFromJson(tweaked)).not.toThrow();
  });

  it('rejects a zero-xform genome to match the XML loader (PYR3-065)', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, xforms: [] };
    expect(() => genomeFromJson(bad)).toThrow(/at least one xform/);
  });
});

describe('finalxform round-trip', () => {
  // Helper: build a Spiral-Galaxy-with-julia-final genome.
  function withJuliaFinal(): Genome {
    return {
      ...SPIRAL_GALAXY,
      finalxform: {
        a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
        weight: 0, // meaningless on finalxform; placeholder
        color: 0.7,
        colorSpeed: 0.3,
        variations: [{ index: V.julia, weight: 1 }],
      },
    };
  }

  it('round-trips a genome with finalxform present', () => {
    const g = withJuliaFinal();
    const back = genomeFromJson(genomeToJson(g));
    expect(back.finalxform).toBeDefined();
    expect(back.finalxform).toEqual(g.finalxform);
  });

  it('round-trips a genome WITHOUT finalxform (regression)', () => {
    const back = genomeFromJson(genomeToJson(SPIRAL_GALAXY));
    expect(back.finalxform).toBeUndefined();
    expect(back).toEqual(SPIRAL_GALAXY);
  });

  it('round-trips a finalxform with opacity != 1 (PYR3-060 regression)', () => {
    const g = withJuliaFinal();
    g.finalxform!.opacity = 0.42;
    const json = genomeToJson(g);
    // The serialized finalxform must carry the non-default opacity...
    expect(json.finalxform!.opacity).toBe(0.42);
    // ...and the loader must read it back (was silently dropped → 1.0).
    const back = genomeFromJson(json);
    expect(back.finalxform!.opacity).toBe(0.42);
    expect(back.finalxform).toEqual(g.finalxform);
  });

  it('omits opacity on a finalxform with opacity == 1 (canonical form)', () => {
    const g = withJuliaFinal();
    g.finalxform!.opacity = 1.0;
    const json = genomeToJson(g);
    expect(json.finalxform).not.toHaveProperty('opacity');
    const back = genomeFromJson(json);
    expect(back.finalxform!.opacity).toBeUndefined();
  });

  it('emits no `weight` field on the serialized finalxform', () => {
    const json = genomeToJson(withJuliaFinal());
    expect(json.finalxform).toBeDefined();
    const keys = Object.keys(json.finalxform!);
    expect(keys).not.toContain('weight');
    // Regular xforms still have weight (sanity).
    expect(Object.keys(json.xforms[0]!)).toContain('weight');
  });

  it('builds finalxform with weight: 0 when loaded', () => {
    const json = genomeToJson(withJuliaFinal());
    const loaded = genomeFromJson(json);
    expect(loaded.finalxform!.weight).toBe(0);
  });

  // #86: with the two parsers unified into parseXformBody(isFinal), the
  // canonical guarantee is "finalxform accepts everything xform does, except
  // weight (pinned to 0) and xaos (skipped)". This pin catches future drift
  // of the unified parser back into the bug class that produced PYR3-060.
  it('finalxform parsing accepts everything xform does, except weight + xaos (#86)', () => {
    const baseXformJson = genomeToJson(SPIRAL_GALAXY).xforms[0]!;
    // The first SPIRAL_GALAXY xform carries: weight, color, colorSpeed,
    // affine, variations, and (optionally) opacity/xaos/post. Strip weight
    // (the only finalxform-forbidden field that's required on regular xforms)
    // and feed it to the finalxform parser via a synthetic genome.
    const { weight: _weight, xaos: _xaos, ...finalxformShape } = baseXformJson;
    const synthetic = {
      ...genomeToJson(SPIRAL_GALAXY),
      finalxform: finalxformShape,
    };
    const loaded = genomeFromJson(synthetic);
    expect(loaded.finalxform).toBeDefined();
    expect(loaded.finalxform!.weight).toBe(0); // pinned
    expect(loaded.finalxform!.color).toBe(baseXformJson.color);
    expect(loaded.finalxform!.colorSpeed).toBe(baseXformJson.colorSpeed);
    expect(loaded.finalxform!.a).toBe(baseXformJson.affine.a);
    expect(loaded.finalxform!.variations.length).toBe(baseXformJson.variations.length);
    expect(loaded.finalxform!.xaos).toBeUndefined(); // ignored on finalxform
  });

  it('throws with a path-anchored message on malformed finalxform', () => {
    const bad = {
      ...genomeToJson(SPIRAL_GALAXY),
      finalxform: {
        color: 0.7,
        colorSpeed: 0.3,
        // missing affine
        variations: [{ name: 'julia', weight: 1 }],
      },
    };
    expect(() => genomeFromJson(bad)).toThrow(/finalxform\.affine/);
  });
});

describe('symmetry round-trip', () => {
  it('round-trips a genome with rotational symmetry', () => {
    const g: Genome = { ...SPIRAL_GALAXY, symmetry: { kind: 'rotational', n: 5 } };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.symmetry).toEqual({ kind: 'rotational', n: 5 });
  });

  it('round-trips a genome with dihedral symmetry', () => {
    const g: Genome = { ...SPIRAL_GALAXY, symmetry: { kind: 'dihedral', n: 8 } };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.symmetry).toEqual({ kind: 'dihedral', n: 8 });
  });

  it('round-trips a genome WITHOUT symmetry (regression)', () => {
    const back = genomeFromJson(genomeToJson(SPIRAL_GALAXY));
    expect(back.symmetry).toBeUndefined();
  });

  it('throws on invalid symmetry.kind', () => {
    const bad = { ...genomeToJson(SPIRAL_GALAXY), symmetry: { kind: 'invalid', n: 5 } };
    expect(() => genomeFromJson(bad)).toThrow(/symmetry\.kind/);
  });

  it('throws on n=0 or non-positive n', () => {
    const bad = { ...genomeToJson(SPIRAL_GALAXY), symmetry: { kind: 'rotational', n: 0 } };
    expect(() => genomeFromJson(bad)).toThrow(/symmetry\.n/);
  });

  it('throws on non-integer n', () => {
    const bad = { ...genomeToJson(SPIRAL_GALAXY), symmetry: { kind: 'rotational', n: 2.5 } };
    expect(() => genomeFromJson(bad)).toThrow(/symmetry\.n/);
  });
});

describe('density round-trip', () => {
  it('omits density from JSON when undefined', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.density).toBeUndefined();
  });

  it('parses to undefined when density absent in JSON', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const back = genomeFromJson(json);
    expect(back.density).toBeUndefined();
  });

  it('round-trips DEFAULT_DENSITY losslessly', () => {
    const g: Genome = { ...SPIRAL_GALAXY, density: { ...DEFAULT_DENSITY } };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.density).toEqual(DEFAULT_DENSITY);
  });

  it('rejects negative maxRad', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, density: { maxRad: -1, minRad: 0, curve: 0.4 } };
    expect(() => genomeFromJson(bad)).toThrow(/maxRad/);
  });

  it('rejects curve = 0', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, density: { maxRad: 9, minRad: 0, curve: 0 } };
    expect(() => genomeFromJson(bad)).toThrow(/curve/);
  });

  it('rejects missing field', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, density: { maxRad: 9, minRad: 0 } };
    expect(() => genomeFromJson(bad)).toThrow();
  });

  it('rejects minRad > maxRad', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, density: { maxRad: 5, minRad: 10, curve: 0.4 } };
    expect(() => genomeFromJson(bad)).toThrow(/minRad/);
  });

  it('rejects maxRad above 30 cap', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    const bad = { ...json, density: { maxRad: 50, minRad: 0, curve: 0.4 } };
    expect(() => genomeFromJson(bad)).toThrow(/maxRad/);
  });
});

describe('tonemap round-trip (Phase 9a)', () => {
  it('serializes a genome with tonemap and reads it back identically', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      tonemap: { gamma: 4, vibrancy: 0.7, highlightPower: 1, brightness: 20, gammaThreshold: 0.01 },
    };
    const json = genomeToJson(g);
    const back = genomeFromJson(json);
    expect(back.tonemap).toEqual(g.tonemap);
  });

  it('omits tonemap from JSON when undefined on genome', () => {
    // SPIRAL_GALAXY now inlines its own tonemap (Phase 9-cal); strip it for this test.
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    expect(json.tonemap).toBeUndefined();
  });

  it('partial tonemap in JSON fills missing fields from DEFAULT_TONEMAP on load (flam3-canonical)', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    const augmented: unknown = { ...json, tonemap: { gamma: 2.2 } };
    const back = genomeFromJson(augmented);
    expect(back.tonemap?.gamma).toBe(2.2);
    expect(back.tonemap?.vibrancy).toBe(0.0);
    expect(back.tonemap?.brightness).toBe(1.0);
    expect(back.tonemap?.highlightPower).toBe(1.0);
    expect(back.tonemap?.gammaThreshold).toBe(0.01);
  });
});

describe('xform opacity + xaos round-trip (Phase 9d)', () => {
  it('serializes a xform with opacity + xaos and reads back identically', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const baseXform = stripped.xforms[0]!;
    const g: Genome = {
      ...stripped,
      xforms: [{ ...baseXform, opacity: 0.6, xaos: [1, 0.3, 0] }, ...stripped.xforms.slice(1)],
    };
    const json = genomeToJson(g);
    expect(json.xforms[0]!.opacity).toBe(0.6);
    expect(json.xforms[0]!.xaos).toEqual([1, 0.3, 0]);
    const back = genomeFromJson(json);
    expect(back.xforms[0]!.opacity).toBe(0.6);
    expect(back.xforms[0]!.xaos).toEqual([1, 0.3, 0]);
  });

  it('omits opacity from JSON when 1.0 or undefined on xform', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    for (const x of json.xforms) {
      expect(x.opacity).toBeUndefined();
    }
  });

  it('omits xaos from JSON when undefined on xform', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    for (const x of json.xforms) {
      expect(x.xaos).toBeUndefined();
    }
  });

  it('opacity=1.0 in JSON loads as undefined on xform', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    const augmented = { ...json, xforms: [{ ...json.xforms[0]!, opacity: 1.0 }, ...json.xforms.slice(1)] };
    const back = genomeFromJson(augmented);
    expect(back.xforms[0]!.opacity).toBeUndefined();
  });
});

describe('packXforms opacity clamp ([PYR3-016])', () => {
  function opacityAt(genome: Genome, slot: number): number {
    const buf = new Float32Array(packXforms(genome));
    return buf[slot * XFORM_FLOATS + 10]!;
  }
  const base: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
  const x0 = base.xforms[0]!;

  it('passes through a valid in-range opacity unchanged', () => {
    const g: Genome = { ...base, xforms: [{ ...x0, opacity: 0.6 }, ...base.xforms.slice(1)] };
    expect(opacityAt(g, 0)).toBeCloseTo(0.6);
  });

  it('clamps negative opacity to 0', () => {
    const g: Genome = { ...base, xforms: [{ ...x0, opacity: -0.3 }, ...base.xforms.slice(1)] };
    expect(opacityAt(g, 0)).toBe(0);
  });

  it('clamps opacity > 1 down to 1', () => {
    const g: Genome = { ...base, xforms: [{ ...x0, opacity: 1.5 }, ...base.xforms.slice(1)] };
    expect(opacityAt(g, 0)).toBe(1);
  });

  it('defaults undefined opacity to 1', () => {
    const g: Genome = { ...base, xforms: [{ ...x0, opacity: undefined }, ...base.xforms.slice(1)] };
    expect(opacityAt(g, 0)).toBe(1);
  });
});

describe('rotate round-trip (Phase 9-rotate)', () => {
  it('serializes a genome with rotate and reads it back identically', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const g: Genome = { ...stripped, rotate: 90.25 };
    const json = genomeToJson(g);
    expect(json.rotate).toBe(90.25);
    const back = genomeFromJson(json);
    expect(back.rotate).toBe(90.25);
  });

  it('omits rotate from JSON when undefined on genome', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    expect(json.rotate).toBeUndefined();
  });

  it('omits rotate from JSON when 0 on genome (no-op rotation)', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined, rotate: 0 };
    const json = genomeToJson(stripped);
    expect(json.rotate).toBeUndefined();
  });

  it('rotate=0 in JSON loads as undefined on genome', () => {
    const stripped: Genome = { ...SPIRAL_GALAXY, tonemap: undefined };
    const json = genomeToJson(stripped);
    const augmented: unknown = { ...json, rotate: 0 };
    const back = genomeFromJson(augmented);
    expect(back.rotate).toBeUndefined();
  });
});

describe('oversample round-trip (Phase 9-supersample-real)', () => {
  it('round-trips genome.oversample when > 1', () => {
    const g: Genome = { ...SPIRAL_GALAXY, oversample: 4 };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.oversample).toBe(4);
  });

  it('omits oversample from JSON when undefined or 1', () => {
    expect(genomeToJson(SPIRAL_GALAXY).oversample).toBeUndefined();
    expect(genomeToJson({ ...SPIRAL_GALAXY, oversample: 1 }).oversample).toBeUndefined();
    const back = genomeFromJson(genomeToJson(SPIRAL_GALAXY));
    expect(back.oversample).toBeUndefined();
  });

  it('rejects JSON with non-positive-integer oversample', () => {
    const json = { ...genomeToJson(SPIRAL_GALAXY), oversample: 0 };
    expect(() => genomeFromJson(json)).toThrow(/positive integer/);
    const json2 = { ...genomeToJson(SPIRAL_GALAXY), oversample: 2.5 };
    expect(() => genomeFromJson(json2)).toThrow(/positive integer/);
  });

  it('treats oversample=1 in JSON as undefined on load', () => {
    const json = { ...genomeToJson(SPIRAL_GALAXY), oversample: 1 };
    const back = genomeFromJson(json);
    expect(back.oversample).toBeUndefined();
  });
});

describe('size round-trip (Phase 9-size)', () => {
  it('round-trips genome.size when set', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      size: { width: 800, height: 592 },
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.size).toEqual({ width: 800, height: 592 });
  });

  it('omits size from JSON when undefined', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.size).toBeUndefined();
    const back = genomeFromJson(json);
    expect(back.size).toBeUndefined();
  });

  it('rejects JSON with non-positive size', () => {
    const json = { ...genomeToJson(SPIRAL_GALAXY), size: { width: 0, height: 100 } };
    expect(() => genomeFromJson(json)).toThrow(/positive integers/);
  });

  it('rejects JSON with non-integer size', () => {
    const json = { ...genomeToJson(SPIRAL_GALAXY), size: { width: 100.5, height: 100 } };
    expect(() => genomeFromJson(json)).toThrow(/positive integers/);
  });
});

describe('spatialFilter round-trip (Phase 9-filter)', () => {
  it('round-trips genome.spatialFilter when set', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      spatialFilter: { radius: 1.5, shape: 'gaussian' },
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.spatialFilter).toEqual({ radius: 1.5, shape: 'gaussian' });
  });

  it('omits spatialFilter from JSON when undefined', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.spatialFilter).toBeUndefined();
    const back = genomeFromJson(json);
    expect(back.spatialFilter).toBeUndefined();
  });

  it('rejects JSON with unsupported filter shape', () => {
    // Phase 9-filter-shapes shipped all 14 of flam3's canonical shapes
    // (gaussian/hermite/box/triangle/bell/bspline/mitchell/blackman/catrom/
    // hanning/hamming/lanczos3/lanczos2/quadratic). Truly unknown shape
    // strings still throw — pin against an obviously-invalid name.
    const json = {
      ...genomeToJson(SPIRAL_GALAXY),
      spatialFilter: { radius: 1, shape: 'nonexistent' },
    };
    expect(() => genomeFromJson(json)).toThrow(/unsupported/);
  });

  it('round-trips all 14 supported filter shapes', () => {
    const shapes = [
      'gaussian', 'hermite', 'box', 'triangle', 'bell', 'bspline',
      'mitchell', 'blackman', 'catrom', 'hanning', 'hamming',
      'lanczos3', 'lanczos2', 'quadratic',
    ] as const;
    for (const shape of shapes) {
      const json = { ...genomeToJson(SPIRAL_GALAXY), spatialFilter: { radius: 1.25, shape } };
      const back = genomeFromJson(json);
      expect(back.spatialFilter, `shape=${shape}`).toEqual({ radius: 1.25, shape });
    }
  });

  it('rejects JSON with non-positive filter radius', () => {
    const json = {
      ...genomeToJson(SPIRAL_GALAXY),
      spatialFilter: { radius: 0, shape: 'gaussian' },
    };
    expect(() => genomeFromJson(json)).toThrow(/positive/);
  });
});

describe('Phase 9c xform.post round-trip', () => {
  it('round-trips post on a regular xform', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      xforms: [
        {
          ...SPIRAL_GALAXY.xforms[0]!,
          post: { a: 0.9, b: 0.1, c: 0.05, d: -0.1, e: 0.9, f: -0.05 },
        },
        ...SPIRAL_GALAXY.xforms.slice(1),
      ],
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.xforms[0]!.post).toEqual({ a: 0.9, b: 0.1, c: 0.05, d: -0.1, e: 0.9, f: -0.05 });
  });

  it('omits post from JSON when undefined', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.xforms[0]!.post).toBeUndefined();
  });

  it('omits identity post from JSON (symmetric with rotate=0 / oversample=1)', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      xforms: [
        {
          ...SPIRAL_GALAXY.xforms[0]!,
          post: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        },
        ...SPIRAL_GALAXY.xforms.slice(1),
      ],
    };
    const json = genomeToJson(g);
    expect(json.xforms[0]!.post).toBeUndefined();
  });

  it('round-trips post on finalxform', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      finalxform: {
        weight: 0,
        color: 0.5,
        colorSpeed: 0,
        a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
        variations: [{ index: 0, weight: 1 }],
        post: { a: 1, b: 0, c: 0.1, d: 0, e: 1, f: -0.1 },
      },
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.finalxform!.post).toEqual({ a: 1, b: 0, c: 0.1, d: 0, e: 1, f: -0.1 });
  });
});

describe('Phase 9-bg-palmode round-trip', () => {
  it('round-trips background', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      background: [0.1, 0.2, 0.3],
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.background).toEqual([0.1, 0.2, 0.3]);
  });

  it('round-trips paletteMode', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      paletteMode: 'linear',
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.paletteMode).toBe('linear');
  });

  it("round-trips paletteMode='smooth' (#296)", () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      paletteMode: 'smooth',
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.paletteMode).toBe('smooth');
  });

  it('omits both fields from JSON when undefined', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json.background).toBeUndefined();
    expect(json.paletteMode).toBeUndefined();
  });

  it('rejects invalid paletteMode in JSON', () => {
    const valid = genomeToJson({ ...SPIRAL_GALAXY, paletteMode: 'linear' });
    const invalid = { ...valid, paletteMode: 'wobble' };
    expect(() => genomeFromJson(invalid)).toThrow(/paletteMode/);
  });

  it('round-trips background + paletteMode together (typical Apophysis case)', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      background: [0.05, 0.1, 0.2],
      paletteMode: 'linear',
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back.background).toEqual([0.05, 0.1, 0.2]);
    expect(back.paletteMode).toBe('linear');
  });
});

describe('active round-trip', () => {
  // Helper: structured-clone SPIRAL_GALAXY so each test gets a fresh fixture.
  function makeMinimalGenome(): Genome {
    return JSON.parse(JSON.stringify(SPIRAL_GALAXY)) as Genome;
  }

  it('omits xform.active when undefined or true', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.active = undefined;
    g.xforms[1]!.active = true;
    const json = genomeToJson(g);
    expect(json.xforms[0]).not.toHaveProperty('active');
    expect(json.xforms[1]).not.toHaveProperty('active');
  });

  it('emits xform.active=false', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.active = false;
    const json = genomeToJson(g);
    expect(json.xforms[0]).toMatchObject({ active: false });
  });

  it('round-trips active=false through fromJson', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.active = false;
    const g2 = genomeFromJson(genomeToJson(g));
    expect(g2.xforms[0]!.active).toBe(false);
  });

  it('omits variation.active when undefined or true', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.variations[0]!.active = true;
    const json = genomeToJson(g);
    expect(json.xforms[0]!.variations[0] ?? {}).not.toHaveProperty('active');
  });

  it('round-trips variation.active=false', () => {
    const g = makeMinimalGenome();
    g.xforms[0]!.variations[0]!.active = false;
    const g2 = genomeFromJson(genomeToJson(g));
    expect(g2.xforms[0]!.variations[0]!.active).toBe(false);
  });
});

// Issue #228 — author nick must survive the serialize boundary (Save Flame,
// Save Render PNG metadata, /v1/viewer refresh persistence).
describe('#228 — nick round-trip', () => {
  it('omits nick when undefined or empty', () => {
    const g: Genome = { ...SPIRAL_GALAXY };
    expect(genomeToJson(g)).not.toHaveProperty('nick');
    expect(genomeToJson({ ...SPIRAL_GALAXY, nick: '' })).not.toHaveProperty('nick');
  });

  it('preserves nick through Genome → JSON → Genome', () => {
    const g: Genome = { ...SPIRAL_GALAXY, nick: 'spotpuff' };
    const json = genomeToJson(g);
    expect(json.nick).toBe('spotpuff');
    expect(genomeFromJson(json).nick).toBe('spotpuff');
  });
});

// Issue #229 — V214-217 params must survive round-trip now that they're
// registered. Guards the specific bug (save+reload reset waves3 to identity).
describe('#229 — waves3 (V214) param round-trip', () => {
  it('preserves all 6 waves3 params through Genome → JSON → Genome', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      xforms: [
        {
          ...SPIRAL_GALAXY.xforms[0]!,
          variations: [
            {
              index: V.waves3,
              weight: 0.7,
              param0: 0.11, param1: 0.22, param2: 6.0,
              param3: 9.0, param4: 0.5, param5: 3.0,
            },
          ],
        },
        ...SPIRAL_GALAXY.xforms.slice(1),
      ],
    };
    const v = genomeFromJson(genomeToJson(g)).xforms[0]!.variations[0]!;
    expect(v.index).toBe(V.waves3);
    expect(v.param0).toBeCloseTo(0.11, 6);
    expect(v.param1).toBeCloseTo(0.22, 6);
    expect(v.param2).toBeCloseTo(6.0, 6);
    expect(v.param3).toBeCloseTo(9.0, 6);
    expect(v.param4).toBeCloseTo(0.5, 6);
    expect(v.param5).toBeCloseTo(3.0, 6);
  });
});

describe('variation param-table coupling (PYR3-069 invariant)', () => {
  it('no variation declares more params than there are PARAM_KEYS slots', () => {
    for (const [arm, params] of Object.entries(VARIATION_PARAMS)) {
      expect(
        params.length,
        `${arm} declares ${params.length} params > MAX_VARIATION_PARAMS=${MAX_VARIATION_PARAMS}`,
      ).toBeLessThanOrEqual(MAX_VARIATION_PARAMS);
    }
  });

  it('every VARIATION_DEFAULTS arm matches its VARIATION_PARAMS length + ordering', () => {
    for (const [arm, defaults] of Object.entries(VARIATION_DEFAULTS)) {
      const params = VARIATION_PARAMS[arm];
      expect(params, `VARIATION_DEFAULTS has '${arm}' but VARIATION_PARAMS does not`).toBeDefined();
      expect(
        defaults.length,
        `${arm}: defaults length ${defaults.length} != params length ${params!.length}`,
      ).toBe(params!.length);
    }
  });

  // #229 — registry-coverage guard. Every variation whose chaos.wgsl dispatch
  // case passes positional params (p0..pN) MUST have a VARIATION_PARAMS entry of
  // length ≥ N+1, or those params are silently dropped on serialize round-trip,
  // the editor shows no sliders, and import strips them (the V214-217 bug class).
  it('every chaos.wgsl dispatch arm that reads pN is registered in VARIATION_PARAMS', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const wgsl = readFileSync(join(here, 'shaders', 'chaos.wgsl'), 'utf8');
    // Match: `case 214u: { return var_waves3(p, w, p0, p1, ...); }`
    const caseRe = /case\s+(\d+)u:\s*\{\s*return\s+var_\w+\(([^)]*)\)/g;
    const violations: string[] = [];
    for (let m = caseRe.exec(wgsl); m !== null; m = caseRe.exec(wgsl)) {
      const index = Number(m[1]);
      const args = m[2]!;
      // Highest positional-param slot the kernel reads (p0..p9). `wi`/`p`/`w`
      // are not positional params and never match \bp<digit>\b.
      let maxP = -1;
      for (const pm of args.matchAll(/\bp(\d)\b/g)) {
        maxP = Math.max(maxP, Number(pm[1]));
      }
      if (maxP < 0) continue; // kernel reads no positional params
      const name = VARIATION_NAMES[index];
      const params = name ? VARIATION_PARAMS[name] : undefined;
      if (!name || !params || params.length < maxP + 1) {
        violations.push(
          `index ${index} (${name ?? '??'}) reads up to p${maxP} → needs ${maxP + 1} params, ` +
            `VARIATION_PARAMS has ${params ? params.length : 'NONE'}`,
        );
      }
    }
    expect(violations, `unregistered param-bearing variations:\n${violations.join('\n')}`).toEqual([]);
  });
});

// #120 batch B1 — first user of the post-#120 expanded 10-param seam.
// Verify all 9 bipolar2 params survive a Genome → JSON → Genome round-trip
// and that param8 (the new slot) lands correctly.
describe('#120 B1 — bipolar2 9-param round-trip', () => {
  it('preserves all 9 params (shift, a, b, c, d, e, f1, g1, h) through Genome → JSON → Genome', async () => {
    const { V } = await import('./variations');
    const { genomeToJson, genomeFromJson } = await import('./serialize');
    const { SPIRAL_GALAXY } = await import('./genome');
    const g = {
      ...SPIRAL_GALAXY,
      xforms: [
        {
          ...SPIRAL_GALAXY.xforms[0]!,
          variations: [
            {
              index: V.bipolar2,
              weight: 0.8,
              param0: 0.25,   // shift
              param1: 1.5,    // a
              param2: 1.75,   // b
              param3: 0.4,    // c
              param4: 1.2,    // d
              param5: 2.5,    // e
              param6: 0.3,    // f1
              param7: 0.9,    // g1
              param8: 0.85,   // h  ← the new slot
            },
          ],
        },
        ...SPIRAL_GALAXY.xforms.slice(1),
      ],
    };
    const json = genomeToJson(g);
    const reparsed = genomeFromJson(json);
    const v = reparsed.xforms[0]!.variations[0]!;
    expect(v.index).toBe(V.bipolar2);
    expect(v.weight).toBeCloseTo(0.8, 6);
    expect(v.param0).toBeCloseTo(0.25, 6);
    expect(v.param1).toBeCloseTo(1.5, 6);
    expect(v.param2).toBeCloseTo(1.75, 6);
    expect(v.param3).toBeCloseTo(0.4, 6);
    expect(v.param4).toBeCloseTo(1.2, 6);
    expect(v.param5).toBeCloseTo(2.5, 6);
    expect(v.param6).toBeCloseTo(0.3, 6);
    expect(v.param7).toBeCloseTo(0.9, 6);
    expect(v.param8).toBeCloseTo(0.85, 6);
  });
});

// Issue #116 — Color Curves JSON round-trip.
describe('#116 — channelCurves round-trip', () => {
  it('preserves a non-identity composite curve through Genome → JSON → Genome', async () => {
    const { genomeToJson, genomeFromJson } = await import('./serialize');
    const { SPIRAL_GALAXY } = await import('./genome');
    const { IDENTITY_POINTS } = await import('./channel-curves');
    const g: Genome = {
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
        r:    IDENTITY_POINTS, g: IDENTITY_POINTS,
        b:    IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    };
    const j = genomeToJson(g);
    const back = genomeFromJson(j);
    expect(back.channelCurves?.composite).toEqual([
      { x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 },
    ]);
    expect(back.channelCurves?.r).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('omits channelCurves from JSON when all 5 channels are identity', async () => {
    const { genomeToJson } = await import('./serialize');
    const { SPIRAL_GALAXY } = await import('./genome');
    const { IDENTITY_POINTS } = await import('./channel-curves');
    const g: Genome = {
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
        b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    };
    const j = genomeToJson(g) as unknown as Record<string, unknown>;
    expect(j['channelCurves']).toBeUndefined();
  });

  it('treats absent channelCurves as undefined', async () => {
    const { genomeToJson, genomeFromJson } = await import('./serialize');
    const { SPIRAL_GALAXY } = await import('./genome');
    const j = genomeToJson(SPIRAL_GALAXY) as unknown as Record<string, unknown>;
    delete j['channelCurves'];
    const back = genomeFromJson(j);
    expect(back.channelCurves).toBeUndefined();
  });

  it('rejects malformed channelCurves (point out of [0,1])', async () => {
    const { genomeFromJson, genomeToJson } = await import('./serialize');
    const { SPIRAL_GALAXY } = await import('./genome');
    const { IDENTITY_POINTS } = await import('./channel-curves');
    const j = genomeToJson({
      ...SPIRAL_GALAXY,
      channelCurves: {
        composite: [{ x: 0, y: 0 }, { x: 0.5, y: 1.5 }, { x: 1, y: 1 }],
        r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    });
    expect(() => genomeFromJson(j)).toThrow(/out of \[0,1\]/);
  });

  it('rejects non-monotonic x', async () => {
    const { genomeFromJson } = await import('./serialize');
    const { SPIRAL_GALAXY } = await import('./genome');
    const { IDENTITY_POINTS } = await import('./channel-curves');
    const j = {
      ...(await import('./serialize')).genomeToJson(SPIRAL_GALAXY),
      channelCurves: {
        composite: [{ x: 0, y: 0 }, { x: 0.6, y: 0.5 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
        r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
      },
    };
    expect(() => genomeFromJson(j)).toThrow(/monotonic/);
  });
});

describe('#247 animation/motion + finalxform-xaos round-trip', () => {
  it('round-trips per-xform motion fields + genome.time', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      time: 12.5,
      xforms: SPIRAL_GALAXY.xforms.map((x, i) =>
        i === 0
          ? {
              ...x,
              motion_freq: 2,
              motion_func: 1,
              animate: 0,
              motion: [
                {
                  a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
                  weight: 0, color: 0.5, colorSpeed: 0,
                  variations: [{ index: V.linear, weight: 1 }],
                  motion_freq: 1,
                  motion_func: 2,
                },
              ],
            }
          : x,
      ),
    };
    const back = genomeFromJson(genomeToJson(g));
    expect(back).toEqual(g);
  });

  it('omits motion fields at their defaults (canonical form)', () => {
    const json = genomeToJson(SPIRAL_GALAXY);
    expect(json).not.toHaveProperty('time');
    expect(json.xforms[0]).not.toHaveProperty('motion_freq');
    expect(json.xforms[0]).not.toHaveProperty('motion_func');
    expect(json.xforms[0]).not.toHaveProperty('animate');
    expect(json.xforms[0]).not.toHaveProperty('motion');
  });

  it('omits time at the flam3 default 0 (canonical form, matches importer)', () => {
    const json = genomeToJson({ ...SPIRAL_GALAXY, time: 0 });
    expect(json).not.toHaveProperty('time');
    expect(genomeFromJson(json).time).toBeUndefined();
  });

  it('strips xaos from the serialized finalxform (write-then-ignore)', () => {
    const g: Genome = {
      ...SPIRAL_GALAXY,
      finalxform: {
        a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
        weight: 0, color: 0.7, colorSpeed: 0.3,
        xaos: [0.5, 0.5, 0.5],
        variations: [{ index: V.julia, weight: 1 }],
      },
    };
    const json = genomeToJson(g);
    expect(json.finalxform).not.toHaveProperty('xaos');
    const back = genomeFromJson(json);
    expect(back.finalxform!.xaos).toBeUndefined();
  });
});
