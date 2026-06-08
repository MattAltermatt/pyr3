# #114 — post-flam3 plugin pack, batch 1

> **Issue:** [#114](https://github.com/MattAltermatt/pyr3/issues/114) ·
> **Spec date:** 2026-06-05 · **Architectural precedent:**
> [#117](https://github.com/MattAltermatt/pyr3/issues/117) (DC family) — same
> seam, same kernel-add + registry-add pattern, no ABI extension.

## What ships

Four new variations slot into pyr3's variation registry as **V103..V106**:

| V | Name | Origin | Params | Notes |
|---:|---|---|---:|---|
| 103 | `cpow2` | JWildfire (Peter Sdobnov, Zueuk); upstream Apophysis | 4 | Numbered variant of pyr3's `cpow` (V41) with range-driven RNG branching |
| 104 | `cpow3` | JWildfire (Peter Sdobnov, Zueuk) | 4 | Sibling of `cpow2`, log-distribution branch picker |
| 105 | `loonie2` | JWildfire (dark-beam) | 3 | Numbered variant of pyr3's `loonie` (V71) with N-sided + star + circle controls |
| 106 | `epispiral` | JWildfire (cyberxaos), Apo 7X.15C in-engine | 3 | Polar epicycloid — `1/cos(n·θ)` radial profile |

All four are **2D-only**, fit pyr3's existing 8-param-per-variation seam
(`vars[k].zw` + `vars_extra[k]` + `vars_extra2[k]`), and reuse the
variation-registry mechanism from #117 — no new packing slots, no ABI
extension, no new precalc fields.

**Out of scope for batch 1:** `bipolar2` (9 params — exceeds the 8-slot seam;
would require a `vars_extra3` ABI extension; filed as a follow-on consideration
not blocking the rest). The remaining S-tier survey list (`bwraps`, `crackle`,
`collideoscope`, `circlize`/`circlize2`, `falloff`/`falloff3`, `julian3`, `loc`,
`eswirl`, `petal`) lands in batch 2+ — each either needs new WGSL infra
(cellular hash for bwraps, Voronoi for crackle, multi-branch RNG for
collideoscope) or is a clean fit but deferred to keep batch 1 reviewable.

## Architecture (the seam, recapped from #117)

A new variation is a 3-edit ship:

1. **Registry entry** in `src/variations.ts` — add `name: index` to the `V`
   const at the next sequential index.
2. **Kernel function** in `src/shaders/chaos.wgsl` — `fn var_<name>(p:
   vec2f, ...) -> vec2f`, plus a `case <index>: ... break;` in
   `apply_variation`.
3. **Param plumbing** in `src/serialize.ts` — entry in `VARIATION_PARAMS`
   listing the JSON-side parameter names in positional order, with optional
   alias map in `VARIATION_PARAM_ALIASES` for `.flame` importer attribute
   names (e.g. `cpow2_r` → `r`).

Round-trip (`.pyr3.json` save + reload + `.flame` import) and the variation
picker UI (`src/edit-variation-picker.ts`) pick up the new entries
automatically by reading `VARIATION_NAMES` + `VARIATION_PARAMS`.

## Per-variation formula reference

Formulas mirror the JWildfire CPU + GPU reference implementations
(LGPL-2.1+; pyr3's GPL-3+ inherits cleanly via the LGPL→GPL upgrade
clause — see `NOTICE.md`). pyr3 reimplements each formula fresh in WGSL;
no code is byte-copied.

### V103 — `cpow2` (4 params + RNG)

Complex-power variation with discrete angular branching. Params: `r`
(magnitude, default 1.0), `a` (phase, default 0.0), `divisor` (angular
divisor, default 1.0), `range` (RNG branch range, default 1).

Precalc (per-iter): `ang = 2π/divisor`, `c = r·cos(π/2·a)/divisor`,
`d = r·sin(π/2·a)/divisor`, `half_c = c/2`, `half_d = d/2`,
`inv_range = 0.5/range`, `full_range = 2π·range`.

Transform: pick branch `n = floor(rng·range)`; if input `θ < 0`, `n++`;
`θ_b = θ + 2π·n`; if `cos(θ_b · inv_range) < rand·2 - 1`, `θ_b -= full_range`.
Then `lnr2 = ln(x²+y²)`, output `r' = w·exp(half_c·lnr2 - d·θ_b)`,
`θ' = c·θ_b + half_d·lnr2 + ang·floor(divisor·rand)`. Emit
`r'·(cos θ', sin θ')`.

### V104 — `cpow3` (4 params + RNG)

Log-distribution branch picker variant. Params: `r` (1.0), `d` (1.0),
`divisor` (1.0), `spread` (1.0).

Precalc: `ang = 2π/divisor`, `p_a = atan2(log(|d|)·r·sgn(d), 2π)`,
`tc = cos(p_a)·cos(p_a)·r/divisor`, `td = cos(p_a)·sin(p_a)·r/divisor`,
`half_c = tc/2`, `half_d = td/2`,
`coeff = (td == 0) ? 0 : -0.095·spread/td`.

Transform: `θ = arctan2(y,x)`; if `θ < 0`, `θ += 2π`; if
`cos(θ/2) < rand·2 - 1`, `θ -= 2π`; `θ += (rand<0.5 ? 2π : -2π) ·
round(ln(rand)·coeff)`. Then identical to cpow2's emit:
`r' = w·exp(half_c·lnr2 - td·θ)`, `θ' = tc·θ + half_d·lnr2 +
ang·floor(divisor·rand)`. Emit `r'·(cos θ', sin θ')`.

### V105 — `loonie2` (3 params)

N-sided loonie with star + circle blends. Params: `sides` (int ≥1,
default 4), `star` (-1..1, default 0.15), `circle` (-1..1, default 0.25).

Precalc: `a = 2π/sides`, `_sina = sin(a)`, `_cosa = cos(a)`,
`_sins = sin(star·π/2)`, `_coss = cos(star·π/2)`,
`_sinc = sin(circle·π/2)`, `_cosc = cos(circle·π/2)`,
`_sqrvvar = w²` (where `w` is variation weight).

Transform: rotate (x,y) `sides-1` times around the origin in steps of `a`,
each time taking `max` of `xrt·_coss + |yrt|·_sins` to get the
star-modulated bounding shape. Blend with circle: `r2 = r2·_cosc +
sqrt(x²+y²)·_sinc`. Square (or `|r2|·r2` if `sides≤2`). If `0 < r2 <
_sqrvvar`: scale `(x,y)` by `w·sqrt(_sqrvvar/r2 - 1)`. Else if `r2 < 0`:
scale by `w/sqrt(|_sqrvvar/r2| - 1)`. Else pass-through (`w·(x,y)`).

WGSL note: the `sides-1` loop runs at most ~8-12 in practice; bound it at
constant `MAX_LOONIE2_SIDES = 16` and break early if `i >= sides-1`.
`sides` is stored as f32 in the registry; round at use site.

### V106 — `epispiral` (3 params)

Polar epicycloid via `1/cos(n·θ)`. Params: `n` (number of arms, default
6.0), `thickness` (0..∞, default 0.0), `holes` (default 1.0).

Transform: `θ = arctan2(y,x)`; `t = -holes`; `d = cos(n·θ)`; if `|d| <
EPSILON` skip; if `|thickness| > EPSILON`: `t += (rand·thickness)/d`;
else: `t += 1/d`. Emit `w·t·(cos θ, sin θ)`.

WGSL note: use pyr3's `safe_cos` per the Dawn f32 trig cliff
(`reference-dawn-f32-trig-range-cliff` memory) — even though `n·θ`
stays within `[-π·n, π·n]` which is well below 1e6 in practice, the
discipline is "any non-angle-bounded WGSL trig goes through safe_*".

## Test strategy

Mirrors the #117 pattern exactly:

1. **Per-variation kernel test** (`src/<varname>.gpu.test.ts`) — extract the
   `var_<name>` WGSL function via `extractWgslFn`, dispatch with known
   inputs, assert against a TypeScript oracle replicating the same formula
   in f64. Drives a ~32-row randomized table of `(x, y, params, expected_x,
   expected_y)`. Covers: identity bounds, divide-by-zero guards, and the
   special-case branches (loonie2 `i≤1` path, epispiral `|d|<EPSILON`
   skip, cpow2/3 RNG-branch selection by seeding ISAAC deterministically).

2. **Variation table tests** (`src/variations.test.ts`) — add the 4 new
   entries to the `VARIATION_NAMES` round-trip assertion.

3. **Serialize round-trip** (`src/serialize.test.ts`) — extend the
   per-variation param-name fixture table; assert that
   `serializeGenome → parseGenome` preserves each new variation's params.

4. **Importer test** (`src/flame-import.test.ts`) — `.flame` XML with
   each new variation's attribute names (e.g. `<xform cpow2="0.5"
   cpow2_r="1.2" cpow2_divisor="2"/>`) parses correctly with default
   fallbacks for unspecified params.

5. **Parity fixture** (one fixture combining all 4 vars in a hand-authored
   `.flame`) — generate flam3-C golden (note: flam3-C does NOT know these
   variations; this fixture is **NOT** a parity check vs flam3-C — it is a
   pyr3-self regression fixture comparing render against a stored
   `expected.png` baseline rendered at spec time). File the fixture under
   `fixtures/post-flam3-batch1/` per the precedent.

## Importer + `.flame` compatibility

flam3-C `.flame` XML lists per-variation parameters as xform attributes
prefixed with the variation name + `_` (e.g. `<xform julian="0.5"
julian_power="3" julian_dist="1"/>`). The 4 new variations follow the same
convention — the importer's existing param-extraction loop picks them up
once `VARIATION_PARAMS` is extended.

`VARIATION_PARAM_ALIASES` covers the case where JWildfire uses a different
attribute name than the .pyr3.json field (e.g. JWF's cpow3 alternative
names are `cpow_r`, `cpow_d`, `cpow_divisor`, `cpow_spread` per its
`getParameterAlternativeNames()` — these become alias entries pointing at
`r`, `d`, `divisor`, `spread`).

## Risks + mitigations

- **RNG determinism across CPU oracle ↔ GPU kernel.** cpow2 + cpow3 +
  epispiral all call `rand()` mid-formula. pyr3's chaos kernel uses ISAAC
  with a per-walker seeded stream; the TS oracle needs to consume the
  same ISAAC sequence in the same order to match. Precedent: existing
  `juliascope` / `wedge_julia` parity tests have this pattern.
  **Mitigation:** mirror existing RNG-using variation tests' wiring (see
  `src/variations.test.ts`'s "RNG-using kernels" section); seed-equal
  walker init drives matching sequence.
- **loonie2 `sides` as integer.** Stored as f32, rounded at use site.
  **Mitigation:** truncate via `i32(sides)` in WGSL; explicit test for
  `sides=4` vs `sides=4.7` (both should round-down to 4 for the loop
  bound).
- **WGSL `safe_cos` for epispiral.** `n·θ` stays well below 1e6 for any
  reasonable input; risk is theoretical only.
  **Mitigation:** route through `safe_cos` anyway per the standing rule.
- **Test fixture as regression baseline, not parity.** No flam3-C parity
  for these vars; the parity rig stays at 26 fixtures. The new fixture
  guards against pyr3-side regressions only.

## Non-goals

- bipolar2 (deferred — 9 params exceed the 8-slot seam)
- All other S-tier survey variations (deferred to batch 2+)
- Any UI surface for the new variations beyond what already exists in the
  variation picker (#117 made the picker auto-discover from the registry)
- Parity vs flam3-C for these variations (flam3-C doesn't carry them)
- ABI extension to support >8 params per variation (separate ship if/when
  bipolar2 is brought forward)

## Build sequence

1. Add the 4 entries to `V` in `src/variations.ts` (V103..V106).
2. Add `VARIATION_PARAMS` + `VARIATION_PARAM_ALIASES` entries in
   `src/serialize.ts`.
3. Add `var_cpow2`, `var_cpow3`, `var_loonie2`, `var_epispiral` WGSL
   functions + switch cases in `src/shaders/chaos.wgsl`.
4. Write 4 GPU kernel tests (one per variation) with TS f64 oracles.
5. Extend `src/serialize.test.ts` + `src/variations.test.ts` + a focused
   `src/flame-import.test.ts` extension.
6. Author the regression fixture flame; commit `expected.png` baseline.
7. Update `src/edit-variation-picker.ts`'s variation-list ordering if
   needed (likely no change — picker reads `VARIATION_NAMES`).
8. NOTICE.md is already attributed (see commit 0e47c82); no further doc
   work unless a per-variation author credit is wanted in the WGSL kernel
   comments (cheap; recommended).
9. Chrome verify in `/v1/edit`: open a hand-authored test flame using
   each new variation; confirm it renders without console errors.
10. FF-merge to main; auto-deploy verifies live on pyr3.app.
