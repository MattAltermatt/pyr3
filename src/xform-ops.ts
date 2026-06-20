// pyr3 — pure genome operations on the xform list (#350 / #335).
//
// DOM-free, fully unit-tested. The XForm-lens UI (edit-section-xforms.ts) calls
// these and routes the result through onChange so history/persist/render fire.
//
// xaos convention (genome.ts:49): `xforms[i].xaos[j]` is the i→j transition
// multiplier (a per-source weight on xforms[j].weight). So any structural edit
// that changes xform indices must keep every xaos row's COLUMNS in step.

import { type Genome, type Xform } from './genome';
import { V } from './variations';

/** A fresh identity-affine, single-linear-variation xform. (Pure home for the
 *  factory the editor's `+ add` used to keep locally in edit-section-xforms.ts.) */
export function makeDefaultXform(): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1,
    color: 0.5,
    colorSpeed: 0.5,
    opacity: 1,
    variations: [{ index: V.linear, weight: 1 }],
  };
}

/** Append a fresh xform. Returns its index (the caller selects it). */
export function addXform(genome: Genome): number {
  genome.xforms.push(makeDefaultXform());
  return genome.xforms.length - 1;
}

/** Remove the xform at `index` unless it is the last remaining one. Drops the
 *  matching xaos COLUMN from every surviving xform. Returns the clamped
 *  selection index. */
export function removeXform(genome: Genome, index: number): number {
  if (genome.xforms.length <= 1) return Math.min(index, genome.xforms.length - 1);
  genome.xforms.splice(index, 1);
  for (const xf of genome.xforms) {
    if (xf.xaos && index < xf.xaos.length) xf.xaos.splice(index, 1);
  }
  return Math.max(0, Math.min(index, genome.xforms.length - 1));
}

/** Insert a deep copy of the xform at `index` right after it; widen every xaos
 *  row by duplicating the source's column so the matrix stays square. Returns
 *  the copy's index. */
export function duplicateXform(genome: Genome, index: number): number {
  const copy: Xform = structuredClone(genome.xforms[index]!);
  genome.xforms.splice(index + 1, 0, copy);
  for (const xf of genome.xforms) {
    if (xf.xaos) xf.xaos.splice(index + 1, 0, xf.xaos[index] ?? 1);
  }
  return index + 1;
}

/** Swap xforms `i` and `j` AND permute xaos so the transition relation is
 *  unchanged (reorder is cosmetic, not semantic — #335):
 *    (1) swap the array entries (their xaos ROWS travel with them), then
 *    (2) swap the COLUMN entries [i]<->[j] inside every xform's xaos row. */
export function swapXforms(genome: Genome, i: number, j: number): void {
  if (i === j) return;
  const xs = genome.xforms;
  const tmp = xs[i]!;
  xs[i] = xs[j]!;
  xs[j] = tmp;
  for (const xf of xs) {
    const x = xf.xaos;
    if (x && i < x.length && j < x.length) {
      const t = x[i]!;
      x[i] = x[j]!;
      x[j] = t;
    }
  }
}
