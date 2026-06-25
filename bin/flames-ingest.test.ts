import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planIngest, applyIngest } from './flames-ingest';
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
// Same flame, different weight → DIFFERENT canonical hash (weight is identity-bearing).
const FLAME2 = { ...FLAME, name: 'b', xforms: [{ ...FLAME.xforms[0], weight: 2 }] };

function tmp() { return mkdtempSync(join(tmpdir(), 'ingest-')); }

describe('flames-ingest', () => {
  it('match-only: known flame planned to json, unknown left in incoming', () => {
    const inc = tmp();
    writeFileSync(join(inc, 'known.pyr3.json'), JSON.stringify(FLAME));
    writeFileSync(join(inc, 'unknown.pyr3.json'), JSON.stringify(FLAME2));
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME)); // id 0
    const { plan } = planIngest(inc, ledger, /*addNew*/ false);
    expect(plan.writes.map((w) => w.id)).toEqual([0]);
    expect(plan.left).toEqual(['unknown.pyr3.json']);
    expect(plan.newIds).toEqual([]);
  });

  it('add-new: unknown flame earns the next id', () => {
    const inc = tmp();
    writeFileSync(join(inc, 'unknown.pyr3.json'), JSON.stringify(FLAME2));
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME)); // id 0 taken
    const { plan, ledger: next } = planIngest(inc, ledger, /*addNew*/ true);
    expect(plan.newIds).toEqual([1]);
    expect(next.nextId).toBe(2);
    expect(plan.left).toEqual([]);
  });

  it('png+json twins collapse to one write and both sources deleted', () => {
    const inc = tmp();
    writeFileSync(join(inc, 'x.pyr3.json'), JSON.stringify(FLAME));
    writeFileSync(join(inc, 'x-copy.pyr3.json'), JSON.stringify(FLAME)); // identical → same hash
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME));
    const { plan } = planIngest(inc, ledger, false);
    expect(plan.writes.length).toBe(1);
    expect(plan.writes[0]!.sources.sort()).toEqual(['x-copy.pyr3.json', 'x.pyr3.json']);
  });

  it('applyIngest writes raw json, deletes sources, file re-hashes to its id', () => {
    const inc = tmp();
    const out = tmp();
    writeFileSync(join(inc, 'known.pyr3.json'), JSON.stringify(FLAME));
    const ledger = ledgerAppend(emptyLedger(), canonicalFlameHash(FLAME));
    const { plan } = planIngest(inc, ledger, false);
    applyIngest(plan, inc, out);
    expect(existsSync(join(out, '00000.pyr3.json'))).toBe(true);
    expect(existsSync(join(inc, 'known.pyr3.json'))).toBe(false);
    // Identity rule: written file hashes back to id 0.
    const written = JSON.parse(readFileSync(join(out, '00000.pyr3.json'), 'utf8'));
    expect(ledger.entries[canonicalFlameHash(written)]!.id).toBe(0);
  });

  it('skips non-pyr3 files without crashing', () => {
    const inc = tmp();
    writeFileSync(join(inc, 'junk.json'), '{"not":"a flame"}');
    writeFileSync(join(inc, 'note.txt'), 'ignore me');
    const { plan } = planIngest(inc, emptyLedger(), true);
    expect(plan.writes).toEqual([]);
    expect(plan.left).toEqual([]);
  });
});
