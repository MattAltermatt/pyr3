// P5 of Animation milestone (#17 / #210). Port of flam3-C's
// `flam3_create_temporal_filter` (filters.c:409-489). Computes per-sub-frame
// time offsets + weights for motion blur within one output frame.
//
// flam3's filter[] is normalized so max == 1.0; sumfilt = sum(filter)/N is
// returned to drive K2 scaling. We return both the deltas and the filter +
// the sumfilt so the caller can choose how to distribute walker counts
// across sub-frames (pyr3 uses `filter[i] / sumfilt` to keep the TOTAL
// walker count roughly invariant under the choice of N / filter shape).

import { type TemporalFilterType } from './animation';

export interface TemporalFilter {
  /** Time offsets per sub-frame relative to the output frame's nominal time.
   *  Span [-width/2, +width/2] uniformly when N > 1. */
  deltas: number[];
  /** Weight per sub-frame. flam3 normalizes so max(filter) === 1.0. */
  filter: number[];
  /** sumfilt / N — the average weight. flam3 returns this from
   *  `flam3_create_temporal_filter` to drive K2 scaling. */
  sumfilt: number;
}

/** Port of `flam3_create_temporal_filter` (filters.c:409-489). */
export function createTemporalFilter(
  numsteps: number,
  type: TemporalFilterType,
  filterWidth: number,
  filterExp: number,
): TemporalFilter {
  // numsteps === 1 short-circuit (single sub-frame == single render).
  if (numsteps <= 1) {
    return { deltas: [0], filter: [1.0], sumfilt: 1.0 };
  }

  const deltas: number[] = new Array(numsteps);
  const filter: number[] = new Array(numsteps);

  for (let i = 0; i < numsteps; i++) {
    deltas[i] = (i / (numsteps - 1) - 0.5) * filterWidth;
  }

  let maxfilt = 0;
  if (type === 'exp') {
    for (let i = 0; i < numsteps; i++) {
      const slpx =
        filterExp >= 0 ? (i + 1) / numsteps : (numsteps - i) / numsteps;
      const v = Math.pow(slpx, Math.abs(filterExp));
      filter[i] = v;
      if (v > maxfilt) maxfilt = v;
    }
  } else if (type === 'gaussian') {
    const halfsteps = numsteps / 2.0;
    const GAUSSIAN_SUPPORT = 1.5; // flam3 filters.c:31 (spatial_support[gaussian])
    for (let i = 0; i < numsteps; i++) {
      const x = (GAUSSIAN_SUPPORT * Math.abs(i - halfsteps)) / halfsteps;
      // flam3_gaussian_filter (filters.c:156): exp(-2x²) * sqrt(2/π)
      const v = Math.exp(-2 * x * x) * Math.sqrt(2 / Math.PI);
      filter[i] = v;
      if (v > maxfilt) maxfilt = v;
    }
  } else {
    // box (default)
    for (let i = 0; i < numsteps; i++) filter[i] = 1.0;
    maxfilt = 1.0;
  }

  // Normalize so max(filter) === 1.0; compute sumfilt for K2 scaling.
  let sumfilt = 0;
  for (let i = 0; i < numsteps; i++) {
    filter[i] = filter[i]! / maxfilt;
    sumfilt += filter[i]!;
  }
  sumfilt /= numsteps;

  return { deltas, filter, sumfilt };
}
