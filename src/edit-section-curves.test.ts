// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { curvesSection } from './edit-section-curves';
import { SPIRAL_GALAXY } from './genome';
import { createEditState, type EditState } from './edit-state';
import { IDENTITY_POINTS } from './channel-curves';

function buildHost(): { host: HTMLElement; state: EditState; calls: string[] } {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const state = createEditState({ ...SPIRAL_GALAXY }, 0);
  const calls: string[] = [];
  curvesSection.build(host, state, (p) => calls.push(p));
  return { host, state, calls };
}

describe('curvesSection: shell + tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('exports the correct SectionKey + title', () => {
    expect(curvesSection.key).toBe('curves');
    expect(curvesSection.title).toMatch(/COLOR CURVES/);
  });

  it('mounts with 5 channel tabs (Composite, R, G, B, Luma)', () => {
    const { host } = buildHost();
    const tabs = host.querySelectorAll('[data-tab]');
    expect(tabs.length).toBe(5);
    const labels = Array.from(tabs).map((el) => (el as HTMLElement).dataset['tab']);
    expect(labels).toEqual(['composite', 'r', 'g', 'b', 'luma']);
  });

  it('Composite is the default active tab', () => {
    const { host } = buildHost();
    const active = host.querySelector('[data-tab].active') as HTMLElement;
    expect(active).toBeTruthy();
    expect(active.dataset['tab']).toBe('composite');
  });

  it('respects state.activeColorCurveChannel when pre-set', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const state = createEditState({ ...SPIRAL_GALAXY }, 0);
    state.activeColorCurveChannel = 'luma';
    curvesSection.build(host, state, () => {});
    const active = host.querySelector('[data-tab].active') as HTMLElement;
    expect(active.dataset['tab']).toBe('luma');
  });

  it('clicking a tab switches active state', () => {
    const { host, state } = buildHost();
    const rTab = host.querySelector('[data-tab="r"]') as HTMLElement;
    rTab.click();
    const active = host.querySelector('[data-tab].active') as HTMLElement;
    expect(active.dataset['tab']).toBe('r');
    expect(state.activeColorCurveChannel).toBe('r');
  });

  it('renders a 240×240 curve canvas', () => {
    const { host } = buildHost();
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(240);
  });

  it('renders 9 preset buttons', () => {
    const { host } = buildHost();
    const presets = host.querySelectorAll('[data-preset]');
    expect(presets.length).toBe(9);
  });

  it('renders the numeric in/out readout (disabled until point selected)', () => {
    const { host } = buildHost();
    const inField = host.querySelector('[data-curve-in]') as HTMLInputElement;
    const outField = host.querySelector('[data-curve-out]') as HTMLInputElement;
    expect(inField).toBeTruthy();
    expect(outField).toBeTruthy();
    expect(inField.disabled).toBe(true);
    expect(outField.disabled).toBe(true);
  });

  it('renders the delete button (disabled until point selected)', () => {
    const { host } = buildHost();
    const del = host.querySelector('[data-curve-delete]') as HTMLButtonElement;
    expect(del).toBeTruthy();
    expect(del.disabled).toBe(true);
  });

  it('renders reset-all on the header', () => {
    const { host } = buildHost();
    const btn = host.querySelector('.pyr3-curves-reset-all');
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toMatch(/Reset all/);
  });

  it('renders footer with reset-channel, snap, before/after buttons', () => {
    const { host } = buildHost();
    expect(host.querySelector('[data-curve-reset-channel]')).toBeTruthy();
    expect(host.querySelector('[data-curve-snap]')).toBeTruthy();
    expect(host.querySelector('[data-curve-preview-off]')).toBeTruthy();
  });
});

function stubCanvasRect(canvas: HTMLCanvasElement) {
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 240, bottom: 240, width: 240, height: 240,
    x: 0, y: 0, toJSON() { return {}; },
  });
}

describe('curvesSection: gestures', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('clicking empty canvas adds a control point', () => {
    const { host, state, calls } = buildHost();
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    stubCanvasRect(canvas);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 120, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup',   { clientX: 120, clientY: 120, bubbles: true }));
    expect(calls.some((p) => p.startsWith('channelCurves'))).toBe(true);
    const composite = state.genome.channelCurves?.composite ?? IDENTITY_POINTS;
    expect(composite.length).toBeGreaterThan(2);
  });

  it('Backspace deletes the selected control point', () => {
    const { state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(state.genome.channelCurves.composite.length).toBe(2);
  });

  it('refuses to delete the last 2 control points', () => {
    const { host, state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 0 };
    const btn = host.querySelector('[data-curve-delete]') as HTMLButtonElement;
    btn.disabled = false;
    btn.click();
    expect(state.genome.channelCurves.composite.length).toBe(2);
  });

  it('ArrowDown reduces selected point y by 1/256', () => {
    const { state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(state.genome.channelCurves.composite[1]!.y).toBeCloseTo(0.5 - 1/256, 4);
  });

  it('Shift+ArrowUp nudges by 10/256', () => {
    const { state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
    expect(state.genome.channelCurves.composite[1]!.y).toBeCloseTo(0.5 + 10/256, 4);
  });

  it('clicking an existing point selects it and enables numeric fields', () => {
    const { host, state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    stubCanvasRect(canvas);
    // Point at (0.5, 0.5) → canvas pixel (120, 120) (y inverted)
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 120, bubbles: true }));
    expect(state.selectedCurvePoint?.pointIdx).toBe(1);
    const inField = host.querySelector('[data-curve-in]') as HTMLInputElement;
    expect(inField.disabled).toBe(false);
    expect(inField.value).toBe(String(Math.round(0.5 * 255)));
  });

  it('drag mousemove updates point with neighbor clamp', () => {
    const { host, state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    stubCanvasRect(canvas);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 120, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 180, clientY: 60, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup',   { clientX: 180, clientY: 60, bubbles: true }));
    const mid = state.genome.channelCurves!.composite[1]!;
    expect(mid.x).toBeCloseTo(0.75, 4);
    expect(mid.y).toBeCloseTo(0.75, 4);
  });

  it('snap-to-grid rounds to nearest 1/8', () => {
    const { host, state } = buildHost();
    state.colorCurvesSnapToGrid = true;
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    stubCanvasRect(canvas);
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 120, bubbles: true }));
    // Drag to (0.62, 0.62) raw → snaps to (0.625, 0.625) which is 5/8
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 149, clientY: 91, bubbles: true }));
    const mid = state.genome.channelCurves!.composite[1]!;
    expect(mid.x).toBeCloseTo(0.625, 4);
    expect(mid.y).toBeCloseTo(0.625, 4);
  });

  it('refuses to add a 9th point (cap at 8)', () => {
    const { host, state } = buildHost();
    const eight: { x: number; y: number }[] = [];
    for (let i = 0; i < 8; i++) eight.push({ x: i / 7, y: i / 7 });
    state.genome.channelCurves = {
      composite: eight, r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    stubCanvasRect(canvas);
    // Click somewhere not on an existing point
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 30, clientY: 200, bubbles: true }));
    expect(state.genome.channelCurves.composite.length).toBe(8);
  });

  it('numeric out field change updates the selected point y', () => {
    const { host, state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    const canvas = host.querySelector('canvas[data-curve-canvas]') as HTMLCanvasElement;
    stubCanvasRect(canvas);
    // Click the existing midpoint to enable numeric fields
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 120, bubbles: true }));
    const outField = host.querySelector('[data-curve-out]') as HTMLInputElement;
    outField.value = '64';
    outField.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.genome.channelCurves!.composite[1]!.y).toBeCloseTo(64 / 255, 4);
  });

  it('ArrowLeft on midpoint moves x toward left neighbor', () => {
    const { state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    state.selectedCurvePoint = { channel: 'composite', pointIdx: 1 };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(state.genome.channelCurves.composite[1]!.x).toBeCloseTo(0.5 - 1/256, 4);
  });
});

describe('curvesSection: presets + reset + before/after', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('Soft-S preset installs a known 4-point curve', () => {
    const { host, state } = buildHost();
    const btn = host.querySelector('[data-preset="soft-s"]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves!.composite).toEqual([
      { x: 0, y: 0 }, { x: 0.25, y: 0.20 }, { x: 0.75, y: 0.80 }, { x: 1, y: 1 },
    ]);
  });

  it('Preset application emits an onChange("channelCurves.<channel>") call', () => {
    const { host, calls } = buildHost();
    const btn = host.querySelector('[data-preset="medium-s"]') as HTMLButtonElement;
    btn.click();
    expect(calls).toContain('channelCurves.composite');
  });

  it('Preset deep-copies its points so dragging does not mutate the constant', () => {
    const { host, state } = buildHost();
    (host.querySelector('[data-preset="soft-s"]') as HTMLButtonElement).click();
    const first = state.genome.channelCurves!.composite;
    // Mutate the active curve; re-click should still install the canonical preset.
    first[1] = { x: 0.5, y: 0.5 };
    (host.querySelector('[data-preset="soft-s"]') as HTMLButtonElement).click();
    expect(state.genome.channelCurves!.composite[1]).toEqual({ x: 0.25, y: 0.20 });
  });

  it('Identity preset resets the active channel to [(0,0),(1,1)]', () => {
    const { host, state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    const btn = host.querySelector('[data-preset="identity"]') as HTMLButtonElement;
    btn.click();
    expect(state.genome.channelCurves!.composite).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it('Reset-channel only affects the active channel', () => {
    const { host, state } = buildHost();
    state.activeColorCurveChannel = 'composite';
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
      r:         [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }],
      g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    (host.querySelector('[data-curve-reset-channel]') as HTMLButtonElement).click();
    expect(state.genome.channelCurves!.composite).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(state.genome.channelCurves!.r[1]).toEqual({ x: 0.5, y: 0.7 });
  });

  it('Reset-all clears state.genome.channelCurves entirely', () => {
    const { host, state } = buildHost();
    state.genome.channelCurves = {
      composite: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
      r: IDENTITY_POINTS, g: IDENTITY_POINTS, b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
    (host.querySelector('.pyr3-curves-reset-all') as HTMLButtonElement).click();
    expect(state.genome.channelCurves).toBeUndefined();
  });

  it('Reset-all emits the full-tree "channelCurves" path', () => {
    const { host, calls } = buildHost();
    (host.querySelector('.pyr3-curves-reset-all') as HTMLButtonElement).click();
    expect(calls).toContain('channelCurves');
  });

  it('pointerdown on the eye sets previewOff; pointerup clears it', () => {
    const { host, state } = buildHost();
    const btn = host.querySelector('[data-curve-preview-off]') as HTMLButtonElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(state.colorCurvesPreviewOff).toBe(true);
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(state.colorCurvesPreviewOff).toBe(false);
  });

  it('pointerleave on the eye also clears previewOff (release outside)', () => {
    const { host, state } = buildHost();
    const btn = host.querySelector('[data-curve-preview-off]') as HTMLButtonElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    btn.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(state.colorCurvesPreviewOff).toBe(false);
  });

  it('preview toggle emits onChange so the lane scheduler re-presents', () => {
    const { host, calls } = buildHost();
    const btn = host.querySelector('[data-curve-preview-off]') as HTMLButtonElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    const previewEvents = calls.filter((p) => p === 'channelCurves');
    expect(previewEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('snap-to-grid toggle flips the boolean and the .active class', () => {
    const { host, state } = buildHost();
    const btn = host.querySelector('[data-curve-snap]') as HTMLButtonElement;
    expect(state.colorCurvesSnapToGrid).toBeFalsy();
    btn.click();
    expect(state.colorCurvesSnapToGrid).toBe(true);
    expect(btn.classList.contains('active')).toBe(true);
    btn.click();
    expect(state.colorCurvesSnapToGrid).toBe(false);
    expect(btn.classList.contains('active')).toBe(false);
  });
});
