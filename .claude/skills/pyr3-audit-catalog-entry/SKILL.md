---
name: pyr3-audit-catalog-entry
description: Audit one or more variation-catalog entries in src/variation-catalog-data.ts before commit. Checks each VariationDoc against the canonical math (ts_var_* + chaos.wgsl), param-order vs src/serialize.ts:VARIATION_PARAMS, default-value sanity (catches degenerate all-zero collapses + DC weight pitfalls), and the RNG-only no-warpFn invariant. Use when the user says "audit V23", "check the catalog math for <name>", "verify <variation> entry", or after touching variation-catalog-data.ts before commit.
disable-model-invocation: true
---

# pyr3-audit-catalog-entry

Targeted correctness audit for one or more variation-catalog entries.
User-invoked only (it's a pre-commit check, not a background scan).

**Input:** one or more variation identifiers — names or V-numbers,
comma- or space-separated. Examples:
- `/pyr3-audit-catalog-entry V23`
- `/pyr3-audit-catalog-entry pdj`
- `/pyr3-audit-catalog-entry V23 V14 V99`
- `/pyr3-audit-catalog-entry --all` (audit every entry)

## Why this exists

Adding or tweaking a catalog entry touches five axes that can silently
break things downstream:
1. The LaTeX formula and the `warpFn` must agree with the actual
   `ts_var_<name>` or `var_<name>` kernel math.
2. The `params: [...]` order must match `VARIATION_PARAMS[name]` in
   `src/serialize.ts`, or the importer maps the wrong attribute to the
   wrong slot.
3. Default values must produce a non-degenerate render — V23 pdj
   shipped with all-zero defaults that collapsed every walker to a
   single histogram bucket, freezing laptops on Apple Silicon.
4. RNG-only variations (V43-V52 family, V90-V97) MUST omit `warpFn` —
   the catalog renders a "warp not applicable" note instead; a stray
   deterministic-looking warpFn produces a static SVG that doesn't match
   what the kernel actually does.
5. DC family (V99-V101) has a position contribution of zero, so a
   visible weight slider is dead UI. Their entries must set
   `hideWeight: true` AND `warpFn = (x,y) => [x,y]` (identity).

The math-verifier subagent dispatched mid-session (2026-06-06) found 3
real issues; this skill codifies the same checks as a fast pre-commit
pass.

## Workflow

1. **Resolve targets.** Parse the invocation argument(s) into a list of
   variation indices. Accept name or `V<n>` formats; treat `--all` as
   "every entry in CATALOG_DATA".

2. **For each target, run the 5 checks below.** Collect findings; do
   NOT fail fast — the user wants to see the full set per entry.

3. **Report.** Group findings by entry. For each finding include
   axis + confidence (≥75 only) + the line number in
   `src/variation-catalog-data.ts`. Skip clean entries silently unless
   `--all` was passed (then summarize "N audited, M clean").

## The 5 checks

### Check 1 — Formula matches kernel math

For each entry:
- If `src/variations.ts` defines a `ts_var_<name>` function, read it
  and confirm the entry's `formula` LaTeX describes the same map.
- Otherwise read `var_<name>` in `src/shaders/chaos.wgsl`.
- Watch for these specific traps:
  - **atan2 convention**: pyr3's polar/disc/heart/handkerchief use the
    *swapped* form `atan2(p.x, p.y)` per a documented flam3 quirk, NOT
    the standard `atan2(p.y, p.x)`. The formula and the warpFn MUST be
    consistent with the kernel.
  - **Subscript number** in `V_{N}(...)` LaTeX must match the actual V
    table index.
  - **Weight scaling** (`w`) is implicit and consistent across all
    entries — OK to omit from the formula; not a finding.

### Check 2 — warpFn matches kernel math

For entries WITH a `warpFn`:
- Test the JS function at ~6 sample points spanning origin / inside-disc
  / outside-disc / large radius — `(1,0)`, `(0,1)`, `(-0.5, 0.5)`,
  `(0.1, 0.1)`, `(2, 2)`, `(-1, -1)`.
- If `ts_var_<name>` exists, evaluate it at the same points with
  `weight=1` and compare. Flag any |warpFn - ts| > 1e-6.
- If only WGSL exists, do a structural check: same trig functions, same
  arg order, same denominator guards, same branching.

For entries WITHOUT a `warpFn`:
- Confirm the variation is RNG-driven by reading the WGSL — if the
  kernel only consumes `wi: u32` for `rand01(wi)` or `isaac_irand(wi)`,
  the catalog correctly omits warpFn. Flag if a deterministic kernel is
  missing its warpFn.

### Check 3 — Param order matches VARIATION_PARAMS

For entries with `params: [...]`:
- Read `VARIATION_PARAMS[<name>]` from `src/serialize.ts`.
- Confirm `entry.params.map(p => p.name)` is element-wise identical
  (case-sensitive) to that array.
- Flag any mismatch — the importer will assign the wrong attribute to
  the wrong slot.

### Check 4 — Defaults aren't degenerate

For each parameterized entry:
- Read `VARIATION_DEFAULTS[<name>]` from `src/serialize.ts` (if any).
- Compare to catalog defaults. Differences ARE allowed (catalog defaults
  often diverge intentionally — see V14 julian, V23 pdj). When they
  differ, expect a comment in the entry explaining why.
- For all-zero or near-zero default sets, compute the variation's
  output at a small set of inputs using the warpFn. If the outputs are
  all identical (variation collapses to a constant), FLAG: this will
  cause histogram-bucket atomic-add contention.
- Specifically known-bad pattern: pdj at a=b=c=d=0 → constant (-1,-1).

### Check 5 — DC family invariants

For entries V99 / V100 / V101:
- `hideWeight: true` must be set.
- `warpFn` (if present) must be identity `(x, y) => [x, y]`.
- For V99 only, `params` must be absent (dc_linear has zero parameters).

For V102 dc_cylinder:
- `hideWeight` must be absent or false (it has a real position warp).
- `warpFn` must compute `(Math.sin(x), y)` (the V21-cylinder warp).

## Report format

```
## Audit: V<idx> <name>
- formula vs kernel: ✓ / ✗ (...)
- warpFn vs kernel:  ✓ / ✗ (...)
- param order:       ✓ / ✗ (...)
- defaults:          ✓ / ⚠ (note) / ✗ (degeneracy at <inputs>)
- family invariants: ✓ / ✗ (...)
```

When `--all` was passed, conclude with `Audited 109 entries. M findings
across N entries. Clean: <count>.`

## Common findings + fixes

- **Param-order mismatch**: edit catalog entry to reorder; never edit
  `VARIATION_PARAMS` to match the catalog (the source of truth flows
  from the kernel + flam3 attribute convention).
- **Degenerate defaults**: pick non-zero values that produce a visually
  distinct render at slider weight=1. Document the divergence from
  `VARIATION_DEFAULTS` in a comment above the `params` block.
- **DC variation with visible weight slider**: add `hideWeight: true`.
  The control-panel auto-replaces with the "no controls — direct
  color override only" empty note when both `hideWeight` and no params
  apply.
- **Missing warpFn on a deterministic variation**: re-implement the
  `ts_var_<name>` math in JS (drop the `weight` factor — the catalog
  scaffold applies that separately).

## Quick reference

```text
input          variations to audit (names / V-numbers / --all)
files read     src/variation-catalog-data.ts (the entries)
               src/variations.ts            (V table + ts_var_*)
               src/shaders/chaos.wgsl       (kernels)
               src/serialize.ts             (VARIATION_PARAMS + DEFAULTS)
files written  none (read-only audit)
exit signal    findings printed; no exit code (the caller decides
               whether to commit)
```

## Related skills

- `pyr3-add-variation` — the canonical 5-file workflow for adding a new
  variation. Run this skill AFTER the add to catch issues.
- `feature-dev:code-reviewer` — broader adversarial review; this skill
  is the narrower per-entry check.

## Related memories

- `reference-pyr3-variation-param-seam-cap` — 8-param cap
- `reference-wgsl-extract-and-test-layout` — GPU test gotchas
- `reference-dawn-f32-trig-range-cliff` — safe_sin / safe_cos requirement
