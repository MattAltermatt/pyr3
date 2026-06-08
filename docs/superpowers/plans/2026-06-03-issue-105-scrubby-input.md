# Issue #105 — Scrubby slider input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `input[type=number]` cell in `/v1/edit` with a reusable scrubby-input component (drag-to-scrub Blender / Photoshop / Figma style) that keeps double-click-to-text as the typing fallback.

**Architecture:** Single new module `src/edit-scrubby-input.ts` exports a `scrubbyInput({value, onInput, kind, ...}) => {el, setValue, destroy}` factory. Each of the 8 `src/edit-section-*.ts` files (plus `src/edit-ui.ts`) calls the factory in place of its current `input[type=number]` wiring. Sensitivity is percent-of-value (`|v| × 0.005` per pixel) with a per-`kind` MIN_STEP floor; modifiers `shift` ×10 / `ctrl|alt` ×0.1 are read live mid-drag. Pointer lock is best-effort with graceful unlocked fallback (same code path).

**Tech Stack:** TypeScript, happy-dom for unit tests, vitest. No new runtime deps. No render-path / WGSL impact.

**Spec:** `docs/superpowers/specs/2026-06-03-issue-105-scrubby-input-design.md` (the source of truth — read it before any task).

**Branch:** `feature/flame-editor-v1` (this work continues the open editor branch — do NOT cut a new branch).

---

## File map

**Create**
- `src/edit-scrubby-input.ts` — the `scrubbyInput` factory + `FieldKind` + `MIN_STEP` table + `RATE` constant.
- `src/edit-scrubby-input.test.ts` — happy-dom unit suite.

**Modify (call-site replacements)**
- `src/edit-section-viewport.ts` — 4 cells (scale, cx, cy, rotation).
- `src/edit-section-xforms.ts` — ~10 cell-kinds (affine decomposed 5, shear, raw a..f, weight, color, opacity, colorSpeed, variation weight + named params, xaos weights).
- `src/edit-section-final.ts` — same set as xforms.
- `src/edit-section-global.ts` — brightness, gamma, highlightPower, gammaThreshold, symmetry count.
- `src/edit-section-palette.ts` — hue.
- `src/edit-section-density.ts` — vibrancy + any siblings.
- `src/edit-section-render.ts` — width, height, quality, filterRadius (width/height are int with `minStep: 1` + integer formatter).
- `src/edit-ui.ts` — top-bar settle-delay input.
- `docs/keybindings.md` — add 3 modifier rows in the editor section with status `shipped`.

**Don't touch**
- Genome / WGSL / render code. No parity gate change.
- `edit-state.ts` lane scheduler. The existing slow-lane 80ms debounce handles the pointermove storm.

---

## Task 1: Build the `scrubbyInput` component + unit tests

**Files:**
- Create: `src/edit-scrubby-input.ts`
- Create: `src/edit-scrubby-input.test.ts`

This is the load-bearing task — all later tasks are mechanical replacement.

### Step 1.1 — Author the component

Implement `scrubbyInput` exactly as the spec's "Component API" section
defines. Concrete contract:

```ts
// src/edit-scrubby-input.ts
export type FieldKind = 'weight' | 'color' | 'position' | 'rotation' | 'scale' | 'generic';

export const RATE = 0.005;
export const MIN_STEP: Record<FieldKind, number> = {
  weight:   0.0025,
  color:    0.005,
  position: 0.001,
  rotation: 0.05,
  scale:    0.005,
  generic:  0.001,
};

export interface ScrubbyInputOpts {
  value: number;
  onInput: (v: number) => void;
  kind?: FieldKind;
  minStep?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  ariaLabel?: string;
}

export interface ScrubbyHandle {
  el: HTMLSpanElement;
  setValue(v: number): void;
  destroy(): void;
}

export function scrubbyInput(opts: ScrubbyInputOpts): ScrubbyHandle;
```

Required behaviors:

1. Render a `<span class="pyr3-scrubby">` with `tabindex="0"`, `role="spinbutton"`, `aria-valuenow`, `aria-label` (if provided), `cursor: ew-resize`.
2. `pointerdown` (button 0 only): record `startX = e.clientX`, `lastX = startX`, `startValue = value`, capture pointer (`el.setPointerCapture(e.pointerId)`), best-effort `el.requestPointerLock()` (fire-and-forget, no await), add `pyr3-scrubby-dragging` class.
3. `pointermove` while dragging: compute per-pixel delta as
   ```
   const dxPx = (document.pointerLockElement === el) ? e.movementX : (e.clientX - lastX);
   lastX = e.clientX;
   const mult = e.shiftKey ? 10 : (e.ctrlKey || e.altKey) ? 0.1 : 1;
   const perPx = Math.max(minStep, Math.abs(value) * RATE) * mult;
   value += dxPx * perPx;
   if (min != null) value = Math.max(min, value);
   if (max != null) value = Math.min(max, value);
   ```
   Update display, call `onInput(value)`.
4. `pointerup` / `pointercancel` / `lostpointercapture`: release capture, call `document.exitPointerLock()` if `pointerLockElement === el`, remove dragging class.
5. `dblclick`: replace span content with a focused `<input type="number">` (steptype matches kind — int for `kind=generic && format rounds to int`, else fractional); `min` / `max` mirror opts; `Enter` or blur commits via `onInput`; `Escape` reverts to pre-edit value.
6. Display formatter default: `format ?? defaultFormat`, where `defaultFormat(v) = trimZeros(v.toFixed(6))`. Always render at most 6 decimals.
7. `setValue(v)`: update internal value + display (used by surrounding code that rebuilds genome state); does NOT call `onInput`.
8. `destroy()`: remove all listeners, exit text mode if active, remove span from DOM.

CSS for `.pyr3-scrubby` and `.pyr3-scrubby-dragging` lives in
`src/edit-ui.ts` (or wherever the editor's stylesheet currently lives —
check first). Visual treatment per spec option A: looks identical to the
existing number input, only `cursor: ew-resize` on hover + 1px cyan
border tint via the dragging class (reuse the existing focus-ring color).

### Step 1.2 — Author the unit suite

`src/edit-scrubby-input.test.ts` covers all 7 spec test cases. Sample
shape (write all of these — none are optional):

```ts
import { describe, it, expect, vi } from 'vitest';
import { scrubbyInput, MIN_STEP, RATE } from './edit-scrubby-input';

function pdown(el: HTMLElement, x: number, init: Partial<PointerEventInit> = {}) {
  el.dispatchEvent(new PointerEvent('pointerdown', {clientX: x, button: 0, pointerId: 1, ...init}));
}
function pmove(el: HTMLElement, x: number, init: Partial<PointerEventInit> = {}) {
  el.dispatchEvent(new PointerEvent('pointermove', {clientX: x, pointerId: 1, ...init}));
}
function pup(el: HTMLElement, x: number) {
  el.dispatchEvent(new PointerEvent('pointerup', {clientX: x, pointerId: 1}));
}

describe('scrubbyInput', () => {
  it('emits per-pixel delta proportional to |value| × RATE for position kind', () => {
    const onInput = vi.fn();
    const {el} = scrubbyInput({value: 0.5, onInput, kind: 'position'});
    document.body.appendChild(el);
    pdown(el, 100);
    pmove(el, 110);    // dx = 10 px
    // |0.5| × 0.005 = 0.0025, floor 0.001 -> 0.0025/px; 10 px -> +0.025
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.525, 6));
    pup(el, 110);
  });

  it('shift modifier multiplies delta ×10', () => { /* ... */ });
  it('ctrl modifier multiplies delta ×0.1', () => { /* ... */ });
  it('clamps to min and max', () => { /* ... */ });
  it('uses kind=rotation floor (0.05) for large values', () => {
    const {el} = scrubbyInput({value: 46, onInput: vi.fn(), kind: 'rotation'});
    document.body.appendChild(el);
    // |46| × 0.005 = 0.23 > floor 0.05 -> 0.23/px
    // 1 px -> +0.23
    // ...
  });
  it('double-click swaps to text mode, Enter commits, Escape reverts', () => { /* ... */ });
  it('happy-dom unlocked path: pointerLockElement stays null, delta uses clientX', () => { /* ... */ });
  it('setValue updates display without firing onInput', () => { /* ... */ });
  it('destroy removes listeners and DOM node', () => { /* ... */ });
});
```

Use `expect.closeTo(..., 6)` for the float comparisons. happy-dom's
`PointerEvent` carries `shiftKey` / `ctrlKey` / `altKey` correctly. happy-dom
does NOT implement `requestPointerLock` — the call is a no-op which is
exactly what the fallback path expects (drag math reads `clientX`).

### Step 1.3 — Verify

Run: `npm test -- --run src/edit-scrubby-input.test.ts`
Expected: all cases pass, ~tens of ms wall.

Then full suite: `npm test -- --run`
Expected: 5325+ passing, 0 failures.

Then typecheck: `npm run typecheck`
Expected: exit 0.

### Step 1.4 — Commit

```bash
git add src/edit-scrubby-input.ts src/edit-scrubby-input.test.ts
git commit -m "edit: scrubby-input component (drag-to-scrub number cell) + unit tests"
```

---

## Task 2: Replace number inputs in `edit-section-viewport.ts` (proof + Chrome verify)

Smallest section (4 cells: `scale`, `cx`, `cy`, `rotation`). Use it as
the end-to-end proof before fanning out.

**Files:**
- Modify: `src/edit-section-viewport.ts`
- Modify: `src/edit-section-viewport.test.ts` (if it asserts on `input` elements — update to query the scrubby span instead).

### Step 2.1 — Replace

Read `src/edit-section-viewport.ts:~100-130` (the `input.type = 'number'` block at line 112 and any siblings). For each cell:

- Replace the `input` construction with `const {el} = scrubbyInput({value, onInput, kind, format?})`.
- `kind` per field: `scale` → `'scale'`, `cx`/`cy` → `'position'`, `rotation` → `'rotation'`.
- Append `el` where the input used to go.
- `onInput` keeps the existing closure that mutates genome + calls `scheduler.schedule({lane: 'slow', path: 'scale' | 'cx' | 'cy' | 'rotate'})`.

### Step 2.2 — Update / verify tests

Run: `npm test -- --run src/edit-section-viewport.test.ts`
If any assertion queries `input[type=number]`, update to query `.pyr3-scrubby` and simulate via the same pointer-event helpers from Task 1.

### Step 2.3 — Chrome verify (end-to-end proof)

Start dev server in background:
```bash
npm run dev
```
Hand the user this URL on its own line for manual verify:
```
http://localhost:5173/v1/edit
```

Verify in Chrome:
- Hover viewport cells → `ew-resize` cursor.
- Click-drag scale right → preview re-renders bigger.
- Shift-drag rotation → coarse rotation.
- Double-click cx → text input appears focused; type a value; Enter commits.
- Drag past viewport edge → on Chrome the pointer locks and scrub continues; if it doesn't, the drag still works up to the edge (graceful fallback).

Pause here for explicit user OK before continuing to Task 3 — this is the load-bearing visual / feel verify; everything past here is mechanical.

### Step 2.4 — Commit

```bash
git add src/edit-section-viewport.ts src/edit-section-viewport.test.ts
git commit -m "edit: viewport section uses scrubby-input for scale/cx/cy/rotation"
```

---

## Task 3: Replace in `edit-section-xforms.ts` + `edit-section-final.ts`

The big task — `edit-section-xforms.ts` has the most call sites (the
spec lists them). `edit-section-final.ts` is structurally identical.

**Files:**
- Modify: `src/edit-section-xforms.ts`
- Modify: `src/edit-section-final.ts`
- Modify: `src/edit-section-xforms.test.ts` (update any `input[type=number]` queries)
- Modify: `src/edit-section-final.test.ts` (same)

### Step 3.1 — Replace in `edit-section-xforms.ts`

Sites and `kind` to pass at each (verify by grep — exact lines drift):

| Where | Kind |
|-------|------|
| affine decomposed: scale x / scale y | `scale` |
| affine decomposed: rotation | `rotation` (suffix `°`) |
| affine decomposed: position x / position y | `position` |
| shear input | `position` |
| raw matrix `a` / `b` / `d` / `e` | `position` (unitless coeffs, sub-unit typical) |
| raw matrix `c` / `f` (translate) | `position` |
| xform weight | `weight` (min 0) |
| color | `color` (min 0, max 1) |
| opacity | `color` (min 0, max 1) |
| colorSpeed | `color` (min 0, max 1) |
| variation weight | `weight` |
| variation named params (power, dist, twist, freq, …) | `generic` |
| xaos per-destination weights | `weight` (min 0) |

Each call site swaps `input[type=number]` for `scrubbyInput(...)`,
preserving the existing onInput / genome-mutation / scheduler call.

### Step 3.2 — Repeat in `edit-section-final.ts`

Same kinds, same mapping. Final xform has no xaos.

### Step 3.3 — Verify

```bash
npm test -- --run src/edit-section-xforms.test.ts src/edit-section-final.test.ts
npm test -- --run                  # full suite
npm run typecheck
```
All exit 0.

Chrome verify (info-only, dev server already running):
- Drag every kind of xform cell.
- Confirm preview re-renders responsively.
- Click `+` to add an xform; verify new cells are scrubby.

### Step 3.4 — Commit

```bash
git add src/edit-section-xforms.ts src/edit-section-final.ts src/edit-section-xforms.test.ts src/edit-section-final.test.ts
git commit -m "edit: xforms + final-xform sections use scrubby-input across all numeric cells"
```

---

## Task 4: Replace in `edit-section-global.ts` + `edit-section-palette.ts` + `edit-section-density.ts`

Three small sections, similar mechanical replacement.

**Files:**
- Modify: `src/edit-section-global.ts` (note: has a local `numberInput()` helper at line ~50 — replace it with a `scrubbyNumber()` shim or just call `scrubbyInput` directly at each call site; whichever keeps the diff small).
- Modify: `src/edit-section-palette.ts` (hue cell at line ~156).
- Modify: `src/edit-section-density.ts` (number cell at line ~108).
- Modify: any of these files' `.test.ts` siblings that query `input[type=number]`.

Kinds:
- `brightness`, `gamma`, `highlightPower`, `gammaThreshold` → `generic`.
- `symmetry count` → integer; pass `format: (v) => String(Math.round(v))` and `minStep: 1`, `kind: 'generic'`. (The int rendering applies after each drag tick.)
- `hue` → `rotation` (degrees-ish range).
- `vibrancy` → `color` (min 0, max 1).

### Verify + commit

```bash
npm test -- --run && npm run typecheck
git add src/edit-section-global.ts src/edit-section-palette.ts src/edit-section-density.ts src/edit-section-global.test.ts src/edit-section-palette.test.ts src/edit-section-density.test.ts
git commit -m "edit: global/palette/density sections use scrubby-input"
```

---

## Task 5: Replace in `edit-section-render.ts` + top-bar settle-delay (`edit-ui.ts`)

**Files:**
- Modify: `src/edit-section-render.ts` (width, height, quality, filterRadius).
- Modify: `src/edit-ui.ts` (top-bar settle-delay at line ~107).
- Modify: matching tests.

Kinds:
- `width`, `height` → `generic` with `minStep: 1`, `format: (v) => String(Math.round(v))`, `min: 1`. Integer scrub.
- `quality` → `generic` with `minStep: 0.5` (fractional spp acceptable), `min: 0.5`.
- `filterRadius` → `generic` with `minStep: 0.005`, `min: 0`, `max: 5`.
- `settleDelayMs` (top bar) → `generic` with `minStep: 5`, `format: (v) => String(Math.round(v))`, `min: 0`, `max: 5000`.

### Verify + commit

```bash
npm test -- --run && npm run typecheck
git add src/edit-section-render.ts src/edit-ui.ts src/edit-section-render.test.ts
git commit -m "edit: render section + top-bar settle-delay use scrubby-input"
```

---

## Task 6: Update keybindings doc + final Chrome verify

**Files:**
- Modify: `docs/keybindings.md`

### Step 6.1 — Add three rows

In the editor section of `docs/keybindings.md`, add (preserve existing
table format):

| Action | Binding | Status |
|--------|---------|--------|
| Scrubby drag (any numeric cell) | drag horizontal | shipped |
| Scrubby coarse drag | shift + drag | shipped |
| Scrubby fine drag | ctrl/alt + drag | shipped |
| Scrubby text-edit mode | double-click | shipped |

### Step 6.2 — Full panel Chrome verify

Confirm at `http://localhost:5173/v1/edit`:
- Every cell in every subpanel responds to drag with the right "feel"
  (use the spec's worked-examples table as the calibration target —
  ~100 px to halve a scale value, ~200 px to rotate 46°, etc.).
- Modifiers work mid-drag (start dragging, press shift, see acceleration
  jump; release shift, see it return).
- Width / height in render section scrub as integers.
- Double-click cells with text typing still works.
- No regressions in existing behaviors (collapse / xform add / variation
  picker / palette / save).

Stop the dev server when done.

### Step 6.3 — Commit + hand-off

```bash
git add docs/keybindings.md
git commit -m "docs: keybindings table — scrubby drag modifiers (shipped)"
```

Hand the user:
- The commit range (`git log --oneline feature/flame-editor-v1 ^main`).
- A note that branch is N commits ahead, ready for user-verify-before-FF-merge.

Do NOT FF-merge to main. Per the active-branch handoff, user verifies in
Chrome before any FF-merge ask.

---

## Self-review

- ✅ Spec coverage: every section of the spec maps to a task. Sensitivity formula → Task 1.1. Modifiers → Task 1.1 + Task 6.1 (doc). Pointer-lock fallback → Task 1.1 (component) + Task 2.3 (Chrome verify). Visual treatment → Task 1.1 (CSS). All 9 modified-file sites → Tasks 2-5. Tests → Task 1.2 + per-task `.test.ts` updates.
- ✅ Placeholder scan: no TBDs, every code block has the actual content; the spec's MIN_STEP table is reproduced in Task 1.1; kind-mappings reproduced in Tasks 2-5.
- ✅ Type consistency: `FieldKind`, `ScrubbyInputOpts`, `ScrubbyHandle`, `RATE`, `MIN_STEP` used consistently across Task 1 + all replacement tasks. No drift.
- ✅ Architectural constraints honored: no render / WGSL / parity changes; lane scheduler untouched; `feature/flame-editor-v1` branch (not a new branch); spec file in gitignored `docs/superpowers/specs/`.
