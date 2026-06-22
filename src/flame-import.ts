// pyr3 — Phase 8 .flame XML importer.
//
// One-way compat lane: read upstream .flame files (Apophysis / Electric Sheep /
// JWildfire) and produce a pyr3 Genome + ImportReport. No round-trip — pyr3's
// shipping format is .pyr3.json (Phase 5a). Variations not in pyr3's catalog
// (see src/variations.ts:V) are dropped with explicit per-name reporting; the
// HUD report panel surfaces what the import lost.

import { type Genome, type Symmetry, type Xform, type Pyr3Size, type SpatialFilter, isSpatialFilterShape, MAX_XFORMS } from './genome';
import {
  type Animation,
  type Interpolation,
  type InterpolationType,
  type PaletteInterpolation,
  type TemporalFilterType,
  FLAM3_ANIMATION_DEFAULTS,
} from './animation';
import { type Tonemap, DEFAULT_TONEMAP } from './tonemap';
import { type Density, MAX_RAD_CAP, MIN_CURVE, MAX_CURVE } from './density';
import {
  type Variation,
  type VariationIndex,
  V,
  linear as linearVar,
} from './variations';
import { type ColorStop, type PaletteMode, PYRE_PALETTE } from './palette';
import { getLibraryStops, FLAM3_PALETTE_COUNT } from './flam3-palettes';
import { VARIATION_PARAMS, VARIATION_DEFAULTS, PARAM_KEYS, MAX_VARIATION_PARAMS, type ParamKey } from './serialize';

// v0.13 — flam3-C accepts legacy alias attribute names emitted by older
// Apophysis exports. The canonical-name parser (head=variation, tail=param)
// doesn't recognize these on its own; normalize at attribute-walk time so
// the rest of the pipeline only sees canonical names.
//
// Surfaced by the v0.12 audit B (flame-import.ts XML attribute coverage).
// Without normalization, `Re_A=…` on a mobius xform falls through the
// "not in V" branch and is recorded as a dropped variation, silently losing
// the mobius coefficient. Same shape for `oscope_*` short-form.

// Bare-name attribute aliases (no underscore prefix): map directly to a
// canonical `<variation>_<param>` form. flam3-C parses these at parser.c:1228-1243.
const ATTR_NAME_ALIASES: Record<string, string> = {
  Re_A: 'mobius_re_a',
  Im_A: 'mobius_im_a',
  Re_B: 'mobius_re_b',
  Im_B: 'mobius_im_b',
  Re_C: 'mobius_re_c',
  Im_C: 'mobius_im_c',
  Re_D: 'mobius_re_d',
  Im_D: 'mobius_im_d',
};

// Prefix aliases for `<head>_<param>` attribute names: rewrite the head
// to the canonical variation name. flam3-C parses these at parser.c:1136-1152.
const VAR_PREFIX_ALIASES: Record<string, string> = {
  oscope: 'oscilloscope',
};

function normalizeAttrName(name: string): string {
  const exact = ATTR_NAME_ALIASES[name];
  if (exact !== undefined) return exact;
  const idx = name.indexOf('_');
  if (idx > 0) {
    const head = name.slice(0, idx);
    const canonHead = VAR_PREFIX_ALIASES[head];
    if (canonHead !== undefined) return `${canonHead}${name.slice(idx)}`;
  }
  return name;
}

export interface DroppedVariation {
  name: string;
  weight: number;
  xformIndex: number;
  isFinal?: boolean;
}

export interface IgnoredField {
  field: string;
  value: string;
}

/** #9 — a scalar field whose value was malformed (non-finite / unparseable) and
 *  was replaced with a real working default so the otherwise-fine genome still
 *  renders, instead of aborting the whole load. flam3 accepts "nan" and renders
 *  black; pyr3 deliberately diverges (substitute + surface loudly). Dimensions
 *  default to real values, never 0. */
export interface DefaultedField {
  field: string;
  /** The malformed raw attribute value. */
  value: string;
  /** Human-readable description of the substituted default. */
  usedDefault: string;
}

/** PYR3-022 — how the palette was resolved when the flame had no inline block.
 *  `library`: honored a `<flame palette="N">` reference from flam3's library.
 *  `pyre-default`: no usable palette info, fell back to PYRE (loud, never
 *  silent — the render won't match the author's intent). */
export type PaletteFallback =
  | { kind: 'library'; index: number }
  | { kind: 'pyre-default'; reason: string };

export interface ImportReport {
  flameCount: number;
  flameIndex: number;
  flameName: string;
  droppedVariations: DroppedVariation[];
  ignoredFields: IgnoredField[];
  /** #9 — scalar fields whose malformed values were replaced with real defaults
   *  (e.g. NaN center/scale) so the load could proceed. Empty when none. */
  defaultedFields: DefaultedField[];
  /** Set only when no inline palette was present and a fallback was used. */
  paletteFallback?: PaletteFallback;
  /** Set only when the flame had more xforms than the GPU buffer can hold
   *  (MAX_XFORMS) and the import clamped the count (PYR3-033). */
  clampedXforms?: { had: number; cap: number };
}

export interface FlameImportResult {
  /** First keyframe as a standalone Genome. Always set so legacy callers
   *  that just want "a flame to render" keep working unchanged. When the
   *  source is multi-keyframe, this is the SAME reference as
   *  `animation!.keyframes[0]`. */
  genome: Genome;
  /** Set only when the source `.flam3` carried 2+ `<flame>` elements (a
   *  time-varying sequence). P1 ships read-only; P2 (`flam3_interpolate_n`
   *  port) consumes it to derive a Genome at arbitrary time. */
  animation?: Animation;
  report: ImportReport;
}

interface PyrAffine {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

// flam3 stores coefs as 3×2 column-major: c[0..2][0..1]. Application is:
//   tx = c[0][0]*x + c[1][0]*y + c[2][0]
//   ty = c[0][1]*x + c[1][1]*y + c[2][1]
// So coefs="a b c d e f" parses as columns:
//   (c[0][0],c[0][1],c[1][0],c[1][1],c[2][0],c[2][1]) = (a,b,c,d,e,f)
// pyr3 stores rows: new_x = a*x + b*y + c; new_y = d*x + e*y + f.
// Mapping: (pyr3.a, b, c) = (flam3.a, c, e); (pyr3.d, e, f) = (flam3.b, d, f).
export function parseCoefs(s: string): PyrAffine {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 6 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`pyr3: coefs must be 6 finite numbers, got: ${JSON.stringify(s)}`);
  }
  const [a, b, c, d, e, f] = parts as [number, number, number, number, number, number];
  return { a, b: c, c: e, d: b, e: d, f };
}

// Reserved <xform> attribute names (everything else is potentially a variation
// weight or per-variation param). Matches the explicit branches in flam3's
// parse_xform_xml (parser.c:854-972) for non-variation fields.
// `symmetry` is the deprecated alias for `color_speed` (see per-xform
// parser below) — kept reserved here so the variation-scan loop doesn't
// mistake it for an unknown variation and report it in droppedVariations.
const XFORM_RESERVED = new Set([
  'weight', 'color', 'color_speed', 'symmetry', 'coefs', 'post', 'opacity',
  'animate', 'chaos', 'plotmode', 'var', 'var1',
  'motion_frequency', 'motion_function',
]);

// PYR3-036: every valid `<variation>_<param>` attribute name, derived from
// VARIATION_PARAMS. Lets the xform scan tell a recognized per-variation param
// (read by readVariationParams) apart from an attribute we don't understand —
// so the latter is surfaced in the report rather than silently swallowed (the
// failure mode that hid the radial_blur drop, PYR3-034).
const KNOWN_PARAM_ATTRS = new Set<string>();
for (const [varName, paramNames] of Object.entries(VARIATION_PARAMS)) {
  for (const pn of paramNames) KNOWN_PARAM_ATTRS.add(`${varName}_${pn}`);
}

function parseSymmetryChild(flame: Element): Symmetry | undefined {
  const sym = flame.querySelector(':scope > symmetry');
  if (!sym) return undefined;
  const kindAttr = sym.getAttribute('kind');
  if (kindAttr === null) throw new Error('pyr3: <symmetry> missing kind');
  const k = Number(kindAttr);
  if (!Number.isInteger(k) || k === 0) {
    throw new Error(`pyr3: <symmetry kind="${kindAttr}"> must be a non-zero integer`);
  }
  return k > 0 ? { kind: 'rotational', n: k } : { kind: 'dihedral', n: -k };
}

function parseDensity(flame: Element): Density | undefined {
  const r = flame.getAttribute('estimator_radius');
  const m = flame.getAttribute('estimator_minimum');
  const c = flame.getAttribute('estimator_curve');
  if (r === null && m === null && c === null) return undefined;
  const maxRad = r !== null ? expectFiniteNumber(r, 'estimator_radius') : 9;
  const minRad = m !== null ? expectFiniteNumber(m, 'estimator_minimum') : 0;
  const curve = c !== null ? expectFiniteNumber(c, 'estimator_curve') : 0.4;
  if (maxRad < 0 || maxRad > MAX_RAD_CAP) {
    throw new Error(`pyr3: estimator_radius out of range [0, ${MAX_RAD_CAP}]: ${maxRad}`);
  }
  if (minRad < 0 || minRad > maxRad) {
    throw new Error(`pyr3: estimator_minimum must be in [0, estimator_radius]: ${minRad}`);
  }
  if (curve < MIN_CURVE || curve > MAX_CURVE) {
    throw new Error(`pyr3: estimator_curve out of range [${MIN_CURVE}, ${MAX_CURVE}]: ${curve}`);
  }
  return { maxRad, minRad, curve };
}

function parseCenter(flame: Element, defaulted: DefaultedField[]): { cx: number; cy: number } {
  const c = flame.getAttribute('center');
  if (c === null) return { cx: 0, cy: 0 };
  const parts = c.trim().split(/\s+/).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    // #9: a malformed center (e.g. "nan nan" — 286 corpus flames carry it)
    // must not abort the whole load. The rest of the genome is fine; fall back
    // to the origin (a real coordinate that frames Electric Sheep flames) and
    // surface the substitution loudly.
    defaulted.push({ field: 'center', value: c, usedDefault: '0 0' });
    return { cx: 0, cy: 0 };
  }
  return { cx: parts[0]!, cy: parts[1]! };
}

// #9: parse a scalar attribute that has a real working default. Absent → use
// the default silently (flam3-compatible). Present-but-malformed (e.g. "nan" —
// the 286 corrupt corpus flames pair a NaN scale with their NaN center) → use
// the default AND record a loud report entry, rather than aborting the load.
// NOTE: the default VALUE for scale (100 vs flam3's 50) is tracked separately
// in #17; this only governs malformed-value recovery, not the default itself.
function parseScalarOrDefault(
  raw: string | null,
  field: string,
  fallback: number,
  defaulted: DefaultedField[],
): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    defaulted.push({ field, value: raw, usedDefault: String(fallback) });
    return fallback;
  }
  return n;
}

function parseHexBytes(hex: string): number[] {
  const stripped = hex.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(stripped) || stripped.length % 2 !== 0) {
    throw new Error(
      `pyr3: palette hex data malformed: ${JSON.stringify(stripped.slice(0, 32))}…`,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < stripped.length; i += 2) {
    out.push(parseInt(stripped.slice(i, i + 2), 16));
  }
  return out;
}

function parsePalette(flame: Element): { stops: ColorStop[]; fallback?: PaletteFallback } {
  // Initialize 256 stops to black.
  const rgb: Array<{ r: number; g: number; b: number }> = [];
  for (let i = 0; i < 256; i++) rgb.push({ r: 0, g: 0, b: 0 });

  let any = false;

  // Format 1: per-color elements (<color index=N rgb="r g b"/>).
  const colorEls = flame.querySelectorAll(':scope > color');
  if (colorEls.length > 0) {
    any = true;
    const provided = new Set<number>();
    for (const el of Array.from(colorEls)) {
      const indexAttr = el.getAttribute('index');
      if (indexAttr === null) throw new Error('pyr3: <color> missing index');
      const idx = Number(indexAttr);
      if (!Number.isInteger(idx) || idx < 0 || idx > 255) {
        throw new Error(`pyr3: <color index="${indexAttr}"> must be 0-255`);
      }
      const triple = el.getAttribute('rgb') ?? el.getAttribute('rgba');
      if (triple === null) throw new Error(`pyr3: <color index="${idx}"> missing rgb/rgba`);
      const parts = triple.trim().split(/\s+/).map(Number);
      if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error(`pyr3: <color index="${idx}"> bad rgb: ${JSON.stringify(triple)}`);
      }
      
      let r = parts[0]! / 255;
      let g = parts[1]! / 255;
      let b = parts[2]! / 255;

      // #17 fix (e) — alpha premultiply
      let alpha = 1.0;
      const aAttr = el.getAttribute('a');
      if (aAttr !== null) {
        alpha = expectFiniteNumber(aAttr, 'a');
        if (alpha > 1.0) alpha /= 255;
      } else if (parts.length >= 4) {
        alpha = parts[3]!;
        if (alpha > 1.0) alpha /= 255;
      }

      rgb[idx] = { r: r * alpha, g: g * alpha, b: b * alpha };
      provided.add(idx);
    }

    // #17 fix (d) — interpolate missing colors for sparse palettes
    if (provided.size > 0 && provided.size < 256) {
      let first = 0;
      while (!provided.has(first)) first++;
      
      let lastProvided = first;
      for (let i = first + 1; i <= first + 256; i++) {
        const curr = i % 256;
        if (provided.has(curr)) {
          let dist = curr - lastProvided;
          if (dist < 0) dist += 256;
          for (let j = 1; j < dist; j++) {
            const idx = (lastProvided + j) % 256;
            const t = j / dist;
            rgb[idx] = {
              r: rgb[lastProvided]!.r * (1 - t) + rgb[curr]!.r * t,
              g: rgb[lastProvided]!.g * (1 - t) + rgb[curr]!.g * t,
              b: rgb[lastProvided]!.b * (1 - t) + rgb[curr]!.b * t,
            };
          }
          lastProvided = curr;
        }
      }
    }
  }

  // Format 2: <colors data="hex..."> packed-hex. flam3 layout per parser.c:102-103
  // is `00RRGGBB` (4 bytes/entry, alpha placeholder always 00 first, then RGB).
  const colorsEl = flame.querySelector(':scope > colors');
  if (colorsEl) {
    any = true;
    const data = colorsEl.getAttribute('data') ?? '';
    const bytes = parseHexBytes(data);
    if (bytes.length < 256 * 4) {
      throw new Error(
        `pyr3: <colors data> needs ≥ 1024 hex bytes, got ${bytes.length}`,
      );
    }
    for (let i = 0; i < 256; i++) {
      rgb[i] = {
        r: bytes[i * 4 + 1]! / 255,
        g: bytes[i * 4 + 2]! / 255,
        b: bytes[i * 4 + 3]! / 255,
      };
    }
  }

  // Format 3: <palette count="N" format="RGB|RGBA"> inline content.
  const paletteEl = flame.querySelector(':scope > palette');
  if (paletteEl) {
    // Reject the OLD format (no inline content; uses index0/blend attributes
    // referencing the upstream gradient bank — out of scope for v1).
    if (paletteEl.hasAttribute('index0') || paletteEl.hasAttribute('blend')) {
      throw new Error(
        'pyr3: old palette format (<palette index0=... blend=...>) not supported',
      );
    }
    any = true;
    const fmt = paletteEl.getAttribute('format') ?? 'RGB';
    const stride = fmt === 'RGBA' ? 4 : 3;
    const bytes = parseHexBytes(paletteEl.textContent ?? '');
    const count = Math.min(256, Math.floor(bytes.length / stride));
    for (let i = 0; i < count; i++) {
      rgb[i] = {
        r: bytes[i * stride]! / 255,
        g: bytes[i * stride + 1]! / 255,
        b: bytes[i * stride + 2]! / 255,
      };
    }
  }

  if (any) {
    return { stops: rgb.map((c, i) => ({ t: i / 255, r: c.r, g: c.g, b: c.b })) };
  }

  // No inline palette block. flam3 falls back to its numbered palette library
  // when the flame references one via `<flame palette="N">` (parser.c:380 +
  // flam3_get_palette). If there's no such reference either, there's no color
  // information at all and we use PYRE. Both substitutions are surfaced in the
  // report — loud, never silent (the PYR3-034 lesson).
  const palAttr = flame.getAttribute('palette');
  if (palAttr !== null && palAttr.trim() !== '') {
    const idx = Number(palAttr);
    const libStops = getLibraryStops(idx);
    if (libStops) {
      return { stops: libStops, fallback: { kind: 'library', index: idx } };
    }
    return {
      stops: PYRE_PALETTE.stops,
      fallback: {
        kind: 'pyre-default',
        reason: `<flame palette="${palAttr}"> out of range [0, ${FLAM3_PALETTE_COUNT - 1}]`,
      },
    };
  }
  return {
    stops: PYRE_PALETTE.stops,
    fallback: {
      kind: 'pyre-default',
      reason: 'no <color>/<colors>/<palette> block and no <flame palette="N"> index',
    },
  };
}

function expectFiniteNumber(s: string, field: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`pyr3: ${field} must be a finite number, got: ${JSON.stringify(s)}`);
  }
  return n;
}

// Per-variation params follow the `${varName}_${paramName}` prefix convention
// in flam3 (e.g. `julian_power`, `julian_dist`, `pdj_a..pdj_d`). pyr3's
// VARIATION_PARAMS table names the params in positional order — reuse that
// as the source of truth. The seam currently exposes MAX_VARIATION_PARAMS
// (=10) param slots (#120).
type VariationParams = Partial<Record<ParamKey, number>>;

function readVariationParams(
  attrs: ReadonlyMap<string, string>,
  varName: string,
): VariationParams {
  const paramNames = VARIATION_PARAMS[varName];
  if (!paramNames) return {};
  const defaults = VARIATION_DEFAULTS[varName];
  const out: VariationParams = {};
  const n = Math.min(paramNames.length, MAX_VARIATION_PARAMS);
  for (let i = 0; i < n; i++) {
    const pn = paramNames[i];
    const pk = PARAM_KEYS[i];
    if (pn === undefined || pk === undefined) continue;
    const key = `${varName}_${pn}`;
    const raw = attrs.get(key);
    if (raw !== undefined) {
      out[pk] = expectFiniteNumber(raw, key);
    } else if (defaults !== undefined && defaults[i] !== undefined) {
      // v0.13: apply per-variation canonical default for unspecified params.
      out[pk] = defaults[i];
    }
  }
  return out;
}

interface XformParseResult {
  xform: Xform;
  dropped: DroppedVariation[];
  ignored: IgnoredField[];
}

function parseXformElement(
  el: Element,
  xformIndex: number,
  isFinal: boolean,
  colorFallback: number,
  inMotion = false,
): XformParseResult {
  const dropped: DroppedVariation[] = [];
  const ignored: IgnoredField[] = [];

  // Local mirror of parseScalarOrDefault — same NaN-recovery semantics
  // (record + substitute, don't throw) but writes to `ignored` since
  // parseXformElement doesn't own the defaulted-fields stream. Used for
  // xform scalars that the wild corpus has been known to malform (e.g.
  // `color="0 1"` — a space-separated pair where a single number was
  // expected, observed in gen 191 ids 4902..4974 during the v0.7 bake).
  const numOrDefault = (
    raw: string | null,
    field: string,
    fallback: number,
  ): number => {
    if (raw === null) return fallback;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    ignored.push({ field: `${field}@xform[${xformIndex}]`, value: raw });
    return fallback;
  };

  const weightAttr = el.getAttribute('weight');
  const weight = isFinal
    ? 0
    : numOrDefault(weightAttr, 'weight', 1);
  // #17 fix (b) — flam3 parser.c defaults the per-xform color attr to
  // alternating 0/1 by position when missing, NOT to 0. The 0 default
  // surfaced for hand-authored / legacy Apophysis flames whose xforms
  // omit `color="..."`. The ESF corpus is unaffected (every shipped
  // flame carries explicit color attrs). finalxform also gets the parity
  // default — flam3 treats it consistently.
  //
  // #165 fix — the original `xformIndex & 1` produced color=1 for
  // finalxform (xformIndex=-1 → -1 & 1 = 1 in two's-complement), which
  // is the constant top of the palette regardless of how many regular
  // xforms precede it. Caller now passes an explicit `colorFallback`
  // (= regularIndex for regular xforms; = xforms.length for finalxform,
  // i.e. the conceptual next position).
  const color = numOrDefault(el.getAttribute('color'), 'color', colorFallback & 1);
  // flam3 parser.c:856-861 — `symmetry` is the deprecated alias for color_speed
  // with the formula color_speed = (1 - N) / 2. Explicit color_speed wins over
  // the deprecated form (modern attribute takes precedence).
  const colorSpeedAttr = el.getAttribute('color_speed');
  const symmetryAttr = el.getAttribute('symmetry');
  let colorSpeed: number;
  if (colorSpeedAttr !== null) {
    colorSpeed = numOrDefault(colorSpeedAttr, 'color_speed', 0);
  } else if (symmetryAttr !== null) {
    const sym = numOrDefault(symmetryAttr, 'symmetry', 1);
    colorSpeed = (1 - sym) / 2;
  } else {
    colorSpeed = 0.5;
  }

  const coefsAttr = el.getAttribute('coefs');
  let aff: PyrAffine;
  if (coefsAttr === null) {
    if (!inMotion) {
      throw new Error(`pyr3: xform[${xformIndex}] missing coefs`);
    }
    // Motion elements are "delta xforms" that overlay onto the parent (P3).
    // flam3 treats a motion element's missing coefs as "no affine contribution"
    // (zero deltas), not identity. Storing zeros here lets P3 add cleanly.
    aff = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  } else {
    aff = parseCoefs(coefsAttr);
  }

  // v0.13: normalize attribute names first (mobius `Re_A` shorthand,
  // `oscope_*` prefix alias). Walker + readVariationParams both read from
  // this normalized Map instead of touching the DOM directly.
  const normAttrs = new Map<string, string>();
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a) normAttrs.set(normalizeAttrName(a.name), a.value);
  }

  // Walk attributes; for each that names a known pyr3 variation, record its
  // weight + params; for each unknown name (and not reserved or a known
  // variation's param), record as dropped.
  const variations: Variation[] = [];
  for (const [name, value] of normAttrs) {
    if (XFORM_RESERVED.has(name)) continue;
    // PYR3-034: test `name in V` BEFORE the underscore split below. Variation
    // names can THEMSELVES contain underscores (radial_blur, gaussian_blur,
    // pre_blur). The old code hit the `name.includes('_')` branch first and
    // split on the first `_` (`radial_blur` → head `radial` ∉ V), silently
    // dropping the weight attribute — so e.g. radial_blur never deposited and
    // electricsheep.243.00171 lost its entire halo. Matching the full name
    // first records the variation; genuine `<var>_<param>` attrs still fall
    // through to the param branch.
    if (name in V) {
      const w = expectFiniteNumber(value, name);
      // #17 fix (f) — flam3 treats explicit `weight=0` as a real variation
      // that contributes nothing per-iter (degenerate point), NOT as
      // "absent". The previous `continue` here meant an xform with ONLY
      // weight=0 variations would fall through to the empty-variation
      // fallback below and get `linear(1)` force-substituted — which
      // turns the degenerate point into an identity passthrough. ESF
      // corpus is unaffected (no shipped flame has weight=0 vars).
      // Record the zero-weight variation so the chain stays non-empty.
      const idx = V[name as keyof typeof V] as VariationIndex;
      const variation: Variation = { index: idx, weight: w };
      const params = readVariationParams(normAttrs, name);
      for (const pk of PARAM_KEYS) {
        const v = params[pk];
        if (v !== undefined) variation[pk] = v;
      }
      variations.push(variation);
      continue;
    }
    if (name.includes('_')) {
      // Recognized `<var>_<param>` (julian_power, radial_blur_angle, …) → read
      // by readVariationParams when its parent variation is recorded.
      if (KNOWN_PARAM_ATTRS.has(name)) continue;
      // PYR3-036: underscored, not a known variation, not a recognized param →
      // surface it instead of silently swallowing it (the class of bug that hid
      // the radial_blur drop). Reuses the droppedVariations channel.
      const uw = Number(value);
      const drop: DroppedVariation = { name, weight: Number.isFinite(uw) ? uw : 0, xformIndex };
      if (isFinal) drop.isFinal = true;
      dropped.push(drop);
      continue;
    }
    // Single-token name that is not a known variation → dropped variation.
    const w = expectFiniteNumber(value, name);
    const drop: DroppedVariation = { name, weight: w, xformIndex };
    if (isFinal) drop.isFinal = true;
    dropped.push(drop);
  }

  // Empty-variation fallback: keep xform selectable in the chaos pool. Applies
  // both when all variations were dropped AND when none were specified at all.
  // Motion elements (P1 #206) skip this — empty variation deltas are valid.
  if (variations.length === 0 && !inMotion) {
    variations.push(linearVar(1));
  }

  // Phase 9c: parse <xform post="a b c d e f"> → Xform.post (same row-major
  // mapping as the regular coefs — see parseCoefs at the top of this file).
  // Identity post (a=e=1, b=c=d=f=0) collapses to undefined to keep the
  // serialized JSON clean — the post-affine multiplication on identity is
  // a no-op.
  let post: PyrAffine | undefined;
  const postAttr = el.getAttribute('post');
  if (postAttr !== null) {
    post = parseCoefs(postAttr);
    if (post.a === 1 && post.b === 0 && post.c === 0 && post.d === 0 && post.e === 1 && post.f === 0) {
      post = undefined;
    }
  }

  // Phase 9d: extract opacity (default 1.0 → omitted) and chaos (per-source
  // weight multipliers; whitespace-separated). flam3's "trailing 1.0"
  // shorthand is preserved in the array — the WGSL fill defaults missing
  // entries to 1.0, so we store exactly what the .flame supplied.
  let opacity: number | undefined;
  const opacityAttr = el.getAttribute('opacity');
  if (opacityAttr !== null) {
    const v = expectFiniteNumber(opacityAttr, `opacity@xform[${xformIndex}]`);
    if (v !== 1.0) opacity = v;
  }

  let xaos: number[] | undefined;
  const chaosAttr = el.getAttribute('chaos');
  if (chaosAttr !== null) {
    xaos = chaosAttr
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0)
      .map((s, i) => expectFiniteNumber(s, `chaos@xform[${xformIndex}][${i}]`));
    if (xaos.length === 0) xaos = undefined;
  }

  const xform: Xform = {
    a: aff.a, b: aff.b, c: aff.c, d: aff.d, e: aff.e, f: aff.f,
    weight, color, colorSpeed, variations,
  };
  if (opacity !== undefined) xform.opacity = opacity;
  if (xaos !== undefined) xform.xaos = xaos;
  if (post !== undefined) xform.post = post;

  // P1 of Animation milestone (#17) — per-xform animation fields.
  // - `motion_frequency` (flam3 variations.c:2479): integer cycle multiplier;
  //   pyr3 stores Numbers (no integer narrowing) to round-trip cleanly.
  // - `motion_function` (variations.c:2480, parser.c:868-872): named enum.
  // - `animate` (variations.c:2475, parser.c default 1): rotation winding flag.
  const motionFreqAttr = el.getAttribute('motion_frequency');
  if (motionFreqAttr !== null) {
    const v = numOrDefault(motionFreqAttr, 'motion_frequency', 0);
    if (v !== 0) xform.motion_freq = v;
  }
  const motionFuncAttr = el.getAttribute('motion_function');
  if (motionFuncAttr !== null) {
    const code = parseMotionFuncName(motionFuncAttr);
    if (code === undefined) {
      ignored.push({ field: `motion_function@xform[${xformIndex}]`, value: motionFuncAttr });
    } else if (code !== 0) {
      xform.motion_func = code;
    }
  }
  const animateAttr = el.getAttribute('animate');
  if (animateAttr !== null) {
    const v = numOrDefault(animateAttr, 'animate', 1);
    // Omit when equal to flam3 default (1.0) — keeps serialized JSON clean.
    if (v !== 1) xform.animate = v;
  }

  // P1 #206 — `<motion>` child elements are per-xform animation overlays.
  // Each is parsed as a partial xform (coefs optional, empty-variation fallback
  // off). Skip recursion when ALREADY in a motion element — flam3 has no
  // nested motion semantics (apply_motion_parameters in flam3.c:641-754
  // walks a single-level array).
  if (!inMotion) {
    const motionEls = Array.from(el.children).filter((c) => c.tagName === 'motion');
    if (motionEls.length > 0) {
      const motion: Xform[] = [];
      for (let mi = 0; mi < motionEls.length; mi++) {
        const me = motionEls[mi]!;
        const { xform: mx, dropped: md, ignored: mig } = parseXformElement(
          me,
          xformIndex,
          /* isFinal */ false,
          /* colorFallback */ 0,
          /* inMotion */ true,
        );
        motion.push(mx);
        // Surface motion-scoped drops/ignored in the parent xform's report so
        // the user sees what was lost in motion overlays too.
        for (const d of md) dropped.push({ ...d, name: `motion[${mi}].${d.name}` });
        for (const ig of mig) ignored.push({ field: `motion[${mi}].${ig.field}`, value: ig.value });
      }
      if (motion.length > 0) xform.motion = motion;
    }
  }

  return { xform, dropped, ignored };
}

/** flam3 motion_function enum (parser.c:868-872). Returns undefined for
 *  unrecognized names so the parser can surface them in the report. */
function parseMotionFuncName(s: string): 0 | 1 | 2 | 3 | undefined {
  const t = s.trim().toLowerCase();
  if (t === '' || t === 'none' || t === '0') return 0;
  if (t === 'sin' || t === 'sine' || t === '1') return 1;
  if (t === 'triangle' || t === '2') return 2;
  if (t === 'hill' || t === '3') return 3;
  return undefined;
}

function wrapInFlamesRoot(xml: string): string {
  let body = xml.trim();
  // Strip optional <?xml ... ?> prolog (must sit at the very start
  // of an XML document; can't appear inside an element).
  if (body.startsWith('<?xml')) {
    const close = body.indexOf('?>');
    if (close > 0) body = body.slice(close + 2).trim();
  }
  return `<flames>${body}</flames>`;
}

export function parseFlame(xml: string): FlameImportResult {
  // Electric Sheep / flam3 multi-flame `.flam3` files concatenate multiple
  // <flame> elements at the top level without a wrapping root. That's not
  // well-formed XML by DOMParser's rules ("Extra content at the end of
  // the document"). Pre-strip any XML prolog and wrap the body in a
  // synthetic <flames> root so DOMParser sees a single-root document.
  // Re-wrapping a file that already has a <flames> root (or a single
  // <flame>) is harmless — querySelectorAll('flame') still finds them.
  const wrapped = wrapInFlamesRoot(xml);
  const doc = new DOMParser().parseFromString(wrapped, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new Error(`pyr3: malformed .flame XML: ${parserError.textContent ?? ''}`);
  }
  const flames = doc.querySelectorAll('flame');
  if (flames.length === 0) {
    throw new Error('pyr3: no <flame> element found');
  }
  // P1 #206 — parse every <flame> element. Multi-keyframe `.flam3` files
  // (Electric Sheep sequences are 2-keyframe) produce an Animation wrapper
  // alongside the first-keyframe Genome; single-keyframe files return
  // { genome, report } unchanged.
  const parsedKeyframes = Array.from(flames).map((f, i) =>
    parseSingleFlame(f, i, flames.length),
  );
  const first = parsedKeyframes[0]!;

  // Multi-keyframe: build an Animation. Cross-keyframe interp/temporal
  // settings are read from the FIRST flame — matches flam3-C, where
  // interpolation.c references `cpi[0].interpolation` / `interpolation_type`
  // / etc rather than any per-keyframe value.
  let animation: Animation | undefined;
  if (parsedKeyframes.length > 1) {
    const keyframes = parsedKeyframes.map((k) => k.genome);
    // Sort defensively by time (ESF emits ascending; hand-authored may not).
    keyframes.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    animation = readAnimationFromFlame(flames[0]!, keyframes);
  }

  // Report carries the first keyframe's import metadata. Per-keyframe reports
  // for multi-keyframe imports can surface in a P6 follow-up if useful.
  const report: ImportReport = {
    flameCount: flames.length,
    flameIndex: 0,
    flameName: first.genome.name,
    droppedVariations: first.droppedVariations,
    ignoredFields: first.ignoredFields,
    defaultedFields: first.defaultedFields,
    ...(first.paletteFallback ? { paletteFallback: first.paletteFallback } : {}),
    ...(first.clampedXforms ? { clampedXforms: first.clampedXforms } : {}),
  };

  return animation
    ? { genome: first.genome, animation, report }
    : { genome: first.genome, report };
}

interface ParsedKeyframe {
  genome: Genome;
  droppedVariations: DroppedVariation[];
  ignoredFields: IgnoredField[];
  defaultedFields: DefaultedField[];
  paletteFallback?: PaletteFallback;
  clampedXforms?: { had: number; cap: number };
}

function parseSingleFlame(flame: Element, _flameIndex: number, flameCount: number): ParsedKeyframe {
  const xformEls = Array.from(flame.children).filter(
    (c) => c.tagName === 'xform' || c.tagName === 'finalxform',
  );

  const xforms: Xform[] = [];
  let finalxform: Xform | undefined;
  const droppedVariations: DroppedVariation[] = [];
  const ignoredFields: IgnoredField[] = [];
  const defaultedFields: DefaultedField[] = [];

  let regularIndex = 0;
  for (const el of xformEls) {
    const isFinal = el.tagName === 'finalxform';
    const idx = isFinal ? -1 : regularIndex;
    // colorFallback: position parity for the color-attr default. Both regular
    // and final xforms use the running regular-xform count — for finalxform
    // that count is its conceptual position-after-the-block (the prior
    // `xformIndex & 1` would have hit -1 & 1 = 1, always palette-top). See #165
    // fix in parseXformElement.
    const colorFallback = regularIndex;
    const { xform, dropped, ignored } = parseXformElement(el, idx, isFinal, colorFallback);
    droppedVariations.push(...dropped);
    ignoredFields.push(...ignored);
    if (isFinal) finalxform = xform;
    else { xforms.push(xform); regularIndex++; }
  }

  // Reject zero-xform genomes: the chaos game picks each iteration's transform
  // from the host-built `xform_distrib` cumulative distribution table
  // (chaos.wgsl). With no regular xforms that table is degenerate — there is no
  // transform to apply, so nothing is ever deposited. A finalxform-only flame
  // is unrenderable for the same reason. (PYR3-065: the old comment cited a
  // `num_xforms - 1u` u32-wrap OOB read that the distribution-table rewrite
  // removed — kept the guard, corrected the rationale.)
  if (xforms.length === 0) {
    throw new Error('pyr3: <flame> has no <xform> children; cannot render');
  }

  // PYR3-033 guard: the GPU xform / xaos / xform_distrib buffers are fixed at
  // (MAX_XFORMS + 1) slots. A genome with more xforms would overflow the
  // writeBuffer — Dawn silently drops it and the render comes out pure black.
  // Clamp loudly + record so the failure degrades to "fewer xforms" (still an
  // image) rather than a silent black canvas. MAX_XFORMS is sized to cover all
  // known realistic flames, so this rarely fires.
  let clampedXforms: { had: number; cap: number } | undefined;
  if (xforms.length > MAX_XFORMS) {
    clampedXforms = { had: xforms.length, cap: MAX_XFORMS };
    console.warn(
      `pyr3: flame has ${xforms.length} xforms, above the ${MAX_XFORMS}-xform cap — `
        + `keeping the first ${MAX_XFORMS}. The render will differ from the source. (PYR3-033)`,
    );
    xforms.length = MAX_XFORMS;
  }

  // Genome-level fields pyr3 doesn't model yet — record them in the report
  // so the user sees what the import couldn't honor.
  // Phase 9a: gamma / vibrancy / highlight_power / brightness / gamma_threshold
  // are now honored via genome.tonemap below — removed from this list.
  // Phase 9-rotate: `rotate` honored. Phase 9-cal-B: `quality` + `supersample` honored.
  // Phase 9-size: `size` honored. Phase 9-filter: `filter` + `filter_shape` honored
  // when shape=gaussian (otherwise filter_shape recorded below as ignored).
  // `rot_center` stays here (rare flam3 field; defaults to `center`); surfaces any
  // fixture that sets it independently so the report flags the silent-divergence risk.
  //
  // P1 #206 — `temporal_filter_*` and `temporal_samples` are now consumed by
  // `readAnimationFromFlame` when the source is multi-keyframe. For single-
  // keyframe imports they're still functionally unused (flam3-render forces
  // ntemporal_samples=1 anyway), so they stay on the ignored list ONLY when
  // we're parsing a static single-keyframe file. Multi-keyframe parses skip
  // them — the Animation wrapper carries them for P5.
  const GENOME_IGNORED = flameCount > 1
    ? ['zoom', 'oversample', 'hue', 'rot_center']
    : [
        'zoom', 'oversample',
        'temporal_filter_type', 'temporal_filter_width',
        'temporal_filter_exp', 'hue', 'rot_center',
      ];
  for (const fname of GENOME_IGNORED) {
    const v = flame.getAttribute(fname);
    if (v !== null) ignoredFields.push({ field: fname, value: v });
  }

  // Phase 9-size: extract <flame size="W H"> (positive integers).
  let size: Pyr3Size | undefined;
  const sizeAttr = flame.getAttribute('size');
  if (sizeAttr !== null) {
    const parts = sizeAttr.trim().split(/\s+/).map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n) || n <= 0)) {
      // #9: a malformed size must not abort the load and must NOT collapse to
      // 0×0. Leave `size` unset so the consumer falls back to the real viewer
      // canvas default (a working dimension), and surface it loudly.
      defaultedFields.push({
        field: 'size',
        value: sizeAttr,
        usedDefault: 'viewer canvas default',
      });
    } else {
      size = { width: parts[0]!, height: parts[1]! };
    }
  }

  // Phase 9-filter / 9-filter-shapes: extract <flame filter="N"
  // filter_shape="<shape>">. flam3 defaults shape to gaussian when
  // filter_shape is absent OR unrecognized (parser.c:407-437 — warns to
  // stderr and falls through to gaussian on unknown). pyr3 mirrors the
  // fallback but surfaces the unknown shape in `ignoredFields` so the user
  // sees what was substituted.
  let spatialFilter: SpatialFilter | undefined;
  const filterAttr = flame.getAttribute('filter');
  const filterShapeAttr = flame.getAttribute('filter_shape');
  if (filterAttr !== null) {
    const radius = expectFiniteNumber(filterAttr, 'filter');
    if (radius > 0) {
      const rawShape = filterShapeAttr ?? 'gaussian';
      if (isSpatialFilterShape(rawShape)) {
        spatialFilter = { radius, shape: rawShape };
      } else {
        // Unknown shape: fall back to gaussian (flam3's behavior) AND surface
        // the substitution in the report so the user sees what was lost.
        ignoredFields.push({ field: 'filter_shape', value: `${rawShape} (unknown — falling back to gaussian)` });
        spatialFilter = { radius, shape: 'gaussian' };
      }
    }
  }

  const { stops, fallback: paletteFallback } = parsePalette(flame);
  // Empty string when the XML carries no `name` attribute; the caller decides
  // the fallback (file basename for user uploads, gen/id-derived for corpus
  // loads) — leaving 'imported' here would leak into the Save filename and
  // the document title even when a more informative label is available.
  const flameName = flame.getAttribute('name') ?? '';
  // Author nick. Top-level `<flame nick="...">` first (Apophysis
  // convention; rare on ESF). When absent, fall back to the outermost
  // `<edit nick="...">` in the lineage chain — that's the most recent
  // authorship signal on Electric-Sheep .flam3 files (which carry nick
  // ONLY inside `<edit>` chain entries, never on the flame attr itself).
  // Empty / whitespace-only values are treated as absent.
  const topNick = flame.getAttribute('nick')?.trim();
  let flameNick: string | undefined;
  if (topNick && topNick.length > 0) {
    flameNick = topNick;
  } else {
    // querySelector returns the first match in document order = outermost
    // `<edit>` with a nick. Walk on the live DOM, not a string regex, so
    // attribute-quoting/whitespace edge cases stay correct.
    const editWithNick = flame.querySelector('edit[nick]');
    const chainNick = editWithNick?.getAttribute('nick')?.trim();
    if (chainNick && chainNick.length > 0) flameNick = chainNick;
  }
  const { cx, cy } = parseCenter(flame, defaultedFields);
  const symmetry = parseSymmetryChild(flame);
  const density = parseDensity(flame);

  // Phase 9a: extract flam3-canonical tone-map params. Any field present →
  // commit a fully-populated Tonemap (filling the rest from DEFAULT_TONEMAP).
  // No fields present → tonemap stays undefined (consumer falls through to
  // DEFAULT_TONEMAP at draw time).
  const tonemapPartial: Partial<Tonemap> = {};
  const gammaAttr = flame.getAttribute('gamma');
  if (gammaAttr !== null) tonemapPartial.gamma = expectFiniteNumber(gammaAttr, 'gamma');
  const vibrancyAttr = flame.getAttribute('vibrancy');
  if (vibrancyAttr !== null) tonemapPartial.vibrancy = expectFiniteNumber(vibrancyAttr, 'vibrancy');
  const highpowAttr = flame.getAttribute('highlight_power');
  if (highpowAttr !== null) tonemapPartial.highlightPower = expectFiniteNumber(highpowAttr, 'highlight_power');
  const brightnessAttr = flame.getAttribute('brightness');
  if (brightnessAttr !== null) tonemapPartial.brightness = expectFiniteNumber(brightnessAttr, 'brightness');
  const linrangeAttr = flame.getAttribute('gamma_threshold');
  if (linrangeAttr !== null) tonemapPartial.gammaThreshold = expectFiniteNumber(linrangeAttr, 'gamma_threshold');
  // #17 fix (c) — partial-tonemap fill uses FLAM3's defaults, not pyr3's
  // DEFAULT_TONEMAP. flam3 parser.c defaults `vibrancy=1`, `highpow=-1`;
  // pyr3's continuity defaults are `vibrancy=0`, `highpow=1`. The mismatch
  // surfaced when a .flame carried e.g. only `gamma=2.4` but no vibrancy:
  // pyr3 filled vibrancy=0 (vibrancy-composite collapses), but flam3
  // would have filled vibrancy=1. ESF corpus is unaffected (every shipped
  // flame carries the full tonemap block). Note: this is ONLY for the
  // importer partial-fill path — pyr3's DEFAULT_TONEMAP stays unchanged
  // (it's the project-wide continuity default at draw time when no
  // tonemap is present at all).
  //
  // #165 fix — flam3-C `clear_cp` actually defaults FOUR tonemap fields,
  // not two. gamma=4.0 and brightness=4.0 were inheriting from
  // DEFAULT_TONEMAP (2.4 and 1.0). For attr-sparse .flame files the
  // resulting render under-fills brightness ~4× vs flam3 — the canonical
  // example is the Spiral Galaxy preset (see src/genome.ts where
  // brightness=19.5 was hardcoded to compensate).
  const FLAM3_PARTIAL_FILL: Tonemap = {
    ...DEFAULT_TONEMAP,
    gamma: 4.0,
    brightness: 4.0,
    vibrancy: 1.0,
    highlightPower: -1.0,
  };
  const tonemap: Tonemap | undefined =
    Object.keys(tonemapPartial).length > 0
      ? { ...FLAM3_PARTIAL_FILL, ...tonemapPartial }
      : undefined;

  // Phase 9-bg-palmode: parse `<flame background="R G B">`. Each component
  // in [0,1] (flam3 parser.c:465-466). Treat 0 0 0 as the default (omit
  // field) so the report panel and serialized JSON stay clean.
  let background: [number, number, number] | undefined;
  const bgAttr = flame.getAttribute('background');
  if (bgAttr !== null) {
    const parts = bgAttr.trim().split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(
        `pyr3: background must be 3 finite numbers, got: ${JSON.stringify(bgAttr)}`,
      );
    }
    if (parts[0] !== 0 || parts[1] !== 0 || parts[2] !== 0) {
      background = [parts[0]!, parts[1]!, parts[2]!];
    }
  }

  // Phase 9-bg-palmode: parse `<flame palette_mode="step|linear">`. Unknown
  // values land in ignoredFields with raw text; field stays undefined.
  let paletteMode: PaletteMode | undefined;
  const pmAttr = flame.getAttribute('palette_mode');
  if (pmAttr !== null) {
    if (pmAttr === 'step' || pmAttr === 'linear') {
      paletteMode = pmAttr;
    } else {
      ignoredFields.push({ field: 'palette_mode', value: pmAttr });
    }
  }

  const genome: Genome = {
    name: flameName,
    xforms,
    // #17 fix (a) — flam3 parser.c defaults `scale` to 50, not 100. The
    // pyr3 default was carried over from an earlier port and produced a
    // 2× zoom for hand-authored flames omitting `<flame scale="...">`.
    // ESF corpus is unaffected (every shipped flame carries explicit
    // scale). The malformed-value recovery in parseScalarOrDefault is
    // unchanged — only the "attr completely absent" default value moves.
    scale: parseScalarOrDefault(flame.getAttribute('scale'), 'scale', 50, defaultedFields),
    cx,
    cy,
    palette: { name: flameName, stops },
  };
  if (flameNick) genome.nick = flameNick;
  if (finalxform) genome.finalxform = finalxform;
  if (symmetry) genome.symmetry = symmetry;
  if (density) genome.density = density;
  if (tonemap) genome.tonemap = tonemap;
  // Phase 9-rotate: extract camera rotation in degrees CCW (flam3 convention).
  const rotateAttr = flame.getAttribute('rotate');
  if (rotateAttr !== null) {
    const rotate = expectFiniteNumber(rotateAttr, 'rotate');
    if (rotate !== 0) genome.rotate = rotate;
  }
  // Phase 9-cal-B: extract sample density (samples per pixel) from quality.
  const qualityAttr = flame.getAttribute('quality');
  if (qualityAttr !== null) {
    const q = expectFiniteNumber(qualityAttr, 'quality');
    if (q > 0) genome.quality = q;
  }
  // Phase 9-cal-B v3: extract supersample factor for k1 calibration.
  const supersampleAttr = flame.getAttribute('supersample');
  if (supersampleAttr !== null) {
    // #247 — flam3 reads supersample as an integer; a fractional value here
    // would pass the importer's s>1 gate, get emitted by genomeToJson, then
    // throw "oversample must be a positive integer" on JSON reload (a flame
    // unloadable after save). Floor at the boundary to match the reload
    // validator's integer contract.
    const s = Math.floor(expectFiniteNumber(supersampleAttr, 'supersample'));
    if (s > 1) genome.oversample = s;
  }
  if (size) genome.size = size;
  if (spatialFilter) {
    genome.spatialFilter = spatialFilter;
    // Phase 9-filter v1 simplification: filter pulls input from the DE-filtered
    // f32 buffer, so it requires DE active. Surface the silent-no-op so the
    // user sees the lost feature in the HUD report.
    if (!genome.density) {
      ignoredFields.push({
        field: 'filter',
        value: `${spatialFilter.radius} (requires <flame estimator_*> for v1)`,
      });
    }
  }
  if (background !== undefined) genome.background = background;
  if (paletteMode !== undefined) genome.paletteMode = paletteMode;

  // P1 #206 — per-keyframe time attribute (flam3.h:452, flam3.c:1364 default 0).
  // Omitted when equal to the default so single-keyframe Genome JSON stays clean.
  const timeAttr = flame.getAttribute('time');
  if (timeAttr !== null) {
    const t = parseScalarOrDefault(timeAttr, 'time', 0, defaultedFields);
    if (t !== 0) genome.time = t;
  }

  return {
    genome,
    droppedVariations,
    ignoredFields,
    defaultedFields,
    ...(paletteFallback ? { paletteFallback } : {}),
    ...(clampedXforms ? { clampedXforms } : {}),
  };
}

/** Read the cross-keyframe interp + temporal settings from the first flame
 *  of a multi-keyframe sequence. flam3-C's interpolation.c reads these from
 *  `cpi[0]` (the first keyframe in the blend window), so we mirror that. */
function readAnimationFromFlame(flame: Element, keyframes: Genome[]): Animation {
  const a: Animation = { ...FLAM3_ANIMATION_DEFAULTS, keyframes };

  const interp = flame.getAttribute('interpolation');
  if (interp === 'linear' || interp === 'smooth') a.interpolation = interp as Interpolation;

  const interpType = flame.getAttribute('interpolation_type');
  if (
    interpType === 'linear' || interpType === 'log' ||
    interpType === 'compat' || interpType === 'older'
  ) {
    a.interpolation_type = interpType as InterpolationType;
  }

  const palInterp = flame.getAttribute('palette_interpolation');
  if (
    palInterp === 'hsv' || palInterp === 'sweep' ||
    palInterp === 'rgb' || palInterp === 'hsv_circular'
  ) {
    a.palette_interpolation = palInterp as PaletteInterpolation;
  }

  const blend = flame.getAttribute('hsv_rgb_palette_blend');
  if (blend !== null) {
    const v = Number(blend);
    if (Number.isFinite(v)) a.hsv_rgb_palette_blend = v;
  }

  const nts = flame.getAttribute('temporal_samples');
  if (nts !== null) {
    const v = Number(nts);
    if (Number.isFinite(v) && v > 0) a.ntemporal_samples = v;
  }

  const tfType = flame.getAttribute('temporal_filter_type');
  if (tfType === 'box' || tfType === 'gaussian' || tfType === 'exp') {
    a.temporal_filter_type = tfType as TemporalFilterType;
  }

  const tfWidth = flame.getAttribute('temporal_filter_width');
  if (tfWidth !== null) {
    const v = Number(tfWidth);
    if (Number.isFinite(v) && v > 0) a.temporal_filter_width = v;
  }

  const tfExp = flame.getAttribute('temporal_filter_exp');
  if (tfExp !== null) {
    const v = Number(tfExp);
    if (Number.isFinite(v)) a.temporal_filter_exp = v;
  }

  return a;
}
