// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { load, sniffKind } from './loader';
import { injectPngTextChunk } from './png-text-chunk';

function makeMinimalPng(): Uint8Array {
  // Same minimal 1x1 RGBA PNG used by png-text-chunk.test.ts.
  const hex = (
    '89504e470d0a1a0a'
    + '0000000d49484452000000010000000108060000001f15c4890000000d4944415478'
    + 'da636060606000000005000160a18d9b0000000049454e44ae426082'
  );
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe('sniffKind', () => {
  it('detects .flame by suffix', () => {
    expect(sniffKind('foo.flame', '<flame/>')).toBe('flame');
  });

  it('detects .flam3 by suffix (Electric Sheep / flam3-cli convention)', () => {
    expect(sniffKind('electricsheep.248.23554.flam3', '<flame/>')).toBe('flame');
  });

  it('detects .pyr3.json by suffix', () => {
    expect(sniffKind('foo.pyr3.json', '{"version":1}')).toBe('pyr3-json');
  });

  it('detects .json by suffix', () => {
    expect(sniffKind('foo.json', '{"version":1}')).toBe('pyr3-json');
  });

  it('falls back to content sniff for unknown suffix starting with <', () => {
    expect(sniffKind('foo.txt', '   \n<flame/>')).toBe('flame');
  });

  it('falls back to pyr3-json for unknown suffix not starting with <', () => {
    expect(sniffKind('foo.txt', '{"version":1}')).toBe('pyr3-json');
  });

  it('treats no extension same as unknown — content sniff wins', () => {
    expect(sniffKind('flameish', '<flame/>')).toBe('flame');
    expect(sniffKind('jsonish', '{}')).toBe('pyr3-json');
  });
});

describe('load', () => {
  const makeFile = (name: string, content: string): File =>
    new File([content], name, { type: 'application/octet-stream' });

  const minimalFlameXml = (): string => {
    let palette = '';
    for (let i = 0; i < 256; i++) palette += `<color index="${i}" rgb="${i} ${i} ${i}"/>`;
    return `<flame name="t" size="1024 1024" center="0 0" scale="100">${palette}<xform weight="1" color="0" color_speed="0.5" coefs="1 0 0 1 0 0" linear="1"/></flame>`;
  };

  it('returns kind=flame and a report for a .flame file', async () => {
    const result = await load(makeFile('t.flame', minimalFlameXml()));
    expect(result.kind).toBe('flame');
    expect(result.genome.name).toBe('t');
    expect(result.report).toBeDefined();
  });

  it('returns kind=pyr3-json without a report for a .pyr3.json file', async () => {
    const json = JSON.stringify({
      version: 1,
      name: 'spiral',
      viewport: { scale: 220, cx: 0, cy: 0 },
      palette: {
        name: 'pyre',
        stops: [
          { t: 0, r: 0, g: 0, b: 0 },
          { t: 1, r: 1, g: 1, b: 1 },
        ],
      },
      xforms: [
        {
          weight: 1,
          color: 0,
          colorSpeed: 0.5,
          affine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
          variations: [{ name: 'linear', weight: 1 }],
        },
      ],
    });
    const result = await load(makeFile('spiral.pyr3.json', json));
    expect(result.kind).toBe('pyr3-json');
    expect(result.report).toBeUndefined();
    expect(result.genome.name).toBe('spiral');
  });

  it('throws cleanly when a .json file actually contains XML', async () => {
    await expect(load(makeFile('bad.json', '<flame/>'))).rejects.toThrow();
  });

  it('uses content sniff for an unknown suffix containing XML', async () => {
    const result = await load(makeFile('mystery.txt', minimalFlameXml()));
    expect(result.kind).toBe('flame');
  });
});

describe('#196 PNG with pyr3 metadata', () => {
  const minimalGenomeJson = (): string => JSON.stringify({
    version: 1,
    name: 'from-png',
    viewport: { scale: 220, cx: 0, cy: 0 },
    palette: {
      name: 'pyre',
      stops: [
        { t: 0, r: 0, g: 0, b: 0 },
        { t: 1, r: 1, g: 1, b: 1 },
      ],
    },
    xforms: [
      {
        weight: 1,
        color: 0,
        colorSpeed: 0.5,
        affine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 },
        variations: [{ name: 'linear', weight: 1 }],
      },
    ],
  });

  const makePngFile = (bytes: Uint8Array, name = 'saved.png'): File =>
    new File([new Blob([bytes as BlobPart], { type: 'image/png' })], name, { type: 'image/png' });

  it('sniffKind picks up .png as pyr3-png', () => {
    expect(sniffKind('saved.pyr3.png', '')).toBe('pyr3-png');
    expect(sniffKind('Saved.PNG', '')).toBe('pyr3-png');
  });

  it('load returns kind=pyr3-png and the embedded genome', async () => {
    const png = injectPngTextChunk(makeMinimalPng(), 'pyr3', minimalGenomeJson());
    const result = await load(makePngFile(png));
    expect(result.kind).toBe('pyr3-png');
    expect(result.genome.name).toBe('from-png');
    expect(result.report).toBeUndefined();
  });

  it('throws a clear "no pyr3 metadata" message on a foreign PNG', async () => {
    const png = makeMinimalPng(); // bare PNG, no pyr3 chunk
    await expect(load(makePngFile(png, 'foreign.png'))).rejects.toThrow(/no pyr3 metadata/);
  });
});
