export interface LinearExportInput {
  /** Raw histogram at super-resolution: 4 u32 (R,G,B,count) per super-pixel, row-major. */
  superRgba: Uint32Array;
  /** Output dimensions (super dims / oversample). */
  width: number;
  height: number;
  oversample: number;
  /** Tone-curve calibration from `deriveCalibration` (the SAME (scale,
   *  sampleCount, brightness, oversample) inputs the renderer used). The
   *  linear, sample-density-invariant exposure is `k1 × k2` — the small-count
   *  slope of flam3's log tone curve (`ls = k1·log(1+count·k2)/count → k1·k2`
   *  as count→0). Using a fixed constant instead blows the image out, because
   *  raw `colorSum` grows with sample count (#334 white-blur fix). */
  k1: number;
  k2: number;
}

/** Collapse a super-resolution raw histogram to output-resolution LINEAR
 *  scene-referred RGBA f32 (pre-log, pre-gamma). Box-averages each
 *  oversample×oversample block, then scales by the calibrated linear exposure
 *  `k1 × k2`. Bright pixels exceed 1.0 (HDR headroom — the consumer tonemaps);
 *  typical pixels land near O(1) regardless of render quality. Alpha is a
 *  density-derived coverage clamped to [0,1] for compositing. */
export function histogramToLinearRgba(input: LinearExportInput): Float32Array {
  const { superRgba, width, height, oversample, k1, k2 } = input;
  const superW = width * oversample;
  const out = new Float32Array(width * height * 4);
  const blockCount = oversample * oversample;
  const scale = (k1 * k2) / blockCount;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let sy = 0; sy < oversample; sy++) {
        for (let sx = 0; sx < oversample; sx++) {
          const si = ((y * oversample + sy) * superW + (x * oversample + sx)) * 4;
          r += superRgba[si]!; g += superRgba[si + 1]!; b += superRgba[si + 2]!; cnt += superRgba[si + 3]!;
        }
      }
      const oi = (y * width + x) * 4;
      out[oi] = r * scale;
      out[oi + 1] = g * scale;
      out[oi + 2] = b * scale;
      out[oi + 3] = Math.max(0, Math.min(1, cnt * scale)); // coverage, clamped
    }
  }
  return out;
}
