import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { brotliCompressSync } from 'node:zlib';
import { planBackfill } from './flames-backfill';
import { canonicalFlameHash } from './native-bake/canonical-hash';
import { emptyLedger, ledgerAppend } from './native-bake/ledger';
import type { Pyr3JsonV1 } from '../src/serialize';

const FLAME: Pyr3JsonV1 = {
  version: 1,
  name: 'a',
  viewport: { scale: 100, cx: 0, cy: 0 },
  palette: { name: 'gray', stops: [{ t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 }] },
  xforms: [
    { weight: 1, color: 0, colorSpeed: 0.5, affine: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, variations: [{ name: 'linear', weight: 1 }] },
  ],
};

function tmp() { return mkdtempSync(join(tmpdir(), 'backfill-')); }

function writeChunk(dir: string, name: string, obj: Record<string, string>) {
  writeFileSync(join(dir, name), brotliCompressSync(Buffer.from(JSON.stringify(obj))));
}

describe('flames-backfill', () => {
  it('plans a write for a ledger id missing from json/', () => {
    const chunkDir = tmp();
    const jsonDir = tmp();
    const jsonStr = JSON.stringify(FLAME);
    writeChunk(chunkDir, '00000.flam3chunk', { '0': jsonStr });
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME)); // id 0
    const plan = planBackfill(chunkDir, jsonDir, ledger);
    expect(plan.writes).toEqual([{ id: 0, json: jsonStr }]);
  });

  it('skips ids already present in json/', () => {
    const chunkDir = tmp();
    const jsonDir = tmp();
    writeChunk(chunkDir, '00000.flam3chunk', { '0': JSON.stringify(FLAME) });
    writeFileSync(join(jsonDir, '00000.pyr3.json'), JSON.stringify(FLAME)); // already there
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME));
    const plan = planBackfill(chunkDir, jsonDir, ledger);
    expect(plan.writes).toEqual([]);
  });

  it('throws on hash/id drift (chunk content does not map to its claimed id)', () => {
    const chunkDir = tmp();
    const jsonDir = tmp();
    writeChunk(chunkDir, '00000.flam3chunk', { '0': JSON.stringify(FLAME) });
    const ledger = emptyLedger(); // FLAME's hash is NOT in the ledger → drift
    expect(() => planBackfill(chunkDir, jsonDir, ledger)).toThrow(/drift/i);
  });

  it('skips the non-flame `_v` format sentinel key', () => {
    const chunkDir = tmp();
    const jsonDir = tmp();
    const jsonStr = JSON.stringify(FLAME);
    writeChunk(chunkDir, '00000.flam3chunk', { _v: 'pyr3-natives', '0': jsonStr });
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME));
    const plan = planBackfill(chunkDir, jsonDir, ledger);
    expect(plan.writes).toEqual([{ id: 0, json: jsonStr }]);
  });

  it('ignores non-chunk files in the chunk dir', () => {
    const chunkDir = tmp();
    const jsonDir = tmp();
    writeFileSync(join(chunkDir, 'avail.flam3idx'), Buffer.from('not a chunk'));
    const plan = planBackfill(chunkDir, jsonDir, emptyLedger());
    expect(plan.writes).toEqual([]);
  });
});
