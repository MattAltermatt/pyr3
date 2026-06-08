# /v1/edit — flame editor v1 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for sections-fan-out tasks; switch to **lead-inline** for foundation, mount/Chrome, file-API, and verify tasks. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-06-03-flame-editor-v1-design.md`
**Goal:** Ship `/v1/edit` — a single-flame editing surface where every adjustable genome value (animation excluded) has an honest control in a left-side panel of collapsible sections, with a two-lane refresh (fast `present()`-only vs slow `iterate()` re-run) so palette / tonemap / DE / background edits are instant.
**Architecture:** Pure-logic foundation (state + lane dispatcher + debouncer + renderer wrapper that holds the histogram across edits) → mount + route + UI shell with collapsibles → per-section modules (one per genome subtree) → save / open / reroll / render-PNG plumbing → seam-test extension + Chrome verify.
**Tech stack:** TypeScript + WebGPU + Vite (FE) · Vitest (tests) · existing `Genome` / `Xform` / `Variation` from `src/genome.ts` · existing `Renderer` from `src/renderer.ts` · existing `genomeToJson` / `genomeFromJson` from `src/serialize.ts` · existing `save-image.ts` for PNG download · existing `flam3-palettes` for palette library.

**Branch:** `feature/flame-editor-v1` (already checked out at plan time).

---

## Phase 1 — Pure-logic foundation (lead-inline)

Every public function takes injectable dependencies (rng, clock, renderer) so tests are deterministic. No DOM, no GPU dispatch. Files run under the fast `npm test` suite (~2s).

### Task 1.1 — State model + lane dispatcher + debouncer + seed generator

**Files:**
- Create: `src/edit-seed.ts`, `src/edit-seed.test.ts`
- Create: `src/edit-state.ts`, `src/edit-state.test.ts`

The seed generator is identical in shape to evolve's (which is parked on a branch — we write fresh here; later cleanup can DRY them when evolve un-parks). State holds the live genome, owns lane categorisation by path, and exposes a per-lane debouncer.

- [ ] **Step 1: Write `src/edit-seed.ts`** — random procedural Genome producer

```ts
import { type Genome, type Xform } from './genome';
import { type Variation, V } from './variations';
import { getLibraryStops, FLAM3_PALETTE_COUNT, getLibraryName } from './flam3-palettes';

// Visually-friendly subset (avoids cell-shocking the user with var_pre_blur etc.)
const SEED_VARIATIONS: number[] = [
  V.linear, V.sinusoidal, V.spherical, V.swirl, V.horseshoe,
  V.polar, V.heart, V.disc, V.spiral, V.hyperbolic, V.diamond,
  V.ex, V.julia, V.bent, V.waves, V.fisheye,
];

function randomXform(rng: () => number): Xform {
  const v = SEED_VARIATIONS[Math.floor(rng() * SEED_VARIATIONS.length)]!;
  const variations: Variation[] = [{ index: v as Variation['index'], weight: 0.4 + rng() * 0.6 }];
  return {
    a: -1 + rng() * 2, b: -1 + rng() * 2, c: -0.5 + rng() * 1,
    d: -1 + rng() * 2, e: -1 + rng() * 2, f: -0.5 + rng() * 1,
    weight: 0.4 + rng() * 0.6,
    color: rng(),
    colorSpeed: 0.5,
    opacity: 1,
    variations,
  };
}

export function generateRandomGenome(rng: () => number = Math.random): Genome {
  const xformCount = 2 + Math.floor(rng() * 3); // 2..4
  const xforms: Xform[] = [];
  for (let i = 0; i < xformCount; i++) xforms.push(randomXform(rng));
  const paletteIdx = Math.floor(rng() * FLAM3_PALETTE_COUNT);
  return {
    name: 'Untitled flame',
    xforms,
    scale: 200,
    cx: 0,
    cy: 0,
    palette: {
      name: getLibraryName(paletteIdx) ?? `flame #${paletteIdx}`,
      stops: getLibraryStops(paletteIdx),
    },
  };
}
```

- [ ] **Step 2: Write `src/edit-seed.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateRandomGenome } from './edit-seed';

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

describe('generateRandomGenome', () => {
  it('is deterministic for the same rng', () => {
    const a = generateRandomGenome(seededRng(42));
    const b = generateRandomGenome(seededRng(42));
    expect(a).toEqual(b);
  });
  it('produces a valid Genome shape', () => {
    const g = generateRandomGenome(seededRng(1));
    expect(g.xforms.length).toBeGreaterThanOrEqual(2);
    expect(g.xforms.length).toBeLessThanOrEqual(4);
    for (const x of g.xforms) {
      expect(x.variations.length).toBeGreaterThanOrEqual(1);
      expect(x.weight).toBeGreaterThan(0);
    }
    expect(g.palette.stops.length).toBeGreaterThan(0);
  });
  it('produces different output for different seeds', () => {
    const a = generateRandomGenome(seededRng(1));
    const b = generateRandomGenome(seededRng(2));
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 3: Run and confirm green**

```
npm run typecheck && npm test -- src/edit-seed.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Write `src/edit-state.ts`** — state + lane dispatcher + debouncer

```ts
import { type Genome } from './genome';

export type Lane = 'fast' | 'slow' | 'rebuild';

// Pure categorisation by genome path. Path uses dotted form
// 'xforms.1.variations.0.weight' / 'palette.hue' / 'size.width'.
// Maps to which renderer phase needs to re-run.
export function pathLane(path: string): Lane {
  if (path === 'size.width' || path === 'size.height') return 'rebuild';
  if (path === 'oversample') return 'rebuild';
  if (path === 'spatialFilter.radius') return 'rebuild';
  if (path.startsWith('xforms') || path.startsWith('finalxform')) return 'slow';
  if (path === 'scale' || path === 'cx' || path === 'cy' || path === 'rotate') return 'slow';
  if (path.startsWith('symmetry')) return 'slow';
  // everything else (palette.*, tonemap.*, density.*, background, name, nick) → fast
  return 'fast';
}

export interface StateChange {
  lane: Lane;
  path: string;
}

export type SectionKey =
  | 'palette' | 'viewport' | 'xforms' | 'final' | 'global' | 'density' | 'render';

export interface EditState {
  genome: Genome;
  seed: number;
  preview: { width: number; height: number };
  sectionCollapse: Record<SectionKey, boolean>;
  xformCollapse: Record<number, boolean>;
}

export function createEditState(genome: Genome, seed: number): EditState {
  return {
    genome,
    seed,
    preview: { width: 512, height: 512 },
    sectionCollapse: {
      palette: false, viewport: false, xforms: false, final: false,
      global: false, density: false, render: false,
    },
    xformCollapse: {},
  };
}

// Per-lane debouncer. setTimeout-based; injectable clock for tests.
export type Clock = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

export const DEFAULT_DEBOUNCE_MS: Record<Lane, number> = {
  fast: 16, slow: 100, rebuild: 200,
};

export interface LaneScheduler {
  schedule(change: StateChange): void;
  flush(lane?: Lane): void;
  cancel(): void;
}

export function createLaneScheduler(
  onFire: (lane: Lane, paths: string[]) => void,
  opts: { clock?: Clock; debounceMs?: Record<Lane, number> } = {},
): LaneScheduler {
  const clock: Clock = opts.clock ?? globalThis;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pending: Record<Lane, Set<string>> = { fast: new Set(), slow: new Set(), rebuild: new Set() };
  const timers: Record<Lane, unknown> = { fast: undefined, slow: undefined, rebuild: undefined };

  function flushLane(lane: Lane): void {
    const paths = [...pending[lane]];
    if (paths.length === 0) return;
    pending[lane].clear();
    timers[lane] = undefined;
    onFire(lane, paths);
  }

  return {
    schedule(change: StateChange): void {
      pending[change.lane].add(change.path);
      if (timers[change.lane] !== undefined) clock.clearTimeout(timers[change.lane]);
      timers[change.lane] = clock.setTimeout(() => flushLane(change.lane), debounceMs[change.lane]);
    },
    flush(lane?: Lane): void {
      if (lane) flushLane(lane);
      else { flushLane('fast'); flushLane('slow'); flushLane('rebuild'); }
    },
    cancel(): void {
      for (const k of ['fast', 'slow', 'rebuild'] as const) {
        if (timers[k] !== undefined) clock.clearTimeout(timers[k]);
        timers[k] = undefined;
        pending[k].clear();
      }
    },
  };
}
```

- [ ] **Step 5: Write `src/edit-state.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { pathLane, createLaneScheduler, createEditState, type Clock } from './edit-state';
import { generateRandomGenome } from './edit-seed';

describe('pathLane', () => {
  it('maps render-dim/oversample/filter to rebuild', () => {
    expect(pathLane('size.width')).toBe('rebuild');
    expect(pathLane('size.height')).toBe('rebuild');
    expect(pathLane('oversample')).toBe('rebuild');
    expect(pathLane('spatialFilter.radius')).toBe('rebuild');
  });
  it('maps xforms/viewport/symmetry to slow', () => {
    expect(pathLane('xforms.0.weight')).toBe('slow');
    expect(pathLane('xforms.2.variations.0.weight')).toBe('slow');
    expect(pathLane('finalxform.opacity')).toBe('slow');
    expect(pathLane('scale')).toBe('slow');
    expect(pathLane('cx')).toBe('slow');
    expect(pathLane('cy')).toBe('slow');
    expect(pathLane('rotate')).toBe('slow');
    expect(pathLane('symmetry.n')).toBe('slow');
  });
  it('maps palette/tonemap/density/background/meta to fast', () => {
    expect(pathLane('palette.hue')).toBe('fast');
    expect(pathLane('palette.mode')).toBe('fast');
    expect(pathLane('palette')).toBe('fast');
    expect(pathLane('tonemap.gamma')).toBe('fast');
    expect(pathLane('tonemap.brightness')).toBe('fast');
    expect(pathLane('density.maxRad')).toBe('fast');
    expect(pathLane('background')).toBe('fast');
    expect(pathLane('name')).toBe('fast');
  });
});

function fakeClock(): Clock & { advance(ms: number): void } {
  type Timer = { id: number; fn: () => void; due: number };
  const timers: Timer[] = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const t = { id: nextId++, fn, due: now + ms };
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
  it('coalesces edits in same lane within debounce window', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    clock.advance(15);
    expect(onFire).not.toHaveBeenCalled();
    clock.advance(2);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith('fast', expect.arrayContaining(['palette.hue', 'tonemap.gamma']));
  });
  it('runs lanes independently', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.schedule({ lane: 'slow', path: 'xforms.0.weight' });
    clock.advance(20);
    expect(onFire).toHaveBeenCalledWith('fast', ['palette.hue']);
    clock.advance(100);
    expect(onFire).toHaveBeenCalledWith('slow', ['xforms.0.weight']);
  });
  it('flush(lane) fires pending immediately', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'rebuild', path: 'size.width' });
    s.flush('rebuild');
    expect(onFire).toHaveBeenCalledWith('rebuild', ['size.width']);
  });
});

describe('createEditState', () => {
  it('starts with all sections expanded', () => {
    const st = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(st.sectionCollapse.palette).toBe(false);
    expect(st.sectionCollapse.xforms).toBe(false);
  });
});
```

- [ ] **Step 6: Run and confirm green**

```
npm run typecheck && npm test -- src/edit-state.test.ts src/edit-seed.test.ts
```

Expected: all tests pass; 10+ total.

- [ ] **Step 7: Commit**

```
git add src/edit-seed.ts src/edit-seed.test.ts src/edit-state.ts src/edit-state.test.ts
git commit -m "edit: state model + lane dispatcher + debouncer + seed gen"
```

---

### Task 1.2 — Renderer wrapper (`src/edit-render.ts`)

**Files:**
- Create: `src/edit-render.ts`, `src/edit-render.test.ts`

Wraps the existing `Renderer` (from `src/renderer.ts`) and routes each lane to the right call sequence. Holds no DOM. Renderer is injected so tests can stub it.

- [ ] **Step 1: Write `src/edit-render.ts`**

```ts
import { type Renderer } from './renderer';
import { type Genome } from './genome';
import { type Lane } from './edit-state';

const QUICK_MODE_QUALITY = 16; // walker-iter target for live preview

export interface EditRenderer {
  applyLane(lane: Lane, genome: Genome, seed: number, outputView: GPUTextureView): void;
  fullRender(genome: Genome, seed: number, outputView: GPUTextureView): void;
  destroy(): void;
}

export function createEditRenderer(
  renderer: Renderer,
  opts: { resize: (width: number, height: number) => void } = { resize: () => {} },
): EditRenderer {
  let dirtyAfterReset = false;

  function reseed(genome: Genome, seed: number): void {
    renderer.reset(genome);
    renderer.iterate({
      genome,
      seed,
      walkers: 256,
      itersPerWalker: QUICK_MODE_QUALITY * (genome.size?.width ?? 512) * (genome.size?.height ?? 512) / 256,
    });
    dirtyAfterReset = true;
  }

  function present(genome: Genome, outputView: GPUTextureView, totalSamples: number): void {
    renderer.present({ genome, outputView, totalSamples });
    dirtyAfterReset = false;
  }

  return {
    applyLane(lane, genome, seed, outputView): void {
      switch (lane) {
        case 'rebuild':
          opts.resize(genome.size?.width ?? 512, genome.size?.height ?? 512);
          reseed(genome, seed);
          present(genome, outputView, 256 * 16);
          break;
        case 'slow':
          reseed(genome, seed);
          present(genome, outputView, 256 * 16);
          break;
        case 'fast':
          if (dirtyAfterReset) present(genome, outputView, 256 * 16);
          else present(genome, outputView, 256 * 16);
          break;
      }
    },
    fullRender(genome, seed, outputView): void {
      reseed(genome, seed);
      present(genome, outputView, 256 * 16);
    },
    destroy(): void {
      renderer.destroy();
    },
  };
}
```

- [ ] **Step 2: Write `src/edit-render.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createEditRenderer } from './edit-render';
import { generateRandomGenome } from './edit-seed';
import { type Renderer } from './renderer';

function stubRenderer(): Renderer & {
  resetCalls: number;
  iterateCalls: number;
  presentCalls: number;
} {
  const r = {
    resetCalls: 0,
    iterateCalls: 0,
    presentCalls: 0,
    reset: vi.fn(function (this: typeof r) { this.resetCalls++; }),
    iterate: vi.fn(function (this: typeof r) { this.iterateCalls++; }),
    present: vi.fn(function (this: typeof r) { this.presentCalls++; }),
    resize: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
    width: 512, height: 512, superW: 512, superH: 512, oversample: 1, filterRadius: 0.5,
  } as unknown as Renderer & { resetCalls: number; iterateCalls: number; presentCalls: number };
  // bind `this` for the counter-mocks
  r.reset = vi.fn(() => { r.resetCalls++; });
  r.iterate = vi.fn(() => { r.iterateCalls++; });
  r.present = vi.fn(() => { r.presentCalls++; });
  return r;
}

const fakeView = {} as GPUTextureView;

describe('createEditRenderer', () => {
  it('fast lane only calls present', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('fast', g, 1, fakeView);
    expect(r.resetCalls).toBe(0);
    expect(r.iterateCalls).toBe(0);
    expect(r.presentCalls).toBe(1);
  });
  it('slow lane runs reset + iterate + present', () => {
    const r = stubRenderer();
    const er = createEditRenderer(r);
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('slow', g, 1, fakeView);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });
  it('rebuild lane calls resize before reset+iterate+present', () => {
    const r = stubRenderer();
    const resize = vi.fn();
    const er = createEditRenderer(r, { resize });
    const g = generateRandomGenome(() => 0.5);
    er.applyLane('rebuild', g, 1, fakeView);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(r.resetCalls).toBe(1);
    expect(r.iterateCalls).toBe(1);
    expect(r.presentCalls).toBe(1);
  });
});
```

- [ ] **Step 3: Run and commit**

```
npm run typecheck && npm test -- src/edit-render.test.ts && \
  git add src/edit-render.ts src/edit-render.test.ts && \
  git commit -m "edit: renderer wrapper with lane → reset/iterate/present routing"
```

---

## Phase 2 — Mount + UI shell (lead-inline)

### Task 2.1 — Route, mount, empty collapsible shell, Chrome basic verify

**Files:**
- Create: `src/edit-mount.ts`, `src/edit-mount.test.ts`
- Create: `src/edit-ui.ts`
- Modify: `src/main.ts` (add `/v1/edit` route)

The shell mounts the page (left panel with 7 collapsible section headers + canvas right). Sections are empty inside for now; later tasks fill them. Chrome verify confirms the page boots, renders a default flame, and section headers collapse/expand.

- [ ] **Step 1: Inspect existing route mounting**

Read `src/main.ts` to see how `/v1/evolve`-style routes are wired (route classifier + mount switcher). The editor follows the same pattern.

- [ ] **Step 2: Write `src/edit-ui.ts`**

```ts
import { type EditState, type SectionKey } from './edit-state';

export interface SectionMount {
  key: SectionKey;
  title: string;
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void;
}

export function mountEditUi(
  host: HTMLElement,
  state: EditState,
  sections: SectionMount[],
  onChange: (path: string) => void,
): { destroy(): void } {
  host.replaceChildren();
  host.className = 'pyr3-edit-panel';

  // Top bar (name + nick + buttons). Buttons are wired in Task 4.1.
  const topbar = document.createElement('div');
  topbar.className = 'pyr3-edit-topbar';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = state.genome.name;
  nameInput.addEventListener('input', () => {
    state.genome.name = nameInput.value;
    onChange('name');
  });
  topbar.appendChild(nameInput);
  host.appendChild(topbar);

  // Sections accordion
  const destroyFns: Array<() => void> = [];
  for (const sec of sections) {
    const wrap = document.createElement('div');
    wrap.className = 'pyr3-edit-section';
    const header = document.createElement('div');
    header.className = 'pyr3-edit-section-header';
    const chev = document.createElement('span');
    chev.textContent = state.sectionCollapse[sec.key] ? '▶' : '▼';
    header.append(chev, document.createTextNode(' ' + sec.title));
    const body = document.createElement('div');
    body.className = 'pyr3-edit-section-body';
    body.style.display = state.sectionCollapse[sec.key] ? 'none' : 'block';
    header.addEventListener('click', () => {
      state.sectionCollapse[sec.key] = !state.sectionCollapse[sec.key];
      chev.textContent = state.sectionCollapse[sec.key] ? '▶' : '▼';
      body.style.display = state.sectionCollapse[sec.key] ? 'none' : 'block';
    });
    sec.build(body, state, onChange);
    wrap.append(header, body);
    host.appendChild(wrap);
    destroyFns.push(() => wrap.remove());
  }

  return { destroy(): void { destroyFns.forEach((f) => f()); } };
}
```

- [ ] **Step 3: Write `src/edit-mount.ts`**

```ts
import { createEditState, createLaneScheduler, pathLane, type Lane } from './edit-state';
import { generateRandomGenome } from './edit-seed';
import { createRenderer } from './renderer';
import { createEditRenderer } from './edit-render';
import { mountEditUi, type SectionMount } from './edit-ui';

export interface MountEditPageOpts {
  pageHost: HTMLElement;
  device: GPUDevice;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  sections: SectionMount[];
}

export function mountEditPage(opts: MountEditPageOpts): { destroy(): void } {
  const ctx = opts.canvas.getContext('webgpu')!;
  ctx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });

  const initialGenome = generateRandomGenome();
  const initialSeed = (Math.random() * 0xffffffff) >>> 0;
  const state = createEditState(initialGenome, initialSeed);

  const renderer = createRenderer(opts.device, opts.format, {
    width: 512, height: 512, oversample: 1, filterRadius: 0.5,
  });
  const editRenderer = createEditRenderer(renderer, {
    resize: (w, h) => renderer.resize({ width: w, height: h, oversample: 1, filterRadius: 0.5 }),
  });

  const scheduler = createLaneScheduler((lane, _paths) => {
    const view = ctx.getCurrentTexture().createView();
    editRenderer.applyLane(lane, state.genome, state.seed, view);
  });

  const panelHost = document.createElement('div');
  opts.pageHost.replaceChildren(panelHost, opts.canvas);
  const ui = mountEditUi(panelHost, state, opts.sections, (path: string) => {
    scheduler.schedule({ lane: pathLane(path), path });
  });

  // Initial render
  const view0 = ctx.getCurrentTexture().createView();
  editRenderer.fullRender(state.genome, state.seed, view0);

  return {
    destroy(): void {
      scheduler.cancel();
      ui.destroy();
      editRenderer.destroy();
    },
  };
}
```

- [ ] **Step 4: Write `src/edit-mount.test.ts`** — DOM smoke

```ts
import { describe, expect, it } from 'vitest';
import { mountEditUi } from './edit-ui';
import { createEditState } from './edit-state';
import { generateRandomGenome } from './edit-seed';

describe('mountEditUi', () => {
  it('renders one header per section', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(() => 0.5), 1);
    const sections = (['palette', 'viewport', 'xforms', 'final', 'global', 'density', 'render'] as const)
      .map((k) => ({ key: k, title: k.toUpperCase(), build: () => {} }));
    mountEditUi(host, state, sections, () => {});
    expect(host.querySelectorAll('.pyr3-edit-section-header').length).toBe(7);
  });
  it('header click toggles collapse state', () => {
    const host = document.createElement('div');
    const state = createEditState(generateRandomGenome(() => 0.5), 1);
    const sections = [{ key: 'palette' as const, title: 'PALETTE', build: () => {} }];
    mountEditUi(host, state, sections, () => {});
    const header = host.querySelector('.pyr3-edit-section-header') as HTMLElement;
    expect(state.sectionCollapse.palette).toBe(false);
    header.click();
    expect(state.sectionCollapse.palette).toBe(true);
    header.click();
    expect(state.sectionCollapse.palette).toBe(false);
  });
});
```

Note: `npm test` runs under happy-dom — `document` is available.

- [ ] **Step 5: Add `/v1/edit` route to `src/main.ts`**

Find the route classifier and add a branch that imports `mountEditPage` and calls it with an empty `sections: []` array for now (sections wired in later tasks). The route key is `'edit'` matching `/v1/edit`.

- [ ] **Step 6: Run unit + typecheck**

```
npm run typecheck && npm test -- src/edit-mount.test.ts
```

- [ ] **Step 7: Start dev server + Chrome verify**

```
npm run dev &
```

Open http://localhost:5173/v1/edit — expect:
- Page loads, no console errors
- A canvas renders SOMETHING (default genome from the seed generator)
- 7 collapsible section headers visible (empty bodies for now)
- Click a header → it toggles ▼ ↔ ▶

Capture a screenshot via chrome-devtools-mcp.

- [ ] **Step 8: Commit**

```
git add src/edit-ui.ts src/edit-mount.ts src/edit-mount.test.ts src/main.ts
git commit -m "edit: /v1/edit route + mount + collapsible section shell"
```

---

## Phase 3 — Per-section UI modules (subagent-driven, fan out)

Each section is its own file. Pattern shared across all sections:
- Export a `SectionMount` object: `{ key, title, build(host, state, onChange) }`.
- `build()` constructs the section's DOM inside `host`, wiring `<input>` events to mutate `state.genome.<path>` and call `onChange('<path>')`.
- Tests use happy-dom: build into a detached host, simulate `input` events, assert genome mutation + onChange path.

**Task 3.x dependencies:** all section tasks depend on Task 2.1 (mount + shell exist). They are independent of each other and can fan out in parallel.

### Task 3.1 — Palette + Viewport sections

**Files:**
- Create: `src/edit-section-palette.ts`, `src/edit-section-palette.test.ts`
- Create: `src/edit-section-viewport.ts`, `src/edit-section-viewport.test.ts`
- Modify: `src/main.ts` to pass these into `mountEditPage({ sections: [paletteSection, viewportSection] })`

**Palette section** — clickable strip + ◀ ▶ arrows + popover picker (3-column 701-cell grid) + hue rotation slider (0..360) + mode radio (linear/step). Library lookup from `src/flam3-palettes.ts` (`FLAM3_PALETTE_COUNT`, `getLibraryStops`, `getLibraryName`). Arrow click steps `paletteIdx` ± 1 mod `FLAM3_PALETTE_COUNT`; clicking the strip opens the popover (use the same shape as `feature/issue-73-evolve-page:src/evolve-ui.ts buildPalettePicker` — read that file via git show to mirror the DOM structure). Wire `palette` change → `onChange('palette')`, `palette.hue` → `onChange('palette.hue')`, `palette.mode` → `onChange('palette.mode')`.

**Viewport section** — 4 number inputs (scale, cx, cy, rotate) each with ◀ / ▶ buttons. ◀ = current − 1; ◀ shift = −10; ◀ ctrl = −0.1; ▶ symmetric (mirror evolve's viewport card). On input or arrow click, mutate `state.genome.scale` / `.cx` / `.cy` / `.rotate` and call `onChange('scale' | 'cx' | 'cy' | 'rotate')`.

Each section's `.test.ts` covers:
- DOM smoke (right elements rendered)
- 1 input mutation per field → genome updated + onChange called with the right path
- Specific to palette: arrow click cycles `palette.name`; popover toggle works

- [ ] **Step 1: Implement palette section** (`src/edit-section-palette.ts`)
- [ ] **Step 2: Tests pass** (`npm test -- src/edit-section-palette.test.ts`)
- [ ] **Step 3: Implement viewport section** (`src/edit-section-viewport.ts`)
- [ ] **Step 4: Tests pass** (`npm test -- src/edit-section-viewport.test.ts`)
- [ ] **Step 5: Wire both into `main.ts`** and Chrome-verify both render and trigger re-renders
- [ ] **Step 6: Commit**

```
git add src/edit-section-palette.* src/edit-section-viewport.* src/main.ts
git commit -m "edit: palette + viewport sections"
```

---

### Task 3.2 — Xforms section (the dense one)

**Files:**
- Create: `src/edit-section-xforms.ts`, `src/edit-section-xforms.test.ts`
- Modify: `src/main.ts` to add this section

Per-xform card with everything listed in the spec's per-section content (header with weight+delete; color slider; colorSpeed number; opacity slider; affine a-f as 6 number inputs; post-affine toggle + 6 number inputs; variations list with per-variation kind dropdown + weight + 🗑️ + per-variation params labeled from `VARIATION_PARAMS` in `src/serialize.ts`; xaos row as N number inputs). Add/remove xform buttons.

The `param0..7` field-labeling is the only non-mechanical part. Read `VARIATION_PARAMS` from `src/serialize.ts` (it maps variation index → ordered param names). Show only the params used by the currently-selected variation kind; on kind change, rebind the param row.

Each input mutation calls `onChange('xforms.${i}.<field>')` with the dotted path (the lane dispatcher routes all `xforms.*` to slow lane).

- [ ] **Step 1: Read `VARIATION_PARAMS` shape** — `grep -n VARIATION_PARAMS src/serialize.ts | head -5`
- [ ] **Step 2: Implement section**
- [ ] **Step 3: Tests pass**
- [ ] **Step 4: Wire into main.ts + Chrome verify** (tweak an affine value → flame re-renders; add an xform → it appears)
- [ ] **Step 5: Commit**

```
git add src/edit-section-xforms.* src/main.ts
git commit -m "edit: xforms section (affine + post + vars + xaos)"
```

---

### Task 3.3 — Final xform + Global sections

**Files:**
- Create: `src/edit-section-final.ts`, `src/edit-section-final.test.ts`
- Create: `src/edit-section-global.ts`, `src/edit-section-global.test.ts`
- Modify: `src/main.ts`

**Final xform** — toggle checkbox (`genome.finalxform = undefined` when off, `{...defaultXform}` when on). When on, render the same xform card structure as Task 3.2 minus weight + xaos. Reuse the card-building helper from Task 3.2 with options to suppress those fields.

**Global** — fields list (each ⟵ onChange path):
- `brightness` number ⟵ `tonemap.brightness`
- `gamma` number ⟵ `tonemap.gamma`
- `highlightPower` number ⟵ `tonemap.highlightPower`
- `gammaThreshold` number ⟵ `tonemap.gammaThreshold`
- `vibrancy` slider 0..1 ⟵ `tonemap.vibrancy`
- `background` color picker (writes `[r, g, b]` in 0..1) ⟵ `background`
- `symmetry` checkbox + kind dropdown + n number ⟵ `symmetry.kind` / `symmetry.n`

Tonemap fields write to `genome.tonemap` (lazy-init from `DEFAULT_TONEMAP` if undefined on first edit).

- [ ] **Step 1: Implement final section**
- [ ] **Step 2: Tests pass for final**
- [ ] **Step 3: Implement global section**
- [ ] **Step 4: Tests pass for global**
- [ ] **Step 5: Wire into main.ts + Chrome verify**
- [ ] **Step 6: Commit**

```
git add src/edit-section-final.* src/edit-section-global.* src/main.ts
git commit -m "edit: final-xform + global sections"
```

---

### Task 3.4 — Density + Render sections

**Files:**
- Create: `src/edit-section-density.ts`, `src/edit-section-density.test.ts`
- Create: `src/edit-section-render.ts`, `src/edit-section-render.test.ts`
- Modify: `src/main.ts`

**Density** — preset dropdown (from `DENSITY_PRESETS` in `src/density.ts`) + 3 slider+input pairs for maxRad / minRad / curve. Selecting a preset writes all three; editing any single value flips the preset dropdown to "custom". Lazy-init `genome.density` from `DEFAULT_DENSITY` on first edit.

**Render** — size preset dropdown with these entries:

```ts
const SIZE_PRESETS = [
  { name: 'iPhone 15 Pro', w: 1290, h: 2796 },
  { name: 'iPad Pro', w: 2048, h: 2732 },
  { name: '1080p', w: 1920, h: 1080 },
  { name: '4K', w: 3840, h: 2160 },
  { name: 'Square', w: 2048, h: 2048 },
  { name: 'Custom', w: 0, h: 0 },
];
```

Number inputs for width/height (selecting a preset fills them; manual edit flips to Custom). Number inputs for quality, oversample dropdown (1/2/4), filter radius number + shape dropdown.

- [ ] **Step 1: Implement density section + tests**
- [ ] **Step 2: Implement render section + tests**
- [ ] **Step 3: Wire into main.ts + Chrome verify** (change a DE preset → flame retones immediately; change a render preset → preview aspect changes)
- [ ] **Step 4: Commit**

```
git add src/edit-section-density.* src/edit-section-render.* src/main.ts
git commit -m "edit: density + render sections"
```

---

## Phase 4 — File operations + render PNG (lead-inline)

### Task 4.1 — Save / Open / Reroll buttons in top bar

**Files:**
- Modify: `src/edit-ui.ts` — flesh out the topbar with action buttons
- Modify: `src/edit-mount.ts` — wire button callbacks
- Create: `src/edit-fileops.test.ts` — round-trip test

Buttons:
- **🎲 reroll** — call `generateRandomGenome()`, replace `state.genome`, rebuild section UIs (re-mount the panel), schedule slow-lane refresh
- **📂 open** — file picker `<input type="file" accept=".pyr3.json,.json">`; on file → `JSON.parse(await file.text())` → `genomeFromJson(parsed)` → replace + rebuild + schedule slow-lane; on parse fail, set a toast `<div>` at top of panel with the error (auto-hide after 4s)
- **💾 save** — `JSON.stringify(genomeToJson(state.genome), null, 2)` → blob → trigger download named `<slugify(genome.name)>.pyr3.json`

Slugify helper (no external deps):

```ts
function slugify(name: string): string {
  return (name || 'flame').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'flame';
}
```

Round-trip test (`src/edit-fileops.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { genomeToJson, genomeFromJson } from './serialize';
import { generateRandomGenome } from './edit-seed';

describe('edit file ops round-trip', () => {
  it('save → reopen produces an identical genome', () => {
    const g = generateRandomGenome(() => 0.7);
    const json = JSON.stringify(genomeToJson(g));
    const restored = genomeFromJson(JSON.parse(json));
    expect(restored).toEqual(g);
  });
});
```

- [ ] **Step 1: Add toast helper + topbar buttons to `edit-ui.ts`**
- [ ] **Step 2: Wire reroll / open / save callbacks in `edit-mount.ts`**
- [ ] **Step 3: Round-trip test passes**
- [ ] **Step 4: Chrome verify** — reroll cycles the flame; save downloads a `.pyr3.json`; open reads it back identical (visually)
- [ ] **Step 5: Commit**

```
git add src/edit-ui.ts src/edit-mount.ts src/edit-fileops.test.ts
git commit -m "edit: reroll + open + save .pyr3.json"
```

---

### Task 4.2 — 🖼️ Render PNG at configured dimensions

**Files:**
- Modify: `src/edit-mount.ts` — render-PNG callback
- Modify: `src/edit-ui.ts` — render-PNG button + progress modal element

On click:
1. Disable section inputs (set a `data-busy="true"` attribute on panel root; CSS dims pointer-events).
2. Show a modal `<div>` overlay: "Rendering at WxH... please wait."
3. Read configured dims from `state.genome.size` (fallback `{ width: 1024, height: 1024 }`).
4. Create an offscreen `<canvas>` at those dims; `getContext('webgpu')` and configure it.
5. Call `renderer.resize({ width, height, oversample, filterRadius })` with the configured values.
6. Call `editRenderer.fullRender(state.genome, state.seed, offscreenCtx.getCurrentTexture().createView())` (use full quality, NOT quick-mode — needs a new path on EditRenderer that doesn't downsize iterations).
7. Use the existing `save-image.ts` PNG download path with `filename = slugify(genome.name) + '.png'`.
8. Resize renderer back to preview dims; re-run a slow-lane refresh so the editor canvas isn't stuck on the high-res render.
9. Remove modal + clear `data-busy`.

Add `fullRenderAt(genome, seed, width, height, outputView)` to `EditRenderer` so this path uses full quality:

```ts
// in src/edit-render.ts — add method
fullRenderAt(genome: Genome, seed: number, width: number, height: number, outputView: GPUTextureView): void {
  // Caller is expected to have already called resize() to this width/height.
  renderer.reset(genome);
  const targetSpp = genome.quality ?? 100;
  const samples = targetSpp * width * height;
  const itersPerWalker = Math.max(1, Math.floor(samples / 256));
  renderer.iterate({ genome, seed, walkers: 256, itersPerWalker });
  renderer.present({ genome, outputView, totalSamples: 256 * itersPerWalker });
}
```

- [ ] **Step 1: Add `fullRenderAt` to `edit-render.ts` + test**
- [ ] **Step 2: Add render-PNG button + modal to `edit-ui.ts`**
- [ ] **Step 3: Wire the full pipeline in `edit-mount.ts`**
- [ ] **Step 4: Chrome verify** — click 🖼️ at 1290×2796; PNG downloads; editor canvas restores
- [ ] **Step 5: Commit**

```
git add src/edit-render.ts src/edit-render.test.ts src/edit-ui.ts src/edit-mount.ts
git commit -m "edit: render-PNG at configured dimensions"
```

---

## Phase 5 — Seam contract + final Chrome verify (lead-inline)

### Task 5.1 — Seam test extension + acceptance pass

**Files:**
- Modify: `src/seam.test.ts` — extend banlists/exemptions to cover new `src/edit-*.ts` files
- Possibly modify: `vitest.config.ts` (no change expected; section files run under existing test glob)

The seam contract:
- `edit-state.ts`, `edit-seed.ts`, `edit-render.ts` — pure logic, NO DOM
- `edit-ui.ts`, `edit-mount.ts`, `edit-section-*.ts` — DOM allowed
- All edit-* engine modules use `globalThis` instead of `window` / `document` (CLI-safe)

Read `src/seam.test.ts` and add/extend rules so:
- A test fails if `edit-state.ts` or `edit-seed.ts` or `edit-render.ts` imports `document` / `window` / `HTMLElement`.
- The DOM-using edit files are exempt (added to the section-file exempt list that already exists for evolve/gallery).

Final Chrome E2E verify (manual, captured via chrome-devtools-mcp):
1. Open `/v1/edit` → page loads, default flame renders
2. Tweak one field per section (palette hue, viewport scale, xform weight, final toggle, global gamma, density preset, render width) → flame re-renders each time
3. Hit 🎲 → new flame
4. Hit 💾 → file downloads
5. Hit 📂 → reload the downloaded file → identical genome
6. Hit 🖼️ → PNG download at configured dims

- [ ] **Step 1: Extend `seam.test.ts`**
- [ ] **Step 2: Run full unit suite + typecheck**

```
npm run typecheck && npm test
```

Expected: all tests pass; new edit-* tests visible in output.

- [ ] **Step 3: Chrome E2E walkthrough** (steps 1-6 above)
- [ ] **Step 4: Commit + push branch**

```
git add src/seam.test.ts
git commit -m "edit: extend seam contract to cover edit-* modules"
git push -u origin feature/flame-editor-v1
```

- [ ] **Step 5: Hand off for FF-merge** — pause and surface to the user: branch is green, Chrome-verified, ready for FF-merge to `main`. (User-verify-before-FF-merge gate per CLAUDE.md.)

---

## Self-review

**Spec coverage:**
- ✅ Page + route — Task 2.1
- ✅ 7 collapsible sections, default expanded — Task 2.1 + section tasks
- ✅ Every adjustable genome field exposed — Tasks 3.1-3.4 cover the inventory
- ✅ Two-lane refresh — Task 1.1 (categoriser + scheduler) + 1.2 (dispatcher)
- ✅ Reroll / open / save / render-PNG — Tasks 4.1-4.2
- ✅ Seam contract — Task 5.1
- ✅ Acceptance criteria covered by Chrome E2E in Task 5.1
- ✅ Out-of-scope (palette stops editor, xform gizmos, per-variation param sliders, cross-surface entry) intentionally NOT in plan

**Placeholder scan:** No TBD / TODO / "implement later" in the steps. Section files for Tasks 3.x are described with field-level precision pointing at the spec for full per-section content.

**Type consistency:** `EditRenderer.applyLane(lane, genome, seed, outputView)` consistent across tasks 1.2, 2.1, 4.2. `SectionMount = { key, title, build(host, state, onChange) }` shape consistent across 3.1-3.4. `pathLane()`, `createLaneScheduler`, `createEditState` exported from `edit-state.ts` consistent across 1.1, 2.1.

**Open items deliberately deferred (not gaps):**
- GitHub issue filing for this work — flagged in spec's "Open questions"; user to decide at PR time.
- Extraction of evolve's palette picker / viewport card into shared section modules — flagged in spec as future cleanup; v1 writes editor-local versions.
