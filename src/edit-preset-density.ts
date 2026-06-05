// pyr3 — DENSITY EMITTER preset list + dirty-state helper (Phase 7).
//
// Surfaces a six-button preset strip at the top of the editor's DENSITY
// EMITTER section. Picking a preset writes all five tonemap fields
// (gamma / gammaThreshold / vibrancy / brightness / contrast) at once.
// The dirty-state helper feeds the section-header chip — "default *" when
// the user has nudged anything off the preset values.
//
// Distinct from the engine's adaptive-Gaussian DENSITY_PRESETS in
// src/density.ts — those govern the DE blur kernel; these govern the
// post-DE tonemap. Both end up under "DENSITY EMITTER" in the section
// header for now; the visual-overhaul spec calls the tonemap row "Density
// Emitter preset strip" because that's the section the user sees.

export interface DensityPreset {
  name: string;
  vibe: string; // hex color dot for the preset chip
  gamma: number;
  gammaThreshold: number;
  vibrancy: number;
  brightness: number;
  contrast: number;
}

// TUNING-FLAG: placeholder values. To be calibrated against sample flames
// during Phase 12 chrome-verify before lock. Spec § "OPEN: density preset
// values" — keep these literal sentinels until the user signs off.
export const DENSITY_PRESETS: DensityPreset[] = [
  // TUNING-FLAG: baseline — current-engine defaults; safe "no opinion" pick.
  { name: 'default',   vibe: '#888888', gamma: 2.5, gammaThreshold: 0.01,  vibrancy: 1.0, brightness: 4.0, contrast: 1.0 },
  // TUNING-FLAG: soft glow, lifted blacks, slightly muted colors.
  { name: 'soft',      vibe: '#aabcde', gamma: 3.0, gammaThreshold: 0.02,  vibrancy: 0.8, brightness: 3.5, contrast: 0.9 },
  // TUNING-FLAG: high saturation, crushed shadows, low gamma.
  { name: 'vivid',     vibe: '#ff5030', gamma: 2.0, gammaThreshold: 0.005, vibrancy: 1.5, brightness: 5.0, contrast: 1.3 },
  // TUNING-FLAG: hard contrast, bright midtones, near-zero threshold.
  { name: 'punchy',    vibe: '#ffbe3e', gamma: 1.5, gammaThreshold: 0.001, vibrancy: 1.2, brightness: 6.0, contrast: 1.5 },
  // TUNING-FLAG: filmic — deep gamma, soft saturation, warm bias from the chip.
  { name: 'cinematic', vibe: '#603020', gamma: 4.0, gammaThreshold: 0.05,  vibrancy: 0.6, brightness: 2.5, contrast: 0.8 },
  // TUNING-FLAG: bright, clean, slightly cool — for clean cells / mandalas.
  { name: 'crystal',   vibe: '#a0c8ff', gamma: 2.2, gammaThreshold: 0.001, vibrancy: 1.4, brightness: 4.5, contrast: 1.2 },
];

export interface DensityPresetMatch {
  name: string;
  dirty: boolean;
}

export interface TonemapState {
  gamma: number;
  gammaThreshold: number;
  vibrancy: number;
  brightness: number;
  contrast: number;
}

export function currentPresetName(state: TonemapState): DensityPresetMatch | null {
  for (const p of DENSITY_PRESETS) {
    if (
      approxEq(p.gamma, state.gamma)
      && approxEq(p.gammaThreshold, state.gammaThreshold)
      && approxEq(p.vibrancy, state.vibrancy)
      && approxEq(p.brightness, state.brightness)
      && approxEq(p.contrast, state.contrast)
    ) {
      return { name: p.name, dirty: false };
    }
  }
  return null;
}

function approxEq(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}
