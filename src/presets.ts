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
   *  needed) — matches kotlin's SHOWCASE_4K + the pre-v0.20 4K wrapper
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
