import { describe, it, expect } from 'vitest';
import { composeSaveFilename } from './save-image';

describe('composeSaveFilename (#22)', () => {
  it('tier render — lowercase tier name + q', () => {
    expect(
      composeSaveFilename('electricsheep.247.19679', {
        tierLabel: 'Preview',
        width: 1024,
        height: 576,
        spp: 16,
      }),
    ).toBe('electricsheep.247.19679-preview-q16.png');

    expect(
      composeSaveFilename('electricsheep.247.19679', {
        tierLabel: '4K',
        width: 3840,
        height: 2160,
        spp: 200,
      }),
    ).toBe('electricsheep.247.19679-4k-q200.png');

    expect(
      composeSaveFilename('myflame', {
        tierLabel: 'Standard',
        width: 1920,
        height: 1080,
        spp: 50,
      }),
    ).toBe('myflame-standard-q50.png');
  });

  it('custom render — uses long edge in px + q', () => {
    expect(
      composeSaveFilename('electricsheep.247.19679', {
        tierLabel: 'Custom',
        width: 2048,
        height: 1152,
        spp: 100,
      }),
    ).toBe('electricsheep.247.19679-2048px-q100.png');

    // Portrait flame — long edge follows the larger dimension.
    expect(
      composeSaveFilename('myflame', {
        tierLabel: 'Custom',
        width: 1080,
        height: 1920,
        spp: 50,
      }),
    ).toBe('myflame-1920px-q50.png');
  });

  it('no quality (pre-render) — just <flame>.png', () => {
    expect(composeSaveFilename('electricsheep.247.19679', null)).toBe(
      'electricsheep.247.19679.png',
    );
    expect(composeSaveFilename('SPIRAL_GALAXY', null)).toBe('SPIRAL_GALAXY.png');
  });

  it('sanitizes filesystem-hostile chars to underscores', () => {
    expect(composeSaveFilename('flame/with\\slashes', null)).toBe('flame_with_slashes.png');
    expect(composeSaveFilename('A Spiral Galaxy', null)).toBe('A_Spiral_Galaxy.png');
    expect(composeSaveFilename('weird:name*here?', null)).toBe('weird_name_here_.png');
    // The 🔥 codepoint is a UTF-16 surrogate pair (🔥); each
    // surrogate code unit is a non-allowed "character" → two underscores.
    expect(composeSaveFilename('em🔥oji', null)).toBe('em__oji.png');
  });

  it('keeps allowed punctuation: . _ -', () => {
    expect(
      composeSaveFilename('electricsheep.247.19679', {
        tierLabel: 'Preview',
        width: 1024,
        height: 576,
        spp: 16,
      }),
    ).toBe('electricsheep.247.19679-preview-q16.png');
    expect(composeSaveFilename('my_flame-v2.test', null)).toBe('my_flame-v2.test.png');
  });

  it('empty / whitespace / null / undefined name → pyr3-flame fallback', () => {
    expect(composeSaveFilename('', null)).toBe('pyr3-flame.png');
    expect(composeSaveFilename('   ', null)).toBe('pyr3-flame.png');
    expect(composeSaveFilename(null, null)).toBe('pyr3-flame.png');
    expect(composeSaveFilename(undefined, null)).toBe('pyr3-flame.png');
    // Fallback still composes the tier suffix.
    expect(
      composeSaveFilename('', {
        tierLabel: 'Preview',
        width: 1024,
        height: 576,
        spp: 16,
      }),
    ).toBe('pyr3-flame-preview-q16.png');
  });
});
