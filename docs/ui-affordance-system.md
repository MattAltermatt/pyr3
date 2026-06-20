# pyr3 — settings affordance vocabulary

A small, shared set of **interaction tiers** for any settings surface in pyr3
(the `/editor` panel, the viewer/editor render-mode bar, `/gradient`,
`/animate` timeline controls, and future panels). Each tier has **one role**
and **one canonical visual treatment**. The goal: a control's *look* tells you
what it *does* — and a value that's editable never hides as static text.

First applied in the editor IA rework (#373, v1.11.0). Adopt it anywhere a
surface presents settings rather than reinventing per-surface styling.

> **Why a vocabulary, not per-panel CSS:** before #373 the only "loud"
> expander was the #358 Generate-ramp accent-bar; every other fold (`shear`,
> `raw matrix`) was bare text and read as a label. Naming the tiers and shipping
> them as **shared classes** means a new panel adopts the system with
> `class="pyr3-aff-expander"`, not a copy-pasted block of CSS that drifts.

---

## The six tiers

```text
TIER               role                          canonical treatment
-----------------  ----------------------------  -------------------------------------
1 · Lens tab       switch the whole surface       blue filled button; on-state = solid blue
2 · Section head   collapse a content group       filled bar + chevron + 3px blue LEFT-RULE
3 · Group divider  passive category caption       borderless label + dim qualifier, NO fill
4 · Action expand  reveal a fold / run an action  ORANGE accent-bar + ▸/▾ chevron
5 · Inline value   drag- or type-edit a number    dashed underline at rest + focus ring
6 · Help icon      explain a non-obvious knob     ?/ⓘ click-toggle; stops event propagation
```

### Tier 1 — Lens tab
**Role:** the hardest switch on the surface — swaps the entire panel body
(XForm · Scene · Color · Output). **Treatment:** equal-width filled buttons;
active tab is solid structural-blue (`--structure`, `#3257a8`) with white text.
Loudest element by design — nothing should out-shout the active lens.
**Class:** `.pyr3-edit-lensbtn` (editor); generalize as `.pyr3-aff-tab`.

### Tier 2 — Section header
**Role:** collapse/expand a named group of related controls.
**Treatment:** full-width filled bar (`#20202a`, slightly heavier than body),
a ▼/▶ chevron, uppercase 11px title, **and a 3px structural-blue left-rule**
so the structural anchor stays visually dominant over any loud (orange) Tier-4
expanders nested inside it. This is the #373 Q3 decision — without the left-rule,
a stack of orange expanders can out-weigh the gray header containing them.
**Class:** `.pyr3-aff-section` (`.pyr3-edit-section-header` in the editor today).

**Nested variant.** When a section nests a level deeper (e.g. the XForm-detail
accordions AFFINE / VARIATIONS / COLOR / XAOS, `.pyr3-edit-accordion-header`),
the nested header uses a *lighter* treatment — heavier fill (`#1c1c24`) + crisp
title + a thin **neutral** 2px left-rule (`#3a3a46`) instead of the loud blue —
so it reads as pressable while staying subordinate to its blue-ruled parent.
Two distinct header weights keep the nesting legible; never give a nested
accordion the parent's blue rule (it flattens the hierarchy).

### Tier 3 — Group divider
**Role:** a *passive* category caption that splits a lens into phases — it is
**not** interactive (no click target). Example: the Color lens
`🎨 Palette` (define) → `🎚️ Grading` (post-tonemap) split (#358).
**Treatment:** borderless label + a dimmer one-line qualifier; **no fill, no
border, no chevron** — the absence of chrome is what distinguishes it from a
clickable Tier-2 header. **Class:** `.pyr3-edit-group-header`.

### Tier 4 — Action expander
**Role:** a disclosure you reveal (a fold like `raw matrix`, `post-transform`)
**or** an action you run (`✨ Generate ramp`, `✨ Add variation`). #373 Q1
decided these share **one** loud treatment rather than splitting "action" from
"detail" — uniform orange reads more easily and breaks up dense field stacks.
**Treatment:** orange accent-bar — `--accent` text on `--accent-soft` fill,
`--accent-border`, a `▸`→`▾` chevron, `font-weight:600`. Built on `<details>`/
`<summary>` (or a div pair); `::-webkit-details-marker { display:none }`.
**Class:** `.pyr3-aff-expander` (`.pyr3-edit-palette-gen` was the #358 prototype).

### Tier 5 — Inline value (scrubby)
**Role:** a number you change by **dragging horizontally** (also click to type).
**Treatment (#373 Q2):** a **dashed underline** at rest (`1px dashed
--bar-border`) so every editable number reads as inline-editable without the
weight of a full bordered input; underline goes solid `--accent` on hover/drag;
a clear focus ring in keyboard/type mode. Keeps the `ew-resize` cursor.
**Class:** `.pyr3-scrubby` (add the underline to the base rule — it propagates
to every numeric field at once).

### Tier 6 — Help icon
**Role:** explain a knob whose effect isn't self-evident from its label.
**Treatment:** a small `?`/`ⓘ` that **toggles** an inline explainer on click,
is viewport-clamped, and **stops propagation** (so tapping `?` inside a Tier-4
summary doesn't toggle the expander — note the `preventDefault` in the #358
Generate-ramp code). **Source:** `src/help-text.ts` (`infoIcon` /
`buildInfoIcon` / `buildSectionHelpIcon`). Audit per control: add a help icon
only where the label alone is ambiguous; self-evident controls stay clean.

---

## Tokens

All live in the global `:root` (`index.html`). The structural-blue used by
Tier 1 (active) and Tier 2 (left-rule) should be promoted from the editor-local
literal to a shared token so other surfaces can reference it:

```css
--structure:      #3257a8;   /* NEW — tier 1 active + tier 2 left-rule */
--accent:         #ff8c1a;   /* tier 4 expanders, tier 5 drag state */
--accent-soft:    rgba(255,140,26,0.12);
--accent-border:  #884a1a;
--bar-bg-1:       #15151a;   /* section body */
--bar-bg-2:       #1a1a20;   /* (legacy section header fill) */
--bar-border:     #2a2a30;   /* tier 5 rest underline, neutral borders */
--text:           #ddd;
--text-dim:       #888;      /* tier 3 qualifier, tier 5 label */
```

Section-header strengthened fill (`#20202a`) can stay a literal or become
`--bar-bg-2b` if a second surface needs it.

### Spacing scale

One small vertical-rhythm scale, so group boundaries stay legible in dense
panels without ad-hoc per-row gaps:

```css
--sp-tight:  4px;   /* between related fields in a group        */
--sp:        8px;   /* section body padding, default gap         */
--sp-group: 12px;   /* between sub-groups (affine | vars | color)*/
```

Rule: related controls tight (`--sp-tight`); sub-group boundaries get
`--sp-group` so the eye finds where one group ends and the next begins.

---

## Hierarchy rule of thumb

> **Color loudness ≠ structural dominance.** Orange (Tier 4) is the loudest
> *color* but is always structurally *subordinate* — it lives indented inside a
> Tier-2 section, which lives inside a Tier-1 lens. The blue left-rule on Tier 2
> and the solid blue on the active Tier-1 tab keep the structure readable even
> when a section is full of orange expanders. Never let a Tier-4 expander sit at
> the same indent level as a Tier-2 header.

## Adoption checklist (new settings surface)

1. Group controls under **Tier-2 sections**; passive captions are **Tier-3**.
2. Any fold or run-this control → **Tier-4 expander** (`.pyr3-aff-expander`).
3. Every editable number → **Tier-5 scrubby** with the dashed underline.
4. Audit each control for a **Tier-6** help icon — add only where non-obvious.
5. Reference `--structure` / `--accent` tokens; don't hard-code the hexes.
6. Keep one loudness ladder: lens > section > expander > value.

## Reference mockups

The visual source of truth (built against real editor CSS) for the #373 decisions:

- `.remember/verify/373-affordance-tiers.html` — Tier-4 uniform vs tiered (→ uniform)
- `.remember/verify/373-scrubby-affordance.html` — Tier-5 underline vs chip vs bare (→ underline)
- `.remember/verify/373-section-headers.html` — Tier-2 keep vs strengthen (→ strengthen)

(`.remember/` is gitignored — regenerate from the spec if needed.)
