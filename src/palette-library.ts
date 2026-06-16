import { type ColorStop, type PaletteMode } from './palette';

const MINE_KEY = 'pyr3.palette.mine';

export interface SavedPalette {
  name: string;
  stops: ColorStop[];
  hue?: number;
  mode?: PaletteMode;
}

export function listMine(): SavedPalette[] {
  try {
    const raw = globalThis.localStorage?.getItem(MINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === 'string' && Array.isArray(p.stops));
  } catch { return []; }
}

export function getMine(name: string): SavedPalette | null {
  return listMine().find((p) => p.name === name) ?? null;
}

export function saveMine(p: SavedPalette): void {
  try {
    const all = listMine().filter((x) => x.name !== p.name);
    all.push(p);
    globalThis.localStorage?.setItem(MINE_KEY, JSON.stringify(all));
  } catch { /* storage disabled — no-op */ }
}

export function deleteMine(name: string): void {
  try {
    globalThis.localStorage?.setItem(MINE_KEY, JSON.stringify(listMine().filter((x) => x.name !== name)));
  } catch { /* no-op */ }
}
