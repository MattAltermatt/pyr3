import { describe, expect, it } from 'vitest';
import { deriveCalibration, PREFILTER_WHITE, WHITE_LEVEL } from './calibration';
import { SPIRAL_GALAXY } from './genome';

describe('deriveCalibration', () => {
  it('k1 = brightness * PREFILTER_WHITE * 268/256', () => {
    const { k1 } = deriveCalibration({ scale: 200, sampleCount: 16e6, brightness: 20 });
    expect(k1).toBeCloseTo((20 * 255 * 268) / 256, 5);
  });

  it('k2 = scale^2 / (WHITE_LEVEL * sampleCount)', () => {
    const { k2 } = deriveCalibration({ scale: 200, sampleCount: 16e6, brightness: 1 });
    expect(k2).toBeCloseTo((200 * 200) / (255 * 16e6), 12);
  });

  it('count_avg * k2 is independent of authored quality (the math invariant)', () => {
    const N_PIXELS = 1024 * 1024;
    const SCALE = 200;
    for (const sampleCount of [1e6, 16e6, 100e6, 2e9]) {
      const { k2 } = deriveCalibration({ scale: SCALE, sampleCount, brightness: 1 });
      const countAvg = sampleCount / N_PIXELS;
      const product = countAvg * k2;
      expect(product).toBeCloseTo((SCALE * SCALE) / (N_PIXELS * WHITE_LEVEL), 10);
    }
  });

  it('PREFILTER_WHITE and WHITE_LEVEL match flam3 (rect.c:38, private.h:46)', () => {
    expect(PREFILTER_WHITE).toBe(255);
    expect(WHITE_LEVEL).toBe(255);
  });
});

describe('oversample factor (Phase 9-supersample-real)', () => {
  it('k2 includes oversample² factor in the numerator', () => {
    const a = deriveCalibration({ scale: 200, sampleCount: 16e6, brightness: 1 });
    const b = deriveCalibration({ scale: 200, sampleCount: 16e6, brightness: 1, oversample: 4 });
    expect(b.k2 / a.k2).toBeCloseTo(16, 6);
  });

  it('k2 is unchanged at oversample=1 (default)', () => {
    const a = deriveCalibration({ scale: 200, sampleCount: 16e6, brightness: 1 });
    const b = deriveCalibration({ scale: 200, sampleCount: 16e6, brightness: 1, oversample: 1 });
    expect(b.k2).toBeCloseTo(a.k2, 12);
  });

  it('count × k2 invariant under oversample (per flam3 rect.c:933-937)', () => {
    // flam3: count_per_output_pixel ≈ (quality / N²) × 255 (per-hit ×255).
    // count × k2 = (quality/N² × 255) × (N² × scale²/(WHITE × W × H × quality))
    //            = 255 × scale²/(WHITE × W × H), independent of N.
    const SCALE = 200, WIDTH = 1024, HEIGHT = 1024, QUALITY = 16;
    const SAMPLE_COUNT = QUALITY * WIDTH * HEIGHT;
    for (const N of [1, 2, 4, 8]) {
      const { k2 } = deriveCalibration({ scale: SCALE, sampleCount: SAMPLE_COUNT, brightness: 1, oversample: N });
      const count = (QUALITY / (N * N)) * 255;
      const product = count * k2;
      expect(product).toBeCloseTo((255 * SCALE * SCALE) / (255 * WIDTH * HEIGHT), 6);
    }
  });
});

describe('Spiral Galaxy visual continuity (pre/post 9-supersample-real)', () => {
  // SPIRAL_GALAXY has vibrancy=0, so output color goes through the `perch`
  // (per-channel-gamma) path rather than the vibrancy / newrgb path. perch
  // depends on c.rgb (R,G,B post-ls), which is essentially unchanged by the
  // count-unit ×255 fix (R,G,B were already ×255 per hit; only `count` got
  // the ×255 alignment). So `c.rgb × ls` should stay within visual-continuity
  // bounds. ls itself shifts (count is now ×255 larger; log-arg moves into
  // a slightly more compressive regime), but the small-log linear approximation
  // still holds at Spiral Galaxy's per-pixel densities.

  // count_avg per output pixel = (16M samples / 1024²) × 255 = 16 × 255 = 4080
  const COUNT_AVG_POST = 16 * 255;
  const TOLERANCE = 0.05; // 5% — visual-continuity threshold on c.rgb × ls
  const PYR3_SAMPLE_COUNT = 4096 * 4096;

  it('output color (c.rgb × ls) at typical density stays within 5% of pre-fix', () => {
    const tonemap = SPIRAL_GALAXY.tonemap;
    expect(tonemap, 'SPIRAL_GALAXY must inline a tonemap for visual continuity').toBeDefined();
    const { k1, k2 } = deriveCalibration({
      scale: SPIRAL_GALAXY.scale,
      sampleCount: PYR3_SAMPLE_COUNT,
      brightness: tonemap!.brightness,
    });
    // c.rgb per output pixel ≈ count × pal × 255. After ls: c.rgb × ls.
    // Pre-fix: count_old = 16, ls_old = k1·log(1 + 16·k2)/16 ≈ k1·k2 (small log)
    // Post-fix: count_new = 4080, ls_new = k1·log(1 + 4080·k2)/4080
    // c.rgb scale unchanged in both cases (R bump is hits × pal × 255).
    // Output c.rgb_post = (16 × pal × 255) × ls_new
    //         c.rgb_pre = (16 × pal × 255) × ls_old
    // Ratio should be ls_new / ls_old ≈ 1 in small-log limit.
    const lsPost = (k1 * Math.log(1 + COUNT_AVG_POST * k2)) / COUNT_AVG_POST;
    const lsPre = (k1 * Math.log(1 + 16 * k2)) / 16;
    const ratio = lsPost / lsPre;
    expect(
      Math.abs(ratio - 1),
      `lsPost=${lsPost}, lsPre=${lsPre}, ratio=${ratio.toFixed(4)}`,
    ).toBeLessThan(TOLERANCE);
  });
});
