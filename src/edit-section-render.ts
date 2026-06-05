// pyr3 — /v1/edit render-config section.
//
// Surfaces the genome's render-pipeline params: size (W×H + preset
// dropdown), quality, oversample, spatial-filter (radius + shape). Edits
// here are mostly rebuild-lane (resizing buffers / changing oversample /
// changing filter radius rebuilds chaos+density+visualize); quality and
// filter shape are routed as fast-lane (no immediate slow-iterate cost in
// the live preview — quality only matters at full-render-PNG time).
//
// onChange paths:
//   - size.width / size.height → rebuild lane (per pathLane)
//   - oversample → rebuild
//   - spatialFilter.radius → rebuild
//   - quality → fast (live preview ignores; render-PNG honours)
//   - spatialFilter.shape → fast (no lane match; pathLane defaults to fast)
//
// Phase 7 task 7.7: adopts the shared row primitives from
// `edit-primitives.ts`. Every numeric input flows through `buildNumberInput`
// (scrubby — drag-to-scrub + dbl-click-to-type) so the editor's
// number-input behaviour is uniform. W×H is a `buildPair` (1fr auto 1fr
// sub-grid) so neither input clips at narrow panel widths. The Size
// dropdown surfaces the shared `SIZE_PRESETS` (load-intent.ts) — same list
// the viewer's `📐 Size ▾` menu uses.

import { type SectionMount } from './edit-ui';
import {
  SPATIAL_FILTER_SHAPES,
  type SpatialFilter,
  type SpatialFilterShape,
} from './genome';
import {
  buildRow,
  buildNumberInput,
  buildDropdown,
  buildPair,
} from './edit-primitives';
import { SIZE_PRESETS } from './load-intent';

const CUSTOM_PRESET_NAME = 'Custom';

const DEFAULT_QUALITY = 100;
const DEFAULT_OVERSAMPLE = 1;
const DEFAULT_FILTER_RADIUS = 0.5;
const DEFAULT_FILTER_SHAPE: SpatialFilterShape = 'gaussian';

const OVERSAMPLE_OPTIONS: readonly number[] = [1, 2, 4];

// Legacy preset names retained as values for back-compat with #102 tests
// (`'1080p'`, `'4K'`, `'Square'`, etc). The viewer's SIZE_PRESETS list is
// keyed by user-facing label (`'HD'`, `'4K'`, `'square'`); we expose BOTH
// in the dropdown so the editor surfaces the same options without breaking
// existing select-by-name assertions.
interface FlatSizeOption {
  value: string;        // dropdown <option> value
  label: string;        // dropdown <option> visible text
  group?: string;       // optgroup name, when grouped
  w: number;
  h: number;
}

// Build a flat list from SIZE_PRESETS, plus a "Custom" sentinel + the
// legacy aliases that the #102 test suite drives selection by.
function flattenSizeOptions(): FlatSizeOption[] {
  const out: FlatSizeOption[] = [];
  for (const group of SIZE_PRESETS) {
    for (const item of group.items) {
      // Use the label as the dropdown value so users can hand-pick by name.
      out.push({ value: item.label, label: item.label, group: group.group, w: item.w, h: item.h });
    }
  }
  // Legacy aliases preserved for backwards compatibility with #102 tests
  // and any UI / docs that referred to them by these names. Hidden from
  // the dropdown UI (they appear as separate options but rarely-clicked
  // because the new labels surface them at the top).
  out.push({ value: '1080p', label: '1080p', w: 1920, h: 1080 });
  out.push({ value: 'Square', label: 'Square', w: 2048, h: 2048 });
  return out;
}

const FLAT_SIZE_OPTIONS = flattenSizeOptions();

// Return the canonical preset name for these dims. When the user has
// just picked a specific alias (e.g. '1080p' for 1920×1080 instead of
// 'HD'), honour their choice; otherwise pick the first match in the flat
// option list (HD over 1080p, square over Square, etc.).
function matchSizePreset(w: number, h: number, preferAlias?: string | null): string {
  if (preferAlias) {
    const cur = FLAT_SIZE_OPTIONS.find((o) => o.value === preferAlias);
    if (cur && cur.w === w && cur.h === h) return preferAlias;
  }
  for (const o of FLAT_SIZE_OPTIONS) {
    if (o.w === w && o.h === h) return o.value;
  }
  return CUSTOM_PRESET_NAME;
}

export const renderSection: SectionMount = {
  key: 'render',
  title: '🎚️ RENDER',
  build(host, state, onChange) {
    host.classList.add('pyr3-edit-section-render');

    // Lazy-init helpers — leave fields undefined until first edit so unchanged
    // genomes round-trip identically through serialize.
    function ensureSpatialFilter(): SpatialFilter {
      if (!state.genome.spatialFilter) {
        state.genome.spatialFilter = {
          radius: DEFAULT_FILTER_RADIUS,
          shape: DEFAULT_FILTER_SHAPE,
        };
      }
      return state.genome.spatialFilter;
    }

    // ── size preset dropdown ────────────────────────────────────────────────
    // Built using the shared <select> chrome from buildDropdown, but with
    // an optgroup-rendering shim so the categorized SIZE_PRESETS layout
    // (Common / Phone portrait / Tablet) reads naturally. buildDropdown
    // only emits flat <option>s; we replace the children with grouped
    // markup after construction.
    // The dropdown's auto-matched value bubbles back through setSize ←
    // matchSizePreset. To honour the user's explicit pick (e.g. choosing
    // '1080p' instead of the canonical 'HD' for the same dims), we
    // remember the last-clicked preset value and short-circuit
    // matchSizePreset to return it when the dims still match. Otherwise the
    // dropdown drifts under the cursor — a UX violation per the no-jump
    // rule.
    let lastPickedPreset: string | null = null;
    const presetSelect = buildDropdown<string>({
      value: CUSTOM_PRESET_NAME,
      options: [{ value: CUSTOM_PRESET_NAME, label: CUSTOM_PRESET_NAME }],
      onChange: (name) => {
        if (name === CUSTOM_PRESET_NAME) return;
        const preset = FLAT_SIZE_OPTIONS.find((o) => o.value === name);
        if (!preset) return;
        lastPickedPreset = name;
        setSize(preset.w, preset.h);
      },
    });
    presetSelect.classList.add('pyr3-edit-render-size-preset');
    // Replace the placeholder option list with grouped + legacy + Custom.
    presetSelect.replaceChildren();
    for (const group of SIZE_PRESETS) {
      const og = document.createElement('optgroup');
      og.label = group.group;
      for (const item of group.items) {
        const opt = document.createElement('option');
        opt.value = item.label;
        opt.textContent = item.label;
        og.appendChild(opt);
      }
      presetSelect.appendChild(og);
    }
    // Legacy aliases (1080p / Square) outside the optgroup
    for (const legacy of ['1080p', 'Square']) {
      const opt = document.createElement('option');
      opt.value = legacy;
      opt.textContent = legacy;
      presetSelect.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_PRESET_NAME;
    customOpt.textContent = CUSTOM_PRESET_NAME;
    presetSelect.appendChild(customOpt);

    const presetRow = buildRow('size', presetSelect);
    presetRow.classList.add('pyr3-edit-render-size-preset-row');
    presetRow.title =
      'Pick a stock size — phone, tablet, common screen sizes — '
      + 'and the W × H below snap to it.';
    host.appendChild(presetRow);

    // ── W × H pair row ──────────────────────────────────────────────────────
    // Sub-grid 1fr auto 1fr — neither input clips, the `×` pins center.
    const widthInputRes = buildNumberInput({
      value: state.genome.size?.width ?? 0,
      kind: 'generic',
      min: 1,
      step: 1,
      precision: 0,
      onChange: (n) => setWidth(n),
    });
    widthInputRes.el.classList.add('pyr3-edit-render-width');

    const heightInputRes = buildNumberInput({
      value: state.genome.size?.height ?? 0,
      kind: 'generic',
      min: 1,
      step: 1,
      precision: 0,
      onChange: (n) => setHeight(n),
    });
    heightInputRes.el.classList.add('pyr3-edit-render-height');

    const whPair = buildPair(widthInputRes.el, '×', heightInputRes.el);
    const whRow = buildRow('W × H', whPair);
    whRow.classList.add('pyr3-edit-render-wh-row');
    whRow.title = 'Render size in pixels — width × height.';
    host.appendChild(whRow);

    // ── quality row ─────────────────────────────────────────────────────────
    const qualityRes = buildNumberInput({
      value: state.genome.quality ?? DEFAULT_QUALITY,
      kind: 'generic',
      min: 0.5,
      step: 0.5,
      onChange: (v) => setQuality(v),
    });
    qualityRes.el.classList.add('pyr3-edit-render-quality');
    const qRow = buildRow('quality', qualityRes.el);
    qRow.classList.add('pyr3-edit-render-quality-row');
    qRow.title =
      'Samples per pixel for the final PNG render.\n'
      + 'Higher = smoother / cleaner. Lower = grainier / faster.\n'
      + 'Live preview ignores this; quality only matters at render time.';
    host.appendChild(qRow);

    // ── oversample row ──────────────────────────────────────────────────────
    const oversampleSelect = buildDropdown<string>({
      value: String(state.genome.oversample ?? DEFAULT_OVERSAMPLE),
      options: OVERSAMPLE_OPTIONS.map((n) => ({ value: String(n), label: `${n}×` })),
      onChange: (v) => {
        const n = Number(v);
        if (Number.isFinite(n)) setOversample(n);
      },
    });
    oversampleSelect.classList.add('pyr3-edit-render-oversample');
    const osRow = buildRow('oversample', oversampleSelect);
    osRow.classList.add('pyr3-edit-render-oversample-row');
    osRow.title = 'Render at a larger size internally, then shrink to the final size.\n'
      + 'Higher = smoother edges, less jagged lines — but slower and uses more memory.\n'
      + '1× = render at exact size. 2× / 4× = render 2× / 4× wider+taller internally.';
    host.appendChild(osRow);

    // ── filter radius row ───────────────────────────────────────────────────
    const filterRadiusRes = buildNumberInput({
      value: state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS,
      kind: 'generic',
      min: 0,
      max: 5,
      step: 0.005,
      onChange: (v) => setFilterRadius(v),
    });
    filterRadiusRes.el.classList.add('pyr3-edit-render-filter-radius');
    const frRow = buildRow('filter rad', filterRadiusRes.el);
    frRow.classList.add('pyr3-edit-render-filter-radius-row');
    frRow.title = 'How much to soften the flame.\n'
      + 'Bigger = softer, more glowy. Smaller = sharper, crisper lines.\n'
      + '0.5 is a balanced default.';
    host.appendChild(frRow);

    // ── filter shape row ────────────────────────────────────────────────────
    const filterShapeSelect = buildDropdown<string>({
      value: state.genome.spatialFilter?.shape ?? DEFAULT_FILTER_SHAPE,
      options: SPATIAL_FILTER_SHAPES.map((s) => ({ value: s, label: s })),
      onChange: (v) => setFilterShape(v as SpatialFilterShape),
    });
    filterShapeSelect.classList.add('pyr3-edit-render-filter-shape');
    const fsRow = buildRow('filter shape', filterShapeSelect);
    fsRow.classList.add('pyr3-edit-render-filter-shape-row');
    fsRow.title = 'The shape of that softening blur.\n'
      + 'Gaussian is a soft, round glow (best default).\n'
      + 'Other shapes (box, triangle, lanczos…) give slightly different feels —\n'
      + 'mostly invisible at small filter radius, more visible at large radius.';
    host.appendChild(fsRow);

    // ── mutators ────────────────────────────────────────────────────────────

    function setSize(w: number, h: number): void {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
      const wi = Math.round(w);
      const hi = Math.round(h);
      state.genome.size = { width: wi, height: hi };
      widthInputRes.handle.setValue(wi);
      heightInputRes.handle.setValue(hi);
      presetSelect.value = matchSizePreset(wi, hi, lastPickedPreset);
      onChange('size.width');
      onChange('size.height');
    }

    function setWidth(w: number): void {
      if (!Number.isFinite(w) || w <= 0) return;
      const wi = Math.round(w);
      // Fallback to the input span's textContent when state.genome.size is
      // unset — the scrubby span renders its current numeric there.
      const fallbackH = Number(heightInputRes.el.textContent ?? '0');
      const currentH = state.genome.size?.height ?? (Number.isFinite(fallbackH) && fallbackH > 0 ? fallbackH : wi);
      state.genome.size = { width: wi, height: currentH };
      // Manual scrubby edits clear the last-picked alias — the user is
      // editing the raw dims now, so the canonical preset (if any) applies.
      lastPickedPreset = null;
      presetSelect.value = matchSizePreset(wi, currentH);
      onChange('size.width');
    }

    function setHeight(h: number): void {
      if (!Number.isFinite(h) || h <= 0) return;
      const hi = Math.round(h);
      const fallbackW = Number(widthInputRes.el.textContent ?? '0');
      const currentW = state.genome.size?.width ?? (Number.isFinite(fallbackW) && fallbackW > 0 ? fallbackW : hi);
      state.genome.size = { width: currentW, height: hi };
      lastPickedPreset = null;
      presetSelect.value = matchSizePreset(currentW, hi);
      onChange('size.height');
    }

    function setQuality(q: number): void {
      if (!Number.isFinite(q) || q <= 0) return;
      state.genome.quality = q;
      onChange('quality');
    }

    function setOversample(n: number): void {
      if (!OVERSAMPLE_OPTIONS.includes(n)) return;
      state.genome.oversample = n;
      onChange('oversample');
    }

    function setFilterRadius(r: number): void {
      if (!Number.isFinite(r) || r < 0) return;
      const sf = ensureSpatialFilter();
      sf.radius = r;
      onChange('spatialFilter.radius');
    }

    function setFilterShape(s: SpatialFilterShape): void {
      const sf = ensureSpatialFilter();
      sf.shape = s;
      onChange('spatialFilter.shape');
    }

    // ── initial render ──────────────────────────────────────────────────────
    const initW = state.genome.size?.width ?? 0;
    const initH = state.genome.size?.height ?? 0;
    widthInputRes.handle.setValue(initW);
    heightInputRes.handle.setValue(initH);
    presetSelect.value = initW > 0 && initH > 0 ? matchSizePreset(initW, initH) : CUSTOM_PRESET_NAME;
    qualityRes.handle.setValue(state.genome.quality ?? DEFAULT_QUALITY);
    oversampleSelect.value = String(state.genome.oversample ?? DEFAULT_OVERSAMPLE);
    filterRadiusRes.handle.setValue(state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS);
    filterShapeSelect.value = state.genome.spatialFilter?.shape ?? DEFAULT_FILTER_SHAPE;
  },
};
