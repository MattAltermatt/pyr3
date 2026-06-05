import { describe, it, expect } from 'vitest';
import { qTarget, BUILD_UP_TARGET_Q } from './screensaver-pacing';

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
