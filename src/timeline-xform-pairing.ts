// #282 — xform pairing UI for the /v1/animate section editor. Authors
// Clip.permutation (#225 wired the data + render path; this is UI only).
//
// "order" is the array the user manipulates by dragging the flame-B column.
// order[i] = the flame-B xform index paired with flame-A's row i — identical to
// the `perm` consumed at interpolate.ts:103 (perm.map(j => alignedB.xforms[j])).

import { type Genome, type Xform } from './genome';
import { VARIATION_NAMES } from './variations';

/** `#<1-based> · name, name` — text label, no render (brainstorm decision). */
export function xformLabel(xform: Xform, rowIndex: number): string {
  const names = xform.variations.map((v) => VARIATION_NAMES[v.index] ?? `var${v.index}`);
  return `#${rowIndex + 1} · ${names.length ? names.join(', ') : 'linear'}`;
}

/** Aligned (padded) length = max of the two real xform counts. finalxform is a
 *  separate Genome field, already excluded from xforms[]. */
export function alignedCount(a: Genome, b: Genome): number {
  return Math.max(a.xforms.length, b.xforms.length);
}

/** True iff `p` is a bijection over [0, n). Mirrors interpolate.ts isPermutation. */
function isBijection(p: number[], n: number): boolean {
  if (p.length !== n) return false;
  const seen = new Array<boolean>(n).fill(false);
  for (const v of p) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

/** Current row order over the aligned length. Invalid/absent perm ⇒ identity. */
export function toOrder(perm: number[] | undefined, n: number): number[] {
  if (perm && isBijection(perm, n)) return [...perm];
  return Array.from({ length: n }, (_, i) => i);
}

/** Swap two row positions (drag drop / arrow). The two xforms trade places; the
 *  rest of the list is untouched (NOT an insert-and-shift). No-op if i === j or
 *  either index is out of range. */
export function swap(order: number[], i: number, j: number): number[] {
  if (i === j || i < 0 || j < 0 || i >= order.length || j >= order.length) return [...order];
  const out = [...order];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** Swap a row with its neighbour (dir -1 up, +1 down). Clamped no-op at ends. */
export function nudge(order: number[], row: number, dir: -1 | 1): number[] {
  return swap(order, row, row + dir);
}

/** Identity order ⇒ undefined (clears the field); else the order is the perm. */
export function toPermutation(order: number[]): number[] | undefined {
  return order.every((v, i) => v === i) ? undefined : [...order];
}

// ── DOM widget ──────────────────────────────────────────────────────────────

export interface XformPairingOpts {
  flameA: Genome;            // clips[i] keyframe (fixed reference column)
  flameB: Genome;            // clips[i+1] keyframe (reorderable column)
  permutation?: number[];    // current clip.permutation (absent ⇒ identity)
  onChange: (perm: number[] | undefined) => void; // undefined ⇒ reset to positional
}
export interface XformPairingHandle { destroy(): void; }

/** Flame-A row label — real xform or a greyed identity-pad (fades out). */
function aRowLabel(a: Genome, rowIndex: number): { text: string; padded: boolean } {
  return rowIndex < a.xforms.length
    ? { text: xformLabel(a.xforms[rowIndex]!, rowIndex), padded: false }
    : { text: '(identity · fades out)', padded: true };
}
/** Flame-B row label — real xform or a greyed identity-pad (fades in). */
function bRowLabel(b: Genome, bIndex: number): { text: string; padded: boolean } {
  return bIndex < b.xforms.length
    ? { text: xformLabel(b.xforms[bIndex]!, bIndex), padded: false }
    : { text: '(identity · fades in)', padded: true };
}

/** Mount the drag-reorder pairing widget. createElement only (no-innerHTML
 *  invariant). The flame-B column is draggable / ↑↓-nudgeable; row i of B pairs
 *  with flame-A's row i, so order[i] = perm[i]. */
export function mountXformPairing(host: HTMLElement, opts: XformPairingOpts): XformPairingHandle {
  const n = alignedCount(opts.flameA, opts.flameB);
  let order = toOrder(opts.permutation, n);
  let dragFrom = -1;

  const root = document.createElement('div');
  Object.assign(root.style, { marginTop: '8px', fontSize: '11px' });

  const title = document.createElement('div');
  title.textContent = 'xform pairing — drag flame 2 rows (or ↑↓) to choose which morphs into which';
  Object.assign(title.style, { color: '#888', marginBottom: '6px' });
  root.appendChild(title);

  const list = document.createElement('div');
  root.appendChild(list);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '↺ reset to positional';
  Object.assign(resetBtn.style, {
    marginTop: '8px', background: '#0c0c0e', border: '1px solid #3a3a44',
    color: '#cdd', borderRadius: '3px', padding: '3px 10px', fontSize: '11px',
    cursor: 'pointer', fontFamily: 'inherit',
  });
  resetBtn.addEventListener('click', () => { order = toOrder(undefined, n); commit(); });
  root.appendChild(resetBtn);

  function commit(): void {
    render();
    opts.onChange(toPermutation(order));
  }

  function arrowButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      background: 'transparent', border: '1px solid #3a3a44', color: '#cdd',
      borderRadius: '3px', padding: '0 6px', fontSize: '11px', cursor: 'pointer',
      fontFamily: 'inherit', lineHeight: '18px',
    });
    b.addEventListener('click', onClick);
    return b;
  }

  function render(): void {
    list.replaceChildren();
    for (let row = 0; row < n; row++) {
      const bIndex = order[row]!;
      const r = document.createElement('div');
      Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' });

      const a = aRowLabel(opts.flameA, row);
      const aSpan = document.createElement('span');
      aSpan.textContent = a.text;
      Object.assign(aSpan.style, { width: '150px', color: a.padded ? '#666' : '#bbb' });
      r.appendChild(aSpan);

      const arrow = document.createElement('span');
      arrow.textContent = '↔'; arrow.style.color = '#666';
      r.appendChild(arrow);

      const b = bRowLabel(opts.flameB, bIndex);
      const bRow = document.createElement('div');
      bRow.draggable = true;
      Object.assign(bRow.style, {
        display: 'flex', alignItems: 'center', gap: '6px', flex: '1',
        border: '1px solid #2a2a2a', borderRadius: '3px', padding: '2px 6px',
        background: '#0c0c0e', cursor: 'grab',
      });
      const handle = document.createElement('span');
      handle.textContent = '⠿'; handle.style.color = '#555';
      bRow.appendChild(handle);
      const bSpan = document.createElement('span');
      bSpan.textContent = b.text;
      Object.assign(bSpan.style, { flex: '1', color: b.padded ? '#666' : '#cdd' });
      bRow.appendChild(bSpan);
      bRow.appendChild(arrowButton('↑', () => { order = nudge(order, row, -1); commit(); }));
      bRow.appendChild(arrowButton('↓', () => { order = nudge(order, row, 1); commit(); }));

      bRow.addEventListener('dragstart', () => { dragFrom = row; });
      bRow.addEventListener('dragover', (e) => e.preventDefault());
      bRow.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom >= 0 && dragFrom !== row) { order = swap(order, dragFrom, row); commit(); }
        dragFrom = -1;
      });

      r.appendChild(bRow);
      list.appendChild(r);
    }
  }

  render();
  host.appendChild(root);
  return { destroy(): void { root.remove(); } };
}
