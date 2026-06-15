// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountSectionEditor } from './timeline-section-editor';
import { appendFlame, createTimeline } from './timeline-edit';
import type { Genome, Xform } from './genome';

// A genome with two xforms so the pairing widget renders rows.
const xf = (): Xform => ({ weight: 1, variations: [{ index: 0, weight: 1 }] } as Xform);
const genome = (): Genome => ({ xforms: [xf(), xf()] } as Genome);

const NOOP = {
  onEvolveChange() {}, onLingerChange() {}, onPauseChange() {},
  onRemoveNode() {}, onPermutationChange() {}, onMoveNode() {}, onReplaceNode() {},
};

function host(): HTMLElement {
  const h = document.createElement('div');
  document.body.appendChild(h);
  return h;
}

beforeEach(() => { document.body.replaceChildren(); });

describe('showSection — 2-column layout (#283)', () => {
  it('splits into a left column (evolve+linger) and a right column (xform pairing)', () => {
    const tl = appendFlame(appendFlame(createTimeline(), genome()), genome());
    const h = host();
    const ed = mountSectionEditor(h, NOOP);
    ed.showSection(tl, 0);

    const root = h.firstElementChild as HTMLElement; // editor root
    // The 2-column split carries a distinctive marker.
    const split = root.querySelector('[data-section-2col]') as HTMLElement | null;
    expect(split).toBeTruthy();
    expect(split!.children.length).toBe(2);

    const cols = Array.from(split!.children) as HTMLElement[];
    const colL = cols[0]!;
    const colR = cols[1]!;
    // Left column carries the evolve number input.
    expect(colL.querySelector('input[type=number]')).toBeTruthy();
    // Right column carries the xform pairing widget (its title text is distinctive).
    expect(colR.textContent).toContain('xform pairing');
    // Divider lives on the right column.
    expect(colR.style.borderLeft).not.toBe('');
  });
});

describe('showNode — stays single column', () => {
  it('renders a number input and no flex split', () => {
    const tl = appendFlame(appendFlame(createTimeline(), genome()), genome());
    const h = host();
    const ed = mountSectionEditor(h, NOOP);
    ed.showNode(tl, 0);
    const root = h.firstElementChild as HTMLElement;
    expect(root.querySelector('[data-section-2col]')).toBeFalsy();
    expect(root.querySelector('input[type=number]')).toBeTruthy();
  });
});
