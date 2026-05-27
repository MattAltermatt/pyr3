// flam3-canonical tone-map parameters. Faithful port of the parameters
// driving the visualize-pass math chain that mirrors flam3_calc_alpha +
// flam3_calc_newrgb (palettes.c:274-349) and the per-channel composite
// (rect.c:1067-1135). When `Genome.tonemap` is undefined, callers fall
// through to DEFAULT_TONEMAP — so existing example flames render
// against pyr3's pre-9a defaults preserved here for visual continuity.

export interface Tonemap {
  /** Gamma curve exponent. Typical 2.0 – 6.0. */
  gamma: number;
  /** [0,1] mix between newrgb (1) and per-channel-gamma (0) paths. */
  vibrancy: number;
  /** HSV-desaturation strength on saturated channels. >0 = HSV path. */
  highlightPower: number;
  /** Log-density multiplier — flam3 packs k1 = brightness * 268/256. */
  brightness: number;
  /** Linrange toe — alpha curve below this density linear-interps to power. */
  gammaThreshold: number;
}

// flam3-canonical defaults — applied when Genome.tonemap is undefined.
// Imported .flame files always carry their author's tonemap (Phase 9a),
// and pyr3-hardcoded example flames (Spiral Galaxy in genome.ts) inline
// their own tonemap to preserve their pre-9-cal look under the
// derived-k2 math (Phase 9-cal). This default kicks in only for flames
// that genuinely have no tonemap intent — typically test fixtures.
//
// brightness=1.0 is the flam3-canonical baseline; combined with k1/k2
// derived from sample density, it produces flam3-equivalent absolute
// brightness for any flame that doesn't override.
export const DEFAULT_TONEMAP: Tonemap = {
  gamma: 2.4,
  vibrancy: 0.0,
  highlightPower: 1.0,
  brightness: 1.0,
  gammaThreshold: 0.01,
};

export function withTonemap(current: Tonemap | undefined, override: Partial<Tonemap>): Tonemap {
  return { ...(current ?? DEFAULT_TONEMAP), ...override };
}
