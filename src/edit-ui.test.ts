// @vitest-environment happy-dom
//
// pyr3 — /v1/edit shell. Focused coverage for the SETTLE control in the
// panel topbar (#367 moved the ladder here, next to the `settle` scrubby).

import { describe, expect, it, vi } from 'vitest';
import { mountEditUi } from './edit-ui';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mount(over: Partial<Parameters<typeof mountEditUi>[3]> = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host')!;
  const state = createEditState(generateRandomGenome(seededRng(1)), 1);
  const handle = mountEditUi(host, state, [], {
    onChange: vi.fn(),
    settleDelayMs: 500,
    ...over,
  });
  return { host, handle };
}

describe('edit-ui SETTLE control (#367)', () => {
  it('renders the SETTLE ladder (200/500/1000/2000) in the panel topbar', () => {
    const { host } = mount();
    const ladder = host.querySelector('.pyr3-edit-settle-ladder') as HTMLElement;
    expect(ladder).not.toBeNull();
    const labels = [...ladder.querySelectorAll('.pyr3-bar-settle-btn')].map((b) => b.textContent);
    expect(labels).toEqual(['200', '500', '1000', '2000']);
    // it lives in the same row as the `settle` scrubby
    expect(ladder.closest('.pyr3-edit-named')?.querySelector('.pyr3-edit-settle-input')).not.toBeNull();
  });

  it('highlights the ladder button matching the initial settle value', () => {
    const { host } = mount({ settleDelayMs: 1000 });
    const active = [...host.querySelectorAll('.pyr3-bar-settle-btn.on')];
    expect(active).toHaveLength(1);
    expect(active[0]!.textContent).toBe('1000');
  });

  it('clicking a ladder button fires onSettleDelayChange and re-highlights', () => {
    const onSettleDelayChange = vi.fn();
    const { host } = mount({ settleDelayMs: 500, onSettleDelayChange });
    const btn = [...host.querySelectorAll('.pyr3-bar-settle-btn')]
      .find((b) => b.textContent === '2000') as HTMLButtonElement;
    btn.click();
    expect(onSettleDelayChange).toHaveBeenCalledWith(2000);
    const active = [...host.querySelectorAll('.pyr3-bar-settle-btn.on')];
    expect(active.map((b) => b.textContent)).toEqual(['2000']);
  });

  it('setSettleDelayMs(off-ladder) leaves no ladder button highlighted', () => {
    const { host, handle } = mount({ settleDelayMs: 500 });
    handle.setSettleDelayMs(750);
    expect(host.querySelectorAll('.pyr3-bar-settle-btn.on')).toHaveLength(0);
  });
});
