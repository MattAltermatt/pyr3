import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pad5, jsonName, loadIncomingGenomeJson } from './flames-fs';

// Minimal VALID pyr3-JSON (verified against genomeFromJson). palette is
// {name,stops}, xforms carry colorSpeed + affine{a..f}, variations use `name`.
const FLAME = {
  version: 1,
  name: 'test',
  viewport: { scale: 100, cx: 0, cy: 0 },
  palette: { name: 'gray', stops: [{ t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 }] },
  xforms: [
    { weight: 1, color: 0, colorSpeed: 0.5, affine: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, variations: [{ name: 'linear', weight: 1 }] },
  ],
};

describe('flames-fs', () => {
  it('pad5 zero-pads to 5 digits', () => {
    expect(pad5(42)).toBe('00042');
    expect(pad5(0)).toBe('00000');
    expect(pad5(99999)).toBe('99999');
  });

  it('jsonName builds bare-id .pyr3.json', () => {
    expect(jsonName(42)).toBe('00042.pyr3.json');
    expect(jsonName(0)).toBe('00000.pyr3.json');
  });

  it('loadIncomingGenomeJson parses a raw .pyr3.json verbatim object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flames-fs-'));
    const p = join(dir, 'x.pyr3.json');
    writeFileSync(p, JSON.stringify(FLAME));
    const got = loadIncomingGenomeJson(p);
    expect(got).not.toBeNull();
    expect(got!.xforms.length).toBe(1);
    expect(got!.name).toBe('test');
  });

  it('returns null for a non-pyr3 / corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flames-fs-'));
    const p = join(dir, 'junk.json');
    writeFileSync(p, '{"not":"a flame"}');
    expect(loadIncomingGenomeJson(p)).toBeNull();
  });

  it('returns null for an unsupported extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flames-fs-'));
    const p = join(dir, 'note.txt');
    writeFileSync(p, 'hello');
    expect(loadIncomingGenomeJson(p)).toBeNull();
  });
});
