import { type Palette, type PaletteMode } from './palette';

export interface PyrePaletteFile { format: 'pyre-palette'; version: 1; palette: Palette; }

const PALETTE_MODES: ReadonlySet<string> = new Set(['linear', 'step', 'smooth']);

function finiteAt(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${where} must be a finite number.`);
  }
  return v;
}

export function serializePalette(p: Palette): string {
  const file: PyrePaletteFile = { format: 'pyre-palette', version: 1, palette: p };
  return JSON.stringify(file, null, 2);
}

export function parsePaletteFile(text: string): Palette {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }
  const f = obj as Partial<PyrePaletteFile>;
  if (!f || f.format !== 'pyre-palette') throw new Error('Not a pyre-palette file.');
  const p = f.palette as Palette | undefined;
  if (!p || !Array.isArray(p.stops) || p.stops.length < 2) throw new Error('Palette has no stops.');
  // #308 — validate every stop's numeric fields are finite (a NaN would reach
  // the 256-entry Float32 GPU LUT via bakeLUT and corrupt the render), and that
  // optional hue/mode are well-formed. Mirrors serialize.ts's per-stop checks.
  const stops = p.stops.map((s, i) => {
    const so = (s ?? {}) as unknown as Record<string, unknown>;
    return {
      t: finiteAt(so['t'], `Palette stop ${i} (t)`),
      r: finiteAt(so['r'], `Palette stop ${i} (r)`),
      g: finiteAt(so['g'], `Palette stop ${i} (g)`),
      b: finiteAt(so['b'], `Palette stop ${i} (b)`),
    };
  });
  let mode: PaletteMode | undefined;
  if (p.mode !== undefined) {
    if (!PALETTE_MODES.has(p.mode)) throw new Error(`Palette mode "${p.mode}" is not valid.`);
    mode = p.mode;
  }
  const hue = p.hue !== undefined ? finiteAt(p.hue, 'Palette hue') : undefined;
  return { name: p.name ?? 'imported', stops, hue, mode };
}

function sanitize(name: string): string {
  return (name || 'palette').replace(/[^A-Za-z0-9._-]/g, '_');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Export a palette as a `.pyre-palette.json` download.
 *  #346 — `filename` (optional, no extension) overrides the auto-composed
 *  name from `p.name`; the `.pyre-palette.json` suffix is always appended. */
export function exportPalette(p: Palette, filename?: string): void {
  const base = filename !== undefined && filename.trim() !== '' ? sanitize(filename) : sanitize(p.name);
  downloadBlob(new Blob([serializePalette(p)], { type: 'application/json' }),
    `${base}.pyre-palette.json`);
}

export function importPalette(file: File): Promise<Palette> {
  return file.text().then(parsePaletteFile);
}
