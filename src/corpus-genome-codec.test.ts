// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { genomeFromCorpusString, corpusStringIsJson } from './corpus-genome-codec';
import { genomeToJson } from './serialize';

// Known-good minimal flam3 XML (matches flame-import.test.ts fixtures).
const FLAM3_XML =
  '<flame name="t" size="1024 1024" center="0 0" scale="100">' +
  '<color index="0" rgb="0 0 0"/><color index="255" rgb="255 255 255"/>' +
  '<xform weight="1" color="0" coefs="1 0 0 1 0 0" linear="1"/></flame>';

describe('corpusStringIsJson', () => {
  it('detects pyr3-JSON vs flam3 XML, tolerating whitespace', () => {
    expect(corpusStringIsJson('{"version":1}')).toBe(true);
    expect(corpusStringIsJson('  \n {"a":1}')).toBe(true);
    expect(corpusStringIsJson(FLAM3_XML)).toBe(false);
    expect(corpusStringIsJson('  <flame/>')).toBe(false);
  });
});

describe('genomeFromCorpusString', () => {
  it('parses flam3 XML (leading "<")', () => {
    const g = genomeFromCorpusString(FLAM3_XML);
    expect(g.xforms.length).toBe(1);
  });

  it('parses pyr3-JSON (leading "{")', () => {
    const json = JSON.stringify(genomeToJson(genomeFromCorpusString(FLAM3_XML)));
    const g = genomeFromCorpusString(json);
    expect(g.xforms.length).toBe(1);
  });

  it('tolerates leading whitespace on JSON', () => {
    const json = '  \n' + JSON.stringify(genomeToJson(genomeFromCorpusString(FLAM3_XML)));
    const g = genomeFromCorpusString(json);
    expect(g.xforms.length).toBe(1);
  });
});
