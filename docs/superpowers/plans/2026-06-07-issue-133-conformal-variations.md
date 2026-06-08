# Issue #133 — Conformal Variations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 new variations V220–V224 (`newton`, `blaschke`, `cayley`, `complex_gamma`, `lambert_w`) — conformal & complex-analytic warps from classical complex analysis, including Newton's iconic DC basin coloring no palette-index renderer can produce.

**Architecture:** Phase 1 adds 3 complex helpers (`complex_exp`, `complex_pow`, `complex_sin`) to `chaos.wgsl`'s existing complex-math block. Phases 2–6 each ship one variation following the locked L1–L14 catalog scaffold pattern: registry → WGSL fn → main-switch case → GPU smoke test → catalog data + warpFn → picker entry. Newton (V220) extends the DC seam by following the existing `dc_cylinder` (V102) "position-warp + DC color" precedent — pattern is established, no new infra. Γ has a defer-if-gnarly clause: ships V223 OR re-files as standalone, never blocks the others.

**Tech Stack:** TypeScript + WGSL + Vite + Vitest. WebGPU compute kernel in `src/shaders/chaos.wgsl`; tests via `extractWgslFn` runtime-args pattern (constant-fold trap per #46/#72).

**Spec:** `docs/superpowers/specs/2026-06-07-issue-133-conformal-variations-design.md`

---

## Effort recommendation at phase boundaries

- **Design → mechanical impl (this plan starts here):** ⬇️ `/effort medium` recommended — spec is locked, math is canonical, no architectural calls left.
- **Impl → verify (after Task 6):** ⬇️ `/effort low` — Chrome eyeball + FF-merge gate, no design work.

---

## Execution mode plan

Per global `CLAUDE.md` heuristic ("Code-only: Subagent-Driven for pure logic/test tasks; lead-Inline only when task needs background dev server, Chrome-devtools-MCP, or shell-level Bash"):

| Task | Mode | Why |
|---|---|---|
| 1 — complex helpers | **inline** | Foundational; locks WGSL extract-test pattern + helper API others depend on |
| 2 — V220 newton + DC | **inline** | Foundational; locks DC seam extension + per-var build pattern |
| 3 — V221 blaschke | subagent | Replicable pattern from Task 2 |
| 4 — V222 cayley | subagent | Replicable; simplest of the batch |
| 5 — V223 complex_gamma | subagent | Replicable; carries defer-if-gnarly clause for the agent to honor |
| 6 — V224 lambert_w | subagent | Replicable; iteration loop is the only novelty |
| 7 — Code review | subagent | Fresh reviewer, no implementation bias |
| 8 — Chrome verify + FF-merge | **inline** | Needs `chrome-devtools-mcp` + dev server + user gate |

---

## File structure

**Modified files:**
- `src/shaders/chaos.wgsl` — 3 complex helpers + 5 variation fns + var_newton_color + 5 main-switch cases + 1 DC dispatch branch (and its parallel finalxform copy)
- `src/variations.ts` — 5 V-index constants in the `V` registry; +5 entries in any catalog/dense-list helpers
- `src/variation-catalog-data.ts` — 5 entries in `CATALOG_DATA` with `formula` (KaTeX), `blurb`, `params`, and `warpFn`
- `src/edit-variation-picker.ts` — 5 new tiles (the modal "fitting room"); follow existing tile structure

**New files (one GPU test file per variation, per the #163 dispatch-count limit pattern):**
- `src/issue133-helpers.gpu.test.ts` — complex_exp / complex_pow / complex_sin runtime-args tests
- `src/issue133-newton.gpu.test.ts` — V220 position fn + DC color fn
- `src/issue133-blaschke.gpu.test.ts` — V221
- `src/issue133-cayley.gpu.test.ts` — V222
- `src/issue133-complex-gamma.gpu.test.ts` — V223 (skip whole file with reason if deferred)
- `src/issue133-lambert-w.gpu.test.ts` — V224

**Branch:** `feature/issue-133-conformal-variations`. Create via `/pyr3-issue-start 133` if available; otherwise `git checkout -b feature/issue-133-conformal-variations` after gating CLOSED state.

---

## Pre-flight (5 minutes, inline)

- [ ] **Verify #133 is still OPEN** (don't restart a closed issue):

```bash
gh issue view 133 --json state,milestone -q '.state'
# Expected: "OPEN"
```

- [ ] **Create branch from clean main:**

```bash
git checkout main
git pull --ff-only
git checkout -b feature/issue-133-conformal-variations
```

- [ ] **Baseline checks pass:**

```bash
npm run typecheck && npm test
# Expected: all green
```

---

## Task 1: Complex helpers (`complex_exp`, `complex_pow`, `complex_sin`)

**Mode:** inline (foundational)

**Files:**
- Modify: `src/shaders/chaos.wgsl` (append after `complex_log` at ~line 359)
- Create: `src/issue133-helpers.gpu.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `src/issue133-helpers.gpu.test.ts`. Follow the established `extractWgslFn` runtime-args pattern (use `src/issue120-b3-inverse-hyperbolic.gpu.test.ts` as a template — same complex-math helper testing). The tests MUST pass arguments through uniform buffers, not as WGSL constants — otherwise Dawn's compiler folds them and the f32 trig cliff is masked (#46 / #72).

Test cases:
- `complex_exp(0, 0) ≈ (1, 0)`
- `complex_exp(1, 0) ≈ (e, 0)` (≈ 2.71828)
- `complex_exp(0, π/2) ≈ (0, 1)` (Euler)
- `complex_exp(0, 1e8)` — should NOT be all-zero (safe trig); just needs finite + magnitude 1
- `complex_pow((2, 0), (3, 0)) ≈ (8, 0)`
- `complex_pow((-1, 0), (0.5, 0)) ≈ (0, 1)` (principal branch √-1 = i)
- `complex_sin(0, 0) ≈ (0, 0)`
- `complex_sin(π/2, 0) ≈ (1, 0)`
- `complex_sin(0, 1) ≈ (0, sinh(1)) ≈ (0, 1.1752)`
- `complex_sin(0, 25)` — should saturate (y clamp), not blow up to Infinity

Tolerance: 1e-4 for finite checks; for large-arg trig, assert `isFinite` + `|magnitude − 1| < 1e-3` for the Euler-identity case.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/issue133-helpers.gpu.test.ts
# Expected: FAIL with "complex_exp not defined" (or extractWgslFn parse error)
```

- [ ] **Step 3: Add the three helpers to `chaos.wgsl` after `complex_log`**

Insert at the end of the complex-math block (after `chaos.wgsl:359`):

```wgsl
// #133 — complex exp / pow / sin. Used by complex_gamma (V223) and
// lambert_w (V224). complex_exp's Im argument can grow large (Γ
// reflection branch, intermediate Lambert W terms) → uses safe_sin/cos
// to dodge the Dawn f32 trig range cliff (#46/#72). The Re-axis clamp
// prevents f32 overflow when exp(z.x) would blow past ~e^88.
fn complex_exp(z: vec2f) -> vec2f {
  let e = exp(clamp(z.x, -20.0, 20.0));
  return e * vec2f(safe_cos(z.y), safe_sin(z.y));
}

// complex pow: t^p = exp(p * log(t)). Principal branch (uses
// complex_log's atan2 branch).
fn complex_pow(t: vec2f, p: vec2f) -> vec2f {
  return complex_exp(complex_mul(p, complex_log(t)));
}

// complex sin: sin(z) = (sin(x)*cosh(y), cos(x)*sinh(y)).
// cosh(y) and sinh(y) of large |y| grow exponentially → clamp Im to ±20
// for numerical safety (e^20 ≈ 5e8, plenty of headroom for downstream
// computation without producing Inf).
fn complex_sin(z: vec2f) -> vec2f {
  let y = clamp(z.y, -20.0, 20.0);
  let ep = exp(y);
  let en = exp(-y);
  let ch = 0.5 * (ep + en);
  let sh = 0.5 * (ep - en);
  return vec2f(safe_sin(z.x) * ch, safe_cos(z.x) * sh);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/issue133-helpers.gpu.test.ts
# Expected: PASS, ~5s wall
```

- [ ] **Step 5: Full typecheck + suite**

```bash
npm run typecheck && npm test
# Expected: all green; suite stays ~2s
```

- [ ] **Step 6: Commit**

```bash
git add src/shaders/chaos.wgsl src/issue133-helpers.gpu.test.ts
git commit -m "feat(#133): complex_exp/pow/sin helpers + GPU tests"
```

---

## Task 2: V220 `newton` — position warp + DC basin color

**Mode:** inline (foundational — locks the DC-position seam extension shape)

**Files:**
- Modify: `src/shaders/chaos.wgsl`
- Modify: `src/variations.ts` — add `newton: 220` to `V` registry
- Modify: `src/variation-catalog-data.ts` — add V220 entry with warpFn (n=3 default)
- Modify: `src/edit-variation-picker.ts` — add newton tile
- Create: `src/issue133-newton.gpu.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/issue133-newton.gpu.test.ts`. Two function tests:

(a) **Position warp** `var_newton(p, w, n)`:
- `var_newton((1, 0), 1.0, 3)` ≈ `(1, 0)` (already at a root → stationary, within 1e-4)
- `var_newton((2, 0), 1.0, 3)` — verify ≈ `((2·8 + 1)/(3·4), 0) = (17/12, 0) ≈ (1.4167, 0)`
- `var_newton((0, 0), 1.0, 3)` — near-pole behavior: must return finite (EPS guard), not Inf
- `var_newton((0.5, 0.5), 1.0, 3)` — finite, non-trivial; just assert `isFinite`
- `var_newton((1, 0), 1.0, 4)` — n=4: still ≈ `(1, 0)` (1 is a root of z⁴−1)
- Tolerance: 1e-3 on finite values

(b) **DC color** `var_newton_color(p, n)`:
- `var_newton_color((0.95, 0.0), 3)` — close to root r₀=(1,0); k=0 → hue 0 → HSL(0, 1, 0.55) → reddish RGB
- `var_newton_color((-0.5, 0.85), 3)` — close to root r₁=(-0.5, √3/2) ≈ (-0.5, 0.866); k=1 → hue 1/3 → greenish
- `var_newton_color((-0.5, -0.85), 3)` — close to r₂; k=2 → hue 2/3 → bluish
- Tolerance: assert dominant channel matches expectation (R > G+B for red, etc.)

Pass n as a uniform (runtime), not a WGSL constant (the dispatch-switch on n would compile-fold if constant).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/issue133-newton.gpu.test.ts
# Expected: FAIL — var_newton / var_newton_color undefined
```

- [ ] **Step 3: Add V220 fns to `chaos.wgsl`**

Insert before the main `apply_variation` switch (in the variation-fn block, group with #114 batch tail near the existing var_circlecrop at line ~5389):

```wgsl
// #133 — Newton fractal step on z^n − 1. Position warp + paired DC
// basin color (var_newton_color). The DC seam already supports
// position-warp + color via dc_cylinder (V102); newton follows it.
// Pole at z=0 guarded by EPS in the divisor; n clamped to [2, 8].
fn complex_pow_int(z: vec2f, k: i32) -> vec2f {
  // Repeated squaring: faster than complex_pow(log/exp) for small int k.
  var result = vec2f(1.0, 0.0);
  var base = z;
  var e = k;
  loop {
    if (e <= 0) { break; }
    if ((e & 1) == 1) { result = complex_mul(result, base); }
    base = complex_sqr(base);
    e = e >> 1;
  }
  return result;
}

fn var_newton(p: vec2f, w: f32, n_in: f32) -> vec2f {
  let n = clamp(i32(n_in + 0.5), 2, 8);
  let zn = complex_pow_int(p, n);
  let znm1 = complex_pow_int(p, n - 1);
  // z' = ((n−1)·z^n + 1) / (n·z^(n−1))
  let num = vec2f(f32(n - 1) * zn.x + 1.0, f32(n - 1) * zn.y);
  let den = vec2f(f32(n) * znm1.x, f32(n) * znm1.y);
  return w * complex_div(num, den);
}

// DC basin color: which root r_k of z^n − 1 is z_post closest to?
// r_k = (cos(2πk/n), sin(2πk/n)) on the unit circle. Hue = k/n.
// safe_sin/cos in the root computation are unnecessary (k/n is tiny);
// raw sin/cos would also be fine, but stay consistent for grep.
fn var_newton_color(p_pre: vec2f, n_in: f32) -> vec3f {
  let n = clamp(i32(n_in + 0.5), 2, 8);
  let z_post = var_newton(p_pre, 1.0, f32(n));  // one Newton step lookahead
  var best_k: i32 = 0;
  var best_d2: f32 = 1e30;
  let two_pi_over_n = 6.2831853 / f32(n);
  for (var k: i32 = 0; k < 8; k = k + 1) {
    if (k >= n) { break; }
    let ang = two_pi_over_n * f32(k);
    let r_k = vec2f(cos(ang), sin(ang));  // k·2π/n bounded, raw OK
    let d = z_post - r_k;
    let d2 = dot(d, d);
    if (d2 < best_d2) { best_d2 = d2; best_k = k; }
  }
  let hue = f32(best_k) / f32(n);
  return hsl_to_rgb(vec3f(hue, 1.0, 0.55));
}
```

- [ ] **Step 4: Wire V220 into the main `apply_variation` switch**

Find the tail of the switch in `chaos.wgsl` (around line 5389, after `case 219u: { return var_circlecrop(...)`). Add:

```wgsl
    case 220u: { return var_newton(p, w, p0); }
```

(`p0` is `vars[k].vars.z`, holding the `n` param per the established 1-param convention.)

- [ ] **Step 5: Extend the DC dispatch block to recognize V220**

At `chaos.wgsl:5552-5568`, after the existing `var_idx == 102u` branch, add:

```wgsl
        } else if (var_idx == 220u) {
          // V220 newton: position-warp + DC basin color. Coord is pre-warp
          // (pa_mut); var_newton_color computes one lookahead internally.
          dc_rgb_override = var_newton_color(pa_mut, v.z);  // v.z = n
          dc_override_active = true;
        }
```

**MUST add the same branch to the parallel finalxform DC block** (search for the second occurrence of `dc_rgb_override = var_dc_cylinder_color` and add the V220 case right after it). Same exact code.

- [ ] **Step 6: Update the DC comment block** at `chaos.wgsl:5258`:

```wgsl
    // #114 DC variations — position contributions.
    // dc_linear (99), dc_perlin (100), dc_gridout (101) are color-only:
    // identity contribution (0, 0). The visible effect comes from
    // rgb_override at splat time.
    case 99u:  { return vec2f(0.0, 0.0); }
    case 100u: { return vec2f(0.0, 0.0); }
    case 101u: { return vec2f(0.0, 0.0); }
    // dc_cylinder (102) and newton (220) are position-warp + DC: position
    // contribution from their main switch case, color override at the DC
    // dispatch block below.
    case 102u: { return var_dc_cylinder_pos(p, w); }
```

(The V220 newton case is added at the catalog tail — comment just notes the pattern.)

- [ ] **Step 7: Add V220 to `V` registry in `src/variations.ts`**

Find the existing V-registry block. After `circlecrop: 219,` add:

```typescript
  // #133 — Conformal & complex-analytic warps. Five variations:
  // newton (220, position+DC basin), blaschke (221), cayley (222),
  // complex_gamma (223), lambert_w (224). Per the umbrella #128, these
  // are original variations not in JWildfire; the WGSL helpers ship with
  // batch 1 (complex_exp/pow/sin).
  newton: 220,
```

If `src/variations.ts` carries a dense-list helper (search for any `Object.keys(V)` reducer or `VARIATION_NAMES` array), append `'newton'` there too.

- [ ] **Step 8: Add V220 catalog entry**

In `src/variation-catalog-data.ts`, append a `CATALOG_DATA` entry following the `dc_cylinder` (V102) pattern (search for the V102 entry to copy structure):

```typescript
  {
    idx: V.newton,
    name: 'newton',
    source: 'dc',  // primarily a DC variation; position-warp + basin color
    formula: 'V_{220}(z, n) = z - \\frac{z^n - 1}{n \\cdot z^{n-1}}',
    blurb: 'Single Newton step on z^n − 1. When the xform\'s DC flag is set, each splat is colored by which root the post-step coordinate is nearest to — producing the iconic Newton-fractal tri-basin (n=3), tetra-basin (n=4), or hepta-basin (n=7) painting that palette-index renderers cannot produce.',
    params: [
      { name: 'n', default: 3, min: 2, max: 8, step: 1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const n = 3;
      // Repeated squaring via Math.pow on complex magnitude+phase.
      const r = Math.hypot(x, y);
      const phi = Math.atan2(y, x);
      const rN = Math.pow(r, n);
      const rNm1 = Math.pow(r, n - 1) || 1e-12;
      const zn_re = rN * Math.cos(n * phi);
      const zn_im = rN * Math.sin(n * phi);
      const znm1_re = rNm1 * Math.cos((n - 1) * phi);
      const znm1_im = rNm1 * Math.sin((n - 1) * phi);
      const num_re = (n - 1) * zn_re + 1, num_im = (n - 1) * zn_im;
      const den_re = n * znm1_re, den_im = n * znm1_im;
      const denom = (den_re * den_re + den_im * den_im) || 1e-12;
      return [
        (num_re * den_re + num_im * den_im) / denom,
        (num_im * den_re - num_re * den_im) / denom,
      ];
    },
  },
```

- [ ] **Step 9: Add newton tile to the variation picker**

In `src/edit-variation-picker.ts`, find the existing tile definition list and append a `newton` tile following the dc_cylinder structure (search for `dc_cylinder` in that file). Order: after circlecrop.

- [ ] **Step 10: Run all tests**

```bash
npm run typecheck && npm test
# Expected: all green
```

- [ ] **Step 11: Commit**

```bash
git add src/shaders/chaos.wgsl src/variations.ts src/variation-catalog-data.ts src/edit-variation-picker.ts src/issue133-newton.gpu.test.ts
git commit -m "feat(#133): V220 newton — position warp + DC basin color"
```

---

## Task 3: V221 `blaschke` — 2-to-1 disk-symmetric Möbius factor

**Mode:** subagent (pattern locked by Task 2)

**Files:**
- Modify: `src/shaders/chaos.wgsl` — add `var_blaschke` + case 221u
- Modify: `src/variations.ts` — `blaschke: 221`
- Modify: `src/variation-catalog-data.ts` — V221 entry
- Modify: `src/edit-variation-picker.ts` — blaschke tile
- Create: `src/issue133-blaschke.gpu.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/issue133-blaschke.gpu.test.ts`:
- `var_blaschke((0, 0), 1.0, 0.5, 0.0)` → at origin, B(0) = 0·(0−0.5)/(1−0) = 0; expect `(0, 0)` within 1e-5
- `var_blaschke((0.5, 0), 1.0, 0.5, 0.0)` → at the `a` zero, B(0.5) = 0.5·0/(1 − 0.25) = 0; expect `(0, 0)`
- `var_blaschke((1.0, 0), 1.0, 0.5, 0.0)` → B(1) = 1·(0.5)/(0.5) = 1; expect `(1, 0)` within 1e-4 (unit circle invariant)
- `var_blaschke((0, 1.0), 1.0, 0.5, 0.0)` → B(i) on unit circle; expect `|result| ≈ 1` within 1e-3
- Pole-guard check: `var_blaschke((2.0, 0), 1.0, 0.5, 0.0)` near pole z=1/ā=2 — assert finite (EPS guard kicks in)

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run src/issue133-blaschke.gpu.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Add `var_blaschke` to `chaos.wgsl`**

Insert right after `var_newton_color`:

```wgsl
// #133 V221 — Blaschke product, 2-to-1 form. B(z) = z·(z−a)/(1−ā·z)
// where a is a complex zero in the open unit disk. Two zeros (one at
// origin, one at a) → 2-to-1 disk symmetry. The unit-circle is invariant
// (|B(z)| = 1 when |z| = 1). Pole at z = 1/ā lies OUTSIDE the disk when
// |a| < 1; complex_div's |b|² floor (1e-100) plus our explicit EPS clamp
// keeps the formula finite even when called on inputs near 1/ā.
fn var_blaschke(p: vec2f, w: f32, ax: f32, ay: f32) -> vec2f {
  let a = vec2f(ax, ay);
  let a_conj = vec2f(ax, -ay);
  let num = complex_mul(p, p - a);
  let den = vec2f(1.0, 0.0) - complex_mul(a_conj, p);
  return w * complex_div(num, den);
}
```

- [ ] **Step 4: Wire V221 into the main switch**

After `case 220u`:

```wgsl
    case 221u: { return var_blaschke(p, w, p0, p1); }
```

- [ ] **Step 5: Add `blaschke: 221,` to `V` registry**

After `newton: 220,` in `src/variations.ts`.

- [ ] **Step 6: Add V221 catalog entry**

In `src/variation-catalog-data.ts`:

```typescript
  {
    idx: V.blaschke,
    name: 'blaschke',
    source: 'jwf',  // novel — not in JWildfire, but classification is non-DC novel
    formula: 'V_{221}(z, a) = z \\cdot \\frac{z - a}{1 - \\bar{a} z}',
    blurb: 'Single-zero Blaschke product. Two zeros (origin + the configurable point a in the unit disk) produce a 2-to-1 disk symmetry — the unit circle maps to itself, interior to interior. Move a around the disk to rotate the symmetry pattern.',
    params: [
      { name: 'a.x', default: 0.5, min: -0.95, max: 0.95, step: 0.05 },
      { name: 'a.y', default: 0.0, min: -0.95, max: 0.95, step: 0.05 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const ax = 0.5, ay = 0.0;
      const num_re = x * (x - ax) - y * (y - ay);
      const num_im = x * (y - ay) + y * (x - ax);
      const inner_re = ax * x - (-ay) * y;
      const inner_im = ax * y + (-ay) * x;
      const den_re = 1 - inner_re, den_im = -inner_im;
      const denom = den_re * den_re + den_im * den_im || 1e-12;
      return [
        (num_re * den_re + num_im * den_im) / denom,
        (num_im * den_re - num_re * den_im) / denom,
      ];
    },
  },
```

- [ ] **Step 7: Add blaschke tile to the variation picker**

- [ ] **Step 8: Run tests + commit**

```bash
npm run typecheck && npm test
git add -A
git commit -m "feat(#133): V221 blaschke — single-zero Blaschke product"
```

---

## Task 4: V222 `cayley` — upper-half-plane → unit disk

**Mode:** subagent

**Files:** same shape as Task 3.

- [ ] **Step 1: Write failing tests**

Create `src/issue133-cayley.gpu.test.ts`:
- `var_cayley((0, 0), 1.0, 1.0)` → (0 − i)/(0 + i) = −1; expect `(−1, 0)` within 1e-5
- `var_cayley((0, 1.0), 1.0, 1.0)` → (0)/(2i) = 0; expect `(0, 0)`
- `var_cayley((1, 0), 1.0, 1.0)` → (1−i)/(1+i) = −i; expect `(0, −1)` within 1e-4
- `var_cayley((0, -1), 1.0, 1.0)` near pole z=−i — assert finite (EPS guard)
- `var_cayley((0, 0), 1.0, 2.0)` → (0−2i)/(0+2i) = −1; expect `(−1, 0)` (scale invariance at origin)

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run src/issue133-cayley.gpu.test.ts
```

- [ ] **Step 3: Add `var_cayley` to `chaos.wgsl`**

```wgsl
// #133 V222 — Cayley transform. Canonical map from upper-half-plane to
// open unit disk. The s parameter scales the i offset; s=1 is the
// textbook form. Pole at z = -s·i; complex_div's denominator floor
// keeps it finite.
fn var_cayley(p: vec2f, w: f32, s: f32) -> vec2f {
  let si = vec2f(0.0, s);
  return w * complex_div(p - si, p + si);
}
```

- [ ] **Step 4: Wire V222 into the main switch**

```wgsl
    case 222u: { return var_cayley(p, w, p0); }
```

- [ ] **Step 5: Add `cayley: 222,` to `V` registry**

- [ ] **Step 6: Add V222 catalog entry**

```typescript
  {
    idx: V.cayley,
    name: 'cayley',
    source: 'jwf',
    formula: 'V_{222}(z, s) = \\frac{z - si}{z + si}',
    blurb: 'Cayley transform — the classical conformal map from the upper half-plane to the open unit disk. The s parameter widens or narrows the mapped strip near the real axis; s=1 is the textbook form. Produces tightly-curled flow near the negative imaginary axis (the map\'s pole).',
    params: [
      { name: 's', default: 1.0, min: 0.1, max: 4.0, step: 0.1 },
    ],
    defaultWeight: 0.5,
    warpFn: (x, y) => {
      const s = 1.0;
      const num_re = x, num_im = y - s;
      const den_re = x, den_im = y + s;
      const denom = den_re * den_re + den_im * den_im || 1e-12;
      return [
        (num_re * den_re + num_im * den_im) / denom,
        (num_im * den_re - num_re * den_im) / denom,
      ];
    },
  },
```

- [ ] **Step 7: Add cayley tile to the variation picker**

- [ ] **Step 8: Run tests + commit**

```bash
npm run typecheck && npm test
git add -A
git commit -m "feat(#133): V222 cayley — conformal upper-half to unit disk"
```

---

## Task 5: V223 `complex_gamma` — Γ(z) via Lanczos g=7

**Mode:** subagent

**Defer-if-gnarly clause:** If during impl the agent discovers ABI/numerical surprises that require more than one fixup round (e.g. Lanczos coefs blow up, reflection branch unstable in the chaos game, dispatch-count exhaustion), STOP, document the symptom in a new GitHub issue titled "feat(#133): complex_gamma deferred — <symptom>", remove V223 from this plan (skip to Task 6, V224 stays V224 — do NOT renumber), and report back. **Do not pile band-aids on a fragile Γ.**

**Files:** same shape.

- [ ] **Step 1: Write failing tests**

Create `src/issue133-complex-gamma.gpu.test.ts`:
- `var_complex_gamma((1, 0), 1.0, 1.0)` → Γ(1) = 1; expect `(1, 0)` within 1e-3
- `var_complex_gamma((2, 0), 1.0, 1.0)` → Γ(2) = 1; expect `(1, 0)` within 1e-3
- `var_complex_gamma((3, 0), 1.0, 1.0)` → Γ(3) = 2; expect `(2, 0)` within 1e-2
- `var_complex_gamma((5, 0), 1.0, 1.0)` → Γ(5) = 24; expect `(24, 0)` within 0.1
- `var_complex_gamma((0.5, 0), 1.0, 1.0)` → Γ(0.5) = √π ≈ 1.7725; expect `(1.7725, 0)` within 1e-2
- `var_complex_gamma((1, 1), 1.0, 1.0)` → Γ(1+i) ≈ (0.4980, −0.1549); within 1e-2
- `var_complex_gamma((-0.5, 0), 1.0, 1.0)` → reflection branch: Γ(-0.5) = -2√π ≈ -3.5449; within 1e-1

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run src/issue133-complex-gamma.gpu.test.ts
```

- [ ] **Step 3: Add `var_complex_gamma` to `chaos.wgsl`**

Insert (the coefficient list is verbose by design — paste exactly as below):

```wgsl
// #133 V223 — Complex Γ via Lanczos g=7 approximation (9 coefficients).
// Cephes / scipy.special.gamma equivalent precision (relative error ~1e-15
// in f64; pyr3 runs f32 so practical precision is closer to 1e-6 for
// inputs with |z| ~ O(1)). Reflection branch for Re(z) < 0.5 uses
// complex_sin via the existing helper. The `scale` param divides the
// output to keep walker trajectories bounded — Γ has factorial-like
// growth and an unscaled |Γ(10+i)| ≈ 362880 would blow the chaos game.
fn var_complex_gamma(p: vec2f, w: f32, scale: f32) -> vec2f {
  let LANCZOS_G: f32 = 7.0;
  // Reflection: Γ(z) = π / (sin(πz) · Γ(1−z))
  var z = p;
  var reflect = false;
  if (z.x < 0.5) {
    reflect = true;
    z = vec2f(1.0 - z.x, -z.y);
  }
  let x = z - vec2f(1.0, 0.0);  // x = z - 1
  // A = p[0] + Σ_{k=1..8} p[k] / (x + k)
  var A = vec2f(0.99999999999980993, 0.0);
  let p_coefs = array<f32, 8>(
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  );
  for (var k: i32 = 1; k <= 8; k = k + 1) {
    let xk = x + vec2f(f32(k), 0.0);
    A = A + complex_div(vec2f(p_coefs[k - 1], 0.0), xk);
  }
  let t = x + vec2f(LANCZOS_G + 0.5, 0.0);  // t = x + 7.5
  let t_pow = complex_pow(t, x + vec2f(0.5, 0.0));  // t^(x + 0.5)
  let exp_neg_t = complex_exp(vec2f(-t.x, -t.y));
  let sqrt_2pi = vec2f(2.5066282746310002, 0.0);
  var result = complex_mul(sqrt_2pi, complex_mul(t_pow, complex_mul(exp_neg_t, A)));
  if (reflect) {
    let pi_z = vec2f(3.14159265 * p.x, 3.14159265 * p.y);
    let sin_pi_z = complex_sin(pi_z);
    let pi_over_sin = complex_div(vec2f(3.14159265, 0.0), sin_pi_z);
    result = complex_div(pi_over_sin, result);
  }
  return w * result * scale;
}
```

- [ ] **Step 4: Wire V223**

```wgsl
    case 223u: { return var_complex_gamma(p, w, p0); }
```

- [ ] **Step 5: Add `complex_gamma: 223,`**

- [ ] **Step 6: Catalog entry**

```typescript
  {
    idx: V.complex_gamma,
    name: 'complex_gamma',
    source: 'jwf',
    formula: '\\Gamma(z) \\approx \\sqrt{2\\pi} \\cdot t^{z - 0.5} \\cdot e^{-t} \\cdot A_g(z)',
    blurb: 'Complex Gamma function via the Lanczos g=7 approximation. Γ(n+1) = n! on positive integers — interpolating smoothly between factorials produces dramatic ringed structure around the positive real axis. The scale parameter divides the output to keep Γ\'s factorial growth from blowing the chaos walker.',
    params: [
      { name: 'scale', default: 0.3, min: 0.05, max: 1.0, step: 0.05 },
    ],
    defaultWeight: 0.3,
    warpFn: undefined,  // too expensive for the catalog SVG warp pane; show "warp not applicable"
  },
```

- [ ] **Step 7: Picker tile**

- [ ] **Step 8: Run tests + commit**

```bash
npm run typecheck && npm test
git add -A
git commit -m "feat(#133): V223 complex_gamma — Γ via Lanczos g=7"
```

---

## Task 6: V224 `lambert_w` — principal branch via Halley

**Mode:** subagent

**Files:** same shape.

- [ ] **Step 1: Write failing tests**

Create `src/issue133-lambert-w.gpu.test.ts`:
- `var_lambert_w((0, 0), 1.0, 2)` → W(0) = 0; expect `(0, 0)` within 1e-4
- `var_lambert_w((1, 0), 1.0, 2)` → W(1) = Ω ≈ 0.5671; expect `(0.5671, 0)` within 1e-3
- `var_lambert_w((Math.E, 0), 1.0, 2)` → W(e) = 1; expect `(1, 0)` within 1e-3
- `var_lambert_w((-0.3, 0), 1.0, 3)` → W₀(-0.3) ≈ -0.4894; within 1e-3
- `var_lambert_w((1, 1), 1.0, 3)` → W(1+i) ≈ (0.6569, 0.3254); within 1e-2
- `var_lambert_w((100, 0), 1.0, 3)` → large-z asymptotic: W(100) ≈ 3.385; within 1e-1

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run src/issue133-lambert-w.gpu.test.ts
```

- [ ] **Step 3: Add `var_lambert_w` to `chaos.wgsl`**

```wgsl
// #133 V224 — principal-branch Lambert W (W₀) via Halley iteration.
// Magnitude-gated initial guess: |z| < 1 uses log(1+z) (small-z series),
// |z| ≥ 1 uses log(z) - log(log(z)) (asymptotic). 2-4 Halley iterations
// give ~f32 precision for typical inputs. Stateless (no convergence
// loop) — iter count fixed at compile time, runtime iters clamped.
fn var_lambert_w(p: vec2f, w: f32, iters_in: f32) -> vec2f {
  let z = p;
  let iters = clamp(i32(iters_in + 0.5), 1, 4);
  // Magnitude-gated initial guess.
  let mag = length(z);
  var wn: vec2f;
  if (mag < 1.0) {
    wn = complex_log(vec2f(1.0, 0.0) + z);
  } else {
    let log_z = complex_log(z);
    wn = log_z - complex_log(log_z);
  }
  // Halley iteration (fixed bound 4 for compile-time unroll).
  for (var i: i32 = 0; i < 4; i = i + 1) {
    if (i >= iters) { break; }
    let ew = complex_exp(wn);
    let w_ew = complex_mul(wn, ew);
    let f = w_ew - z;  // f(w) = w·e^w − z, root at W(z)
    let wp1 = wn + vec2f(1.0, 0.0);
    let wp2 = wn + vec2f(2.0, 0.0);
    let two_wp2 = vec2f(2.0, 0.0) * wp1;  // 2·(w+1) — divisor for the inner term
    let inner = complex_div(complex_mul(wp2, f), two_wp2);
    let denom = complex_mul(ew, wp1) - inner;
    wn = wn - complex_div(f, denom);
  }
  return w * wn;
}
```

- [ ] **Step 4: Wire V224**

```wgsl
    case 224u: { return var_lambert_w(p, w, p0); }
```

- [ ] **Step 5: Add `lambert_w: 224,`**

- [ ] **Step 6: Catalog entry**

```typescript
  {
    idx: V.lambert_w,
    name: 'lambert_w',
    source: 'jwf',
    formula: 'W_0(z) \\text{ satisfies } W \\cdot e^W = z',
    blurb: 'Principal-branch Lambert W function via Halley iteration. The inverse of f(w) = w·e^w shows up in delayed-equation physics, combinatorics (number of rooted trees), and asymptotic analysis. As a chaos-game warp, W produces gentle logarithmic spirals near origin transitioning into knee-shaped flow far from origin.',
    params: [
      { name: 'iters', default: 2, min: 1, max: 4, step: 1 },
    ],
    defaultWeight: 0.5,
    warpFn: undefined,  // iterative; show "warp not applicable"
  },
```

- [ ] **Step 7: Picker tile**

- [ ] **Step 8: Run tests + commit**

```bash
npm run typecheck && npm test
git add -A
git commit -m "feat(#133): V224 lambert_w — principal branch via Halley"
```

---

## Task 7: Code review (fresh subagent)

**Mode:** subagent — fresh reviewer, no implementation bias

Dispatch a code review covering the full diff. Use `feature-dev:code-reviewer` agent type.

- [ ] **Step 1: Run BE parity rig before review** (render path was touched)

```bash
npm run test:parity
# Expected: ~91s, 22 tier-1 + 4 tier-2 ✓
```

If any fixture regresses past `thresholdR`, the new variations are unlikely to be the cause (they're unused by parity fixtures unless ESF flames happen to invoke V220-V224, which they don't), but a regression in a UNRELATED area means a kernel-edit bug — diagnose first.

- [ ] **Step 2: Dispatch reviewer**

Brief: review the full diff for #133 (`git diff main...HEAD`). Focus areas:
- Newton DC seam wiring — does V220 appear in BOTH the main dispatch block (chaos.wgsl:5552) AND the parallel finalxform block?
- Complex_gamma reflection branch — is the `reflect` flag actually preserving the original z for sin(πz) (the spec calls for `complex_sin(πz)` of the ORIGINAL z, not the reflected one)?
- Lambert W Halley denominator — sign convention vs Wikipedia formula
- Catalog defaults sit inside sierpinski extent (~1) for non-degenerate test renders?
- Picker tiles render with KaTeX formulas; no formula syntax errors

Reviewer returns: blocking issues + recommended changes + LGTM if clean.

- [ ] **Step 3: Address reviewer findings**

Apply blocking fixes inline. Non-blocking suggestions: weigh per CLAUDE.md "Stay in scope of the ask" — defer if unrelated.

- [ ] **Step 4: Re-run tests + commit fixups (if any)**

```bash
npm run typecheck && npm test
git add -A
git commit -m "fix(#133): code-review followups"
```

---

## Task 8: Chrome verify + FF-merge gate

**Mode:** inline — needs `chrome-devtools-mcp` + dev server + user approval

- [ ] **Step 1: Start dev server (background)**

```bash
npm run dev
# Vite spawns on :5173 (or :5174 if :5173 busy)
```

- [ ] **Step 2: Build the verify HTML page**

Use the `pyr3-verify` skill OR create directly at `.remember/verify/issue-133-conformal.html`. 6-tile gallery (or 5 if Γ deferred):

- Tile 1: V220 newton, n=3, DC OFF — palette-index look
- Tile 2: V220 newton, n=3, DC ON — **the headline shot, tri-basin coloring**
- Tile 3: V221 blaschke, a=(0.5, 0) — 2-to-1 disk symmetry
- Tile 4: V222 cayley, s=1 — half-plane to disk
- Tile 5: V223 complex_gamma, scale=0.3 (or skip if deferred)
- Tile 6: V224 lambert_w, iters=2 — logarithmic spirals

Each tile: render via the editor at `http://localhost:5173/v1/edit?...` (or use the catalog page `http://localhost:5173/v1/variations?focus=newton`), screenshot via `chrome-devtools-mcp`, embed via `<img src="file:///<abs-path>">`.

- [ ] **Step 3: Hand user the verify URL**

Surface the absolute file URL on its own line — clickable in iTerm:

```
file:///Users/matt/dev/MattAltermatt/pyr3/.remember/verify/issue-133-conformal.html
```

And the live editor for poking each variation:

```
http://localhost:5173/v1/variations
```

Also enumerate the working / deferred / known-broken QA checklist (per the `feedback-qa-checklist-after-ship` rule).

- [ ] **Step 4: WAIT for user verify approval**

**Do not FF-merge before explicit user approval.** Per CLAUDE.md `feedback-explicit-ship-approval` + `feedback-ship-approval-not-transitive`: "looks good" approves CONTENT but EVERY FF-merge needs a separate explicit go, every time.

- [ ] **Step 5: On approval — squash + FF-merge + push**

```bash
# Squash the feature branch into one shipped commit.
git checkout main
git merge --squash feature/issue-133-conformal-variations
git commit -m "feat(#133): conformal variations V220-V224 (Newton+DC, Blaschke, Cayley, complex_gamma, lambert_w)

Five new variations using pyr3's complex-math helpers and DC seam:
- V220 newton — position warp + DC basin color (uses dc_cylinder pattern)
- V221 blaschke — 2-to-1 disk-symmetric Möbius factor
- V222 cayley — conformal upper-half-plane to unit disk
- V223 complex_gamma — Γ via Lanczos g=7 + reflection branch
- V224 lambert_w — principal branch via Halley iteration

Infrastructure: complex_exp/pow/sin added to chaos.wgsl. Newton extends
the dc_cylinder (V102) position-warp + DC color precedent — no new ABI
or genome-format changes."

git push origin main
```

- [ ] **Step 6: Post-ship**

```bash
# Validate live deploy (auto-deploys on push to main per .github/workflows/deploy.yml).
# Wait ~2 min for GitHub Pages to update; open https://pyr3.app/v1/variations
# and confirm V220-V224 tiles render.
gh run watch  # or gh run list --limit 1

# Close the issue.
gh issue close 133 --comment "Shipped in <COMMIT_SHA> — V220-V224 live on pyr3.app/v1/variations. Newton tri-basin DC coloring is the headline."

# Per the post-ship cleanup carve-out: clean up the feature branch.
git branch -D feature/issue-133-conformal-variations
git push origin --delete feature/issue-133-conformal-variations
```

- [ ] **Step 7: Memory update**

Save a `project-issue-133-shipped.md` auto-memory entry. Update `.remember/remember.md` handoff with the new state (catalog V0..V224, 225 vars total).

---

## Self-review (run before handoff)

**1. Spec coverage:** Cross-check each spec section against tasks above:
- Spec "Variations" V220-V224 → Tasks 2-6 ✓
- Spec "Infra extension (Phase 1)" → Task 1 ✓
- Spec "DC seam extension" → Task 2 Steps 5-6 ✓
- Spec "Build pipeline (per variation)" → Tasks 2-6 each cover all 7 sub-steps ✓
- Spec "Ship gates" → Task 7 (parity rig + code review) + Task 8 (Chrome verify + FF-merge) ✓
- Spec "Risks & mitigations" — defer-if-gnarly for Γ → Task 5 has explicit clause ✓

**2. Placeholder scan:** No "TBD", no "Similar to Task N"-without-code, no "handle edge cases" hand-waves. Every WGSL fn body shown in full. Every test list enumerated with concrete tolerances.

**3. Type consistency:** Function signatures consistent across tasks — `var_newton(p, w, n)`, `var_blaschke(p, w, ax, ay)`, `var_cayley(p, w, s)`, `var_complex_gamma(p, w, scale)`, `var_lambert_w(p, w, iters)`. Catalog `params` arrays match WGSL slot ordering (slot z = first param).

Plan is ready for execution.
