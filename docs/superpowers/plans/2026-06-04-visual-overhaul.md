# Visual Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a coordinated visual pass across pyr3's four user-facing surfaces (Viewer · Gallery · Editor · About): single static top bar, info-only / action-only sub-row split, flame-palette color migration, gallery filter rework, editor body conventions, and a new About page that owns the version display.

**Architecture:** DRY chrome substrate via `mountBarChrome(root, opts)` in `src/ui-bar.ts` consumed by all four per-surface mount fns. A new `src/ui-tokens.ts` centralizes the flame `COLORS` table. App-state module exposes a `currentFlame` context for the viewer-only tab-transfer rule. Editor body adopts shared primitives (row pattern, toggle, slider-with-value, button tiers, tooltip popover, preset strip) via `src/edit-primitives.ts`; existing `edit-section-*.ts` modules refactor to use them.

**Tech Stack:** TypeScript · WebGPU/WGSL (engine untouched) · Vite · vanilla DOM (no framework). Tests: vitest unit + Playwright Chrome E2E for the brush-select drag gesture.

**Spec:** `docs/superpowers/specs/2026-06-04-visual-overhaul-design.md`
**Branch:** `feature/visual-overhaul` (created)

---

## Phase Overview

| # | Phase | Mode | Why |
|---|---|---|---|
| 1 | Color tokens + chrome substrate | Subagent | Pure refactor; well-defined contract |
| 2 | About page + tab navigation contract | Subagent | New module + small DOM additions |
| 3 | Viewer surface (info + action rows) | Subagent | Logic + DOM |
| 4 | Gallery surface — info row + tile layout | Subagent | DOM restructure; mechanism preserved |
| 5 | Gallery filter rework | Subagent + lead-Chrome for drag test | Brush-select needs real-mouse gesture test |
| 6 | Editor chrome + state persistence | Subagent | localStorage round-trip |
| 7 | Editor body — primitives + section reflows | Subagent | Per-section refactor with shared primitives |
| 8 | Editor xforms internals | Subagent | Quick ops + active/inactive + remove |
| 9 | Palette subpanel + picker | Subagent | New widget; favorites in localStorage |
| 10 | Variation picker | Subagent | Mirrors palette picker; less surface |
| 11 | Code review (fresh subagent) | Subagent (`feature-dev:code-reviewer`) | Independent review per global workflow |
| 12 | Chrome verify + ship | Lead-Inline | Dev server + chrome-devtools-mcp + user-verify gate |

---

## File Structure

### New files

- `src/ui-tokens.ts` — `COLORS` table + token type exports (single source of truth for palette colors)
- `src/ui-tokens.test.ts`
- `src/about-mount.ts` — `/about` page mount function (single-column body, version chip, lineage/credits/links)
- `src/about-mount.test.ts`
- `src/app-state.ts` — `currentFlame` context module (viewer writes; tab clicks read)
- `src/app-state.test.ts`
- `src/edit-primitives.ts` — shared DOM helpers: row, input, slider-with-value, color swatch, toggle pill, remove button, btn / btn-accent / btn-primary builders, info-icon + tooltip popover, preset strip
- `src/edit-primitives.test.ts`
- `src/edit-preset-density.ts` — Density-Emitter preset list + values + dirty-state logic
- `src/edit-preset-density.test.ts`
- `src/palette-picker.ts` — docked sidecar picker; color-filter chips, search, sort, auto-apply, favorites
- `src/palette-picker.test.ts`
- `src/edit-tooltip.ts` — info-icon + anchored popover primitive (right-anchor default, left-anchor fallback)
- `src/edit-tooltip.test.ts`

### Modified files

- `src/ui-bar.ts` — extract `mountBarChrome`; refactor `mountBar`, `mountGalleryBar`, `mountEditBar` to consume; add `mountAboutBar`
- `src/main.ts` — `/about` route; tab-click handlers wire to `app-state.currentFlame`
- `src/load-intent.ts` — `editorUrl(genome, corpusId?)`, `galleryUrlForFlame(corpusId)` helpers
- `src/gallery-mount.ts` — three-column info row; 3×3 square-tile grid; `<gen>/<id>` label as link
- `src/gallery-filter-ui.ts` — rebuild: active-chip strip, progressive disclosure, brush-select histograms
- `src/gallery-facets.ts` — plain-English label mapping; sort labels stay
- `src/edit-mount.ts` — info row (editable name + nick + dims) + action row matching viewer pattern + Reroll
- `src/edit-state.ts` — extend localStorage round-trip to cover full WIP genome (not just collapse state)
- `src/edit-section-render.ts` — adopt row pattern; W×H pair grid; size dropdown wiring
- `src/edit-section-global.ts` — adopt row pattern; vibrancy/background/symmetry reflow
- `src/edit-section-viewport.ts` — adopt row pattern; fit button as `btn-accent`
- `src/edit-section-density.ts` — adopt row pattern; mount preset strip; tooltip popovers
- `src/edit-section-palette.ts` — ribbon-rotation via CSS filter; identifier-format logic; reset-hue `btn-accent`
- `src/edit-section-xforms.ts` — toggle widget; remove × button; inactive state; quick-ops strip; reset-to-identity
- `src/edit-section-final.ts` — same patterns as xforms section
- `src/edit-xform-presets.ts` — RENAME to `src/edit-xform-quickops.ts`; rewrite ops as relative deltas; drop `rotate +90°`
- `src/edit-variation-picker.ts` — adopt same shell as palette-picker; xform-contextual title; favorites
- `src/flam3-palette-names.ts` — extend / verify name-table; `paletteIdentifier(source)` helper for the launcher button
- `src/index.html` — `/about` static fallback (Vite SPA already serves SPA; ensure 404→index for /about works)
- `vite.config.ts` — verify history-fallback for `/about`

---

## Phase 1 — Color tokens + chrome substrate

**Goal:** Land the foundation: `COLORS` table + `mountBarChrome` extracted. All three existing bars refactor to use the substrate. A new `mountAboutBar` is added. Zero visible UX change — this phase is pure refactor.

**Files:**
- Create: `src/ui-tokens.ts` · `src/ui-tokens.test.ts`
- Modify: `src/ui-bar.ts` · `src/ui-bar.test.ts`
- Modify: `src/main.ts` (callsites)

### Task 1.1: Create `src/ui-tokens.ts` with the `COLORS` table

**Files:**
- Create: `src/ui-tokens.ts`
- Create: `src/ui-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

`src/ui-tokens.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { COLORS } from './ui-tokens';

describe('ui-tokens', () => {
  it('exposes the flame gradient stops matching the favicon', () => {
    expect(COLORS.flame.top).toBe('#ffbe3e');
    expect(COLORS.flame.mid).toBe('#e87c1a');
    expect(COLORS.flame.bot).toBe('#bf2408');
  });

  it('exposes background tiers used across surfaces', () => {
    expect(COLORS.bg.page).toBe('#0a0a0c');
    expect(COLORS.bg.bar).toBe('#0e0e10');
    expect(COLORS.bg.info).toBe('#131316');
    expect(COLORS.bg.action).toBe('#15110d');
    expect(COLORS.bg.panel).toBe('#141417');
  });

  it('exposes text tiers and named accents', () => {
    expect(COLORS.text.primary).toBe('#d8d8de');
    expect(COLORS.text.muted).toBe('#8a8a92');
    expect(COLORS.text.dim).toBe('#5a5a60');
    expect(COLORS.border).toBe('#26262c');
    expect(COLORS.webgpu).toBe('#6cd16c');
    expect(COLORS.danger).toBe('#e85a4a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui-tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/ui-tokens.ts`**

```ts
// Single source of truth for pyr3's UI color tokens.
// Mirrors the favicon SVG linear gradient (see index.html); used by ui-bar.ts,
// edit-primitives.ts, gallery-mount.ts, palette-picker.ts, about-mount.ts.
export const COLORS = {
  flame: {
    top: '#ffbe3e',
    mid: '#e87c1a',
    bot: '#bf2408',
  },
  bg: {
    page:   '#0a0a0c',
    bar:    '#0e0e10',
    info:   '#131316',
    action: '#15110d',
    panel:  '#141417',
  },
  border: '#26262c',
  text: {
    primary: '#d8d8de',
    muted:   '#8a8a92',
    dim:     '#5a5a60',
  },
  webgpu: '#6cd16c',
  danger:  '#e85a4a',
} as const;

export type ColorTokens = typeof COLORS;
```

- [ ] **Step 4: Run test, verify it passes + typecheck**

Run: `npx vitest run src/ui-tokens.test.ts && npm run typecheck`
Expected: PASS + green typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/ui-tokens.ts src/ui-tokens.test.ts
git commit -m "feat(ui): add COLORS token table mirroring favicon palette"
```

### Task 1.2: Audit + sweep existing color literals to `COLORS`

**Files:**
- Modify: `src/ui-bar.ts` and any other `src/*.ts` containing non-flame hex literals

- [ ] **Step 1: Identify all literal accent colors**

Run: `grep -nE "#[0-9a-fA-F]{3,8}" src/*.ts src/edit-*.ts src/gallery-*.ts | grep -vE "ui-tokens|favicon|R-tolerance|0x" | head -60`

Document each occurrence: file + line + value + replacement token. Focus on `#ffbe3e` / `#bf2408` / `#e87c1a` / `#0e0e10` / `#26262c` etc. (Note: keep WGSL shaders untouched — engine-only literals stay.)

- [ ] **Step 2: Replace literals with `COLORS` token references**

Example pattern in `src/ui-bar.ts`:
```ts
// before
el.style.color = '#ffbe3e';
// after
import { COLORS } from './ui-tokens';
el.style.color = COLORS.flame.top;
```

Apply same pattern across every TS file containing `#ffbe3e` / `#bf2408` / `#e87c1a` / accent bg tones. **Do not change behavior** — purely token swap.

- [ ] **Step 3: Run existing tests + typecheck**

Run: `npm run typecheck && npm test`
Expected: All existing tests pass. Color sweep is a refactor — visible UX must be identical.

- [ ] **Step 4: Spot-check one Chrome render**

(Manual; lead-inline if subagent can't.) Run `npm run dev` and load `http://localhost:5173/` — top bar amber should look the same.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): sweep hex literals to COLORS tokens (no UX change)"
```

### Task 1.3: Extract `mountBarChrome` from `ui-bar.ts`

**Files:**
- Modify: `src/ui-bar.ts`
- Modify: `src/ui-bar.test.ts`

The current `mountBar` / `mountGalleryBar` / `mountEditBar` each rebuild the chrome (brand + about + tabs + WebGPU pill + fork-it + more-flames octocats). Extract into a shared primitive.

- [ ] **Step 1: Write the failing test**

Add to `src/ui-bar.test.ts`:
```ts
import { mountBarChrome, type TabSurface } from './ui-bar';
import type { WebGPUStatus } from './webgpu-check';

describe('mountBarChrome', () => {
  it('renders the static chrome and exposes a middleSlot', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const webgpu: WebGPUStatus = { available: true } as WebGPUStatus;
    const onTabClick = vi.fn();

    const handle = mountBarChrome(root, {
      surface: 'viewer',
      webgpu,
      onTabClick,
    });

    expect(root.querySelector('.pyr3-brand')).toBeTruthy();
    expect(root.querySelector('.pyr3-tabs')).toBeTruthy();
    expect(root.querySelector('.pyr3-tab[data-surface="viewer"].active')).toBeTruthy();
    expect(root.querySelector('.pyr3-tab[data-surface="gallery"].active')).toBeFalsy();
    expect(root.querySelector('.pyr3-right-cluster')).toBeTruthy();
    expect(handle.middleSlot.classList.contains('pyr3-middle-slot')).toBe(true);

    handle.destroy();
    expect(root.children).toHaveLength(0);
  });

  it('routes tab clicks to onTabClick', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const onTabClick = vi.fn();
    const handle = mountBarChrome(root, {
      surface: 'gallery',
      webgpu: { available: true } as WebGPUStatus,
      onTabClick,
    });
    (root.querySelector('.pyr3-tab[data-surface="editor"]') as HTMLElement).click();
    expect(onTabClick).toHaveBeenCalledWith('editor');
    handle.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui-bar.test.ts`
Expected: FAIL — `mountBarChrome` not exported.

- [ ] **Step 3: Implement `mountBarChrome`**

In `src/ui-bar.ts`, add:

```ts
export type TabSurface = 'viewer' | 'gallery' | 'editor' | 'about';

export interface ChromeOpts {
  surface: TabSurface;
  webgpu: WebGPUStatus;
  onTabClick: (surface: TabSurface) => void;
}

export interface ChromeHandle {
  middleSlot: HTMLElement;
  destroy: () => void;
}

export function mountBarChrome(root: HTMLElement, opts: ChromeOpts): ChromeHandle {
  const bar = document.createElement('div');
  bar.className = 'pyr3-topbar';

  // Left cluster: brand + about
  const left = document.createElement('div');
  left.className = 'pyr3-left-cluster';
  const brand = buildBrand();              // existing flame-svg + wordmark builder
  const about = buildAboutLink();          // links to /about
  left.appendChild(brand);
  left.appendChild(about);

  // Center: tabs
  const tabs = buildTabs(opts.surface, opts.onTabClick);

  // Right cluster: WebGPU pill + fork-it octocat + more-flames octocat
  const right = buildRightCluster(opts.webgpu);

  bar.appendChild(left);
  bar.appendChild(tabs);
  bar.appendChild(right);
  root.appendChild(bar);

  // Per-surface mount fns drop their info-row / action-row content here:
  const middleSlot = document.createElement('div');
  middleSlot.className = 'pyr3-middle-slot';
  root.appendChild(middleSlot);

  return {
    middleSlot,
    destroy: () => {
      root.removeChild(bar);
      root.removeChild(middleSlot);
    },
  };
}

function buildTabs(active: TabSurface, onClick: (s: TabSurface) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-tabs';
  const surfaces: TabSurface[] = ['viewer', 'gallery', 'editor'];  // about lives in left cluster, not tabs
  for (const s of surfaces) {
    const btn = document.createElement('div');
    btn.className = 'pyr3-tab' + (s === active ? ' active' : '');
    btn.dataset.surface = s;
    btn.textContent = s[0].toUpperCase() + s.slice(1);
    btn.addEventListener('click', () => onClick(s));
    wrap.appendChild(btn);
  }
  return wrap;
}
```

Reuse the existing `buildBrand`, `buildAboutLink`, `buildRightCluster` helpers — extract them from the current per-surface mount fns if they aren't already standalone.

- [ ] **Step 4: Run test, verify pass + typecheck**

Run: `npx vitest run src/ui-bar.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(ui-bar): extract mountBarChrome substrate (#103)"
```

### Task 1.4: Refactor `mountBar` / `mountGalleryBar` / `mountEditBar` to consume `mountBarChrome`

**Files:**
- Modify: `src/ui-bar.ts`
- Modify: `src/ui-bar.test.ts` (existing tests must still pass)

- [ ] **Step 1: Refactor `mountBar`**

Replace the chrome-building portion of `mountBar` with `mountBarChrome` + per-viewer content into `chrome.middleSlot`:

```ts
export function mountBar(root: HTMLElement, opts: BarOpts): BarHandle {
  const chrome = mountBarChrome(root, {
    surface: 'viewer',
    webgpu: opts.webgpu,
    onTabClick: opts.onTabClick,  // NEW: opts now accepts onTabClick
  });

  // Build viewer-specific info row + action row inside chrome.middleSlot
  const infoRow = buildViewerInfoRow(opts);
  const actionRow = buildViewerActionRow(opts);
  chrome.middleSlot.appendChild(infoRow);
  chrome.middleSlot.appendChild(actionRow);

  return {
    setMeta: (meta) => { /* … */ },
    showProgress: (display) => { /* … */ },
    destroy: () => chrome.destroy(),
    // (other handle methods)
  };
}
```

- [ ] **Step 2: Refactor `mountGalleryBar`** — same pattern, `surface: 'gallery'`, gallery-specific info row content into `chrome.middleSlot`.

- [ ] **Step 3: Refactor `mountEditBar`** — same pattern, `surface: 'editor'`, editor-specific info row into `chrome.middleSlot`.

- [ ] **Step 4: Run full test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: All existing `ui-bar.test.ts` + `gallery-mount.test.ts` tests pass.

- [ ] **Step 5: Spot-check Chrome**

(Lead-inline.) Run `npm run dev`; verify `/`, `/showcase`, `/v1/edit` all show the same top bar chrome.

- [ ] **Step 6: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "refactor(ui-bar): viewer/gallery/edit bars consume mountBarChrome"
```

### Task 1.5: Add `mountAboutBar` for the new About surface

**Files:**
- Modify: `src/ui-bar.ts`
- Modify: `src/ui-bar.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('mountAboutBar', () => {
  it('renders chrome with NO tab active (about lives in left cluster, not tabs)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    const handle = mountAboutBar(root, {
      webgpu: { available: true } as WebGPUStatus,
      onTabClick: vi.fn(),
    });
    expect(root.querySelector('.pyr3-tab.active')).toBeFalsy();
    expect(root.querySelector('.pyr3-about-link.active')).toBeTruthy();
    handle.destroy();
  });
});
```

- [ ] **Step 2: Run test, verify fail.** Run: `npx vitest run src/ui-bar.test.ts -t mountAboutBar`

- [ ] **Step 3: Implement `mountAboutBar`**

```ts
export interface AboutBarOpts {
  webgpu: WebGPUStatus;
  onTabClick: (surface: TabSurface) => void;
}

export interface AboutBarHandle {
  destroy: () => void;
}

export function mountAboutBar(root: HTMLElement, opts: AboutBarOpts): AboutBarHandle {
  const chrome = mountBarChrome(root, {
    surface: 'about',                // no tab matches; tabs show all-inactive
    webgpu: opts.webgpu,
    onTabClick: opts.onTabClick,
  });

  // Highlight the about-link in the left cluster
  root.querySelector('.pyr3-about-link')?.classList.add('active');

  return { destroy: () => chrome.destroy() };
}
```

Update `buildTabs` to handle `surface: 'about'` — no tab becomes active.

- [ ] **Step 4: Run test, verify pass + typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(ui-bar): add mountAboutBar with about-link active state"
```

### Task 1.6: Wire `position: sticky` + 44px topbar styling

**Files:**
- Modify: `src/ui-bar.ts` (CSS-in-TS for the topbar element)

- [ ] **Step 1: Add styling to `.pyr3-topbar`**

In the chrome-building helper (e.g., constructor of `mountBarChrome`):
```ts
bar.style.position = 'sticky';
bar.style.top = '0';
bar.style.zIndex = '50';
bar.style.minHeight = '44px';
bar.style.padding = '3px 18px';
bar.style.background = COLORS.bg.bar;
bar.style.borderBottom = `1px solid ${COLORS.border}`;
bar.style.display = 'grid';
bar.style.gridTemplateColumns = '1fr auto 1fr';
bar.style.alignItems = 'center';
bar.style.gap = '16px';
```

(Or via a stylesheet bundle — match the existing pyr3 approach.)

- [ ] **Step 2: Run existing tests + typecheck**

- [ ] **Step 3: Commit**

```bash
git add src/ui-bar.ts
git commit -m "style(ui-bar): topbar position:sticky + 44px min-height"
```

### Task 1.7: Phase 1 verification

- [ ] **Run:** `npm run typecheck && npm test`. Expected: full suite green.
- [ ] **Spot-check Chrome:** lead-inline starts `npm run dev`, loads `/`, `/showcase`, `/v1/edit` — all show identical 44px top bar; positions sticky on scroll.
- [ ] **Commit checkpoint** if any squashes are needed:
```bash
git commit --allow-empty -m "phase 1 complete: chrome substrate live; no UX regression"
```

---

## Phase 2 — About page + tab navigation contract

**Goal:** Add the `/about` route with the locked content. Add the `app-state.currentFlame` module. Tab clicks from Viewer transfer context to Gallery and Editor; all other transitions don't.

**Files:**
- Create: `src/about-mount.ts` · `src/about-mount.test.ts`
- Create: `src/app-state.ts` · `src/app-state.test.ts`
- Modify: `src/main.ts` (new `/about` route; tab-click handlers)
- Modify: `src/load-intent.ts` (`editorUrlForFlame`, `galleryUrlForFlame` helpers)

### Task 2.1: `app-state.ts` — currentFlame context module

**Files:** Create `src/app-state.ts` · `src/app-state.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setCurrentFlame, getCurrentFlame, clearCurrentFlame } from './app-state';

describe('app-state.currentFlame', () => {
  beforeEach(() => clearCurrentFlame());

  it('stores and retrieves the current flame', () => {
    const genome = { name: 'test', xforms: [] } as any;
    setCurrentFlame({ genome, corpusId: { gen: 198, id: 7372 } });
    const current = getCurrentFlame();
    expect(current?.genome.name).toBe('test');
    expect(current?.corpusId?.gen).toBe(198);
  });

  it('returns null when nothing is set', () => {
    expect(getCurrentFlame()).toBeNull();
  });

  it('clears the current flame', () => {
    setCurrentFlame({ genome: { name: 'x' } as any });
    clearCurrentFlame();
    expect(getCurrentFlame()).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail.** Run: `npx vitest run src/app-state.test.ts`

- [ ] **Step 3: Implement**

```ts
import type { Genome } from './genome-types';

export interface CurrentFlame {
  genome: Genome;
  corpusId?: { gen: number; id: number };   // present if loaded from corpus
}

let _current: CurrentFlame | null = null;

export function setCurrentFlame(flame: CurrentFlame): void { _current = flame; }
export function getCurrentFlame(): CurrentFlame | null { return _current; }
export function clearCurrentFlame(): void { _current = null; }
```

- [ ] **Step 4: Verify pass + typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/app-state.ts src/app-state.test.ts
git commit -m "feat(app-state): add currentFlame context module"
```

### Task 2.2: `load-intent.ts` — URL helpers for tab navigation

**Files:** Modify `src/load-intent.ts` · `src/load-intent.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { editorUrlForFlame, galleryUrlForFlame } from './load-intent';

describe('tab-navigation URL helpers', () => {
  it('editorUrlForFlame returns /v1/edit?gen=&id= when corpusId present', () => {
    expect(editorUrlForFlame({ gen: 198, id: 7372 })).toBe('/v1/edit?gen=198&id=7372');
  });

  it('editorUrlForFlame returns bare /v1/edit when no corpusId', () => {
    expect(editorUrlForFlame(undefined)).toBe('/v1/edit');
  });

  it('galleryUrlForFlame returns /showcase?page=N where N contains the corpusId', () => {
    // assuming page size 9; flame at corpus-list index 124 → page 14
    expect(galleryUrlForFlame({ gen: 198, id: 7372 }, 124)).toBe('/showcase?page=14');
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** in `src/load-intent.ts`:

```ts
export function editorUrlForFlame(corpusId?: { gen: number; id: number }): string {
  if (!corpusId) return '/v1/edit';
  return `/v1/edit?gen=${corpusId.gen}&id=${corpusId.id}`;
}

import { GALLERY_PAGE_SIZE } from './load-intent';

export function galleryUrlForFlame(
  _corpusId: { gen: number; id: number },
  flameCorpusIndex: number,
): string {
  const page = Math.floor(flameCorpusIndex / GALLERY_PAGE_SIZE) + 1;
  return `/showcase?page=${page}`;
}
```

- [ ] **Step 4: Verify pass + typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/load-intent.ts src/load-intent.test.ts
git commit -m "feat(load-intent): editor + gallery URL helpers for tab navigation"
```

### Task 2.3: `main.ts` — wire `onTabClick` handlers via `app-state`

**Files:** Modify `src/main.ts`

- [ ] **Step 1: Build the click handler**

```ts
import { getCurrentFlame } from './app-state';
import { editorUrlForFlame, galleryUrlForFlame } from './load-intent';

function handleTabClick(target: TabSurface): void {
  const here = currentSurface();   // helper that reads window.location.pathname
  const cf = getCurrentFlame();

  // Viewer-only transfer rule
  if (here === 'viewer' && target === 'gallery' && cf?.corpusId) {
    const idx = corpusIndexOf(cf.corpusId);   // existing helper
    window.location.href = galleryUrlForFlame(cf.corpusId, idx);
    return;
  }
  if (here === 'viewer' && target === 'editor') {
    window.location.href = editorUrlForFlame(cf?.corpusId);
    return;
  }

  // All other transitions: no transfer
  const fallback = { viewer: '/', gallery: '/showcase', editor: '/v1/edit', about: '/about' };
  window.location.href = fallback[target];
}
```

- [ ] **Step 2: Pass `handleTabClick` into all three `mountBar` / `mountGalleryBar` / `mountEditBar` call sites**

```ts
const bar = mountBar(document.getElementById('pyr3-bar')!, {
  // …existing opts…
  onTabClick: handleTabClick,
});
```

- [ ] **Step 3: Viewer writes `currentFlame` when it loads a flame**

In the existing viewer flame-load path (e.g., `main.ts`'s corpus-load handler), after the genome is parsed:
```ts
setCurrentFlame({ genome, corpusId: { gen: 198, id: 7372 } });
```

- [ ] **Step 4: Editor writes `currentFlame` when the genome changes**

In `edit-state.ts`'s `setGenome` (or equivalent state-mutator), call `setCurrentFlame({ genome })` — corpusId omitted unless the editor knows the source.

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/edit-state.ts
git commit -m "feat(tab-nav): viewer-only currentFlame context transfer"
```

### Task 2.4: `about-mount.ts` — the About page

**Files:** Create `src/about-mount.ts` · `src/about-mount.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mountAbout } from './about-mount';

describe('mountAbout', () => {
  it('renders title, tagline, version chip, and sections', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountAbout(root, { version: '1.4.0', buildDate: '2026-06-04', gpuInfo: 'Dawn' });

    expect(root.querySelector('h1')?.textContent).toBe('pyr3');
    expect(root.textContent).toContain('1.4.0');
    expect(root.textContent).toContain('2026-06-04');
    expect(root.textContent).toContain('Dawn');
    expect(root.querySelector('section[data-sec="lineage"]')).toBeTruthy();
    expect(root.querySelector('section[data-sec="credits"]')).toBeTruthy();
    expect(root.querySelector('section[data-sec="links"]')).toBeTruthy();
  });

  it('omits build info gracefully when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>';
    mountAbout(document.getElementById('root')!, { version: '1.4.0' });
    expect(document.body.textContent).toContain('1.4.0');
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** the mount function with the locked content:

```ts
import { COLORS } from './ui-tokens';

export interface AboutOpts {
  version: string;
  buildDate?: string;
  gpuInfo?: string;
}

export function mountAbout(root: HTMLElement, opts: AboutOpts): void {
  // single-column readable layout per spec
  // — title + tagline + version-chip + What it is + Lineage + Credits + Links + Notes
  // ... build DOM …
}
```

(Implement the full body per the spec § "About (`/about`)".)

- [ ] **Step 4: Verify pass + typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/about-mount.ts src/about-mount.test.ts
git commit -m "feat(about): mountAbout page body — version + lineage + credits + links"
```

### Task 2.5: Wire `/about` route in `main.ts`

**Files:** Modify `src/main.ts`

- [ ] **Step 1: Add route handler**

```ts
if (window.location.pathname === '/about') {
  const root = document.getElementById('pyr3-root')!;
  mountAboutBar(root, { webgpu, onTabClick: handleTabClick });
  const slot = root.querySelector('.pyr3-middle-slot') as HTMLElement;
  mountAbout(slot, {
    version: APP_VERSION,                    // injected from package.json
    buildDate: BUILD_DATE,                    // injected at build via Vite define
    gpuInfo: webgpu.adapterInfo?.architecture ?? 'WebGPU',
  });
  return;
}
```

- [ ] **Step 2: Inject build-time version + date via Vite**

In `vite.config.ts`:
```ts
define: {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
},
```

In `src/main.ts`:
```ts
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;
```

- [ ] **Step 3: Verify `/about` loads cleanly in Chrome**

(Lead-inline.) `npm run dev` → `http://localhost:5173/about` should render the about page.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts vite.config.ts
git commit -m "feat(about): wire /about route with build-time version+date"
```

### Task 2.6: Drop the `v1.4.0` version chip from the existing top bar

**Files:** Modify `src/ui-bar.ts`

- [ ] **Step 1: Remove the version chip element/text from `buildBrand` or wherever it currently lives.**

- [ ] **Step 2: Verify tests still pass** — any test asserting the version chip must be removed/updated.

- [ ] **Step 3: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "refactor(ui-bar): drop version chip from top bar (lives on /about now)"
```

### Task 2.7: Phase 2 verification

- [ ] **Run:** `npm run typecheck && npm test`
- [ ] **Lead-inline Chrome verify:** all four routes (`/`, `/showcase`, `/v1/edit`, `/about`) load and show consistent chrome.
- [ ] **Tab navigation verify:** in viewer, click Gallery — gallery opens at the page containing the current flame; click Editor — editor preloads the flame. In editor, click Viewer — viewer shows editor's genome (independent of which surface).

---

## Phase 3 — Viewer surface (info + action rows)

**Goal:** Replace the viewer's current info+action with the locked split: info row (info-only, variations all expanded) + action row (📂 Open · 📐 Size ▾ · QUALITY [10/25/50/75/100] · 🧬 Save Flame · 💾 Save Render).

**Files:**
- Modify: `src/ui-bar.ts` (`buildViewerInfoRow`, `buildViewerActionRow`)
- Modify: `src/main.ts` (Save Flame handler wiring)
- Modify: `src/edit-fileops.ts` or new `src/save-flame.ts` for `.pyr3.json` save

### Task 3.1: Info row — all variations expanded

**Files:** Modify `src/ui-bar.ts` (replace the existing viewer info-row builder)

- [ ] **Step 1: Failing test** — assert that for a flame with 6 variations, all 6 appear inline (no `+2` collapse):

```ts
it('viewer info row shows all variations expanded — no +N collapse', () => {
  document.body.innerHTML = '<div id="root"></div>';
  const opts = makeViewerBarOpts({
    flameName: 'electricsheep.247.19679',
    width: 1920, height: 1080, quality: 50, tier: 'Standard',
    variations: ['linear', 'julia', 'bent', 'fan', 'spherical', 'sinusoidal'],
  });
  mountBar(document.getElementById('root')!, opts);
  const txt = document.body.textContent ?? '';
  for (const v of ['linear','julia','bent','fan','spherical','sinusoidal']) expect(txt).toContain(v);
  expect(txt).not.toContain('+2');
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement `buildViewerInfoRow`**

```ts
function buildViewerInfoRow(opts: BarOpts): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pyr3-info-row pyr3-info-row--viewer';
  // mount name, dim, q, tier, then every variation
  row.appendChild(span('pyr3-name', opts.meta.flameName));
  row.appendChild(sep());
  row.appendChild(span('pyr3-dim', `${opts.meta.width}×${opts.meta.height}`));
  row.appendChild(sep());
  row.appendChild(span('pyr3-q', `q${opts.meta.quality}`));
  row.appendChild(sep());
  row.appendChild(span('pyr3-tier', opts.meta.tier));
  for (const v of opts.meta.variations) {
    row.appendChild(sep());
    row.appendChild(span('pyr3-var', v));
  }
  return row;
}
```

- [ ] **Step 4: Verify pass + typecheck**
- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(viewer): info row shows all variations expanded"
```

### Task 3.2: Action row — drop Advanced, add Size dropdown + numeric QUALITY group

**Files:** Modify `src/ui-bar.ts` (replace `buildViewerActionRow`)

- [ ] **Step 1: Failing tests** for each change:
  1. Advanced button absent
  2. Size dropdown present with the locked preset list
  3. Quality button group has buttons `10 25 50 75 100`
  4. Active quality matches current value

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** Use shared primitives from `edit-primitives.ts` if Phase 7 already landed; otherwise inline. (Subagent: if Phase 7 hasn't landed yet, replicate the styles inline — they'll consolidate later. Do not block Phase 3 on Phase 7.)

Size preset list (constant in same file or in `src/load-intent.ts`):
```ts
export const SIZE_PRESETS = [
  { group: 'Common', items: [
    { label: 'HD',              w: 1920, h: 1080 },
    { label: '2K',              w: 2560, h: 1440 },
    { label: '4K',              w: 3840, h: 2160 },
    { label: 'square',          w: 1080, h: 1080 },
  ]},
  { group: 'Phone portrait', items: [
    { label: 'iPhone 15 Pro',       w: 1290, h: 2796 },
    { label: 'iPhone 14 Pro Max',   w: 1284, h: 2778 },
    { label: 'FHD portrait',        w: 1080, h: 1920 },
    { label: 'Pixel 8 Pro',         w: 1440, h: 3120 },
  ]},
  { group: 'Tablet', items: [
    { label: 'iPad Pro 11"',        w: 1668, h: 2388 },
    { label: 'iPad Pro 12.9"',      w: 2048, h: 2732 },
  ]},
] as const;
```

Quality preset values:
```ts
export const QUALITY_PRESETS = [10, 25, 50, 75, 100] as const;
```

- [ ] **Step 4: Verify pass + typecheck**
- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts src/load-intent.ts
git commit -m "feat(viewer): action row — drop Advanced; add Size + QUALITY numeric group"
```

### Task 3.3: Save Render as primary popped CTA + Save Flame secondary

**Files:** Modify `src/ui-bar.ts`, `src/save-flame.ts` (new), `src/main.ts`

- [ ] **Step 1: Failing test** — verify two distinct buttons render with the right CSS classes (`btn-primary` for Save Render, `btn` for Save Flame).

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement two buttons** in the action row. Save Render uses `btn-primary` (flame gradient bg, dark text, glow). Save Flame uses standard `btn`.

- [ ] **Step 4: Implement `saveFlame()`** in `src/save-flame.ts`:

```ts
import type { Genome } from './genome-types';

export function saveFlame(genome: Genome, filename = 'untitled.pyr3.json'): void {
  const json = JSON.stringify(genome, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

(If `edit-fileops.ts` already has a save fn, reuse it.)

- [ ] **Step 5: Wire `onSaveFlame` handler** in `main.ts` viewer mount.
- [ ] **Step 6: Verify pass + typecheck**
- [ ] **Step 7: Commit**

```bash
git add src/ui-bar.ts src/save-flame.ts src/main.ts src/ui-bar.test.ts
git commit -m "feat(viewer): Save Render (popped CTA) + Save Flame (secondary)"
```

### Task 3.4: Phase 3 verification

- [ ] **Run:** `npm run typecheck && npm test`
- [ ] **Lead-inline Chrome verify:** `/` shows info row with full variations · action row with Size dropdown, QUALITY buttons, no Advanced, Save Flame + popped Save Render · 🔥 surprise me + prev/next pills on the right.

---

## Phase 4 — Gallery surface — info row + tile layout

**Goal:** Three-column info row with centered page-nav cluster + filter button far-right; 3×3 square tile grid with `<gen>/<id>` link below each tile.

**Files:**
- Modify: `src/ui-bar.ts` (`buildGalleryInfoRow`)
- Modify: `src/gallery-mount.ts` (tile grid, square aspect, ID link)

### Task 4.1: Gallery info row — three-column with centered page-nav

**Files:** Modify `src/ui-bar.ts` · `src/ui-bar.test.ts`

- [ ] **Step 1: Failing tests:**
  1. Info row is `display: grid; grid-template-columns: 1fr auto 1fr`
  2. `.page-text` has `min-width: 160px`
  3. Filter button is in the right column
  4. `× of Y` text changes don't move the prev/next buttons (snapshot test of prev button's `getBoundingClientRect().left` at two different page numbers)

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** `buildGalleryInfoRow`:

```ts
function buildGalleryInfoRow(opts: GalleryBarOpts): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pyr3-info-row pyr3-info-row--gallery';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '1fr auto 1fr';
  row.style.alignItems = 'center';
  row.style.gap = '16px';
  row.style.padding = '10px 18px';
  row.style.minHeight = '48px';

  const left = document.createElement('div');   // empty placeholder, keeps center centered
  const center = buildPageNavCluster(opts);     // ‹prev · "page N of M" · next› · 🎲 random page
  const right = buildFilterButton(opts);        // 🧰 Filter ▾ (with count badge)

  row.appendChild(left);
  row.appendChild(center);
  row.appendChild(right);
  return row;
}

function buildPageNavCluster(opts: GalleryBarOpts): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-page-nav';
  // …prev pill, page text (`min-width: 160px`, text-align: center), next pill, 🎲 random pill…
  return wrap;
}
```

- [ ] **Step 4: Verify pass + typecheck**
- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(gallery): three-col info row, page-nav centered, filter btn right"
```

### Task 4.2: Tile grid — 3×3 square aspect + ID label below

**Files:** Modify `src/gallery-mount.ts` · `src/gallery-mount.test.ts`

- [ ] **Step 1: Failing tests:**
  1. Grid has `grid-template-columns: repeat(3, 1fr)`
  2. Each tile element has `aspect-ratio: 1` (square)
  3. Each tile has a `<div class="pyr3-tile-id">` child with text `<gen>/<id>`
  4. Click on either the tile or the id navigates to viewer for that flame (existing behavior, but reassert)

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** Update the tile-grid builder in `gallery-mount.ts`:

```ts
function buildTile(corpusEntry: { gen: number; id: number; thumbUrl: string }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-tile-wrap';
  wrap.style.cursor = 'pointer';
  wrap.addEventListener('click', () => {
    window.location.href = `/v1/gen/${corpusEntry.gen}/id/${corpusEntry.id}`;
  });

  const img = document.createElement('img');
  img.className = 'pyr3-tile';
  img.style.aspectRatio = '1';
  img.style.width = '100%';
  img.src = corpusEntry.thumbUrl;

  const label = document.createElement('div');
  label.className = 'pyr3-tile-id';
  label.textContent = `${corpusEntry.gen}/${String(corpusEntry.id).padStart(5, '0')}`;
  label.style.textAlign = 'center';
  label.style.color = COLORS.text.dim;
  label.style.fontFamily = 'ui-monospace, monospace';
  label.style.fontSize = '12px';
  label.style.marginTop = '10px';

  wrap.appendChild(img);
  wrap.appendChild(label);
  return wrap;
}
```

- [ ] **Step 4: Update tile container** to use `grid-template-columns: repeat(3, 1fr)` and the `gap: 26px` per the locked layout.

- [ ] **Step 5: Verify pass + typecheck**
- [ ] **Step 6: Commit**

```bash
git add src/gallery-mount.ts src/gallery-mount.test.ts
git commit -m "feat(gallery): 3x3 square tiles with <gen>/<id> link below"
```

### Task 4.3: Phase 4 verification

- [ ] **Run:** `npm run typecheck && npm test`
- [ ] **Lead-inline Chrome verify:** `/showcase` shows 9 square tiles in a 3×3, IDs visible below each, click-to-viewer works.

---

## Phase 5 — Gallery filter rework

**Goal:** Replace the current filter panel with a progressive-disclosure layout: active-chip strip at top, sort + variations + collapsible metric rows with brush-select histograms; plain-English filter labels (`interest → interestingness`, etc.).

**Files:**
- Modify: `src/gallery-filter-ui.ts` (replace existing UI; keep `gallery-filter.ts` mechanism unchanged)
- Modify: `src/gallery-facets.ts` (label mapping)
- New: `src/gallery-filter-ui.test.ts` E2E for brush-select via Playwright

### Task 5.1: Plain-English label mapping

**Files:** Modify `src/gallery-facets.ts` · `src/gallery-facets.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { FILTER_LABEL_MAP } from './gallery-facets';

describe('plain-english filter labels', () => {
  it('maps internal facet keys to user-facing names', () => {
    expect(FILTER_LABEL_MAP.interest).toBe('interestingness');
    expect(FILTER_LABEL_MAP.colorVar).toBe('color variation');
    expect(FILTER_LABEL_MAP.meanLum).toBe('brightness');
    expect(FILTER_LABEL_MAP.entropy).toBe('complexity');
    expect(FILTER_LABEL_MAP.coverage).toBe('coverage');
    expect(FILTER_LABEL_MAP.xforms).toBe('xform count');
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** in `gallery-facets.ts`:

```ts
export const FILTER_LABEL_MAP = {
  interest:  'interestingness',
  coverage:  'coverage',
  entropy:   'complexity',
  colorVar:  'color variation',
  meanLum:   'brightness',
  xforms:    'xform count',
} as const;
```

- [ ] **Step 4: Verify pass + typecheck**
- [ ] **Step 5: Commit**

```bash
git add src/gallery-facets.ts src/gallery-facets.test.ts
git commit -m "feat(gallery-filter): plain-english label mapping"
```

### Task 5.2: Active filter chip strip

**Files:** Modify `src/gallery-filter-ui.ts`

- [ ] **Step 1: Failing test** — when 3 filters active, render 3 chips in order; click × on a chip removes that filter.

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** `buildActiveChipStrip(state, onRemove)` — see spec § "Gallery filter rework".

- [ ] **Step 4: Wire into the filter panel mount**

- [ ] **Step 5: Verify pass + commit**

```bash
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter): active-chip strip with one-click remove"
```

### Task 5.3: Sort dropdown + direction toggle

**Files:** Modify `src/gallery-filter-ui.ts`

- [ ] **Step 1: Failing test** — dropdown lists sort options; direction toggle swaps asc/desc.
- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify pass + commit**

```bash
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter): sort dropdown + direction toggle"
```

### Task 5.4: Collapsible metric rows with histogram + range value

**Files:** Modify `src/gallery-filter-ui.ts`

- [ ] **Step 1: Failing tests** for each metric:
  - Header collapsed → only name + current range value
  - Header expanded → histogram (10 buckets) + edge brackets at current range bounds + range value text

- [ ] **Step 2: Implement** the row builder. Each row has a click-to-expand chevron.

- [ ] **Step 3: Compute the histogram** from the existing facet data (`gallery-facets.ts` already provides counts per bucket).

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/gallery-filter-ui.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter): collapsible metric rows with histogram"
```

### Task 5.5: Brush-select drag gesture on the histogram

**Files:** Modify `src/gallery-filter-ui.ts` · NEW `src/gallery-filter-brush.test.ts` (Playwright)

- [ ] **Step 1: Implement brush-select**

```ts
function attachBrushSelect(histogram: HTMLElement, onRange: (min: number, max: number) => void): void {
  let dragStart: number | null = null;
  histogram.addEventListener('mousedown', (ev) => {
    dragStart = bucketAt(ev.offsetX, histogram);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
  });
  function onMove(ev: MouseEvent) {
    if (dragStart === null) return;
    const r = histogram.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const cur = bucketAt(x, histogram);
    const [lo, hi] = [Math.min(dragStart, cur), Math.max(dragStart, cur)];
    onRange(lo, hi);
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    dragStart = null;
  }
}
function bucketAt(x: number, el: HTMLElement): number { /* maps pixel → 0..9 bucket */ }
```

- [ ] **Step 2: Add a hover-tooltip** ("click & drag to select range") on first row.

- [ ] **Step 3: Playwright E2E test** — drag from bucket-3 to bucket-7, assert state.activeRange = [0.3, 0.7].

(Drag gesture via Playwright `mouse.down()` / `mouse.move()` / `mouse.up()` for real mousedown→mouseup pairing. See CLAUDE.md note on per-frame `replaceChildren` + click bug — real-mouse needed, not MCP uid-click.)

- [ ] **Step 4: Run E2E:** `npx playwright test src/gallery-filter-brush.test.ts`
- [ ] **Step 5: Commit**

```bash
git add src/gallery-filter-ui.ts src/gallery-filter-brush.test.ts playwright.config.ts
git commit -m "feat(gallery-filter): brush-select drag on histogram buckets"
```

### Task 5.6: Apply / Reset footer + filter button badge wiring

**Files:** Modify `src/gallery-filter-ui.ts`, `src/ui-bar.ts` (filter button)

- [ ] **Step 1: Implement footer** — `Reset` + `Apply (N matches)` buttons.
- [ ] **Step 2: Filter button** in info row shows count badge when filters > 0.
- [ ] **Step 3: Verify pass + commit**

```bash
git add src/gallery-filter-ui.ts src/ui-bar.ts src/gallery-filter-ui.test.ts
git commit -m "feat(gallery-filter): footer apply/reset + count badge wiring"
```

### Task 5.7: Phase 5 verification

- [ ] `npm run typecheck && npm test && npx playwright test`
- [ ] Lead-inline Chrome verify: `/showcase` → click `🧰 Filter` → panel opens; chips visible; metric rows collapse/expand; brush-select drags work; count updates live.

---

## Phase 6 — Editor chrome + state persistence

**Goal:** Editor's top bar adopts the new chrome (already done in Phase 1's refactor of `mountEditBar`); editor's info row carries editable name+nick+dims; editor's action row matches viewer's pattern with `🎲 Reroll` added; localStorage round-trip persists WIP genome + section-collapse state.

**Files:**
- Modify: `src/ui-bar.ts` (`buildEditorInfoRow`, `buildEditorActionRow`)
- Modify: `src/edit-state.ts` (localStorage round-trip for WIP genome)
- Modify: `src/edit-mount.ts` (cold-start logic; localStorage hydration)

### Task 6.1: Editor info row — editable name + nick + dims

**Files:** Modify `src/ui-bar.ts` · `src/ui-bar.test.ts`

- [ ] **Step 1: Failing tests:**
  - Name input renders with dashed-underline styling at rest
  - Edit fires `onNameChange`
  - Same for nick

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** `buildEditorInfoRow(opts)` using `<input>` elements styled per the locked design.

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(editor): info row with editable name + nick + dims"
```

### Task 6.2: Editor action row matches viewer pattern + Reroll button

**Files:** Modify `src/ui-bar.ts`

- [ ] **Step 1: Failing test** — action row shows `📂 Open · 🎲 Reroll · 📐 Size ▾ · QUALITY [10 25 50 75 100] · 🧬 Save Flame · 💾 Save Render`.

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.** Reuse the same primitives as Phase 3's viewer action row (size dropdown + quality numeric group + save buttons). Add `🎲 Reroll` button (handler invokes existing reroll path).

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/ui-bar.ts src/ui-bar.test.ts
git commit -m "feat(editor): action row matches viewer pattern + Reroll added"
```

### Task 6.3: WIP genome persistence to localStorage

**Files:** Modify `src/edit-state.ts` · `src/edit-state.test.ts`

- [ ] **Step 1: Failing tests:**
  - `persistWip(genome)` writes to `localStorage` under key `pyr3.editor.wip`
  - `restoreWip()` returns the persisted genome (or null)
  - Mutating state debounce-persists (within ~200ms of last edit)

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.**

```ts
const WIP_KEY = 'pyr3.editor.wip';

export function persistWip(genome: Genome): void {
  localStorage.setItem(WIP_KEY, JSON.stringify(genome));
}

export function restoreWip(): Genome | null {
  const raw = localStorage.getItem(WIP_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Genome; } catch { return null; }
}

// Debounced persistence
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePersist(genome: Genome): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => persistWip(genome), 200);
}
```

- [ ] **Step 4: Wire `schedulePersist` into the existing state mutator** so any edit triggers a debounced save.

- [ ] **Step 5: Verify pass + commit**

```bash
git add src/edit-state.ts src/edit-state.test.ts
git commit -m "feat(editor): debounced localStorage round-trip for WIP genome"
```

### Task 6.4: Section-collapse state persistence

**Files:** Modify `src/edit-state.ts`

- [ ] **Step 1: Failing test** — toggling a section persists to localStorage; cold-start reads it back.

- [ ] **Step 2: Implement** under a separate key `pyr3.editor.sectionCollapse` (independent from WIP).

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-state.ts src/edit-state.test.ts
git commit -m "feat(editor): persist per-section collapse state across reloads"
```

### Task 6.5: Cold-start hydration logic

**Files:** Modify `src/edit-mount.ts` · `src/edit-mount.test.ts`

- [ ] **Step 1: Failing test:**
  - When `localStorage.pyr3.editor.wip` is non-empty → editor loads with that genome
  - When empty → random reroll runs (existing `rerollSeed()` path)

- [ ] **Step 2: Implement** cold-start in `mountEdit`:

```ts
const wip = restoreWip();
const startGenome = wip ?? rerollGenome();   // existing fn
state.setGenome(startGenome);
```

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-mount.ts src/edit-mount.test.ts
git commit -m "feat(editor): cold-start hydrates from localStorage WIP or random reroll"
```

### Task 6.6: Phase 6 verification

- [ ] `npm run typecheck && npm test`
- [ ] Lead-inline: open `/v1/edit`, make an edit, refresh — edit persists.

---

## Phase 7 — Editor body primitives + section reflows

**Goal:** Land shared primitives (row, input, slider-with-value, color swatch, toggle, remove button, button tiers, info-icon + tooltip) and refactor each of the 7 sections to use them. Includes the W×H pair fix, GLOBAL reflow, VIEWPORT fit button, Density preset strip.

**Files:**
- Create: `src/edit-primitives.ts` · `src/edit-primitives.test.ts`
- Create: `src/edit-tooltip.ts` · `src/edit-tooltip.test.ts`
- Create: `src/edit-preset-density.ts` · `src/edit-preset-density.test.ts`
- Modify: `src/edit-section-render.ts`, `-global.ts`, `-viewport.ts`, `-density.ts`, `-final.ts` (also `-palette.ts` in Phase 9, `-xforms.ts` in Phase 8)

### Task 7.1: `edit-primitives.ts` — row + input + dropdown + color swatch

**Files:** Create `src/edit-primitives.ts` · `src/edit-primitives.test.ts`

- [ ] **Step 1: Failing tests** for each primitive's class names + structure.

- [ ] **Step 2: Implement** the builder functions:

```ts
import { COLORS } from './ui-tokens';

export function buildRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pyr3-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '96px 1fr';
  row.style.alignItems = 'center';
  row.style.gap = '12px';
  row.style.minHeight = '28px';

  const lbl = document.createElement('span');
  lbl.className = 'pyr3-lbl';
  lbl.textContent = label;
  lbl.style.color = COLORS.text.muted;
  lbl.style.fontSize = '12px';

  const ctrl = document.createElement('div');
  ctrl.className = 'pyr3-ctrl';
  ctrl.style.display = 'flex';
  ctrl.style.alignItems = 'center';
  ctrl.style.gap = '6px';
  ctrl.style.minWidth = '0';
  ctrl.appendChild(control);

  row.appendChild(lbl);
  row.appendChild(ctrl);
  return row;
}

// CRITICAL: every editor number input MUST be scrubby (drag-to-scrub, #105).
// Delegates to the shipped scrubbyInput() so no section can regress to plain <input>.
import { scrubbyInput, type FieldKind, type ScrubbyHandle } from './edit-scrubby-input';

export function buildNumberInput(opts: {
  value: number;
  kind: FieldKind;            // existing FieldKind from edit-scrubby-input.ts (int / float / angle / …)
  min?: number; max?: number; step?: number; precision?: number;
  onChange: (n: number) => void;
}): { el: HTMLElement; handle: ScrubbyHandle } {
  const sb = scrubbyInput({
    value: opts.value,
    kind: opts.kind,
    min: opts.min, max: opts.max, step: opts.step, precision: opts.precision,
    onChange: opts.onChange,
    className: 'pyr3-input',   // matches our row-pattern styling
  });
  // sb.el is the input; apply the row-control width policy via the same classes/styles
  sb.el.style.flex = '1 1 0';
  sb.el.style.minWidth = '0';
  sb.el.style.textAlign = 'right';
  sb.el.style.fontVariantNumeric = 'tabular-nums';
  return { el: sb.el, handle: sb };
}
// …buildDropdown, buildColorSwatch, buildPair (W×H or x,y), etc…
```

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-primitives.ts src/edit-primitives.test.ts
git commit -m "feat(edit-primitives): row + input + dropdown + color swatch + pair"
```

### Task 7.2: Slider-with-value primitive

**Files:** Modify `src/edit-primitives.ts`

- [ ] **Step 1: Failing test** — slider element + value display element + drag updates value display.
- [ ] **Step 2: Implement.** **MUST** delegate to `scrubbyInput()` from `src/edit-scrubby-input.ts` for the drag-to-scrub gesture — the slider primitive is the rail/handle/value-display chrome wrapper around a scrubby input. Scrubby ships in #105 and is non-negotiable for editor numeric controls.

```ts
export function buildSlider(opts: {
  value: number; min: number; max: number; step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}): HTMLElement {
  // rail + fill + handle + value display
}
```

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-primitives.ts src/edit-primitives.test.ts
git commit -m "feat(edit-primitives): slider with always-visible value display"
```

### Task 7.3: Toggle pill + remove button

**Files:** Modify `src/edit-primitives.ts` · `src/edit-primitives.test.ts`

- [ ] **Step 1: Failing tests** for `buildToggle({value, onChange})` (pill switch) and `buildRemoveButton({onClick})` (× with hover-danger).

- [ ] **Step 2: Implement.** Toggle uses CSS class `pyr3-toggle on` / `pyr3-toggle`. Remove uses class `pyr3-remove-btn` and a `style.color = COLORS.danger` on hover.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-primitives.ts src/edit-primitives.test.ts
git commit -m "feat(edit-primitives): toggle pill + remove button widgets"
```

### Task 7.4: Button tiers — `btn`, `btn-accent`, `btn-primary`

**Files:** Modify `src/edit-primitives.ts`

- [ ] **Step 1: Failing tests** for `buildButton({variant: 'plain'|'accent'|'primary', label, onClick})`.
- [ ] **Step 2: Implement** with the styling per spec.
- [ ] **Step 3: Commit**

```bash
git add src/edit-primitives.ts src/edit-primitives.test.ts
git commit -m "feat(edit-primitives): button tiers — plain, accent, primary"
```

### Task 7.5: Tooltip popover primitive (`edit-tooltip.ts`)

**Files:** Create `src/edit-tooltip.ts` · `src/edit-tooltip.test.ts`

- [ ] **Step 1: Failing tests:**
  - `buildInfoIcon({content})` returns a `?` icon
  - Click toggles a popover anchored to the right of the icon's nearest `.pyr3-section`
  - Click outside dismisses
  - When right has no room (viewport edge), falls back to left

- [ ] **Step 2: Implement.**

```ts
export function buildInfoIcon(opts: { title: string; body: string; hint?: string }): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'pyr3-info-icon';
  icon.textContent = '?';
  icon.style.cursor = 'help';
  // …styling…
  icon.addEventListener('click', () => toggleTooltip(icon, opts));
  return icon;
}

function toggleTooltip(anchor: HTMLElement, opts: { title: string; body: string; hint?: string }): void {
  const existing = document.querySelector('.pyr3-tooltip');
  if (existing) { existing.remove(); return; }
  const tip = buildTooltip(opts);
  const sect = anchor.closest('.pyr3-section');
  if (sect) anchorTooltipRight(tip, sect as HTMLElement);
  document.body.appendChild(tip);
  // click-outside dismissal:
  setTimeout(() => {
    document.addEventListener('click', dismissOnce, { capture: true, once: true });
  }, 0);
  function dismissOnce(ev: MouseEvent) {
    if (!tip.contains(ev.target as Node)) tip.remove();
  }
}

function anchorTooltipRight(tip: HTMLElement, sect: HTMLElement): void {
  const r = sect.getBoundingClientRect();
  const tipWidth = 260;
  if (r.right + 14 + tipWidth < window.innerWidth) {
    tip.style.left = `${r.right + 14}px`;
  } else {
    tip.style.left = `${r.left - tipWidth - 14}px`;
  }
  tip.style.top = `${r.top + 60}px`;   // anchored to icon's row
}
```

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-tooltip.ts src/edit-tooltip.test.ts
git commit -m "feat(edit-tooltip): info-icon + anchored popover (right with left fallback)"
```

### Task 7.6: Density Emitter preset strip + values

**Files:** Create `src/edit-preset-density.ts` · `src/edit-preset-density.test.ts`

- [ ] **Step 1: Failing tests:**
  - `DENSITY_PRESETS` has 6 entries: `default · soft · vivid · punchy · cinematic · crystal`
  - Each preset has all five fields (`gamma`, `gammaThreshold`, `vibrancy`, `brightness`, `contrast`)
  - `currentPresetName(state)` returns the active preset name when state matches, `null` when dirty

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement** with TUNING-FLAG comments — these numeric values are placeholders to be replaced by curated values during the verify phase per the spec's `OPEN` flag:

```ts
export interface DensityPreset {
  name: string;
  vibe: string;             // hex color dot
  gamma: number;
  gammaThreshold: number;
  vibrancy: number;
  brightness: number;
  contrast: number;
}

// TUNING-FLAG: placeholder values; calibrate against sample flames before lock
export const DENSITY_PRESETS: DensityPreset[] = [
  { name: 'default',   vibe: '#888888', gamma: 2.5, gammaThreshold: 0.01,  vibrancy: 1.0, brightness: 4.0, contrast: 1.0 },
  { name: 'soft',      vibe: '#aabcde', gamma: 3.0, gammaThreshold: 0.02,  vibrancy: 0.8, brightness: 3.5, contrast: 0.9 },
  { name: 'vivid',     vibe: '#ff5030', gamma: 2.0, gammaThreshold: 0.005, vibrancy: 1.5, brightness: 5.0, contrast: 1.3 },
  { name: 'punchy',    vibe: '#ffbe3e', gamma: 1.5, gammaThreshold: 0.001, vibrancy: 1.2, brightness: 6.0, contrast: 1.5 },
  { name: 'cinematic', vibe: '#603020', gamma: 4.0, gammaThreshold: 0.05,  vibrancy: 0.6, brightness: 2.5, contrast: 0.8 },
  { name: 'crystal',   vibe: '#a0c8ff', gamma: 2.2, gammaThreshold: 0.001, vibrancy: 1.4, brightness: 4.5, contrast: 1.2 },
];

export function currentPresetName(state: {
  gamma: number; gammaThreshold: number; vibrancy: number; brightness: number; contrast: number;
}): { name: string; dirty: boolean } | null {
  for (const p of DENSITY_PRESETS) {
    const matches = approxEq(p.gamma, state.gamma)
      && approxEq(p.gammaThreshold, state.gammaThreshold)
      && approxEq(p.vibrancy, state.vibrancy)
      && approxEq(p.brightness, state.brightness)
      && approxEq(p.contrast, state.contrast);
    if (matches) return { name: p.name, dirty: false };
  }
  // None match exactly — if the user touched values starting from a known preset, return that as dirty.
  // (Store last-applied preset in editor state; here we just say "no preset" if no match.)
  return null;
}

function approxEq(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) < eps; }
```

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/edit-preset-density.ts src/edit-preset-density.test.ts
git commit -m "feat(edit-preset-density): preset list + dirty-state helper (TUNING-FLAG)"
```

### Task 7.7: Refactor Render section to row primitives + W×H fix

**Files:** Modify `src/edit-section-render.ts` · `src/edit-section-render.test.ts`

- [ ] **Step 1: Failing test** — the W×H row uses `buildPair()` with `grid-template-columns: 1fr auto 1fr`; both inputs visible at narrow widths.

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Refactor** the entire section to consume `buildRow`, `buildNumberInput`, `buildDropdown`, `buildPair`. Wire the existing handlers unchanged. Add size dropdown that pulls from `SIZE_PRESETS` (shared with viewer).

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/edit-section-render.ts src/edit-section-render.test.ts
git commit -m "refactor(edit-section-render): adopt row primitives; W×H pair fixed"
```

### Task 7.8: Refactor Global section

**Files:** Modify `src/edit-section-global.ts` · `src/edit-section-global.test.ts`

- [ ] **Step 1: Failing tests:**
  - Vibrancy row uses `buildSlider` with always-visible numeric value
  - Background row uses `buildColorSwatch` filling the control column
  - Symmetry row uses `buildRow` with checkbox + dropdown + count input in the grid

- [ ] **Step 2: Refactor.** Drop the "cluster" layout from image #15.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-global.ts src/edit-section-global.test.ts
git commit -m "refactor(edit-section-global): vibrancy/bg/symmetry adopt row pattern"
```

### Task 7.9: Refactor Viewport section + fit button as btn-accent

**Files:** Modify `src/edit-section-viewport.ts` · `src/edit-section-viewport.test.ts`

- [ ] **Step 1: Failing test** — `🎯 fit` button uses `buildButton({variant: 'accent'})`.
- [ ] **Step 2: Refactor.**
- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-viewport.ts src/edit-section-viewport.test.ts
git commit -m "refactor(edit-section-viewport): 🎯 fit as btn-accent; row pattern"
```

### Task 7.10: Refactor Density section + mount preset strip + tooltips

**Files:** Modify `src/edit-section-density.ts` · `src/edit-section-density.test.ts`

- [ ] **Step 1: Failing tests:**
  - Preset strip renders at top of section body with 6 buttons
  - Clicking a preset applies all five values
  - Section header shows preset chip; dirty state appends `*`
  - Tooltip `?` icons render for each labeled field

- [ ] **Step 2: Refactor** using `buildRow`, `buildSlider`, `buildInfoIcon`, `DENSITY_PRESETS`, `currentPresetName`.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-density.ts src/edit-section-density.test.ts
git commit -m "refactor(edit-section-density): preset strip + tooltips + row primitives"
```

### Task 7.11: Refactor Final xform section

**Files:** Modify `src/edit-section-final.ts` · `src/edit-section-final.test.ts`

- [ ] **Step 1: Failing tests** for the same row pattern + quick-ops strip + reset-to-identity action.
- [ ] **Step 2: Refactor.**
- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-final.ts src/edit-section-final.test.ts
git commit -m "refactor(edit-section-final): adopt row primitives + quick-ops + reset action"
```

### Task 7.12: Phase 7 verification

- [ ] `npm run typecheck && npm test`
- [ ] Lead-inline: open `/v1/edit`, expand each section, verify every row lines up; preset strip and dirty-state work on Density.

---

## Phase 8 — Editor xforms internals

**Goal:** Refactor the Xforms panel to use the locked toggle pill, remove button, inactive-state styling, and the new "quick ops" relative modifiers (replaces "shape presets").

**Files:**
- Modify: `src/edit-section-xforms.ts` · `src/edit-section-xforms.test.ts`
- RENAME: `src/edit-xform-presets.ts` → `src/edit-xform-quickops.ts` (and tests)

### Task 8.1: Rename `edit-xform-presets.ts` → `edit-xform-quickops.ts`

**Files:** Move file + update imports

- [ ] **Step 1: `git mv src/edit-xform-presets.ts src/edit-xform-quickops.ts && git mv src/edit-xform-presets.test.ts src/edit-xform-quickops.test.ts`**
- [ ] **Step 2: Update all imports across `src/*.ts`** (grep `edit-xform-presets`, replace).
- [ ] **Step 3: Run tests to verify nothing breaks.**
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename edit-xform-presets → edit-xform-quickops"
```

### Task 8.2: Rewrite the op set as relative modifiers

**Files:** Modify `src/edit-xform-quickops.ts` · `src/edit-xform-quickops.test.ts`

- [ ] **Step 1: Failing tests** for each op:

```ts
it('rotate +45° adds 45 to current rotation, modular 360', () => {
  const decomposed = { scaleX: 1, scaleY: 1, rotation: 30, shear: 0, posX: 0, posY: 0 };
  const next = applyQuickOp('rotate+45', decomposed);
  expect(next.rotation).toBe(75);
});

it('scale ×½ divides both scale x and scale y by 2', () => {
  const decomposed = { scaleX: 2, scaleY: 4, rotation: 0, shear: 0, posX: 0, posY: 0 };
  const next = applyQuickOp('scaleHalf', decomposed);
  expect(next.scaleX).toBe(1);
  expect(next.scaleY).toBe(2);
});

// …flipY, flipX, shear+0.1, rotate-45…
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement.**

```ts
export type QuickOpId =
  | 'rotate+45' | 'rotate-45'
  | 'scale2x' | 'scaleHalf'
  | 'flipY' | 'flipX'
  | 'shear+0.1';

export interface DecomposedAffine {
  scaleX: number; scaleY: number; rotation: number; shear: number; posX: number; posY: number;
}

export function applyQuickOp(op: QuickOpId, d: DecomposedAffine): DecomposedAffine {
  const next = { ...d };
  switch (op) {
    case 'rotate+45':   next.rotation = (next.rotation + 45) % 360; break;
    case 'rotate-45':   next.rotation = (next.rotation - 45 + 360) % 360; break;
    case 'scale2x':     next.scaleX *= 2; next.scaleY *= 2; break;
    case 'scaleHalf':   next.scaleX /= 2; next.scaleY /= 2; break;
    case 'flipY':       next.scaleY = -next.scaleY; break;
    case 'flipX':       next.scaleX = -next.scaleX; break;
    case 'shear+0.1':   next.shear += 0.1; break;
  }
  return next;
}

export const QUICK_OPS_DEFS: { id: QuickOpId; label: string; delta: string; icon: string }[] = [
  { id: 'rotate+45', label: 'rotate', delta: '+45°', icon: '↻' },
  { id: 'rotate-45', label: 'rotate', delta: '−45°', icon: '↺' },
  { id: 'scale2x',   label: 'scale',  delta: '×2',   icon: '⤢' },
  { id: 'scaleHalf', label: 'scale',  delta: '×½',   icon: '⤡' },
  { id: 'flipY',     label: 'flip y', delta: '',     icon: '⇕' },
  { id: 'flipX',     label: 'flip x', delta: '',     icon: '⇔' },
  { id: 'shear+0.1', label: 'shear',  delta: '+0.1', icon: '⇄' },
];
```

(No `rotate+90°`; user hits `rotate+45°` twice.)

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/edit-xform-quickops.ts src/edit-xform-quickops.test.ts
git commit -m "feat(edit-xform-quickops): relative modifier ops (no presets)"
```

### Task 8.3: Quick-ops strip UI + reset-to-identity action

**Files:** Modify `src/edit-section-xforms.ts` (and `-final.ts` since both use same affine block)

- [ ] **Step 1: Failing tests:**
  - Strip renders 7 buttons from `QUICK_OPS_DEFS`
  - Click → invokes `applyQuickOp` + persists to state
  - Below the strip, a separate `⟲ reset to identity` button uses `btn-accent` styling

- [ ] **Step 2: Implement.** Use `buildButton({variant: 'btn-mod'})` — add `btn-mod` variant (the relative-modifier style from the mockup) to `edit-primitives.ts` if not already there.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-xforms.ts src/edit-section-final.ts src/edit-primitives.ts
git commit -m "feat(editor): quick-ops strip + separate reset-to-identity action"
```

### Task 8.4: Toggle widget + remove button on xform headers

**Files:** Modify `src/edit-section-xforms.ts`

- [ ] **Step 1: Failing tests:**
  - Xform header includes `pyr3-toggle` + `pyr3-remove-btn` widgets
  - Toggle off → header gets `inactive` class; body opacity drops to 0.4 + `pointer-events: none`
  - Shift+click toggle solos (per existing #102 contract; verify still works)
  - Remove button click invokes `state.removeXform(idx)` without confirmation

- [ ] **Step 2: Implement.** Replace the existing header layout with the grid `[chev | title | meta | toggle | remove]` per spec.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-xforms.ts src/edit-section-xforms.test.ts
git commit -m "feat(editor): xform header — toggle + remove + inactive styling"
```

### Task 8.5: Variation row — toggle + remove + weight input

**Files:** Modify `src/edit-section-xforms.ts` (variation list builder)

- [ ] **Step 1: Failing tests** for the row pattern `[toggle | name | weight | remove]`.
- [ ] **Step 2: Implement** using the shared primitives.
- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-xforms.ts src/edit-section-xforms.test.ts
git commit -m "feat(editor): variation row — toggle + name + weight + remove"
```

### Task 8.6: COLOR + POST-TRANSFORM + XAOS sub-sections adopt row pattern

**Files:** Modify `src/edit-section-xforms.ts`

- [ ] **Step 1: Failing tests** that each sub-section uses `buildRow` with `buildSlider` (with value display) for COLOR sliders; standard inputs for XAOS; toggle pill for POST-TRANSFORM.

- [ ] **Step 2: Refactor.** Drop the blue accent on sliders — they'll inherit the flame palette from primitives.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-xforms.ts src/edit-section-xforms.test.ts
git commit -m "refactor(editor): COLOR/POST-TRANSFORM/XAOS sub-sections adopt row pattern"
```

### Task 8.7: Phase 8 verification

- [ ] `npm run typecheck && npm test`
- [ ] Lead-inline: every xform's affine block lines up; quick-ops apply incrementally; reset-to-identity snaps clean; toggle + remove behave correctly; COLOR sliders are flame-amber.

---

## Phase 9 — Palette subpanel + picker

**Goal:** Land the live-rotating palette ribbon, palette identifier-format logic, and the docked palette picker with color-filter chips + favorites.

**Files:**
- Modify: `src/edit-section-palette.ts` · `src/edit-section-palette.test.ts`
- Create: `src/palette-picker.ts` · `src/palette-picker.test.ts`
- Modify: `src/flam3-palette-names.ts` (extend) and add `paletteIdentifier(source)` helper

### Task 9.1: Palette identifier format helper

**Files:** Modify `src/flam3-palette-names.ts` · `src/flam3-palette-names.test.ts`

- [ ] **Step 1: Failing tests:**

```ts
import { paletteIdentifier } from './flam3-palette-names';
expect(paletteIdentifier({ kind: 'corpus', gen: 198, id: 7372 }))
  .toEqual({ prefix: null, name: '198/07372', monospace: true });
expect(paletteIdentifier({ kind: 'flam3', number: 247 }))
  .toEqual({ prefix: 'flam3', name: '"sky flesh"', monospace: false });
expect(paletteIdentifier({ kind: 'flam3', number: 999999 }))  // unnamed fallback
  .toEqual({ prefix: 'flam3', name: '#999999', monospace: true });
```

- [ ] **Step 2: Implement** the helper using the existing `flam3PaletteNames` table for name lookup; fallback to `#<N>` when nameless.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/flam3-palette-names.ts src/flam3-palette-names.test.ts
git commit -m "feat(palette): paletteIdentifier({kind, ...}) helper for launcher button"
```

### Task 9.2: Palette subpanel — ribbon + hue + launcher

**Files:** Modify `src/edit-section-palette.ts` · `src/edit-section-palette.test.ts`

- [ ] **Step 1: Failing tests:**
  - Ribbon element has `filter: hue-rotate(<deg>deg)` style bound to state
  - Scrubbing hue slider updates the ribbon's CSS custom property
  - Launcher button text matches `paletteIdentifier(state.paletteSource)`
  - Inline `⟲ reset hue` action uses `btn-accent` styling
  - Section header chip shows `hue +30°` when rotation is 30

- [ ] **Step 2: Implement** the section body with `buildRow` for hue + launcher, plus the full-width ribbon at top (NOT a row — exception to the grid).

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-palette.ts src/edit-section-palette.test.ts
git commit -m "feat(palette): subpanel — live-rotating ribbon + hue + launcher + reset"
```

### Task 9.3: Palette picker — sidecar shell

**Files:** Create `src/palette-picker.ts` · `src/palette-picker.test.ts`

- [ ] **Step 1: Failing tests:**
  - `mountPalettePicker(root, opts)` renders the docked sidecar
  - Header has title + badge + close-x + search input + color-filter chips + tabs + sort + auto-apply toggle
  - Footer has selected info + revert + apply&close

- [ ] **Step 2: Implement** the shell. Use shared `edit-primitives.ts` widgets for inputs / dropdowns / toggles. Style per the locked design.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/palette-picker.ts src/palette-picker.test.ts
git commit -m "feat(palette-picker): sidecar shell — header + footer + tabs"
```

### Task 9.4: 3-col palette cell grid + search filter

**Files:** Modify `src/palette-picker.ts`

- [ ] **Step 1: Failing tests:**
  - Body renders cells in a 3-col grid
  - Each cell = ribbon (36px) + name + star
  - Typing in the search filters cells live (case-insensitive substring)
  - Active cell has amber border

- [ ] **Step 2: Implement** the cell builder and live-filter.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/palette-picker.ts src/palette-picker.test.ts
git commit -m "feat(palette-picker): 3-col cell grid + live search filter"
```

### Task 9.5: Color filter chips with OR-logic, ANDed with search

**Files:** Modify `src/palette-picker.ts` + new tagging helper

- [ ] **Step 1: Failing tests:**
  - 11 chips render with their canonical color swatches
  - Click toggles the chip
  - When ≥1 chip on, only palettes with at least one matching dominant-color tag remain
  - Combines with search via AND
  - `clear` link resets all chips

- [ ] **Step 2: Build a palette dominant-color tagging step.** This is the OPEN spec item. Implementation choice: compute at build time from the 701 palette data; tag with `red | orange | yellow | green | blue | purple | pink | brown | pastel | dark | gray`. Use a simple HSL-bucketing algorithm with thresholds calibrated against a sample of named palettes:

```ts
// src/palette-tags.ts (new)
export type ColorTag = 'red'|'orange'|'yellow'|'green'|'blue'|'purple'|'pink'|'brown'|'pastel'|'dark'|'gray';
export function computeTags(paletteRgb: Uint8ClampedArray): ColorTag[] {
  // 1. Sample N representative colors (e.g., every 16 indices = 16 samples per 256-cell palette)
  // 2. Convert each to HSL
  // 3. Classify by H/S/L ranges (with calibration knobs in a constants block at top)
  // 4. Return unique tags
}
```

(Calibration thresholds left tunable — flag with `TUNING-FLAG` comments. Iterate during Chrome verify.)

- [ ] **Step 3: Build at compile / startup.** Pre-compute tags for all 701 flam3 palettes once at module-load time (cached); user-saved palettes (future) compute on-save.

- [ ] **Step 4: Verify pass + commit**

```bash
git add src/palette-picker.ts src/palette-tags.ts src/palette-picker.test.ts src/palette-tags.test.ts
git commit -m "feat(palette-picker): 11 color-filter chips with dominant-color tags"
```

### Task 9.6: Favorites tab + localStorage persistence

**Files:** Modify `src/palette-picker.ts`

- [ ] **Step 1: Failing tests:**
  - Click star on a cell toggles favorite
  - Favorites persist to `localStorage.pyr3.palette.favorites` as JSON array of palette IDs
  - "★ favorites" tab filters cells to favorited only
  - Counts update live

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/palette-picker.ts src/palette-picker.test.ts
git commit -m "feat(palette-picker): star favorites persisted to localStorage"
```

### Task 9.7: Wire picker open/close from subpanel + ribbon click

**Files:** Modify `src/edit-section-palette.ts`

- [ ] **Step 1: Failing test** — clicking launcher button OR ribbon opens the picker; clicking ribbon does not also affect hue.

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-section-palette.ts src/edit-section-palette.test.ts
git commit -m "feat(palette): subpanel wires launcher + ribbon clicks to picker"
```

### Task 9.8: Auto-apply toggle + revert + apply&close

**Files:** Modify `src/palette-picker.ts`

- [ ] **Step 1: Failing tests:**
  - When auto-apply ON, clicking a cell instantly invokes the apply callback
  - When OFF, clicking selects but doesn't apply; only `apply & close` does
  - `revert` restores the originally-selected palette

- [ ] **Step 2: Implement.**

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/palette-picker.ts src/palette-picker.test.ts
git commit -m "feat(palette-picker): auto-apply toggle + revert + apply&close"
```

### Task 9.9: Phase 9 verification

- [ ] `npm run typecheck && npm test`
- [ ] Lead-inline: open `/v1/edit`, expand Palette section, scrub hue (ribbon rotates live), click launcher → picker opens; star a palette, switch to favorites tab — only starred appears; color chips filter the grid; apply&close updates the section + closes picker.

---

## Phase 10 — Variation picker

**Goal:** Mirror the palette picker shell for variations; xform-contextual title; **no filter chips** (per user direction); thumbnails reuse current production assets; ★ favorites persisted to its own localStorage key.

**Files:**
- Modify: `src/edit-variation-picker.ts` · `src/edit-variation-picker.test.ts`

### Task 10.1: Refactor variation picker to mirror palette picker shell

**Files:** Modify `src/edit-variation-picker.ts`

- [ ] **Step 1: Failing tests:**
  - Same DOM structure as palette picker (`.pyr3-picker` with `.pyr3-picker-head`, `-body`, `-foot`)
  - Title shows "🧬 Variation picker · xform N"
  - NO `.pyr3-chip-row` element (no filter chips per user spec)
  - Has tabs (all / ★ favorites) + sort + auto-apply

- [ ] **Step 2: Refactor.** Reuse the shared shell helpers from `palette-picker.ts` — extract them to `picker-shell.ts` if helpful.

- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-variation-picker.ts src/edit-variation-picker.test.ts
git commit -m "refactor(variation-picker): mirror palette picker shell; no chips"
```

### Task 10.2: Variation favorites in localStorage

**Files:** Modify `src/edit-variation-picker.ts`

- [ ] **Step 1: Failing tests** — favorites persist under `pyr3.variation.favorites` (separate key from palette favorites).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify pass + commit**

```bash
git add src/edit-variation-picker.ts src/edit-variation-picker.test.ts
git commit -m "feat(variation-picker): ★ favorites persisted to localStorage"
```

### Task 10.3: Phase 10 verification

- [ ] `npm run typecheck && npm test`
- [ ] Lead-inline: in editor, click `+ var` on an xform → variation picker opens with "xform N" title; star variations; favorites tab works.

---

## Phase 11 — Code review (subagent)

**Goal:** Independent review of the full feature branch by a fresh reviewer agent (per global workflow rule "Code review is a required phase").

### Task 11.1: Dispatch `feature-dev:code-reviewer` against the branch diff

- [ ] **Step 1:** Run `git diff main..HEAD --stat` to summarize churn.

- [ ] **Step 2:** Dispatch `feature-dev:code-reviewer` agent with prompt:

> "Review feature/visual-overhaul against `docs/superpowers/specs/2026-06-04-visual-overhaul-design.md`. Focus on: correctness vs spec, the brush-select drag implementation (per CLAUDE.md note on `replaceChildren`+click bug), the localStorage round-trip's robustness against schema migration, the dominant-color tagging algorithm's calibration, the tab-navigation context-transfer rule's correctness on every transition pair, no UX regression on any of the four surfaces, no purple/blue accent left behind. Surface any TUNING-FLAG numeric placeholders the reviewer thinks shouldn't ship as placeholders. Confidence-threshold filter: report high-priority issues only."

- [ ] **Step 3:** Triage the reviewer's findings:
  - Real bugs → file fix tasks at the bottom of the plan
  - Tuning numbers needing calibration → flag for Phase 12 verification
  - Style nits below threshold → ignore

- [ ] **Step 4:** Implement any fix tasks the reviewer surfaces; commit each.

---

## Phase 12 — Chrome verify + ship (lead-inline)

**Goal:** End-to-end visual confirmation on Chrome via the chrome-devtools-mcp plugin. User-verify gate before FF-merge per the global workflow. Tuning calibration for density-preset values + dominant-color tag thresholds.

### Task 12.1: Start dev server + Chrome verify each surface

- [ ] **Step 1:** Lead-inline `npm run dev`.
- [ ] **Step 2:** Hand user clickable `http://localhost:5173/` and verify each surface end-to-end:
  1. `/` viewer — info row with full variations · action row with new Size/QUALITY/Save buttons · Save Render produces correct PNG · Save Flame produces correct .pyr3.json · 🔥 surprise me, prev/next still work
  2. `/showcase` gallery — 3×3 square tiles · IDs visible · click navigates · filter button opens panel · brush-select drag works · plain-English labels visible
  3. `/v1/edit` editor — chrome adoption · info row editable · action row complete · sections collapsed by default · each section uses row pattern · sliders show values · W×H pair unclipped · GLOBAL reflowed · 🎯 fit button visually a button · Density preset strip applies · tooltips anchor right · palette ribbon rotates live · palette picker opens with chips + favorites · variation picker opens with no chips + favorites · quick ops apply incrementally · reset-to-identity snaps · toggle + remove work · inactive xforms dim correctly
  4. `/about` — version chip · lineage · credits · links open externally
- [ ] **Step 3:** Tab-navigation verify per surface pair (see contract in spec).
- [ ] **Step 4:** Persistence verify — edit a flame, refresh page, edit restored. Star a palette, refresh, star persists.
- [ ] **Step 5:** Color verify — `grep -nE "#[0-9a-fA-F]{3,8}" src/*.ts | grep -v ui-tokens | wc -l` should be at or near zero for UI accent colors.

### Task 12.2: Calibrate TUNING-FLAG values with user

- [ ] **Step 1:** Apply each Density preset to a sample flame in Chrome; user evaluates.
- [ ] **Step 2:** Adjust preset numerics until user signs off.
- [ ] **Step 3:** Spot-check dominant-color tagging by switching color filter chips and inspecting results.
- [ ] **Step 4:** Adjust HSL thresholds in `src/palette-tags.ts` until tagging matches intuition.
- [ ] **Step 5:** Commit final tuning values:

```bash
git add src/edit-preset-density.ts src/palette-tags.ts
git commit -m "tune: density preset values + dominant-color thresholds (user-verified)"
```

### Task 12.3: Full test suite green + final docs update

- [ ] **Step 1:** `npm run typecheck && npm test && npx playwright test && npm run test:parity` — all green.
- [ ] **Step 2:** Update `CLAUDE.md` — new entries: tab-nav contract, localStorage key family, new modules (`ui-tokens`, `edit-primitives`, `palette-picker`, `app-state`).
- [ ] **Step 3:** Update `README.md` if any user-facing feature is worth surfacing.
- [ ] **Step 4:** Commit doc updates:

```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md + README for visual overhaul"
```

### Task 12.4: User-verify gate before FF-merge

- [ ] **Step 1:** Hand the user the final dev URL + summary of what to verify.
- [ ] **Step 2:** Wait for explicit "looks good, FF-merge" approval.
- [ ] **Step 3:** Per global rule, "looks good" approves CONTENT only — ask separately: "FF-merge to main? y/n".

### Task 12.5: Squash + FF-merge + close milestone

- [ ] **Step 1:** Once approved, squash all phase commits to a single feat commit on `feature/visual-overhaul`:

```bash
git reset --soft $(git merge-base main HEAD)
git commit -m "feat(visual-overhaul): #103 + #51 + editor body conventions + about page

Locked top bar across all four surfaces in flame palette; viewer/gallery/editor/
about adopt info-only + action-only sub-row split; gallery filter rebuilt with
progressive disclosure + brush-select histograms; editor body adopts shared row
primitives, toggle/remove widgets, quick-ops relative modifiers, density preset
strip, anchored tooltips, palette ribbon + docked picker, variation picker.
About page owns version display.

Closes #103. Closes #51."
```

- [ ] **Step 2:** FF-merge to main:

```bash
git checkout main
git merge --ff-only feature/visual-overhaul
git push origin main
```

- [ ] **Step 3:** Clean up branch per CLAUDE.md standing authorization (session-end + tree-clean):

```bash
git branch -D feature/visual-overhaul
git push origin --delete feature/visual-overhaul
```

- [ ] **Step 4:** Close #103 and #51 with a comment pointing to the merged commit + spec.

---

## Spec coverage self-review

Every locked spec item maps to at least one task:

| Spec section | Tasks |
|---|---|
| Color tokens | 1.1, 1.2 |
| Top bar 44px static + sticky | 1.3, 1.4, 1.5, 1.6 |
| Mockup convention | (artifact already exists in `.superpowers/brainstorm/`; no code task) |
| Per-surface chrome — Viewer | 3.1, 3.2, 3.3 |
| Per-surface chrome — Gallery | 4.1, 4.2, 5.1–5.6 |
| Per-surface chrome — Editor | 6.1, 6.2, 7.1–7.11, 8.1–8.6, 9.1–9.8, 10.1, 10.2 |
| Per-surface chrome — About | 2.4, 2.5, 2.6 |
| Tab navigation contract | 2.1, 2.2, 2.3 |
| Editor body — section default state + persistence | 6.3, 6.4, 6.5 |
| Editor body — cold-start | 6.5 |
| Editor body — row pattern + input primitives | 7.1, 7.2 |
| Editor body — active/inactive toggle | 7.3, 8.4 |
| Editor body — inactive state visual | 8.4 |
| Editor body — remove button | 7.3, 8.4, 8.5 |
| Editor body — button affordance tiers | 7.4 |
| Editor body — quick ops | 8.1, 8.2, 8.3 |
| Editor body — named-combination presets | 7.6, 7.10 |
| Editor body — tooltip pattern | 7.5, 7.10 |
| Editor body — palette subpanel | 9.1, 9.2 |
| Editor body — palette picker | 9.3, 9.4, 9.5, 9.6, 9.7, 9.8 |
| Editor body — variation picker | 10.1, 10.2 |
| Editor body — xform internals | 8.4, 8.5, 8.6 |
| Implementation seam (#103) | 1.3, 1.4 |
| Color migration | 1.2 |
| All acceptance criteria | covered cumulatively |

OPEN spec items deferred to Phase 12 tuning:
- Numeric values per Density preset → 12.2
- Dominant-color tagging algorithm → 12.2
- flam3 palette name mapping source → already exists in `flam3-palette-names.ts`; fallback `#<N>` for nameless

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-04-visual-overhaul.md`.**

Execution recommendation: **Subagent-Driven** for all pure-logic tasks (~90% of the work); **lead-Inline** only for the few Chrome-verify checkpoints (1.7, 2.7, 3.4, 4.3, 5.7, 6.6, 7.12, 8.7, 9.9, 10.3, 12.1–12.5) and the Phase 5 Playwright drag-gesture test if the subagent can't run Playwright in its environment. Phase 11 dispatches `feature-dev:code-reviewer` as a fresh agent.
