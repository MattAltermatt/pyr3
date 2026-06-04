# pyr3 — keyboard + modifier-key bindings

Living index of every modifier-key interaction in pyr3. When a binding is
designed but not yet shipped, the **status** column says `planned`; it
flips to `shipped` when the code lands. Update this file in the same PR
as any new binding.

## /v1/edit — canvas

| Binding                  | Behavior                                                    | Status   |
| ------------------------ | ----------------------------------------------------------- | -------- |
| left-drag on flame       | Pan — cx / cy follow the cursor                             | shipped  |
| wheel on flame           | Zoom — cursor-anchored; up = in, down = out                 | shipped  |

## /v1/edit — xforms section

| Binding                       | Behavior                                                | Status   |
| ----------------------------- | ------------------------------------------------------- | -------- |
| click `active` checkbox       | Toggle this xform on / off — instant A/B render        | shipped  |
| **shift-click** `active`      | Solo — turn off all OTHER xforms, leave this one on    | shipped  |
| click variation `active`      | Toggle that variation in the chain on / off            | shipped  |
| **shift-click** variation `active` | Solo — turn off all other variations in this xform | shipped  |
| click `shape preset` button   | Overwrite the 5 decomposed fields with the preset      | shipped  |
| click variation `kind` button | Opens the variation picker modal                       | shipped  |
| click `+ var` button          | Opens the picker; row appended on first preview        | shipped  |
| click `⎘` (duplicate)         | Clone this xform inline below                          | shipped  |

## /v1/edit — scrubby number inputs ([#105](https://github.com/MattAltermatt/pyr3/issues/105))

Applies to every numeric cell in the editor panel EXCEPT the render
section's width / height (those stay native — exact pixel typing).
Sensitivity is magnitude-relative: `delta_per_pixel = max(MIN_STEP_kind, |value| × 0.005)`.

| Binding              | Behavior                                                   | Status   |
| -------------------- | ---------------------------------------------------------- | -------- |
| left-drag on field   | Scrub value proportional to horizontal drag distance       | shipped  |
| **shift-drag**       | Coarse step (×10 the default)                              | shipped  |
| **alt/option-drag**  | Fine step (×0.1 the default)                               | shipped  |
| double-click         | Enter text-input mode; Enter commits, Escape reverts       | shipped  |
| up / down arrow      | Step ±1 (only in text-input mode — native input behavior)  | shipped  |

> Note: `ctrl` is NOT a modifier for fine-scrub. On macOS ctrl-click is
> the OS context-menu gesture and pre-empts any drag. Use `alt/option`.

## /v1/viewer (gallery + showcase)

Currently keyless. Add bindings as they're introduced.

---

## Discoverability checklist

When a new modifier-key binding lands:

1. Add the row above with `status: shipped`.
2. Add a `title=…` tooltip to the affordance describing the modifier
   (e.g. `click: toggle · shift-click: solo`).
3. If the binding is hidden behind a non-obvious trigger (no visible
   control), add it to the editor's `?` help modal — TBD when that
   modal ships.
