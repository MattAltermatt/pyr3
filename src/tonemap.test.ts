import { describe, expect, it } from 'vitest';
import { DEFAULT_TONEMAP, withTonemap, type Tonemap } from './tonemap';

describe('Tonemap', () => {
  it('DEFAULT_TONEMAP is flam3-canonical (Phase 9-cal: brightness=1.0; SPIRAL_GALAXY inlines its own tonemap)', () => {
    expect(DEFAULT_TONEMAP).toEqual({
      gamma: 2.4,
      vibrancy: 0.0,
      highlightPower: 1.0,
      brightness: 1.0,
      gammaThreshold: 0.01,
    });
  });

  it('withTonemap fills missing fields from defaults when current is undefined', () => {
    const t = withTonemap(undefined, { gamma: 2.2 });
    expect(t.gamma).toBe(2.2);
    expect(t.vibrancy).toBe(DEFAULT_TONEMAP.vibrancy);
    expect(t.brightness).toBe(DEFAULT_TONEMAP.brightness);
    expect(t.gammaThreshold).toBe(DEFAULT_TONEMAP.gammaThreshold);
    expect(t.highlightPower).toBe(DEFAULT_TONEMAP.highlightPower);
  });

  it('withTonemap layers override on existing tonemap', () => {
    const current: Tonemap = { ...DEFAULT_TONEMAP, gamma: 6.0 };
    const t = withTonemap(current, { vibrancy: 0.3 });
    expect(t.gamma).toBe(6.0);
    expect(t.vibrancy).toBe(0.3);
  });

  it('all 5 fields are independently overridable', () => {
    const t = withTonemap(undefined, {
      gamma: 3.0,
      vibrancy: 0.5,
      highlightPower: 0.8,
      brightness: 20.0,
      gammaThreshold: 0.05,
    });
    expect(t).toEqual({
      gamma: 3.0,
      vibrancy: 0.5,
      highlightPower: 0.8,
      brightness: 20.0,
      gammaThreshold: 0.05,
    });
  });
});
