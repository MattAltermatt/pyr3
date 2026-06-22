// pyr3 — /editor render-config section.
//
// #176 (2026-06-07): Size + W × H + Quality MOVED to the shared render-mode-bar
// (`src/render-mode-bar.ts`) that mounts above the canvas in both viewer +
// editor. This section now hosts only the deeper-tuning knobs: **oversample**
// and **spatial filter** (radius + shape). A subtitle redirects users
// looking for size/quality to the bar.
//
// onChange paths (post-#176):
//   - oversample → rebuild
//   - spatialFilter.radius → rebuild
//   - spatialFilter.shape → fast (no lane match; pathLane defaults to fast)

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
} from './edit-primitives';
import { infoIcon } from './help-text';

const DEFAULT_OVERSAMPLE = 1;
const DEFAULT_FILTER_RADIUS = 0.5;
const DEFAULT_FILTER_SHAPE: SpatialFilterShape = 'gaussian';

const OVERSAMPLE_OPTIONS: readonly number[] = [1, 2, 4];

export const renderSection: SectionMount = {
  key: 'render',
  lens: 'output',
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

    // ── subtitle: redirect to the render-mode-bar (#176) ────────────────────
    const subtitle = document.createElement('div');
    subtitle.className = 'pyr3-edit-section-render__subtitle';
    subtitle.textContent =
      'Output quality — see size & render quality on the bar above.';
    host.appendChild(subtitle);

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
    osRow.querySelector('.pyr3-ctrl')?.appendChild(infoIcon('render.oversample'));
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
    frRow.querySelector('.pyr3-ctrl')?.appendChild(infoIcon('render.filterRadius'));
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
    fsRow.querySelector('.pyr3-ctrl')?.appendChild(infoIcon('render.filterShape'));
    host.appendChild(fsRow);

    // ── mutators ────────────────────────────────────────────────────────────

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
    oversampleSelect.value = String(state.genome.oversample ?? DEFAULT_OVERSAMPLE);
    filterRadiusRes.handle.setValue(state.genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS);
    filterShapeSelect.value = state.genome.spatialFilter?.shape ?? DEFAULT_FILTER_SHAPE;
  },
};
