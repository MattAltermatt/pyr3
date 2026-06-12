// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { listMine, getMine, saveMine, deleteMine } from './palette-library';
import { type ColorStop } from './palette';

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as unknown as Storage;
}

const STOPS: ColorStop[] = [{ t: 0, r: 0, g: 0, b: 0 }, { t: 1, r: 1, g: 1, b: 1 }];

describe('palette-library', () => {
  beforeEach(() => installLocalStorageStub());
  it('starts empty', () => expect(listMine()).toEqual([]));
  it('saves and reads back', () => {
    saveMine({ name: 'ember', stops: STOPS });
    expect(listMine().map((p) => p.name)).toEqual(['ember']);
    expect(getMine('ember')!.stops).toHaveLength(2);
  });
  it('upserts by name (no duplicate)', () => {
    saveMine({ name: 'ember', stops: STOPS });
    saveMine({ name: 'ember', stops: STOPS, hue: 30 });
    expect(listMine()).toHaveLength(1);
    expect(getMine('ember')!.hue).toBe(30);
  });
  it('deletes', () => {
    saveMine({ name: 'ember', stops: STOPS });
    deleteMine('ember');
    expect(listMine()).toEqual([]);
  });
  it('survives corrupt storage (returns empty, no throw)', () => {
    localStorage.setItem('pyr3.palette.mine', '{not json');
    expect(listMine()).toEqual([]);
  });
});
