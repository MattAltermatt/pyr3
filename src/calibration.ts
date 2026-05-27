// flam3-canonical k1/k2 derivation for the visualize-pass log-density curve.
// Mirrors rect.c:933-937:
//   k1 = brightness × PREFILTER_WHITE × 268/256
//   k2 = oversample² / (area × WHITE_LEVEL × sample_density)  where
//        area = W × H / scale²  and  sample_density = quality
//   ls = (k1 × log(1 + count × k2)) / count
//
// pyr3 simplifications: contrast=1, batch_filter=1, nbatches=1, sumfilt=1.
//
// Phase 9-supersample-real (count-units fix): pyr3 now bumps count by 255
// per chaos hit (matching flam3 rect.c:460-461). This puts pyr3's count in
// the same numerical scale as flam3's, so alpha-curve / vibrancy / highpow
// behave identically. With chaos at super-resolution and visualize doing the
// Gaussian-weighted N²-collapse, per-output-pixel count after collapse is
// (quality/N²) × 255 — same as flam3's filter+collapse output. Therefore
// k2 needs the oversample² factor (per filt.c:937) to keep `count × k2`
// independent of supersample, matching flam3's invariant.

export const PREFILTER_WHITE = 255;
export const WHITE_LEVEL = 255;

export interface CalibrationInputs {
  scale: number;
  sampleCount: number;
  brightness: number;
  /** Super-resolution multiplier (matches flam3 `<flame supersample="N">`).
   *  Default 1. Squared into k2 numerator per `rect.c:936-937` to keep
   *  `count × k2` independent of supersample. */
  oversample?: number;
}

export interface Calibration {
  k1: number;
  k2: number;
}

export function deriveCalibration(inputs: CalibrationInputs): Calibration {
  const oversample = inputs.oversample ?? 1;
  const oversampleSq = oversample * oversample;
  const k1 = (inputs.brightness * PREFILTER_WHITE * 268.0) / 256.0;
  const k2 = (oversampleSq * inputs.scale * inputs.scale) / (WHITE_LEVEL * inputs.sampleCount);
  return { k1, k2 };
}
