// bin/native-bake/ledger.test.ts
import { describe, it, expect } from 'vitest';
import { emptyLedger, ledgerHas, ledgerAppend, ledgerIds, type Ledger } from './ledger';

describe('ledger', () => {
  it('appends new hashes with monotonically increasing ids', () => {
    let l: Ledger = emptyLedger();
    l = ledgerAppend(l, 'hashA');
    l = ledgerAppend(l, 'hashB');
    expect(l.entries.hashA!.id).toBe(0);
    expect(l.entries.hashB!.id).toBe(1);
    expect(ledgerIds(l)).toEqual([0, 1]);
  });

  it('does not reassign or duplicate a known hash', () => {
    let l: Ledger = emptyLedger();
    l = ledgerAppend(l, 'hashA');
    const before = l.entries.hashA!.id;
    expect(ledgerHas(l, 'hashA')).toBe(true);
    l = ledgerAppend(l, 'hashA'); // no-op
    expect(l.entries.hashA!.id).toBe(before);
    expect(ledgerIds(l).length).toBe(1);
  });
});
