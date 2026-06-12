// Animation = a multi-keyframe time-varying flame. P1 of the Animation milestone
// (#17) — schema + parser only; interp/playback land in P2+.
//
// Genome stays the canonical "what to render at this instant" shape (every
// existing dispatch site treats it that way). Animation wraps a Genome[]
// sequence + the cross-keyframe interpolation settings flam3-C stores per
// genome but uses cohort-wide.
//
// Source: flam3-C flam3.h + flam3.c:1340-1400 (clear_cp defaults), interpolation.c.

import { type Genome } from './genome';
import { type EasingCurve } from './easing';

/** flam3 `interpolation` field — controls which interp curve is used between
 *  adjacent keyframes. flam3-C default: `linear`. */
export type Interpolation = 'linear' | 'smooth';

/** flam3 `interpolation_type` field — controls how affine matrices interpolate.
 *  `log` (the default) goes through polar form to dodge wedge flips through
 *  rotation; `linear` interpolates raw coefficients. `compat`/`older` are
 *  legacy modes. Source: flam3.c:1392, interpolation.c:194-324. */
export type InterpolationType = 'linear' | 'log' | 'compat' | 'older';

/** flam3 `palette_interpolation` field. Default `hsv_circular` detects the
 *  shorter hue arc; `hsv` wraps at 6.0 without shortcut; `rgb` blends in RGB
 *  space; `sweep` is a hard switch at the blend boundary. flam3.c:1365. */
export type PaletteInterpolation = 'hsv' | 'sweep' | 'rgb' | 'hsv_circular';

/** flam3 `temporal_filter_type` field — kernel for motion-blur weighting in
 *  P5. flam3.c:1393. */
export type TemporalFilterType = 'box' | 'gaussian' | 'exp';

export interface Animation {
  /** Ordered keyframes (length ≥ 2). Each Genome carries its own `time`
   *  field (defaults to 0 when absent). Keyframes are SORTED ascending by
   *  time at parse time. */
  keyframes: Genome[];
  /** Across-keyframe interp curve. flam3 default `linear` (flam3.c:1364). */
  interpolation: Interpolation;
  /** Affine-interp space. flam3 default `log` (flam3.c:1392). */
  interpolation_type: InterpolationType;
  /** Palette blend mode. flam3 default `hsv_circular` (flam3.c:1365). */
  palette_interpolation: PaletteInterpolation;
  /** HSV↔RGB blend fraction applied to the palette interp result. flam3
   *  default 0 (flam3.c:1366); interpolation.c:438 does
   *  `final = blend * rgb + (1 - blend) * hsv`. */
  hsv_rgb_palette_blend: number;
  /** Motion-blur sub-samples per output frame (P5). flam3 default 1000
   *  (flam3.c:1390) — but flam3-render forces to 1 for static renders. */
  ntemporal_samples: number;
  /** Motion-blur kernel shape (P5). flam3 default `box` (flam3.c:1393). */
  temporal_filter_type: TemporalFilterType;
  /** Motion-blur kernel width (P5). flam3 default 1.0 (flam3.c:1394). */
  temporal_filter_width: number;
  /** Motion-blur exponent — only used when `temporal_filter_type === 'exp'`.
   *  flam3 default 0.0 (flam3.c:1395). */
  temporal_filter_exp: number;
  /** Per-segment easing (#224), sparse, indexed by keyframe gap: segmentEasing[i]
   *  reshapes the blend from keyframes[i] → keyframes[i+1]. ABSENT (field or an
   *  entry) ⇒ linear ⇒ byte-identical to today. pyr3 JSON only — flam3 XML has no
   *  easing slot, so `.flam3` import never sets it. #227 evolves this into per-clip
   *  transition curves on the same segment key. */
  segmentEasing?: (EasingCurve | undefined)[];
  /** Per-segment xform correspondence remapping (#225), sparse, indexed by
   *  keyframe gap: segmentPermutation[i] reorders the SECOND keyframe's ALIGNED
   *  xform list before the keyframes[i] → keyframes[i+1] blend. perm[a] = b means
   *  keyframes[i]'s aligned xform `a` morphs into keyframes[i+1]'s aligned xform
   *  `b`. Each entry is a bijection over [0, n) where n is the aligned
   *  (post-padding, max-count) xform count. ABSENT (field or entry, or an identity
   *  permutation) ⇒ positional-by-index ⇒ byte-identical to today. An out-of-range
   *  or non-bijective entry DEGRADES to identity (never corrupts). pyr3 JSON only —
   *  flam3 XML has no slot, so `.flam3` import never sets it. #227 carries this
   *  forward as one permutation per clip boundary. */
  segmentPermutation?: (number[] | undefined)[];
}

/** flam3-C `clear_cp` defaults for the Animation cross-keyframe fields.
 *  Applied when an imported multi-flame file omits the relevant attribute(s).
 *  Source: flam3.c:1340-1400 (the `default_flag==flam3_defaults_on` branch). */
export const FLAM3_ANIMATION_DEFAULTS: Omit<Animation, 'keyframes'> = {
  interpolation: 'linear',
  interpolation_type: 'log',
  palette_interpolation: 'hsv_circular',
  hsv_rgb_palette_blend: 0,
  ntemporal_samples: 1000,
  temporal_filter_type: 'box',
  temporal_filter_width: 1.0,
  temporal_filter_exp: 0.0,
};
