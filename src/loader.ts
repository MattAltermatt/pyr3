// pyr3 — Phase 8 unified file loader.
//
// Single dispatch point for .flame XML, .pyr3.json, and .png files.
// Sniff order:
//   1. filename suffix (.flame / .flam3 / .json / .pyr3.json / .png)
//   2. content prefix '<' → flame
//   3. default → pyr3-json (will throw cleanly via JSON.parse if it isn't)
//
// .png files (#196) carry the genome in a `pyr3` tEXt chunk written by the
// Save Render path (#123). Foreign PNGs (no pyr3 chunk) throw with a clear
// message — the caller surfaces it as a toast / load-error panel.
//
// Note: .flam3 is the upstream Electric Sheep / flam3-cli convention; .flame
// is the Apophysis convention. Both are the same XML schema — just the
// extension differs by tool.
//
// Both HUD "load" click and canvas drag-drop call into load(file).

import { type Genome } from './genome';
import { genomeFromJson } from './serialize';
import { parseFlame, type ImportReport } from './flame-import';
import { readPngTextChunks } from './png-text-chunk';

export type LoadKind = 'pyr3-json' | 'flame' | 'pyr3-png';

export interface LoadResult {
  kind: LoadKind;
  genome: Genome;
  report?: ImportReport;
}

export function sniffKind(filename: string, content: string): LoadKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'pyr3-png';
  if (lower.endsWith('.flame') || lower.endsWith('.flam3')) return 'flame';
  if (lower.endsWith('.json')) return 'pyr3-json';
  // Content sniff fallback for unknown suffixes.
  if (content.trimStart().startsWith('<')) return 'flame';
  return 'pyr3-json';
}

export async function load(file: File): Promise<LoadResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.png')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const chunks = readPngTextChunks(buf);
    const json = chunks['pyr3'];
    if (!json) {
      throw new Error(
        'PNG has no pyr3 metadata — only PNGs saved by pyr3 (Save Render) carry the genome.',
      );
    }
    const parsed: unknown = JSON.parse(json);
    const genome = genomeFromJson(parsed);
    return { kind: 'pyr3-png', genome };
  }
  const text = await file.text();
  const kind = sniffKind(file.name, text);
  if (kind === 'flame') {
    const { genome, report } = parseFlame(text);
    return { kind, genome, report };
  }
  const parsed: unknown = JSON.parse(text);
  const genome = genomeFromJson(parsed);
  return { kind: 'pyr3-json', genome };
}
