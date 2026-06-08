# Issue #133 — Conformal & complex-analytic warps (Newton + DC basins, Blaschke, Cayley, complex Γ, Lambert W)

**Date:** 2026-06-07
**Issue:** [#133](https://github.com/MattAltermatt/pyr3/issues/133) (part of umbrella [#128](https://github.com/MattAltermatt/pyr3/issues/128))
**Milestone:** v16 — More variations
**Size:** L (5 variations + DC-position infra extension + 3 new complex helpers)
**Starting registry slot:** V220 (current head V219 from #121 L14)

## Why

pyr3's variation catalog (V0..V219) covers the popular flam3 / Apophysis / JWildfire canon
plus the L1–L14 marathon. The frontier is variation families those renderers skipped —
either because they didn't fit a palette-index pipeline or because the math wasn't worth
the effort in a pre-`complex_*` helper kernel.

**Three pyr3-only levers this batch exploits:**

1. **Complex helpers** in `chaos.wgsl:324-356` — `complex_mul/sqr/div/recip/sqrt/log` make
   complex-analytic maps trivial. We add `complex_exp/pow/sin` here as the natural extension.
2. **`safe_sin/cos/tan`** (`chaos.wgsl:308-317`, from #46/#72) — guard against Dawn's f32
   trig range cliff for any non-angle-bounded trig (Γ reflection branch, Lambert W asymptotic
   initial guess).
3. **Per-xform DC flag** (`color_params.w`, from #117) — enables Newton-basin **direct color
   output** colored by which root the post-step trajectory converges to. **No palette-index
   renderer can produce this** — it IS the umbrella's headline shot.

## Variations (5 total)

### V220 — `newton` (position warp + DC color)

**Formula:** `z' = z − (zⁿ − 1) / (n · zⁿ⁻¹) = ((n−1)·zⁿ + 1) / (n · zⁿ⁻¹)`

**Parameters:**
- `n` (slot z, int 2–8, default 3) — polynomial degree. n=3 is the classical
  Cayley/Schröder tri-basin fractal; n=4 tetra; n=5 penta; n=7 the famous "Newton's basin
  of attraction" hepta-symmetric ink-spill aesthetic.
- slot w reserved (future: `softness` for hybrid scheme, defaults 0).

**Implementation:**
- For integer n in [2,8], compute `zⁿ` via repeated `complex_mul` (faster than
  `complex_pow` log/exp roundtrip).
- Guard the `zⁿ⁻¹` divisor with `EPS` to avoid the z=0 pole.

**DC color (when xform's `dc_flag` is set):**
- Roots of `zⁿ − 1` are `r_k = (cos(2πk/n), sin(2πk/n))` for k=0..n−1.
- After the Newton step, find `argmin_k |z_post − r_k|`.
- Hue = `k/n` (so each root gets an evenly-spaced hue around the wheel); saturation 1,
  value 1. HSV → RGB via the existing `hsv2rgb` (or inline; check existing dc_perlin pattern).
- Wiring: extend the DC callsite list at `chaos.wgsl:5552-5568` (just below the
  existing `var_idx == 102u` / `var_dc_cylinder_color(pa_mut)` branch) with a Newton
  branch. The dispatch pattern is **already established** by `dc_cylinder` (V102) —
  Newton just follows it. Comment at `chaos.wgsl:5258` already notes "dc_cylinder (102)
  warps position like flam3's var_cylinder" → extend to mention V220 newton too.
- **Coord choice (pre-warp vs post-warp):** `dc_cylinder` colors from `pa_mut` (pre-warp)
  to match JWildfire. Newton has no JWF reference. Spec choice: color from `pa_mut`
  applied with a one-step-ahead lookahead — i.e. compute `z_post = newton_step(pa_mut, n)`
  inside `var_newton_color` and color by `argmin_k |z_post − r_k|`. This matches the
  classical Newton fractal algorithm (color the START position by where one step lands).
  Net result: clean per-splat basin coloring that emerges into distinct basins over
  many chaos iters.

**Defaults (catalog scaffold):** weight 0.5, n=3, dc_flag OFF by default (palette-index
look). The catalog page offers a "Turn on DC basin coloring" toggle as the headline demo.

### V221 — `blaschke` (2-to-1 disk-symmetric Möbius factor)

**Formula:** `B(z) = z · (z − a) / (1 − ā·z)` where `a` is a complex zero in the open unit disk.

**Parameters:**
- `a.x` (slot z, default 0.5)
- `a.y` (slot w, default 0.0)
- Two zeros (one at origin, one at `a`) → 2-to-1 disk symmetry. The unit-circle is invariant.

**Implementation:**
- Numerator: `complex_mul(z, complex_sub(z, a))` — needs an inline `vec2f - vec2f` (free,
  it's just vector subtraction).
- Denominator: `vec2f(1, 0) − complex_mul(complex_conj(a), z)` — `complex_conj(a) = (a.x, −a.y)`.
- Result: `complex_div(num, denom)`.
- Pole at `z = 1/ā` (outside disk when |a|<1); guard denominator with EPS.

**Defaults:** weight 0.5, a=(0.5, 0.0). Sierpinski-scale (~1) inputs sit on/near unit
circle → non-degenerate.

### V222 — `cayley` (upper-half-plane → unit disk)

**Formula:** `z' = (z − s·i) / (z + s·i)`

**Parameters:**
- `s` (slot z, default 1.0, range 0.1–4.0) — scale of the `i` offset. s=1 is canonical
  Cayley. Larger s widens the "mapped region" near the real axis.
- slot w reserved.

**Implementation:**
- One-liner: `let si = vec2f(0.0, s); complex_div(z - si, z + si)`.
- Pole at `z = −s·i`; guard with EPS in denominator.

**Defaults:** weight 0.5, s=1.0.

### V223 — `complex_gamma` (Γ(z) via Lanczos approximation)

**Formula:** Lanczos g=7, 9 coefficients (`scipy.special.gamma`-equivalent precision):
- `p = [0.99999999999980993, 676.5203681218851, −1259.1392167224028, 771.32342877765313,
       −176.61502916214059, 12.507343278686905, −0.13857109526572012, 9.9843695780195716e−6,
       1.5056327351493116e−7]`
- **Re(z) ≥ 0.5:** `x = z − 1; t = x + 7.5; A = p[0] + Σ_{k=1..8} p[k]/(x+k);
  Γ(z) = √(2π) · t^(x+0.5) · e^(−t) · A`
- **Re(z) < 0.5:** reflection — `Γ(z) = π / (sin(πz) · Γ(1−z))`

**Parameters:**
- `scale` (slot z, default 0.3) — output magnitude clamp/divisor. Γ has factorial-like
  growth; scale down to keep walker bounded.
- slot w reserved.

**Implementation:**
- 9-element `const` array for Lanczos coefs (use module-scope `const` is safe inside the
  function body that uses it; for `extractWgslFn` testability, fold the const list into
  the function body or pass via a helper).
- Needs `complex_pow(t, x+0.5)` → `complex_exp(complex_mul(complex_log(t), x+0.5))`.
- Needs `complex_exp(−t)`.
- Reflection branch needs `complex_sin(πz)`. complex_sin(z) = (sin(x)·cosh(y),
  cos(x)·sinh(y)) — cosh/sinh of large y blows up; clamp with `clamp(y, −20, 20)` for
  numerical safety (e^20 ≈ 5e8, plenty of dynamic range).
- Output: clamp magnitude post-compute to avoid blowing the histogram.

**Defaults:** weight 0.3 (smaller weight reflects larger dynamic range), no params needed.

**Defer-if-gnarly clause:** Γ is the hardest of the 5. If implementation reveals
ABI/numerical surprises (cumulative dispatch limit, magnitude blowups not tame-able by
clamp), file a fresh issue and ship the other 4. Don't pile band-aids on Γ to keep the
batch shape.

### V224 — `lambert_w` (principal branch W₀ via Halley)

**Formula:** W(z) satisfies `W · e^W = z`. Principal branch W₀ via Halley iteration.

**Parameters:**
- `iters` (slot z, int 2–4, default 2) — Halley iteration count. 2 gives ~10 digits for
  typical inputs; 3 gives full f32 precision.
- slot w reserved.

**Implementation:**
- Magnitude-gated initial guess:
  - `|z| < 1`: `w_0 = complex_log(vec2f(1,0) + z)` (small-z series)
  - `|z| ≥ 1`: `w_0 = complex_log(z) − complex_log(complex_log(z))` (asymptotic)
- Halley step: `w_{n+1} = w_n − (w_n·e^{w_n} − z) / (e^{w_n}·(w_n+1) − (w_n+2)·(w_n·e^{w_n} − z)/(2·w_n+2))`
- Fixed iteration count (compile-time loop bound 4, with runtime `iters` clamp) — stateless,
  no convergence loop.
- Guards: `complex_log(0)` → eps; `e^{w_n}` with `w_n.x` clamped to ±20 to avoid f32 overflow.

**Defaults:** weight 0.5, iters=2.

## Infra extension (Phase 1)

New helpers in `chaos.wgsl`, added next to the existing `complex_*` block (≈ line 324):

```wgsl
// complex exponential: e^z = e^(x) * (cos(y), sin(y)). Uses safe_sin/cos
// because Im(z) can grow large (Γ reflection branch, Lambert W intermediate steps).
fn complex_exp(z: vec2f) -> vec2f {
  let e = exp(clamp(z.x, -20.0, 20.0));  // f32 overflow guard
  return e * vec2f(safe_cos(z.y), safe_sin(z.y));
}

// complex power: t^p = exp(p * log(t)). Used by Γ for t^(x+0.5).
fn complex_pow(t: vec2f, p: vec2f) -> vec2f {
  return complex_exp(complex_mul(p, complex_log(t)));
}

// complex sine: sin(z) = (sin(x)*cosh(y), cos(x)*sinh(y)).
// cosh(y) = (e^y + e^(-y))/2; sinh(y) = (e^y - e^(-y))/2.
// y clamped to ±20 to bound dynamic range.
fn complex_sin(z: vec2f) -> vec2f {
  let y = clamp(z.y, -20.0, 20.0);
  let ep = exp(y);
  let en = exp(-y);
  let ch = 0.5 * (ep + en);
  let sh = 0.5 * (ep - en);
  return vec2f(safe_sin(z.x) * ch, safe_cos(z.x) * sh);
}
```

**`extractWgslFn` tests:** runtime args, runtime t/p inputs — per
`reference-pyr3-catalog-scaffold-tripwires` + the constant-folding trap noted in #72.

## Build pipeline (per variation)

The catalog scaffold pattern is locked from #114/#119/#120/#121:

1. Registry entry in `src/variations.ts` (V-index const + variation table entry).
2. WGSL `fn var_<name>(...)` in `src/shaders/chaos.wgsl` (and `fn var_newton_color(...)`
   for Newton's DC branch).
3. Pack/unpack — none needed; params fit existing `vars[k].zw` slots (≤2 params each).
4. Dispatch entry in the main `var_select` switch at `chaos.wgsl:5126+`.
5. GPU smoke test in `src/shaders/chaos-<name>.gpu.test.ts` using `extractWgslFn` with
   **runtime args** (constant-fold trap per #46/#72).
6. Catalog page on `/v1/variations`: KaTeX formula + warp diagram + live flame + tunable
   sliders. Defaults must produce a non-degenerate sierpinski test render.
7. Variation picker entry in `src/edit-variation-picker.ts` (modal "fitting room").

## DC seam extension

Current shape (`chaos.wgsl:5552-5568` and the parallel finalxform block at ~5733):

```wgsl
if (xf.color_params.w > 0.5 && v.y > 0.0) {  // dc_flag set, this var active
  if (var_idx == 99u) {        // dc_linear (color-only)
    dc_rgb_override = var_dc_linear_color(pa_mut);
    dc_override_active = true;
  } else if (var_idx == 100u) { // dc_perlin (color-only)
    dc_rgb_override = var_dc_perlin_color(pa_mut, v.z, v.w, ve.x);
    dc_override_active = true;
  } else if (var_idx == 101u) { // dc_gridout (color-only)
    dc_rgb_override = var_dc_gridout_color(pa_mut, v.z);
    dc_override_active = true;
  } else if (var_idx == 102u) { // dc_cylinder (position warp + color)
    dc_rgb_override = var_dc_cylinder_color(pa_mut);
    dc_override_active = true;
  }
}
```

**Extension:** add a Newton case after dc_cylinder. Pattern is **identical** to
dc_cylinder — V220 has both a position-warp entry in the main switch (`case 220u: {
return var_newton(p, w, p0); }`) AND a color helper called here. Compute the post-step
coord inside `var_newton_color` for the basin lookup:

```wgsl
} else if (var_idx == 214u) { // newton: position-warp + DC basin color
  dc_rgb_override = var_newton_color(pa_mut, v.z);  // v.z = n
  dc_override_active = true;
}
```

**MUST also update the parallel finalxform DC block** (currently `chaos.wgsl:~5733`) —
it ships the same dispatch list for finalxform's DC variations. Same Newton branch added
there. Identical code.

**This is NOT a new pattern.** `dc_cylinder` (V102, #114) is the existing "DC + position-warp"
precedent. Newton follows it. No ABI change; no genome-format change. Comment at
`chaos.wgsl:5258` updates from "dc_cylinder (102) warps position like flam3's var_cylinder"
to "dc_cylinder (102) and newton (214) are position-warp + DC."

## Ship gates

- **Per-variation:** GPU smoke (`*.gpu.test.ts`) + catalog page rendering check + non-
  degenerate sierpinski-scaffold render.
- **Batch:** typecheck, full unit suite (`npm test`), BE parity rig (`npm run test:parity`,
  91s — render path touched, so this is recommended).
- **FE↔BE smoke** (`npm run test:fe-be-smoke`, 90s) — viewer-side WGSL changes hit the FE
  visualize path too.
- **Chrome eyeball:** 5-tile gallery page at `.remember/verify/issue-133-conformal.html`
  showing each variation at default + DC-ON for Newton specifically. Open via clickable
  `file:///` URL per the gitignored-verify-pages convention.
- **Code review:** fresh subagent reviewer (no implementation bias), full diff.
- **FF-merge:** explicit user approval. **Never auto-merge.**

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Γ Lanczos numerical instability | Defer-if-gnarly clause: file separate issue, ship 4/5 |
| Lambert W initial-guess discontinuity at \|z\|=1 boundary | Continuous magnitude-gated branch (no Boolean threshold flip — use smooth lerp if visible artifacts) |
| Cumulative dispatch limit in vitest (47 max per worker — #163 pattern) | Split GPU tests across 5 files (one per variation), naturally per-variation |
| Constant-folding masks Dawn f32 trig cliff | Use runtime args in all `extractWgslFn` tests — established pattern |
| Catalog sierpinski-scaffold degenerate render | Defaults chosen with sierpinski extent ~1 in mind (see per-variation Defaults sections) |
| 10+-param ABI risk | Newton 1 param, Blaschke 2, Cayley 1, Γ 1, Lambert W 1 — all well within cap |
| Newton's first "DC + position" pattern misfires elsewhere | Tightly scoped to V.newton case in dc-callsite branch; no global classifier change |

## Non-goals

- **Hybrid DC coloring scheme C** (basin index + distance-to-root brightness modulation):
  ship as future polish via slot-w `softness` param (currently reserved).
- **Multi-zero Blaschke products** (n>2 zeros): the 2-to-1 form is the canonical aesthetic;
  multi-zero would need vars_extra3 ABI work.
- **Non-principal Lambert W branches** (W₋₁, W₁, ...): principal branch is the canonical
  one; non-principal can come as separate variations later.
- **Generalized complex Γ** beyond Lanczos g=7: g=7 is the textbook precision/cost balance.

## Followups (don't fold in)

- **Issue if Γ deferred** — re-file as standalone issue, link from #133.
- **#145 escape-time fractals + DC** — direct beneficiary of the "DC + position" seam
  extension this batch lands.
- **#149 Droste/named spirals** — directly reuses `complex_log` + `complex_pow`.
- **Newton hybrid coloring (`softness`)** — slot w reserved here; one-line follow-up if
  the iconic discrete look gets requests for soft borders.

## Provenance

- Brainstorm-Q1: 5-var batch chosen (recommendation A).
- Brainstorm-Q2: position-warp + paired DC color shape (recommendation A); kernel pattern
  extension chosen over registry-split.
- Brainstorm-Q3: SME-delegated → discrete n-basin coloring, n exposed.
- All remaining picks SME-delegated by user 2026-06-07 15:30 ("you are the SME ... please
  figure out the best path forward").
- Verified vs JWF source (#128 grep, 917 files, 2026-06-07): `newton`, `blaschke`,
  `cayley` = 0 matches (novel); `gamma` exists upstream (color-gamma, not complex Γ —
  pyr3 free to name ours `complex_gamma`).
