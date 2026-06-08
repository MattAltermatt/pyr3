# Issue #105 — Scrubby slider input (drag-to-scrub number cells)

**Date:** 2026-06-03
**Issue:** [#105](https://github.com/MattAltermatt/pyr3/issues/105)
**Milestone:** Visual Overhaul
**Size:** M
**Branch:** `feature/flame-editor-v1` (continues the open editor branch)

---

## Goal

Replace every `input[type=number]` cell in `/v1/edit` with a **scrubby
input** — click-drag-horizontally-to-change-value, the pattern from
Blender, Photoshop, Figma, After Effects. ~95% of numeric edits become
drag-only; typing is reserved for "I know the exact number" (double-click
to enter text mode).

This is single-component infrastructure: one reusable
`scrubbyInput(...)` factory in `src/edit-scrubby-input.ts`, called from
the 8 `src/edit-section-*.ts` files (and `edit-ui.ts` for the top-bar
settle-delay input) wherever a number cell currently lives.

## Behavior

### Hover, drag, text mode

- **Hover** → `cursor: ew-resize` over the cell.
- **Press (pointerdown) + drag horizontally** → value scrubs proportional
  to drag distance using the magnitude-relative formula below.
- **Release (pointerup)** → drag ends; final value commits.
- **Double-click** → swap the span for a transient
  `<input type="number">` focused with text selected; Enter / blur
  commits; Escape reverts.
- **Up / Down arrows** (in text mode) → step ±1 via native input behavior.

### Sensitivity formula (locked: option A′)

Per-pixel delta is **percent-of-value** with a per-field minimum floor:

```
delta_per_pixel = sign(dx) × max(MIN_STEP_field, |value| × RATE)

where:
  RATE          = 0.005          // 0.5% of value per pixel of drag
  MIN_STEP_field = per-field floor — see table below
```

Worked examples against typical pyr3 editor values:

```text
field              value      |v|×0.005   floor used   ~px to halve / unit move
─────────────────  ─────────  ─────────   ──────────   ───────────────────────
scale x/y          0.6901     0.0035      0.0035       ~100 px to halve
rotation           -46.48 °   0.232       0.232        ~200 px to rotate +46°
position x         -0.1430    0.00072     floor 0.001  ~143 px to 0
position y         -0.0856    0.00043     floor 0.001  ~86  px to 0
xform weight       0.5        0.0025      0.0025       ~100 px to halve
gamma              2.5        0.0125      0.0125       ~100 px to halve
filter radius      0.4        0.002       floor 0.005  ~80  px to 0
```

`MIN_STEP_field` table (initial values, tunable per Chrome verify):

```ts
const MIN_STEP: Record<FieldKind, number> = {
  weight:    0.0025,   // xform weight, variation weight, xaos weights
  color:     0.005,    // color, opacity, vibrancy
  position:  0.001,    // cx, cy, position x/y, a..f matrix translate terms
  rotation:  0.05,     // rotation (degrees)
  scale:     0.005,    // scale x/y, viewport scale
  generic:   0.001,    // gamma, brightness, gammaThreshold, highlightPower,
                       // filter radius, quality, etc.
};
```

Call sites pass a `kind` (or an explicit `minStep` override) so each
field's floor is right.

### Modifier keys (locked, recorded in `docs/keybindings.md`)

| Modifier | Multiplier on delta_per_pixel | Use |
|----------|-------------------------------|-----|
| (none) | ×1 | normal scrub |
| `shift` | ×10 | coarse (snap big moves) |
| `ctrl` or `alt` | ×0.1 | fine (sub-pixel tuning) |

Modifier state is read live each `pointermove` (held mid-drag swaps
sensitivity instantly; releasing returns to normal).

`docs/keybindings.md` gets three new rows in the editor section with
status `shipped` when the implementation lands.

### Pointer lock — graceful fallback (locked: option A)

Pointer lock is the Blender trick that lets a drag continue indefinitely
past the viewport edge. Implementation:

1. On `pointerdown`, call `element.requestPointerLock()` (fire-and-forget;
   don't await).
2. On `pointermove`, prefer `event.movementX` (the locked delta) when
   `document.pointerLockElement === element`; otherwise fall back to
   `event.clientX - lastClientX` (unlocked drag).
3. On `pointerup`, call `document.exitPointerLock()` if locked.

**Same code path for locked + unlocked.** The only loss without lock is
"infinite scrub" — the user hits the viewport edge, releases, and re-grabs
to continue. Works on Chrome (lock granted), Safari (lock denied or
unreliable), and any embedded context.

### Visual treatment (locked: option A — minimal)

- Cell looks **identical** to today's number input (same font, padding,
  background, border).
- Hover → cursor changes to `ew-resize`.
- During drag → 1px cyan border tint, reusing the existing focus-ring
  color (no new tokens).
- No fill bar, no underline, no value badge. Discovery via cursor change.

### Bounds (optional clamp)

Each call site may pass `min` / `max`. When set, scrub clamps to the
range (no overshoot, no wrap). Unset = unbounded (rotation, scale,
position). Same `min` / `max` apply in text mode (typing 999 into a
weight cell with `max=1` clamps on commit).

### Display format

Default formatter: trim trailing zeros, max 6 decimals (`-46.482612`).
Call sites can override with a `format(value) => string` function — used
for the rotation `°` suffix today.

## Component API

```ts
// src/edit-scrubby-input.ts
export type FieldKind = 'weight' | 'color' | 'position' | 'rotation' | 'scale' | 'generic';

export interface ScrubbyInputOpts {
  /** Initial value. */
  value: number;
  /** Fires on every drag tick and on text-mode commit. */
  onInput: (v: number) => void;
  /** Per-field min step floor. Defaults to MIN_STEP[kind ?? 'generic']. */
  kind?: FieldKind;
  /** Explicit override — wins over kind. */
  minStep?: number;
  /** Optional clamp. */
  min?: number;
  max?: number;
  /** Display formatter; default trims trailing zeros to 6 dp. */
  format?: (v: number) => string;
  /** Optional ARIA label for screen readers. */
  ariaLabel?: string;
}

export interface ScrubbyHandle {
  el: HTMLSpanElement;
  /** Programmatic value updates (e.g. genome re-load). */
  setValue(v: number): void;
  /** Tear-down — removes listeners + any open text-mode input. */
  destroy(): void;
}

export function scrubbyInput(opts: ScrubbyInputOpts): ScrubbyHandle;
```

Returns a `<span class="pyr3-scrubby">` styled like a number input. The
optional `setValue` lets the surrounding rebuild logic in
`edit-section-xforms.ts` (which re-renders the xform list on add/remove)
push fresh values without rebuilding the span.

## Integration plan

The factory replaces `input[type=number]` at these call sites (grep'd
from current `feature/flame-editor-v1`):

```text
src/edit-section-viewport.ts   — scale, cx, cy, rotation
src/edit-section-xforms.ts     — affine decomposed (scale x/y, rotation,
                                 position x/y), shear, a..f raw matrix,
                                 weight, color, opacity, colorSpeed,
                                 variation weights, variation params,
                                 xaos weights
src/edit-section-final.ts      — same set as xforms (final xform)
src/edit-section-global.ts     — brightness, gamma, highlightPower,
                                 gammaThreshold, symmetry count
src/edit-section-palette.ts    — hue
src/edit-section-density.ts    — vibrancy, etc.
src/edit-section-render.ts     — width, height, quality, filterRadius
src/edit-ui.ts                 — settle-delay (top bar)
```

**Width/height (render section) keep typing as the dominant mode** but
still gain drag — useful for "pull from 512 to 768 to see where it falls
apart." Integer fields call `scrubbyInput` with a `format` that rounds
to int and a `minStep: 1`.

## Lane scheduler interaction

The factory's `onInput` calls into whatever the existing call site does
today — typically a closure that mutates the genome path and calls
`scheduler.schedule({lane: 'slow', path: '...'})`. The slow lane already
debounces at 80ms (`DEFAULT_DEBOUNCE_MS.slow`), and the just-shipped
live-render loop in `edit-mount.ts` rAF-yields between iterations. A
60-120Hz pointermove storm during a 1-second drag collapses to ~12
live-renders (one every 80ms) — same behavior as today's slider drags.

No scheduler changes. No new debounce. The existing infrastructure
handles it.

## Test strategy

`src/edit-scrubby-input.test.ts` covers (happy-dom, synchronous):

1. **Drag math** — synthesize `pointerdown` at x=100, `pointermove`s
   at x=110/120/130, assert each emits the right delta given the
   formula and the field's MIN_STEP.
2. **Modifier multipliers** — same drag with `shiftKey=true` emits 10×
   delta; with `ctrlKey=true` emits 0.1×.
3. **Bounds clamp** — drag past max stops at max; same for min.
4. **Double-click → text mode** — dblclick swaps to `<input>`, focused
   + selected; typing + Enter commits via `onInput`; Escape reverts.
5. **Pointer-lock fallback** — happy-dom doesn't grant lock;
   `requestPointerLock` is a stub that no-ops; drag math still works
   from `clientX` deltas.
6. **`setValue` / `destroy` lifecycle** — programmatic updates render
   the new value; destroy removes the span + any open text input + all
   listeners.
7. **Per-field MIN_STEP** — verify weight/color/position/rotation/scale
   floors are applied correctly.

Chrome verify (one-shot, via `chrome-devtools-mcp`) covers the real
pointer-lock path — drag past the viewport edge, confirm scrub continues
under the locked cursor.

No FE↔BE parity impact. No render-path impact. `npm test` (2s) is the
right gate; parity rigs are not.

## Build sequence (proposed, refined in writing-plans)

1. **Component + tests** — `src/edit-scrubby-input.ts` + full unit
   suite passing. ~200 LOC + ~150 LOC of tests.
2. **Replace in one section as proof** — pick `edit-section-viewport.ts`
   (smallest, 4 cells), wire the factory, verify in Chrome that
   drag+modifiers+double-click all work end-to-end.
3. **Sweep the other 7 files** — each is a mechanical replacement
   of `numberInput(...)` / `input.type = 'number'` blocks with
   `scrubbyInput({kind: ..., min: ..., ...})`. Group commits by file.
4. **`docs/keybindings.md` update** — add scrubby modifier rows with
   status `shipped`.
5. **Chrome verify the full panel** — drag every kind of cell, confirm
   feel matches the worked-example pixels-per-unit table.

## Out of scope (per issue + this brainstorm)

- Touch-screen support (separate issue if it comes up).
- Multi-value range / dual-handle pickers.
- Animated value transitions during drag (snap to new value instantly).
- Custom value formatters per call site beyond simple suffix
  (`°`, `px`) and precision.
- Replacing checkboxes / dropdowns / xform-row drag-reorder.

## Open follow-ups (not blocking)

- Once the editor ships, consider extracting `pyr3-scrubby` into a
  shareable module — the showcase / evolve pages could reuse it.
- Long-term: support keyboard-only scrub (focused cell + arrow keys
  with modifier scaling) so the editor is operable without a pointer.
  Not in this issue.
