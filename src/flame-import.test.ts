// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { parseFlame, parseCoefs } from './flame-import';
import { SPIRAL_GALAXY, MAX_XFORMS } from './genome';
import { V } from './variations';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('parseFlame smoke', () => {
  it('throws on malformed XML', () => {
    expect(() => parseFlame('<flame oops')).toThrow(/malformed/i);
  });

  it('throws when no <flame> element is present', () => {
    expect(() => parseFlame('<root><other /></root>')).toThrow(/no <flame> element/);
  });

  it('parses a flame name containing HTML as inert text (PYR3-065 XSS)', () => {
    // A malicious `.flame` name must survive import as a plain string — never
    // an interpreted HTML fragment. The DOM side renders it via textContent;
    // here we assert the importer itself stores it verbatim (no stripping, no
    // element creation), so the value handed downstream is inert text.
    const evil = '<img src=x onerror=alert(1)>';
    // XML-escaped in the attribute (as any well-formed `.flame` would be);
    // the parser decodes it back to the raw string, which must be stored as
    // inert text rather than ever being interpreted as markup.
    const xml =
      `<flame name="&lt;img src=x onerror=alert(1)&gt;" size="1024 1024" center="0 0" scale="100">` +
      `${minPalette}${oneXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.name).toBe(evil);
  });
});

const minPalette =
  '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>';

const wrapFlame = (children: string, attrs = ''): string =>
  `<flame name="t" size="1024 1024" center="0 0" scale="100"${attrs ? ' ' + attrs : ''}>${minPalette}${children}</flame>`;

const oneXform = '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>';

describe('parseFlame xform-count cap (PYR3-033)', () => {
  it('clamps a flame with more than MAX_XFORMS xforms and reports it loudly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const n = MAX_XFORMS + 5;
    const { genome, report } = parseFlame(wrapFlame(oneXform.repeat(n)));
    expect(genome.xforms).toHaveLength(MAX_XFORMS);
    expect(report.clampedXforms).toEqual({ had: n, cap: MAX_XFORMS });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does NOT clamp a flame at exactly MAX_XFORMS xforms', () => {
    const { genome, report } = parseFlame(wrapFlame(oneXform.repeat(MAX_XFORMS)));
    expect(genome.xforms).toHaveLength(MAX_XFORMS);
    expect(report.clampedXforms).toBeUndefined();
  });
});

describe('parseFlame xform translation', () => {
  it('parses a single xform with one known variation (linear)', () => {
    const xml = wrapFlame('<xform weight="0.5" color="0.2" color_speed="0.3" coefs="1 0 0 1 0 0" linear="1"/>');
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms).toHaveLength(1);
    const x = genome.xforms[0]!;
    expect(x.weight).toBe(0.5);
    expect(x.color).toBe(0.2);
    expect(x.colorSpeed).toBe(0.3);
    expect(x.variations).toEqual([{ index: 0, weight: 1 }]);
    expect(report.droppedVariations).toEqual([]);
  });

  it('parses julian with named params (julian_power, julian_dist)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" julian="1.0" julian_power="3" julian_dist="0.7"/>',
    );
    const { genome } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toEqual([
      { index: 14, weight: 1, param0: 3, param1: 0.7 },
    ]);
  });

  // PYR3-034 regression: variation names that THEMSELVES contain an underscore
  // (radial_blur, gaussian_blur, pre_blur) must be recognized as variations, not
  // mistaken for a `<var>_<param>` param and silently dropped. The old parser
  // split on the first `_` (radial_blur → head "radial" ∉ V), dropping the weight
  // and zeroing the variation — which erased electricsheep.243.00171's halo.
  it('parses radial_blur (underscore-named) + its angle param without dropping it', () => {
    const xml = wrapFlame(
      '<xform weight="0.5" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="0.05" radial_blur="0.5" radial_blur_angle="0.1"/>',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toEqual([
      { index: 0, weight: 0.05 },
      { index: 47, weight: 0.5, param0: 0.1 },
    ]);
    expect(report.droppedVariations).toEqual([]);
  });

  it('parses gaussian_blur (underscore-named, 0-param) without dropping it', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" gaussian_blur="0.8"/>',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toEqual([{ index: 45, weight: 0.8 }]);
    expect(report.droppedVariations).toEqual([]);
  });

  // Phase 9b shipped all 99 flam3 variations (2026-05-12 v1.0 ship). No
  // real "unknown but plausible" variation names remain — every flam3 kernel
  // name is now a recognized variation. Use a deliberately-fake string for
  // the "unknown variation" placeholder so this test class won't age out
  // again as future variations land.
  it('drops unknown variations and reports them', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="0.5" nonexistent="0.5"/>',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toEqual([{ index: 0, weight: 0.5 }]);
    expect(report.droppedVariations).toEqual([
      { name: 'nonexistent', weight: 0.5, xformIndex: 0 },
    ]);
  });

  it('falls back to linear(1) when all variations were dropped', () => {
    const xml = wrapFlame('<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" nonexistent="1.0"/>');
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toEqual([{ index: 0, weight: 1 }]);
    expect(report.droppedVariations).toEqual([
      { name: 'nonexistent', weight: 1, xformIndex: 0 },
    ]);
  });

  it('falls back to linear(1) when no variation attributes were present', () => {
    const xml = wrapFlame('<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0"/>');
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.variations).toEqual([{ index: 0, weight: 1 }]);
    expect(report.droppedVariations).toEqual([]);
  });
});

const xformOnly = '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/>';

describe('parseFlame palette parsing', () => {
  it('parses 256 <color index> entries', () => {
    let palette = '';
    for (let i = 0; i < 256; i++) palette += `<color index="${i}" rgb="${i} ${i} ${i}"/>`;
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}${xformOnly}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.palette.stops).toHaveLength(256);
    expect(genome.palette.stops[0]).toEqual({ t: 0, r: 0, g: 0, b: 0 });
    expect(genome.palette.stops[255]).toEqual({ t: 1, r: 1, g: 1, b: 1 });
    expect(genome.palette.stops[128]!.r).toBeCloseTo(128 / 255, 5);
  });

  it('defaults unspecified <color> indices to black', () => {
    const palette = '<color index="0" rgb="255 0 0"/><color index="255" rgb="0 0 255"/>';
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}${xformOnly}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.palette.stops).toHaveLength(256);
    expect(genome.palette.stops[0]).toEqual({ t: 0, r: 1, g: 0, b: 0 });
    expect(genome.palette.stops[100]).toEqual({ t: 100 / 255, r: 0, g: 0, b: 0 });
    expect(genome.palette.stops[255]).toEqual({ t: 1, r: 0, g: 0, b: 1 });
  });

  it('parses <colors data="hex..."> packed-hex with flam3 layout 00RRGGBB per entry', () => {
    // flam3 parser.c:102-103: `<colors data>` reads sscanf("00%2x%2x%2x")
    // — alpha placeholder "00" first byte, then RGB. So per entry we emit
    // "00" + RR + GG + BB (4 bytes / 8 hex chars).
    let hex = '';
    for (let i = 0; i < 256; i++) {
      hex += '00' + i.toString(16).padStart(2, '0').repeat(3);
    }
    const palette = `<colors count="256" data="${hex}"/>`;
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}${xformOnly}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.palette.stops).toHaveLength(256);
    expect(genome.palette.stops[128]!.r).toBeCloseTo(128 / 255, 5);
    expect(genome.palette.stops[128]!.g).toBeCloseTo(128 / 255, 5);
    expect(genome.palette.stops[128]!.b).toBeCloseTo(128 / 255, 5);
  });

  it('reads distinct R/G/B from <colors data> in flam3 byte order', () => {
    // Regression test for the byte-order bug found in code review: previous
    // implementation read bytes[0..2] giving (R=alpha_placeholder=0, G=src.R,
    // B=src.G) — heavily blue-shifted with near-zero red. With the fix,
    // bytes[1..3] give (R, G, B) correctly.
    // Build a 256-entry stream where entry i = 00, 80, A0, 40 → R=128/255,
    // G=160/255, B=64/255 for every i.
    let hex = '';
    for (let i = 0; i < 256; i++) hex += '0080a040';
    const palette = `<colors count="256" data="${hex}"/>`;
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}${xformOnly}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.palette.stops[0]!.r).toBeCloseTo(128 / 255, 5);
    expect(genome.palette.stops[0]!.g).toBeCloseTo(160 / 255, 5);
    expect(genome.palette.stops[0]!.b).toBeCloseTo(64 / 255, 5);
  });

  it('parses <palette count format="RGB"> inline content', () => {
    let hex = '';
    for (let i = 0; i < 256; i++) hex += i.toString(16).padStart(2, '0').repeat(3);
    const palette = `<palette count="256" format="RGB">${hex}</palette>`;
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}${xformOnly}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.palette.stops).toHaveLength(256);
  });

  it('rejects the old <palette index0=... blend=...> format', () => {
    const palette = '<palette index0="10" index1="20" blend="0.5"/>';
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}${xformOnly}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/old palette format/i);
  });
});

const minXform = '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/>';

describe('parseFlame genome-level attrs', () => {
  it('reads name, scale, center', () => {
    const xml = `<flame name="my-flame" size="512 512" center="0.5 -0.25" scale="220">${minPalette}${minXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.name).toBe('my-flame');
    expect(genome.scale).toBe(220);
    expect(genome.cx).toBe(0.5);
    expect(genome.cy).toBe(-0.25);
  });

  it('maps <symmetry kind=N> to rotational(N)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100"><symmetry kind="3"/>${minPalette}${minXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.symmetry).toEqual({ kind: 'rotational', n: 3 });
  });

  it('maps <symmetry kind=-N> to dihedral(N)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100"><symmetry kind="-5"/>${minPalette}${minXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.symmetry).toEqual({ kind: 'dihedral', n: 5 });
  });

  it('maps estimator_radius / estimator_minimum / estimator_curve to Genome.density', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" estimator_radius="9" estimator_minimum="0.5" estimator_curve="0.4">${minPalette}${minXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.density).toEqual({ maxRad: 9, minRad: 0.5, curve: 0.4 });
  });

  it('omits density when no estimator_* attrs present', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.density).toBeUndefined();
  });
});

describe('parseFlame ignored-field reporting', () => {
  it('honors gamma/vibrancy/highlight_power/brightness on tonemap (Phase 9a) and background on genome (Phase 9-bg-palmode)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" gamma="2.5" vibrancy="0.4" highlight_power="1.5" brightness="3.0" background="0.1 0.0 0.2">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    const fields = report.ignoredFields.map((f) => f.field);
    // Phase 9a — these 4 are now honored on genome.tonemap, NOT ignored.
    expect(fields).not.toContain('gamma');
    expect(fields).not.toContain('vibrancy');
    expect(fields).not.toContain('highlight_power');
    expect(fields).not.toContain('brightness');
    // Phase 9-bg-palmode — background now honored on the genome.
    expect(fields).not.toContain('background');
    expect(genome.background).toEqual([0.1, 0.0, 0.2]);
  });

  it('honors xform-level post (Phase 9c) + opacity + chaos (Phase 9d)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" post="1 0 0 1 0.5 0" opacity="0.5" chaos="1 0.3" linear="1"/></flame>`;
    const { genome, report } = parseFlame(xml);
    const fields = report.ignoredFields.map((f) => f.field);
    expect(fields).not.toContain('post@xform[0]');
    expect(fields).not.toContain('opacity@xform[0]');
    expect(fields).not.toContain('xaos@xform[0]');
    expect(genome.xforms[0]!.opacity).toBe(0.5);
    expect(genome.xforms[0]!.xaos).toEqual([1, 0.3]);
    // post="1 0 0 1 0.5 0" maps via parseCoefs (column-major-to-row-major):
    // pyr3 (a, b, c, d, e, f) = (1, 0, 0.5, 0, 1, 0) — translation in x
    // by 0.5. NOT identity, so kept on the genome.
    expect(genome.xforms[0]!.post).toEqual({ a: 1, b: 0, c: 0.5, d: 0, e: 1, f: 0 });
  });
});

describe('Phase 9c xform.post import', () => {
  it('honors a non-identity post', () => {
    // post="0.7 0.0 -0.4 0.5 0.1 0.2" → parseCoefs → (a=0.7, b=-0.4, c=0.1, d=0.0, e=0.5, f=0.2)
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" post="0.7 0.0 -0.4 0.5 0.1 0.2" linear="1"/></flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.post).toEqual({ a: 0.7, b: -0.4, c: 0.1, d: 0.0, e: 0.5, f: 0.2 });
    expect(report.ignoredFields.find((f) => f.field === 'post@xform[0]')).toBeUndefined();
  });

  it('drops identity post (a=e=1, b=c=d=f=0) — leaves field undefined', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" post="1 0 0 1 0 0" linear="1"/></flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.post).toBeUndefined();
    expect(report.ignoredFields.find((f) => f.field === 'post@xform[0]')).toBeUndefined();
  });

  it('honors post on finalxform too', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}<finalxform color="0.5" color_speed="0" coefs="1 0 0 1 0 0" post="0.9 0 0 0.9 0.05 -0.05" linear="1"/></flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.finalxform).toBeDefined();
    expect(genome.finalxform!.post).toEqual({ a: 0.9, b: 0, c: 0.05, d: 0, e: 0.9, f: -0.05 });
    expect(report.ignoredFields.find((f) => f.field.startsWith('post@'))).toBeUndefined();
  });

  it('reports xform index in ignoredFields when post is malformed', () => {
    // 5 numbers instead of 6 → parseCoefs throws.
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" post="1 2 3 4 5" linear="1"/></flame>`;
    expect(() => parseFlame(xml)).toThrow(/coefs/);
  });
});

describe('Phase 9-bg-palmode import', () => {
  it('honors background="R G B"', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" background="0.1 0.2 0.3">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.background).toEqual([0.1, 0.2, 0.3]);
    expect(report.ignoredFields.find((f) => f.field === 'background')).toBeUndefined();
  });

  it('drops background="0 0 0" (default — leaves field undefined)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" background="0 0 0">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.background).toBeUndefined();
    expect(report.ignoredFields.find((f) => f.field === 'background')).toBeUndefined();
  });

  it('honors palette_mode="linear"', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" palette_mode="linear">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.paletteMode).toBe('linear');
    expect(report.ignoredFields.find((f) => f.field === 'palette_mode')).toBeUndefined();
  });

  it('honors palette_mode="step"', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" palette_mode="step">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.paletteMode).toBe('step');
    expect(report.ignoredFields.find((f) => f.field === 'palette_mode')).toBeUndefined();
  });

  it('records unknown palette_mode value to ignoredFields', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" palette_mode="wobble">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.paletteMode).toBeUndefined();
    expect(report.ignoredFields).toContainEqual({ field: 'palette_mode', value: 'wobble' });
  });

  it('honors background + palette_mode together (typical Apophysis case)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" background="0.1 0.2 0.3" palette_mode="linear">${minPalette}${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.background).toEqual([0.1, 0.2, 0.3]);
    expect(genome.paletteMode).toBe('linear');
    expect(report.ignoredFields.find((f) => f.field === 'background')).toBeUndefined();
    expect(report.ignoredFields.find((f) => f.field === 'palette_mode')).toBeUndefined();
  });
});

describe('parseFlame finalxform', () => {
  it('parses <finalxform> with weight=0 and routes to genome.finalxform', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}<finalxform color="0.5" color_speed="0" coefs="1 0 0 1 0 0" julia="1"/></flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.finalxform).toBeDefined();
    expect(genome.finalxform!.weight).toBe(0);
    expect(genome.finalxform!.color).toBe(0.5);
    expect(genome.finalxform!.variations).toEqual([{ index: 13, weight: 1 }]);
  });

  it('omits genome.finalxform when no <finalxform> child', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.finalxform).toBeUndefined();
  });

  it('reports dropped variations on finalxform with isFinal=true', () => {
    // Same rationale as the "drops unknown variations" test above — use a
    // deliberately-fake variation name now that all 99 flam3 kernels are
    // shipped and recognized.
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}<finalxform color="0.5" color_speed="0" coefs="1 0 0 1 0 0" nonexistent="1"/></flame>`;
    const { report } = parseFlame(xml);
    expect(report.droppedVariations).toEqual([
      { name: 'nonexistent', weight: 1, xformIndex: -1, isFinal: true },
    ]);
  });
});

describe('parseFlame multi-flame wrapper', () => {
  it('takes the first <flame> when wrapped in <flames>', () => {
    const flame = (n: string) =>
      `<flame name="${n}" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}</flame>`;
    const xml = `<flames>${flame('alpha')}${flame('beta')}${flame('gamma')}</flames>`;
    const { genome, report } = parseFlame(xml);
    expect(genome.name).toBe('alpha');
    expect(report.flameCount).toBe(3);
    expect(report.flameIndex).toBe(0);
    expect(report.flameName).toBe('alpha');
  });

  it('reports flameCount = 1 for unwrapped single <flame>', () => {
    const xml = `<flame name="solo" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}</flame>`;
    const { report } = parseFlame(xml);
    expect(report.flameCount).toBe(1);
  });
});

describe('parseFlame error paths', () => {
  // PYR3-022: a missing inline palette is no longer fatal — flam3 falls back to
  // its numbered palette library (via `<flame palette="N">`) or, failing that,
  // to PYRE. Either substitution is surfaced loudly in report.paletteFallback.
  it('falls back to PYRE with a loud report when palette is missing entirely', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(report.paletteFallback).toEqual({
      kind: 'pyre-default',
      reason: expect.stringMatching(/no .*block/i),
    });
    expect(genome.palette.stops.length).toBeGreaterThan(0);
  });

  it('loads a flam3 library palette from <flame palette="N"> when no inline block is present', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" palette="0">${minXform}</flame>`;
    const { genome, report } = parseFlame(xml);
    expect(report.paletteFallback).toEqual({ kind: 'library', index: 0 });
    expect(genome.palette.stops).toHaveLength(256);
    // palette 0 "south-sea-bather" first color 00b9eaeb → (185, 234, 235)
    expect(genome.palette.stops[0]!.r).toBeCloseTo(185 / 255, 10);
  });

  it('falls back to PYRE (loud) when the <flame palette="N"> index is out of range', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100" palette="99999">${minXform}</flame>`;
    const { report } = parseFlame(xml);
    expect(report.paletteFallback).toEqual({
      kind: 'pyre-default',
      reason: expect.stringMatching(/out of range/i),
    });
  });

  it('records no paletteFallback when an inline palette is present', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}${minXform}</flame>`;
    const { report } = parseFlame(xml);
    expect(report.paletteFallback).toBeUndefined();
  });

  it('throws on non-finite numeric attribute', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="NaN">${minPalette}${minXform}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/scale/);
  });

  it('throws when xform is missing coefs', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" color_speed="0.5" linear="1"/></flame>`;
    expect(() => parseFlame(xml)).toThrow(/coefs/);
  });

  it('throws on the old <palette index0=...> format', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100"><palette index0="0" index1="10" blend="0.5"/>${minXform}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/old palette format/i);
  });

  it('throws when the flame has no <xform> children (would u32-wrap on GPU)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/no <xform> children/);
  });

  it('throws when the flame has only a <finalxform> (still no chaos pool)', () => {
    const xml = `<flame name="t" size="1024 1024" center="0 0" scale="100">${minPalette}<finalxform color="0.5" color_speed="0" coefs="1 0 0 1 0 0" linear="1"/></flame>`;
    expect(() => parseFlame(xml)).toThrow(/no <xform> children/);
  });
});

describe('parseFlame golden round-trip', () => {
  it('imports a .flame Spiral Galaxy and matches SPIRAL_GALAXY xform shape', () => {
    // Reverse the affine shuffle: pyr3 (a,b,c,d,e,f) → flam3 coefs="a d b e c f"
    //   xform 0: pyr3 (0.85, 0, 0, 0, 0.85, 0)    → coefs "0.85 0 0 0.85 0 0"
    //   xform 1: pyr3 (0.5, -0.3, 0.4, 0.3, 0.5, 0) → coefs "0.5 0.3 -0.3 0.5 0.4 0"
    //   xform 2: pyr3 (0.7, 0, -0.3, 0, 0.7, 0)  → coefs "0.7 0 0 0.7 -0.3 0"
    let palette = '';
    for (let i = 0; i < 256; i++) palette += `<color index="${i}" rgb="${i} ${i} ${i}"/>`;
    const xml = `<flame name="Spiral Galaxy" size="1024 1024" center="0 0" scale="220">
      ${palette}
      <xform weight="0.55" color="0.15" color_speed="0.5" coefs="0.85 0 0 0.85 0 0" julian="1.0" julian_power="2" julian_dist="1"/>
      <xform weight="0.35" color="0.85" color_speed="0.5" coefs="0.5 0.3 -0.3 0.5 0.4 0" spherical="1"/>
      <xform weight="0.1" color="0.5" color_speed="0.5" coefs="0.7 0 0 0.7 -0.3 0" linear="0.5" spherical="0.5"/>
    </flame>`;
    const { genome, report } = parseFlame(xml);

    expect(genome.name).toBe('Spiral Galaxy');
    expect(genome.scale).toBe(220);
    expect(genome.xforms).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const got = genome.xforms[i]!;
      const want = SPIRAL_GALAXY.xforms[i]!;
      expect(got.a).toBeCloseTo(want.a, 6);
      expect(got.b).toBeCloseTo(want.b, 6);
      expect(got.c).toBeCloseTo(want.c, 6);
      expect(got.d).toBeCloseTo(want.d, 6);
      expect(got.e).toBeCloseTo(want.e, 6);
      expect(got.f).toBeCloseTo(want.f, 6);
      expect(got.weight).toBeCloseTo(want.weight, 6);
      expect(got.color).toBeCloseTo(want.color, 6);
      expect(got.colorSpeed).toBeCloseTo(want.colorSpeed, 6);
      expect(got.variations).toEqual(want.variations);
    }

    expect(report.droppedVariations).toEqual([]);
    expect(report.flameCount).toBe(1);
  });
});

describe('parseCoefs', () => {
  it('shuffles flam3 column-major coefs into pyr3 row-major', () => {
    expect(parseCoefs('1 2 3 4 5 6')).toEqual({ a: 1, b: 3, c: 5, d: 2, e: 4, f: 6 });
  });

  it('accepts arbitrary whitespace separators', () => {
    expect(parseCoefs('  1.5\t2.0\n3.5 4.0 5.5 6.0 ')).toEqual({
      a: 1.5, b: 3.5, c: 5.5, d: 2.0, e: 4.0, f: 6.0,
    });
  });

  it('throws on the wrong number of coefs', () => {
    expect(() => parseCoefs('1 2 3 4 5')).toThrow(/coefs/);
    expect(() => parseCoefs('1 2 3 4 5 6 7')).toThrow(/coefs/);
  });

  it('throws on non-finite values', () => {
    expect(() => parseCoefs('1 2 3 4 5 NaN')).toThrow(/coefs/);
  });
});

describe('parseFlame tonemap (Phase 9a)', () => {
  it('extracts gamma/vibrancy/highlight_power/brightness/gamma_threshold from <flame>', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>',
      'gamma="4" vibrancy="1" highlight_power="1" brightness="20.32" gamma_threshold="0.01"',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.tonemap).toEqual({
      gamma: 4,
      vibrancy: 1,
      highlightPower: 1,
      brightness: 20.32,
      gammaThreshold: 0.01,
    });
    const ignoredNames = report.ignoredFields.map((f) => f.field);
    expect(ignoredNames).not.toContain('gamma');
    expect(ignoredNames).not.toContain('vibrancy');
    expect(ignoredNames).not.toContain('highlight_power');
    expect(ignoredNames).not.toContain('brightness');
    expect(ignoredNames).not.toContain('gamma_threshold');
  });

  it('partial tonemap fills missing fields from defaults (flam3-canonical DEFAULT_TONEMAP)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>',
      'gamma="2.2"',
    );
    const { genome } = parseFlame(xml);
    expect(genome.tonemap?.gamma).toBe(2.2);
    // remaining fields fall back to DEFAULT_TONEMAP (flam3-canonical values, Phase 9-cal)
    expect(genome.tonemap?.vibrancy).toBe(0.0);
    expect(genome.tonemap?.brightness).toBe(1.0);
    expect(genome.tonemap?.highlightPower).toBe(1.0);
    expect(genome.tonemap?.gammaThreshold).toBe(0.01);
  });

  it('no tonemap attrs at all → genome.tonemap stays undefined', () => {
    const xml = wrapFlame('<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>');
    const { genome } = parseFlame(xml);
    expect(genome.tonemap).toBeUndefined();
  });
});

describe('parseFlame opacity + chaos (Phase 9d)', () => {
  it('extracts <xform opacity="N"> into xform.opacity', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1" opacity="0.4"/>',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.opacity).toBe(0.4);
    const ignoredNames = report.ignoredFields.map((f) => f.field);
    expect(ignoredNames.some((n) => n.startsWith('opacity@xform'))).toBe(false);
  });

  it('opacity=1.0 omitted from xform.opacity (default treated as undefined)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1" opacity="1"/>',
    );
    const { genome } = parseFlame(xml);
    expect(genome.xforms[0]!.opacity).toBeUndefined();
  });

  it('extracts <xform chaos="..."> into xform.xaos array', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1" chaos="1 1 0"/>',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.xforms[0]!.xaos).toEqual([1, 1, 0]);
    const ignoredNames = report.ignoredFields.map((f) => f.field);
    expect(ignoredNames.some((n) => n.startsWith('xaos@xform'))).toBe(false);
  });

  it('absent opacity + chaos → both undefined', () => {
    const xml = wrapFlame('<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>');
    const { genome } = parseFlame(xml);
    expect(genome.xforms[0]!.opacity).toBeUndefined();
    expect(genome.xforms[0]!.xaos).toBeUndefined();
  });
});

describe('parseFlame rotate (Phase 9-rotate)', () => {
  it('extracts <flame rotate="N"> into genome.rotate (degrees CCW)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>',
      'rotate="90.25"',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.rotate).toBe(90.25);
    const ignoredNames = report.ignoredFields.map((f) => f.field);
    expect(ignoredNames).not.toContain('rotate');
  });

  it('rotate="0" omitted from genome.rotate (treated as no rotation)', () => {
    const xml = wrapFlame(
      '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>',
      'rotate="0"',
    );
    const { genome } = parseFlame(xml);
    expect(genome.rotate).toBeUndefined();
  });

  it('no rotate attr → genome.rotate stays undefined', () => {
    const xml = wrapFlame('<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>');
    const { genome } = parseFlame(xml);
    expect(genome.rotate).toBeUndefined();
  });
});

const xformLinear = '<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/>';

describe('parseFlame size honoring (Phase 9-size)', () => {
  it('extracts <flame size="800 592"> as { width: 800, height: 592 }', () => {
    const xml =
      `<flame name="t" size="800 592" center="0 0" scale="100">${minPalette}${xformLinear}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.size).toEqual({ width: 800, height: 592 });
  });

  it('omits size when the attribute is absent', () => {
    const xml =
      `<flame name="t" center="0 0" scale="100">${minPalette}${xformLinear}</flame>`;
    const { genome } = parseFlame(xml);
    expect(genome.size).toBeUndefined();
  });

  it('rejects size with non-positive integers', () => {
    const xml =
      `<flame name="t" size="0 0" center="0 0" scale="100">${minPalette}${xformLinear}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/positive integers/);
  });

  it('rejects size with non-integer values', () => {
    const xml =
      `<flame name="t" size="100.5 200" center="0 0" scale="100">${minPalette}${xformLinear}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/positive integers/);
  });

  it('rejects size with the wrong number of components', () => {
    const xml =
      `<flame name="t" size="800" center="0 0" scale="100">${minPalette}${xformLinear}</flame>`;
    expect(() => parseFlame(xml)).toThrow(/positive integers/);
  });
});

describe('parseFlame spatial filter honoring (Phase 9-filter)', () => {
  it('extracts filter="1" filter_shape="gaussian"', () => {
    const xml = wrapFlame(xformLinear, 'filter="1" filter_shape="gaussian"');
    const { genome } = parseFlame(xml);
    expect(genome.spatialFilter).toEqual({ radius: 1, shape: 'gaussian' });
  });

  it('defaults filter_shape to gaussian when absent', () => {
    const xml = wrapFlame(xformLinear, 'filter="0.75"');
    const { genome } = parseFlame(xml);
    expect(genome.spatialFilter).toEqual({ radius: 0.75, shape: 'gaussian' });
  });

  // Phase 9-filter-shapes: all 14 flam3 shapes are now honored — the
  // `ignoredFields` path is reserved for genuinely unrecognized shape names
  // (flam3's fallback-to-gaussian behavior, parser.c:436-437).
  it.each([
    'hermite',
    'box',
    'triangle',
    'bell',
    'bspline',
    'mitchell',
    'blackman',
    'catrom',
    'hanning',
    'hamming',
    'lanczos3',
    'lanczos2',
    'quadratic',
  ])('honors filter_shape="%s"', (shape) => {
    const xml = wrapFlame(xformLinear, `filter="1" filter_shape="${shape}"`);
    const { genome, report } = parseFlame(xml);
    expect(genome.spatialFilter).toEqual({ radius: 1, shape });
    expect(report.ignoredFields.some((f) => f.field === 'filter_shape')).toBe(false);
  });

  it('falls back to gaussian for unknown filter_shape, surfaces in ignoredFields', () => {
    const xml = wrapFlame(xformLinear, 'filter="1" filter_shape="nonexistent"');
    const { genome, report } = parseFlame(xml);
    expect(genome.spatialFilter).toEqual({ radius: 1, shape: 'gaussian' });
    expect(
      report.ignoredFields.some(
        (f) => f.field === 'filter_shape' && f.value.startsWith('nonexistent'),
      ),
    ).toBe(true);
  });

  it('treats filter="0" as no filter', () => {
    const xml = wrapFlame(xformLinear, 'filter="0"');
    const { genome } = parseFlame(xml);
    expect(genome.spatialFilter).toBeUndefined();
  });

  it('omits spatialFilter when filter attr is absent', () => {
    const xml = wrapFlame(xformLinear);
    const { genome } = parseFlame(xml);
    expect(genome.spatialFilter).toBeUndefined();
  });

  it('records "filter" in ignoredFields when filter is set but estimator_* is absent', () => {
    // Phase 9-filter v1 simplification: filter requires DE on (input is
    // density.filtered). When the .flame requests filter without DE params,
    // the filter is constructed but never dispatches usefully — surface in
    // ignoredFields so the user sees the lost feature in the HUD report.
    const xml = wrapFlame(xformLinear, 'filter="1" filter_shape="gaussian"');
    const { genome, report } = parseFlame(xml);
    expect(genome.spatialFilter).toEqual({ radius: 1, shape: 'gaussian' });
    expect(genome.density).toBeUndefined();
    expect(
      report.ignoredFields.some((f) => f.field === 'filter'),
    ).toBe(true);
  });

  it('does NOT record "filter" in ignoredFields when both filter and estimator are present', () => {
    const xml = wrapFlame(
      xformLinear,
      'filter="1" filter_shape="gaussian" estimator_radius="11" estimator_minimum="0" estimator_curve="0.6"',
    );
    const { genome, report } = parseFlame(xml);
    expect(genome.spatialFilter).toEqual({ radius: 1, shape: 'gaussian' });
    expect(genome.density).toEqual({ maxRad: 11, minRad: 0, curve: 0.6 });
    expect(report.ignoredFields.some((f) => f.field === 'filter')).toBe(false);
  });
});

describe('per-xform symmetry alias for color_speed', () => {
  const xformSym = (extra: string): string =>
    `<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1" ${extra}/>`;

  it('symmetry="0" yields colorSpeed = 0.5 (matches default)', () => {
    const { genome, report } = parseFlame(wrapFlame(xformSym('symmetry="0"')));
    expect(genome.xforms[0]!.colorSpeed).toBe(0.5);
    expect(report.ignoredFields.find((f) => f.field === 'symmetry')).toBeUndefined();
  });

  it('symmetry="1" yields colorSpeed = 0 (color stays at prior iteration, no blending toward xform.color)', () => {
    const { genome } = parseFlame(wrapFlame(xformSym('symmetry="1"')));
    expect(genome.xforms[0]!.colorSpeed).toBe(0);
  });

  it('symmetry="-1" yields colorSpeed = 1 (extreme contraction)', () => {
    const { genome } = parseFlame(wrapFlame(xformSym('symmetry="-1"')));
    expect(genome.xforms[0]!.colorSpeed).toBe(1);
  });

  it('symmetry="0.5" yields colorSpeed = 0.25 (fractional case)', () => {
    const { genome } = parseFlame(wrapFlame(xformSym('symmetry="0.5"')));
    expect(genome.xforms[0]!.colorSpeed).toBe(0.25);
  });

  it('explicit color_speed wins when both color_speed and symmetry are present', () => {
    const { genome } = parseFlame(
      wrapFlame(xformSym('symmetry="1" color_speed="0.7"')),
    );
    expect(genome.xforms[0]!.colorSpeed).toBe(0.7);
  });

  it('neither attribute set yields colorSpeed = 0.5 (default unchanged)', () => {
    const xform = '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/>';
    const { genome } = parseFlame(wrapFlame(xform));
    expect(genome.xforms[0]!.colorSpeed).toBe(0.5);
  });

  it('symmetry never lands in ImportReport.ignoredFields', () => {
    const { report } = parseFlame(wrapFlame(xformSym('symmetry="1"')));
    expect(report.ignoredFields.some((f) => f.field === 'symmetry')).toBe(false);
  });

  it('symmetry never lands in ImportReport.droppedVariations (kept reserved)', () => {
    const { report } = parseFlame(wrapFlame(xformSym('symmetry="1"')));
    expect(report.droppedVariations.some((d) => d.name === 'symmetry')).toBe(false);
  });
});

describe('parseFlame <flame nick="..."> capture', () => {
  // The Electric Sheep / Apophysis nick attribute carries author
  // attribution. pyr3 displays it as "By <nick>" — never links.
  const wrapWithAttrs = (attrs: string): string =>
    `<flame ${attrs} size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/></flame>`;

  it('captures nick when present', () => {
    const { genome } = parseFlame(wrapWithAttrs('name="test" nick="Brood"'));
    expect(genome.nick).toBe('Brood');
  });

  it('treats absent nick as undefined (clean fallback for bar "By X" attribution)', () => {
    const { genome } = parseFlame(wrapWithAttrs('name="test"'));
    expect(genome.nick).toBeUndefined();
  });

  it('treats empty nick="" as undefined (no "By  " display)', () => {
    const { genome } = parseFlame(wrapWithAttrs('name="test" nick=""'));
    expect(genome.nick).toBeUndefined();
  });

  it('trims surrounding whitespace from nick', () => {
    const { genome } = parseFlame(wrapWithAttrs('name="test" nick="  Brood  "'));
    expect(genome.nick).toBe('Brood');
  });
});

// PYR3-036 safeguard #1 — reachability: EVERY variation in V must survive
// import. A variation defined in the table but silently dropped at parse time
// (the PYR3-034 radial_blur/super_shape class) fails here loudly. This is the
// guard that turns "silent wrong render" into a red test for all ~99 arms.
describe('PYR3-036 — every variation in V survives import (reachability)', () => {
  it('records each variation with its index + weight 1.0; none dropped', () => {
    const failures: string[] = [];
    for (const [name, index] of Object.entries(V)) {
      const xml = wrapFlame(
        `<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" ${name}="1.0"/>`,
      );
      const { genome, report } = parseFlame(xml);
      const vars = genome.xforms[0]!.variations;
      const ok = vars.some((v) => v.index === index && v.weight === 1.0);
      if (!ok) {
        failures.push(
          `${name} (index ${index}): vars=${JSON.stringify(vars)} dropped=${JSON.stringify(report.droppedVariations)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

// PYR3-036 safeguard #2 — curated-corpus assertion: every parity fixture must
// import with nothing dropped (post-loud-parser, droppedVariations also carries
// unrecognized underscored attrs). ALLOWLIST documents any genuinely-unsupported
// attr. Had this existed, the radial_blur drop would have been red on day one.
describe('PYR3-036 — curated parity fixtures import cleanly', () => {
  const dir = join(process.cwd(), 'fixtures', 'flam3-goldens');
  const ids = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  const ALLOWLIST = new Set<string>(); // no genuinely-unsupported attrs expected in the curated set
  it('found the parity fixtures', () => {
    expect(ids.length).toBeGreaterThan(0);
  });
  for (const id of ids) {
    const flam3 = join(dir, id, `${id}.flam3`);
    if (!existsSync(flam3)) continue;
    it(`${id}: no dropped/unrecognized variations`, () => {
      const { report } = parseFlame(readFileSync(flam3, 'utf8'));
      const unexpected = report.droppedVariations.filter((d) => !ALLOWLIST.has(d.name));
      expect(unexpected).toEqual([]);
    });
  }
});

describe('parseFlame multi-flame file handling', () => {
  // Electric Sheep / flam3 `.flam3` files often concatenate multiple
  // <flame> elements at top level without a wrapping root — that's not
  // single-root XML by DOMParser's rules. parseFlame() must accept
  // these and return the first flame.
  const namedFlame = (name: string, xformVariation: string): string =>
    `<flame name="${name}" size="1024 1024" center="0 0" scale="100">${minPalette}<xform weight="1" color="0" coefs="1 0 0 1 0 0" ${xformVariation}/></flame>`;

  it('accepts a file with two concatenated <flame> elements (no wrapping root)', () => {
    const concatenated = namedFlame('alpha', 'linear="1"') + '\n' + namedFlame('beta', 'spherical="1"');
    const { genome } = parseFlame(concatenated);
    expect(genome.name).toBe('alpha');
  });

  it('strips an <?xml ... ?> prolog and still parses the concatenated body', () => {
    const body = namedFlame('alpha', 'linear="1"') + '\n' + namedFlame('beta', 'spherical="1"');
    const withProlog = `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    const { genome } = parseFlame(withProlog);
    expect(genome.name).toBe('alpha');
  });

  it('still accepts a single-flame file (wrapping is a no-op for the first flame)', () => {
    const { genome } = parseFlame(namedFlame('solo', 'linear="1"'));
    expect(genome.name).toBe('solo');
  });
});
