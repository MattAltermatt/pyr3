# #114 — DC (direct-color) variations

**Date:** 2026-06-06
**Issue:** [#114 feat: DC (direct-color) variations](https://github.com/MattAltermatt/pyr3/issues/114)
**Status:** Design locked, ready for plan
**Parent:** #67 (Apophysis/JWildfire exploration)

---

## Goal

Port the **direct-color** variation family from JWildfire / Apophysis to pyr3. Standard variations scatter onto the histogram using the xform's running palette index (`palette[color_index] × ls`); DC variations **compute RGB directly per scatter** from spatial position, bypassing the palette.

DC variations produce a visually distinct class of flames — marbled / painterly textures (e.g. dc_perlin), discrete regional coloring (dc_gridout), shape-bound color fields (dc_cylinder) — that palette-indexed flames cannot make. They originated in Neil Slater's Apophysis 7X plugin pack and are signature features of the JWildfire user community (~tens of thousands of published flames, see #114 issue body for gallery URLs and provenance).

## Scope

- 4 new variations: `dc_linear`, `dc_perlin`, `dc_gridout`, `dc_cylinder` (indices 99-102)
- New WGSL color-override path in `chaos.wgsl` (per-xform DC flag)
- New `dc_flag: u32` slot in the per-xform packed buffer
- Importer recognition (`flame-import.ts`) for the 4 new names
- Editor: new "Direct color" category in the variation picker, with hint banner + external docs link
- Editor: in-xform indicator when an xform uses a DC variation; `color` / `color_speed` row annotated when overridden
- Help-page section explaining the DC mechanism (added to the existing help page from #104)
- Showcase deliverable: "DC off vs DC on" comparison pair rendered and committed to `fixtures/showcase/`

## Out of scope (this issue)

- The long tail of ~30+ other DC variations from JWildfire (`dc_carpet`, `dc_hexagons`, `dc_cube`, `dc_bubble`, `dc_ztransl`, `dc_triangle`, `dc_glypho`, `dc_worley`, …) — file as follow-up issues if specific ones become user requests
- Genome-level palette extraction from DC variations (i.e. "use my DC pattern as a new palette") — separate feature
- The non-DC parts of #115 / #116 / #117 — those are independent issues

## Locked decisions (load-bearing)

### 1. DC semantics — override, matching JWildfire

When any variation in an xform's chain is a DC kind, the histogram write for every scatter from that xform uses the DC-computed RGB instead of `palette[color_index]`. Position is unaffected — DC variations still contribute to `p_out` exactly like every other variation.

*Considered:* weight-based blend and additive tint. Both rejected because they diverge from JWF semantics, which would break .flame round-trips with the JWildfire / Apophysis community (a primary value proposition of this work per the #114 issue's reframing).

### 2. WGSL ABI — per-xform DC flag baked at pack time

`src/symmetry.ts:expandGenomeForGPU` checks each xform's variation chain against a small `DC_VARIATION_SET` constant (indices `{99, 100, 101, 102}`). If any match, set the xform's `dc_flag = 1` in the per-xform packed buffer; otherwise `0`.

Per-xform buffer layout gains one `u32` slot. Existing slots (weight, color, color_speed, affine, post-affine, opacity, xaos baked-in row) stay in place; `dc_flag` appends.

Chaos kernel:
- Iterate the variation chain as today, accumulating into `p_out: vec2f`.
- When a DC variation runs, it also writes to a thread-local `rgb_override: vec3f`.
- After the chain, the histogram write picks `dc_flag == 1u ? rgb_override : palette[color_index]`.
- Last DC variation in the chain wins for `rgb_override` (only matters if a user stacks multiple DC variations in one xform — rare, but well-defined).

*Considered:* per-variation flag in the variation return signature (allows mixed chains where some scatters from one xform get DC and others get palette). Rejected — JWildfire's actual semantics are xform-level, and per-variation flags cost a return-value widening on all 99 existing variations for a feature that doesn't need it.

### 3. Genome schema — zero break

DC variations are just new entries in `VARIATION_NAMES` + `VARIATION_PARAMS`. No new fields on `Xform`. No schema migration. Existing genomes (and the 26-fixture parity rig) render byte-identically — `dc_flag` is `0` for every xform in every existing fixture, so the override branch is dead code for them.

Importer (`src/flame-import.ts`) recognizes the 4 new variation names automatically — pyr3's importer already extracts attributes by name and matches against `VARIATION_NAMES`. Just need to register the names + their per-variation params.

### 4. Variation return signature

All DC variations return `vec3f` RGB in `[0, 1]`. Not a palette-index lookup, not RGBA — straight RGB.

*Considered:* `f32` palette index (DC computes a virtual color index, kernel still samples palette). Rejected: constrains DC to the genome's palette, losing the whole point. The hero `dc_perlin` look depends on free RGB.

## Variations — first wave (4)

### `dc_linear` (index 99)
- **Params:** none (uses position directly)
- **Color rule:** `rgb = clamp(vec3f(0.5 + 0.5*x, 0.5 + 0.5*y, 0.5 - 0.5*(x+y)/2), 0, 1)` (or simple coord-to-RGB affine; final shape locked in plan)
- **Position rule:** identity (it's a position-pass-through variation that overrides color)
- **Why included:** simplest possible DC; proves the override path with a one-line WGSL fn

### `dc_perlin` (index 100) — the hero
- **Params:** `scale: f32` (noise frequency, default 1.0), `octaves: f32` (default 3), `color_seed: f32` (default 0)
- **Color rule:** sample 2D Perlin noise at `(x * scale, y * scale)` with `octaves` levels of fBm; map noise value `[-1, 1]` through an HSL-based palette using `color_seed` as hue offset
- **Position rule:** identity
- **WGSL implementation note:** Perlin needs a permutation table (256-entry `array<u32, 256>` constant) and 2D gradients. The full fBm with octaves is ~80 LOC of WGSL. Determinism is preserved — same coords give same color.
- **Why included:** the marquee DC look — wolfepaw's gallery pieces all use this

### `dc_gridout` (index 101)
- **Params:** none (or optional `cells: f32` default 4)
- **Color rule:** floor `(x, y)` into integer cells; hash cell index → discrete RGB
- **Position rule:** identity
- **Why included:** discrete-region DC, completely different visual register from perlin

### `dc_cylinder` (index 102)
- **Params:** matches existing `cylinder` (21) — none
- **Color rule:** map cylindrical-coord `(theta, z)` of the post-cylinder position to RGB
- **Position rule:** same as existing `cylinder` — `out = (sin(x), y)`
- **Why included:** demonstrates DC + geometric-shape combo (the JWildfire signature pattern). Different from `dc_linear` because the position IS warped, so RGB and shape are tied.

Each variation's exact color formula gets finalized during impl (with a small Chrome-verify cycle per variation). The names, indices, and broad mechanism are locked here.

## Editor UX

### Variation picker (`src/edit-variation-picker.ts`)

New "Direct color" category with a hint banner:

```text
┌─ Direct color ──────────────────────────────────  Learn more ↗ ─┐
│ These variations color the xform directly from spatial          │
│ position, bypassing the palette. Originally from JWildfire.     │
└─────────────────────────────────────────────────────────────────┘
  [dc_linear]   [dc_perlin]   [dc_gridout]   [dc_cylinder]
```

- **"Learn more ↗"** opens `https://fractalformulas.wordpress.com/flame-variations/dc_perlin/` in a new tab (`target="_blank" rel="noopener noreferrer"`). That page is the best general-purpose pedagogical resource (author Neil Slater's mechanism explained with images).
- **Per-tile tooltip:** short description (see below) + optional per-variation docs link.

Tooltips:
- `dc_linear` — "Color from spatial coord. Simplest direct-color variation."
- `dc_perlin` — "Color from a Perlin noise field. The marbled / painterly look."
- `dc_gridout` — "Color by canvas quadrant. Discrete-region direct color."
- `dc_cylinder` — "Direct-color version of cylinder. Shape + color combined."

### Xforms section (`src/edit-section-xforms.ts`)

- When an xform's chain has a DC variation, render a small ℹ️ chip next to that variation's row in the chain list. Hover → "This xform's color is computed from position by dc_perlin instead of the palette." Click → opens the same external docs link as the picker banner.
- The xform's `color` / `color_speed` rows show "(overridden by dc_perlin — [ⓘ what?](…))" inline. Values remain editable; they're just not in effect. Removing the DC variation from the chain restores them.

### Help page (existing, from #104)

Add a "Direct color variations" section: 2-3 sentences explaining the mechanism (palette-indexed vs DC), the four v1 variations with one-line each, and the wolfepaw gallery URLs as embedded examples. Self-hosted explanation — user doesn't have to leave the app to understand what DC is.

All external links use `target="_blank" rel="noopener noreferrer"`.

## Files to touch

- `src/variations.ts` — extend `V` enum (indices 99-102), `VARIATION_NAMES`, `VARIATION_PARAMS`; export new `DC_VARIATION_SET: ReadonlySet<number>` constant
- `src/symmetry.ts` (or whichever module owns `expandGenomeForGPU`) — bake `dc_flag` into per-xform buffer
- `src/shaders/chaos.wgsl` — DC override branch in the per-scatter histogram write; new `var_dc_linear`, `var_dc_perlin`, `var_dc_gridout`, `var_dc_cylinder` WGSL functions; Perlin noise utility (perm table + gradient lookup + 2D noise + fBm)
- `src/chaos.ts` — wire the new per-xform `dc_flag` into the binding-layout / buffer-write code
- `src/flame-import.ts` — recognize the 4 new variation names (Apophysis/JWildfire .flame format)
- `src/edit-variation-picker.ts` — new "Direct color" category, banner, learn-more link, per-tile tooltips
- `src/edit-section-xforms.ts` — DC indicator chip in chain rows; "overridden by" annotation on color/color_speed
- `src/help-page.ts` (or wherever the #104 help page lives) — new "Direct color" section
- Tests:
  - `src/dc-variations.gpu.test.ts` — per-variation WGSL function returns expected RGB for sample coords (extract WGSL code blocks via `extractWgslFn` per the [[reference-dawn-vitest-full-kernel-dispatch-crash]] memory; do NOT dispatch the full kernel in vitest)
  - `src/dc-flag-pack.test.ts` — `expandGenomeForGPU` sets `dc_flag = 1` iff the chain contains a DC variation
  - `src/flame-import.test.ts` — extend to round-trip a sample DC .flame file
- Fixture: `fixtures/showcase/dc-comparison/` with `base.flam3`, `with-dc-perlin.flam3`, and rendered PNG pair

## Acceptance

1. **4 DC variations live** in viewer + BE CLI; renderable from a hand-authored genome
2. **Parity rig unchanged** — `npm run test:parity` (26 fixtures) passes byte-identically (no DC variations in those fixtures, so `dc_flag = 0` everywhere → existing path unchanged)
3. **JWildfire .flame round-trip** — importing a JWF flame with `dc_perlin` produces a pyr3 render where the same xform writes DC RGB
4. **Picker UX** — "Direct color" category visible, banner + tooltips render, "Learn more ↗" opens fractalformulas page in a new tab
5. **In-xform UX** — ℹ️ chip + "(overridden by dc_*)" annotation render correctly when DC is in the chain; values restore when DC removed
6. **Help page section** lives and renders the explanation + examples
7. **Showcase pair** committed: same base genome rendered with and without `dc_perlin`, demonstrating the visual delta. README references it as the canonical "what DC unlocks" reference.
8. **Tests green** — `npm test`, `npm run typecheck`, `npm run test:fe-be-smoke` (3-fixture FE↔BE; full sweep pre-release only per CLAUDE.md)

## Risks

- **Perlin noise WGSL implementation** is the riskiest piece — gradient table + interpolation + octave fBm. Mitigation: extract noise into a self-contained `noise_perlin(p: vec2f, scale: f32, octaves: f32) -> f32` WGSL function with its own `.gpu.test.ts` validating against a JS oracle (the [[feedback_pyr3_parity_debug_oracle]] pattern). Land noise utility first, then dc_perlin on top.
- **Histogram contract change** is contained — adding a per-xform flag + a kernel branch is mechanical. Parity rig is the safety net.
- **Editor cross-section hints** ("overridden by dc_*" annotation) require careful state — the `color` value must persist when annotated. Mitigation: route through the existing `onPathChange` funnel per [[reference-edit-onpathchange-funnel]]; values never get cleared, only visually annotated.

## Reference memories

- [[reference-chaos-bakes-palette-rgb]] — current contract this design extends
- [[reference-dawn-vitest-full-kernel-dispatch-crash]] — vitest GPU testing pattern
- [[feedback_pyr3_parity_debug_oracle]] — oracle-first debug pattern (relevant for Perlin)
- [[reference-edit-onpathchange-funnel]] — editor edit funnel for annotated state
- [[reference-dawn-f32-trig-range-cliff]] — Dawn trig cliff; route any DC trig through `safe_*` per CLAUDE.md
