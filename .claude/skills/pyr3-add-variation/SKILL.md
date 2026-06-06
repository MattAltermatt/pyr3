---
name: pyr3-add-variation
description: Add a single new variation to pyr3's engine — WGSL kernel + TS reference impl + V-table entry + param table + parity test + catalog entry. Use when the user says "add variation <name>", "port <name> from flam3/JWildfire/Apophysis", "implement variation <name>", or names a specific variation as the next thing to ship. Walks through the 5 files that need touching in order, with the canonical pattern from the most recent batch.
disable-model-invocation: true
---

# pyr3-add-variation

Adds **one** variation end-to-end across pyr3's engine + tooling + catalog.
User-invoked only.

**Input:** a single variation name, e.g. `/pyr3-add-variation crackle`. A
source citation (flam3 / JWildfire `*Func.java` / Apophysis 7X / paper) is
strongly recommended; the skill will ask if not provided.

## Why this exists

Adding a variation touches 5 files in a specific order, each with its own
gotcha. Forgetting one silently breaks something downstream (the picker, the
importer, the catalog page, the param seam, the parity test). This skill
codifies the canonical pattern so every add ships at the same quality bar.

Canonical recent example: **`e7c6ef6`** (batch 1: cpow2 / cpow3 / loonie2 /
epispiral) and **`b716ddc`** (#117 DC family). Read either before
implementing if the math shape is unfamiliar.

## The 5 files

In dependency order — each step builds on the prior:

```text
1. src/variations.ts         V table entry + ts_var_<name> reference impl
2. src/serialize.ts          VARIATION_PARAMS[name] + PARAM_DEFAULTS[name]
3. src/shaders/chaos.wgsl    var_<name>() kernel + apply_variation switch case
4. src/<test-file>.gpu.test.ts   GPU parity / smoke test
5. src/variation-catalog-data.ts catalog entry (formula + blurb + warpFn + params)
```

The picker (`src/edit-variation-picker.ts`) + the importer
(`src/flame-import.ts`) auto-derive from V + VARIATION_PARAMS — no manual
registration needed. They WILL silently surface a broken variation if step
2 is wrong, so don't skip the canonical-name + param-order check there.

## Workflow

### 1 — V table entry + TS impl  (`src/variations.ts`)

- **Append to the `V` const** with the next dense index (don't reuse a
  hole). Group the entry with a comment matching its batch lineage
  (`// #114 batch 2a — Worley/Voronoi cellular family`).
- **Add `ts_var_<name>(i: VarInput): VarOutput`** mirroring the WGSL kernel
  EXACTLY — same atan2 arg order, same trig derivation, same const folding.
  This is pyr3's canonical math. Cite the WGSL line number above the
  function. Mark RNG dependencies with `i.randBranch` (discrete) or
  `i.randValues[]` (continuous).
- **Optional builder helper** (`export const <name> = (weight=1, ...) =>
  ({...})`) only when the variation gets used in genome literals; not
  strictly required.
- Update `MAX_VARIATIONS_PER_XFORM` only if seam expansion is needed (rare
  — last expansion 6→8 was `mobius`).

### 2 — Param seam  (`src/serialize.ts`)

- **`VARIATION_PARAMS[name] = ['p1', 'p2', ...]`** — the positional →
  named map. Order MUST match the canonical reference (cite source).
  Total slots ≤ 8 (the variation seam cap).
- **`PARAM_DEFAULTS[name] = [n1, n2, ...]`** — flam3-canonical defaults,
  same order. Same length as VARIATION_PARAMS[name].
- Skip both when the variation is param-less.

### 3 — WGSL kernel  (`src/shaders/chaos.wgsl`)

- **`fn var_<name>(p: vec2f, w: f32, ...) -> vec2f`** kernel function. By
  convention `w` is the variation weight (multiplied into the return), and
  param/precalc inputs follow. RNG-using variants take `rand_state: ptr<...>`
  and call `rand01(...)`.
- **Use `safe_sin` / `safe_cos` / `safe_tan`** for any trig of a
  coord/radius/coef-scaled value. NEVER raw `sin`/`cos`/`tan` outside the
  angle-bounded [-π,π] range — Dawn's f32 trig has a range cliff at ~1e7
  that returns 0 (see `reference-dawn-f32-trig-range-cliff` memory).
- **Register in the `apply_variation` switch** (case index = V table value).
  Read params from `vars[k].zw` (params 0-1), `vars_extra[k]` (2-5), and
  `vars_extra2[k]` (6-7). DC variations also set the per-xform dc_flag at
  pack time.
- **No module-scope `const` for `extractWgslFn` tests** — declare runtime
  values as `let` inside the function. Module-scope consts don't propagate
  to the extracted kernel (see `reference-wgsl-extract-and-test-layout`).
- **Parens around mixed `* ^ /` chains** — Dawn rejects ambiguous operator
  precedence (see `reference-wgsl-parens-required-for-mixing-operators`).

### 4 — Parity test  (new `src/<topic>.gpu.test.ts` or extend existing)

Three test shapes, pick by the variation's RNG dependency:

- **Deterministic (no RNG)**: full TS-vs-WGSL parity test using
  `extractWgslFn` + `runVarKernel`. Cover ~10 input points spanning origin,
  inside unit disc, outside unit disc, large radius. Assert |ts - wgsl| <
  1e-6 absolute. Pattern: see `loonie2` block in `post-flam3-batch1.gpu.test.ts`.
- **Discrete-branch RNG (julia/julian/cpow/juliascope)**: `runMultiBranchRng`
  helper covers both branches; mirror the TS impl's `randBranch ∈ {0,1}`
  path.
- **Continuous RNG (noise/blur/gaussian_blur family)**: finite-output smoke
  test — assert outputs are finite for randomized inputs, defer per-row
  parity until rand-capture infra lands.

Each test file MUST use the GPU layout pattern correctly (see
`reference-wgsl-extract-and-test-layout`):

- `extractWgslFn` doesn't pull module-scope `const` — re-declare as runtime
  `let` inside the test kernel.
- `layout: 'auto'` silently strips unused bindings → all-zero output.
  Always pass explicit `layout` matching the bind group.

### 5 — Catalog entry  (`src/variation-catalog-data.ts`)

The `/v1/variations` page (#119) needs an entry per variation. Append to
`CATALOG_DATA`:

```ts
{
  idx: V.<name>,
  name: '<name>',
  source: sourceForIdx(V.<name>),  // 'flam3' | 'dc' | 'jwf'
  formula: '<KaTeX LaTeX, single line>',
  blurb: '<1-2 sentences about the visual character>',
  params: [                        // OMIT when no params
    { name: '<p1>', default: <d1>, min: <m1>, max: <M1>, step: <s1> },
    ...
  ],
  warpFn: (x, y) => { ... },       // OMIT for RNG-driven variations
},
```

- **`formula`** must match the math in the TS reference impl. Copy from the
  comment block above `ts_var_<name>`.
- **`blurb`** describes what the variation DOES visually (paper-style,
  not implementation-style).
- **`params`** order MUST match `VARIATION_PARAMS[name]` (same source of
  truth as serialize.ts). Defaults from PARAM_DEFAULTS.
- **`warpFn`** = pure-JS 2D impl with weight stripped (weight is applied
  separately by the catalog scaffold). OMIT for variations whose only
  visual signal comes from RNG (noise/blur/etc.) — the catalog renders
  "warp not applicable" instead.
- Don't reorder existing entries.

## Verify + commit

```bash
npm run typecheck                  # TS + bin + engine seam, all green
npm run typecheck:engine           # seam-enforcing extra check
npm test                           # full unit suite (5870+ tests)
npm test -- variation-catalog-data # catalog 107-entry assertion
npm run test:parity                # OPTIONAL: 91s BE-vs-flam3-C, run when chaos.wgsl changes
```

Then commit + open the catalog in Chrome to confirm the new section
renders (formula + warp diagram + flame iterates):

```bash
npm run dev   # background, then open /v1/variations#v<idx>-<name>
```

## Special cases

- **DC (direct-color) family**: also set the per-xform `dc_flag` slot in
  `genome.packXformInto`; reuse the existing DC_VARIATION_SET. The catalog
  scaffold does NOT bake dc_flag (variations render via geometry only in
  the catalog), so DC entries with a `warpFn` should be the position
  passthrough (identity) — the live flame still iterates, the color
  override happens via the chaos.wgsl dc_flag path which the catalog
  scaffold doesn't enable. See V99-V102 entries.
- **8-param overflow**: pyr3 caps at 8 params per variation. If the source
  variation has more (e.g., `bipolar2` has 9), drop the lowest-impact param
  or fold two into one. Document the dropped param in the entry's blurb.
- **Cellular / Voronoi family (bwraps, crackle, ...)**: share a `worley2d`
  helper. Author the helper in `src/shaders/chaos.wgsl` ABOVE the kernels,
  and a TS reference impl in `src/variations.ts` for parity. Subsequent
  cellular variations are kernel-only adds.
- **Walker-state extension (collideoscope, ...)**: out of scope for this
  skill — touches the FE/BE seam (`reference-pyr3-variation-param-seam-cap`
  memory). File a separate spec.

## Source attribution

In the WGSL kernel comment + the TS impl docstring + (optionally) the
catalog blurb, cite the source:

```wgsl
// var_bwraps (Apophysis 7X plugin pack; license: GPL-2+).
// Reference: <link to JWildfire BWrapsFunc.java or Apophysis source>
```

JWildfire and Xyrus02 plugin packs are GPL/LGPL — compatible with pyr3
GPL-3+ via upgrade clauses. NOTICE.md already covers the chain.

## Quick reference

```text
file                            change
─────────────────────────────── ──────────────────────────────────────
src/variations.ts               V table + ts_var_<name>
src/serialize.ts                VARIATION_PARAMS + PARAM_DEFAULTS
src/shaders/chaos.wgsl          var_<name>() + apply_variation case
src/<topic>.gpu.test.ts         parity / smoke test
src/variation-catalog-data.ts   catalog entry

verify
─────────────────────────────── ──────────────────────────────────────
npm run typecheck && npm test   must be green before commit
chrome /v1/variations#v<idx>    formula + warp + flame all visible
```

## Common mistakes

- Forgetting the catalog entry → page stub for the new variation (caught
  by the `all 107 entries` test once V grows).
- WGSL raw `sin/cos` instead of `safe_sin/cos` → silent black flames at
  large radii (Dawn trig cliff).
- `layout: 'auto'` in the GPU test → all-zero output, test passes by
  coincidence on zero-input cases.
- Param order mismatch between VARIATION_PARAMS and the catalog `params:
  [...]` → flame importer puts the wrong value in the wrong slot.
- Trig that uses `sin(coef * 1e10)` for constant args → Dawn folds at
  compile time, masking the cliff. Test with RUNTIME args.

## Related memories

- `reference-pyr3-variation-param-seam-cap` — 8-param cap
- `reference-wgsl-extract-and-test-layout` — GPU test gotchas
- `reference-wgsl-parens-required-for-mixing-operators` — Dawn operator rejection
- `reference-dawn-f32-trig-range-cliff` — safe_sin/cos requirement
- `reference-xform-pack-slot-11-dc-flag` — DC family pack slot
- `project-pyr3-variation-survey-counts` — what's in the long tail
