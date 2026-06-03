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

import { type SectionMount } from './edit-ui';
import {
  SPATIAL_FILTER_SHAPES,
  type SpatialFilter,
  type SpatialFilterShape,
} from './genome';

interface SizePreset {
  name: string;
  w: number;
  h: number;
}

const SIZE_PRESETS: readonly SizePreset[] = [
  { name: 'iPhone 15 Pro', w: 1290, h: 2796 },
  { name: 'iPad Pro', w: 2048, h: 2732 },
  { name: '1080p', w: 1920, h: 1080 },
  { name: '4K', w: 3840, h: 2160 },
  { name: 'Square', w: 2048, h: 2048 },
  { name: 'Custom', w: 0, h: 0 },
];

const CUSTOM_PRESET_NAME = 'Custom';

const DEFAULT_QUALITY = 100;
const DEFAULT_OVERSAMPLE = 1;
const DEFAULT_FILTER_RADIUS = 0.5;
const DEFAULT_FILTER_SHAPE: SpatialFilterShape = 'gaussian';

const OVERSAMPLE_OPTIONS: readonly number[] = [1, 2, 4];

function matchSizePreset(w: number, h: number): string {
  for (const p of SIZE_PRESETS) {
    if (p.name === CUSTOM_PRESET_NAME) continue;
    if (p.w === w && p.h === h) return p.name;
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

    // ── Size preset dropdown ────────────────────────────────────────────────
    const presetRow = document.createElement('div');
    presetRow.className = 'pyr3-edit-render-size-preset-row';
    presetRow.style.display = 'flex';
    presetRow.style.alignItems = 'center';
    presetRow.style.gap = '6px';

    const presetLabel = document.createElement('span');
    presetLabel.textContent = 'size';
    presetLabel.style.width = '70px';

    const presetSelect = document.createElement('select');
    presetSelect.className = 'pyr3-edit-render-size-preset';
    presetSelect.style.flex = '1 1 auto';
    for (const p of SIZE_PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      presetSelect.appendChild(opt);
    }

    presetRow.append(presetLabel, presetSelect);
    host.appendChild(presetRow);

    // ── W × H row ───────────────────────────────────────────────────────────
    const whRow = document.createElement('div');
    whRow.className = 'pyr3-edit-render-wh-row';
    whRow.style.display = 'flex';
    whRow.style.alignItems = 'center';
    whRow.style.gap = '6px';
    whRow.style.marginTop = '6px';

    const whLabel = document.createElement('span');
    whLabel.textContent = 'W × H';
    whLabel.style.width = '70px';

    const widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.min = '1';
    widthInput.step = '1';
    widthInput.className = 'pyr3-edit-render-width';
    widthInput.style.width = '80px';

    const xSep = document.createElement('span');
    xSep.textContent = '×';
    xSep.style.color = 'var(--text-dim, #888)';

    const heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.min = '1';
    heightInput.step = '1';
    heightInput.className = 'pyr3-edit-render-height';
    heightInput.style.width = '80px';

    whRow.append(whLabel, widthInput, xSep, heightInput);
    host.appendChild(whRow);

    // ── Quality row ─────────────────────────────────────────────────────────
    const qRow = document.createElement('div');
    qRow.className = 'pyr3-edit-render-quality-row';
    qRow.style.display = 'flex';
    qRow.style.alignItems = 'center';
    qRow.style.gap = '6px';
    qRow.style.marginTop = '6px';
    const qLabel = document.createElement('span');
    qLabel.textContent = 'quality';
    qLabel.style.width = '70px';
    const qualityInput = document.createElement('input');
    qualityInput.type = 'number';
    qualityInput.min = '1';
    qualityInput.step = '1';
    qualityInput.className = 'pyr3-edit-render-quality';
    qualityInput.style.width = '80px';
    qRow.append(qLabel, qualityInput);
    host.appendChild(qRow);

    // ── Oversample row ──────────────────────────────────────────────────────
    const osRow = document.createElement('div');
    osRow.className = 'pyr3-edit-render-oversample-row';
    osRow.style.display = 'flex';
    osRow.style.alignItems = 'center';
    osRow.style.gap = '6px';
    osRow.style.marginTop = '6px';
    const osLabel = document.createElement('span');
    osLabel.textContent = 'oversample';
    osLabel.style.width = '70px';
    const oversampleSelect = document.createElement('select');
    oversampleSelect.className = 'pyr3-edit-render-oversample';
    for (const n of OVERSAMPLE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = `${n}×`;
      oversampleSelect.appendChild(opt);
    }
    osRow.append(osLabel, oversampleSelect);
    host.appendChild(osRow);

    // ── Filter radius row ───────────────────────────────────────────────────
    const frRow = document.createElement('div');
    frRow.className = 'pyr3-edit-render-filter-radius-row';
    frRow.style.display = 'flex';
    frRow.style.alignItems = 'center';
    frRow.style.gap = '6px';
    frRow.style.marginTop = '6px';
    const frLabel = document.createElement('span');
    frLabel.textContent = 'filter rad';
    frLabel.style.width = '70px';
    const filterRadiusInput = document.createElement('input');
    filterRadiusInput.type = 'number';
    filterRadiusInput.min = '0';
    filterRadiusInput.step = '0.05';
    filterRadiusInput.className = 'pyr3-edit-render-filter-radius';
    filterRadiusInput.style.width = '80px';
    frRow.append(frLabel, filterRadiusInput);
    host.appendChild(frRow);

    // ── Filter shape row ────────────────────────────────────────────────────
    const fsRow = document.createElement('div');
    fsRow.className = 'pyr3-edit-render-filter-shape-row';
    fsRow.style.display = 'flex';
    fsRow.style.alignItems = 'center';
    fsRow.style.gap = '6px';
    fsRow.style.marginTop = '6px';
    const fsLabel = document.createElement('span');
    fsLabel.textContent = 'filter shape';
    fsLabel.style.width = '70px';
    const filterShapeSelect = document.createElement('select');
    filterShapeSelect.className = 'pyr3-edit-render-filter-shape';
    filterShapeSelect.style.flex = '1 1 auto';
    for (const s of SPATIAL_FILTER_SHAPES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      filterShapeSelect.appendChild(opt);
    }
    fsRow.append(fsLabel, filterShapeSelect);
    host.appendChild(fsRow);

    // ── Mutators ────────────────────────────────────────────────────────────

    function setSize(w: number, h: number): void {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
      const wi = Math.round(w);
      const hi = Math.round(h);
      state.genome.size = { width: wi, height: hi };
      widthInput.value = String(wi);
      heightInput.value = String(hi);
      presetSelect.value = matchSizePreset(wi, hi);
      onChange('size.width');
      onChange('size.height');
    }

    function setWidth(w: number): void {
      if (!Number.isFinite(w) || w <= 0) return;
      const wi = Math.round(w);
      const currentH = state.genome.size?.height ?? (Number(heightInput.value) || wi);
      state.genome.size = { width: wi, height: currentH };
      presetSelect.value = matchSizePreset(wi, currentH);
      onChange('size.width');
    }

    function setHeight(h: number): void {
      if (!Number.isFinite(h) || h <= 0) return;
      const hi = Math.round(h);
      const currentW = state.genome.size?.width ?? (Number(widthInput.value) || hi);
      state.genome.size = { width: currentW, height: hi };
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

    // ── Wire events ─────────────────────────────────────────────────────────
    presetSelect.addEventListener('change', () => {
      const name = presetSelect.value;
      if (name === CUSTOM_PRESET_NAME) return;
      const preset = SIZE_PRESETS.find((p) => p.name === name);
      if (!preset) return;
      setSize(preset.w, preset.h);
    });

    widthInput.addEventListener('input', () => {
      const n = Number(widthInput.value);
      if (Number.isFinite(n)) setWidth(n);
    });
    heightInput.addEventListener('input', () => {
      const n = Number(heightInput.value);
      if (Number.isFinite(n)) setHeight(n);
    });
    qualityInput.addEventListener('input', () => {
      const n = Number(qualityInput.value);
      if (Number.isFinite(n)) setQuality(n);
    });
    oversampleSelect.addEventListener('change', () => {
      const n = Number(oversampleSelect.value);
      if (Number.isFinite(n)) setOversample(n);
    });
    filterRadiusInput.addEventListener('input', () => {
      const n = Number(filterRadiusInput.value);
      if (Number.isFinite(n)) setFilterRadius(n);
    });
    filterShapeSelect.addEventListener('change', () => {
      const v = filterShapeSelect.value as SpatialFilterShape;
      setFilterShape(v);
    });

    // ── Initial render ──────────────────────────────────────────────────────
    const initW = state.genome.size?.width ?? 0;
    const initH = state.genome.size?.height ?? 0;
    widthInput.value = String(initW);
    heightInput.value = String(initH);
    presetSelect.value = initW > 0 && initH > 0 ? matchSizePreset(initW, initH) : CUSTOM_PRESET_NAME;

    qualityInput.value = String(state.genome.quality ?? DEFAULT_QUALITY);
    oversampleSelect.value = String(state.genome.oversample ?? DEFAULT_OVERSAMPLE);
    filterRadiusInput.value = String(state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS);
    filterShapeSelect.value = state.genome.spatialFilter?.shape ?? DEFAULT_FILTER_SHAPE;
  },
};
