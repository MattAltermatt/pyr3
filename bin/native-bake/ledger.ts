// bin/native-bake/ledger.ts
// Append-only content-hash → id ledger (#435). Ids only ever grow and are
// never reassigned, so shareable /esf/gen/1000/id/M URLs stay stable across
// re-bakes. Persisted as flames/pyr3-natives/ledger.json.
export interface LedgerEntry { id: number; }
export interface Ledger { nextId: number; entries: Record<string, LedgerEntry>; }

export function emptyLedger(): Ledger {
  return { nextId: 0, entries: {} };
}

export function ledgerHas(l: Ledger, hash: string): boolean {
  return Object.prototype.hasOwnProperty.call(l.entries, hash);
}

/** Append a new hash (assigning the next id). No-op if already present. */
export function ledgerAppend(l: Ledger, hash: string): Ledger {
  if (ledgerHas(l, hash)) return l;
  return {
    nextId: l.nextId + 1,
    entries: { ...l.entries, [hash]: { id: l.nextId } },
  };
}

export function ledgerIds(l: Ledger): number[] {
  return Object.values(l.entries).map((e) => e.id).sort((a, b) => a - b);
}
