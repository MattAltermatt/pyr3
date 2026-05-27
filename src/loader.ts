// pyr3 — Phase 8 unified file loader.
//
// Single dispatch point for both .flame XML and .pyr3.json files. Sniff order:
//   1. filename suffix (.flame / .flam3 / .json / .pyr3.json)
//   2. content prefix '<' → flame
//   3. default → pyr3-json (will throw cleanly via JSON.parse if it isn't)
//
// Note: .flam3 is the upstream Electric Sheep / flam3-cli convention; .flame
// is the Apophysis convention. Both are the same XML schema — just the
// extension differs by tool.
//
// Both HUD "load" click and canvas drag-drop call into load(file).

import { type Genome } from './genome';
import { genomeFromJson } from './serialize';
import { parseFlame, type ImportReport } from './flame-import';

export type LoadKind = 'pyr3-json' | 'flame';

export interface LoadResult {
  kind: LoadKind;
  genome: Genome;
  report?: ImportReport;
  /**
   * The raw file text. The Share-link path (main.ts onShareLink) encodes
   * this directly into `?flame=v1:<gzip+base64>` so the round-trip
   * preserves the original XML byte-for-byte.
   */
  sourceText: string;
}

export function sniffKind(filename: string, content: string): LoadKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.flame') || lower.endsWith('.flam3')) return 'flame';
  if (lower.endsWith('.json')) return 'pyr3-json';
  // Content sniff fallback for unknown suffixes.
  if (content.trimStart().startsWith('<')) return 'flame';
  return 'pyr3-json';
}

export async function load(file: File): Promise<LoadResult> {
  const text = await file.text();
  const kind = sniffKind(file.name, text);
  if (kind === 'flame') {
    const { genome, report } = parseFlame(text);
    return { kind, genome, report, sourceText: text };
  }
  const parsed: unknown = JSON.parse(text);
  const genome = genomeFromJson(parsed);
  return { kind: 'pyr3-json', genome, sourceText: text };
}
