// pyr3 — /editor Color Curves section (issue #116).
//
// Five post-tonemap channel curves (Composite, R, G, B, Luma) applied
// per-pixel in the visualize pass. Section shape:
//   - Channel tab switcher (5 tabs; one canvas)
//   - Preset row (9 presets)
//   - 240×240 curve canvas with grid + identity diagonal + Catmull-Rom
//     spline + control point dots; histogram overlay (added in Task 7)
//   - Numeric in/out readout for the selected control point
//   - Footer: reset-channel, snap-to-grid toggle, before/after hold
//   - Header right: reset-all
//
// Gestures (click-add, drag, delete, arrow-nudge) land in Task 6.
// Presets / before-after / histogram land in Task 7.

import { type SectionMount } from './edit-ui';
import { type EditState, type SettledPixels } from './edit-state';
import type { ChannelCurves, CurvePoint } from './genome';
import { IDENTITY_POINTS, bakeOne } from './channel-curves';
import {
  binChannels,
  normalizeBins,
  peakOf,
  type ChannelHistogram,
} from './channel-histogram';
import { COLORS } from './ui-tokens';
import { infoIcon } from './help-text';

// #175 — per-channel histogram tint colors (under the curve spline). RGB
// triples (CSS rgba body) chosen to read against the dark canvas.
const HIST_COLORS: Record<Channel, string> = {
  composite: '200,205,215', // unused (composite overlays r/g/b)
  r: '255,95,95',
  g: '95,210,125',
  b: '105,150,255',
  luma: '205,210,220',
};
// Fraction of canvas height the tallest histogram bin reaches — leaves
// headroom so the fill never crowds the spline at the top.
const HIST_MAX_FILL = 0.82;

const HIT_RADIUS_FRAC = 6 / 240; // 6px in canvas-coord fractions
const MIN_X_GAP = 1e-3;
const MAX_POINTS = 8;
const MIN_POINTS = 2;

const CANVAS_SIZE = 240;

const CHANNELS = [
  { key: 'composite', label: 'Composite' },
  { key: 'r',         label: 'R' },
  { key: 'g',         label: 'G' },
  { key: 'b',         label: 'B' },
  { key: 'luma',      label: 'Luma' },
] as const;

type Channel = (typeof CHANNELS)[number]['key'];

const PRESET_ORDER = [
  'identity',      'soft-s',      'medium-s',  'strong-s',  'inverse',
  'lift-shadows',  'crush-shadows', 'lift-hi', 'crush-hi',
] as const;

const PRESETS: Record<(typeof PRESET_ORDER)[number], CurvePoint[]> = {
  identity:        [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  'soft-s':        [{ x: 0, y: 0 }, { x: 0.25, y: 0.20 }, { x: 0.75, y: 0.80 }, { x: 1, y: 1 }],
  'medium-s':      [{ x: 0, y: 0 }, { x: 0.25, y: 0.15 }, { x: 0.75, y: 0.85 }, { x: 1, y: 1 }],
  'strong-s':      [{ x: 0, y: 0 }, { x: 0.25, y: 0.08 }, { x: 0.75, y: 0.92 }, { x: 1, y: 1 }],
  inverse:         [{ x: 0, y: 1 }, { x: 1, y: 0 }],
  'lift-shadows':  [{ x: 0, y: 0.15 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }],
  'crush-shadows': [{ x: 0, y: 0 },    { x: 0.25, y: 0.05 }, { x: 1, y: 1 }],
  'lift-hi':       [{ x: 0, y: 0 },    { x: 0.5, y: 0.55 },  { x: 1, y: 1 }],
  'crush-hi':      [{ x: 0, y: 0 },    { x: 0.75, y: 0.85 }, { x: 1, y: 0.85 }],
};

// Per-channel tooltips — what each tab edits.
const CHANNEL_TITLES: Record<Channel, string> = {
  composite: 'Composite — applies to R, G, B equally.\n'
    + 'Like dragging R/G/B together. Stacks with the per-channel curves below.',
  r:    'Red channel only — reshape how much red each pixel keeps.',
  g:    'Green channel only.',
  b:    'Blue channel only.',
  luma: 'Luma (BT.709 perceptual brightness) — brightens/darkens without\n'
    + 'shifting hue or saturation. R, G, B scale together by the curve.',
};

// Per-preset tooltips — concrete one-liners describing the shape and effect.
const PRESET_TITLES: Record<(typeof PRESET_ORDER)[number], string> = {
  identity:        'Reset this channel to the diagonal — no remapping (y = x).',
  'soft-s':        'Gentle S-curve. Mild contrast bump. Most flames look better with this on Composite.',
  'medium-s':      'Stronger S-curve. Noticeable contrast.',
  'strong-s':      'Aggressive S-curve. Crushes shadows, lifts highlights. Punchy and dramatic.',
  inverse:         'Photo negative — y = 1 − x. Flips lights and darks.',
  'lift-shadows':  'Brightens dark mids without touching highlights. Pulls detail out of shadows.',
  'crush-shadows': 'Darkens dark mids. Deepens blacks for a richer look.',
  'lift-hi':       'Brightens mids-into-highlights. Lifts the upper tonal range.',
  'crush-hi':      'Pulls highlights down — caps overall brightness, useful when blowing out.',
};

function clonePoints(pts: CurvePoint[]): CurvePoint[] {
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

function presetLabel(key: string): string {
  return key
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// pyr3 themed button (#373 button vocab). `plain` = the canonical SECONDARY
// workhorse look (Reset all / delete / reset-channel / preview, and channel-tab
// OFF state); `active` = the canonical TOGGLE on-state (channel tab / snap ON).
// Works on raw <button> so disabled-state and dataset attributes survive.
function applyBtnStyle(btn: HTMLElement, kind: 'plain' | 'active' = 'plain'): void {
  if (kind === 'active') {
    btn.style.background = '#ff8c1a';
    btn.style.border = '1px solid #ff8c1a';
    btn.style.color = '#1a1206';
    btn.style.fontWeight = '600';
  } else {
    btn.style.background = '#1a1a20';
    btn.style.border = '1px solid #34343e';
    btn.style.color = '#cfcfd6';
    btn.style.fontWeight = '';
  }
  btn.style.padding = '4px 9px';
  btn.style.borderRadius = '5px';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '12px';
  btn.style.lineHeight = '1.2';
  btn.style.userSelect = 'none';
  btn.style.fontFamily = 'inherit';
}

function wireHover(btn: HTMLElement, isActive: () => boolean): void {
  btn.addEventListener('mouseenter', () => {
    if (!isActive()) {
      btn.style.borderColor = '#55556a';
      btn.style.background = '#202028';
    }
  });
  btn.addEventListener('mouseleave', () => {
    if (!isActive()) {
      btn.style.borderColor = '#34343e';
      btn.style.background = '#1a1a20';
    }
  });
}

function applyDisabledStyle(btn: HTMLButtonElement): void {
  btn.style.opacity = btn.disabled ? '0.45' : '1';
  btn.style.cursor = btn.disabled ? 'not-allowed' : 'pointer';
}

function getCurve(state: EditState, ch: Channel): CurvePoint[] {
  return state.genome.channelCurves?.[ch] ?? IDENTITY_POINTS;
}

function setCurrentCurve(state: EditState, next: CurvePoint[]): void {
  const ch = state.activeColorCurveChannel ?? 'composite';
  if (!state.genome.channelCurves) {
    state.genome.channelCurves = {
      composite: IDENTITY_POINTS, r: IDENTITY_POINTS, g: IDENTITY_POINTS,
      b: IDENTITY_POINTS, luma: IDENTITY_POINTS,
    };
  }
  state.genome.channelCurves[ch] = next;
}

function snap1_8(v: number): number {
  return Math.round(v * 8) / 8;
}

function hitTest(curve: CurvePoint[], cx: number, cy: number): number {
  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i]!;
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    if (dx * dx + dy * dy <= HIT_RADIUS_FRAC * HIT_RADIUS_FRAC) return i;
  }
  return -1;
}

function clampToNeighbors(curve: CurvePoint[], idx: number, x: number): number {
  const lo = idx > 0 ? curve[idx - 1]!.x + MIN_X_GAP : 0;
  const hi = idx < curve.length - 1 ? curve[idx + 1]!.x - MIN_X_GAP : 1;
  return Math.max(lo, Math.min(hi, x));
}

export const curvesSection: SectionMount = {
  key: 'curves',
  lens: 'color',
  title: '🎚 COLOR CURVES',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-curves');

    // Default-select Composite tab if nothing selected.
    if (!state.activeColorCurveChannel) {
      state.activeColorCurveChannel = 'composite';
    }

    // ── Header right: Reset-all ─────────────────────────────────────────
    const headerActions = document.createElement('div');
    headerActions.className = 'pyr3-curves-header-actions';
    headerActions.style.display = 'flex';
    headerActions.style.gap = '6px';
    headerActions.style.marginBottom = '6px';
    const resetAllBtn = document.createElement('button');
    resetAllBtn.type = 'button';
    resetAllBtn.className = 'pyr3-curves-reset-all';
    resetAllBtn.textContent = '⟲ Reset all';
    resetAllBtn.title = 'Reset all 5 channels to identity (no grading).\n'
      + 'Drops channelCurves from the genome entirely — the visualize\n'
      + 'shader branches off and output is byte-identical to no-curves.';
    applyBtnStyle(resetAllBtn, 'plain');
    wireHover(resetAllBtn, () => false);
    headerActions.appendChild(resetAllBtn);
    host.appendChild(headerActions);

    // ── Help blurb ──────────────────────────────────────────────────────
    const help = document.createElement('div');
    help.className = 'pyr3-curves-help';
    help.style.color = COLORS.text.muted;
    help.style.fontSize = '11px';
    help.style.lineHeight = '1.5';
    help.style.marginBottom = '8px';
    help.style.padding = '6px 8px';
    help.style.background = COLORS.bg.info;
    help.style.border = `1px solid ${COLORS.border}`;
    help.style.borderRadius = '4px';
    {
      const line1 = document.createElement('div');
      line1.textContent =
        'Each channel remaps tones through its own curve. Pick a tab, then '
        + 'drag points or hit a preset.';
      const line2 = document.createElement('div');
      line2.style.color = COLORS.text.dim;
      line2.style.marginTop = '4px';
      line2.textContent =
        'Click empty area = add · Drag = move · Backspace / − Delete = remove · '
        + 'Arrows = nudge (Shift = ×10) · 👁 = hold to compare before/after';
      help.appendChild(line1);
      help.appendChild(line2);
    }
    host.appendChild(help);

    // ── Channel tab switcher ────────────────────────────────────────────
    const tabsRoot = document.createElement('div');
    tabsRoot.className = 'pyr3-curves-tabs';
    tabsRoot.style.display = 'flex';
    tabsRoot.style.gap = '4px';
    tabsRoot.style.marginBottom = '6px';
    const tabButtons: HTMLButtonElement[] = [];
    for (const ch of CHANNELS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset['tab'] = ch.key;
      el.textContent = ch.label;
      el.title = CHANNEL_TITLES[ch.key];
      const isActive = () => state.activeColorCurveChannel === ch.key;
      applyBtnStyle(el, isActive() ? 'active' : 'plain');
      if (isActive()) el.classList.add('active');
      wireHover(el, isActive);
      el.addEventListener('click', () => {
        state.activeColorCurveChannel = ch.key;
        // Selection was bound to the previous channel — clear it.
        state.selectedCurvePoint = undefined;
        for (const t of tabButtons) {
          const a = t.dataset['tab'] === ch.key;
          if (a) t.classList.add('active'); else t.classList.remove('active');
          applyBtnStyle(t, a ? 'active' : 'plain');
        }
        redrawCanvas();
        syncSelectionUI();
      });
      tabButtons.push(el);
      tabsRoot.appendChild(el);
    }
    tabsRoot.appendChild(infoIcon('curves.channels'));
    host.appendChild(tabsRoot);

    // ── Preset row ──────────────────────────────────────────────────────
    const presetRoot = document.createElement('div');
    presetRoot.className = 'pyr3-curves-presets';
    presetRoot.style.display = 'flex';
    presetRoot.style.flexWrap = 'wrap';
    presetRoot.style.gap = '4px';
    presetRoot.style.marginBottom = '6px';
    for (const key of PRESET_ORDER) {
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset['preset'] = key;
      el.textContent = presetLabel(key);
      el.title = PRESET_TITLES[key]
        + '\n\nApplies to the active channel only — switch the tab above\n'
        + 'to pick which one.';
      applyBtnStyle(el, 'plain');
      wireHover(el, () => false);
      el.addEventListener('click', () => {
        const ch = currentChannel();
        setCurrentCurve(state, clonePoints(PRESETS[key]));
        state.selectedCurvePoint = undefined;
        onChange(`channelCurves.${ch}`);
        redrawCanvas();
        syncSelectionUI();
      });
      presetRoot.appendChild(el);
    }
    host.appendChild(presetRoot);

    // ── Curve canvas ────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.dataset['curveCanvas'] = 'true';
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    canvas.title = 'Click empty area to add a point.\n'
      + 'Drag points to move them — x stays between adjacent points.\n'
      + 'Click a point to select it (numeric readout below).\n'
      + 'Drag a point off-canvas to delete it.';
    canvas.style.display = 'block';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.background = COLORS.bg.input;
    canvas.style.border = `1px solid ${COLORS.border}`;
    canvas.style.borderRadius = '4px';
    host.appendChild(canvas);

    // ── Numeric readout ─────────────────────────────────────────────────
    const readout = document.createElement('div');
    readout.className = 'pyr3-curves-readout';
    readout.style.display = 'flex';
    readout.style.gap = '6px';
    readout.style.alignItems = 'center';
    readout.style.marginTop = '8px';
    readout.style.fontSize = '11px';
    const readoutLabel = document.createElement('span');
    readoutLabel.textContent = 'Selected point:';
    readoutLabel.style.color = COLORS.text.muted;
    readout.appendChild(readoutLabel);

    const fieldStyle = (input: HTMLInputElement, dataset: string, titleText: string) => {
      input.type = 'number';
      input.min = '0';
      input.max = '255';
      input.dataset[dataset] = 'true';
      input.style.width = '54px';
      input.style.padding = '3px 6px';
      input.style.background = COLORS.bg.input;
      input.style.color = COLORS.text.primary;
      input.style.border = `1px solid ${COLORS.border}`;
      // Accent bottom-rule — the #373 editable-number-field affordance, applied
      // consistently to these curve point inputs too.
      input.style.borderBottom = '2px solid var(--accent-border, #884a1a)';
      input.style.borderRadius = '3px';
      input.style.fontFamily = 'inherit';
      input.style.fontSize = '12px';
      input.title = titleText;
      input.disabled = true;
    };

    const inField = document.createElement('input');
    fieldStyle(inField, 'curveIn',
      'Input value of the selected point (0–255).\n'
      + 'Type to set x precisely. Use arrow keys (Shift = ×10) for nudges.');
    readout.appendChild(inField);
    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.style.color = COLORS.text.muted;
    readout.appendChild(arrow);
    const outField = document.createElement('input');
    fieldStyle(outField, 'curveOut',
      'Output value of the selected point (0–255).\n'
      + 'Type to set y precisely.');
    readout.appendChild(outField);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.dataset['curveDelete'] = 'true';
    deleteBtn.textContent = '− Delete';
    deleteBtn.title = 'Delete the selected control point.\n'
      + 'Shortcut: Backspace. Curves must keep at least 2 points.';
    deleteBtn.disabled = true;
    applyBtnStyle(deleteBtn, 'plain');
    applyDisabledStyle(deleteBtn);
    wireHover(deleteBtn, () => false);
    readout.appendChild(deleteBtn);
    host.appendChild(readout);

    // ── Footer ──────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'pyr3-curves-footer';
    footer.style.display = 'flex';
    footer.style.gap = '6px';
    footer.style.marginTop = '8px';
    footer.style.flexWrap = 'wrap';

    const resetChannelBtn = document.createElement('button');
    resetChannelBtn.type = 'button';
    resetChannelBtn.dataset['curveResetChannel'] = 'true';
    resetChannelBtn.textContent = '⟲ Reset channel';
    resetChannelBtn.title = 'Reset only the active channel back to identity.\n'
      + 'Other channels stay as-is.';
    applyBtnStyle(resetChannelBtn, 'plain');
    wireHover(resetChannelBtn, () => false);
    footer.appendChild(resetChannelBtn);

    const snapBtn = document.createElement('button');
    snapBtn.type = 'button';
    snapBtn.dataset['curveSnap'] = 'true';
    snapBtn.textContent = '⟂ Snap 1/8';
    snapBtn.title = 'Toggle snap-to-grid: drag positions round to the\n'
      + 'nearest 1/8 division on both axes. Useful for clean S-curves.';
    applyBtnStyle(snapBtn, state.colorCurvesSnapToGrid ? 'active' : 'plain');
    wireHover(snapBtn, () => !!state.colorCurvesSnapToGrid);
    footer.appendChild(snapBtn);

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.dataset['curvePreviewOff'] = 'true';
    previewBtn.textContent = '👁 hold = before';
    previewBtn.title = 'Press and hold to temporarily bypass all curves.\n'
      + 'Lets you compare graded vs ungraded without losing your work.';
    applyBtnStyle(previewBtn, 'plain');
    wireHover(previewBtn, () => false);
    footer.appendChild(previewBtn);

    host.appendChild(footer);

    // #175 — latest PRE-curve histogram from the settled-pixels feed. null
    // until the first settled render lands; drawn under the spline as a
    // placement reference. Curve-invariant, so it holds still while grading.
    let latestHist: ChannelHistogram | null = null;

    function redrawCanvas() {
      drawCurveCanvas(
        canvas,
        getCurve(state, state.activeColorCurveChannel!),
        latestHist,
        state.activeColorCurveChannel ?? 'composite',
      );
    }

    // Subscribe to the editor's settled-pixels feed (#175). edit-mount invokes
    // this after each full render with the post-tonemap, pre-curve canvas
    // bytes. We bin and redraw — cheap, and only fires on settle (not per drag).
    const onSettledPixels = (px: SettledPixels): void => {
      latestHist = binChannels(px.rgba, px.width, px.height);
      redrawCanvas();
    };
    (state.settledPixelsListeners ??= []).push(onSettledPixels);

    function syncSelectionUI() {
      const ch = state.activeColorCurveChannel ?? 'composite';
      const sel = state.selectedCurvePoint;
      const hasSel = !!(sel && sel.channel === ch);
      inField.disabled = !hasSel;
      outField.disabled = !hasSel;
      deleteBtn.disabled = !hasSel;
      applyDisabledStyle(deleteBtn);
      inField.style.opacity = hasSel ? '1' : '0.45';
      outField.style.opacity = hasSel ? '1' : '0.45';
      if (hasSel) {
        const curve = getCurve(state, ch);
        const pt = curve[sel!.pointIdx];
        if (pt) {
          inField.value = String(Math.round(pt.x * 255));
          outField.value = String(Math.round(pt.y * 255));
        }
      } else {
        inField.value = '';
        outField.value = '';
      }
    }

    function commit() {
      const ch = state.activeColorCurveChannel ?? 'composite';
      onChange(`channelCurves.${ch}`);
      redrawCanvas();
      syncSelectionUI();
    }

    function currentChannel(): Channel {
      return state.activeColorCurveChannel ?? 'composite';
    }

    function clientToFrac(e: MouseEvent): { cx: number; cy: number } {
      const rect = canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width;
      const cy = 1 - (e.clientY - rect.top) / rect.height;
      return { cx, cy };
    }

    // ── Canvas mouse gestures ──────────────────────────────────────────
    let dragIdx = -1;

    canvas.addEventListener('mousedown', (e) => {
      const ch = currentChannel();
      const curve = getCurve(state, ch).slice();
      const { cx, cy } = clientToFrac(e);
      const hit = hitTest(curve, cx, cy);
      if (hit >= 0) {
        dragIdx = hit;
        state.selectedCurvePoint = { channel: ch, pointIdx: hit };
        syncSelectionUI();
        redrawCanvas();
        return;
      }
      // Add a new point if we have headroom.
      if (curve.length >= MAX_POINTS) return;
      const nx = Math.max(0, Math.min(1, cx));
      const ny = Math.max(0, Math.min(1, cy));
      // Refuse if x is near-equal to an existing x (dedupe).
      for (const pt of curve) {
        if (Math.abs(pt.x - nx) < 1e-6) return;
      }
      const next = curve.concat({ x: nx, y: ny }).sort((a, b) => a.x - b.x);
      const newIdx = next.findIndex((p) => p.x === nx && p.y === ny);
      setCurrentCurve(state, next);
      state.selectedCurvePoint = { channel: ch, pointIdx: newIdx };
      dragIdx = newIdx;
      commit();
    });

    canvas.addEventListener('mousemove', (e) => {
      if (dragIdx < 0) return;
      const ch = currentChannel();
      const curve = getCurve(state, ch).slice();
      if (dragIdx >= curve.length) { dragIdx = -1; return; }
      let { cx, cy } = clientToFrac(e);
      cx = Math.max(0, Math.min(1, cx));
      cy = Math.max(0, Math.min(1, cy));
      if (state.colorCurvesSnapToGrid) {
        cx = snap1_8(cx);
        cy = snap1_8(cy);
      }
      // First and last points have x pinned at 0 / 1.
      if (dragIdx === 0) cx = 0;
      else if (dragIdx === curve.length - 1) cx = 1;
      else cx = clampToNeighbors(curve, dragIdx, cx);
      curve[dragIdx] = { x: cx, y: cy };
      setCurrentCurve(state, curve);
      state.selectedCurvePoint = { channel: ch, pointIdx: dragIdx };
      commit();
    });

    canvas.addEventListener('mouseup', () => {
      dragIdx = -1;
    });

    canvas.addEventListener('mouseleave', (e) => {
      if (dragIdx < 0) return;
      const rect = canvas.getBoundingClientRect();
      const outside =
        e.clientX < rect.left - 20 || e.clientX > rect.right + 20 ||
        e.clientY < rect.top - 20  || e.clientY > rect.bottom + 20;
      const ch = currentChannel();
      const curve = getCurve(state, ch).slice();
      if (outside && curve.length > MIN_POINTS && dragIdx > 0 && dragIdx < curve.length - 1) {
        curve.splice(dragIdx, 1);
        setCurrentCurve(state, curve);
        state.selectedCurvePoint = undefined;
        dragIdx = -1;
        commit();
      } else {
        dragIdx = -1;
      }
    });

    // ── Delete (button + Backspace/Delete key) ─────────────────────────
    function deleteSelected(): boolean {
      const sel = state.selectedCurvePoint;
      if (!sel) return false;
      const ch = currentChannel();
      if (sel.channel !== ch) return false;
      const curve = getCurve(state, ch).slice();
      if (curve.length <= MIN_POINTS) return false;
      if (sel.pointIdx < 0 || sel.pointIdx >= curve.length) return false;
      curve.splice(sel.pointIdx, 1);
      setCurrentCurve(state, curve);
      state.selectedCurvePoint = undefined;
      commit();
      return true;
    }

    deleteBtn.addEventListener('click', () => { deleteSelected(); });

    const keyHandler = (e: KeyboardEvent) => {
      // #384 — ignore keystrokes that originate in a text field. The In/Out
      // numeric fields are enabled exactly when a point is selected, so an
      // un-guarded Backspace here would splice the point instead of editing a
      // digit (and ArrowL/R would steal caret navigation).
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const sel = state.selectedCurvePoint;
      if (!sel) return;
      const ch = currentChannel();
      if (sel.channel !== ch) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (deleteSelected()) e.preventDefault();
        return;
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
        return;
      }
      const curve = getCurve(state, ch).slice();
      const idx = sel.pointIdx;
      if (idx < 0 || idx >= curve.length) return;
      const step = e.shiftKey ? 10 / 256 : 1 / 256;
      const pt = curve[idx]!;
      let x = pt.x;
      let y = pt.y;
      if (e.key === 'ArrowUp') y = Math.min(1, y + step);
      else if (e.key === 'ArrowDown') y = Math.max(0, y - step);
      else if (e.key === 'ArrowLeft') {
        if (idx === 0 || idx === curve.length - 1) return; // endpoints x is pinned
        x = clampToNeighbors(curve, idx, Math.max(0, x - step));
      } else if (e.key === 'ArrowRight') {
        if (idx === 0 || idx === curve.length - 1) return;
        x = clampToNeighbors(curve, idx, Math.min(1, x + step));
      }
      curve[idx] = { x, y };
      setCurrentCurve(state, curve);
      commit();
      e.preventDefault();
    };
    document.body.addEventListener('keydown', keyHandler);

    // ── Numeric in/out fields ──────────────────────────────────────────
    inField.addEventListener('change', () => {
      const sel = state.selectedCurvePoint;
      if (!sel) return;
      const ch = currentChannel();
      if (sel.channel !== ch) return;
      const curve = getCurve(state, ch).slice();
      const idx = sel.pointIdx;
      if (idx < 0 || idx >= curve.length) return;
      const raw = parseInt(inField.value, 10);
      if (Number.isNaN(raw)) { syncSelectionUI(); return; }
      const v = Math.max(0, Math.min(255, raw)) / 255;
      let x = v;
      if (idx === 0) x = 0;
      else if (idx === curve.length - 1) x = 1;
      else x = clampToNeighbors(curve, idx, x);
      curve[idx] = { x, y: curve[idx]!.y };
      setCurrentCurve(state, curve);
      commit();
    });

    outField.addEventListener('change', () => {
      const sel = state.selectedCurvePoint;
      if (!sel) return;
      const ch = currentChannel();
      if (sel.channel !== ch) return;
      const curve = getCurve(state, ch).slice();
      const idx = sel.pointIdx;
      if (idx < 0 || idx >= curve.length) return;
      const raw = parseInt(outField.value, 10);
      if (Number.isNaN(raw)) { syncSelectionUI(); return; }
      const y = Math.max(0, Math.min(255, raw)) / 255;
      curve[idx] = { x: curve[idx]!.x, y };
      setCurrentCurve(state, curve);
      commit();
    });

    // ── Reset-all (header) ─────────────────────────────────────────────
    resetAllBtn.addEventListener('click', () => {
      state.genome.channelCurves = undefined;
      state.selectedCurvePoint = undefined;
      onChange('channelCurves');
      redrawCanvas();
      syncSelectionUI();
    });

    // ── Reset-channel (footer) ─────────────────────────────────────────
    resetChannelBtn.addEventListener('click', () => {
      const ch = currentChannel();
      setCurrentCurve(state, clonePoints(IDENTITY_POINTS));
      state.selectedCurvePoint = undefined;
      onChange(`channelCurves.${ch}`);
      redrawCanvas();
      syncSelectionUI();
    });

    // ── Snap-to-grid toggle (footer) ───────────────────────────────────
    if (state.colorCurvesSnapToGrid) snapBtn.classList.add('active');
    snapBtn.addEventListener('click', () => {
      const next = !state.colorCurvesSnapToGrid;
      state.colorCurvesSnapToGrid = next;
      snapBtn.classList.toggle('active', next);
      applyBtnStyle(snapBtn, next ? 'active' : 'plain');
    });

    // ── Before/after hold (footer) ─────────────────────────────────────
    function setPreviewOff(off: boolean): void {
      if (state.colorCurvesPreviewOff === off) return;
      state.colorCurvesPreviewOff = off;
      onChange('channelCurves');
    }
    previewBtn.addEventListener('pointerdown', () => { setPreviewOff(true); });
    previewBtn.addEventListener('pointerup',   () => { setPreviewOff(false); });
    previewBtn.addEventListener('pointerleave',() => { setPreviewOff(false); });

    redrawCanvas();
    syncSelectionUI();

    // #300 — disposer: release the cross-DOM subscriptions this build()
    // registered. Without it, every panel rebuild (reroll/open/undo/setSize/
    // setQuality) leaked a fresh settledPixels listener (→ N redundant
    // binChannels/redraw per settle against detached canvases) and a stacked
    // document keydown handler (→ arrow-nudge moved a point N steps per press).
    return () => {
      const listeners = state.settledPixelsListeners;
      if (listeners) {
        const i = listeners.indexOf(onSettledPixels);
        if (i >= 0) listeners.splice(i, 1);
      }
      document.body.removeEventListener('keydown', keyHandler);
    };
  },
};

// #175 — draw one channel's normalized bins as a soft filled area from the
// canvas baseline up. x spans 0..w across the 256 bins; height scales by
// HIST_MAX_FILL so the tallest bin leaves headroom under the spline.
function drawHistFill(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  norm: Float32Array,
  rgb: string,
  alpha: number,
): void {
  ctx.fillStyle = `rgba(${rgb},${alpha})`;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const last = norm.length - 1;
  for (let i = 0; i < norm.length; i++) {
    const x = (i / last) * w;
    const y = h - norm[i]! * HIST_MAX_FILL * h;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  hist: ChannelHistogram,
  channel: Channel,
): void {
  // Log scale — a flame's vast black background spikes bin 0; linear scaling
  // would crush every mid-tone to invisibility. See normalizeBins.
  if (channel === 'composite') {
    // Overlay R+G+B at 30% each, normalized to a SHARED peak so the three
    // channels stay height-comparable.
    const peak = peakOf(hist.r, hist.g, hist.b);
    drawHistFill(ctx, w, h, normalizeBins(hist.r, peak, 'log'), HIST_COLORS.r, 0.30);
    drawHistFill(ctx, w, h, normalizeBins(hist.g, peak, 'log'), HIST_COLORS.g, 0.30);
    drawHistFill(ctx, w, h, normalizeBins(hist.b, peak, 'log'), HIST_COLORS.b, 0.30);
    return;
  }
  const bins =
    channel === 'r' ? hist.r : channel === 'g' ? hist.g : channel === 'b' ? hist.b : hist.luma;
  drawHistFill(ctx, w, h, normalizeBins(bins, undefined, 'log'), HIST_COLORS[channel], 0.42);
}

function drawCurveCanvas(
  canvas: HTMLCanvasElement,
  curve: CurvePoint[],
  hist: ChannelHistogram | null = null,
  channel: Channel = 'composite',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background grid (1/8 divisions).
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (i / 8) * w;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(w, p);
    ctx.stroke();
  }

  // Histogram fill UNDER the spline — the input-referred tonal reference.
  if (hist) drawHistogram(ctx, w, h, hist, channel);

  // Identity diagonal (bottom-left → top-right in screen coords).
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w, 0);
  ctx.stroke();

  // Catmull-Rom curve via the bake module — visually matches the GPU LUT.
  const lut = bakeOne(curve);
  ctx.strokeStyle = '#9cf';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 255; i++) {
    const px = (i / 255) * w;
    const py = (1 - lut[i]!) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Control points.
  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i]!;
    const px = pt.x * w;
    const py = (1 - pt.y) * h;
    ctx.fillStyle = '#9cf';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Expose internals for test access (avoids re-implementing the bake check).
export const __test = { drawCurveCanvas, presetLabel, PRESET_ORDER, CHANNELS };

// === EditState extensions consumed by this section (typed inline below) ===
declare module './edit-state' {
  interface EditState {
    /** Active channel tab in the Color Curves section. UI-only; never
     *  serialized. Default 'composite'. */
    activeColorCurveChannel?: 'composite' | 'r' | 'g' | 'b' | 'luma';
    /** Selected control point in the active channel curve. UI-only. */
    selectedCurvePoint?: { channel: 'composite' | 'r' | 'g' | 'b' | 'luma'; pointIdx: number };
    /** Hold-to-preview-off state for the 👁 button. UI-only. */
    colorCurvesPreviewOff?: boolean;
    /** Snap-to-grid toggle for the curve canvas. UI-only. */
    colorCurvesSnapToGrid?: boolean;
  }
}

// Re-export for downstream consumers (also informs type-checker that the
// ChannelCurves type from genome.ts is reachable from this surface).
export type { ChannelCurves };
