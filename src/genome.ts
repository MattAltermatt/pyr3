// Genome = a fractal flame definition. Phase 3 generalizes the variation
// chain: each xform now carries a `variations: Variation[]` array, dispatched
// via a runtime switch in the chaos shader. See `src/variations.ts` for the
// available kernels and `src/shaders/chaos.wgsl` for their implementations.

import {
  type Variation,
  MAX_VARIATIONS_PER_XFORM,
  julian,
  spherical,
  linear,
} from './variations';
import { type Palette, type PaletteMode, PYRE_PALETTE } from './palette';
import { type Density } from './density';
import { type Tonemap } from './tonemap';

export interface Xform {
  // Affine pre-transform: new_x = a*x + b*y + c; new_y = d*x + e*y + f
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  // Selection probability weight (relative — pyr3 normalizes by total).
  weight: number;
  // Color tracking: each xform pulls the iterated color coord toward `color`
  // at rate `colorSpeed`. q.z = mix(p.z, xform.color, colorSpeed).
  color: number;
  colorSpeed: number;
  // Variation chain — applied as weighted sum after the affine pre-transform.
  // Order doesn't matter (sum is commutative). Up to MAX_VARIATIONS_PER_XFORM.
  variations: Variation[];
  // PYR3-015: per-xform render-only weighting (0..1). When undefined, treated
  // as 1.0 (full deposit). Matches flam3's `<xform opacity="N">` (variations.c:2044,
  // 2167) — at splat time the chaos pass scales BOTH the rgb and count (alpha)
  // channels of the deposit by this value, making deposit weight linear in
  // opacity. opacity=0 → no deposit (rgb=0, count=0); opacity=1 → full deposit;
  // intermediate values deposit proportionally. The trajectory continues from
  // the post-lens point regardless of opacity (matches v0.9 splat-skip — only
  // the histogram contribution is gated, not the chaos game state).
  opacity?: number;
  // Phase 9d: per-source weight multipliers for next-xform pick. Indexed by
  // destination xform; trailing missing entries default to 1.0. Matches flam3's
  // `<xform chaos="...">` (flam3.c:175-215) — a per-source multiplier on
  // `xform[dest].weight`, not a Markov-chain transition probability.
  xaos?: number[];
  // Phase 9c: per-xform post-affine. Applied to (qx, qy) AFTER the variation
  // chain, before splat (matches flam3 variations.c:2412-2418). When
  // undefined, no post-affine applies. Same row-major shape as the
  // pre-affine fields above (a, b, c, d, e, f). Trajectory continues from
  // the post'd point.
  post?: { a: number; b: number; c: number; d: number; e: number; f: number };
}

export interface Genome {
  name: string;
  /** Optional author nick (from `<flame nick="...">`). Displayed by the
   *  pyr3 bar as "By <nick>" attribution; never linked anywhere. */
  nick?: string;
  xforms: Xform[];
  // Viewport: world-space center mapped to canvas center, `scale` = pixels per world unit.
  scale: number;
  cx: number;
  cy: number;
  // Palette — gradient-stop source of truth, baked to a 256-entry LUT at GPU upload.
  palette: Palette;
  // Optional flam3-canonical finalxform — applied as a lens on every stored
  // point AFTER the chaos pick. Trajectory continues from the pre-lens point
  // (flam3.c:280-287). The `weight` field is meaningless and ignored —
  // finalxform is not in the chaos pick.
  finalxform?: Xform;
  // Optional flam3-canonical symmetry — pre-pack expansion adds N rotation
  // (and optional reflection) xforms to the IFS pool. The in-memory genome
  // stays in this compact "declaration" form; expansion happens in
  // src/symmetry.ts:expandGenomeForGPU at chaos.dispatch time.
  symmetry?: Symmetry;
  // Optional density-estimation params. When undefined, DE is skipped and
  // the visualize pass reads the raw u32 histogram directly. Per-output
  // adaptive gather; sigma derived from THIS pixel's count. See src/density.ts.
  density?: Density;
  // Optional flam3-canonical tone-map params. Defaults to DEFAULT_TONEMAP
  // when undefined; importer populates from `<flame gamma=... vibrancy=... ...>`.
  // See palettes.c:274-349 + rect.c:1067-1135 for the math.
  tonemap?: Tonemap;
  // Optional camera rotation in degrees, CCW. Matches flam3's `<flame rotate="N">`
  // and `cp.rotate` (rect.c:818-823). Applied to splat coordinates around (cx, cy)
  // before scale + canvas-center mapping. When undefined or 0, no rotation.
  rotate?: number;
  // Phase 9-cal-B: target samples per pixel (matches flam3's `<flame quality=N>`
  // and `cp.sample_density`). When defined, the chaos dispatch scales walker
  // count to land approximately `quality × W × H` total samples — calibrating
  // pyr3's per-pixel count distribution to flam3's expectation, so authored
  // brightness values render with their intended absolute brightness. When
  // undefined, pyr3 uses its config-default (~16 spp).
  quality?: number;
  // Phase 9-supersample-real: oversample factor (matches flam3
  // `<flame supersample="N">`). When N > 1, pyr3 renders the chaos game at
  // (W·N) × (H·N) super-pixels; the visualize fragment shader N²-collapses
  // back to output resolution AND applies the per-super-pixel log-density
  // tone-map BEFORE averaging (matches flam3 rect.c:963-967 ordering). The
  // spatial-filter Gaussian half-width also scales with N (filt.c:225 —
  // `fw = 2 × 1.5 × N × radius`). Default 1.
  oversample?: number;
  // Phase 9-size: optional render dimensions. When defined, main.ts rebuilds
  // chaos / density / visualize / spatial-filter pipelines at this size on
  // flame load. When undefined, pyr3 uses its config-default (1024² square).
  size?: Pyr3Size;
  // Phase 9-filter: optional spatial AA Gaussian filter. Slotted post-DE,
  // pre-visualize. When undefined, filter pass is skipped.
  spatialFilter?: SpatialFilter;
  // Phase 9-bg-palmode: flam3 `<flame background="R G B">` (parser.c:465-466).
  // Each component in [0,1]. Undefined = flam3 default [0,0,0]
  // (flam3.c:1294-1296). Blends through (1-alpha) at visualize time.
  background?: [number, number, number];
  // Phase 9-bg-palmode: flam3 `<flame palette_mode="step|linear">`
  // (parser.c:452-456). Affects per-scatter palette sampling: 'step' = floor
  // index lookup, 'linear' = lerp adjacent entries by fractional part. Must
  // apply at scatter time, not LUT-bake time. Undefined = flam3 default
  // 'step' (flam3.c:1316). Reuses PaletteMode from src/palette.ts; semantically
  // distinct from `palette.mode` (which controls gradient-stop interpolation
  // at LUT-bake time, not scatter-time sampling).
  paletteMode?: PaletteMode;
}

export type Symmetry = { kind: 'rotational' | 'dihedral'; n: number };

// Phase 9-size: render dimensions (matches flam3 `<flame size="W H">`). Both
// must be positive integers. main.ts rebuilds chaos / density / visualize on
// flame load when size differs from the current backing-buffer size.
export type Pyr3Size = { width: number; height: number };

// Phase 9-filter / 9-filter-shapes: spatial AA filter (matches flam3
// `<flame filter="N" filter_shape="<shape>">`). Slotted post-DE, pre-visualize.
// `radius` is in output pixels. `shape` is one of flam3's 14 canonical shapes
// from `filters.c` (`flam3_spatial_filter` dispatcher + per-shape evaluator).
// XML attribute strings come from `parser.c:407-435` — note `bspline` is the
// flam3-canonical spelling (no underscore). Mitchell constants are
// B=C=1/3 per `private.h:150-151` (Mitchell-Netravali default).
export type SpatialFilterShape =
  | 'gaussian'
  | 'hermite'
  | 'box'
  | 'triangle'
  | 'bell'
  | 'bspline'
  | 'mitchell'
  | 'blackman'
  | 'catrom'
  | 'hanning'
  | 'hamming'
  | 'lanczos3'
  | 'lanczos2'
  | 'quadratic';
export type SpatialFilter = { radius: number; shape: SpatialFilterShape };

export const SPATIAL_FILTER_SHAPES: readonly SpatialFilterShape[] = [
  'gaussian',
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
] as const;

export function isSpatialFilterShape(value: unknown): value is SpatialFilterShape {
  return typeof value === 'string' && (SPATIAL_FILTER_SHAPES as readonly string[]).includes(value);
}

// 🌀 Spiral Galaxy — pyr3's v0.1 hero flame. Same numerical genome as v0.1;
// re-expressed on the Phase 3 variation-array architecture.
export const SPIRAL_GALAXY: Genome = {
  name: 'Spiral Galaxy',
  scale: 220,
  cx: 0,
  cy: 0,
  xforms: [
    {
      // Spiral arm — julian power=2 (deep red end of palette)
      a: 0.85,
      b: 0.0,
      c: 0.0,
      d: 0.0,
      e: 0.85,
      f: 0.0,
      weight: 0.55,
      color: 0.15,
      colorSpeed: 0.5,
      variations: [julian(1, 2, 1)],
    },
    {
      // Core contraction — spherical (bright yellow-white)
      a: 0.5,
      b: -0.3,
      c: 0.4,
      d: 0.3,
      e: 0.5,
      f: 0.0,
      weight: 0.35,
      color: 0.85,
      colorSpeed: 0.5,
      variations: [spherical(1)],
    },
    {
      // Soft mix — half linear, half spherical (orange middle)
      a: 0.7,
      b: 0.0,
      c: -0.3,
      d: 0.0,
      e: 0.7,
      f: 0.0,
      weight: 0.1,
      color: 0.5,
      colorSpeed: 0.5,
      variations: [linear(0.5), spherical(0.5)],
    },
  ],
  palette: PYRE_PALETTE,
  // Inline tonemap calibrated to preserve pre-9-cal Spiral Galaxy look under
  // the new sample-density-derived k2. Without this override, DEFAULT_TONEMAP's
  // flam3-canonical brightness=1.0 would render this flame ~20× too dim.
  tonemap: {
    brightness: 19.5,
    gamma: 2.4,
    vibrancy: 0,
    highlightPower: 1,
    gammaThreshold: 0.01,
  },
};

// Layout per xform in the storage buffer — must match WGSL `struct Xform`.
//   affine0       = vec4f [a, b, c, weight]                            offset   0
//   affine1       = vec4f [d, e, f, num_active_vars (as f32)]          offset  16
//   color_params  = vec4f [color, colorSpeed, opacity, _]              offset  32
//   post0         = vec4f [pa, pb, pc, has_post]   (Phase 9c)          offset  48
//   post1         = vec4f [pd, pe, pf, _]          (Phase 9c)          offset  64
//   vars[8]       = 8 × vec4f [index_as_f32, weight, param0, param1]   offset  80
//   vars_extra[8]  = 8 × vec4f [param2, param3, param4, param5]        offset 208
//   vars_extra2[8] = 8 × vec4f [param6, param7, _, _]                   offset 336
// Total: 20 + 32 + 32 + 32 = 116 floats = 464 bytes per xform. Phase 9b
// extended the per-variation param seam 2 → 6 (pdj/blob/ngon/wedge/etc.)
// then 6 → 8 (mobius=8) — same array-split pattern; vars_extra2 carries
// the 2 high-param slots, two unused tail floats per slot reserved for
// future kernels needing 9 or 10 params (super_super_shape, anyone?).
const VARS_OFFSET = 20;
const VARS_EXTRA_OFFSET = VARS_OFFSET + MAX_VARIATIONS_PER_XFORM * 4;
const VARS_EXTRA2_OFFSET = VARS_EXTRA_OFFSET + MAX_VARIATIONS_PER_XFORM * 4;
export const XFORM_FLOATS = VARS_EXTRA2_OFFSET + MAX_VARIATIONS_PER_XFORM * 4;
export const XFORM_BYTES = XFORM_FLOATS * 4;

// Max regular xforms in the GPU storage buffer. 16 → 32 (Phase 5c, for
// expanded symmetric pools) → 128 (PYR3-033, 2026-05-29). 32 was too small
// for large explicit flames: rotationally-symmetric Electric Sheep flames
// routinely list 50+ xforms (e.g. electricsheep.242.01373 = 54), which
// overflowed the fixed xforms buffer → silent writeBuffer drop → black
// render. 128 covers all known realistic flames with headroom; the
// flame-import clamp guard handles anything beyond (graceful, never black).
// The GPU buffer is sized (MAX_XFORMS + 1) * XFORM_BYTES (one slot reserved
// for finalxform). Cost is the xform-distrib buffer: (MAX_XFORMS + 1) *
// CHOOSE_XFORM_GRAIN * 4 ≈ 8.5 MB at 128 (was ~2 MB at 32) — negligible.
// MUST stay in sync with MAX_XFORMS_U in src/shaders/chaos.wgsl.
export const MAX_XFORMS = 128;

function packXformInto(buf: Float32Array, slotIndex: number, x: Xform): void {
  const o = slotIndex * XFORM_FLOATS;
  const numVars = Math.min(x.variations.length, MAX_VARIATIONS_PER_XFORM);

  buf[o + 0] = x.a;
  buf[o + 1] = x.b;
  buf[o + 2] = x.c;
  buf[o + 3] = x.weight;

  buf[o + 4] = x.d;
  buf[o + 5] = x.e;
  buf[o + 6] = x.f;
  buf[o + 7] = numVars; // f32 representation; small ints round-trip exactly

  buf[o + 8] = x.color;
  buf[o + 9] = x.colorSpeed;
  // PYR3-016: clamp to flam3-spec'd [0, 1] at the serialization boundary.
  // Malformed `.flame` input may pass finiteness validation in flame-import
  // but still carry out-of-range opacity; valid flames are unaffected.
  buf[o + 10] = Math.max(0, Math.min(1, x.opacity ?? 1.0));
  // 11 is pad (already zero from ArrayBuffer init)

  // Phase 9c — post-affine slots. has_post flag (slot 15) gates application
  // in the chaos shader; 0 = identity / skip, 1 = apply.
  if (x.post) {
    buf[o + 12] = x.post.a;
    buf[o + 13] = x.post.b;
    buf[o + 14] = x.post.c;
    buf[o + 15] = 1.0; // has_post
    buf[o + 16] = x.post.d;
    buf[o + 17] = x.post.e;
    buf[o + 18] = x.post.f;
    // o + 19 = post1.w pad — zero from ArrayBuffer init (matches existing
    // pattern at o + 11 for color_params.w).
  }
  // When x.post is undefined, slots 12-19 stay zero — has_post = 0 means
  // shader skips the post matrix multiply.

  for (let v = 0; v < numVars; v++) {
    const vr = x.variations[v]!;
    const vo = o + VARS_OFFSET + v * 4;
    buf[vo + 0] = vr.index; // index → f32 → u32 in WGSL (exact for small ints)
    buf[vo + 1] = vr.weight;
    buf[vo + 2] = vr.param0 ?? 0;
    buf[vo + 3] = vr.param1 ?? 0;
    // Phase 9b — vars_extra slot for params 2..5. Unused params zero by
    // ArrayBuffer init for the unfilled tail of the slot array, but we
    // write all 4 here for each active slot so a re-pack on an existing
    // buffer doesn't carry over stale values.
    const ve = o + VARS_EXTRA_OFFSET + v * 4;
    buf[ve + 0] = vr.param2 ?? 0;
    buf[ve + 1] = vr.param3 ?? 0;
    buf[ve + 2] = vr.param4 ?? 0;
    buf[ve + 3] = vr.param5 ?? 0;
    // Phase 9b Batch K — vars_extra2 slot for params 6..7 (mobius=8 params).
    // 2 floats per slot used; the remaining 2 are reserved.
    const ve2 = o + VARS_EXTRA2_OFFSET + v * 4;
    buf[ve2 + 0] = vr.param6 ?? 0;
    buf[ve2 + 1] = vr.param7 ?? 0;
  }
}

export function packXforms(genome: Genome): ArrayBuffer {
  const total = genome.xforms.length + (genome.finalxform ? 1 : 0);
  const ab = new ArrayBuffer(total * XFORM_BYTES);
  const buf = new Float32Array(ab);
  for (let i = 0; i < genome.xforms.length; i++) {
    const x = genome.xforms[i];
    if (!x) continue;
    packXformInto(buf, i, x);
  }
  if (genome.finalxform) {
    packXformInto(buf, genome.xforms.length, genome.finalxform);
  }
  return ab;
}

export function totalWeight(genome: Genome): number {
  return genome.xforms.reduce((s, x) => s + x.weight, 0);
}

// Phase 9d: pack the xaos matrix as MAX_XFORMS × MAX_XFORMS row-major flat
// f32 array. Default 1.0 everywhere (uniform pick — matches pre-9d behavior).
// Per-xform `xform.xaos[j]` overlays row `i`, column `j` if defined; trailing
// missing entries stay 1.0 per flam3's `<xform chaos="...">` shorthand.
export const XAOS_FLOATS = MAX_XFORMS * MAX_XFORMS;
export const XAOS_BYTES = XAOS_FLOATS * 4;

export function packXaos(genome: Genome): ArrayBuffer {
  const ab = new ArrayBuffer(XAOS_BYTES);
  const buf = new Float32Array(ab);
  buf.fill(1.0);
  for (let i = 0; i < genome.xforms.length; i++) {
    const x = genome.xforms[i];
    if (!x?.xaos) continue;
    const row = i * MAX_XFORMS;
    for (let j = 0; j < x.xaos.length && j < MAX_XFORMS; j++) {
      buf[row + j] = x.xaos[j] ?? 1.0;
    }
  }
  return ab;
}

// PYR3-029 Phase 5c — flam3-canonical xform-pick distribution table.
// flam3 (flam3.c:200-256) precomputes a 16384-entry table per "previous
// xform" row so chain runtime is a single masked-index lookup.
// For each row, weights are scanned cumulatively; each table slot stores
// the xform index whose weight bucket spans that slot's interval. With
// no xaos, all rows are identical (the unconditional weight distribution).
// With xaos, row i applies `weights[j] * xaos[i][j]` for the cumulative
// scan, so the table per-row encodes the Markov-chain pick distribution
// conditional on the previous xform.
//
// Matches flam3 `CHOOSE_XFORM_GRAIN`. 14 bits = 16384, fits in u16. We
// store as u32 for WGSL ergonomics (no native u16). At 8 xforms × 16384 ×
// 4 bytes = 512 KB worst case — well under WebGPU storage limits.
export const CHOOSE_XFORM_GRAIN = 16384;
export const CHOOSE_XFORM_GRAIN_M1 = CHOOSE_XFORM_GRAIN - 1;
export const XFORM_DISTRIB_BYTES = (MAX_XFORMS + 1) * CHOOSE_XFORM_GRAIN * 4;

export function packXformDistrib(genome: Genome): ArrayBuffer {
  const ab = new ArrayBuffer(XFORM_DISTRIB_BYTES);
  const u32 = new Uint32Array(ab);
  const numStd = genome.xforms.length; // excludes finalxform — pyr3 stores it at +1
  // Row layout: rows 0..numStd-1 are the "previous xform = i" rows. We also
  // populate row numStd as the no-xaos fallback (used when prev_xform == -1
  // sentinel; matches flam3 lastxf=0 init since it indexes into row 0 of a
  // never-xaos build, but pyr3 treats first-iter as "no xaos multiplier").
  const buildRow = (rowIdx: number, xi: number): void => {
    // Sum weights for this row (xaos-multiplied if xi >= 0).
    let drSum = 0;
    for (let i = 0; i < numStd; i++) {
      const w = genome.xforms[i]!.weight;
      const m = xi >= 0 ? (genome.xforms[xi]?.xaos?.[i] ?? 1.0) : 1.0;
      const d = w * m;
      if (!Number.isFinite(d) || d < 0) throw new Error(`xform weight must be non-negative finite: got ${d}`);
      drSum += d;
    }
    if (drSum === 0) {
      // Empty distribution; all slots = 0. flam3 errors at iteration time.
      return;
    }
    const dr = drSum / CHOOSE_XFORM_GRAIN;
    let j = 0;
    let t = genome.xforms[0]!.weight * (xi >= 0 ? (genome.xforms[xi]?.xaos?.[0] ?? 1.0) : 1.0);
    let r = 0;
    const rowBase = rowIdx * CHOOSE_XFORM_GRAIN;
    for (let i = 0; i < CHOOSE_XFORM_GRAIN; i++) {
      while (r >= t) {
        j++;
        const m = xi >= 0 ? (genome.xforms[xi]?.xaos?.[j] ?? 1.0) : 1.0;
        t += (genome.xforms[j]?.weight ?? 0) * m;
      }
      u32[rowBase + i] = j;
      r += dr;
    }
  };
  for (let i = 0; i < numStd; i++) buildRow(i, i);
  // Row MAX_XFORMS-1 (or +1) is the "first iter / no prior xform" fallback row.
  // Use the no-xaos distribution.
  buildRow(MAX_XFORMS, -1);
  return ab;
}
