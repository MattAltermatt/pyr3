import { type Palette } from './palette';

export interface PyrePaletteFile { format: 'pyre-palette'; version: 1; palette: Palette; }

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
  return { name: p.name ?? 'imported', stops: p.stops, hue: p.hue, mode: p.mode };
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

export function exportPalette(p: Palette): void {
  downloadBlob(new Blob([serializePalette(p)], { type: 'application/json' }),
    `${sanitize(p.name)}.pyre-palette.json`);
}

export function importPalette(file: File): Promise<Palette> {
  return file.text().then(parsePaletteFile);
}
