// Long-edge-anchored output-size rescale. Extracted from the viewer/editor's
// inline applyPreset logic (src/main.ts) so the animate preview + export and the
// backend frame loop all share ONE rule. Uniform scale (no per-axis distortion):
// the genome→pixel projection in chaos.wgsl is `p * u.scale + dims*0.5`, so the
// long edge's framing is preserved and the short axis reveals more / less.
import { type Genome } from './genome';

export interface OutputSize {
  width: number;
  height: number;
}

/** Scale factor mapping a genome authored for `declSize` to render at
 *  `targetSize`, anchored on the long edge. Degenerate (≤0) dims clamp to 1. */
export function longEdgeScaleAdjust(declSize: OutputSize, targetSize: OutputSize): number {
  const declMax = Math.max(1, declSize.width, declSize.height);
  const targetMax = Math.max(1, targetSize.width, targetSize.height);
  return targetMax / declMax;
}

/** A copy of `genome` rescaled to render at `targetSize`, preserving long-edge
 *  framing. Declared size is `genome.size` (falls back to `targetSize` when
 *  absent ⇒ scaleAdjust 1). Pure — never mutates the input. */
export function rescaleGenomeToOutput(genome: Genome, targetSize: OutputSize): Genome {
  const declSize = genome.size ?? targetSize;
  const adjust = longEdgeScaleAdjust(declSize, targetSize);
  return {
    ...genome,
    size: { width: targetSize.width, height: targetSize.height },
    scale: genome.scale * adjust,
  };
}
