import type { Genome } from './genome';

export type PresetName = 'quick' | '4k';

export interface PresetSpec {
  maxDim: number;
  maxSpp: number;
  oversample: number;
  shortEdgeRound: 'round' | 'floor';
  /** 'cap' shrinks only (no-op when maxDecl ≤ maxDim) — matches pre-v0.20
   *  --quick semantics; FE QUICK_MAX_DIM is a ceiling, not a target.
   *  'force' always rescales long-edge to exactly maxDim (upscales when
   *  needed) — matches the reference SHOWCASE_4K preset + the pre-v0.20 4K wrapper
   *  script; the 4K showcase is a TARGET dim, not a cap. */
  mode: 'cap' | 'force';
}

export const PRESETS: Record<PresetName, PresetSpec> = {
  quick: {
    maxDim: 1024, maxSpp: 16, oversample: 1,
    shortEdgeRound: 'round', mode: 'cap',
  },
  '4k': {
    maxDim: 3840, maxSpp: 200, oversample: 1,
    shortEdgeRound: 'floor', mode: 'force',
  },
};

export function isPresetName(s: string): s is PresetName {
  return s === 'quick' || s === '4k';
}

export function applyPreset(genome: Genome, preset: PresetSpec): Genome {
  const cappedQuality = Math.min(genome.quality ?? preset.maxSpp, preset.maxSpp);

  if (!genome.size) {
    return { ...genome, oversample: preset.oversample, quality: cappedQuality };
  }
  const { width: declW, height: declH } = genome.size;
  const maxDecl = Math.max(declW, declH);

  // 'cap' mode: no-op when genome already fits (don't upscale).
  if (preset.mode === 'cap' && maxDecl <= preset.maxDim) {
    return { ...genome, oversample: preset.oversample, quality: cappedQuality };
  }

  const sizeScale = preset.maxDim / maxDecl;
  const roundFn = preset.shortEdgeRound === 'floor' ? Math.floor : Math.round;
  const newW = declW === maxDecl
    ? preset.maxDim
    : Math.max(1, roundFn((preset.maxDim * declW) / declH));
  const newH = declH === maxDecl
    ? preset.maxDim
    : Math.max(1, roundFn((preset.maxDim * declH) / declW));

  return {
    ...genome,
    size: { width: newW, height: newH },
    scale: genome.scale * sizeScale,
    oversample: preset.oversample,
    quality: cappedQuality,
  };
}

export interface QualityTier {
  name: string;
  longEdge: number;
  spp: number;
  oversample: 1;
  mode: 'cap' | 'force';
}

/** Quality ladder for the viewer's preset control (PYR3-050). longEdge sets the
 *  long output edge (short edge derives from the flame's native aspect via
 *  applyPreset); all oversample 1. Preview === the legacy `quick` preset, 4K ===
 *  the legacy `4k` preset. 🎚️ tunable. */
export const QUALITY_TIERS: QualityTier[] = [
  { name: 'Draft',    longEdge: 512,  spp: 8,   oversample: 1, mode: 'cap' },
  { name: 'Preview',  longEdge: 1024, spp: 16,  oversample: 1, mode: 'cap' },
  { name: 'Standard', longEdge: 1920, spp: 50,  oversample: 1, mode: 'force' },
  { name: 'High',     longEdge: 2560, spp: 100, oversample: 1, mode: 'force' },
  { name: '4K',       longEdge: 3840, spp: 200, oversample: 1, mode: 'force' },
];

/** Default tier on cold load — Preview (fast first paint). */
export const DEFAULT_TIER: QualityTier = QUALITY_TIERS[1]!;

/** Adapt a tier to a PresetSpec so applyPreset() handles dims/aspect/quality uniformly. */
export function tierToSpec(t: QualityTier): PresetSpec {
  return {
    maxDim: t.longEdge,
    maxSpp: t.spp,
    oversample: t.oversample,
    shortEdgeRound: t.mode === 'force' ? 'floor' : 'round',
    mode: t.mode,
  };
}

/** A viewer render request: a named tier, or a custom resolution+SPP (PYR3-050).
 *  Custom always renders at oversample 1 (the FE removed oversample>1 for memory). */
export type QualityRequest =
  | { kind: 'tier'; tier: QualityTier }
  // Custom request. When `width` AND `height` are both present, the render
  // uses those exact dims (overrides the long-edge + genome-aspect math) —
  // used by the viewer/editor Size dropdown to honor explicit preset ratios
  // like 1080×1080 (square) or 1290×2796 (iPhone). When omitted, the legacy
  // long-edge + preserve-genome-aspect path applies.
  | { kind: 'custom'; longEdge: number; spp: number; width?: number; height?: number };

// #25 — CLI quality parity. The BE CLI consumes the SAME ladder as the FE so a
// `--preset high` render produces identical dims/SPP to the viewer's High tier.

/** Recognized quality-selector names for the CLI `--preset` flag (and any shared
 *  parser): the lowercased tier names plus the legacy `quick` alias (≡ Preview). */
export const QUALITY_NAMES: string[] = [
  'quick',
  ...QUALITY_TIERS.map((t) => t.name.toLowerCase()),
];

/** Resolve a quality-selector name (case-insensitive) to a PresetSpec: any tier
 *  name (draft/preview/standard/high/4k) or the legacy `quick` alias (≡ Preview).
 *  Returns null for an unrecognized name. Lets the CLI and FE share one ladder via
 *  applyPreset(). `quick`/`4k` stay byte-identical to the legacy PRESETS entries. */
export function specForQualityName(name: string): PresetSpec | null {
  const lc = name.toLowerCase();
  if (lc === 'quick') return tierToSpec(DEFAULT_TIER); // legacy alias ≡ Preview
  const tier = QUALITY_TIERS.find((t) => t.name.toLowerCase() === lc);
  return tier ? tierToSpec(tier) : null;
}

/** Build a PresetSpec for a custom render: explicit long edge + SPP, oversample 1,
 *  force-rescale — mirrors the FE's `QualityRequest` custom kind. */
export function customSpec(longEdge: number, spp: number): PresetSpec {
  return {
    maxDim: longEdge,
    maxSpp: spp,
    oversample: 1,
    shortEdgeRound: 'floor',
    mode: 'force',
  };
}
