// @vitest-environment happy-dom
//
// Unit smoke for the editor UI shell. The mountEditPage WebGPU path can't
// run under happy-dom (no GPUDevice), so we cover the DOM-shell behaviour
// via mountEditUi directly.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mountEditUi, type SectionMount } from './edit-ui';
import {
  createEditState,
  SECTION_COLLAPSE_KEY,
  type SectionKey,
} from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { scalePreviewGenome } from './edit-mount';

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// globally under vitest. See src/prefs.test.ts for the canonical pattern.
function makeStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

// #103 Phase 6 Task 6.5 — cold-start hydration. mountEditPage itself needs a
// GPUDevice (can't instantiate under happy-dom), so the cold-start logic
// extracts into pure helpers (resolveColdStartGenome / resolveColdStartCollapse
// in edit-state.ts) that we exercise directly here.
import {
  resolveColdStartGenome,
  resolveColdStartGenomeWithSource,
  resolveColdStartCollapse,
  persistColdStartIfReroll,
  restoreWip,
  WIP_KEY,
  PENDING_TRANSFER_KEY,
  PENDING_TRANSFER_TTL_MS,
  writePendingTransfer,
  consumePendingTransfer,
} from './edit-state';

describe('resolveColdStartGenome (Task 6.5)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the persisted WIP genome when localStorage has a valid entry', () => {
    const saved = generateRandomGenome(seededRng(7));
    saved.name = 'restored-from-wip';
    localStorage.setItem(WIP_KEY, JSON.stringify(saved));
    const reroll = vi.fn(() => generateRandomGenome(seededRng(99)));
    const got = resolveColdStartGenome(reroll);
    expect(got.name).toBe('restored-from-wip');
    expect(reroll).not.toHaveBeenCalled();
  });

  it('falls back to the random-reroll fn when localStorage is empty', () => {
    const fresh = generateRandomGenome(seededRng(99));
    fresh.name = 'fresh-reroll';
    const reroll = vi.fn(() => fresh);
    const got = resolveColdStartGenome(reroll);
    expect(got.name).toBe('fresh-reroll');
    expect(reroll).toHaveBeenCalledTimes(1);
  });

  it('falls back to the random-reroll fn when localStorage holds malformed JSON', () => {
    localStorage.setItem(WIP_KEY, '{not json');
    const fresh = generateRandomGenome(seededRng(99));
    fresh.name = 'after-malformed';
    const reroll = vi.fn(() => fresh);
    const got = resolveColdStartGenome(reroll);
    expect(got.name).toBe('after-malformed');
    expect(reroll).toHaveBeenCalledTimes(1);
  });

  // 2026-06-05 — the source-tagged variant lets the editor mount decide
  // whether to stamp the user's defaultNick (only on the reroll path).
  it('resolveColdStartGenomeWithSource tags pending transfers, WIP, and reroll distinctly', () => {
    // 1. pending wins over WIP + reroll
    const pendingGenome = generateRandomGenome(seededRng(1));
    pendingGenome.name = 'pending';
    writePendingTransfer({ genome: pendingGenome, corpusId: null, timestamp: Date.now() });
    const wipGenome = generateRandomGenome(seededRng(2));
    wipGenome.name = 'wip';
    localStorage.setItem(WIP_KEY, JSON.stringify(wipGenome));
    let result = resolveColdStartGenomeWithSource(() => generateRandomGenome(seededRng(99)));
    expect(result.source).toBe('pending');
    expect(result.genome.name).toBe('pending');

    // 2. With pending consumed, WIP wins over reroll
    result = resolveColdStartGenomeWithSource(() => generateRandomGenome(seededRng(99)));
    expect(result.source).toBe('wip');
    expect(result.genome.name).toBe('wip');

    // 3. With WIP cleared, reroll fires
    localStorage.removeItem(WIP_KEY);
    const fresh = generateRandomGenome(seededRng(99));
    fresh.name = 'fresh-reroll';
    result = resolveColdStartGenomeWithSource(() => fresh);
    expect(result.source).toBe('reroll');
    expect(result.genome.name).toBe('fresh-reroll');
  });
});

// #344 — a fresh-visit reroll must persist to WIP so a reload restores the SAME
// flame instead of re-rerolling. The bug was that mountEditPage's cold-start
// resolved a reroll but never wrote it, so restoreWip() stayed null forever.
describe('persistColdStartIfReroll (#344 reroll persistence)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists on the reroll path so the next cold-start restores it (not a new reroll)', () => {
    // First visit: no WIP, no pending → reroll.
    const first = generateRandomGenome(seededRng(1));
    first.name = 'reroll-1';
    const r1 = resolveColdStartGenomeWithSource(() => first);
    expect(r1.source).toBe('reroll');
    // POLICY under test — the mount persists the reroll.
    persistColdStartIfReroll(r1.source, r1.genome);

    // Reload: a *different* reroll fn would fire if persistence failed.
    const r2 = resolveColdStartGenomeWithSource(() => {
      const g = generateRandomGenome(seededRng(2));
      g.name = 'reroll-2';
      return g;
    });
    expect(r2.source).toBe('wip');
    expect(r2.genome.name).toBe('reroll-1');
  });

  it('does NOT persist on the wip or pending source (no double-write / clobber)', () => {
    const g = generateRandomGenome(seededRng(3));
    persistColdStartIfReroll('wip', g);
    expect(restoreWip()).toBeNull();
    persistColdStartIfReroll('pending', g);
    expect(restoreWip()).toBeNull();
  });
});

// #352 — the live preview must scale every OUTPUT-PIXEL quantity (scale, spatial
// filter radius, AND the density-estimator radii) by the resolution ratio so a
// DE-heavy flame doesn't over-blur into "one color" at 384px and then snap crisp
// on settle. The DE `curve` is a dimensionless exponent and must stay fixed.
describe('scalePreviewGenome (#352 representative preview)', () => {
  it('scales scale, spatial-filter radius, and DE maxRad/minRad — but NOT curve', () => {
    const g = generateRandomGenome(seededRng(5));
    g.scale = 100;
    g.spatialFilter = { ...(g.spatialFilter ?? {}), radius: 2.0 } as typeof g.spatialFilter;
    g.density = { maxRad: 9, minRad: 3, curve: 0.4 };
    const ratio = 0.2; // 384 / 1920
    const out = scalePreviewGenome(g, ratio);
    expect(out.scale).toBeCloseTo(20, 6);
    expect(out.spatialFilter!.radius).toBeCloseTo(0.4, 6);
    expect(out.density!.maxRad).toBeCloseTo(1.8, 6);
    expect(out.density!.minRad).toBeCloseTo(0.6, 6);
    expect(out.density!.curve).toBe(0.4); // dimensionless — unchanged
  });

  it('does not mutate the input genome', () => {
    const g = generateRandomGenome(seededRng(6));
    g.scale = 50;
    g.density = { maxRad: 9, minRad: 0, curve: 0.5 };
    scalePreviewGenome(g, 0.5);
    expect(g.scale).toBe(50);
    expect(g.density!.maxRad).toBe(9);
  });

  it('is a no-op shape-wise when density / spatialFilter are absent', () => {
    const g = generateRandomGenome(seededRng(7));
    g.scale = 80;
    delete g.density;
    delete g.spatialFilter;
    const out = scalePreviewGenome(g, 0.25);
    expect(out.scale).toBeCloseTo(20, 6);
    expect(out.density).toBeUndefined();
    expect(out.spatialFilter).toBeUndefined();
  });
});

describe('viewer→editor pending-transfer (B3)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('write+consume round-trips the genome + corpusId payload', () => {
    const g = generateRandomGenome(seededRng(11));
    g.name = 'opened-from-file';
    writePendingTransfer({
      genome: g,
      corpusId: { gen: 248, id: 12345 },
      timestamp: Date.now(),
    });
    const consumed = consumePendingTransfer();
    expect(consumed).not.toBeNull();
    expect(consumed!.genome.name).toBe('opened-from-file');
    expect(consumed!.corpusId).toEqual({ gen: 248, id: 12345 });
  });

  it('consume deletes the slot (single-shot — refresh does NOT replay)', () => {
    const g = generateRandomGenome(seededRng(13));
    writePendingTransfer({ genome: g, corpusId: null, timestamp: Date.now() });
    expect(localStorage.getItem(PENDING_TRANSFER_KEY)).not.toBeNull();
    consumePendingTransfer();
    expect(localStorage.getItem(PENDING_TRANSFER_KEY)).toBeNull();
  });

  it('returns null when the stash is older than TTL', () => {
    const g = generateRandomGenome(seededRng(17));
    writePendingTransfer({
      genome: g,
      corpusId: null,
      timestamp: Date.now() - PENDING_TRANSFER_TTL_MS - 1000,
    });
    expect(consumePendingTransfer()).toBeNull();
  });

  it('returns null when the slot is empty', () => {
    expect(consumePendingTransfer()).toBeNull();
  });

  it('returns null and clears slot when JSON is malformed', () => {
    localStorage.setItem(PENDING_TRANSFER_KEY, '{not json');
    expect(consumePendingTransfer()).toBeNull();
    // Slot got removed even though it was malformed — so a refresh won't
    // keep returning null forever on the same corrupt blob.
    expect(localStorage.getItem(PENDING_TRANSFER_KEY)).toBeNull();
  });

  it('resolveColdStartGenome prefers a fresh pending-transfer over WIP', () => {
    const wip = generateRandomGenome(seededRng(21));
    wip.name = 'persisted-wip';
    localStorage.setItem(WIP_KEY, JSON.stringify(wip));
    const transferred = generateRandomGenome(seededRng(22));
    transferred.name = 'viewer-handoff';
    writePendingTransfer({ genome: transferred, corpusId: null, timestamp: Date.now() });
    const reroll = vi.fn(() => generateRandomGenome(seededRng(99)));
    const got = resolveColdStartGenome(reroll);
    expect(got.name).toBe('viewer-handoff');
    expect(reroll).not.toHaveBeenCalled();
    // And the slot is consumed — a second cold-start falls back to WIP.
    expect(resolveColdStartGenome(reroll).name).toBe('persisted-wip');
  });

  it('resolveColdStartGenome ignores a stale pending-transfer and falls through to WIP', () => {
    const wip = generateRandomGenome(seededRng(31));
    wip.name = 'persisted-wip';
    localStorage.setItem(WIP_KEY, JSON.stringify(wip));
    const stale = generateRandomGenome(seededRng(32));
    stale.name = 'stale-handoff';
    writePendingTransfer({
      genome: stale,
      corpusId: null,
      timestamp: Date.now() - PENDING_TRANSFER_TTL_MS - 100,
    });
    const reroll = vi.fn(() => generateRandomGenome(seededRng(99)));
    const got = resolveColdStartGenome(reroll);
    expect(got.name).toBe('persisted-wip');
    expect(reroll).not.toHaveBeenCalled();
  });
});

describe('resolveColdStartCollapse (Task 6.5)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the default all-EXPANDED map when nothing persisted (#27)', () => {
    const map = resolveColdStartCollapse();
    expect(map).toEqual({
      palette: false, curves: false, scopes: false, hsl: false, viewport: false, xforms: false,
      'global-symmetry': false, 'global-tonemap': false, density: false, render: false,
    });
  });

  it('returns the persisted map when present', () => {
    const stored = {
      palette: false, curves: true, scopes: true, hsl: true, viewport: true, xforms: false, final: true,
      'global-symmetry': false, 'global-tonemap': false, density: false, render: true,
    };
    localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(stored));
    expect(resolveColdStartCollapse()).toEqual(stored);
  });
});

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

function makeSections(keys: SectionKey[]): SectionMount[] {
  return keys.map((k) => ({
    key: k,
    lens: 'output' as const,
    title: k.toUpperCase(),
    build: () => {},
  }));
}

describe('mountEditUi shell', () => {
  // Legacy "header card" tests removed in the 2026-06-04 visual overhaul —
  // the open/save buttons, name/nick inputs, and reroll/render PNG buttons
  // now live in the top-bar's info+action rows (covered by ui-bar.test.ts),
  // not in the edit-ui panel header. The panel header now only carries the
  // settle-delay scrubby (a power-user knob not surfaced in the action row).

  it('renders 7 section headers when 7 sections are passed', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const all: SectionKey[] = ['palette', 'viewport', 'xforms', 'curves', 'global-symmetry', 'density', 'render'];
    mountEditUi(host, state, makeSections(all), { onChange: () => {} });
    expect(host.querySelectorAll('.pyr3-edit-section-header').length).toBe(7);
  });

  it('section header click toggles collapse state + chevron', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    mountEditUi(host, state, makeSections(['palette']), { onChange: () => {} });

    const header = host.querySelector('.pyr3-edit-section-header') as HTMLElement;
    const chev = header.querySelector('.pyr3-edit-chev') as HTMLElement;
    const body = host.querySelector('.pyr3-edit-section-body') as HTMLElement;

    // #27 — sections start expanded on first load.
    expect(state.sectionCollapse.palette).toBe(false);
    expect(chev.textContent).toBe('▼');
    expect(body.style.display).toBe('block');

    header.click();
    expect(state.sectionCollapse.palette).toBe(true);
    expect(chev.textContent).toBe('▶');
    expect(body.style.display).toBe('none');

    header.click();
    expect(state.sectionCollapse.palette).toBe(false);
    expect(chev.textContent).toBe('▼');
    expect(body.style.display).toBe('block');
  });

  it('passes the build callback the section body host + state + onChange', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const build = vi.fn();
    const onChange = vi.fn();
    mountEditUi(host, state, [{ key: 'palette', lens: 'color', title: 'PAL', build }], { onChange });
    expect(build).toHaveBeenCalledTimes(1);
    const [bodyArg, stateArg, onChangeArg] = build.mock.calls[0]!;
    expect((bodyArg as HTMLElement).className).toBe('pyr3-edit-section-body');
    expect(stateArg).toBe(state);
    expect(onChangeArg).toBe(onChange);
  });

  it('destroy() removes the topbar + every section element', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(seededRng(1)), 1);
    const ui = mountEditUi(host, state, makeSections(['palette', 'viewport']), { onChange: () => {} });
    expect(host.children.length).toBeGreaterThan(0);
    ui.destroy();
    expect(host.children.length).toBe(0);
  });

  it('section-toggle persists the section-collapse map to localStorage', () => {
    vi.stubGlobal('localStorage', makeStorageStub());
    try {
      const host = document.createElement('div');
      const state = createEditState(generateRandomGenome(seededRng(1)), 1);
      mountEditUi(host, state, makeSections(['palette', 'viewport']), { onChange: () => {} });

      // Nothing written yet.
      expect(localStorage.getItem(SECTION_COLLAPSE_KEY)).toBeNull();

      // #27 — sections start expanded; clicking the palette header collapses
      // it (false → true) and persists. viewport stays expanded (false).
      const headers = host.querySelectorAll('.pyr3-edit-section-header');
      (headers[0] as HTMLElement).click();
      const raw = localStorage.getItem(SECTION_COLLAPSE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.palette).toBe(true);
      expect(parsed.viewport).toBe(false);

      // Click viewport too — the next persisted map reflects both collapsed.
      (headers[1] as HTMLElement).click();
      const parsed2 = JSON.parse(localStorage.getItem(SECTION_COLLAPSE_KEY)!);
      expect(parsed2.palette).toBe(true);
      expect(parsed2.viewport).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Legacy 4-button test removed — see comment above. Callbacks
  // (onReroll/onOpenFile/onSaveFile/onRenderPng) are still wired through
  // mountEditUi's callbacks contract for the EditPageHandle, exercised
  // indirectly by ui-bar.test.ts and integration paths.
});
