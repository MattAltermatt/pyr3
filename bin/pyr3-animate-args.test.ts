import { describe, it, expect } from 'vitest';
import { parseEasingFlag, parseOutputSizeEnv, parseResumeEnv } from './pyr3-animate-args';

describe('parseEasingFlag', () => {
  it('returns undefined when --easing is absent', () => {
    expect(parseEasingFlag(['in.flam3', 'out'])).toBeUndefined();
  });
  it('parses a JSON array after --easing', () => {
    expect(parseEasingFlag(['in.flam3', 'out', '--easing', '[{"kind":"preset","name":"hold"}]']))
      .toEqual([{ kind: 'preset', name: 'hold' }]);
  });
  it('throws on malformed JSON', () => {
    expect(() => parseEasingFlag(['--easing', '{bad'])).toThrow();
  });
  it('treats a flag-lookalike next token as a missing argument', () => {
    expect(() => parseEasingFlag(['--easing', '--verbose']))
      .toThrow(/requires a JSON argument/);
  });
});

describe('parseOutputSizeEnv (#274)', () => {
  it('parses width + height into an output size (both required)', () => {
    expect(parseOutputSizeEnv({ width: '3840', height: '2160' })).toEqual({ width: 3840, height: 2160 });
  });
  it('returns undefined when only one of width/height is set', () => {
    expect(parseOutputSizeEnv({ width: '3840' })).toBeUndefined();
    expect(parseOutputSizeEnv({ height: '2160' })).toBeUndefined();
  });
  it('returns undefined for non-positive / non-finite dims', () => {
    expect(parseOutputSizeEnv({ width: '0', height: '100' })).toBeUndefined();
    expect(parseOutputSizeEnv({ width: 'abc', height: '100' })).toBeUndefined();
  });
  it('returns undefined when neither is set', () => {
    expect(parseOutputSizeEnv({})).toBeUndefined();
  });
});

describe('parseResumeEnv (#275)', () => {
  it('is true for "1" / "true" (case-insensitive)', () => {
    expect(parseResumeEnv({ resume: '1' })).toBe(true);
    expect(parseResumeEnv({ resume: 'true' })).toBe(true);
    expect(parseResumeEnv({ resume: 'TRUE' })).toBe(true);
  });
  it('is false by default and for other values', () => {
    expect(parseResumeEnv({})).toBe(false);
    expect(parseResumeEnv({ resume: '0' })).toBe(false);
    expect(parseResumeEnv({ resume: 'no' })).toBe(false);
  });
});
