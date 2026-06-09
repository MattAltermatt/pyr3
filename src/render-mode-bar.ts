// #176 Task 3 — shared render-mode bar.
//
// Mounted into both the editor (/v1/edit) and viewer (/v1). Splits the screen
// (preview) vs output (render) concerns into two side-by-side panels:
//
//   PREVIEW (left, cool-tinted)
//     - tier pill: Fast / Balanced / Sharp (default Balanced)
//     - 5 quality buttons: 10 20 30 40 50 (default 25, off-ladder)
//
//   RENDER (right, warm-tinted)
//     - size dropdown (SIZE_PRESETS) + W × H number inputs
//     - 4 quality buttons: 50 75 100 200 (default 100)
//     - quality text input (1..200; > 200 toasts + clamps)
//     - 💾 Save Render button (disabled when canSave() is false)
//
// The bar reads + writes the host's state through opts getters/setters; it
// owns no engine state directly. CSS is deferred to Task 8 — Tests assert
// behavior via data-* hooks (data-tier, data-preview-q, data-render-q,
// data-render-w, data-render-h, data-render-q-input, data-render-preset,
// data-render-preset-label, data-save-render, data-side).
//
// All dynamic strings flow through textContent / createElement — no innerHTML
// with untrusted content.

import { SIZE_PRESETS } from './load-intent';
import {
  type PreviewRenderConfig,
  type PreviewTier,
  savePreviewConfig,
} from './render-mode-config';
import { getCapability } from './capability';

const PREVIEW_QUALITY_LADDER = [10, 20, 30, 40, 50] as const;
const RENDER_QUALITY_LADDER = [50, 75, 100, 200] as const;
const RENDER_QUALITY_MIN = 1;
const OVER_CAP_TOAST_MSG =
  'Higher quality renders run faster offline via the pyr3 CLI binary. Capped at 200 here.';
/** Historical browser-only ceiling. When `pyr3 serve` lifts the hard
 *  cap, anything past this still warrants a heads-up toast. */
const SOFT_WARN_THRESHOLD = 200;
const softWarnMsg = (q: number) => `Backend render — q=${q} may take minutes.`;

/** Effective render-quality ceiling for the current host. `null` means
 *  unlimited (a `pyr3 serve` backend can run any value); a number means
 *  the slider clamps there. Read off the memoized capability so the
 *  value is consistent across UI repaints. */
function effectiveMax(): number | null {
  return getCapability().max_quality;
}

const TIERS: ReadonlyArray<{ id: PreviewTier; label: string }> = [
  { id: 'fast', label: 'Fast' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'sharp', label: 'Sharp' },
];

export interface RenderModeBarOpts {
  host: HTMLElement;
  getPreviewConfig(): PreviewRenderConfig;
  setPreviewConfig(cfg: PreviewRenderConfig): void;
  getRenderSize(): { width: number; height: number };
  setRenderSize(size: { width: number; height: number }): void;
  getRenderQuality(): number;
  setRenderQuality(q: number): void;
  onSaveRender(): Promise<void>;
  canSave(): boolean;
  showToast?(message: string): void;
  onChange?(): void;
}

export interface RenderModeBarHandle {
  /** Set the render size to a named SIZE_PRESETS entry (e.g. "HD", "4K"). */
  setRenderSizePreset(name: string): void;
  /** Re-read all getters and re-paint values + highlights + disabled state. */
  refresh(): void;
  /** Tear down DOM. Idempotent. */
  destroy(): void;
}

interface PresetEntry {
  label: string;
  w: number;
  h: number;
}

function flattenPresets(): PresetEntry[] {
  const out: PresetEntry[] = [];
  for (const g of SIZE_PRESETS) {
    for (const it of g.items) out.push({ label: it.label, w: it.w, h: it.h });
  }
  return out;
}

function matchPresetLabel(size: { width: number; height: number }): string | null {
  for (const e of flattenPresets()) {
    if (e.w === size.width && e.h === size.height) return e.label;
  }
  return null;
}

function clampRenderQuality(q: number): {
  value: number;
  capped: boolean;
  softWarn: boolean;
} {
  if (!Number.isFinite(q)) return { value: RENDER_QUALITY_MIN, capped: false, softWarn: false };
  const r = Math.round(q);
  if (r < RENDER_QUALITY_MIN) return { value: RENDER_QUALITY_MIN, capped: false, softWarn: false };
  const max = effectiveMax();
  if (max != null && r > max) return { value: max, capped: true, softWarn: false };
  // Unlimited mode: don't clamp, but warn once the user crosses the
  // historical browser ceiling — high q on dawn-node is fine but slow.
  const softWarn = max == null && r > SOFT_WARN_THRESHOLD;
  return { value: r, capped: false, softWarn };
}

export function mountRenderModeBar(opts: RenderModeBarOpts): RenderModeBarHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-render-mode-bar';

  // ── PREVIEW side ────────────────────────────────────────────────────────
  const previewSide = document.createElement('div');
  previewSide.className = 'pyr3-render-mode-bar-preview';
  previewSide.dataset['side'] = 'preview';

  const previewLabel = document.createElement('span');
  previewLabel.className = 'pyr3-render-mode-bar-side-label';
  previewLabel.textContent = 'PREVIEW';
  previewSide.appendChild(previewLabel);

  // Tier pill
  const tierGroup = document.createElement('div');
  tierGroup.className = 'pyr3-render-mode-bar-tier-group';
  const tierButtons = new Map<PreviewTier, HTMLButtonElement>();
  for (const t of TIERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pyr3-render-mode-bar-tier';
    btn.dataset['tier'] = t.id;
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      const cur = opts.getPreviewConfig();
      const next: PreviewRenderConfig = { ...cur, tier: t.id };
      opts.setPreviewConfig(next);
      savePreviewConfig(next);
      paintPreview();
      opts.onChange?.();
    });
    tierGroup.appendChild(btn);
    tierButtons.set(t.id, btn);
  }
  previewSide.appendChild(tierGroup);

  // Preview quality
  const previewQGroup = document.createElement('div');
  previewQGroup.className = 'pyr3-render-mode-bar-preview-q-group';
  const previewQButtons = new Map<number, HTMLButtonElement>();
  for (const q of PREVIEW_QUALITY_LADDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pyr3-render-mode-bar-preview-q';
    btn.dataset['previewQ'] = String(q);
    btn.textContent = String(q);
    btn.addEventListener('click', () => {
      const cur = opts.getPreviewConfig();
      const next: PreviewRenderConfig = { ...cur, quality: q };
      opts.setPreviewConfig(next);
      savePreviewConfig(next);
      paintPreview();
      opts.onChange?.();
    });
    previewQGroup.appendChild(btn);
    previewQButtons.set(q, btn);
  }
  previewSide.appendChild(previewQGroup);

  // ── RENDER side ─────────────────────────────────────────────────────────
  const renderSide = document.createElement('div');
  renderSide.className = 'pyr3-render-mode-bar-render';
  renderSide.dataset['side'] = 'render';

  const renderLabel = document.createElement('span');
  renderLabel.className = 'pyr3-render-mode-bar-side-label';
  renderLabel.textContent = 'RENDER';
  renderSide.appendChild(renderLabel);

  // Size preset dropdown
  const presetSelect = document.createElement('select');
  presetSelect.dataset['renderPreset'] = '';
  presetSelect.className = 'pyr3-render-mode-bar-preset';

  // "Custom" sentinel option, always present so the select can land on it
  // when the size doesn't match a preset.
  const customOption = document.createElement('option');
  customOption.value = '__custom__';
  customOption.textContent = 'Custom';
  presetSelect.appendChild(customOption);

  for (const g of SIZE_PRESETS) {
    const og = document.createElement('optgroup');
    og.label = g.group;
    for (const it of g.items) {
      const o = document.createElement('option');
      o.value = `${it.w}x${it.h}`;
      o.textContent = it.label;
      og.appendChild(o);
    }
    presetSelect.appendChild(og);
  }

  presetSelect.addEventListener('change', () => {
    const v = presetSelect.value;
    if (v === '__custom__') return;
    const m = /^(\d+)x(\d+)$/.exec(v);
    if (!m) return;
    const next = { width: Number(m[1]), height: Number(m[2]) };
    opts.setRenderSize(next);
    paintRender();
    opts.onChange?.();
  });
  renderSide.appendChild(presetSelect);

  // Preset label mirror — visible text used by the design's "📐 [preset] ▾"
  // pill; tests assert against this element when checking the Custom
  // transition. Kept in sync with the <select>'s current option label so
  // either surface works for downstream styling.
  const presetLabel = document.createElement('span');
  presetLabel.dataset['renderPresetLabel'] = '';
  presetLabel.className = 'pyr3-render-mode-bar-preset-label';
  renderSide.appendChild(presetLabel);

  // W input
  const wInput = document.createElement('input');
  wInput.type = 'number';
  wInput.dataset['renderW'] = '';
  wInput.className = 'pyr3-render-mode-bar-w';
  const wHandler = () => {
    const v = Math.max(1, Math.round(Number(wInput.value) || 0));
    const cur = opts.getRenderSize();
    if (v !== cur.width) {
      opts.setRenderSize({ width: v, height: cur.height });
      paintRender({ markCustomIfNoMatch: true });
      opts.onChange?.();
    }
  };
  wInput.addEventListener('input', wHandler);
  wInput.addEventListener('change', wHandler);
  renderSide.appendChild(wInput);

  const xLabel = document.createElement('span');
  xLabel.textContent = '×';
  xLabel.className = 'pyr3-render-mode-bar-x';
  renderSide.appendChild(xLabel);

  // H input
  const hInput = document.createElement('input');
  hInput.type = 'number';
  hInput.dataset['renderH'] = '';
  hInput.className = 'pyr3-render-mode-bar-h';
  const hHandler = () => {
    const v = Math.max(1, Math.round(Number(hInput.value) || 0));
    const cur = opts.getRenderSize();
    if (v !== cur.height) {
      opts.setRenderSize({ width: cur.width, height: v });
      paintRender({ markCustomIfNoMatch: true });
      opts.onChange?.();
    }
  };
  hInput.addEventListener('input', hHandler);
  hInput.addEventListener('change', hHandler);
  renderSide.appendChild(hInput);

  // Render quality buttons
  const renderQGroup = document.createElement('div');
  renderQGroup.className = 'pyr3-render-mode-bar-render-q-group';
  const renderQButtons = new Map<number, HTMLButtonElement>();
  for (const q of RENDER_QUALITY_LADDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pyr3-render-mode-bar-render-q';
    btn.dataset['renderQ'] = String(q);
    btn.textContent = String(q);
    btn.addEventListener('click', () => {
      opts.setRenderQuality(q);
      qInput.value = String(q);
      paintRenderQ();
      opts.onChange?.();
    });
    renderQGroup.appendChild(btn);
    renderQButtons.set(q, btn);
  }
  renderSide.appendChild(renderQGroup);

  // Render quality text input
  const qInput = document.createElement('input');
  qInput.type = 'number';
  qInput.min = String(RENDER_QUALITY_MIN);
  {
    // Set max attr only when the host imposes one — otherwise the input
    // would refuse values > 200 even under `pyr3 serve` (unlimited).
    const mountMax = effectiveMax();
    if (mountMax != null) qInput.max = String(mountMax);
  }
  qInput.dataset['renderQInput'] = '';
  qInput.className = 'pyr3-render-mode-bar-q-input';
  const qHandler = () => {
    const raw = Number(qInput.value);
    const { value, capped, softWarn } = clampRenderQuality(raw);
    opts.setRenderQuality(value);
    if (capped) {
      qInput.value = String(value);
      opts.showToast?.(OVER_CAP_TOAST_MSG);
    } else if (softWarn) {
      opts.showToast?.(softWarnMsg(value));
    }
    paintRenderQ();
    opts.onChange?.();
  };
  qInput.addEventListener('input', qHandler);
  qInput.addEventListener('change', qHandler);
  renderSide.appendChild(qInput);

  // Save Render button
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.dataset['saveRender'] = '';
  saveBtn.className = 'pyr3-render-mode-bar-save';
  saveBtn.textContent = '💾 Save Render';
  saveBtn.addEventListener('click', () => {
    if (saveBtn.disabled) return;
    void opts.onSaveRender();
  });
  renderSide.appendChild(saveBtn);

  // ── assemble ────────────────────────────────────────────────────────────
  root.appendChild(previewSide);
  const divider = document.createElement('div');
  divider.className = 'pyr3-render-mode-bar-divider';
  root.appendChild(divider);
  root.appendChild(renderSide);
  opts.host.appendChild(root);

  // ── paint helpers ───────────────────────────────────────────────────────
  function paintPreview(): void {
    const cfg = opts.getPreviewConfig();
    for (const [id, btn] of tierButtons) {
      btn.classList.toggle('on', id === cfg.tier);
    }
    for (const [q, btn] of previewQButtons) {
      btn.classList.toggle('on', q === cfg.quality);
    }
  }

  function paintRenderQ(): void {
    const q = opts.getRenderQuality();
    for (const [v, btn] of renderQButtons) {
      btn.classList.toggle('on', v === q);
    }
    // Mirror into the text input only when the field isn't currently focused
    // so user typing doesn't get clobbered mid-edit.
    if (document.activeElement !== qInput) qInput.value = String(q);
  }

  function paintRender(o: { markCustomIfNoMatch?: boolean } = {}): void {
    const size = opts.getRenderSize();
    if (document.activeElement !== wInput) wInput.value = String(size.width);
    if (document.activeElement !== hInput) hInput.value = String(size.height);
    const presetName = matchPresetLabel(size);
    if (presetName) {
      presetSelect.value = `${size.width}x${size.height}`;
      presetLabel.textContent = presetName;
    } else {
      // Land on the Custom sentinel.
      presetSelect.value = '__custom__';
      presetLabel.textContent = 'Custom';
      void o; // explicit-marker arg reserved for future "only mark on user-edit" semantics
    }
    paintRenderQ();
    saveBtn.disabled = !opts.canSave();
  }

  // Initial paint
  paintPreview();
  paintRender();

  return {
    setRenderSizePreset(name: string): void {
      for (const e of flattenPresets()) {
        if (e.label === name) {
          opts.setRenderSize({ width: e.w, height: e.h });
          paintRender();
          opts.onChange?.();
          return;
        }
      }
    },
    refresh(): void {
      paintPreview();
      paintRender();
    },
    destroy(): void {
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
