// src/timeline-section-editor.ts
// #227d — the timeline authoring inspector. Mounts under the section track and
// shows the editor for the current selection (a section's evolve+linger, or a
// node's pause + remove). createElement only (no innerHTML).

import { type Timeline } from './timeline';
import { type Linger, easingToLinger } from './timeline-edit';

export interface SectionEditorOpts {
  onEvolveChange: (sectionIndex: number, seconds: number) => void;
  onLingerChange: (sectionIndex: number, linger: Linger) => void;
  onPauseChange: (nodeIndex: number, seconds: number) => void;
  onRemoveNode: (nodeIndex: number) => void;
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
    width: '64px', background: '#0c0c0e', border: '1px solid #3a3a44', color: '#ddd',
    padding: '2px 6px', borderRadius: '3px', fontFamily: 'ui-monospace,monospace', fontSize: '12px',
  });
  const commit = (): void => {
    const n = Number(inp.value);
    if (Number.isFinite(n) && n >= 0) onCommit(n);
  };
  inp.addEventListener('change', commit);
  return inp;
}

function row(labelText: string): { row: HTMLDivElement; add: (el: HTMLElement | Text) => void } {
  const r = document.createElement('div');
  Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '7px 0', fontSize: '12px', color: '#bbb' });
  const lab = document.createElement('label');
  lab.textContent = labelText;
  Object.assign(lab.style, { width: '92px', color: '#888' });
  r.appendChild(lab);
  return { row: r, add: (el) => r.appendChild(el) };
}

export function mountSectionEditor(host: HTMLElement, opts: SectionEditorOpts): SectionEditorHandle {
  const root = document.createElement('div');
  Object.assign(root.style, {
    margin: '6px 16px 10px', padding: '12px 14px', background: '#121218',
    border: '1px solid #2a2a2a', borderRadius: '6px', fontFamily: 'ui-monospace,monospace',
    display: 'none',
  });
  host.appendChild(root);

  function header(text: string): HTMLDivElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, { color: '#ff8c1a', marginBottom: '10px', fontSize: '12px' });
    return h;
  }

  function disabledTeaser(text: string): HTMLDivElement {
    const { row: r, add } = row('');
    const span = document.createElement('span');
    span.textContent = text;
    Object.assign(span.style, {
      opacity: '0.45', border: '1px dashed #3a3a44', borderRadius: '13px',
      padding: '3px 10px', fontSize: '11px', color: '#cdd',
    });
    add(span);
    return r;
  }

  function showSection(timeline: Timeline, index: number): void {
    root.replaceChildren();
    root.style.display = 'block';
    root.appendChild(header(`▸ Evolve section: flame ${index + 1} → flame ${index + 2}`));

    const evolveRow = row('evolve time');
    const evolve = timeline.clips[index]!.transitionDuration;
    evolveRow.add(numberField(evolve, (n) => opts.onEvolveChange(index, n)));
    const unit = document.createElement('span'); unit.textContent = 's'; unit.style.color = '#888';
    evolveRow.add(unit);
    root.appendChild(evolveRow.row);

    const lingerRow = row('linger');
    const current = easingToLinger(timeline.clips[index]!.easing);
    for (const l of LINGERS) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.textContent = l;
      const on = current === l;
      Object.assign(pill.style, {
        background: '#181820', border: `1px solid ${on ? '#9cd' : '#3a3a44'}`,
        color: on ? '#cfe9f3' : '#cdd', borderRadius: '13px', padding: '3px 12px',
        fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit',
      });
      pill.addEventListener('click', () => opts.onLingerChange(index, l));
      lingerRow.add(pill);
    }
    if (current === 'custom') {
      const c = document.createElement('span');
      c.textContent = 'custom'; c.style.color = '#9cd'; c.style.fontSize = '11px';
      lingerRow.add(c);
    }
    root.appendChild(lingerRow.row);

    root.appendChild(disabledTeaser('edit xform pairing… (#227e, later)'));
  }

  function showNode(timeline: Timeline, index: number): void {
    root.replaceChildren();
    root.style.display = 'block';
    root.appendChild(header(`▸ Key flame ${index + 1}`));

    const isLast = index === timeline.clips.length - 1;
    const pauseRow = row(isLast ? 'end hold' : 'pause');
    const c = timeline.clips[index]!;
    const pause = Math.max(0, c.duration - c.transitionDuration);
    pauseRow.add(numberField(pause, (n) => opts.onPauseChange(index, n)));
    const unit = document.createElement('span');
    // The terminal flame has nothing to evolve into — its pause is a static
    // freeze at the END of the animation (the "why is it stuck?" case).
    unit.textContent = isLast
      ? 's · freezes on this final flame at the end'
      : 's (hold before evolving)';
    unit.style.color = '#888';
    pauseRow.add(unit);
    root.appendChild(pauseRow.row);

    const actions = row('');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '🗑 remove key flame';
    Object.assign(remove.style, {
      background: '#0c0c0e', border: '1px solid #a55', color: '#e9bcbc',
      padding: '3px 10px', borderRadius: '3px', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
    });
    remove.addEventListener('click', () => opts.onRemoveNode(index));
    actions.add(remove);
    root.appendChild(actions.row);
  }

  return {
    showSection,
    showNode,
    clear(): void { root.replaceChildren(); root.style.display = 'none'; },
    destroy(): void { root.remove(); },
  };
}
