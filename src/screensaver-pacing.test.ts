import { describe, it, expect } from 'vitest';
import { qTarget, BUILD_UP_TARGET_Q, samplesPerFrameForBuildUp } from './screensaver-pacing';

describe('qTarget', () => {
  it('is 0 at t=0', () => {
    expect(qTarget(0, 300)).toBe(0);
  });

  it('hits BUILD_UP_TARGET_Q at t=buildUpSec', () => {
    expect(qTarget(300, 300)).toBe(BUILD_UP_TARGET_Q);
  });

  it('clamps at BUILD_UP_TARGET_Q past buildUpSec', () => {
    expect(qTarget(600, 300)).toBe(BUILD_UP_TARGET_Q);
  });

  it('linear in between', () => {
    expect(qTarget(150, 300)).toBe(BUILD_UP_TARGET_Q / 2);
  });

  it('clamps to 0 for negative elapsed', () => {
    expect(qTarget(-10, 300)).toBe(0);
  });

  it('handles buildUpSec=0 (immediately target)', () => {
    expect(qTarget(0,   0)).toBe(BUILD_UP_TARGET_Q);
    expect(qTarget(0.1, 0)).toBe(BUILD_UP_TARGET_Q);
  });
});

describe('samplesPerFrameForBuildUp', () => {
  it('computes per-frame samples for q=50 at hero dims, 30s, 30fps', () => {
    // 50 × 1920 × 1080 = 103,680,000 total; / (30 × 30 frames) = 115,200/frame
    expect(samplesPerFrameForBuildUp(50, 1920, 1080, 30, 30)).toBeCloseTo(115_200);
  });

  it('returns the total budget for buildUpSec=0 (immediate finish)', () => {
    // q=50 × 100×100 = 500_000 — all-in-one-frame.
    expect(samplesPerFrameForBuildUp(50, 100, 100, 0, 30)).toBe(500_000);
  });

  it('returns the total budget for fps=0 (degenerate)', () => {
    expect(samplesPerFrameForBuildUp(50, 100, 100, 30, 0)).toBe(500_000);
  });

  it('scales inversely with buildUpSec', () => {
    const a = samplesPerFrameForBuildUp(50, 1920, 1080, 30, 30);
    const b = samplesPerFrameForBuildUp(50, 1920, 1080, 60, 30);
    expect(a / b).toBeCloseTo(2);
  });

  it('scales inversely with fps', () => {
    const a = samplesPerFrameForBuildUp(50, 1920, 1080, 30, 30);
    const b = samplesPerFrameForBuildUp(50, 1920, 1080, 30, 60);
    expect(a / b).toBeCloseTo(2);
  });
});
