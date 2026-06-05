// pyr3 — DENSITY EMITTER preset list + dirty-state helper (Phase 7).
//
// Six named visual presets. Each carries the five tonemap fields (gamma,
// gammaThreshold, vibrancy, brightness, contrast). currentPresetName()
// detects which preset (if any) the current tonemap state exactly matches.

import { describe, it, expect } from 'vitest';
import { DENSITY_PRESETS, currentPresetName } from './edit-preset-density';

describe('DENSITY_PRESETS', () => {
  it('has the six expected named presets in order', () => {
    expect(DENSITY_PRESETS.map((p) => p.name)).toEqual([
      'default',
      'soft',
      'vivid',
      'punchy',
      'cinematic',
      'crystal',
    ]);
  });

  it('every preset carries all five tonemap fields', () => {
    for (const p of DENSITY_PRESETS) {
      expect(typeof p.gamma).toBe('number');
      expect(typeof p.gammaThreshold).toBe('number');
      expect(typeof p.vibrancy).toBe('number');
      expect(typeof p.brightness).toBe('number');
      expect(typeof p.contrast).toBe('number');
    }
  });

  it('every preset has a vibe color for the chip', () => {
    for (const p of DENSITY_PRESETS) {
      expect(p.vibe).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('currentPresetName', () => {
  it('returns {name, dirty: false} when state matches a preset exactly', () => {
    const def = DENSITY_PRESETS[0]!;
    const res = currentPresetName({
      gamma: def.gamma,
      gammaThreshold: def.gammaThreshold,
      vibrancy: def.vibrancy,
      brightness: def.brightness,
      contrast: def.contrast,
    });
    expect(res).toEqual({ name: 'default', dirty: false });
  });

  it('matches each of the six presets at its exact values', () => {
    for (const p of DENSITY_PRESETS) {
      const res = currentPresetName({
        gamma: p.gamma,
        gammaThreshold: p.gammaThreshold,
        vibrancy: p.vibrancy,
        brightness: p.brightness,
        contrast: p.contrast,
      });
      expect(res).toEqual({ name: p.name, dirty: false });
    }
  });

  it('returns null when no preset matches', () => {
    const res = currentPresetName({
      gamma: 99.123,
      gammaThreshold: 0.987,
      vibrancy: 7.4,
      brightness: 13.2,
      contrast: 5.5,
    });
    expect(res).toBeNull();
  });

  it('returns null when only some fields match the preset', () => {
    const def = DENSITY_PRESETS[0]!;
    const res = currentPresetName({
      gamma: def.gamma,
      gammaThreshold: def.gammaThreshold,
      vibrancy: def.vibrancy,
      brightness: def.brightness + 0.5, // perturb one field
      contrast: def.contrast,
    });
    expect(res).toBeNull();
  });
});
