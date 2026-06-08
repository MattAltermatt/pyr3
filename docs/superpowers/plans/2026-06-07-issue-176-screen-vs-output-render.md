# #176 — Split screen render vs output render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split pyr3's live preview render from its on-demand Save Render so picking 4K no longer slows down the editor; surface both configs side-by-side on a shared bar mounted in viewer + editor.

**Architecture:** Two configs — `PreviewRenderConfig` (workstation pref, localStorage) on the left; `OutputRenderConfig` (genome.size/quality/oversample/filterRadius — unchanged shape) on the right. Aspect ratio locked to render; preview tier (Fast/Balanced/Sharp) picks scale only. New shared component `src/render-mode-bar.ts` mounts in both surfaces below the existing chrome.

**Tech Stack:** TypeScript + WebGPU + Vite. Vitest unit suite. Chrome via `chrome-devtools-mcp` for eyeball verify.

**Spec:** `docs/superpowers/specs/2026-06-07-issue-176-screen-vs-output-render-design.md`

**Branch:** `feature/issue-176-screen-vs-output-render` (already created)

**Follow-ups filed:** #177 (saved render presets), #178 (pyr3 doc-refresh), #179 (reframe fork-it badge).

---

## Task 1: `render-mode-config.ts` module

The foundation — types, defaults, dim computation, localStorage layer. Standalone, no other code touched.

**Files:**
- Create: `src/render-mode-config.ts`
- Test: `src/render-mode-config.test.ts`

- [ ] **Step 1: Write `render-mode-config.test.ts` failing tests**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_PREVIEW_CONFIG,
  PREVIEW_TIER_LONGEST_EDGE,
  computePreviewDims,
  loadPreviewConfig,
  savePreviewConfig,
} from './render-mode-config';

describe('DEFAULT_PREVIEW_CONFIG', () => {
  it('tier=balanced quality=25', () => {
    expect(DEFAULT_PREVIEW_CONFIG).toEqual({ tier: 'balanced', quality: 25 });
  });
});

describe('PREVIEW_TIER_LONGEST_EDGE', () => {
  it('maps tiers to caps', () => {
    expect(PREVIEW_TIER_LONGEST_EDGE).toEqual({ fast: 512, balanced: 1024, sharp: 1536 });
  });
});

describe('computePreviewDims', () => {
  it('landscape render at balanced — caps long edge to 1024', () => {
    const dims = computePreviewDims('balanced', { width: 3840, height: 2160 });
    expect(dims.width).toBe(1024);
    expect(dims.height).toBe(576); // 2160 * (1024/3840)
  });
  it('portrait render at balanced — caps long edge (height) to 1024', () => {
    const dims = computePreviewDims('balanced', { width: 1290, height: 2796 });
    expect(dims.height).toBe(1024);
    expect(dims.width).toBe(473); // 1290 * (1024/2796) rounded
  });
  it('square render at sharp — caps to 1536', () => {
    const dims = computePreviewDims('sharp', { width: 4096, height: 4096 });
    expect(dims).toEqual({ width: 1536, height: 1536 });
  });
  it('render smaller than tier cap — returns render dims unchanged', () => {
    const dims = computePreviewDims('balanced', { width: 800, height: 600 });
    expect(dims).toEqual({ width: 800, height: 600 });
  });
  it('fast tier — caps to 512', () => {
    const dims = computePreviewDims('fast', { width: 3840, height: 2160 });
    expect(dims.width).toBe(512);
    expect(dims.height).toBe(288);
  });
});

describe('loadPreviewConfig', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('missing key → DEFAULT_PREVIEW_CONFIG', () => {
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });
  it('malformed JSON → DEFAULT_PREVIEW_CONFIG', () => {
    globalThis.localStorage.setItem('pyr3-preview-config', 'not json');
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });
  it('_v mismatch → DEFAULT_PREVIEW_CONFIG', () => {
    globalThis.localStorage.setItem('pyr3-preview-config',
      JSON.stringify({ tier: 'fast', quality: 10, _v: 999 }));
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });
  it('well-formed → returns the stored config', () => {
    globalThis.localStorage.setItem('pyr3-preview-config',
      JSON.stringify({ tier: 'sharp', quality: 50, _v: 1 }));
    expect(loadPreviewConfig()).toEqual({ tier: 'sharp', quality: 50 });
  });
  it('invalid tier value → DEFAULT', () => {
    globalThis.localStorage.setItem('pyr3-preview-config',
      JSON.stringify({ tier: 'turbo', quality: 50, _v: 1 }));
    expect(loadPreviewConfig()).toEqual(DEFAULT_PREVIEW_CONFIG);
  });
  it('quality out of [10,50] range → clamps', () => {
    globalThis.localStorage.setItem('pyr3-preview-config',
      JSON.stringify({ tier: 'fast', quality: 100, _v: 1 }));
    expect(loadPreviewConfig()).toEqual({ tier: 'fast', quality: 50 });
  });
});

describe('savePreviewConfig', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('writes to localStorage with _v bump', () => {
    savePreviewConfig({ tier: 'fast', quality: 30 });
    const raw = globalThis.localStorage.getItem('pyr3-preview-config');
    expect(JSON.parse(raw!)).toEqual({ tier: 'fast', quality: 30, _v: 1 });
  });
  it('round-trips with loadPreviewConfig', () => {
    savePreviewConfig({ tier: 'sharp', quality: 40 });
    expect(loadPreviewConfig()).toEqual({ tier: 'sharp', quality: 40 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/render-mode-config.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `render-mode-config.ts`**

```ts
// src/render-mode-config.ts
//
// Workstation-pref-shaped preview render config. Persists to localStorage
// per-browser per-origin. The renderer's preview-side dims derive from this
// config + the render-side aspect (genome.size).
//
// Separate from genome.size / genome.quality (render-side, on the genome).

export type PreviewTier = 'fast' | 'balanced' | 'sharp';

export interface PreviewRenderConfig {
  tier: PreviewTier;
  quality: number; // clamped to [10, 50]
}

export const DEFAULT_PREVIEW_CONFIG: PreviewRenderConfig = {
  tier: 'balanced',
  quality: 25,
};

export const PREVIEW_TIER_LONGEST_EDGE: Record<PreviewTier, number> = {
  fast: 512,
  balanced: 1024,
  sharp: 1536,
};

const STORAGE_KEY = 'pyr3-preview-config';
const SCHEMA_VERSION = 1;

const VALID_TIERS: ReadonlyArray<PreviewTier> = ['fast', 'balanced', 'sharp'];

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return DEFAULT_PREVIEW_CONFIG.quality;
  return Math.max(10, Math.min(50, Math.round(q)));
}

export function computePreviewDims(
  tier: PreviewTier,
  renderSize: { width: number; height: number },
): { width: number; height: number } {
  const w = Math.max(1, Math.floor(renderSize.width));
  const h = Math.max(1, Math.floor(renderSize.height));
  const longEdge = Math.max(w, h);
  const cap = PREVIEW_TIER_LONGEST_EDGE[tier];
  if (longEdge <= cap) return { width: w, height: h };
  const scale = cap / longEdge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export function loadPreviewConfig(): PreviewRenderConfig {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREVIEW_CONFIG;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREVIEW_CONFIG;
    if (parsed._v !== SCHEMA_VERSION) return DEFAULT_PREVIEW_CONFIG;
    if (!VALID_TIERS.includes(parsed.tier)) return DEFAULT_PREVIEW_CONFIG;
    return { tier: parsed.tier, quality: clampQuality(parsed.quality) };
  } catch (err) {
    console.warn('pyr3: loadPreviewConfig failed; falling back to defaults', err);
    return DEFAULT_PREVIEW_CONFIG;
  }
}

export function savePreviewConfig(cfg: PreviewRenderConfig): void {
  try {
    const payload = { tier: cfg.tier, quality: clampQuality(cfg.quality), _v: SCHEMA_VERSION };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('pyr3: savePreviewConfig failed (localStorage full?)', err);
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/render-mode-config.test.ts && npm run typecheck`
Expected: PASS (all tests green, typecheck clean).

- [ ] **Step 5: Commit**

```bash
git add src/render-mode-config.ts src/render-mode-config.test.ts
git commit -m "feat(#176): render-mode-config — PreviewRenderConfig + localStorage layer"
```

---

## Task 2: `edit-render.ts` engine seam refactor

The `fullRender` flow gains `AbortSignal` + `onProgress`. The lane scheduler gains `haltOnTargetDensity` capability. Preview canvas dim resolver is exposed (used in Task 5 by edit-mount).

**Files:**
- Modify: `src/edit-render.ts` — extend `EditRenderer` interface, signature changes
- Test: `src/edit-render.test.ts` — new tests for AbortSignal + onProgress; halt-on-target

- [ ] **Step 1: Read the current `edit-render.ts`**

Read: `src/edit-render.ts` lines 1–250 (full file)

- [ ] **Step 2: Write failing tests in `src/edit-render.test.ts`**

Add to existing test file (extend, don't replace):

```ts
describe('fullRender with AbortSignal + onProgress', () => {
  it('reports progress via onProgress callback during render', async () => {
    const r = makeMockRenderer(); // existing helper or new
    const renderer = createEditRenderer(r, mockBuffers());
    const progressUpdates: number[] = [];
    await renderer.fullRender(
      mockGenome(), mockSeed(), mockOutputView(), 256, 256,
      { onProgress: (frac) => progressUpdates.push(frac) },
    );
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates.at(-1)).toBeCloseTo(1.0, 2);
    progressUpdates.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    progressUpdates.forEach((p) => expect(p).toBeLessThanOrEqual(1));
  });

  it('AbortSignal bails out cleanly mid-render', async () => {
    const r = makeMockRenderer();
    const renderer = createEditRenderer(r, mockBuffers());
    const ctrl = new AbortController();
    let progressCount = 0;
    const promise = renderer.fullRender(
      mockGenome(), mockSeed(), mockOutputView(), 256, 256,
      {
        signal: ctrl.signal,
        onProgress: (frac) => {
          progressCount += 1;
          if (frac >= 0.3) ctrl.abort();
        },
      },
    );
    await expect(promise).rejects.toThrow(/aborted/i);
    expect(progressCount).toBeGreaterThan(0);
  });
});

describe('lane scheduler halt-on-target density', () => {
  it('stops dispatching once target density reached', async () => {
    const r = makeMockRenderer();
    const renderer = createEditRenderer(r, mockBuffers());
    const genome = mockGenome();
    // Apply lane "fast" with targetDensity=25; iterate; verify stop after target
    const dispatches: number[] = [];
    r.onDispatch = (n) => dispatches.push(n);
    renderer.applyLane('fast', genome, mockSeed(), mockOutputView(), 256, 256, {
      targetDensity: 25,
    });
    // Iterate manually for a few frames
    for (let i = 0; i < 20; i++) {
      await renderer.tickPreview(); // NEW method on EditRenderer
    }
    expect(renderer.isPreviewIdle()).toBe(true); // NEW method
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `npx vitest run src/edit-render.test.ts`
Expected: FAIL — `onProgress`, `signal`, `targetDensity`, `tickPreview`, `isPreviewIdle` don't exist yet.

- [ ] **Step 4: Extend `EditRenderer` interface + implementation**

```ts
// In src/edit-render.ts (extend existing interface)

export interface FullRenderOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;  // [0..1]
}

export interface ApplyLaneOptions {
  targetDensity?: number;  // halt iter once mean histogram density ≥ this
}

export interface EditRenderer {
  applyLane(
    lane: Lane,
    genome: Genome,
    seed: number,
    outputView: GPUTextureView,
    superW: number,
    superH: number,
    opts?: ApplyLaneOptions,
  ): void;

  fullRender(
    genome: Genome,
    seed: number,
    outputView: GPUTextureView,
    superW: number,
    superH: number,
    opts?: FullRenderOptions,
  ): Promise<void>;

  fullRenderAt(
    genome: Genome,
    seed: number,
    width: number,
    height: number,
    outputView: GPUTextureView,
    opts?: FullRenderOptions,
  ): Promise<void>;

  // NEW — preview lane introspection
  tickPreview(): Promise<void>;
  isPreviewIdle(): boolean;
  getCurrentPreviewDensity(): number;
}
```

Implementation notes (inside `createEditRenderer`):

```ts
// Track preview lane state
let previewTargetDensity: number | null = null;
let previewIdle = false;
let previewCurrentDensity = 0;

// applyLane gains: if opts.targetDensity, store + reset idle flag
// tickPreview: if !previewIdle, dispatch one iter batch, update density;
//              if density >= target → previewIdle = true
// isPreviewIdle: return previewIdle
// getCurrentPreviewDensity: return previewCurrentDensity

// fullRender / fullRenderAt: chunk the iteration into N batches
// (e.g., target iters / 16 = batch size); after each batch:
//   - check opts.signal?.aborted → throw new Error('Render aborted')
//   - call opts.onProgress?.(dispatched / target)
// Use the existing reseed + iterate primitives; just loop instead of one-shot.
```

Helpful: density = `cumulative_samples / (width × height)`. Already tracked in `lastSamples`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/edit-render.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run the full test suite to catch regressions**

Run: `npm test`
Expected: All passing — no regressions in the existing lane-scheduler tests, color-curves tests, etc.

- [ ] **Step 7: Commit**

```bash
git add src/edit-render.ts src/edit-render.test.ts
git commit -m "feat(#176): edit-render — fullRender AbortSignal + onProgress + lane halt-on-target"
```

---

## Task 3: `render-mode-bar.ts` shared component

The new DOM component. Mounted in both viewer + editor by Tasks 5 + 6. Pure DOM + state; no host coupling beyond the callback interface.

**Files:**
- Create: `src/render-mode-bar.ts`
- Create: `src/render-mode-bar.css` (or co-locate into existing style sheet — check existing pattern)
- Test: `src/render-mode-bar.test.ts`

- [ ] **Step 1: Check CSS pattern**

Run: `ls src/*.css 2>/dev/null; grep -l "pyr3-edit-bar\|edit-section" src/*.ts | head -5`
Decide: create new `render-mode-bar.css` if other components have their own CSS files; else add to whatever shared stylesheet exists.

- [ ] **Step 2: Write failing tests**

```ts
// src/render-mode-bar.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountRenderModeBar, type RenderModeBarOpts } from './render-mode-bar';
import { DEFAULT_PREVIEW_CONFIG } from './render-mode-config';

function makeOpts(): RenderModeBarOpts {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let previewCfg = { ...DEFAULT_PREVIEW_CONFIG };
  const renderState = {
    size: { width: 3840, height: 2160 },
    quality: 100,
  };
  return {
    host,
    getPreviewConfig: () => previewCfg,
    setPreviewConfig: (c) => { previewCfg = c; },
    getRenderSize: () => renderState.size,
    setRenderSize: (s) => { renderState.size = s; },
    getRenderQuality: () => renderState.quality,
    setRenderQuality: (q) => { renderState.quality = q; },
    onSaveRender: () => Promise.resolve(),
    canSave: () => true,
  };
}

beforeEach(() => { document.body.innerHTML = ''; globalThis.localStorage.clear(); });

describe('mountRenderModeBar', () => {
  it('renders both PREVIEW and RENDER sides', () => {
    const opts = makeOpts();
    mountRenderModeBar(opts);
    expect(opts.host.querySelector('[data-side="preview"]')).toBeTruthy();
    expect(opts.host.querySelector('[data-side="render"]')).toBeTruthy();
  });

  it('preview tier pill — clicking Fast updates config + persists', () => {
    const opts = makeOpts();
    mountRenderModeBar(opts);
    const fastBtn = opts.host.querySelector<HTMLButtonElement>('[data-tier="fast"]')!;
    fastBtn.click();
    expect(opts.getPreviewConfig().tier).toBe('fast');
    const stored = globalThis.localStorage.getItem('pyr3-preview-config');
    expect(JSON.parse(stored!).tier).toBe('fast');
  });

  it('preview quality buttons — clicking 30 sets quality to 30', () => {
    const opts = makeOpts();
    mountRenderModeBar(opts);
    const q30 = opts.host.querySelector<HTMLButtonElement>('[data-preview-q="30"]')!;
    q30.click();
    expect(opts.getPreviewConfig().quality).toBe(30);
  });

  it('render size dropdown — picking "4K" sets size to 3840×2160 + W/H inputs', () => {
    const opts = makeOpts();
    const handle = mountRenderModeBar(opts);
    handle.setRenderSizePreset('4K');
    expect(opts.getRenderSize()).toEqual({ width: 3840, height: 2160 });
    const wInput = opts.host.querySelector<HTMLInputElement>('[data-render-w]')!;
    expect(wInput.value).toBe('3840');
  });

  it('typing into render W input → updates size + dropdown shows "Custom"', () => {
    const opts = makeOpts();
    mountRenderModeBar(opts);
    const wInput = opts.host.querySelector<HTMLInputElement>('[data-render-w]')!;
    wInput.value = '3000';
    wInput.dispatchEvent(new Event('change'));
    expect(opts.getRenderSize().width).toBe(3000);
    const presetLabel = opts.host.querySelector<HTMLElement>('[data-render-preset-label]')!;
    expect(presetLabel.textContent).toMatch(/custom/i);
  });

  it('render quality buttons — clicking 200 sets quality to 200', () => {
    const opts = makeOpts();
    mountRenderModeBar(opts);
    const q200 = opts.host.querySelector<HTMLButtonElement>('[data-render-q="200"]')!;
    q200.click();
    expect(opts.getRenderQuality()).toBe(200);
  });

  it('render quality text input — typing 250 stores 250', () => {
    const opts = makeOpts();
    mountRenderModeBar(opts);
    const qInput = opts.host.querySelector<HTMLInputElement>('[data-render-q-input]')!;
    qInput.value = '250';
    qInput.dispatchEvent(new Event('change'));
    expect(opts.getRenderQuality()).toBe(250);
  });

  it('render quality > 500 clamps to 500 + shows toast', () => {
    const opts = makeOpts();
    const toasts: string[] = [];
    mountRenderModeBar({ ...opts, showToast: (msg) => toasts.push(msg) });
    const qInput = opts.host.querySelector<HTMLInputElement>('[data-render-q-input]')!;
    qInput.value = '999';
    qInput.dispatchEvent(new Event('change'));
    expect(opts.getRenderQuality()).toBe(500);
    expect(toasts.some((t) => /CLI/i.test(t))).toBe(true);
  });

  it('Save Render button disabled when canSave returns false', () => {
    const opts = makeOpts();
    mountRenderModeBar({ ...opts, canSave: () => false });
    const btn = opts.host.querySelector<HTMLButtonElement>('[data-save-render]')!;
    expect(btn.disabled).toBe(true);
  });

  it('Save Render button fires onSaveRender', async () => {
    let fired = false;
    const opts = makeOpts();
    mountRenderModeBar({ ...opts, onSaveRender: async () => { fired = true; } });
    const btn = opts.host.querySelector<HTMLButtonElement>('[data-save-render]')!;
    btn.click();
    await Promise.resolve();
    expect(fired).toBe(true);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `npx vitest run src/render-mode-bar.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `render-mode-bar.ts`**

Key shape (full body in implementation):

```ts
// src/render-mode-bar.ts
import {
  type PreviewRenderConfig,
  type PreviewTier,
  loadPreviewConfig,
  savePreviewConfig,
} from './render-mode-config';
import { SIZE_PRESETS } from './load-intent';

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
  /** Called whenever the bar's state mutates (so the host can sync any
   *  outside-the-bar UI: e.g., re-iterate preview after a tier change). */
  onChange?(): void;
}

export interface RenderModeBarHandle {
  setRenderSizePreset(name: string): void;
  refresh(): void;   // re-read getters, re-paint
  destroy(): void;
}

const PREVIEW_TIERS: ReadonlyArray<PreviewTier> = ['fast', 'balanced', 'sharp'];
const PREVIEW_TIER_LABEL: Record<PreviewTier, string> = {
  fast: 'Fast', balanced: 'Balanced', sharp: 'Sharp',
};
const PREVIEW_QUALITY_STEPS = [10, 20, 30, 40, 50] as const;
const RENDER_QUALITY_STEPS = [50, 75, 100, 150, 200] as const;
const RENDER_QUALITY_HARD_CAP = 500;
const RENDER_QUALITY_OVER_CAP_MSG =
  'Higher quality renders run faster offline via the pyr3 CLI binary. Capped at 500 here.';

export function mountRenderModeBar(opts: RenderModeBarOpts): RenderModeBarHandle {
  const root = document.createElement('div');
  root.className = 'pyr3-render-mode-bar';

  const previewSide = buildPreviewSide(opts);   // helper
  const separator = document.createElement('div');
  separator.className = 'pyr3-render-mode-bar__sep';
  const renderSide = buildRenderSide(opts);     // helper

  previewSide.root.setAttribute('data-side', 'preview');
  renderSide.root.setAttribute('data-side', 'render');

  root.append(previewSide.root, separator, renderSide.root);
  opts.host.appendChild(root);

  return {
    setRenderSizePreset(name) {
      const flat = flattenSizePresets();
      const preset = flat.find((p) => p.label === name);
      if (!preset) return;
      opts.setRenderSize({ width: preset.w, height: preset.h });
      renderSide.refresh();
      opts.onChange?.();
    },
    refresh() {
      previewSide.refresh();
      renderSide.refresh();
    },
    destroy() { root.remove(); },
  };
}

// --- helpers (full body in implementation) ---

function buildPreviewSide(opts: RenderModeBarOpts) {
  // Build: label "PREVIEW", tier pill (3 buttons),
  //        quality buttons (10/20/30/40/50, NO text input)
  // On tier click → savePreviewConfig + opts.setPreviewConfig + opts.onChange
  // On quality click → same
  // refresh() → re-paint based on opts.getPreviewConfig()
  // (Detailed code omitted for brevity in the plan — straightforward DOM)
}

function buildRenderSide(opts: RenderModeBarOpts) {
  // Build: label "RENDER", size dropdown (SIZE_PRESETS),
  //        W input (data-render-w), × label, H input (data-render-h),
  //        quality buttons (50/75/100/150/200),
  //        quality text input (data-render-q-input, plain, no scrubby),
  //        💾 Save Render button (data-save-render)
  // Dropdown pick → setRenderSize(preset.w, preset.h) + W/H inputs sync
  // W/H typing → setRenderSize(...) + dropdown label becomes "Custom"
  // Quality buttons → setRenderQuality(value)
  // Quality input → parseInt, clamp [1, 500]:
  //   if user-typed > 500 → showToast(OVER_CAP_MSG) + clamp to 500
  // Save button → opts.onSaveRender(); disable when !canSave() OR mid-render
}

function flattenSizePresets() {
  return SIZE_PRESETS.flatMap((g) =>
    g.items.map((it) => ({ ...it, group: g.group }))
  );
}
```

CSS:

```css
/* src/render-mode-bar.css */
.pyr3-render-mode-bar {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 12px;
  gap: 12px;
  background: var(--pyr3-chrome-bg, #1a1a1a);
  border-bottom: 1px solid var(--pyr3-chrome-border, #2c2c2c);
  font-size: 12px;
  user-select: none;
}
.pyr3-render-mode-bar [data-side="preview"] {
  display: flex; gap: 8px; align-items: center;
  flex: 1;
  background: linear-gradient(90deg, rgba(70, 140, 200, 0.06), transparent);
  padding: 4px 8px; border-radius: 4px;
}
.pyr3-render-mode-bar [data-side="render"] {
  display: flex; gap: 8px; align-items: center;
  flex: 1.4;  /* render side is wider — more widgets */
  background: linear-gradient(90deg, rgba(220, 130, 50, 0.06), transparent);
  padding: 4px 8px; border-radius: 4px;
}
.pyr3-render-mode-bar__sep {
  width: 1px; height: 32px;
  background: var(--pyr3-chrome-divider, #444);
}
.pyr3-render-mode-bar [data-tier], .pyr3-render-mode-bar [data-preview-q], .pyr3-render-mode-bar [data-render-q] {
  /* segmented button base */
  background: transparent;
  border: 1px solid var(--pyr3-chrome-border, #333);
  color: var(--pyr3-chrome-fg, #ccc);
  padding: 4px 10px;
  cursor: pointer;
}
.pyr3-render-mode-bar [data-tier].on, .pyr3-render-mode-bar [data-preview-q].on, .pyr3-render-mode-bar [data-render-q].on {
  background: var(--pyr3-accent, #ff8c00);
  color: #000;
  border-color: var(--pyr3-accent, #ff8c00);
}
.pyr3-render-mode-bar [data-save-render] {
  background: var(--pyr3-accent, #ff8c00);
  color: #000;
  border: none;
  padding: 6px 16px;
  font-weight: 600;
  cursor: pointer;
}
.pyr3-render-mode-bar [data-save-render]:disabled {
  opacity: 0.4; cursor: not-allowed;
}
```

(Implementation may co-locate CSS into existing stylesheet — check pattern.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/render-mode-bar.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render-mode-bar.ts src/render-mode-bar.test.ts src/render-mode-bar.css
git commit -m "feat(#176): render-mode-bar shared component (DOM + tests)"
```

---

## Task 4: Render progress modal + post-save toast

Reusable modal for "rendering N%, [Cancel]" + toast helper. Both surfaces (viewer + editor) consume this.

**Files:**
- Create: `src/render-progress-modal.ts`
- Create: `src/post-save-toast.ts` (or extend existing toast helper if one exists)
- Test: `src/render-progress-modal.test.ts`

- [ ] **Step 1: Find existing toast helper**

Run: `grep -rn "showToast\|toast" src/*.ts | grep -v test | grep -v "render-mode" | head -10`
If a `showToast(host, msg)` helper exists (it does — `panelHost` calls in edit-mount.ts), reuse it. Otherwise create one.

- [ ] **Step 2: Write failing tests**

```ts
// src/render-progress-modal.test.ts
import { describe, it, expect } from 'vitest';
import { openRenderProgressModal } from './render-progress-modal';

describe('openRenderProgressModal', () => {
  it('mounts the modal DOM immediately (before any render dispatch)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openRenderProgressModal({
      host,
      sizeLabel: '4K',
      qualityLabel: '100',
      onCancel: () => {},
    });
    expect(host.querySelector('[data-render-progress-modal]')).toBeTruthy();
    handle.close();
  });

  it('setProgress updates the % display', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openRenderProgressModal({
      host, sizeLabel: '4K', qualityLabel: '100', onCancel: () => {},
    });
    handle.setProgress(0.42);
    const pct = host.querySelector('[data-progress-pct]');
    expect(pct?.textContent).toBe('42 %');
    handle.close();
  });

  it('cancel button fires onCancel', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let cancelled = false;
    const handle = openRenderProgressModal({
      host, sizeLabel: '4K', qualityLabel: '100', onCancel: () => { cancelled = true; },
    });
    const btn = host.querySelector<HTMLButtonElement>('[data-cancel]')!;
    btn.click();
    expect(cancelled).toBe(true);
    handle.close();
  });

  it('close() removes the modal DOM', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = openRenderProgressModal({
      host, sizeLabel: '4K', qualityLabel: '100', onCancel: () => {},
    });
    handle.close();
    expect(host.querySelector('[data-render-progress-modal]')).toBeFalsy();
  });
});
```

- [ ] **Step 3: Implement `render-progress-modal.ts`**

```ts
// src/render-progress-modal.ts
export interface RenderProgressModalOpts {
  host: HTMLElement;
  sizeLabel: string;     // e.g., "4K"
  qualityLabel: string;  // e.g., "100"
  onCancel(): void;
}

export interface RenderProgressModalHandle {
  setProgress(fraction: number): void;   // 0..1
  close(): void;
}

export function openRenderProgressModal(
  opts: RenderProgressModalOpts,
): RenderProgressModalHandle {
  const modal = document.createElement('div');
  modal.setAttribute('data-render-progress-modal', '');
  modal.className = 'pyr3-render-progress-modal';

  const title = document.createElement('div');
  title.textContent = `Rendering — ${opts.sizeLabel} · Q ${opts.qualityLabel}`;
  title.className = 'pyr3-render-progress-modal__title';

  const bar = document.createElement('div');
  bar.className = 'pyr3-render-progress-modal__bar';
  const fill = document.createElement('div');
  fill.className = 'pyr3-render-progress-modal__fill';
  fill.setAttribute('data-progress-fill', '');
  fill.style.width = '0%';
  bar.appendChild(fill);

  const pct = document.createElement('div');
  pct.setAttribute('data-progress-pct', '');
  pct.className = 'pyr3-render-progress-modal__pct';
  pct.textContent = '0 %';

  const cancel = document.createElement('button');
  cancel.setAttribute('data-cancel', '');
  cancel.className = 'pyr3-render-progress-modal__cancel';
  cancel.textContent = '✕ Cancel';
  cancel.addEventListener('click', () => opts.onCancel());

  modal.append(title, bar, pct, cancel);
  opts.host.appendChild(modal);

  return {
    setProgress(f) {
      const clamped = Math.max(0, Math.min(1, f));
      fill.style.width = `${(clamped * 100).toFixed(0)}%`;
      pct.textContent = `${Math.round(clamped * 100)} %`;
    },
    close() { modal.remove(); },
  };
}
```

CSS (add to existing or new):

```css
.pyr3-render-progress-modal {
  position: fixed; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  z-index: 1000;
  font-size: 14px; color: #ddd;
  gap: 12px;
}
.pyr3-render-progress-modal__bar {
  width: 320px; height: 12px;
  background: #222; border-radius: 6px; overflow: hidden;
}
.pyr3-render-progress-modal__fill {
  height: 100%; background: var(--pyr3-accent, #ff8c00);
  transition: width 120ms linear;
}
.pyr3-render-progress-modal__cancel {
  background: transparent; color: #ddd;
  border: 1px solid #555; padding: 4px 12px; cursor: pointer;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/render-progress-modal.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render-progress-modal.ts src/render-progress-modal.test.ts
# + CSS file if separate
git commit -m "feat(#176): render-progress-modal + cancel button"
```

---

## Task 5: Editor integration

Mount the bar in `edit-mount.ts`; strip Size/Quality/W×H from `edit-section-render.ts`; wire Save Render flow through the new modal; preview canvas now reads from `computePreviewDims`.

**Files:**
- Modify: `src/edit-mount.ts` — mount bar; preview canvas dim resolver; render-PNG flow
- Modify: `src/edit-section-render.ts` — strip Size/Quality/W×H widgets; add subtitle
- Modify: `src/edit-mount.test.ts` — extend with bar-mount + render-PNG tests
- Modify: `src/edit-section-render.test.ts` — assert moved widgets are absent + subtitle present

- [ ] **Step 1: Read both files**

Read: `src/edit-mount.ts` (full file) + `src/edit-section-render.ts` (full file).

- [ ] **Step 2: Write failing tests in `edit-mount.test.ts`**

```ts
describe('mountEditPage — render-mode-bar integration', () => {
  it('mounts the bar in the editor host', async () => {
    const host = await mountTestEditor();
    expect(host.querySelector('.pyr3-render-mode-bar')).toBeTruthy();
  });

  it('changing render Size does NOT resize the editor canvas immediately', async () => {
    const host = await mountTestEditor();
    const canvas = host.querySelector('canvas')!;
    const initialDims = { w: canvas.width, h: canvas.height };
    // Pick "4K" via the bar
    host.querySelector<HTMLButtonElement>('[data-render-preset="4K"]')?.click();
    // Canvas should NOT be 3840×2160; should still be a preview dim
    expect(canvas.width).toBeLessThanOrEqual(1536); // any preview tier cap
    expect(canvas.height).toBeLessThanOrEqual(1536);
  });

  it('changing preview tier reshapes the canvas to render aspect', async () => {
    const host = await mountTestEditor({ initialRenderSize: { width: 3840, height: 2160 } });
    const canvas = host.querySelector('canvas')!;
    host.querySelector<HTMLButtonElement>('[data-tier="fast"]')?.click();
    // Fast = 512 long edge; aspect = 16:9 → canvas should be 512×288
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(288);
  });
});

describe('mountEditPage — Save Render via the bar', () => {
  it('opens the progress modal BEFORE dispatching first render iter', async () => {
    const host = await mountTestEditor();
    const dispatched: number[] = [];
    /* hook into mock renderer's onDispatch */
    host.querySelector<HTMLButtonElement>('[data-save-render]')?.click();
    // After one microtask: modal should be in DOM, NO dispatch yet
    await Promise.resolve();
    expect(document.querySelector('[data-render-progress-modal]')).toBeTruthy();
    expect(dispatched.length).toBe(0);
    // After rAF: dispatch begins
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(dispatched.length).toBeGreaterThan(0);
  });

  it('cancel button bails the render + closes modal', async () => {
    const host = await mountTestEditor();
    host.querySelector<HTMLButtonElement>('[data-save-render]')?.click();
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>('[data-cancel]')?.click();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-render-progress-modal]')).toBeFalsy();
  });
});
```

- [ ] **Step 3: Write failing tests in `edit-section-render.test.ts`**

Add assertions: after the move, the Render section panel does NOT contain Size dropdown, W × H inputs, or Quality scrubby. It DOES contain the subtitle "Output quality — see size & render quality on the bar above" and the oversample + spatial-filter widgets.

```ts
it('Render section no longer contains Size dropdown', () => {
  const host = mountTestRenderSection();
  expect(host.querySelector('[data-size-dropdown]')).toBeFalsy();
});

it('Render section no longer contains W × H inputs', () => {
  const host = mountTestRenderSection();
  expect(host.querySelector('[data-w-input]')).toBeFalsy();
  expect(host.querySelector('[data-h-input]')).toBeFalsy();
});

it('Render section no longer contains Quality scrubby', () => {
  const host = mountTestRenderSection();
  expect(host.querySelector('[data-quality-scrubby]')).toBeFalsy();
});

it('Render section shows the bar-redirect subtitle', () => {
  const host = mountTestRenderSection();
  expect(host.textContent).toMatch(/see size & render quality on the bar above/i);
});

it('Render section still contains Oversample dropdown', () => {
  const host = mountTestRenderSection();
  expect(host.querySelector('[data-oversample]')).toBeTruthy();
});

it('Render section still contains Spatial filter widgets', () => {
  const host = mountTestRenderSection();
  expect(host.querySelector('[data-filter-radius]')).toBeTruthy();
});
```

- [ ] **Step 4: Run failing tests**

Run: `npx vitest run src/edit-mount.test.ts src/edit-section-render.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement the editor wiring**

In `src/edit-mount.ts`:

a. Import `mountRenderModeBar`, `loadPreviewConfig`, `savePreviewConfig`, `computePreviewDims`.

b. At mount time (early in `mountEditPage`):

```ts
let previewCfg = loadPreviewConfig();

// Replace the dim resolver around lines 218-225:
function resolveCanvasDims() {
  return computePreviewDims(previewCfg.tier, state.genome.size ?? { width: 1024, height: 1024 });
}
// (Use resolveCanvasDims() everywhere the editor previously read genome.size for canvas dims.)
```

c. Mount the bar above the canvas:

```ts
const barHost = document.createElement('div');
canvas.parentElement!.insertBefore(barHost, canvas);
const barHandle = mountRenderModeBar({
  host: barHost,
  getPreviewConfig: () => previewCfg,
  setPreviewConfig: (cfg) => {
    previewCfg = cfg;
    savePreviewConfig(cfg);
    rescheduleCanvasDimsAndReiterate();
  },
  getRenderSize: () => state.genome.size ?? { width: 1024, height: 1024 },
  setRenderSize: (size) => {
    state.genome.size = size;
    onPathChange(); // existing funnel — drives history + persist + lane reschedule
    rescheduleCanvasDimsAndReiterate(); // aspect may have changed → preview reshape
  },
  getRenderQuality: () => state.genome.quality ?? DEFAULT_QUALITY,
  setRenderQuality: (q) => {
    state.genome.quality = q;
    onPathChange();
  },
  onSaveRender: async () => {
    await runSaveRender(); // new helper, below
  },
  canSave: () => !state.renderInFlight,
  showToast: (msg) => showToast(panelHost, msg),
});
```

d. New `runSaveRender()` helper (replaces the existing render-PNG flow):

```ts
async function runSaveRender() {
  state.renderInFlight = true;
  const sizeLabel = matchSizePreset(state.genome.size!.width, state.genome.size!.height) ?? 'Custom';
  const qualityLabel = String(state.genome.quality ?? DEFAULT_QUALITY);

  const ctrl = new AbortController();
  const modal = openRenderProgressModal({
    host: document.body,
    sizeLabel, qualityLabel,
    onCancel: () => ctrl.abort(),
  });

  // CRITICAL — rAF yield so modal is painted BEFORE GPU saturates
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  try {
    const restoreDims = { width: canvas.width, height: canvas.height,
                          oversample: renderer.oversample,
                          filterRadius: renderer.filterRadius };

    // Resize canvas to genome.size × oversample
    canvas.width = state.genome.size!.width * (state.genome.oversample ?? 1);
    canvas.height = state.genome.size!.height * (state.genome.oversample ?? 1);
    renderer.resize({ width: state.genome.size!.width, height: state.genome.size!.height,
                      oversample: state.genome.oversample ?? 1,
                      filterRadius: state.genome.filterRadius });

    const outputView = ctx.getCurrentTexture().createView();
    await editRenderer.fullRenderAt(
      state.genome, state.seed,
      state.genome.size!.width, state.genome.size!.height,
      outputView,
      {
        signal: ctrl.signal,
        onProgress: (frac) => modal.setProgress(frac),
      },
    );

    // Encode + download (existing PNG flow with metadata)
    await encodeAndDownload(canvas, state.genome);

    // Toast
    showToast(panelHost, `💾 Saved ${resolveCurrentFilename()}.pyr3.png to Downloads`);

    // Restore canvas to preview dims
    canvas.width = restoreDims.width;
    canvas.height = restoreDims.height;
    renderer.resize(restoreDims);
    rescheduleCanvasDimsAndReiterate();
  } catch (err) {
    if ((err as Error).name === 'AbortError' || /abort/i.test((err as Error).message)) {
      // Cancelled — silent
    } else {
      showToast(panelHost, `Render failed: ${(err as Error).message}`);
    }
  } finally {
    modal.close();
    state.renderInFlight = false;
  }
}
```

In `src/edit-section-render.ts`:

a. Remove the Size dropdown + W × H input pair + Quality scrubby DOM construction.

b. Keep the Oversample dropdown + Spatial filter widgets.

c. Add the subtitle DOM at the top of the section:

```ts
const subtitle = document.createElement('div');
subtitle.className = 'pyr3-edit-section-render__subtitle';
subtitle.textContent = 'Output quality — see size & render quality on the bar above.';
host.appendChild(subtitle);
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/edit-mount.test.ts src/edit-section-render.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: PASS. Regressions caught: any existing test that depended on the Size dropdown / W×H inputs / Quality scrubby being in the Render section needs to be updated.

- [ ] **Step 8: Commit**

```bash
git add src/edit-mount.ts src/edit-mount.test.ts src/edit-section-render.ts src/edit-section-render.test.ts
git commit -m "feat(#176): editor integration — bar mount + Save Render via progress modal + strip moved widgets"
```

---

## Task 6: Viewer integration

Mount the bar in the viewer (`src/main.ts`); viewer gains a Save Render flow + lane scheduler halt-on-target.

**Files:**
- Modify: `src/main.ts` — mount bar; preview canvas dim resolver; Save Render flow
- Modify: `src/main.test.ts` (or create one) — viewer-side bar integration tests

- [ ] **Step 1: Read viewer mount path**

Read: `src/main.ts` — focus on the renderer init, current resize/render flow, and existing chrome-bar mount point (around `mountEditBar` reference at line 419).

- [ ] **Step 2: Write failing tests**

```ts
// src/main.test.ts (or extend existing)
describe('viewer — render-mode-bar integration', () => {
  it('bar mounts below the open/reroll chrome', async () => {
    const host = await mountTestViewer();
    expect(host.querySelector('.pyr3-render-mode-bar')).toBeTruthy();
  });

  it('changing render Size does NOT resize the viewer canvas immediately', async () => {
    const host = await mountTestViewer();
    const canvas = host.querySelector('canvas')!;
    host.querySelector<HTMLButtonElement>('[data-render-preset="4K"]')?.click();
    expect(canvas.width).toBeLessThanOrEqual(1536);
  });

  it('Save Render in viewer fires the progress modal + downloads', async () => {
    const host = await mountTestViewer();
    host.querySelector<HTMLButtonElement>('[data-save-render]')?.click();
    await Promise.resolve();
    expect(document.querySelector('[data-render-progress-modal]')).toBeTruthy();
  });

  it('Save Render disabled when no genome loaded', async () => {
    const host = await mountTestViewer({ noGenome: true });
    const btn = host.querySelector<HTMLButtonElement>('[data-save-render]');
    expect(btn?.disabled).toBe(true);
  });
});
```

- [ ] **Step 3: Implement viewer wiring**

In `src/main.ts`:

a. Import `mountRenderModeBar`, `loadPreviewConfig`, `savePreviewConfig`, `computePreviewDims`, `openRenderProgressModal`.

b. After the existing chrome bar mount, insert the render-mode-bar's host:

```ts
let viewerPreviewCfg = loadPreviewConfig();

const renderBarHost = document.createElement('div');
existingChromeBar.parentElement!.insertBefore(renderBarHost, existingChromeBar.nextSibling);

const renderBarHandle = mountRenderModeBar({
  host: renderBarHost,
  getPreviewConfig: () => viewerPreviewCfg,
  setPreviewConfig: (cfg) => {
    viewerPreviewCfg = cfg;
    savePreviewConfig(cfg);
    rescheduleViewerCanvasAndReiterate(cfg, currentGenome);
  },
  getRenderSize: () => currentGenome?.size ?? { width: 1024, height: 1024 },
  setRenderSize: (size) => {
    if (!currentGenome) return;
    currentGenome.size = size;
    rescheduleViewerCanvasAndReiterate(viewerPreviewCfg, currentGenome);
  },
  getRenderQuality: () => currentGenome?.quality ?? DEFAULT_QUALITY,
  setRenderQuality: (q) => { if (currentGenome) currentGenome.quality = q; },
  onSaveRender: () => runViewerSaveRender(),
  canSave: () => !!currentGenome && !viewerRenderInFlight,
  showToast: (msg) => showToast(document.body, msg),
});
```

c. Replace the viewer's existing iteration loop's dim resolution: read from `computePreviewDims(viewerPreviewCfg.tier, currentGenome.size)` instead of `currentGenome.size` directly.

d. Lane scheduler halt-on-target: today the viewer already computes `targetSamples = (renderGenome.quality ?? QUICK_MAX_SPP) * renderer.width * renderer.height` and stops at that. The change is to use `viewerPreviewCfg.quality` (preview side) instead of `renderGenome.quality` for the LIVE iteration target. The render-side quality only matters during Save Render.

e. `runViewerSaveRender()` — analogous to `runSaveRender()` in Task 5; uses `openRenderProgressModal` + `editRenderer.fullRenderAt` (viewer should have its own EditRenderer instance OR share one — likely shares with the existing render loop).

f. `?quick=1` URL param wiring is in Task 7, but make sure the viewer's existing `?quick=1` code path is left in a clean state for Task 7 to retarget.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/main.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/main.test.ts
git commit -m "feat(#176): viewer integration — bar mount + Save Render + preview tier"
```

---

## Task 7: URL param remapping (`?quick=1` + new `?preview=*` / `?previewQ=*`)

Re-purpose `?quick=1` within the new model + add explicit overrides.

**Files:**
- Modify: `src/load-intent.ts` — extend `LoadIntent` parsing
- Modify: `src/main.ts` (viewer) — apply preview overrides on mount
- Modify: `src/load-intent.test.ts` — extend with new param tests

- [ ] **Step 1: Read current URL param parsing**

Read: `src/load-intent.ts` (full file).

- [ ] **Step 2: Write failing tests in `load-intent.test.ts`**

```ts
describe('parseLoadIntent — preview overrides', () => {
  it('?preview=fast → preview.tier=fast, preview.quality untouched', () => {
    const intent = parseLoadIntent('/?preview=fast');
    expect(intent?.previewOverride?.tier).toBe('fast');
    expect(intent?.previewOverride?.quality).toBeUndefined();
  });
  it('?previewQ=30 → preview.quality=30', () => {
    const intent = parseLoadIntent('/?previewQ=30');
    expect(intent?.previewOverride?.quality).toBe(30);
  });
  it('?preview=sharp&previewQ=50 → both set', () => {
    const intent = parseLoadIntent('/?preview=sharp&previewQ=50');
    expect(intent?.previewOverride).toEqual({ tier: 'sharp', quality: 50 });
  });
  it('?quick=1 maps to preview=fast, previewQ=10', () => {
    const intent = parseLoadIntent('/?quick=1');
    expect(intent?.previewOverride).toEqual({ tier: 'fast', quality: 10 });
  });
  it('?preview=garbage → ignored, no override', () => {
    const intent = parseLoadIntent('/?preview=garbage');
    expect(intent?.previewOverride?.tier).toBeUndefined();
  });
  it('?previewQ=999 → clamps to 50', () => {
    const intent = parseLoadIntent('/?previewQ=999');
    expect(intent?.previewOverride?.quality).toBe(50);
  });
});
```

- [ ] **Step 3: Extend `LoadIntent` + parser**

```ts
// src/load-intent.ts
export interface LoadIntent {
  // ... existing fields
  previewOverride?: {
    tier?: PreviewTier;
    quality?: number;
  };
}

// In parseLoadIntent, after existing param handling:
const VALID_TIERS = ['fast', 'balanced', 'sharp'] as const;

const previewParam = params.get('preview');
const previewQParam = params.get('previewQ');
const quickParam = params.get('quick');

let previewOverride: LoadIntent['previewOverride'] | undefined;
if (quickParam === '1') {
  previewOverride = { tier: 'fast', quality: 10 };
}
if (previewParam && VALID_TIERS.includes(previewParam as any)) {
  previewOverride = { ...(previewOverride ?? {}), tier: previewParam as PreviewTier };
}
if (previewQParam) {
  const q = parseInt(previewQParam, 10);
  if (Number.isFinite(q)) {
    previewOverride = { ...(previewOverride ?? {}), quality: Math.max(10, Math.min(50, q)) };
  }
}
// ... return intent with previewOverride
```

- [ ] **Step 4: Apply override in viewer `main.ts`**

```ts
// After loadPreviewConfig():
const intent = parseLoadIntent(window.location.pathname + window.location.search);
if (intent?.previewOverride?.tier) viewerPreviewCfg.tier = intent.previewOverride.tier;
if (intent?.previewOverride?.quality !== undefined) {
  viewerPreviewCfg.quality = intent.previewOverride.quality;
}
// NOTE: do NOT savePreviewConfig — URL override is session-only.
```

Same wiring in editor `edit-mount.ts` for symmetry.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/load-intent.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/load-intent.ts src/load-intent.test.ts src/main.ts src/edit-mount.ts
git commit -m "feat(#176): URL params — ?preview / ?previewQ + ?quick=1 remap"
```

---

## Task 8: Chrome eyeball verify gate + ship to user

Hand the user a verify URL with a structured checklist. Pause for user approval before FF-merge.

**Files:** (no code changes — verify only)

- [ ] **Step 1: Run typecheck + tests + parity rig**

```bash
npm run typecheck && npm test && npm run test:parity
```

Expected: All green.

- [ ] **Step 2: Start dev server in background**

```bash
npm run dev &
```

Confirm port from output (usually 5173; may bump to 5174 if 5173 is taken).

- [ ] **Step 3: Hand the user the verify URL + checklist**

Output (with the actual port from Step 2):

```text
http://localhost:5173/v1/edit

Chrome verify checklist (#176 ship gate):

EDITOR (/v1/edit)
  [ ] New 48px bar appears below open/reroll, above canvas
  [ ] PREVIEW side (left): tier pill (Fast/Balanced/Sharp) + Q buttons (10/20/30/40/50)
  [ ] RENDER side (right): size dropdown + W × H inputs + Q buttons (50/75/100/150/200) +
      Q text input + 💾 Save Render
  [ ] Picking "4K" on render does NOT resize the editor canvas (it stays at preview dims)
  [ ] Aspect changes when render preset changes (portrait → preview is portrait)
  [ ] Click Save Render → modal opens BEFORE canvas changes (no GPU jank)
  [ ] Cancel button bails the render mid-flight, no PNG downloaded
  [ ] Successful render shows post-save toast with filename
  [ ] Render section panel — Size/Quality/W×H gone, subtitle visible, oversample +
      filter widgets remain
  [ ] Quality > 500 typed → toast points to CLI, value clamps to 500

VIEWER (/v1)
  [ ] Bar appears in viewer too, identical to editor
  [ ] Save Render in viewer works (downloads PNG)
  [ ] No prior viewer feature broken

PERSISTENCE
  [ ] Pick tier=Sharp, reload page, tier still Sharp
  [ ] Pick render quality=150 in editor, save flame, reopen, render quality still 150

URL PARAMS
  [ ] /v1/edit?preview=fast → editor preview tier = Fast
  [ ] /v1/edit?previewQ=30 → preview quality = 30
  [ ] /v1?quick=1 → preview = Fast, Q = 10
  [ ] Refresh without params: tier persists from localStorage, NOT from URL
```

- [ ] **Step 4: Wait for user approval**

The user must reply **explicitly** that verify passed before FF-merge. Do not auto-merge. Per CLAUDE.md "User-verify before FF-merge."

- [ ] **Step 5: After user approval — squash + FF-merge + push**

```bash
# Squash the feature-branch commits into one ship commit
git checkout main
git merge --squash feature/issue-176-screen-vs-output-render
git commit -m "feat(#176): split screen render vs output render — shared bar + AbortSignal + halt-on-target"
git push origin main

# Per CLAUDE.md post-ship cleanup standing authorization:
git branch -D feature/issue-176-screen-vs-output-render
# (no remote branch was pushed in this plan — local-only feature work)
```

- [ ] **Step 6: Close the issue + verify live**

```bash
gh issue close 176 --comment "Shipped via main. Bar live at https://pyr3.app/v1/edit and https://pyr3.app/v1. Follow-ups: #177 (saved presets), #178 (doc-refresh), #179 (offline CTA)."
```

After ~2 min auto-deploy: open https://pyr3.app/v1/edit + https://pyr3.app/v1, run the same checklist live. Confirm.

---

## Self-Review (post-plan)

**Spec coverage** — every spec section maps to at least one task:

```text
Spec §1 Scope/naming                  → Task 1 (types), Task 3 (UI labels)
Spec §2 Architecture/data flow        → Tasks 1, 2, 3, 5, 6
Spec §3 Data shape & persistence      → Task 1 (localStorage), Task 5/6 (genome wiring)
Spec §4 UI surface                    → Task 3 (bar), Task 4 (modal), Task 5 (panel strip)
Spec §5 Migration & back-compat       → Task 7 (URL params), Tasks 5/6 (loading behavior)
Spec §6 Testing                       → Steps inside each task; Task 8 Chrome verify
Spec §7 Out of scope                  → Filed as #177/#178/#179 before plan
Spec §8 Items to track during impl    → Notes inside Tasks 2/5/6
```

**Type consistency:**
- `PreviewRenderConfig`, `PreviewTier`, `loadPreviewConfig`, `savePreviewConfig`, `computePreviewDims` used uniformly across Tasks 1, 3, 5, 6, 7.
- `mountRenderModeBar`, `RenderModeBarOpts`, `RenderModeBarHandle` consistent in Tasks 3, 5, 6.
- `openRenderProgressModal`, `RenderProgressModalHandle` consistent in Tasks 4, 5, 6.
- `FullRenderOptions { signal?, onProgress? }` consistent in Tasks 2, 5, 6.
- `ApplyLaneOptions { targetDensity? }` consistent in Tasks 2, 5, 6.

**Placeholder scan:** None — every step has actual content or an explicit "read the file" prereq.

**Open issues to track in PR description:**
- Render section panel CSS may need tweaking after widget strip (no `:empty` checks today).
- `rescheduleViewerCanvasAndReiterate` is a viewer-side helper that may need new code if viewer doesn't already have an equivalent.
- Lane scheduler halt-on-target may surface edge cases under fast tier-changes (rapid Fast → Sharp → Fast); regression test in Task 2 covers a single change; live edge cases caught in Task 8 Chrome verify.

---

## Execution Handoff

Plan complete. Per CLAUDE.md "Plan execution mode — by project type":

- **pyr3 = code-only project (Phaser/web/Python class).**
- **Default split:** first foundational task(s) INLINE (lock module shape + test idioms + cross-repo wire contract), then hand replicable remaining pure-logic tasks to SUBAGENTS; keep inherently-inline tasks (dev-server wiring, Chrome verify) inline.

**Recommended per-task split:**

```text
Task 1  render-mode-config            INLINE   (foundational module shape + localStorage idiom)
Task 2  edit-render seam refactor     INLINE   (sets the seam contract Tasks 5/6 consume)
Task 3  render-mode-bar component     SUBAGENT (replicable DOM + tests once Task 1 locked)
Task 4  render-progress-modal         SUBAGENT (standalone module, replicable)
Task 5  editor integration            INLINE   (wires it all together; lots of moving parts;
                                                stays in lead to keep state coherent)
Task 6  viewer integration            INLINE   (similar mirror of Task 5 in main.ts)
Task 7  URL params                    SUBAGENT (mechanical parser extension)
Task 8  Chrome verify + ship gate     INLINE   (dev-server + Chrome MCP + user gate)
```

User confirms or tweaks the split before kickoff.
