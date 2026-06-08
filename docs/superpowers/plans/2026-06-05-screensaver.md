# Screensaver Implementation Plan (`/v1/screensaver`, issue #109)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/v1/screensaver` — a lean-back fractal-flame display with two modes (true slideshow + slow build-up), random shuffle over the ESF corpus, configurable timing knobs, fullscreen-on-demand.

**Architecture:** Five new modules under `src/screensaver-*.ts` plus one routing branch in `main.ts` and one new top-bar variant in `ui-bar.ts`. The mount module reuses `createEditRenderer` + `createLaneScheduler` from the editor — engine modules (`chaos`/`density`/`visualize_*`) are untouched. Single-engine-two-consumers seam preserved.

**Tech Stack:** TS + WebGPU + Vite, Vitest for unit tests, Chrome (via `chrome-devtools-mcp`) for verify. Reuses `feature-index-client` for corpus enumeration, `prefs.ts` style for localStorage.

**Spec:** `docs/superpowers/specs/2026-06-05-screensaver-design.md`

---

## File Structure

```text
NEW
src/screensaver-queue.ts       Random-shuffle + prev/next history. Pure-logic.
src/screensaver-queue.test.ts
src/screensaver-prefs.ts       localStorage shape, defaults, "Nm"-shorthand parser.
src/screensaver-prefs.test.ts
src/screensaver-pacing.ts      qTarget(t, buildUpSec) → number. Pure helper.
src/screensaver-pacing.test.ts
src/screensaver-ui.ts          Landing card: mode picker, 3 ladder controls, Play.
src/screensaver-ui.test.ts
src/screensaver-mount.ts       Owns canvas; routes Play/Stop; wires modes + transitions.
src/screensaver-mount.test.ts  Mount harness with renderer-stub (pattern from edit-mount.test.ts).

MODIFY
src/ui-bar.ts                  +mountScreensaverBar() variant (brand-left only).
                               + "Screensaver" link added to mountBar / mountEditBar /
                                 mountGalleryBar / mountAboutBar nav slots.
src/main.ts                    +1 routing branch:
                               if (p === '/v1/screensaver') return 'screensaver';
                               + dynamic import + mount dispatch.
```

Decomposition rationale: queue / prefs / pacing are pure-logic helpers that test cleanly in isolation. `screensaver-ui` is the landing card (no engine). `screensaver-mount` is the only file that touches the WebGPU canvas + lane scheduler — analogous to `edit-mount.ts`. The ui-bar additions are nav-link plumbing across all existing bar variants.

---

## Phase 1 — Foundation logic (3 tasks)

Pure helpers that test cleanly in isolation. No canvas, no DOM. End-of-phase milestone: `npm test` green with three new test files passing.

### Task 1: `screensaver-queue` — shuffle + history

**Files:**
- Create: `src/screensaver-queue.ts`
- Create: `src/screensaver-queue.test.ts`

The queue owns a random walk over a fixed `SheepRef[]` with a back-history buffer so prev() actually goes back to what was just shown.

- [ ] **Step 1: Write the failing test**

`src/screensaver-queue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createScreensaverQueue, type SheepRef } from './screensaver-queue';

const refs: SheepRef[] = [
  { gen: 244, id: 1 },
  { gen: 244, id: 2 },
  { gen: 244, id: 3 },
  { gen: 244, id: 4 },
];

describe('createScreensaverQueue', () => {
  it('seeded RNG produces deterministic sequence', () => {
    const a = createScreensaverQueue(refs, 42);
    const b = createScreensaverQueue(refs, 42);
    expect(a.next()).toEqual(b.next());
    expect(a.next()).toEqual(b.next());
    expect(a.next()).toEqual(b.next());
  });

  it('next returns a ref from the input corpus', () => {
    const q = createScreensaverQueue(refs, 1);
    const r = q.next();
    expect(refs).toContainEqual(r);
  });

  it('prev pops history; returns null when history exhausted', () => {
    const q = createScreensaverQueue(refs, 1);
    const a = q.next();
    const b = q.next();
    const c = q.next();
    expect(q.prev()).toEqual(b);
    expect(q.prev()).toEqual(a);
    expect(q.prev()).toBeNull();
    // next() after exhausting prev resumes from history head
    expect(q.next()).toEqual(a);
    expect(q.next()).toEqual(b);
    expect(q.next()).toEqual(c);
  });

  it('history caps at 50 entries', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ gen: 244, id: i }));
    const q = createScreensaverQueue(big, 1);
    for (let i = 0; i < 100; i++) q.next();
    let back = 0;
    while (q.prev() !== null) back++;
    expect(back).toBe(50);
  });

  it('peek does not advance', () => {
    const q = createScreensaverQueue(refs, 1);
    const p = q.peek();
    expect(q.next()).toEqual(p);
  });

  it('empty corpus returns null from next/peek/prev', () => {
    const q = createScreensaverQueue([], 1);
    expect(q.peek()).toBeNull();
    expect(q.next()).toBeNull();
    expect(q.prev()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screensaver-queue.test.ts`
Expected: FAIL — `Cannot find module './screensaver-queue'`.

- [ ] **Step 3: Implement the module**

`src/screensaver-queue.ts`:

```typescript
// Random-shuffle queue over the ESF corpus with prev/next history.
// next() picks the NEXT random ref + appends current to history.
// prev() pops from history and treats the popped entry as current.
// History caps at HISTORY_MAX so prev() far enough back returns null.

export interface SheepRef {
  readonly gen: number;
  readonly id: number;
}

export interface ScreensaverQueue {
  /** Advance: returns the next ref. Pushes the displaced ref onto history.
   *  Returns null only when the source corpus is empty. */
  next(): SheepRef | null;
  /** Go back one step in history (up to HISTORY_MAX deep). Returns null
   *  when history is exhausted. */
  prev(): SheepRef | null;
  /** Look at the next ref without advancing. Returns null on empty corpus. */
  peek(): SheepRef | null;
}

export const HISTORY_MAX = 50;

/** Deterministic mulberry32 PRNG — same one used elsewhere in the codebase
 *  for repeatable shuffles. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScreensaverQueue(
  refs: readonly SheepRef[],
  seed: number,
): ScreensaverQueue {
  const rng = mulberry32(seed);
  const history: SheepRef[] = [];
  // The "current" cursor sits at the head of a peek-stash: when prev() walks
  // backward, future next() calls re-emit the popped history in order before
  // generating new randoms again.
  const future: SheepRef[] = [];
  let peekCache: SheepRef | null = null;

  function pick(): SheepRef | null {
    if (refs.length === 0) return null;
    const idx = Math.floor(rng() * refs.length);
    return refs[idx];
  }

  function nextRef(): SheepRef | null {
    if (future.length > 0) return future.pop()!;
    return pick();
  }

  return {
    next() {
      const r = nextRef();
      if (!r) return null;
      peekCache = null;
      history.push(r);
      while (history.length > HISTORY_MAX) history.shift();
      return r;
    },
    prev() {
      if (history.length === 0) return null;
      const current = history.pop()!;
      future.push(current);
      peekCache = current; // future.pop() will return this on next()
      const back = history[history.length - 1] ?? null;
      return back;
    },
    peek() {
      if (peekCache) return peekCache;
      if (refs.length === 0) return null;
      // Don't burn an RNG step on peek — compute and cache.
      const r = pick();
      peekCache = r;
      future.push(r); // ensure next() emits the same value
      return r;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screensaver-queue.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/screensaver-queue.ts src/screensaver-queue.test.ts
git commit -m "feat(#109): screensaver queue (shuffle + history)"
```

---

### Task 2: `screensaver-prefs` — localStorage + clamp + shorthand

**Files:**
- Create: `src/screensaver-prefs.ts`
- Create: `src/screensaver-prefs.test.ts`

Follows the style of `src/prefs.ts` (`readGlobalQuality` / `writeGlobalQuality`) — single localStorage key, JSON-encoded object, version field, terminal-failure fallback to defaults.

- [ ] **Step 1: Write the failing test**

`src/screensaver-prefs.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  _clearScreensaverPrefs,
  parseSecondsInput,
  DEFAULTS,
  CLAMPS,
} from './screensaver-prefs';

beforeEach(() => {
  _clearScreensaverPrefs();
});

describe('screensaver-prefs', () => {
  it('returns DEFAULTS when localStorage is empty', () => {
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });

  it('round-trips through write + read', () => {
    writeScreensaverPrefs({
      mode: 'slideshow',
      buildUpSec: 60,
      restSec: 10,
      holdSec: 30,
    });
    expect(readScreensaverPrefs()).toEqual({
      mode: 'slideshow',
      buildUpSec: 60,
      restSec: 10,
      holdSec: 30,
    });
  });

  it('clamps out-of-range values to CLAMPS', () => {
    writeScreensaverPrefs({
      mode: 'build-up',
      buildUpSec: 99999, // > max
      restSec: -5,       // < min
      holdSec: 15,
    });
    const got = readScreensaverPrefs();
    expect(got.buildUpSec).toBe(CLAMPS.buildUpSec.max);
    expect(got.restSec).toBe(CLAMPS.restSec.min);
    expect(got.holdSec).toBe(15);
  });

  it('falls back to DEFAULTS on version mismatch', () => {
    localStorage.setItem(
      'pyr3.screensaver.prefs',
      JSON.stringify({ version: 999, mode: 'slideshow' }),
    );
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });

  it('falls back to DEFAULTS on malformed JSON', () => {
    localStorage.setItem('pyr3.screensaver.prefs', 'not-json');
    expect(readScreensaverPrefs()).toEqual(DEFAULTS);
  });
});

describe('parseSecondsInput', () => {
  it('parses bare seconds', () => {
    expect(parseSecondsInput('30')).toBe(30);
    expect(parseSecondsInput('30s')).toBe(30);
  });
  it('parses Nm shorthand', () => {
    expect(parseSecondsInput('5m')).toBe(300);
    expect(parseSecondsInput('2m')).toBe(120);
  });
  it('returns null for non-numeric junk', () => {
    expect(parseSecondsInput('xyz')).toBeNull();
    expect(parseSecondsInput('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screensaver-prefs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`src/screensaver-prefs.ts`:

```typescript
// Single-key localStorage persistence for /v1/screensaver settings.
// Pattern mirrors src/prefs.ts (single key, version-gated, default fallback
// on any read failure).

export type ScreensaverMode = 'slideshow' | 'build-up';

export interface ScreensaverPrefs {
  mode: ScreensaverMode;
  buildUpSec: number;
  restSec: number;
  holdSec: number;
}

interface StoredPrefs extends ScreensaverPrefs {
  version: number;
}

export const PREFS_KEY = 'pyr3.screensaver.prefs';
export const PREFS_VERSION = 1;

export const DEFAULTS: ScreensaverPrefs = {
  mode: 'build-up',
  buildUpSec: 300,
  restSec: 30,
  holdSec: 15,
};

export const CLAMPS = {
  buildUpSec: { min: 5,  max: 3600 },
  restSec:    { min: 0,  max: 600  },
  holdSec:    { min: 1,  max: 600  },
} as const;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function isMode(v: unknown): v is ScreensaverMode {
  return v === 'slideshow' || v === 'build-up';
}

function applyClamps(p: ScreensaverPrefs): ScreensaverPrefs {
  return {
    mode: p.mode,
    buildUpSec: clamp(p.buildUpSec, CLAMPS.buildUpSec.min, CLAMPS.buildUpSec.max),
    restSec:    clamp(p.restSec,    CLAMPS.restSec.min,    CLAMPS.restSec.max),
    holdSec:    clamp(p.holdSec,    CLAMPS.holdSec.min,    CLAMPS.holdSec.max),
  };
}

export function readScreensaverPrefs(): ScreensaverPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREFS_KEY);
  } catch {
    return { ...DEFAULTS };
  }
  if (!raw) return { ...DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
  const p = parsed as Partial<StoredPrefs>;
  if (p.version !== PREFS_VERSION) return { ...DEFAULTS };
  if (!isMode(p.mode)) return { ...DEFAULTS };
  return applyClamps({
    mode: p.mode,
    buildUpSec: typeof p.buildUpSec === 'number' ? p.buildUpSec : DEFAULTS.buildUpSec,
    restSec:    typeof p.restSec    === 'number' ? p.restSec    : DEFAULTS.restSec,
    holdSec:    typeof p.holdSec    === 'number' ? p.holdSec    : DEFAULTS.holdSec,
  });
}

export function writeScreensaverPrefs(p: ScreensaverPrefs): void {
  const clamped = applyClamps(p);
  const payload: StoredPrefs = { version: PREFS_VERSION, ...clamped };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    // best-effort; quota or private mode — swallow.
  }
}

export function _clearScreensaverPrefs(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // best-effort.
  }
}

/** Parse user-typed value in the ladder's freeform input.
 *  Accepts "30", "30s", "5m". Returns null on junk. */
export function parseSecondsInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(s|m)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 's').toLowerCase();
  return unit === 'm' ? n * 60 : n;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screensaver-prefs.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/screensaver-prefs.ts src/screensaver-prefs.test.ts
git commit -m "feat(#109): screensaver prefs (localStorage + clamps + shorthand)"
```

---

### Task 3: `screensaver-pacing` — build-up quality scheduler

**Files:**
- Create: `src/screensaver-pacing.ts`
- Create: `src/screensaver-pacing.test.ts`

Tiny pure function used by build-up mode to map wall-clock elapsed → target quality. Trivial but worth isolating because it's the only "interesting" math in the mode loop.

- [ ] **Step 1: Write the failing test**

`src/screensaver-pacing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { qTarget, BUILD_UP_TARGET_Q } from './screensaver-pacing';

describe('qTarget', () => {
  it('is 0 at t=0', () => {
    expect(qTarget(0, 300)).toBe(0);
  });

  it('hits BUILD_UP_TARGET_Q at t=buildUpSec', () => {
    expect(qTarget(300, 300)).toBe(BUILD_UP_TARGET_Q);
  });

  it('clamps at BUILD_UP_TARGET_Q past buildUpSec', () => {
    expect(qTarget(600, 300)).toBe(BUILD_UP_TARGET_Q);
  });

  it('linear in between', () => {
    expect(qTarget(150, 300)).toBe(BUILD_UP_TARGET_Q / 2);
  });

  it('clamps to 0 for negative elapsed', () => {
    expect(qTarget(-10, 300)).toBe(0);
  });

  it('handles buildUpSec=0 (immediately target)', () => {
    expect(qTarget(0,   0)).toBe(BUILD_UP_TARGET_Q);
    expect(qTarget(0.1, 0)).toBe(BUILD_UP_TARGET_Q);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screensaver-pacing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`src/screensaver-pacing.ts`:

```typescript
// Build-up mode pacing: translate wall-clock elapsed → target quality.
// qTarget(t, buildUpSec) ramps linearly from 0 at t=0 to BUILD_UP_TARGET_Q
// at t=buildUpSec, then clamps. The mount loop dispatches more chaos
// iterations every frame until the renderer's measured q reaches qTarget.

export const BUILD_UP_TARGET_Q = 50;

export function qTarget(elapsedSec: number, buildUpSec: number): number {
  if (elapsedSec <= 0) return buildUpSec <= 0 ? BUILD_UP_TARGET_Q : 0;
  if (buildUpSec <= 0) return BUILD_UP_TARGET_Q;
  if (elapsedSec >= buildUpSec) return BUILD_UP_TARGET_Q;
  return (elapsedSec / buildUpSec) * BUILD_UP_TARGET_Q;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screensaver-pacing.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/screensaver-pacing.ts src/screensaver-pacing.test.ts
git commit -m "feat(#109): screensaver build-up pacing helper"
```

---

## Phase 2 — Landing page (3 tasks)

End-of-phase milestone: `/v1/screensaver` renders, top bar shows, settings card visible, Play button stub fires a callback (no rendering yet).

### Task 4: `mountScreensaverBar()` in `src/ui-bar.ts`

**Files:**
- Modify: `src/ui-bar.ts` (add new exported function + interfaces)

Follow the shape of `mountAboutBar()` (slim, brand-left, no right-side controls — the screensaver page handles its own pill / strip separately).

- [ ] **Step 1: Read the existing `mountAboutBar` for shape**

Read `src/ui-bar.ts` around line 948 — that's the closest analogue (slim brand-only bar for a non-viewer page).

- [ ] **Step 2: Add the new interfaces + function**

Append in `src/ui-bar.ts` near `mountAboutBar`:

```typescript
// ─── mountScreensaverBar (#109) ─────────────────────────────────────────────
// Slim variant for the /v1/screensaver page. Brand-left + about-link only.
// The screensaver page renders its own "Now playing" pill + permanent
// controls strip; the bar stays minimal so fullscreen looks clean when CSS
// hides chrome.

export interface ScreensaverBarOpts {
  brandHref?: string;
}

export interface ScreensaverBarHandle {
  /** Body slot — the page mounts the settings card / canvas under this. */
  slot: HTMLElement;
}

export function mountScreensaverBar(
  root: HTMLElement,
  _opts: ScreensaverBarOpts = {},
): ScreensaverBarHandle {
  const bar = el('div', 'pyr3-topbar');
  const left = el('div', 'pyr3-topbar-left');
  left.append(buildBrand(), buildAboutLink());
  bar.append(left);
  root.append(bar);
  const slot = el('div', 'pyr3-screensaver-body');
  root.append(slot);
  return { slot };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck; echo "EXIT: $?"`
Expected: `EXIT: 0`.

- [ ] **Step 4: Commit**

```bash
git add src/ui-bar.ts
git commit -m "feat(#109): mountScreensaverBar() variant"
```

---

### Task 5: `screensaver-ui` — landing settings card

**Files:**
- Create: `src/screensaver-ui.ts`
- Create: `src/screensaver-ui.test.ts`

Render the mode picker, three ladder controls, Play button. Ladder pattern follows `reference-bar-panel-ladder-pattern` from auto-memory (Size/Quality/SETTLE shape): preset buttons + freeform text input next to each ladder.

- [ ] **Step 1: Write the failing test**

`src/screensaver-ui.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountScreensaverLanding } from './screensaver-ui';
import { _clearScreensaverPrefs, DEFAULTS } from './screensaver-prefs';

beforeEach(() => {
  document.body.innerHTML = '';
  _clearScreensaverPrefs();
});

describe('mountScreensaverLanding', () => {
  it('renders mode picker + 3 ladders + Play button', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    expect(document.querySelector('[data-screensaver-mode="slideshow"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-mode="build-up"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="buildUpSec"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="restSec"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-ladder="holdSec"]')).toBeTruthy();
    expect(document.querySelector('[data-screensaver-play]')).toBeTruthy();
  });

  it('initializes from DEFAULTS when prefs absent', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const input = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="buildUpSec"] input',
    );
    expect(input).toBeTruthy();
    expect(Number(input!.value)).toBe(DEFAULTS.buildUpSec);
  });

  it('clicking a ladder preset updates the freeform input', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-screensaver-ladder="buildUpSec"] button[data-value="60"]',
    );
    btn!.click();
    const input = document.querySelector<HTMLInputElement>(
      '[data-screensaver-ladder="buildUpSec"] input',
    );
    expect(Number(input!.value)).toBe(60);
  });

  it('Play fires callback with current prefs', () => {
    const onPlay = vi.fn();
    mountScreensaverLanding(document.body, { onPlay });
    const slideshow = document.querySelector<HTMLElement>(
      '[data-screensaver-mode="slideshow"]',
    );
    slideshow!.click();
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onPlay.mock.calls[0][0].mode).toBe('slideshow');
  });

  it('Play call persists prefs', () => {
    mountScreensaverLanding(document.body, { onPlay: () => {} });
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-screensaver-ladder="holdSec"] button[data-value="30"]',
    );
    btn!.click();
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    const stored = localStorage.getItem('pyr3.screensaver.prefs');
    expect(stored).toContain('"holdSec":30');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screensaver-ui.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`src/screensaver-ui.ts`:

```typescript
// Landing settings card for /v1/screensaver: mode picker, 3 ladder controls
// (build-up time, rest period, slideshow hold), and a Play button. Pattern
// mirrors the Size/Quality/SETTLE bar+panel ladder pattern documented in
// reference-bar-panel-ladder-pattern.md (auto-memory).

import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  parseSecondsInput,
  CLAMPS,
  type ScreensaverPrefs,
  type ScreensaverMode,
} from './screensaver-prefs';

export interface ScreensaverLandingOpts {
  onPlay: (prefs: ScreensaverPrefs) => void;
}

export interface ScreensaverLandingHandle {
  /** Caller may hide/show the card when Play is clicked. */
  card: HTMLElement;
  /** Re-render values from current prefs (used when reopening via "S" key). */
  refresh(): void;
}

const LADDERS = {
  buildUpSec: [30, 60, 300, 600],
  restSec:    [10, 30, 60, 120],
  holdSec:    [5,  15, 30, 60],
} as const;

type LadderField = keyof typeof LADDERS;

function fmtSec(n: number): string {
  if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function mountScreensaverLanding(
  host: HTMLElement,
  opts: ScreensaverLandingOpts,
): ScreensaverLandingHandle {
  const card = el('div', 'pyr3-screensaver-card');
  let prefs = readScreensaverPrefs();

  // Mode picker
  const modeRow = el('div', 'pyr3-screensaver-mode-row');
  const slideshowBtn = el('button', 'pyr3-screensaver-mode-btn');
  slideshowBtn.dataset.screensaverMode = 'slideshow';
  slideshowBtn.textContent = 'Slideshow';
  const buildUpBtn = el('button', 'pyr3-screensaver-mode-btn');
  buildUpBtn.dataset.screensaverMode = 'build-up';
  buildUpBtn.textContent = 'Build-up';
  modeRow.append(slideshowBtn, buildUpBtn);

  function refreshModeButtons(): void {
    slideshowBtn.classList.toggle('on', prefs.mode === 'slideshow');
    buildUpBtn.classList.toggle('on', prefs.mode === 'build-up');
  }
  slideshowBtn.addEventListener('click', () => {
    prefs = { ...prefs, mode: 'slideshow' };
    refreshModeButtons();
  });
  buildUpBtn.addEventListener('click', () => {
    prefs = { ...prefs, mode: 'build-up' };
    refreshModeButtons();
  });

  // Ladder rows
  const ladderRows: Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }> = {} as any;

  function buildLadder(field: LadderField, label: string): HTMLElement {
    const row = el('div', 'pyr3-screensaver-ladder-row');
    row.dataset.screensaverLadder = field;
    const labelEl = el('label', 'pyr3-screensaver-ladder-label');
    labelEl.textContent = label;
    row.append(labelEl);

    const buttons: HTMLButtonElement[] = [];
    for (const v of LADDERS[field]) {
      const b = el('button', 'pyr3-screensaver-ladder-btn');
      b.dataset.value = String(v);
      b.textContent = fmtSec(v);
      b.addEventListener('click', () => {
        prefs = { ...prefs, [field]: v };
        input.value = String(v);
        refreshLadder(field);
      });
      row.append(b);
      buttons.push(b);
    }

    const input = el('input', 'pyr3-screensaver-ladder-input');
    input.type = 'text';
    input.value = String(prefs[field]);
    input.addEventListener('change', () => {
      const parsed = parseSecondsInput(input.value);
      if (parsed === null) {
        input.value = String(prefs[field]);
        return;
      }
      const { min, max } = CLAMPS[field];
      const clamped = Math.max(min, Math.min(max, parsed));
      prefs = { ...prefs, [field]: clamped };
      input.value = String(clamped);
      refreshLadder(field);
    });
    row.append(input);

    ladderRows[field] = { input, buttons };
    return row;
  }

  function refreshLadder(field: LadderField): void {
    const { input, buttons } = ladderRows[field];
    input.value = String(prefs[field]);
    for (const b of buttons) {
      b.classList.toggle('on', Number(b.dataset.value) === prefs[field]);
    }
  }

  card.append(modeRow);
  card.append(buildLadder('buildUpSec', 'Build-up time'));
  card.append(buildLadder('restSec',    'Rest period'));
  card.append(buildLadder('holdSec',    'Slideshow hold'));

  // Play button
  const play = el('button', 'pyr3-screensaver-play');
  play.dataset.screensaverPlay = '';
  play.textContent = '▶ Play';
  play.addEventListener('click', () => {
    writeScreensaverPrefs(prefs);
    opts.onPlay(prefs);
  });
  card.append(play);

  host.append(card);

  refreshModeButtons();
  (Object.keys(LADDERS) as LadderField[]).forEach(refreshLadder);

  return {
    card,
    refresh() {
      prefs = readScreensaverPrefs();
      refreshModeButtons();
      (Object.keys(LADDERS) as LadderField[]).forEach(refreshLadder);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/screensaver-ui.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/screensaver-ui.ts src/screensaver-ui.test.ts
git commit -m "feat(#109): screensaver landing card (mode + ladders + Play)"
```

---

### Task 6: `screensaver-mount` skeleton + `main.ts` routing

**Files:**
- Create: `src/screensaver-mount.ts`
- Create: `src/screensaver-mount.test.ts`
- Modify: `src/main.ts` — add `/v1/screensaver` page-type detection + dynamic import

Mount skeleton wires the page chrome and routes Play to a stub. Modes come in Phase 3.

- [ ] **Step 1: Wire main.ts routing branch**

In `src/main.ts`, find the page-type detection block (around line 193 — the `if (p === '/v1/edit' …)` chain). Add a sibling branch:

```typescript
if (p === '/v1/screensaver' || p.startsWith('/v1/screensaver/')) return 'screensaver';
```

Add the dispatch (mirror how `/v1/edit` dispatches via `mountEditPage` around line 449). Locate the editor branch and add a screensaver branch right after, before any default-viewer setup:

```typescript
if (pageType === 'screensaver') {
  const { mountScreensaverPage } = await import('./screensaver-mount');
  mountScreensaverPage({ root: document.body });
  return;
}
```

(Exact insertion site: find the `if (pageType === 'editor')` block in `main.ts` and add the screensaver branch with the same shape.)

- [ ] **Step 2: Write the failing test**

`src/screensaver-mount.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountScreensaverPage } from './screensaver-mount';
import { _clearScreensaverPrefs } from './screensaver-prefs';

beforeEach(() => {
  document.body.innerHTML = '';
  _clearScreensaverPrefs();
  vi.clearAllMocks();
});

describe('mountScreensaverPage', () => {
  it('renders the top bar + landing card', () => {
    mountScreensaverPage({ root: document.body });
    expect(document.querySelector('.pyr3-topbar')).toBeTruthy();
    expect(document.querySelector('.pyr3-screensaver-card')).toBeTruthy();
  });

  it('renders the permanent controls strip', () => {
    mountScreensaverPage({ root: document.body });
    const strip = document.querySelector('.pyr3-screensaver-strip');
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain('Space');
    expect(strip!.textContent).toContain('settings');
  });

  it('hides settings card after Play, shows now-playing pill', () => {
    mountScreensaverPage({ root: document.body });
    const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
    play!.click();
    expect(document.querySelector('.pyr3-screensaver-card')?.classList.contains('hidden'))
      .toBe(true);
    expect(document.querySelector('.pyr3-screensaver-pill')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/screensaver-mount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the skeleton**

`src/screensaver-mount.ts`:

```typescript
// Mount the /v1/screensaver page. Wires the top bar, landing card,
// permanent controls strip, and (Phase 3) the canvas + mode loops.
//
// Structural analogue of edit-mount.ts: owns the page-level state machine.
// Engine modules untouched — see docs/superpowers/specs/2026-06-05-screensaver-design.md.

import { mountScreensaverBar } from './ui-bar';
import { mountScreensaverLanding } from './screensaver-ui';
import type { ScreensaverPrefs } from './screensaver-prefs';

export interface MountScreensaverOpts {
  root: HTMLElement;
}

export interface ScreensaverPageHandle {
  /** For tests / future Stop-button. Returns to landing state. */
  stop(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function buildControlsStrip(): HTMLElement {
  const strip = el('div', 'pyr3-screensaver-strip');
  strip.textContent = 'Space pause · ← → skip · F fullscreen · Esc exit FS · S settings';
  return strip;
}

function buildNowPlayingPill(opts: { onStop: () => void }): HTMLElement {
  const pill = el('div', 'pyr3-screensaver-pill');
  const stop = el('button', 'pyr3-screensaver-pill-stop');
  stop.textContent = '⏸';
  stop.addEventListener('click', opts.onStop);
  pill.append(stop);
  return pill;
}

export function mountScreensaverPage(opts: MountScreensaverOpts): ScreensaverPageHandle {
  const { root } = opts;
  root.innerHTML = '';

  const { slot } = mountScreensaverBar(root, {});

  // Canvas slot — empty in skeleton; Phase 3 wires the WebGPU canvas here.
  const canvasHost = el('div', 'pyr3-screensaver-canvas-host');
  slot.append(canvasHost);

  // Landing card.
  const landing = mountScreensaverLanding(slot, {
    onPlay: (prefs: ScreensaverPrefs) => {
      landing.card.classList.add('hidden');
      const pill = buildNowPlayingPill({ onStop: stopPlayback });
      slot.append(pill);
      // Phase 3: pill exists; queue + renderer wiring lands in Tasks 7–9.
      void prefs;
    },
  });

  function stopPlayback(): void {
    document.querySelector('.pyr3-screensaver-pill')?.remove();
    landing.card.classList.remove('hidden');
    landing.refresh();
  }

  const strip = buildControlsStrip();
  root.append(strip);

  return { stop: stopPlayback };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/screensaver-mount.test.ts && npm run typecheck; echo "EXIT: $?"`
Expected: `EXIT: 0`.

- [ ] **Step 6: Commit**

```bash
git add src/screensaver-mount.ts src/screensaver-mount.test.ts src/main.ts
git commit -m "feat(#109): screensaver page mount + routing"
```

- [ ] **Step 7: Chrome verify (hand off to lead — inline)**

This step is for the lead, not a subagent (needs dev server). Surface URL: `http://localhost:5173/v1/screensaver`. Confirm landing card renders with the standard top bar, controls strip is visible at bottom, clicking Play hides the card and shows the pill. No flame yet — that's Phase 3.

---

## Phase 3 — Modes + transitions + UX (3 tasks)

End-of-phase milestone: both modes render real flames, prev/next/space/F/Esc/S all work, fullscreen works, transitions are visible.

### Task 7: Build-up mode + fade-to-black transition

**Files:**
- Modify: `src/screensaver-mount.ts` — wire canvas + queue + pacing loop + fade-to-black

Reuses `createEditRenderer` (the headless-render-friendly renderer used by `edit-mount.ts`). The build-up loop pulls a `SheepRef` from the queue, loads its `.flam3`, then drives `applyLane('slow', …)` per frame while measuring quality against `qTarget`.

- [ ] **Step 1: Read the relevant signatures**

Read `src/edit-render.ts` lines 31–80 for `EditRenderer` / `createEditRenderer`. Read `src/edit-mount.ts` lines 320–400 for how `requestLiveRender` drives the slow lane. The screensaver loop will use a similar continuous-render pattern but advance per-flame on its own timer.

- [ ] **Step 2: Add the build-up loop to `screensaver-mount.ts`**

Add inside `mountScreensaverPage`, replacing the Phase 2 stub `onPlay` body. The full new body:

```typescript
// Inside mountScreensaverPage, after canvasHost is created:

let stopFn: (() => void) | null = null;

async function startBuildUp(prefs: ScreensaverPrefs): Promise<void> {
  const { device, format, canvas } = await acquireGpuCanvas(canvasHost);
  const { loadFeatureIndex } = await import('./feature-index-client');
  const { createScreensaverQueue } = await import('./screensaver-queue');
  const { qTarget, BUILD_UP_TARGET_Q } = await import('./screensaver-pacing');
  const { loadCorpusGenomeByRef } = await import('./screensaver-corpus');
  const { createEditRenderer } = await import('./edit-render');

  const index = await loadFeatureIndex();
  const allRefs = index.filter(() => true); // 52k SheepRefs
  const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));

  const renderer = createEditRenderer({ device, format, canvas });
  let cancelled = false;
  stopFn = () => { cancelled = true; };

  while (!cancelled) {
    const ref = queue.next();
    if (!ref) break;
    const genome = await loadCorpusGenomeByRef(ref);
    const startedAt = performance.now();
    canvas.style.opacity = '1';
    // Pacing loop — iterate until elapsed reaches buildUpSec OR cancelled.
    while (!cancelled) {
      const elapsed = (performance.now() - startedAt) / 1000;
      const target = qTarget(elapsed, prefs.buildUpSec);
      const measured = await renderer.applyLane(
        'slow', genome, /*seed*/ 1, canvas, canvas.width, canvas.height,
      );
      if (target >= BUILD_UP_TARGET_Q || elapsed >= prefs.buildUpSec) break;
      void measured;
      await new Promise(requestAnimationFrame);
    }
    // Rest period — hold at full quality.
    await sleep(prefs.restSec * 1000, () => cancelled);
    if (cancelled) break;
    // Fade-to-black 2s, then loop to next flame.
    canvas.style.transition = 'opacity 2s';
    canvas.style.opacity = '0';
    await sleep(2200, () => cancelled);
    canvas.style.transition = '';
  }
}

async function sleep(ms: number, cancel: () => boolean): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < ms) {
    if (cancel()) return;
    await new Promise(r => setTimeout(r, Math.min(50, ms)));
  }
}

async function acquireGpuCanvas(host: HTMLElement): Promise<{
  device: GPUDevice; format: GPUTextureFormat; canvas: HTMLCanvasElement;
}> {
  const canvas = el('canvas', 'pyr3-screensaver-canvas');
  canvas.width = host.clientWidth || 1024;
  canvas.height = host.clientHeight || 1024;
  host.append(canvas);
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const ctx = canvas.getContext('webgpu')!;
  ctx.configure({ device, format, alphaMode: 'opaque' });
  return { device, format, canvas };
}
```

Replace the existing `onPlay` body:

```typescript
const landing = mountScreensaverLanding(slot, {
  onPlay: (prefs) => {
    landing.card.classList.add('hidden');
    const pill = buildNowPlayingPill({ onStop: stopPlayback });
    slot.append(pill);
    if (prefs.mode === 'build-up') void startBuildUp(prefs);
    // slideshow path lands in Task 8.
  },
});

function stopPlayback(): void {
  stopFn?.();
  stopFn = null;
  document.querySelector('.pyr3-screensaver-pill')?.remove();
  document.querySelector('.pyr3-screensaver-canvas')?.remove();
  landing.card.classList.remove('hidden');
  landing.refresh();
}
```

- [ ] **Step 3: Create the corpus-by-ref loader helper**

Create `src/screensaver-corpus.ts`:

```typescript
// Resolve a SheepRef → parsed Genome by fetching its .flam3 from chunks and
// parsing via the same chunk-fetch path the viewer uses. Thin wrapper; the
// per-genome decoding logic already lives in chunk-fetch + flame-import.

import type { SheepRef } from './screensaver-queue';
import type { Genome } from './genome';
import { fetchGenomeByRef } from './chunk-fetch';

export async function loadCorpusGenomeByRef(ref: SheepRef): Promise<Genome> {
  return fetchGenomeByRef(ref.gen, ref.id);
}
```

If `chunk-fetch` does not expose `fetchGenomeByRef` under that name, the implementer should adapt this thin wrapper to whatever the existing chunk-fetch loader exposes (`loadCorpusGenome`, `fetchCorpusFlame`, etc.) — grep `chunk-fetch.ts` for the public loader API and reuse it.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck; echo "EXIT: $?"`
Expected: `EXIT: 0` — fix any signature mismatches against the real `EditRenderer` / `chunk-fetch` APIs surfaced by tsc.

- [ ] **Step 5: Update mount test to cover the build-up Play path**

Add to `src/screensaver-mount.test.ts`:

```typescript
it('build-up Play attaches a canvas to the host', () => {
  // Note: the actual GPU loop is skipped in unit tests (no WebGPU in jsdom);
  // we just assert the canvas placeholder is wired.
  mountScreensaverPage({ root: document.body });
  const buildUpBtn = document.querySelector<HTMLButtonElement>(
    '[data-screensaver-mode="build-up"]',
  );
  buildUpBtn!.click();
  const play = document.querySelector<HTMLButtonElement>('[data-screensaver-play]');
  play!.click();
  // pill appears synchronously even though startBuildUp is async
  expect(document.querySelector('.pyr3-screensaver-pill')).toBeTruthy();
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/screensaver-mount.test.ts; echo "EXIT: $?"`
Expected: `EXIT: 0`.

- [ ] **Step 7: Commit**

```bash
git add src/screensaver-mount.ts src/screensaver-mount.test.ts src/screensaver-corpus.ts
git commit -m "feat(#109): build-up mode (pacing loop + fade-to-black + corpus loader)"
```

---

### Task 8: Slideshow mode + prefetch + crossfade

**Files:**
- Modify: `src/screensaver-mount.ts`

Slideshow uses two canvas layers: the front layer holds the current flame; the back layer renders the next flame during the current's hold period. When `holdSec` elapses, animate `opacity` on both for ~1.5s, then swap roles.

- [ ] **Step 1: Add the slideshow loop alongside `startBuildUp`**

In `src/screensaver-mount.ts`:

```typescript
async function startSlideshow(prefs: ScreensaverPrefs): Promise<void> {
  const { loadFeatureIndex } = await import('./feature-index-client');
  const { createScreensaverQueue } = await import('./screensaver-queue');
  const { loadCorpusGenomeByRef } = await import('./screensaver-corpus');
  const { createEditRenderer } = await import('./edit-render');

  const front = await acquireGpuCanvas(canvasHost);
  const back  = await acquireGpuCanvas(canvasHost);
  back.canvas.style.position = 'absolute';
  back.canvas.style.inset = '0';
  back.canvas.style.opacity = '0';
  front.canvas.style.position = 'absolute';
  front.canvas.style.inset = '0';

  const index = await loadFeatureIndex();
  const allRefs = index.filter(() => true);
  const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));

  const rendererFront = createEditRenderer({ device: front.device, format: front.format, canvas: front.canvas });
  const rendererBack  = createEditRenderer({ device: back.device,  format: back.format,  canvas: back.canvas  });

  let cancelled = false;
  stopFn = () => { cancelled = true; };

  // Prime front with first flame.
  const firstRef = queue.next();
  if (!firstRef) return;
  const firstGenome = await loadCorpusGenomeByRef(firstRef);
  await rendererFront.applyLane('rebuild', firstGenome, 1, front.canvas, front.canvas.width, front.canvas.height);
  front.canvas.style.opacity = '1';

  let activeFront = true;
  while (!cancelled) {
    // While front holds, render next into back.
    const nextRef = queue.next();
    if (!nextRef) break;
    const nextGenome = await loadCorpusGenomeByRef(nextRef);
    const back2 = activeFront ? back : front;
    const renderer2 = activeFront ? rendererBack : rendererFront;
    await renderer2.applyLane('rebuild', nextGenome, 1, back2.canvas, back2.canvas.width, back2.canvas.height);
    // Wait the remainder of the hold period (prefetch races the hold timer).
    await sleep(prefs.holdSec * 1000, () => cancelled);
    if (cancelled) break;
    // Crossfade 1.5s.
    const fade = '1.5s';
    front.canvas.style.transition = `opacity ${fade}`;
    back.canvas.style.transition  = `opacity ${fade}`;
    if (activeFront) {
      back.canvas.style.opacity  = '1';
      front.canvas.style.opacity = '0';
    } else {
      front.canvas.style.opacity = '1';
      back.canvas.style.opacity  = '0';
    }
    await sleep(1600, () => cancelled);
    activeFront = !activeFront;
  }
}
```

Wire the `onPlay` branch:

```typescript
onPlay: (prefs) => {
  landing.card.classList.add('hidden');
  const pill = buildNowPlayingPill({ onStop: stopPlayback });
  slot.append(pill);
  if (prefs.mode === 'build-up') void startBuildUp(prefs);
  else                          void startSlideshow(prefs);
},
```

Update `stopPlayback` to remove BOTH canvases:

```typescript
function stopPlayback(): void {
  stopFn?.();
  stopFn = null;
  document.querySelector('.pyr3-screensaver-pill')?.remove();
  for (const c of document.querySelectorAll('.pyr3-screensaver-canvas')) c.remove();
  landing.card.classList.remove('hidden');
  landing.refresh();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck; echo "EXIT: $?"`
Expected: `EXIT: 0`.

- [ ] **Step 3: Commit**

```bash
git add src/screensaver-mount.ts
git commit -m "feat(#109): slideshow mode (prefetch double-buffer + crossfade)"
```

---

### Task 9: Keyboard + now-playing pill controls + fullscreen

**Files:**
- Modify: `src/screensaver-mount.ts`

Bindings (spec §8):

```text
Space            pause / resume
← / →            prev / next flame
F                toggle fullscreen
Esc              exit fullscreen (no-op when windowed)
S                stop + return to landing (this is "show settings card")
```

Each handler delegates to a small `controlBus` so prev/next/pause work consistently across both modes. The pill gains visible prev/next/pause/fullscreen buttons on cursor activity (2-second auto-hide).

- [ ] **Step 1: Add the controlBus interface and wire it into both modes**

In `src/screensaver-mount.ts`, add near the top of `mountScreensaverPage`:

```typescript
interface ControlBus {
  setActive(handlers: {
    onSkip(direction: 1 | -1): void;
    onPause(): void;
    onResume(): void;
  }): void;
  clear(): void;
}

const controlBus: ControlBus = (() => {
  let active: Parameters<ControlBus['setActive']>[0] | null = null;
  return {
    setActive(h) { active = h; },
    clear()      { active = null; },
  } as ControlBus & { active?: typeof active };
})();
```

Both `startBuildUp` and `startSlideshow` should call `controlBus.setActive({...})` at start. For the build-up loop, store `cancelled` + a `skipRequested: -1 | 0 | 1` flag in a closure; the pacing loop checks it each frame and breaks out to advance. For slideshow, prev/next short-circuit the hold timer.

Concrete: hoist a `let skipDir: -1 | 1 | 0 = 0;` and `let paused = false;` into each mode's closure, and replace the inner `sleep(prefs.restSec * 1000, () => cancelled)` with `sleep(prefs.restSec * 1000, () => cancelled || skipDir !== 0)`. After the sleep returns, if `skipDir === -1`, replace the last `queue.next()` with `queue.prev()` for the next iteration.

(Exact implementation detail: the implementer chooses the cleanest signal-passing; the spec is "Space pauses/resumes, ←/→ skip prev/next, both work mid-render".)

- [ ] **Step 2: Add keyboard listener**

In `mountScreensaverPage`, register one window-level keydown listener (clean it up on stopPlayback):

```typescript
function onKey(ev: KeyboardEvent): void {
  if (ev.key === ' ' || ev.code === 'Space') {
    ev.preventDefault();
    // The active handler tracks paused state internally.
    (controlBus as any).active?.onPause(); // single-toggle; impl decides resume vs pause
    return;
  }
  if (ev.key === 'ArrowRight') { (controlBus as any).active?.onSkip(1);  return; }
  if (ev.key === 'ArrowLeft')  { (controlBus as any).active?.onSkip(-1); return; }
  if (ev.key === 'f' || ev.key === 'F') {
    void toggleFullscreen(canvasHost);
    return;
  }
  if (ev.key === 's' || ev.key === 'S') {
    stopPlayback();
    return;
  }
  if (ev.key === 'Escape') {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    }
    return;
  }
}
window.addEventListener('keydown', onKey);
```

Add cleanup to `stopPlayback`:

```typescript
window.removeEventListener('keydown', onKey);
```

- [ ] **Step 3: Add fullscreen helper**

```typescript
async function toggleFullscreen(target: HTMLElement): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await target.requestFullscreen();
  }
}
```

- [ ] **Step 4: Now-playing pill gets visible buttons + cursor auto-hide**

Update `buildNowPlayingPill`:

```typescript
function buildNowPlayingPill(opts: {
  onStop: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPause: () => void;
  onFullscreen: () => void;
}): HTMLElement {
  const pill = el('div', 'pyr3-screensaver-pill');
  function btn(label: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'pyr3-screensaver-pill-btn');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  pill.append(
    btn('⏮', opts.onPrev),
    btn('⏸', opts.onPause),
    btn('⏭', opts.onNext),
    btn('⛶', opts.onFullscreen),
    btn('⏹', opts.onStop),
  );

  // Cursor auto-hide: hidden by default, show on mousemove, hide after 2s idle.
  let hideTimer: number | undefined;
  function show(): void {
    pill.classList.remove('idle-hidden');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => pill.classList.add('idle-hidden'), 2000);
  }
  window.addEventListener('mousemove', show);
  pill.classList.add('idle-hidden');
  show();
  return pill;
}
```

Wire it at the `onPlay` site:

```typescript
const pill = buildNowPlayingPill({
  onStop: stopPlayback,
  onPrev: () => (controlBus as any).active?.onSkip(-1),
  onNext: () => (controlBus as any).active?.onSkip(1),
  onPause: () => (controlBus as any).active?.onPause(),
  onFullscreen: () => void toggleFullscreen(canvasHost),
});
```

- [ ] **Step 5: Typecheck + run mount tests**

Run: `npm run typecheck && npx vitest run src/screensaver-mount.test.ts; echo "EXIT: $?"`
Expected: `EXIT: 0`.

- [ ] **Step 6: Commit**

```bash
git add src/screensaver-mount.ts
git commit -m "feat(#109): keyboard + now-playing pill + fullscreen"
```

---

## Phase 4 — Verify + ship (2 tasks)

End-of-phase milestone: feature shipped, top-bar nav links to `/v1/screensaver` from every other page, #109 closed.

### Task 10: Chrome verify pass (lead, inline)

**Files:** none modified; this is the human-eye gate.

- [ ] **Step 1: Start dev server**

Run (background): `npm run dev`
Wait for "Local: http://localhost:5173/" in the log.

- [ ] **Step 2: Open verify URL**

Hand the user: `http://localhost:5173/v1/screensaver`

- [ ] **Step 3: Walk the golden path**

Run through spec §11 Chrome-verify checklist:

```text
[ ] Landing renders top bar + settings card + bottom strip
[ ] Defaults: build-up mode, 300s build-up, 30s rest, 15s hold
[ ] Click a ladder preset → freeform input updates
[ ] Type "5m" in freeform → parses to 300, value persists after reload
[ ] Click Play → card hides, pill appears, canvas begins build-up
[ ] Press F → fullscreen; strip + pill still visible at bottom
[ ] Press → → fade-to-black, next flame begins from empty
[ ] Press Space → render pauses; Space → resumes
[ ] Press ← → prev flame from history
[ ] Press Esc → exits fullscreen; rendering continues
[ ] Press S → returns to landing card; playback stops
[ ] Switch to slideshow mode + Play → flames crossfade
[ ] Reload page → settings persisted from last Play
```

- [ ] **Step 4: Surface findings to the user**

Report which boxes ticked + any divergences. Do not claim ship without a human go.

- [ ] **Step 5: Stop dev server**

Background `npm run dev` PID kill (or let the lead stop it).

---

### Task 11: Top-bar nav link + close #109

**Files:**
- Modify: `src/ui-bar.ts` (add "Screensaver" link to mountBar / mountEditBar / mountGalleryBar / mountAboutBar nav slots)
- Modify: `src/ui-bar.ts` near `buildAboutLink()` — add `buildScreensaverLink()`

- [ ] **Step 1: Add the link builder**

Near `buildAboutLink()` in `src/ui-bar.ts`:

```typescript
function buildScreensaverLink(): HTMLElement {
  const a = document.createElement('a');
  a.className = 'pyr3-topbar-link';
  a.href = `${import.meta.env.BASE_URL}v1/screensaver`;
  a.textContent = 'Screensaver';
  return a;
}
```

- [ ] **Step 2: Plumb it into every bar variant**

For each of `mountBar` / `mountEditBar` / `mountGalleryBar` / `mountAboutBar` / `mountScreensaverBar`, find the `left.append(...)` site that already adds `buildBrand()` + `buildAboutLink()` and add `buildScreensaverLink()` at the end of that list.

- [ ] **Step 3: Verify in Chrome (lead, inline)**

Restart dev server. Visit `/`, `/v1/gallery`, `/v1/edit`, `/about` — confirm "Screensaver" appears in the top-bar nav on each. Click it → lands on `/v1/screensaver`.

- [ ] **Step 4: Run full check**

Run: `npm run typecheck && npm test; echo "EXIT: $?"`
Expected: `EXIT: 0`.

- [ ] **Step 5: Commit**

```bash
git add src/ui-bar.ts
git commit -m "feat(#109): top-bar 'Screensaver' link on all pages"
```

- [ ] **Step 6: Squash + FF-merge (asks user permission per global rule)**

Lead surfaces the branch summary:
- Total commits on `feature/issue-109-screensaver`
- Test counts before / after
- Chrome verify results (Task 10 box-tick list)
- Final line: "FF-merge to main? y/n"

Per global rule, EVERY FF-merge to main is an explicit per-instance approval. Do not auto-merge.

- [ ] **Step 7: Close #109 on merge**

After FF-merge + push lands and live verify passes:

```bash
gh issue close 109 --comment "Shipped via #109 implementation plan. See ${COMMIT_SHA} on main."
```

(Lead types the commit SHA, never computes from memory — per `feedback-verify-live-before-claiming-ship`.)

---

## Self-review (already done inline)

- **Spec coverage:** §1 (goal) → P1+P2+P3; §2 (architecture) → file structure ✓; §3 (landing) → T4+T5; §3.1 (controls strip) → T6; §4 (modes) → T7+T8; §5 (queue + skip) → T1+T9; §6 (transitions) → T7+T8; §7 (prefs) → T2; §8 (keyboard) → T9; §9 (fullscreen) → T9; §10 (out of scope) → no tasks (correct); §11 (testing) → tests in every Phase-1/2/3 task + T10 Chrome verify; §12 (acceptance) → T10 + T11.
- **Placeholders:** none — every step has concrete code, paths, or exact commands.
- **Type consistency:** `SheepRef` exported from `screensaver-queue.ts`, re-used by `screensaver-corpus.ts`; `ScreensaverPrefs` / `ScreensaverMode` exported from `screensaver-prefs.ts`, consumed by `screensaver-ui.ts` + `screensaver-mount.ts`; `qTarget` / `BUILD_UP_TARGET_Q` exported from `screensaver-pacing.ts`, consumed in T7.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-05-screensaver.md`.**

This is a code-only TypeScript project, so per the global per-project-type rule the recommended execution mode is **Subagent-Driven for pure-logic tasks; lead-Inline only when a task needs the dev server, Chrome-devtools-MCP, or `gh`**.

**Suggested per-task split:**

```text
T1  screensaver-queue           subagent  (pure logic, T1-of-phase locks queue shape)
T2  screensaver-prefs           subagent
T3  screensaver-pacing          subagent
T4  ui-bar mountScreensaverBar  inline    (T1-of-phase: locks bar variant idiom)
T5  screensaver-ui              subagent
T6  mount skeleton + routing    inline    (touches main.ts; Chrome-verify substep)
T7  build-up loop               inline    (T1-of-phase: locks engine wiring, GPU code)
T8  slideshow + prefetch        subagent  (replicates Task-7 shape)
T9  keyboard + pill + FS        subagent
T10 Chrome verify pass          inline    (dev server + chrome-devtools-mcp)
T11 top-bar links + close       inline    (touches every page + gh)
```

**Effort recommendation at phase boundaries:**
- Going INTO P1: mechanical impl of locked spec → `/effort medium`.
- Going INTO P3 (engine wiring): more design-loaded → `/effort high` for the inline T7.
- Going INTO P4: verification → `/effort low`.

(Effort flips are user-driven — these are advisory, not gates.)
