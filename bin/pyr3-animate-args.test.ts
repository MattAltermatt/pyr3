import { describe, it, expect, vi } from 'vitest';
import { parseEasingFlag, parseNstepsEnv, parseOutputSizeEnv, parseResumeEnv } from './pyr3-animate-args';

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
  it('#303 N9 — warns (naming the missing partner) on a partial size', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseOutputSizeEnv({ width: '3840' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('height='));
    warn.mockClear();
    parseOutputSizeEnv({ height: '2160' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('width='));
    warn.mockRestore();
  });
  it('#303 N9 — does NOT warn when neither is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseOutputSizeEnv({});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('parseNstepsEnv (#294)', () => {
  it('defaults to 1 when nsteps is unset (forces single-sample, not imported)', () => {
    expect(parseNstepsEnv({})).toBe(1);
  });
  it('uses an explicit nsteps=N to opt back into motion blur', () => {
    expect(parseNstepsEnv({ nsteps: '8' })).toBe(8);
    expect(parseNstepsEnv({ nsteps: '1000' })).toBe(1000);
  });
  it('falls back to 1 for a non-numeric nsteps', () => {
    expect(parseNstepsEnv({ nsteps: 'abc' })).toBe(1);
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
