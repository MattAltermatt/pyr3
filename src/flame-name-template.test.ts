import { describe, it, expect } from 'vitest';
import {
  hasTemplate,
  extractPlaceholders,
  resolveTemplate,
  type TemplateContext,
} from './flame-name-template';
import type { Genome } from './genome';

function g(overrides: Partial<Genome> = {}): Genome {
  return {
    name: 'flame',
    xforms: [],
    scale: 1,
    cx: 0,
    cy: 0,
    palette: { name: 'south-sea-bather', stops: [] },
    ...overrides,
  } as Genome;
}

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    genome: g(),
    seed: 0xa1b2c3d4,
    now: new Date(2026, 5, 3, 12, 45), // 2026-06-03 12:45 local
    index: 1,
    random: '3a2f',
    ...overrides,
  };
}

describe('hasTemplate', () => {
  it('false for plain literal strings', () => {
    expect(hasTemplate('my flame')).toBe(false);
    expect(hasTemplate('flame-2026')).toBe(false);
    expect(hasTemplate('')).toBe(false);
  });

  it('true when any {placeholder} is present', () => {
    expect(hasTemplate('{date}')).toBe(true);
    expect(hasTemplate('sky-{palette}')).toBe(true);
    expect(hasTemplate('{nick}-{index}')).toBe(true);
  });

  it('treats {{ }} escapes as literals (no template)', () => {
    expect(hasTemplate('hello {{world}}')).toBe(false);
    expect(hasTemplate('{{just braces}}')).toBe(false);
  });

  it('still true when mixed escapes + real placeholder', () => {
    expect(hasTemplate('{{literal}} and {date}')).toBe(true);
  });
});

describe('extractPlaceholders', () => {
  it('returns each {placeholder} name found', () => {
    expect(extractPlaceholders('{date}-{time}')).toEqual(['date', 'time']);
    expect(extractPlaceholders('plain')).toEqual([]);
  });

  it('ignores {{ }} escapes', () => {
    expect(extractPlaceholders('{{not}}-{real}')).toEqual(['real']);
  });

  it('returns duplicates as found (preserves order)', () => {
    expect(extractPlaceholders('{date}-{date}')).toEqual(['date', 'date']);
  });
});

describe('resolveTemplate — placeholders', () => {
  it('{date} → YYYYMMDD', () => {
    expect(resolveTemplate('{date}', ctx())).toBe('20260603');
  });

  it('{time} → HHMM (24h, zero-padded)', () => {
    expect(resolveTemplate('{time}', ctx())).toBe('1245');
    expect(resolveTemplate('{time}', ctx({ now: new Date(2026, 0, 1, 9, 5) }))).toBe('0905');
  });

  it('{datetime} → YYYYMMDD-HHMM', () => {
    expect(resolveTemplate('{datetime}', ctx())).toBe('20260603-1245');
  });

  it('{nick} → genome.nick', () => {
    expect(resolveTemplate('{nick}', ctx({ genome: g({ nick: 'matt' }) }))).toBe('matt');
  });

  it('{nick} → empty string when nick is missing', () => {
    expect(resolveTemplate('{nick}', ctx())).toBe('');
  });

  it('{seed} → 8-char lowercase hex', () => {
    expect(resolveTemplate('{seed}', ctx({ seed: 0xa1b2c3d4 }))).toBe('a1b2c3d4');
    expect(resolveTemplate('{seed}', ctx({ seed: 0x000000ff }))).toBe('000000ff');
  });

  it('{xforms} → xform count', () => {
    const genome = g({ xforms: [{} as never, {} as never, {} as never] });
    expect(resolveTemplate('{xforms}', ctx({ genome }))).toBe('3');
  });

  it('{palette} → palette.name', () => {
    expect(resolveTemplate('{palette}', ctx())).toBe('south-sea-bather');
  });

  it('{width} / {height} → genome.size dims', () => {
    const genome = g({ size: { width: 1920, height: 1080 } });
    expect(resolveTemplate('{width}', ctx({ genome }))).toBe('1920');
    expect(resolveTemplate('{height}', ctx({ genome }))).toBe('1080');
  });

  it('{width} / {height} → empty when size is missing', () => {
    expect(resolveTemplate('{width}', ctx())).toBe('');
    expect(resolveTemplate('{height}', ctx())).toBe('');
  });

  it('{quality} and {spp} both map to genome.quality', () => {
    const genome = g({ quality: 200 });
    expect(resolveTemplate('{quality}', ctx({ genome }))).toBe('200');
    expect(resolveTemplate('{spp}', ctx({ genome }))).toBe('200');
  });

  it('{random} → the context\'s random value (caller controls it)', () => {
    expect(resolveTemplate('{random}', ctx({ random: 'beef' }))).toBe('beef');
  });

  it('{index} → 4-digit zero-padded', () => {
    expect(resolveTemplate('{index}', ctx({ index: 1 }))).toBe('0001');
    expect(resolveTemplate('{index}', ctx({ index: 42 }))).toBe('0042');
    expect(resolveTemplate('{index}', ctx({ index: 9999 }))).toBe('9999');
  });

  it('{index} rolls over past 9999 to the natural-width integer (caller should warn)', () => {
    expect(resolveTemplate('{index}', ctx({ index: 10000 }))).toBe('10000');
  });
});

describe('resolveTemplate — composition', () => {
  it('substitutes multiple placeholders in one pass', () => {
    expect(resolveTemplate('{palette}-{date}-{index}', ctx())).toBe('south-sea-bather-20260603-0001');
  });

  it('mixes literals + placeholders', () => {
    expect(resolveTemplate('flame-{index}-final', ctx())).toBe('flame-0001-final');
  });

  it('{{ → literal { and }} → literal }', () => {
    expect(resolveTemplate('{{date}}', ctx())).toBe('{date}');
    expect(resolveTemplate('{{not-a-real}}', ctx())).toBe('{not-a-real}');
  });

  it('escape + real placeholder both work in one string', () => {
    expect(resolveTemplate('{{literal}}-{date}', ctx())).toBe('{literal}-20260603');
  });

  it('unknown placeholders stay literal in the output', () => {
    expect(resolveTemplate('flame-{palete}-{date}', ctx())).toBe('flame-{palete}-20260603');
  });

  it('empty input returns empty', () => {
    expect(resolveTemplate('', ctx())).toBe('');
  });

  it('plain literal name returns unchanged', () => {
    expect(resolveTemplate('Untitled flame', ctx())).toBe('Untitled flame');
  });
});
