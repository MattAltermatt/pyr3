// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  pathLane,
  createLaneScheduler,
  createEditState,
  setActiveCanvasOverlay,
  persistWip,
  restoreWip,
  resolveColdStartGenomeWithSource,
  schedulePersist,
  WIP_KEY,
  loadEditRenderSettings,
  saveEditRenderSettings,
  DEFAULT_EDIT_RENDER_SETTINGS,
  EDIT_RENDER_SETTINGS_KEY,
  LENS_KEY,
  persistActiveLens,
  restoreActiveLens,
  persistPanelWidth,
  restorePanelWidth,
  loadGizmoPrefs,
  saveGizmoPrefs,
  GIZMO_PREFS_DEFAULT,
  loadComposePrefs,
  saveComposePrefs,
  COMPOSE_PREFS_DEFAULT,
  type Clock,
} from './edit-state';
import { generateRandomGenome } from './edit-seed';

// Map-backed localStorage stub — happy-dom v20 doesn't expose `localStorage`
// globally under vitest. See src/prefs.test.ts / src/edit-variation-picker.test.ts
// for the canonical pattern.
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

describe('pathLane', () => {
  it('maps render-dim / oversample / filter to rebuild', () => {
    expect(pathLane('size.width')).toBe('rebuild');
    expect(pathLane('size.height')).toBe('rebuild');
    expect(pathLane('oversample')).toBe('rebuild');
    expect(pathLane('spatialFilter.radius')).toBe('rebuild');
  });

  it('maps xforms / final / viewport / symmetry to slow', () => {
    expect(pathLane('xforms.0.weight')).toBe('slow');
    expect(pathLane('xforms.2.variations.0.weight')).toBe('slow');
    expect(pathLane('xforms.1.post.a')).toBe('slow');
    expect(pathLane('xforms.0.xaos.1')).toBe('slow');
    expect(pathLane('finalxform.opacity')).toBe('slow');
    expect(pathLane('scale')).toBe('slow');
    expect(pathLane('cx')).toBe('slow');
    expect(pathLane('cy')).toBe('slow');
    expect(pathLane('rotate')).toBe('slow');
    expect(pathLane('symmetry.n')).toBe('slow');
  });

  it('maps palette (swap/hue/mode) to slow — chaos.wgsl bakes palette RGB into the histogram', () => {
    expect(pathLane('palette')).toBe('slow');
    expect(pathLane('palette.hue')).toBe('slow');
    expect(pathLane('palette.mode')).toBe('slow');
  });

  it('maps genome.paletteMode (flam3 spec scatter-time mode) to slow', () => {
    expect(pathLane('paletteMode')).toBe('slow');
  });

  it('maps quality to slow (spp re-iterates)', () => {
    expect(pathLane('quality')).toBe('slow');
  });

  it('maps tonemap / density / background / meta to fast (present-only)', () => {
    expect(pathLane('tonemap.brightness')).toBe('fast');
    expect(pathLane('tonemap.gamma')).toBe('fast');
    expect(pathLane('tonemap.vibrancy')).toBe('fast');
    expect(pathLane('tonemap.highlightPower')).toBe('fast');
    expect(pathLane('tonemap.gammaThreshold')).toBe('fast');
    expect(pathLane('density.maxRad')).toBe('fast');
    expect(pathLane('density.minRad')).toBe('fast');
    expect(pathLane('density.curve')).toBe('fast');
    expect(pathLane('background')).toBe('fast');
    expect(pathLane('name')).toBe('fast');
    expect(pathLane('nick')).toBe('fast');
  });

  it('maps channelCurves (#116) to fast — visualize-only, no chaos re-iterate', () => {
    expect(pathLane('channelCurves')).toBe('fast');
    expect(pathLane('channelCurves.composite')).toBe('fast');
    expect(pathLane('channelCurves.r')).toBe('fast');
    expect(pathLane('channelCurves.luma')).toBe('fast');
    expect(pathLane('channelCurves.composite.0')).toBe('fast');
  });

  it('unknown path defaults to fast (cheapest safe option)', () => {
    expect(pathLane('somethingUnknown')).toBe('fast');
    expect(pathLane('nested.unknown.field')).toBe('fast');
  });
});

interface ManualClock extends Clock {
  advance(ms: number): void;
}

function fakeClock(): ManualClock {
  interface Timer {
    id: number;
    fn: () => void;
    due: number;
  }
  const timers: Timer[] = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const t: Timer = { id: nextId++, fn, due: now + ms };
      timers.push(t);
      return t.id;
    },
    clearTimeout(id) {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx >= 0) timers.splice(idx, 1);
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((t) => t.due <= now).sort((a, b) => a.due - b.due);
      for (const t of due) {
        const i = timers.indexOf(t);
        if (i >= 0) timers.splice(i, 1);
        t.fn();
      }
    },
  };
}

describe('createLaneScheduler', () => {
  it('coalesces multiple edits in the same lane within the debounce window', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    s.schedule({ lane: 'fast', path: 'background' });
    clock.advance(15);
    expect(onFire).not.toHaveBeenCalled();
    clock.advance(2); // total 17 — past the 16ms fast debounce
    expect(onFire).toHaveBeenCalledTimes(1);
    const [lane, paths] = onFire.mock.calls[0]!;
    expect(lane).toBe('fast');
    expect(paths).toEqual(expect.arrayContaining(['tonemap.gamma', 'background']));
  });

  it('runs the three lanes on independent timers (fast=16ms, slow=80ms, rebuild=80ms)', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    s.schedule({ lane: 'slow', path: 'xforms.0.weight' });
    s.schedule({ lane: 'rebuild', path: 'size.width' });

    clock.advance(20);
    expect(onFire).toHaveBeenCalledWith('fast', ['tonemap.gamma']);
    expect(onFire).toHaveBeenCalledTimes(1);

    clock.advance(80); // total 100 — past slow's 80ms AND rebuild's 80ms
    expect(onFire).toHaveBeenCalledWith('slow', ['xforms.0.weight']);
    expect(onFire).toHaveBeenCalledWith('rebuild', ['size.width']);
    expect(onFire).toHaveBeenCalledTimes(3);
  });

  it('flush(lane) fires pending paths for that lane immediately', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'rebuild', path: 'size.width' });
    s.schedule({ lane: 'rebuild', path: 'size.height' });
    s.flush('rebuild');
    expect(onFire).toHaveBeenCalledTimes(1);
    const [lane, paths] = onFire.mock.calls[0]!;
    expect(lane).toBe('rebuild');
    expect(paths).toEqual(expect.arrayContaining(['size.width', 'size.height']));
  });

  it('flush() with no arg fires every lane', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'a' });
    s.schedule({ lane: 'slow', path: 'b' });
    s.schedule({ lane: 'rebuild', path: 'c' });
    s.flush();
    expect(onFire).toHaveBeenCalledTimes(3);
  });

  it('cancel() drops pending and clears timers', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.cancel();
    clock.advance(100);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('re-scheduling the same path within window does not duplicate the fire', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    clock.advance(20);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith('fast', ['tonemap.gamma']);
  });
});

describe('createEditState', () => {
  it('starts with all sections EXPANDED on first load (collapse = false) (#27)', () => {
    const st = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(st.sectionCollapse.palette).toBe(false);
    expect(st.sectionCollapse.viewport).toBe(false);
    expect(st.sectionCollapse.xforms).toBe(false);
    expect(st.sectionCollapse['global-symmetry']).toBe(false);
    expect(st.sectionCollapse['global-tonemap']).toBe(false);
    expect(st.sectionCollapse.density).toBe(false);
    expect(st.sectionCollapse.render).toBe(false);
  });

  it('records the seed and a default preview size', () => {
    const g = generateRandomGenome(() => 0.5);
    const st = createEditState(g, 12345);
    expect(st.seed).toBe(12345);
    expect(st.preview.width).toBeGreaterThan(0);
    expect(st.preview.height).toBeGreaterThan(0);
    expect(st.genome).toBe(g);
  });
});

describe('editor render settings (sticky pref)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeStorageStub()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns defaults when nothing is stored', () => {
    expect(loadEditRenderSettings()).toEqual(DEFAULT_EDIT_RENDER_SETTINGS);
  });
  it('round-trips size / quality / settle under its own key', () => {
    saveEditRenderSettings({ size: { width: 2048, height: 2048 }, quality: 200, settleMs: 3000 });
    expect(localStorage.getItem(EDIT_RENDER_SETTINGS_KEY)).not.toBeNull();
    expect(loadEditRenderSettings()).toEqual({ size: { width: 2048, height: 2048 }, quality: 200, settleMs: 3000 });
  });
  it('falls back per-field on malformed / partial data', () => {
    localStorage.setItem(EDIT_RENDER_SETTINGS_KEY, JSON.stringify({ quality: -5, settleMs: 1200 }));
    const s = loadEditRenderSettings();
    expect(s.quality).toBe(DEFAULT_EDIT_RENDER_SETTINGS.quality); // invalid → default
    expect(s.settleMs).toBe(1200);                                // valid → kept
    expect(s.size).toEqual(DEFAULT_EDIT_RENDER_SETTINGS.size);    // missing → default
  });
  it('survives corrupt JSON', () => {
    localStorage.setItem(EDIT_RENDER_SETTINGS_KEY, '{not json');
    expect(loadEditRenderSettings()).toEqual(DEFAULT_EDIT_RENDER_SETTINGS);
  });
});

describe('persistWip / restoreWip', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persistWip writes JSON to localStorage under pyr3.editor.wip', () => {
    const g = generateRandomGenome();
    persistWip(g);
    const raw = localStorage.getItem(WIP_KEY);
    expect(WIP_KEY).toBe('pyr3.editor.wip');
    expect(raw).not.toBeNull();
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw!);
    expect(parsed.name).toBe(g.name);
  });

  it('restoreWip returns the persisted genome', () => {
    const g = generateRandomGenome();
    g.name = 'persist-roundtrip-flame';
    persistWip(g);
    const restored = restoreWip();
    expect(restored).not.toBeNull();
    expect(restored!.name).toBe('persist-roundtrip-flame');
  });

  it('restoreWip returns null when localStorage is empty', () => {
    expect(restoreWip()).toBeNull();
  });

  it('restoreWip returns null when JSON is malformed (does not crash)', () => {
    localStorage.setItem(WIP_KEY, '{not valid json');
    expect(restoreWip()).toBeNull();
  });

  // #421 — fail soft on structurally-stale-but-valid-JSON WIP. A genome whose
  // JSON parses but whose shape is old/incompatible must return null (→ caller
  // rerolls a fresh genome) rather than slip through and crash editor init
  // downstream (e.g. `xforms[0]` / `palette.stops[0]` on undefined).
  it('restoreWip returns null for valid JSON that is not an object', () => {
    for (const raw of ['42', '"hello"', 'null', 'true', '[1,2,3]']) {
      localStorage.setItem(WIP_KEY, raw);
      expect(restoreWip()).toBeNull();
    }
  });

  it('restoreWip returns null when xforms is missing or empty', () => {
    const g = generateRandomGenome();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, xforms: undefined }));
    expect(restoreWip()).toBeNull();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, xforms: [] }));
    expect(restoreWip()).toBeNull();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, xforms: 'not-an-array' }));
    expect(restoreWip()).toBeNull();
  });

  it('restoreWip returns null when palette is missing or has no stops', () => {
    const g = generateRandomGenome();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, palette: undefined }));
    expect(restoreWip()).toBeNull();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, palette: { name: 'x', stops: [] } }));
    expect(restoreWip()).toBeNull();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, palette: { name: 'x' } }));
    expect(restoreWip()).toBeNull();
  });

  it('restoreWip returns null when scale/cx/cy are not finite numbers', () => {
    const g = generateRandomGenome();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, scale: undefined }));
    expect(restoreWip()).toBeNull();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, cx: 'nope' }));
    expect(restoreWip()).toBeNull();
  });

  it('restoreWip still returns a structurally-complete genome', () => {
    const g = generateRandomGenome();
    g.name = 'structurally-valid';
    persistWip(g);
    expect(restoreWip()?.name).toBe('structurally-valid');
  });

  it('resolveColdStartGenomeWithSource falls through to reroll on stale WIP (no throw)', () => {
    const g = generateRandomGenome();
    localStorage.setItem(WIP_KEY, JSON.stringify({ ...g, xforms: [] }));
    const fresh = generateRandomGenome();
    fresh.name = 'fresh-reroll';
    const result = resolveColdStartGenomeWithSource(() => fresh);
    expect(result.source).toBe('reroll');
    expect(result.genome.name).toBe('fresh-reroll');
  });

  it('round-trip preserves genome fields (parse + stringify integrity)', () => {
    const g = generateRandomGenome();
    g.name = 'roundtrip-name';
    g.nick = 'roundtrip-nick';
    persistWip(g);
    const restored = restoreWip()!;
    // Spot-check a handful of fields that vary across a random genome.
    expect(restored.name).toBe(g.name);
    expect(restored.nick).toBe(g.nick);
    expect(restored.xforms.length).toBe(g.xforms.length);
    expect(restored.scale).toBe(g.scale);
    expect(restored.cx).toBe(g.cx);
    expect(restored.cy).toBe(g.cy);
  });
});

describe('schedulePersist (debounce)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('calling multiple times within 200ms only persists once', () => {
    const g1 = generateRandomGenome();
    g1.name = 'first';
    const g2 = generateRandomGenome();
    g2.name = 'second';
    const g3 = generateRandomGenome();
    g3.name = 'final';

    schedulePersist(g1);
    schedulePersist(g2);
    schedulePersist(g3);

    // Nothing written yet — debounce hasn't fired.
    expect(localStorage.getItem(WIP_KEY)).toBeNull();

    vi.advanceTimersByTime(199);
    expect(localStorage.getItem(WIP_KEY)).toBeNull();

    vi.advanceTimersByTime(2);
    const raw = localStorage.getItem(WIP_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // The LAST scheduled value wins.
    expect(parsed.name).toBe('final');
  });

  it('a second schedulePersist after the window fires a separate write', () => {
    const g1 = generateRandomGenome();
    g1.name = 'wave-1';
    schedulePersist(g1);
    vi.advanceTimersByTime(250);
    expect(JSON.parse(localStorage.getItem(WIP_KEY)!).name).toBe('wave-1');

    const g2 = generateRandomGenome();
    g2.name = 'wave-2';
    schedulePersist(g2);
    vi.advanceTimersByTime(250);
    expect(JSON.parse(localStorage.getItem(WIP_KEY)!).name).toBe('wave-2');
  });
});

import {
  persistSectionCollapse,
  restoreSectionCollapse,
  SECTION_COLLAPSE_KEY,
} from './edit-state';

describe('persistSectionCollapse / restoreSectionCollapse', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persistSectionCollapse writes JSON under pyr3.editor.sectionCollapse', () => {
    expect(SECTION_COLLAPSE_KEY).toBe('pyr3.editor.sectionCollapse');
    const map = {
      palette: false, 'color-mode': false, curves: true, scopes: true, hsl: false, viewport: true, xforms: false,
      'global-symmetry': false, 'global-tonemap': false, density: true, render: true,
    };
    persistSectionCollapse(map);
    const raw = localStorage.getItem(SECTION_COLLAPSE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(map);
  });

    it('leaves localStorage empty when writing defaults', () => {
      persistSectionCollapse({ palette: true, 'color-mode': true, curves: true, scopes: true, hsl: true, viewport: true, xforms: true, 'global-symmetry': true, 'global-tonemap': true, density: true, render: true });
      expect(localStorage.getItem('pyr3.edit.sectionCollapse')).toBeNull();
    });

  it('restoreSectionCollapse returns the persisted map', () => {
    const map = {
      palette: false, 'color-mode': false, curves: true, scopes: true, hsl: true, viewport: true, xforms: false,
      'global-symmetry': false, 'global-tonemap': false, density: true, render: true,
    };
    localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(map));
    expect(restoreSectionCollapse()).toEqual(map);
  });

  it('restoreSectionCollapse returns default all-EXPANDED when absent (#27)', () => {
    const restored = restoreSectionCollapse();
    expect(restored).toEqual({
      palette: false, 'color-mode': false, curves: false, scopes: false, hsl: false, viewport: false, xforms: false,
      'global-symmetry': false, 'global-tonemap': false, density: false, render: false,
    });
  });

  it('restoreSectionCollapse returns default on malformed JSON (does not crash)', () => {
    localStorage.setItem(SECTION_COLLAPSE_KEY, '{not valid');
    const restored = restoreSectionCollapse();
    expect(restored).toEqual({
      palette: false, 'color-mode': false, curves: false, scopes: false, hsl: false, viewport: false, xforms: false,
      'global-symmetry': false, 'global-tonemap': false, density: false, render: false,
    });
  });

  it('round-trip integrity preserves all keys', () => {
      const oldSections = { palette: false, 'color-mode': false, curves: false, scopes: false, hsl: false, viewport: false, xforms: false, 'global-symmetry': false, 'global-tonemap': false, density: false, render: false };
      persistSectionCollapse(oldSections);
      expect(restoreSectionCollapse()).toEqual(oldSections);
  });
});

import {
  persistXformDetailCollapse,
  restoreXformDetailCollapse,
  XFORM_DETAIL_COLLAPSE_KEY,
} from './edit-state';

describe('persistXformDetailCollapse / restoreXformDetailCollapse (#350 P2.2)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorageStub());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('default is all subpanels open (#438)', () => {
    expect(XFORM_DETAIL_COLLAPSE_KEY).toBe('pyr3.editor.xformDetailCollapse');
    expect(restoreXformDetailCollapse()).toEqual({
      affine: false, variations: false, color: false, xaos: false,
    });
  });

  it('round-trips a persisted map', () => {
    const map = { affine: true, variations: false, color: true, xaos: false };
    persistXformDetailCollapse(map);
    expect(restoreXformDetailCollapse()).toEqual(map);
  });

  it('merges a partial / older shape over the default (all four keys present)', () => {
    localStorage.setItem(XFORM_DETAIL_COLLAPSE_KEY, JSON.stringify({ variations: true }));
    expect(restoreXformDetailCollapse()).toEqual({
      affine: false, variations: true, color: false, xaos: false,
    });
  });

  it('returns the default on malformed JSON (does not crash)', () => {
    localStorage.setItem(XFORM_DETAIL_COLLAPSE_KEY, '{not valid');
    expect(restoreXformDetailCollapse()).toEqual({
      affine: false, variations: false, color: false, xaos: false,
    });
  });

  it('createEditState seeds xformDetailCollapse from the persisted map', () => {
    persistXformDetailCollapse({ affine: true, variations: true, color: false, xaos: true });
    const st = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(st.xformDetailCollapse).toEqual({ affine: true, variations: true, color: false, xaos: true });
  });
});

import { snapshotForSolo, restoreFromSolo, type SoloSnapshot } from './edit-state';

describe('snapshotForSolo / restoreFromSolo', () => {
  it('snapshot captures prior active state per index', () => {
    const items = [{ active: true }, { active: false }, { active: undefined as boolean | undefined }];
    const snap = snapshotForSolo(items, 1);
    // index 1 is the solo target; snapshot stores the OTHERS' prior state.
    expect(snap.targetIndex).toBe(1);
    expect(snap.others[0]).toBe(true);
    expect(snap.others[2]).toBe(undefined);
  });

  it('restore writes the prior active values back', () => {
    const items = [{ active: false }, { active: true }, { active: false }];
    const snap: SoloSnapshot = { targetIndex: 1, others: { 0: undefined, 2: true } };
    restoreFromSolo(items, snap);
    expect(items[0]!.active).toBe(undefined);
    expect(items[2]!.active).toBe(true);
    // The target item is untouched by restore.
    expect(items[1]!.active).toBe(true);
  });
});

describe('lens + panel-width state (#27)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeStorageStub()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('createEditState defaults activeLens=xform, selectedXformIndex=0, panelWidth=360', () => {
    const s = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(s.activeLens).toBe('xform');
    expect(s.selectedXformIndex).toBe(0);
    expect(s.panelWidth).toBe(360);
  });

  it('createEditState seeds an identity workspace view (#350 decoupled view)', () => {
    const s = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(s.view).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });

  it('createEditState defaults activeCanvasOverlay to none (#372)', () => {
    const s = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(s.activeCanvasOverlay).toBe('none');
  });

  it('setActiveCanvasOverlay is mutually exclusive — switching replaces, never stacks (#372)', () => {
    const s = createEditState(generateRandomGenome(() => 0.5), 1);
    setActiveCanvasOverlay(s, 'gradient');
    expect(s.activeCanvasOverlay).toBe('gradient');
    setActiveCanvasOverlay(s, 'gizmo');
    expect(s.activeCanvasOverlay).toBe('gizmo');
    setActiveCanvasOverlay(s, 'none');
    expect(s.activeCanvasOverlay).toBe('none');
  });

  it('persistActiveLens round-trips; restore falls back to xform on absent/garbage', () => {
    expect(restoreActiveLens()).toBe('xform');
    persistActiveLens('color');
    expect(restoreActiveLens()).toBe('color');
    localStorage.setItem(LENS_KEY, 'not-a-lens');
    expect(restoreActiveLens()).toBe('xform');
  });

  it('persistPanelWidth clamps to 280..560 on restore', () => {
    persistPanelWidth(9999);
    expect(restorePanelWidth()).toBe(560);
    persistPanelWidth(10);
    expect(restorePanelWidth()).toBe(280);
    persistPanelWidth(400);
    expect(restorePanelWidth()).toBe(400);
  });
});

describe('global section split keys (#27)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeStorageStub()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('default collapse map has the two global halves and no plain global', () => {
    const m = restoreSectionCollapse();
    expect(m['global-symmetry']).toBe(false);
    expect(m['global-tonemap']).toBe(false);
    expect('global' in m).toBe(false);
  });

  it('an old persisted {global:false} is ignored (orphan); halves default true', () => {
    localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify({ global: false }));
    const m = restoreSectionCollapse();
    expect(m['global-symmetry']).toBe(false);
    expect(m['global-tonemap']).toBe(false);
  });
});

describe('gizmo prefs persistence', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeStorageStub()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns defaults when nothing stored', () => {
    expect(loadGizmoPrefs()).toEqual(GIZMO_PREFS_DEFAULT);
  });

  it('round-trips saved prefs but editOnCanvas always loads false (#350 flame default)', () => {
    saveGizmoPrefs({ editOnCanvas: true, showWorldGrid: true, snapEnabled: true, snapStep: 0.25, snapAngleStep: 15 });
    expect(loadGizmoPrefs()).toEqual({ editOnCanvas: false, showWorldGrid: true, snapEnabled: true, snapStep: 0.25, snapAngleStep: 15 });
  });

  it('falls back to defaults on malformed JSON', () => {
    globalThis.localStorage!.setItem('pyr3.edit.gizmo', '{not json');
    expect(loadGizmoPrefs()).toEqual(GIZMO_PREFS_DEFAULT);
  });
});

describe('compose prefs persistence (#364)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeStorageStub()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults: master on, all guides off, spokeFold 6', () => {
    expect(COMPOSE_PREFS_DEFAULT).toEqual({
      composeOn: true, thirds: false, center: false, grid: false, rings: false, spokes: false, spokeFold: 6,
      goldenSpiral: false, spiralOrient: 0, spokesAuto: false,
    });
    expect(loadComposePrefs()).toEqual(COMPOSE_PREFS_DEFAULT);
  });

  it('round-trips saved prefs (incl. master off)', () => {
    const p = { ...COMPOSE_PREFS_DEFAULT, composeOn: false, thirds: true, rings: true, spokes: true, spokeFold: 8 };
    saveComposePrefs(p);
    expect(loadComposePrefs()).toEqual(p);
  });

  it('defaults composeOn to true when absent (legacy prefs)', () => {
    globalThis.localStorage!.setItem('pyr3.edit.compose', JSON.stringify({ thirds: true, spokeFold: 6 }));
    expect(loadComposePrefs().composeOn).toBe(true);
  });

  it('defaults new #402/#403 fields when absent (legacy prefs)', () => {
    globalThis.localStorage!.setItem('pyr3.edit.compose', JSON.stringify({ thirds: true, spokeFold: 6 }));
    const p = loadComposePrefs();
    expect(p.goldenSpiral).toBe(false);
    expect(p.spiralOrient).toBe(0);
    expect(p.spokesAuto).toBe(false);
  });

  it('round-trips + clamps the spiral orientation 0..3 (#402)', () => {
    saveComposePrefs({ ...COMPOSE_PREFS_DEFAULT, goldenSpiral: true, spiralOrient: 2, spokesAuto: true });
    const p = loadComposePrefs();
    expect(p.goldenSpiral).toBe(true);
    expect(p.spiralOrient).toBe(2);
    expect(p.spokesAuto).toBe(true);
    saveComposePrefs({ ...COMPOSE_PREFS_DEFAULT, spiralOrient: 9 });
    expect(loadComposePrefs().spiralOrient).toBe(3);
    saveComposePrefs({ ...COMPOSE_PREFS_DEFAULT, spiralOrient: -4 });
    expect(loadComposePrefs().spiralOrient).toBe(0);
  });

  it('clamps spokeFold to 2..12 on load', () => {
    saveComposePrefs({ ...COMPOSE_PREFS_DEFAULT, spokes: true, spokeFold: 99 });
    expect(loadComposePrefs().spokeFold).toBe(12);
    saveComposePrefs({ ...COMPOSE_PREFS_DEFAULT, spokes: true, spokeFold: 1 });
    expect(loadComposePrefs().spokeFold).toBe(2);
  });

  it('falls back to defaults on malformed JSON', () => {
    globalThis.localStorage!.setItem('pyr3.edit.compose', '{not json');
    expect(loadComposePrefs()).toEqual(COMPOSE_PREFS_DEFAULT);
  });
});
