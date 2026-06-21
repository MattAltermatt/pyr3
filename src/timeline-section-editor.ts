// src/timeline-section-editor.ts
// #227d — the timeline authoring inspector. Mounts under the section track and
// shows the editor for the current selection (a section's evolve+linger, or a
// node's pause + remove). createElement only (no innerHTML).

import { type Timeline } from './timeline';
import { type Linger, easingToLinger } from './timeline-edit';
import { mountXformPairing, type XformPairingHandle } from './timeline-xform-pairing';

export interface SectionEditorOpts {
  onEvolveChange: (sectionIndex: number, seconds: number) => void;
  onLingerChange: (sectionIndex: number, linger: Linger) => void;
  onPauseChange: (nodeIndex: number, seconds: number) => void;
  onRemoveNode: (nodeIndex: number) => void;
  onPermutationChange: (sectionIndex: number, perm: number[] | undefined) => void;
  /** #286 — reorder by swap: move key flame `nodeIndex` one slot in `dir` (-1/+1),
   *  swapping flame content with the neighbour (per-slot timing stays put). */
  onMoveNode: (nodeIndex: number, dir: -1 | 1) => void;
  /** #286 — replace key flame `nodeIndex` in place with a newly-picked flame,
   *  keeping the slot's cadence (the "swap key flame" button). */
  onReplaceNode: (nodeIndex: number) => void;
}

export interface SectionEditorHandle {
  showSection(timeline: Timeline, index: number): void;
  showNode(timeline: Timeline, index: number): void;
  clear(): void;
  destroy(): void;
}

const LINGERS: Linger[] = ['none', 'gentle', 'strong'];

function numberField(value: number, onCommit: (n: number) => void): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = '0';
  inp.step = '0.1';
  inp.value = String(value);
  Object.assign(inp.style, {
    width: '64px', background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)', color: 'var(--text, #ddd)',
    padding: '3px 7px', borderRadius: '4px', fontFamily: 'inherit', fontSize: '12px',
  });
  const commit = (): void => {
    const n = Number(inp.value);
    if (Number.isFinite(n) && n >= 0) onCommit(n);
  };
  inp.addEventListener('change', commit);
  return inp;
}

function row(labelText: string, title?: string): { row: HTMLDivElement; add: (el: HTMLElement | Text) => void } {
  const r = document.createElement('div');
  Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '7px 0', fontSize: '12px', color: 'var(--text-muted, #aaa)' });
  const lab = document.createElement('label');
  lab.textContent = labelText;
  if (title) lab.title = title; // #276 — hover affordance for bare controls
  Object.assign(lab.style, { width: '92px', color: 'var(--text-dim, #888)', cursor: title ? 'help' : 'default' });
  r.appendChild(lab);
  return { row: r, add: (el) => r.appendChild(el) };
}

export function mountSectionEditor(host: HTMLElement, opts: SectionEditorOpts): SectionEditorHandle {
  const root = document.createElement('div');
  Object.assign(root.style, {
    margin: '6px 16px 10px', padding: '12px 14px', background: 'var(--bar-bg-2, #1a1a20)',
    border: '1px solid var(--bar-border, #2a2a30)', borderRadius: '6px',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    display: 'none',
  });
  host.appendChild(root);

  // #282 — the pairing widget owns drag listeners; destroy it on every reselect.
  let pairingHandle: XformPairingHandle | undefined;
  function clearPairing(): void { pairingHandle?.destroy(); pairingHandle = undefined; }

  function header(text: string): HTMLDivElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, { color: '#ff8c1a', marginBottom: '10px', fontSize: '12px' });
    return h;
  }

  function showSection(timeline: Timeline, index: number): void {
    clearPairing();
    root.replaceChildren();
    root.style.display = 'block';
    root.appendChild(header(`▸ Evolve section: flame ${index + 1} → flame ${index + 2}`));

    // #283 — 2-column: evolve + linger (left) | xform pairing (right).
    const split = document.createElement('div');
    split.setAttribute('data-section-2col', '1');
    Object.assign(split.style, { display: 'flex', gap: '26px', alignItems: 'flex-start' });
    const colL = document.createElement('div');
    Object.assign(colL.style, { flex: '0 0 auto', minWidth: '300px' });
    const colR = document.createElement('div');
    // Divider via longhand props: jsdom drops var() inside the `border-left`
  // shorthand, so width/style are set separately (always parse) and only the
  // colour rides the token (resolves in real browsers).
  Object.assign(colR.style, {
    flex: '1 1 auto', borderLeftWidth: '1px', borderLeftStyle: 'solid',
    borderLeftColor: 'var(--bar-border, #2a2a30)', paddingLeft: '22px',
  });
    split.append(colL, colR);
    root.appendChild(split);

    const evolveRow = row('evolve time', 'Seconds to morph from this flame into the next.');
    const evolve = timeline.clips[index]!.transitionDuration;
    evolveRow.add(numberField(evolve, (n) => opts.onEvolveChange(index, n)));
    const unit = document.createElement('span'); unit.textContent = 's'; unit.style.color = 'var(--text-dim, #888)';
    evolveRow.add(unit);
    colL.appendChild(evolveRow.row);

    const lingerRow = row(
      'linger',
      'Linger eases the morph so it dwells near each key flame:\n'
      + '• none — constant speed\n• gentle — soft ease-in/out\n• strong — long hold at each end',
    );
    const current = easingToLinger(timeline.clips[index]!.easing);
    const LINGER_TIP: Record<Linger, string> = {
      none: 'Constant-speed morph — even pacing across the whole transition.',
      gentle: 'Soft ease-in/out — slows near each key flame, smooth and subtle.',
      strong: 'Long hold at each end — dwells on each flame before/after the morph.',
      custom: 'Custom easing curve set via the easing panel.',
    };
    for (const l of LINGERS) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.textContent = l;
      pill.title = LINGER_TIP[l]; // #276 — per-pill hover info
      const on = current === l;
      Object.assign(pill.style, {
        background: on ? 'var(--accent-soft, rgba(255,140,26,0.18))' : 'var(--bar-bg-2, #1a1a20)',
        border: `1px solid ${on ? 'var(--accent-border, #884a1a)' : 'var(--bar-border, #2a2a30)'}`,
        color: on ? 'var(--accent, #ff8c1a)' : 'var(--text-muted, #aaa)', borderRadius: '13px', padding: '3px 12px',
        fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit',
      });
      pill.addEventListener('click', () => opts.onLingerChange(index, l));
      lingerRow.add(pill);
    }
    if (current === 'custom') {
      const c = document.createElement('span');
      c.textContent = 'custom'; c.style.color = 'var(--accent, #ff8c1a)'; c.style.fontSize = '11px';
      lingerRow.add(c);
    }
    colL.appendChild(lingerRow.row);

    pairingHandle = mountXformPairing(colR, {
      flameA: timeline.clips[index]!.flame.genome,
      flameB: timeline.clips[index + 1]!.flame.genome,
      permutation: timeline.clips[index]!.permutation,
      onChange: (perm) => opts.onPermutationChange(index, perm),
    });
  }

  function showNode(timeline: Timeline, index: number): void {
    clearPairing();
    root.replaceChildren();
    root.style.display = 'block';
    root.appendChild(header(`▸ Key flame ${index + 1}`));

    // #280 — every node's hold is just a "pause" (the terminal's old "end hold"
    // special-case is gone): a pause is remembered and inherited as flames are
    // added, so it reads identically whether or not the flame evolves onward.
    const pauseRow = row('pause');
    const c = timeline.clips[index]!;
    const pause = Math.max(0, c.duration - c.transitionDuration);
    pauseRow.add(numberField(pause, (n) => opts.onPauseChange(index, n)));
    const unit = document.createElement('span');
    unit.textContent = 's (hold before evolving)';
    unit.style.color = 'var(--text-dim, #888)';
    pauseRow.add(unit);
    root.appendChild(pauseRow.row);

    // #286 — reorder by swap. ◀/▶ exchange this flame with its neighbour; the
    // per-slot cadence stays pinned (the rhythm holds, only the flame moves).
    const n = timeline.clips.length;
    const moveRow = row('reorder', 'Swap this key flame with a neighbour — the slot timing stays put, only the flame moves.');
    const moveBtn = (txt: string, title: string, dir: -1 | 1, disabled: boolean): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.title = title;
      b.disabled = disabled;
      Object.assign(b.style, {
        background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)', color: disabled ? 'var(--text-dim, #888)' : 'var(--text, #ddd)',
        padding: '3px 12px', borderRadius: '5px', fontSize: '12px',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? '0.5' : '1', fontFamily: 'inherit',
      });
      if (!disabled) b.addEventListener('click', () => opts.onMoveNode(index, dir));
      return b;
    };
    moveRow.add(moveBtn('◀ earlier', 'Move this key flame one slot earlier.', -1, index === 0));
    moveRow.add(moveBtn('later ▶', 'Move this key flame one slot later.', 1, index === n - 1));
    root.appendChild(moveRow.row);

    const actions = row('');
    // #286 — swap (replace) this flame with a freshly-picked one, keeping the
    // slot's cadence. Distinct from the ◀/▶ reorder above.
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.textContent = '🔄 swap key flame';
    swap.title = 'Replace this key flame with a different one — the slot timing stays put.';
    Object.assign(swap.style, {
      background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)', color: 'var(--text, #ddd)',
      padding: '3px 10px', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
    });
    swap.addEventListener('click', () => opts.onReplaceNode(index));
    actions.add(swap);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '🗑 remove key flame';
    Object.assign(remove.style, {
      background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)', color: 'var(--text-muted, #aaa)',
      padding: '3px 10px', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
    });
    remove.addEventListener('click', () => opts.onRemoveNode(index));
    actions.add(remove);
    root.appendChild(actions.row);
  }

  return {
    showSection,
    showNode,
    clear(): void { clearPairing(); root.replaceChildren(); root.style.display = 'none'; },
    destroy(): void { clearPairing(); root.remove(); },
  };
}
