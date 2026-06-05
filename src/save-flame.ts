// #103 Phase 3 Task 3.3: download the current genome as a .pyr3.json file.
//
// Sibling of save-image.ts (PNG render save). The viewer's 🧬 Save Flame
// button hands a filename hint down through `onSaveFlame`; main.ts looks up
// the current genome via `getCurrentFlame()` and calls `saveFlame()` here,
// which serializes the genome through the canonical `genomeToJson` codec and
// triggers an anchor-download. Keeping this module decoupled from the bar +
// from the editor's file-ops makes the codec the single source of truth for
// `.pyr3.json` produced anywhere in the app.

import type { Genome } from './genome';
import { genomeToJson } from './serialize';

/** Compose the download filename for a flame export. Mirrors
 *  composeSaveFilename in save-image.ts: sanitizes the flame name to a
 *  filesystem-safe subset and falls back to `pyr3-flame` for empty input. */
export function composeFlameFilename(flameName: string | null | undefined): string {
  const raw = (flameName ?? '').trim();
  const base = (raw === '' ? 'pyr3-flame' : raw).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${base}.pyr3.json`;
}

/** Trigger a `.pyr3.json` download for the given genome. The filename is the
 *  caller-supplied hint (compose via composeFlameFilename for a sanitized
 *  flame-name default). Uses the canonical genomeToJson codec so the saved
 *  file round-trips through the existing flame-import path. */
export function saveFlame(genome: Genome, filename?: string): void {
  const json = JSON.stringify(genomeToJson(genome), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? composeFlameFilename(genome.name);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
