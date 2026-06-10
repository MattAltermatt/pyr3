// pyr3 — chaos game compute pass (Phase 3).
//
// Walker state vec3<f32> = (xy + iterated color coord).
// Per iteration:
//   1. Pick xform by cumulative weight.
//   2. Apply affine pre-transform.
//   3. Sum the active variation chain (dispatched via runtime switch).
//   4. Color-contract: q.z = mix(p.z, xform.color, xform.colorSpeed).
//   5. Re-seed walker on NaN/extreme.
//   6. After fuse, scatter palette-indexed (R, G, B, count) into hist.
//
// ============================================================================
// 🚨 flam3 ANGLE-CONVENTION TRAP — read before adding/modifying variations.
// ============================================================================
//
// flam3 uses THREE distinct angle conventions for variations, all NON-standard
// vs the typical `atan2(y, x)` math convention. The per-variation flag in
// flam3's `variations.c` determines which convention applies:
//
//   precalc_atan_xy_flag  → angle = atan2(tx, ty)   ← x FIRST, y SECOND
//                           (sin θ = tx/r, cos θ = ty/r)
//                           Used by: polar, handkerchief, heart, disc, ex,
//                                    julia, fan, blob, fan2, disc2
//
//   precalc_atan_yx_flag  → angle = atan2(ty, tx)   ← STANDARD (y first)
//                           Used by: julian, juliaScope, radial_blur, ngon,
//                                    super_shape, flower, conic, cpow, escher
//
//   precalc_angles_flag   → sin θ = tx/r, cos θ = ty/r
//                           (no atan; SAME 90° rotation as atan_xy)
//                           Used by: spiral, hyperbolic, diamond
//
// Why three? flam3 measures angles from the +Y axis instead of the standard
// +X axis for the `atan_xy` and `angles` variations. This is a long-standing
// quirk inherited from Scott Draves' original C code. The Draves & Reckase
// 2003 fractal-flame paper documents the math symbolically but does NOT call
// out the angle convention — the only ground truth is `flam3 variations.c:`
// where the precalc flag is set per-variation.
//
// In WGSL: standard convention is `atan2(p.y, p.x)`. To match flam3:
//   atan_xy  → use `atan2(p.x, p.y)`        (swapped)
//   atan_yx  → use `atan2(p.y, p.x)`        (standard)
//   angles   → use `sina = p.x / r; cosa = p.y / r` (NOT sin/cos of any atan)
//
// Each `var_*` function below is tagged with the convention it implements.
// Surfaced 2026-05-09 — the original Phase 3 implementations had `atan2(p.y,
// p.x)` everywhere, producing 90°-rotated attractors for the atan_xy and
// angles variations. Symptom on the Electric Sheep parity work: discrete
// filled cells became wireframe grid lines. See BACKLOG.md "Verification
// scaffolding (post-mortem from disc atan2 bug, 2026-05-09)" for the
// regression-test scaffolding queued to prevent recurrence.

const MAX_VARS_PER_XFORM = 8u;
// Must match MAX_XFORMS in src/genome.ts (PYR3-033: bumped 32 → 128). Used as
// the row stride of the xaos_buffer (xaos[from][to] = xaos_buffer[from *
// MAX_XFORMS_U + to]) and the xform_distrib fallback row index.
const MAX_XFORMS_U: u32 = 128u;

struct Uniforms {
  width: u32,
  height: u32,
  iters_per_walker: u32,
  fuse: u32,
  scale: f32,
  cx: f32,
  cy: f32,
  num_xforms: u32,
  xform_total_weight: f32,
  seed: u32,
  final_xform_idx: i32, // -1 = none; otherwise slot in `xforms[]`
  rotation_rad: f32,    // slot 11 (byte 44) — Phase 9-rotate CCW camera rotation in radians (0 = none).
  // Phase 9-bg-palmode: 0 = step (floor index), 1 = linear (lerp adjacent
  // entries by fractional part). flam3 default is step (flam3.c:1316).
  // Branch is uniform across walkers in a workgroup (no divergence cost).
  palette_mode: u32,    // slot 12 (byte 48)
  // PYR3-029 Phase 5b: per-iter trace gate. When trace_mode==1, walker 0
  // writes (pick, pax, pay, pvx_pre, pvy_pre, pvx, pvy, isBad, color, draw)
  // to trace_buffer for the first 1000 post-fuse iters. Normal renders
  // pass trace_mode=0 and the trace_buffer is a tiny stub (no perf impact).
  trace_mode: u32,      // slot 13 (byte 52)
  // #11 (PYR3-057): exact walker count for this dispatch. The host rounds the
  // workgroup count up to a multiple of WORKGROUP_SIZE, so the final workgroup
  // spawns threads with index >= walker_count and NO ISAAC stream of their own.
  // chaos_main bails those threads (see the guard below) so they can't run the
  // chaos loop against stale/zero RNG and atomicAdd bogus hits into the histogram.
  walker_count: u32,    // slot 14 (byte 56)
  // #65 Tier 1: walker jitter is a runtime parameter. Per-iter scale-relative
  // perturbation on the trajectory commit (`local_mag * walker_jitter` since
  // #43); see the jx/jy site below for the rationale. Default
  // DEFAULT_WALKER_JITTER in src/chaos.ts — a dimensionless proportional
  // factor, not an absolute amplitude. Setting 0 disables jitter
  // (f32-collapse cliff returns).
  walker_jitter: f32,   // slot 15 (byte 60)
};

// Variation slots:
//   vars[k]        = (index_as_f32, weight, param0, param1)
//   vars_extra[k]  = (param2, param3, param4, param5)
//   vars_extra2[k] = (param6, param7, param8, param9)
// All three are MAX_VARIATIONS_PER_XFORM long (currently 8). Phase 9b grew
// the per-variation param seam from 2 → 6 to unlock multi-param variations
// (pdj=4, blob=3, ngon=4, wedge=4, cpow=3, …); Batch K extended 6 → 8 for
// mobius; #120 extended 8 → 10 (free wire-up of pre-reserved tail floats)
// for bipolar2 + M-tier port. The pack layout in src/genome.ts emits these
// in lockstep — bumping MAX_VARIATIONS_PER_XFORM requires updating BOTH `8`s
// here AND src/genome.ts XFORM_FLOATS together.
struct Xform {
  affine0: vec4f,            // a, b, c, weight
  affine1: vec4f,            // d, e, f, num_active_vars (as f32)
  color_params: vec4f,       // color, colorSpeed, opacity, dc_flag   (Phase 9d: opacity in slot 2; #114: dc_flag in slot 3)
  // Phase 9c: per-xform post-affine. Applied to (qx, qy) AFTER the variation
  // chain, before splat (matches flam3 variations.c:2412-2418). post0.w
  // doubles as the has_post flag (0 = skip, 1 = apply).
  post0: vec4f,              // pa, pb, pc, has_post
  post1: vec4f,              // pd, pe, pf, _
  vars: array<vec4f, 8>,         // index, weight, param0, param1
  vars_extra: array<vec4f, 8>,   // param2, param3, param4, param5  (Phase 9b)
  vars_extra2: array<vec4f, 8>,  // param6, param7, param8, param9  (Phase 9b Batch K; #120 wired .zw)
};

// ISAAC RNG state — one stream per walker. flam3 also uses ISAAC (RANDSIZL=4)
// per-thread for chaos-game RNG. Each stream's `randmem[16]` + `randrsl[16]`
// live in storage; `randcnt`/randa/randb/randc are loaded into function locals
// at iter loop start and written back at exit. PCG32 had inferior multi-step
// stream independence on this IFS (different walker concentration vs flam3's
// tighter attractor visiting), confirmed by direct flam3 vs pyr3 bucket dump
// (78.7B counts vs 44.1B at 32% vs 18% on-canvas rate respectively).
struct IsaacState {
  randcnt: u32,
  randa: u32,
  randb: u32,
  randc: u32,
  randmem: array<u32, 16>,
  randrsl: array<u32, 16>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> xforms: array<Xform>;
@group(0) @binding(2) var<storage, read_write> hist: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> palette: array<vec4f>;
// PYR3-029 Phase 5c: xaos is now baked into `xform_distrib` host-side via
// `packXformDistrib(genome)`. The shader no longer needs the raw xaos
// matrix. Binding slot 4 retired; isaac_states stays at 5 for stability.
// ISAAC state, one per walker. Initialized host-side via `packIsaacStates`
// (src/isaac.ts → src/chaos.ts).
@group(0) @binding(5) var<storage, read_write> isaac_states: array<IsaacState>;
// PYR3-029 Phase 5b: per-iter trace buffer (walker 0 only, first 1000
// post-fuse iters). Layout: 16 × f32 per iter = 64 bytes. Field order:
//   [0]=iter (post-fuse 0-indexed)  [1]=pick (xform idx as f32)
//   [2]=pax  [3]=pay  [4]=pvx_pre  [5]=pvy_pre
//   [6]=pvx  [7]=pvy  [8]=isBad  [9]=color  [10..15]=reserved
// Normal renders bind a 64-byte stub buffer (trace_mode=0 → no writes).
@group(0) @binding(6) var<storage, read_write> trace_buffer: array<f32>;
// PYR3-029 Phase 5c: flam3-canonical xform-pick distribution table.
// (MAX_XFORMS_U + 1) rows × CHOOSE_XFORM_GRAIN entries × u32. Row `i` is the
// pick distribution conditional on previous-xform == i. Row MAX_XFORMS_U is
// the no-prior-xform fallback (used at iter 0 / after the give-up bad-iter
// branch). Mirrors flam3.c:200-256 (`flam3_create_chaos_distrib`).
@group(0) @binding(7) var<storage, read> xform_distrib: array<u32>;
const CHOOSE_XFORM_GRAIN: u32 = 16384u;
const CHOOSE_XFORM_GRAIN_M1: u32 = 16383u;

const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
// EPS matches flam3's `private.h:47` `#define EPS (1e-10)`. The tighter
// constant matters at near-singularity inputs (r < 1e-3) for variations
// that use `r + EPS` denominators — var_spiral / var_hyperbolic /
// var_diamond. Surfaced 2026-05-09 by flam3-correctness-verifier during
// the variation-test-harness PR 1 review (BACKLOG item E).
const EPS: f32 = 1e-10;
const PALETTE_LAST_F: f32 = 255.0;
const PALETTE_LAST_U: u32 = 255u;
// ln(10) — used by var_twintrian for log10 conversion. WGSL has no log10 builtin;
// hoisting this constant avoids a per-iter `log(10.0)` evaluation that some
// drivers won't constant-fold.
const LN10: f32 = 2.302585092994046;

// ISAAC RNG round — fills isaac_states[wi].randrsl with 16 fresh u32 outputs.
// Direct port of `flam3/isaac.c:25` with RANDSIZL=4 (RANDSIZ=16). Manually
// unrolled to 16 sub-steps. Each sub-step uses a different `mix` of `a`:
//   k%4==0: a^(a<<13)
//   k%4==1: a^(a>>6)
//   k%4==2: a^(a<<2)
//   k%4==3: a^(a>>16)
// Indirection: `ind(mm, x) = mm[(x>>2) & 15]`. The second lookup is
// `ind(mm, y>>RANDSIZL)` which expands to `mm[((y>>4)>>2) & 15] = mm[(y>>6) & 15]`.
fn isaac_round(wi: u32) {
  // Load scalar state into function locals.
  var a: u32 = isaac_states[wi].randa;
  let new_c: u32 = isaac_states[wi].randc + 1u;
  isaac_states[wi].randc = new_c;
  var b: u32 = isaac_states[wi].randb + new_c;
  var x: u32; var y: u32;

  // Half 0: m = 0..7, m2 = 8..15. Half 1: m = 8..15, m2 = 0..7.
  // Each half: 8 sub-steps. Each block of 4: mix1, mix2, mix3, mix4.
  for (var half: u32 = 0u; half < 2u; half = half + 1u) {
    let m_base: u32 = half * 8u;
    let m2_base: u32 = (1u - half) * 8u;
    for (var k: u32 = 0u; k < 8u; k = k + 4u) {
      // sub-step 0: mix = a << 13
      x = isaac_states[wi].randmem[m_base + k];
      a = (a ^ (a << 13u)) + isaac_states[wi].randmem[m2_base + k];
      y = isaac_states[wi].randmem[(x >> 2u) & 15u] + a + b;
      isaac_states[wi].randmem[m_base + k] = y;
      b = isaac_states[wi].randmem[(y >> 6u) & 15u] + x;
      isaac_states[wi].randrsl[m_base + k] = b;

      // sub-step 1: mix = a >> 6
      x = isaac_states[wi].randmem[m_base + k + 1u];
      a = (a ^ (a >> 6u)) + isaac_states[wi].randmem[m2_base + k + 1u];
      y = isaac_states[wi].randmem[(x >> 2u) & 15u] + a + b;
      isaac_states[wi].randmem[m_base + k + 1u] = y;
      b = isaac_states[wi].randmem[(y >> 6u) & 15u] + x;
      isaac_states[wi].randrsl[m_base + k + 1u] = b;

      // sub-step 2: mix = a << 2
      x = isaac_states[wi].randmem[m_base + k + 2u];
      a = (a ^ (a << 2u)) + isaac_states[wi].randmem[m2_base + k + 2u];
      y = isaac_states[wi].randmem[(x >> 2u) & 15u] + a + b;
      isaac_states[wi].randmem[m_base + k + 2u] = y;
      b = isaac_states[wi].randmem[(y >> 6u) & 15u] + x;
      isaac_states[wi].randrsl[m_base + k + 2u] = b;

      // sub-step 3: mix = a >> 16
      x = isaac_states[wi].randmem[m_base + k + 3u];
      a = (a ^ (a >> 16u)) + isaac_states[wi].randmem[m2_base + k + 3u];
      y = isaac_states[wi].randmem[(x >> 2u) & 15u] + a + b;
      isaac_states[wi].randmem[m_base + k + 3u] = y;
      b = isaac_states[wi].randmem[(y >> 6u) & 15u] + x;
      isaac_states[wi].randrsl[m_base + k + 3u] = b;
    }
  }

  isaac_states[wi].randa = a;
  isaac_states[wi].randb = b;
}

// Get next u32 from ISAAC stream — port of the `irand` macro from `isaac.h:49`.
// `cnt` decrements; when it would underflow, run a round and reload.
fn isaac_irand(wi: u32) -> u32 {
  let cnt = isaac_states[wi].randcnt;
  if (cnt == 0u) {
    isaac_round(wi);
    isaac_states[wi].randcnt = 15u;
    return isaac_states[wi].randrsl[15u];
  }
  let new_cnt = cnt - 1u;
  isaac_states[wi].randcnt = new_cnt;
  return isaac_states[wi].randrsl[new_cnt];
}

// PYR3-029 Phase 5 fix (2026-05-28): match flam3-canonical rand transforms
// bit-precisely. flam3.c:2625-2631 masks off the top 4 bits of the ISAAC u32
// before scaling, then divides by 28-bit ranges. The prior pyr3 implementation
// used the full 32-bit ISAAC output, which advanced the RNG state identically
// to flam3 but produced different transformed values from the same u32 —
// causing exponential trajectory divergence after a handful of iters. Root
// cause of the coverage.248.02226 / coverage.245.06687 spatial-coverage gap
// (see BACKLOG `[PYR3-029]` Phase 5).
//
// Matches flam3 `flam3_random_isaac_01`: `((int)irand & 0xfffffff) / (double)0xfffffff`.
fn rand01(wi: u32) -> f32 {
  let raw = isaac_irand(wi);
  let masked = raw & 0x0fffffffu;
  return f32(masked) * (1.0 / 268435455.0);
}

// Matches flam3 `flam3_random_isaac_11`:
// `(((int)irand & 0xfffffff) - 0x7ffffff) / (double)0x7ffffff` — symmetric [-1, 1].
fn rand_11(wi: u32) -> f32 {
  let raw = isaac_irand(wi);
  let masked = i32(raw & 0x0fffffffu);
  return f32(masked - 0x07ffffff) * (1.0 / 134217727.0);
}

// ---------------------------------------------------------------------
// Variation kernels — order matches V indices in src/variations.ts.
// All take post-affine `p` and weight `w`. Some take extra params or rng.
// ---------------------------------------------------------------------

// #72: Dawn's f32 sin/cos return 0 for |arg| ≳ 1e7 (their range-reduction limit;
// accurate to ~6 digits below ~5e6, then a hard cliff to 0 — within the WGSL
// spec, which only guarantees trig accuracy in a bounded argument range). ANY
// variation that feeds sin/cos/tan a non-angle-bounded argument is affected:
// coef-scaled (waves: sin(p/(c²+EPS)) with c→0 → p·1e10), radius-scaled
// (swirl: sin(r²); disc: sin(π·r)), or a far-flung coordinate. The arg silently
// overflows the GPU trig unit and the variation degenerates — e.g. waves → the
// identity transform, collapsing attractor coverage (electricsheep.248.25703:
// 1.26M vs flam3 4.0M buckets → dark/sharp at high gamma).
//
// Below the threshold Dawn's trig IS accurate, so use it directly (the faithful
// path — angle-bounded args never trip it). Above it — where the true phase is
// ALSO below f32 INPUT resolution anyway — synthesize a deterministic, well-
// distributed pseudo-spread from the argument's bits: this keeps the variation's
// BREADTH (matching flam3's f64 spread statistically, not bit-faithfully —
// within pyr3's "similar, not bit-faithful" contract). safe_sin/safe_cos share
// one hashed angle θ so (sin,cos) of the same huge arg stay a consistent pair.
// flam3 (f64 + full Payne-Hanek reduction) handles any argument; GPU f32 cannot.
const SIN_SAFE_MAX: f32 = 1.0e6;
fn hash01(x: u32) -> f32 {
  var h = x;
  h = h ^ (h >> 17u); h = h * 0xed5ad4bbu;
  h = h ^ (h >> 11u); h = h * 0xac4c1b51u;
  h = h ^ (h >> 15u);
  return f32(h) / 4294967296.0; // [0,1)
}
fn safe_sin(a: f32) -> f32 {
  if (abs(a) <= SIN_SAFE_MAX) { return sin(a); }
  return sin(hash01(bitcast<u32>(a)) * TAU);
}
fn safe_cos(a: f32) -> f32 {
  if (abs(a) <= SIN_SAFE_MAX) { return cos(a); }
  return cos(hash01(bitcast<u32>(a)) * TAU);
}
fn safe_tan(a: f32) -> f32 {
  return safe_sin(a) / safe_cos(a);
}

// #120 batch B3 — complex-math primitives (z = vec2f(re, im)). Direct
// ports of JWildfire's `Complex.java` semantics (LGPL-2.1+, NOTICE.md);
// the inverse-hyperbolic variation family composes these. Reused beyond
// B3 by any future complex-valued variation port.
fn complex_mul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
fn complex_sqr(z: vec2f) -> vec2f {
  return vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
}
fn complex_div(a: vec2f, b: vec2f) -> vec2f {
  // |b|² floor at 1e-100 matches JWildfire MagInv() — degenerate denom
  // returns the unscaled numerator instead of NaN.
  let m2 = max(dot(b, b), 1e-100);
  return vec2f(
    (a.x * b.x + a.y * b.y) / m2,
    (a.y * b.x - a.x * b.y) / m2,
  );
}
fn complex_recip(z: vec2f) -> vec2f {
  let m2 = max(dot(z, z), 1e-100);
  return vec2f(z.x / m2, -z.y / m2);
}
// Exact complex sqrt — JWildfire formula. Avoids the trig path entirely
// (which would otherwise need safe_* wrappers). Returns the principal
// branch (re >= 0).
fn complex_sqrt(z: vec2f) -> vec2f {
  let rad = length(z);
  let sb = select(1.0, -1.0, z.y < 0.0);
  let re_out = sqrt(max(0.5 * (rad + z.x), 0.0));
  let im_out = sb * sqrt(max(0.5 * (rad - z.x), 0.0));
  return vec2f(re_out, im_out);
}
// Complex log = (log|z|, arg(z)). JWildfire's Mag2eps adds 1e-20 to
// tame z=0 → log(0). atan2(0,0) is implementation-defined but pyr3
// callers don't hit it.
fn complex_log(z: vec2f) -> vec2f {
  let mag2 = dot(z, z) + 1e-20;
  return vec2f(0.5 * log(mag2), atan2(z.y, z.x));
}

// #133 — complex exp / pow / sin. Foundational for V223 complex_gamma
// (uses all 3 + reflection branch) and V224 lambert_w (uses complex_exp
// inside Halley iteration). Im-axis arguments can grow large during
// intermediate computation (Γ reflection on negative-real-half inputs,
// Lambert W's log(log(z)) initial guess for large |z|) → safe_sin/cos
// dodge the Dawn f32 trig range cliff (#46/#72). Re-axis arg clamped to
// ±20 to keep exp() inside f32's ~1.18e38 cap with headroom.
fn complex_exp(z: vec2f) -> vec2f {
  let e = exp(clamp(z.x, -20.0, 20.0));
  return e * vec2f(safe_cos(z.y), safe_sin(z.y));
}

// complex pow: t^p = exp(p · log(t)). Principal branch (atan2 chooses
// arg in [-π, π]; complex_log's mag2 floor handles t = 0).
fn complex_pow(t: vec2f, p: vec2f) -> vec2f {
  return complex_exp(complex_mul(p, complex_log(t)));
}

// complex sin: sin(z) = (sin(x)·cosh(y), cos(x)·sinh(y)).
// cosh(y) and sinh(y) of large |y| grow exponentially in y → clamp Im
// to ±20 for numerical safety (e^20 ≈ 4.85e8, plenty of dynamic range
// for downstream computation without producing Inf or saturating f32).
fn complex_sin(z: vec2f) -> vec2f {
  let y = clamp(z.y, -20.0, 20.0);
  let ep = exp(y);
  let en = exp(-y);
  let ch = 0.5 * (ep + en);
  let sh = 0.5 * (ep - en);
  return vec2f(safe_sin(z.x) * ch, safe_cos(z.x) * sh);
}

// ---------------------------------------------------------------------------
// #131 — Modular / number-theory substrate.
// θ/λ/j live on the upper half-plane (Im τ > 0 ⟺ |q| = exp(−π·Im τ) < 1).
// The SL(2,ℤ) fractal structure crowds the real axis where the q-series
// diverges, so to_upper_half_plane folds the point up (abs) and lifts it off
// the axis by im_floor — the per-variation detail⇄convergence knob (spec D2).
// ---------------------------------------------------------------------------
fn to_upper_half_plane(p: vec2f, im_floor: f32) -> vec2f {
  let im = abs(p.y) + max(im_floor, 0.02);
  // Hard backstop: |q| ≤ 0.98 ⟺ Im τ ≥ −ln(0.98)/π ≈ 0.006435.
  return vec2f(p.x, max(im, 0.006435));
}

// Nome q = exp(iπτ). iπτ = π·(−τ.y, τ.x); |q| = exp(−π·τ.y) < 1 for τ.y > 0.
fn modular_nome(tau: vec2f) -> vec2f {
  return complex_exp(vec2f(-PI * tau.y, PI * tau.x));
}

// θ₃(q) = 1 + 2 Σ_{n≥1} q^(n²), 8 terms. q^(n²) by recurrence
// (q^((n+1)²) = q^(n²)·q^(2n+1)) → complex_mul-only, no per-term transcendentals.
fn theta3(q: vec2f) -> vec2f {
  let q2 = complex_sqr(q);            // q²
  var qn2 = q;                        // q^(1²)
  var odd = complex_mul(q2, q);       // q^(2·1+1) = q³
  var sum = qn2;
  for (var n = 2; n <= 8; n = n + 1) {
    qn2 = complex_mul(qn2, odd);      // q^(n²)
    sum = sum + qn2;
    odd = complex_mul(odd, q2);       // q^(2n+1)
  }
  return vec2f(1.0, 0.0) + 2.0 * sum;
}

// θ₄(q) = 1 + 2 Σ_{n≥1} (−1)^n q^(n²), 8 terms.
fn theta4(q: vec2f) -> vec2f {
  let q2 = complex_sqr(q);
  var qn2 = q;
  var odd = complex_mul(q2, q);
  var sum = -qn2;                     // n=1 → (−1)¹
  for (var n = 2; n <= 8; n = n + 1) {
    qn2 = complex_mul(qn2, odd);
    let s = select(-1.0, 1.0, (n & 1) == 0);  // +1 even n, −1 odd n
    sum = sum + s * qn2;
    odd = complex_mul(odd, q2);
  }
  return vec2f(1.0, 0.0) + 2.0 * sum;
}

// θ₂(q) = 2·q^(¼)·Σ_{n≥0} q^(n(n+1)), 8 terms. q^(n(n+1)) by recurrence
// (factor q^(2n+2) per step); one complex_pow for the q^(¼) prefactor.
fn theta2(q: vec2f) -> vec2f {
  let q2 = complex_sqr(q);
  var term = vec2f(1.0, 0.0);        // q^(0·1) = 1, n=0
  var ev = q2;                       // q^(2·0+2) = q², step factor 0→1
  var sum = term;
  for (var n = 1; n <= 7; n = n + 1) {
    term = complex_mul(term, ev);    // q^(n(n+1))
    sum = sum + term;
    ev = complex_mul(ev, q2);        // q^(2n+2)
  }
  let q14 = complex_pow(q, vec2f(0.25, 0.0));
  return 2.0 * complex_mul(q14, sum);
}

fn var_linear(p: vec2f, w: f32) -> vec2f {
  return p * w;
}

fn var_sinusoidal(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(safe_sin(p.x), safe_sin(p.y));
}

fn var_spherical(p: vec2f, w: f32) -> vec2f {
  let r2 = dot(p, p) + EPS;
  return p * (w / r2);
}

fn var_swirl(p: vec2f, w: f32) -> vec2f {
  let r2 = dot(p, p);
  let s = safe_sin(r2);
  let c = safe_cos(r2);
  return w * vec2f(s * p.x - c * p.y, c * p.x + s * p.y);
}

fn var_horseshoe(p: vec2f, w: f32) -> vec2f {
  let r = length(p) + EPS;
  return (w / r) * vec2f((p.x - p.y) * (p.x + p.y), 2.0 * p.x * p.y);
}

// flam3 marks polar / handkerchief / heart / disc / ex / julia / fan / blob /
// fan2 / disc2 with `precalc_atan_xy_flag = 1`, computed as `atan2(tx, ty)`.
// That's swapped-arg atan2 (x first) — it produces the angle measured from
// the +Y axis, NOT the standard +X axis. pyr3's WGSL must use `atan2(p.x, p.y)`
// to match. Using `atan2(p.y, p.x)` (standard) rotates the entire variation
// by 90°, producing a wireframe-grid attractor instead of flam3's filled cells.
// Surfaced 2026-05-09 while debugging Electric Sheep parity.
fn var_polar(p: vec2f, w: f32) -> vec2f {
  let phi = atan2(p.x, p.y);
  let r = length(p);
  return w * vec2f(phi / PI, r - 1.0);
}

fn var_handkerchief(p: vec2f, w: f32) -> vec2f {
  let phi = atan2(p.x, p.y);
  let r = length(p);
  return w * r * vec2f(safe_sin(phi + r), safe_cos(phi - r));
}

fn var_heart(p: vec2f, w: f32) -> vec2f {
  let phi = atan2(p.x, p.y);
  let r = length(p);
  return w * r * vec2f(safe_sin(phi * r), -safe_cos(phi * r));
}

fn var_disc(p: vec2f, w: f32) -> vec2f {
  // flam3 var8_disc uses precalc_atan_xy = atan2(tx, ty) — i.e. swapped
  // arg order vs the standard atan2(y, x). This rotates the disc nonlinearity
  // by 90° relative to the standard convention. (variations.c:264, flag set
  // via VAR_DISC → precalc_atan_xy_flag=1.)
  let phi = atan2(p.x, p.y);
  let r = length(p);
  return w * (phi / PI) * vec2f(safe_sin(PI * r), safe_cos(PI * r));
}

// flam3 spiral / hyperbolic / diamond use precalc_angles_flag = 1, computed
// as sina = tx / r, cosa = ty / r. This is the same 90° rotation as
// precalc_atan_xy (sin = x/r is the convention where angle is measured from
// the +Y axis, not +X). pyr3's `atan2(p.y, p.x)` followed by sin/cos gives
// the standard +X angle, which is WRONG for these variations.
fn var_spiral(p: vec2f, w: f32) -> vec2f {
  let r = length(p) + EPS;
  let sina = p.x / r;
  let cosa = p.y / r;
  return (w / r) * vec2f(cosa + safe_sin(r), sina - safe_cos(r));
}

fn var_hyperbolic(p: vec2f, w: f32) -> vec2f {
  let r = length(p) + EPS;
  let sina = p.x / r;
  let cosa = p.y / r;
  return w * vec2f(sina / r, r * cosa);
}

fn var_diamond(p: vec2f, w: f32) -> vec2f {
  let r = length(p) + EPS;
  let sina = p.x / r;
  let cosa = p.y / r;
  let r_orig = length(p);
  return w * vec2f(sina * safe_cos(r_orig), cosa * safe_sin(r_orig));
}

fn var_ex(p: vec2f, w: f32) -> vec2f {
  // flam3 ex uses precalc_atan_xy = atan2(tx, ty), see top-of-file comment.
  let phi = atan2(p.x, p.y);
  let r = length(p);
  let n0 = safe_sin(phi + r);
  let n1 = safe_cos(phi - r);
  let m0 = n0 * n0 * n0;
  let m1 = n1 * n1 * n1;
  return w * r * vec2f(m0 + m1, m0 - m1);
}

fn var_julia(p: vec2f, w: f32, wi: u32) -> vec2f {
  // flam3 julia uses precalc_atan_xy = atan2(tx, ty), see top-of-file comment.
  // Branch selection matches pyr3 chaos.comp:608 — bit-0 of one ISAAC draw,
  // NOT a >0.5 threshold on rand01. Both consume one ISAAC u32, but they
  // sample different bits (bit 0 vs bit 31 effectively after f32 cast), so
  // their branch outcomes diverge per walker even when ISAAC streams are in
  // sync. Mirror pyr3 GLSL exactly.
  let phi = atan2(p.x, p.y);
  let theta = phi * 0.5 + select(0.0, PI, (isaac_irand(wi) & 1u) == 1u);
  let r = sqrt(length(p));
  return w * r * vec2f(safe_cos(theta), safe_sin(theta));
}

fn var_julian(p: vec2f, w: f32, power: f32, dist: f32, wi: u32) -> vec2f {
  let r = length(p);
  let phi = atan2(p.y, p.x);
  let p_abs = abs(power);
  let n = floor(rand01(wi) * p_abs);
  let theta = (phi + TAU * n) / power;
  let new_r = w * pow(r, dist / power);
  return vec2f(new_r * safe_cos(theta), new_r * safe_sin(theta));
}

fn var_bent(p: vec2f, w: f32) -> vec2f {
  let x = select(p.x, p.x * 2.0, p.x < 0.0);
  let y = select(p.y, p.y * 0.5, p.y < 0.0);
  return w * vec2f(x, y);
}

fn var_waves(p: vec2f, w: f32, a0: vec4f, a1: vec4f) -> vec2f {
  let b = a0.y;
  let c = a0.z;
  let e = a1.y;
  let f = a1.z;
  return w * vec2f(
    p.x + b * safe_sin(p.y / (c * c + EPS)),
    p.y + e * safe_sin(p.x / (f * f + EPS)),
  );
}

fn var_fisheye(p: vec2f, w: f32) -> vec2f {
  let r = 2.0 / (length(p) + 1.0);
  return w * r * vec2f(p.y, p.x); // note: x/y swap is intentional (flam3 spec)
}

fn var_popcorn(p: vec2f, w: f32, a0: vec4f, a1: vec4f) -> vec2f {
  let c = a0.z;
  let f = a1.z;
  return w * vec2f(
    p.x + c * safe_sin(safe_tan(3.0 * p.y)),
    p.y + f * safe_sin(safe_tan(3.0 * p.x)),
  );
}

fn var_eyefish(p: vec2f, w: f32) -> vec2f {
  let r = 2.0 / (length(p) + 1.0);
  return w * r * p;
}

// var_bubble — flam3 var28_bubble (variations.c:671). Denominator
// 0.25*dot(p,p) + 1 is >= 1 for any finite p, so no EPS needed.
fn var_bubble(p: vec2f, w: f32) -> vec2f {
  let r = w / (0.25 * dot(p, p) + 1.0);
  return r * p;
}

// var_cylinder — flam3 var29_cylinder (variations.c:680). Pure:
// new_x = w*safe_sin(tx), new_y = w*ty. No singularities.
fn var_cylinder(p: vec2f, w: f32) -> vec2f {
  return vec2f(w * safe_sin(p.x), w * p.y);
}

// var_pdj — flam3 var24_pdj (variations.c:579-596). Pure: no rng, no atan2,
// no affine. Four params (pdj_a/b/c/d) — the first variation to consume
// pyr3's extended param seam (param2/param3 in addition to param0/param1
// via vars_extra). flam3 kernel verbatim:
//   nx1 = safe_cos(pdj_b * tx); nx2 = safe_sin(pdj_c * tx);
//   ny1 = safe_sin(pdj_a * ty); ny2 = safe_cos(pdj_d * ty);
//   out = w * (ny1 - nx1, nx2 - ny2)
fn var_pdj(p: vec2f, w: f32, pa: f32, pb: f32, pc: f32, pd: f32) -> vec2f {
  let nx1 = safe_cos(pb * p.x);
  let nx2 = safe_sin(pc * p.x);
  let ny1 = safe_sin(pa * p.y);
  let ny2 = safe_cos(pd * p.y);
  return w * vec2f(ny1 - nx1, nx2 - ny2);
}

// var_disc2 — flam3 var49_disc2 (variations.c:1054 kernel, :1977 precalc).
// Parametric (disc2_rot, disc2_twist). Uses precalc_atan_xy (swapped atan2 —
// see top-of-file angle-convention note). flam3 precomputes timespi / sinadd /
// cosadd once per xform in `disc2_precalc()`; pyr3 has no per-xform precalc
// hook so we inline the math. The WGSL compiler hoists invariant sub-exprs;
// per-iter cost is one cos + one sin + a handful of muls — dwarfed by the
// kernel's own sin/cos/atan2. Edge-scale branches (|twist| > 2*PI) match
// flam3 variations.c:1986-1996 byte-for-byte.
fn var_disc2(p: vec2f, w: f32, rot: f32, twist: f32) -> vec2f {
  let timespi = rot * PI;
  var cosadd = safe_cos(twist) - 1.0;
  var sinadd = safe_sin(twist);
  if (twist > TAU) {
    let k = 1.0 + twist - TAU;
    cosadd = cosadd * k;
    sinadd = sinadd * k;
  } else if (twist < -TAU) {
    let k = 1.0 + twist + TAU;
    cosadd = cosadd * k;
    sinadd = sinadd * k;
  }
  let t = timespi * (p.x + p.y);
  let sinr = safe_sin(t);
  let cosr = safe_cos(t);
  let r = (w * atan2(p.x, p.y)) / PI;
  return vec2f((sinr + cosadd) * r, (cosr + sinadd) * r);
}

// ---------------------------------------------------------------------
// Phase 9b Batch A — pure 0-param kernels (no rng, no affine reads).
// Each kernel mirrors the same-named ts_var_* in src/variations.ts.
// ---------------------------------------------------------------------

// var_exponential — flam3 var18_exponential (variations.c:452). No precalc flag.
//   dx = w * exp(tx - 1);  dy = PI * ty;  out = dx * (safe_cos(dy), safe_sin(dy))
// exp(tx-1) is unbounded as tx grows; for tx ≳ 24 the output exceeds the 1e10
// bad-value threshold and the chaos-game retry path reseeds — matches flam3.
fn var_exponential(p: vec2f, w: f32) -> vec2f {
  let dx = w * exp(p.x - 1.0);
  let dy = PI * p.y;
  return vec2f(dx * safe_cos(dy), dx * safe_sin(dy));
}

// var_power — flam3 var19_power (variations.c:472). Uses precalc_angles_flag:
// sina = tx/r, cosa = ty/r — the same 90°-rotated convention as spiral /
// hyperbolic / diamond. pyr3 modernization: single biased r (= length(p) + EPS)
// for both sina/cosa and the pow base; numerical diff vs flam3 at small r is
// ~1e-10, far below absEps=1e-6.
fn var_power(p: vec2f, w: f32) -> vec2f {
  let r = length(p) + EPS;
  let sina = p.x / r;
  let cosa = p.y / r;
  let k = w * pow(r, sina);
  return vec2f(k * cosa, k * sina);
}

// var_cosine — flam3 var20_cosine (variations.c:489). No precalc flag.
//   out = w * (safe_cos(PI*tx) * cosh(ty), -safe_sin(PI*tx) * sinh(ty))
fn var_cosine(p: vec2f, w: f32) -> vec2f {
  let a = p.x * PI;
  return w * vec2f(safe_cos(a) * cosh(p.y), -safe_sin(a) * sinh(p.y));
}

// var_tangent — flam3 var42_tangent (variations.c:885). No precalc flag.
//   out = w * (safe_sin(tx) / safe_cos(ty), safe_tan(ty))
// safe_cos(ty) ≈ 0 yields ±Inf; the chaos-game bad-value check reseeds — matches flam3.
fn var_tangent(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(safe_sin(p.x) / safe_cos(p.y), safe_tan(p.y));
}

// var_secant2 — flam3 var46_secant2 (variations.c:976). Uses precalc_sqrt only.
// Non-standard weight handling per flam3 comment: weight is BOTH folded into r
// (= w * length(p)) before cos AND multiplied onto the output. safe_cos(r) ≈ 0 at
// r = π/2 + kπ yields ±Inf which the chaos-game bad-value check reseeds —
// matches flam3 (flam3 also does not guard this).
fn var_secant2(p: vec2f, w: f32) -> vec2f {
  let r = w * length(p);
  let cr = safe_cos(r);
  let icr = 1.0 / cr;
  let y = select(w * (icr - 1.0), w * (icr + 1.0), cr < 0.0);
  return vec2f(w * p.x, y);
}

// var_cross — flam3 var48_cross (variations.c:1033). No precalc flag.
//   s = tx²-ty²;  r = w * sqrt(1 / (s² + EPS));  out = (tx, ty) * r
// Along the 45° diagonals (|tx| ≈ |ty|), s → 0 and r ≈ w * sqrt(1/EPS) ≈ 3.16e5.
// With typical |p|≲1, w≲1, output stays well under the 1e10 bad-value threshold;
// pathological large-w xforms can spike through and reseed — matches flam3.
fn var_cross(p: vec2f, w: f32) -> vec2f {
  let s = p.x * p.x - p.y * p.y;
  let r = w * sqrt(1.0 / (s * s + EPS));
  return p * r;
}

// ---------------------------------------------------------------------
// Phase 9b Batch B — 1-2 param kernels, no rng. rings/fan read affine c/f
// (same shape as waves/popcorn). All fit existing 2-param seam.
// ---------------------------------------------------------------------

// var_rings — flam3 var21_rings (variations.c:508). Reads affine c[2][0]
// (= pyr3 affine `c` = a0.z). Uses precalc_angles convention (sina=tx/r,
// cosa=ty/r). pyr3 modernization (per spiral precedent): single biased r.
fn var_rings(p: vec2f, w: f32, a0: vec4f, a1: vec4f) -> vec2f {
  let c = a0.z;
  let r0 = length(p);
  let r_eps = r0 + EPS;
  let sina = p.x / r_eps;
  let cosa = p.y / r_eps;
  let dx = c * c + EPS;
  let r = w * (((r0 + dx) % (2.0 * dx)) - dx + r0 * (1.0 - dx));
  return vec2f(r * cosa, r * sina);
}

// var_fan — flam3 var22_fan (variations.c:528). Reads affine c[2][0] / c[2][1]
// (= pyr3 affine `c` / `f` = a0.z / a1.z). Uses precalc_atan_xy (swapped atan2).
// `(phi+dy)/dx` can be negative — WGSL `trunc()` truncates toward zero,
// v0.13: mod semantics match C99 fmod (truncate-toward-zero). The prior
// `floor((phi+dy)/dx)` Euclidean mod (inherited from the old GLSL renderer)
// produced different folded angles than TS + the predecessor + flam3-C for negative
// `(phi+dy)`, breaking the FE↔BE same-machine parity contract. PYR3-010
// audit (v0.12 cluster C3) flagged this as the one confirmed `bug` across
// 98 arms. `trunc((phi+dy)/dx) * dx` is the WGSL equivalent of C fmod.
fn var_fan(p: vec2f, w: f32, a0: vec4f, a1: vec4f) -> vec2f {
  let c = a0.z;
  let f = a1.z;
  let dx = PI * (c * c + EPS);
  let dy = f;
  let dx2 = 0.5 * dx;
  let phi = atan2(p.x, p.y);
  let r = w * length(p);
  let t = (phi + dy) - dx * trunc((phi + dy) / dx);
  let a = select(phi + dx2, phi - dx2, t > dx2);
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// var_rings2 — flam3 var26_rings2 (variations.c:640). 1 param (rings2_val).
// Uses precalc_angles. Output uses (sina, cosa) — swap vs `rings`.
fn var_rings2(p: vec2f, w: f32, val: f32) -> vec2f {
  let r0 = length(p);
  let r_eps = r0 + EPS;
  let sina = p.x / r_eps;
  let cosa = p.y / r_eps;
  let dx = val * val + EPS;
  let r = r0 - 2.0 * dx * trunc((r0 + dx) / (2.0 * dx)) + r0 * (1.0 - dx);
  return w * r * vec2f(sina, cosa);
}

// var_fan2 — flam3 var25_fan2 (variations.c:598). 2 params (fan2_x, fan2_y).
// Uses precalc_atan_xy. Output uses (sin, cos) — swap vs `fan`.
fn var_fan2(p: vec2f, w: f32, fx: f32, fy: f32) -> vec2f {
  let phi = atan2(p.x, p.y);
  let r = w * length(p);
  let dy = fy;
  let dx = PI * (fx * fx + EPS);
  let dx2 = 0.5 * dx;
  let t = phi + dy - dx * trunc((phi + dy) / dx);
  let a = select(phi + dx2, phi - dx2, t > dx2);
  return vec2f(r * safe_sin(a), r * safe_cos(a));
}

// var_perspective — flam3 var30_perspective (variations.c:687). 2 params
// (perspective_angle, perspective_dist). flam3 precomputes `persp_vsin`
// and `persp_vfcos` per-xform; pyr3 inlines (no per-xform precalc hook —
// disc2 precedent). Per-iter cost is one sin + one cos, dwarfed by the
// kernel's own div + the chaos loop's overall trig cost.
fn var_perspective(p: vec2f, w: f32, angle: f32, dist: f32) -> vec2f {
  let half_pi_angle = angle * (PI * 0.5);
  let vsin = safe_sin(half_pi_angle);
  let vfcos = dist * safe_cos(half_pi_angle);
  let t = 1.0 / (dist - p.y * vsin);
  return w * vec2f(dist * p.x * t, vfcos * p.y * t);
}

// var_bipolar — flam3 var55_bipolar (variations.c:1180). 1 param (bipolar_shift).
// Note `M_2_PI` in C is `2/π`, NOT 2π. `(t+x2)/(t-x2)` can be ≤ 0;
// log goes NaN/Inf which the chaos-game retry path reseeds — matches flam3.
// The two `%` ops in the y-wrap branches operate on operands that are
// always positive on their entry path (`y > HALF_PI` → `y + HALF_PI > 0`;
// `y < -HALF_PI` → `HALF_PI - y > 0`), so WGSL `%` matches C `fmod` exactly.
fn var_bipolar(p: vec2f, w: f32, shift: f32) -> vec2f {
  let HALF_PI: f32 = PI * 0.5;
  let TWO_OVER_PI: f32 = 2.0 / PI;
  let x2y2 = dot(p, p);
  let t = x2y2 + 1.0;
  let x2 = 2.0 * p.x;
  let ps = -HALF_PI * shift;
  var y = 0.5 * atan2(2.0 * p.y, x2y2 - 1.0) + ps;
  if (y > HALF_PI) {
    y = -HALF_PI + ((y + HALF_PI) % PI);
  } else if (y < -HALF_PI) {
    y = HALF_PI - ((HALF_PI - y) % PI);
  }
  return vec2f(
    w * 0.25 * TWO_OVER_PI * log((t + x2) / (t - x2)),
    w * TWO_OVER_PI * y,
  );
}

// var_curl — flam3 var39_curl (variations.c:832). 2 params (curl_c1, curl_c2).
// Pure rational kernel — no precalc, no trig.
fn var_curl(p: vec2f, w: f32, c1: f32, c2: f32) -> vec2f {
  let re = 1.0 + c1 * p.x + c2 * (p.x * p.x - p.y * p.y);
  let im = c1 * p.y + 2.0 * c2 * p.x * p.y;
  let r = w / (re * re + im * im);
  return vec2f(
    (p.x * re + p.y * im) * r,
    (p.y * re - p.x * im) * r,
  );
}

// ---------------------------------------------------------------------
// Phase 9b Batch C — 3-4 param kernels consuming vars_extra (p2/p3).
// cpow uses RNG (same shape as julian — takes `wi`).
// ---------------------------------------------------------------------

// var_blob — flam3 var23_blob (variations.c:557). 3 params (blob_low,
// blob_high, blob_waves). Uses precalc_atan_xy (swapped atan2) + precalc_angles.
fn var_blob(p: vec2f, w: f32, low: f32, high: f32, waves: f32) -> vec2f {
  let r0 = length(p);
  let r_eps = r0 + EPS;
  let sina = p.x / r_eps;
  let cosa = p.y / r_eps;
  let a = atan2(p.x, p.y); // swapped (atan_xy)
  let r = r0 * (low + (high - low) * (0.5 + 0.5 * safe_sin(waves * a)));
  return w * r * vec2f(sina, cosa);
}

// var_ngon — flam3 var38_ngon (variations.c:811). 4 params (ngon_sides,
// ngon_power, ngon_circle, ngon_corners). Uses precalc_atanyx (STANDARD
// atan2(ty, tx)) — different from blob/wedge top-of-file convention.
//
// EPS placement matches flam3 verbatim: NOT inside the `pow` base (line 816:
// `r_factor = pow(precalc_sumsq, power/2.0)`) but in the denominator AFTER
// (line 826: `amp /= (r_factor + EPS)`). At p=0 with power<0 this yields
// finite/+Inf = 0 output on both sides; with power>0 it yields finite/EPS ≈
// 1e10 which the bad-value retry catches.
fn var_ngon(p: vec2f, w: f32, sides: f32, power: f32, circle: f32, corners: f32) -> vec2f {
  let sumsq = dot(p, p);
  let r_factor = pow(sumsq, power * 0.5);
  let theta = atan2(p.y, p.x); // standard (atan_yx)
  let b = TAU / sides;
  var phi = theta - b * floor(theta / b);
  if (phi > b * 0.5) { phi = phi - b; }
  let amp = (corners * (1.0 / (safe_cos(phi) + EPS) - 1.0) + circle) / (r_factor + EPS);
  return w * amp * p;
}

// var_wedge — flam3 var77_wedge (variations.c:1649). 4 params (wedge_angle,
// wedge_hole, wedge_count, wedge_swirl). Uses precalc_atanyx + precalc_sqrt.
fn var_wedge(p: vec2f, w: f32, angle: f32, hole: f32, count: f32, swirl: f32) -> vec2f {
  let r0 = length(p);
  var a = atan2(p.y, p.x) + swirl * r0;
  let ONE_OVER_PI: f32 = 1.0 / PI;
  let c = floor((count * a + PI) * ONE_OVER_PI * 0.5);
  let comp_fac = 1.0 - angle * count * ONE_OVER_PI * 0.5;
  a = a * comp_fac + c * angle;
  let r = w * (r0 + hole);
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// var_cpow — flam3 var59_cpow (variations.c:1291). 3 params (cpow_r, cpow_i,
// cpow_power) + RNG. Uses precalc_atanyx (standard) + precalc_sumsq. RNG path:
// `n = floor(|cpow_power| * rand01())` — same shape as julian.
//
// flam3 uses `floor(cpow_power * rand)` (signed) which for negative power
// produces n ∈ {0, -1, ..., -(P-1)}; pyr3 uses |power| which produces
// {0, 1, ..., P-1}. Both yield the same set of P distinct angles in [0, 2π)
// (the va=2π/power factor is signed in both), each with probability 1/P —
// statistically identical for the chaos-game renderer. The TS reference impl
// takes randBranch directly from the caller so the harness sweeps all n values.
//
// At p=0: sumsq=0 → lnr=-Inf → ang=±Inf (when vd≠0) → sin/safe_cos(±Inf)=NaN; or
// m=0 when vc<0; either way the bad-value check reseeds.
fn var_cpow(p: vec2f, w: f32, cpow_r: f32, cpow_i: f32, cpow_power: f32, wi: u32) -> vec2f {
  let a = atan2(p.y, p.x);
  let sumsq = dot(p, p);
  let lnr = 0.5 * log(sumsq);
  let va = TAU / cpow_power;
  let vc = cpow_r / cpow_power;
  let vd = cpow_i / cpow_power;
  let n = floor(rand01(wi) * abs(cpow_power));
  let ang = vc * a + vd * lnr + va * n;
  let m = w * exp(vc * lnr - vd * a);
  return vec2f(m * safe_cos(ang), m * safe_sin(ang));
}

// var_curve — flam3 var60_curve (variations.c:1312). 4 params (curve_xamp,
// curve_yamp, curve_xlength, curve_ylength). Gaussian-falloff perturbation
// on each axis. flam3 clamps xlength²/ylength² to 1e-20 minimum.
fn var_curve(p: vec2f, w: f32, xamp: f32, yamp: f32, xlen: f32, ylen: f32) -> vec2f {
  let pc_xlen = max(xlen * xlen, 1e-20);
  let pc_ylen = max(ylen * ylen, 1e-20);
  return w * vec2f(
    p.x + xamp * exp((-p.y * p.y) / pc_xlen),
    p.y + yamp * exp((-p.x * p.x) / pc_ylen),
  );
}

// var_rectangles — flam3 var40_rectangles (variations.c:843). 2 params
// (rectangles_x, rectangles_y). Pass-through on axis where param is 0.
//
// WGSL `select(false, true, cond)` evaluates BOTH branches before selecting —
// when rx==0, the false-branch's `floor(p.x / 0.0)` would produce ±Inf and
// downstream NaN. Even though `select` discards it on conformant hardware,
// the kernel pre-clamps the divisor (`rx_safe = select(rx, 1.0, rx==0)`) so
// the false branch is always finite regardless of compiler / driver blend
// ordering. flam3's `if/else` short-circuits naturally and has no equivalent.
fn var_rectangles(p: vec2f, w: f32, rx: f32, ry: f32) -> vec2f {
  let rx_safe = select(rx, 1.0, rx == 0.0);
  let ry_safe = select(ry, 1.0, ry == 0.0);
  let ox = select(
    w * ((2.0 * floor(p.x / rx_safe) + 1.0) * rx_safe - p.x),
    w * p.x,
    rx == 0.0,
  );
  let oy = select(
    w * ((2.0 * floor(p.y / ry_safe) + 1.0) * ry_safe - p.y),
    w * p.y,
    ry == 0.0,
  );
  return vec2f(ox, oy);
}

// ---------------------------------------------------------------------
// Phase 9b Batch D — RNG-using kernels. All take `wi` for `rand01(wi)`.
// juliascope mirrors julian's discrete-branch RNG; the others use 1-4
// continuous rand calls.
// ---------------------------------------------------------------------

// var_noise — flam3 var31_noise (variations.c:696). 0 params + 2 rand calls.
//   tmpr = rand0 * 2π;  r = w * rand1;  out = (tx, ty) * r * (safe_cos(tmpr), safe_sin(tmpr))
fn var_noise(p: vec2f, w: f32, wi: u32) -> vec2f {
  let tmpr = rand01(wi) * TAU;
  let r = w * rand01(wi);
  return vec2f(p.x * r * safe_cos(tmpr), p.y * r * safe_sin(tmpr));
}

// var_blur — flam3 var34_blur (variations.c:746). 0 params + 2 rand calls.
// Like noise but output is just (r*cos, r*sin) — uniform disc of radius w.
fn var_blur(p: vec2f, w: f32, wi: u32) -> vec2f {
  let tmpr = rand01(wi) * TAU;
  let r = w * rand01(wi);
  return vec2f(r * safe_cos(tmpr), r * safe_sin(tmpr));
}

// var_gaussian_blur — flam3 var35_gaussian (variations.c:760). 0 params +
// 5 rand calls (1 for angle, 4 for the pseudo-Gaussian sum). Sum of 4 uniform
// [0,1) minus 2.0 approximates a Gaussian via central limit theorem.
//
// WGSL §10.3 does NOT guarantee left-to-right operand evaluation order for
// chained binary ops, so `rand01(wi) + rand01(wi) + ...` could call ISAAC
// in any order on a conformant compiler. The sum is commutative so visual
// output is fine, but ISAAC stream state after the call would differ from
// flam3's left-to-right C order. Captured into sequential `let` bindings to
// guarantee order (matters when rand-capture test infra ships — BACKLOG).
fn var_gaussian_blur(p: vec2f, w: f32, wi: u32) -> vec2f {
  let ang = rand01(wi) * TAU;
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let r3 = rand01(wi);
  let r = w * (r0 + r1 + r2 + r3 - 2.0);
  return vec2f(r * safe_cos(ang), r * safe_sin(ang));
}

// var_arch — flam3 var41_arch (variations.c:857). 0 params + 1 rand call.
// Non-standard weight handling (flam3 comment). safe_cos(ang) ≈ 0 produces ±Inf
// which the chaos-game retry path reseeds — matches flam3.
fn var_arch(p: vec2f, w: f32, wi: u32) -> vec2f {
  let ang = rand01(wi) * w * PI;
  let sinr = safe_sin(ang);
  let cosr = safe_cos(ang);
  return vec2f(w * sinr, w * (sinr * sinr) / cosr);
}

// var_radial_blur — flam3 var36_radial_blur (variations.c:775). 1 param
// (radial_blur_angle) + 4 rand calls. flam3 precomputes
// `radialBlur_spinvar = safe_sin(angle * π/2)` and `radialBlur_zoomvar = safe_cos(angle * π/2)`
// per-xform; pyr3 inlines (disc2 / perspective precedent).
//
// Same WGSL eval-order guard as gaussian_blur — captured `let` bindings
// force left-to-right ISAAC stream order.
fn var_radial_blur(p: vec2f, w: f32, angle: f32, wi: u32) -> vec2f {
  let half_pi_angle = angle * (PI * 0.5);
  let spinvar = safe_sin(half_pi_angle);
  let zoomvar = safe_cos(half_pi_angle);
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let r3 = rand01(wi);
  let rndG = w * (r0 + r1 + r2 + r3 - 2.0);
  let ra = length(p);
  let tmpa = atan2(p.y, p.x) + spinvar * rndG;
  let sa = safe_sin(tmpa);
  let ca = safe_cos(tmpa);
  let rz = zoomvar * rndG - 1.0;
  return vec2f(ra * ca + rz * p.x, ra * sa + rz * p.y);
}

// var_juliascope — flam3 var33_juliaScope (variations.c:725). 2 params
// (juliascope_power, juliascope_dist) + RNG. Like julian (V=14) but the
// parity of t_rnd flips the sign on precalc_atanyx. Same `abs(power)` mod-2π
// equivalence as cpow (see V=41 kernel comment) — pyr3 uses |power| for branch
// range; flam3 uses signed power; the set of distinct angles is identical mod 2π.
fn var_juliascope(p: vec2f, w: f32, power: f32, dist: f32, wi: u32) -> vec2f {
  let phi = atan2(p.y, p.x);
  let sumsq = dot(p, p);
  let p_abs = abs(power);
  let t_rnd = i32(floor(rand01(wi) * p_abs));
  let tmpr = select(
    (TAU * f32(t_rnd) - phi) / power,
    (TAU * f32(t_rnd) + phi) / power,
    (t_rnd & 1) == 0,
  );
  let r = w * pow(sumsq, dist / power / 2.0);
  return vec2f(r * safe_cos(tmpr), r * safe_sin(tmpr));
}

// var_square — flam3 var43_square (variations.c:900). 0 params + 2 rand calls.
// Generates a point in [-w/2, w/2]² independent of input position.
//
// Same WGSL §10.3 eval-order guard as gaussian_blur/radial_blur — captured
// `let` bindings force left-to-right ISAAC stream order.
fn var_square(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  return vec2f(w * (r0 - 0.5), w * (r1 - 0.5));
}

// var_rays — flam3 var44_rays (variations.c:915). 0 params + 1 rand call.
// Non-standard weight handling.
fn var_rays(p: vec2f, w: f32, wi: u32) -> vec2f {
  let ang = w * rand01(wi) * PI;
  let sumsq = dot(p, p);
  let r = w / (sumsq + EPS);
  let tanr = w * safe_tan(ang) * r;
  return vec2f(tanr * safe_cos(p.x), tanr * safe_sin(p.y));
}

// var_blade — flam3 var45_blade (variations.c:946). 0 params + 1 rand call.
// Non-standard weight handling. Both x and y output use `p.x` (not `p.y`) —
// that's flam3's actual behavior at lines 971-972, not a typo.
fn var_blade(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r = rand01(wi) * w * length(p);
  let sinr = safe_sin(r);
  let cosr = safe_cos(r);
  return vec2f(w * p.x * (cosr + sinr), w * p.x * (cosr - sinr));
}

// var_twintrian — flam3 var47_twintrian (variations.c:998). 0 params + 1
// rand call. log10(sin²) can be -Inf; flam3's own badvalue check clamps
// `diff = -30` (variations.c:1025-1026) — pyr3 mirrors that clamp. Both x
// and y output use `p.x` (intentional per flam3).
fn var_twintrian(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r = rand01(wi) * w * length(p);
  let sinr = safe_sin(r);
  let cosr = safe_cos(r);
  var diff = log(sinr * sinr) / LN10 + cosr; // log10 = ln / ln(10)
  // flam3 private.h:22 badvalue check.
  if (diff != diff || diff > 1e10 || diff < -1e10) { diff = -30.0; }
  return vec2f(w * p.x * diff, w * p.x * (diff - sinr * PI));
}

// ---------------------------------------------------------------------
// Phase 9b Batch E — 14 transcendental kernels (flam3 var82..95). All
// 0-param, no RNG, no affine. log uses standard atan2(p.y, p.x) +
// length²(p). Distinct from V=1 sinusoidal / V=24 exponential / V=26
// cosine / V=27 tangent which use different (multiplied-by-PI) kernels.
// ---------------------------------------------------------------------

fn var_exp(p: vec2f, w: f32) -> vec2f {
  let e = exp(p.x);
  return w * e * vec2f(safe_cos(p.y), safe_sin(p.y));
}

fn var_log(p: vec2f, w: f32) -> vec2f {
  let sumsq = dot(p, p);
  return w * vec2f(0.5 * log(sumsq), atan2(p.y, p.x));
}

fn var_sin(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(safe_sin(p.x) * cosh(p.y), safe_cos(p.x) * sinh(p.y));
}

fn var_cos(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(safe_cos(p.x) * cosh(p.y), -safe_sin(p.x) * sinh(p.y));
}

fn var_tan(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (safe_cos(2.0 * p.x) + cosh(2.0 * p.y));
  return w * den * vec2f(safe_sin(2.0 * p.x), sinh(2.0 * p.y));
}

fn var_sec(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (safe_cos(2.0 * p.x) + cosh(2.0 * p.y));
  return w * den * vec2f(safe_cos(p.x) * cosh(p.y), safe_sin(p.x) * sinh(p.y));
}

fn var_csc(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (cosh(2.0 * p.y) - safe_cos(2.0 * p.x));
  return w * den * vec2f(safe_sin(p.x) * cosh(p.y), -safe_cos(p.x) * sinh(p.y));
}

fn var_cot(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (cosh(2.0 * p.y) - safe_cos(2.0 * p.x));
  return w * den * vec2f(safe_sin(2.0 * p.x), -sinh(2.0 * p.y));
}

fn var_sinh(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(sinh(p.x) * safe_cos(p.y), cosh(p.x) * safe_sin(p.y));
}

fn var_cosh(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(cosh(p.x) * safe_cos(p.y), sinh(p.x) * safe_sin(p.y));
}

fn var_tanh(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (safe_cos(2.0 * p.y) + cosh(2.0 * p.x));
  return w * den * vec2f(sinh(2.0 * p.x), safe_sin(2.0 * p.y));
}

fn var_sech(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (safe_cos(2.0 * p.y) + cosh(2.0 * p.x));
  return w * den * vec2f(safe_cos(p.y) * cosh(p.x), -safe_sin(p.y) * sinh(p.x));
}

fn var_csch(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (cosh(2.0 * p.x) - safe_cos(2.0 * p.y));
  return w * den * vec2f(sinh(p.x) * safe_cos(p.y), -cosh(p.x) * safe_sin(p.y));
}

fn var_coth(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (cosh(2.0 * p.x) - safe_cos(2.0 * p.y));
  return w * den * vec2f(sinh(2.0 * p.x), safe_sin(2.0 * p.y));
}


// ---------------------------------------------------------------------
// Phase 9b Batch F — 0-param non-RNG kernels (flam3 var57/61/62/64/66/70/72).
// ---------------------------------------------------------------------

fn var_butterfly(p: vec2f, w: f32) -> vec2f {
  // wx = w * 4/sqrt(3*pi). flam3 inlines this constant verbatim.
  let wx = w * 1.3029400317411197908970256609023;
  let y2 = p.y * 2.0;
  let r = wx * sqrt(abs(p.y * p.x) / (EPS + p.x * p.x + y2 * y2));
  return vec2f(r * p.x, r * y2);
}

fn var_edisc(p: vec2f, w: f32) -> vec2f {
  // Mathematically xmax >= 1 and |p.x/xmax| <= 1, but f32 rounding can briefly
  // violate either by one ULP near the origin. clamp(acos input) + max(sqrt
  // argument, 0) keep the kernel finite — wgsl-shader-reviewer fix from Batch F.
  let sumsq = dot(p, p);
  let tmp = sumsq + 1.0;
  let tmp2 = 2.0 * p.x;
  let r1 = sqrt(tmp + tmp2);
  let r2 = sqrt(tmp - tmp2);
  let xmax = (r1 + r2) * 0.5;
  let a1 = log(xmax + sqrt(max(xmax - 1.0, 0.0)));
  let a2 = -acos(clamp(p.x / xmax, -1.0, 1.0));
  let wn = w / 11.57034632;
  let csv = safe_cos(a1);
  let snv = select(safe_sin(a1), -safe_sin(a1), p.y > 0.0);
  let snhu = sinh(a2);
  let cshu = cosh(a2);
  return vec2f(wn * cshu * csv, wn * snhu * snv);
}

fn var_elliptic(p: vec2f, w: f32) -> vec2f {
  // WGSL `select` evaluates both branches — `sqrt(negative)` produces NaN
  // intermediate even on the unused side, which some Metal/D3D12 driver
  // paths can contaminate the selected lane via fused-select lowering.
  // Pre-clamp via max(..., 0.0) so sqrt is always finite — same pattern as
  // var_rectangles' rx_safe guard from Batch B. wgsl-shader-reviewer fix.
  let sumsq = dot(p, p);
  let tmp = sumsq + 1.0;
  let x2 = 2.0 * p.x;
  let xmax = 0.5 * (sqrt(tmp + x2) + sqrt(tmp - x2));
  let a = p.x / xmax;
  let b_raw = 1.0 - a * a;
  let ssx_raw = xmax - 1.0;
  let b = sqrt(max(b_raw, 0.0));
  let ssx = sqrt(max(ssx_raw, 0.0));
  let wn = w / (PI * 0.5);
  let yLog = wn * log(xmax + ssx);
  return vec2f(wn * atan2(a, b), select(-yLog, yLog, p.y > 0.0));
}

fn var_foci(p: vec2f, w: f32) -> vec2f {
  let expx = exp(p.x) * 0.5;
  let expnx = 0.25 / expx;
  let tmp = w / (expx + expnx - safe_cos(p.y));
  return vec2f(tmp * (expx - expnx), tmp * safe_sin(p.y));
}

fn var_loonie(p: vec2f, w: f32) -> vec2f {
  let r2 = dot(p, p);
  let w2 = w * w;
  // Branch: if r²<w², expand radially; else, pass-through with weight.
  if (r2 < w2) {
    let r = w * sqrt(w2 / r2 - 1.0);
    return r * p;
  }
  return w * p;
}

fn var_polar2(p: vec2f, w: f32) -> vec2f {
  let sumsq = dot(p, p);
  let p2v = w / PI;
  // Uses precalc_atan_xy (SWAPPED) — atan2(p.x, p.y).
  // EPS guard on log matches pyr3 chaos.comp:1590 — without it, walkers
  // near origin produce log(0) = -∞ (or extreme negatives), splatting to
  // ±∞ y-coords. Critical when polar2 is used as a finalxform (applied
  // to every splat), as in fixture 248.31324.
  return vec2f(p2v * atan2(p.x, p.y), (p2v * 0.5) * log(sumsq + EPS));
}

fn var_scry(p: vec2f, w: f32) -> vec2f {
  // Non-standard weight handling per flam3 comment.
  let sumsq = dot(p, p);
  let sqrtSumsq = sqrt(sumsq);
  let r = 1.0 / (sqrtSumsq * (sumsq + 1.0 / (w + EPS)));
  return p * r;
}

// ---------------------------------------------------------------------
// Phase 9b Batch G — 1-2 param non-RNG kernels.
// ---------------------------------------------------------------------

// var_bent2 — flam3 var54_bent2 (variations.c:1164). 2 params (x, y).
fn var_bent2(p: vec2f, w: f32, bx: f32, by: f32) -> vec2f {
  let nx = select(p.x, p.x * bx, p.x < 0.0);
  let ny = select(p.y, p.y * by, p.y < 0.0);
  return w * vec2f(nx, ny);
}

// var_cell — flam3 var58_cell (variations.c:1253). 1 param (size). flam3 uses
// `p1 -=` on y output. WGSL `floor()` matches C floor exactly.
fn var_cell(p: vec2f, w: f32, size: f32) -> vec2f {
  let inv = 1.0 / size;
  var x = i32(floor(p.x * inv));
  var y = i32(floor(p.y * inv));
  let dx = p.x - f32(x) * size;
  let dy = p.y - f32(y) * size;
  if (y >= 0) {
    if (x >= 0) { y = y * 2; x = x * 2; }
    else { y = y * 2; x = -(2 * x + 1); }
  } else {
    if (x >= 0) { y = -(2 * y + 1); x = x * 2; }
    else { y = -(2 * y + 1); x = -(2 * x + 1); }
  }
  return vec2f(
    w * (dx + f32(x) * size),
    -w * (dy + f32(y) * size),
  );
}

// var_escher — flam3 var63_escher (variations.c:1385). 1 param (beta).
// Uses precalc_atanyx + precalc_sumsq. Similar shape to cpow but no RNG.
// log(0) → -Inf at origin; retry path catches.
fn var_escher(p: vec2f, w: f32, beta: f32) -> vec2f {
  let a = atan2(p.y, p.x);
  let sumsq = dot(p, p);
  let lnr = 0.5 * log(sumsq);
  let seb = safe_sin(beta);
  let ceb = safe_cos(beta);
  let vc = 0.5 * (1.0 + ceb);
  let vd = 0.5 * seb;
  let m = w * exp(vc * lnr - vd * a);
  let n = vc * a + vd * lnr;
  return vec2f(m * safe_cos(n), m * safe_sin(n));
}

// var_modulus — flam3 var68_modulus (variations.c:1498). 2 params.
// Periodic clamp via `%` (matches C fmod for positive operands; pyr3 guarantees
// positive by the `tx > mx` / `tx < -mx` branch entry conditions).
fn var_modulus(p: vec2f, w: f32, mx: f32, my: f32) -> vec2f {
  let xr = 2.0 * mx;
  let yr = 2.0 * my;
  var outX: f32;
  if (p.x > mx) { outX = w * (-mx + ((p.x + mx) % xr)); }
  else if (p.x < -mx) { outX = w * (mx - ((mx - p.x) % xr)); }
  else { outX = w * p.x; }
  var outY: f32;
  if (p.y > my) { outY = w * (-my + ((p.y + my) % yr)); }
  else if (p.y < -my) { outY = w * (my - ((my - p.y) % yr)); }
  else { outY = w * p.y; }
  return vec2f(outX, outY);
}

// var_split — flam3 var74_split (variations.c:1603). 2 params.
// Note flam3's swap: output y reads safe_cos(tx*xsize*π), output x reads safe_cos(ty*ysize*π).
fn var_split(p: vec2f, w: f32, xs: f32, ys: f32) -> vec2f {
  let outY = select(-w * p.y, w * p.y, safe_cos(p.x * xs * PI) >= 0.0);
  let outX = select(-w * p.x, w * p.x, safe_cos(p.y * ys * PI) >= 0.0);
  return vec2f(outX, outY);
}

// var_splits — flam3 var75_splits (variations.c:1619). 2 params.
fn var_splits(p: vec2f, w: f32, sx: f32, sy: f32) -> vec2f {
  let outX = select(w * (p.x - sx), w * (p.x + sx), p.x >= 0.0);
  let outY = select(w * (p.y - sy), w * (p.y + sy), p.y >= 0.0);
  return vec2f(outX, outY);
}

// var_stripes — flam3 var76_stripes (variations.c:1635). 2 params (space, warp).
fn var_stripes(p: vec2f, w: f32, space: f32, warp: f32) -> vec2f {
  let roundx = floor(p.x + 0.5);
  let offsetx = p.x - roundx;
  return vec2f(
    w * (offsetx * (1.0 - space) + roundx),
    w * (p.y + offsetx * offsetx * warp),
  );
}

// var_whorl — flam3 var80_whorl (variations.c:1710). 2 params. Non-standard weight.
// At r==w, 1/(w-r) → ±Inf → retry catches. Matches flam3's unguarded behavior.
fn var_whorl(p: vec2f, w: f32, inside: f32, outside: f32) -> vec2f {
  let r = length(p);
  let baseAng = atan2(p.y, p.x);
  let a = select(
    baseAng + outside / (w - r),
    baseAng + inside / (w - r),
    r < w,
  );
  return vec2f(w * r * safe_cos(a), w * r * safe_sin(a));
}

// var_flux — flam3 var97_flux (variations.c:1911). 1 param (flux_spread).
// Double-sqrt + atan2-difference.
fn var_flux(p: vec2f, w: f32, spread: f32) -> vec2f {
  let xpw = p.x + w;
  let xmw = p.x - w;
  let tysq = p.y * p.y;
  let avgr = w * (2.0 + spread) * sqrt(sqrt(tysq + xpw * xpw) / sqrt(tysq + xmw * xmw));
  let avga = (atan2(p.y, xmw) - atan2(p.y, xpw)) * 0.5;
  return vec2f(avgr * safe_cos(avga), avgr * safe_sin(avga));
}


// ---------------------------------------------------------------------
// Phase 9b Batch H — 3-4-param non-RNG kernels.
// ---------------------------------------------------------------------

fn var_popcorn2(p: vec2f, w: f32, px: f32, py: f32, pc: f32) -> vec2f {
  return w * vec2f(
    p.x + px * safe_sin(safe_tan(p.y * pc)),
    p.y + py * safe_sin(safe_tan(p.x * pc)),
  );
}

// 5 params: lx, ly, spin, twist, space. Branches on r < weight.
fn var_lazysusan(p: vec2f, w: f32, lx: f32, ly: f32, spin: f32, twist: f32, space: f32) -> vec2f {
  let x = p.x - lx;
  let y = p.y + ly;
  let r0 = length(vec2f(x, y));
  if (r0 < w) {
    let a = atan2(y, x) + spin + twist * (w - r0);
    let r = w * r0;
    return vec2f(r * safe_cos(a) + lx, r * safe_sin(a) - ly);
  }
  let r = w * (1.0 + space / r0);
  return vec2f(r * x + lx, r * y - ly);
}

fn var_waves2(p: vec2f, w: f32, sx: f32, fx: f32, sy: f32, fy: f32) -> vec2f {
  return w * vec2f(p.x + sx * safe_sin(p.y * fx), p.y + sy * safe_sin(p.x * fy));
}

// flam3 uses `p1 -=` inside the envelope (|ty|<=t).
fn var_oscope(p: vec2f, w: f32, freq: f32, amp: f32, damping: f32, sep: f32) -> vec2f {
  let tpf = TAU * freq;
  let t = select(
    amp * exp(-abs(p.x) * damping) * safe_cos(tpf * p.x) + sep,
    amp * safe_cos(tpf * p.x) + sep,
    damping == 0.0,
  );
  if (abs(p.y) <= t) { return vec2f(w * p.x, -w * p.y); }
  return w * p;
}

fn var_separation(p: vec2f, w: f32, sx: f32, sxi: f32, sy: f32, syi: f32) -> vec2f {
  let sx2 = sx * sx;
  let sy2 = sy * sy;
  let outX = select(
    -w * (sqrt(p.x * p.x + sx2) + p.x * sxi),
    w * (sqrt(p.x * p.x + sx2) - p.x * sxi),
    p.x > 0.0,
  );
  let outY = select(
    -w * (sqrt(p.y * p.y + sy2) + p.y * syi),
    w * (sqrt(p.y * p.y + sy2) - p.y * syi),
    p.y > 0.0,
  );
  return vec2f(outX, outY);
}

// 4 params (freq, ww=auger_weight, scale, sym). ww is a kernel param, distinct
// from the kernel's `w` weight scalar.
fn var_auger(p: vec2f, w: f32, freq: f32, ww: f32, scale: f32, sym: f32) -> vec2f {
  let s = safe_sin(freq * p.x);
  let t = safe_sin(freq * p.y);
  let dy = p.y + ww * (scale * s * 0.5 + abs(p.y) * s);
  let dx = p.x + ww * (scale * t * 0.5 + abs(p.x) * t);
  return vec2f(
    w * (p.x + sym * (dx - p.x)),
    w * dy,
  );
}

// Like wedge but uses 1/(r+EPS) for the radial.
fn var_wedge_sph(p: vec2f, w: f32, angle: f32, hole: f32, count: f32, swirl: f32) -> vec2f {
  let r0 = length(p);
  let r_inv = 1.0 / (r0 + EPS);
  var a = atan2(p.y, p.x) + swirl * r_inv;
  let ONE_OVER_PI: f32 = 1.0 / PI;
  let c = floor((count * a + PI) * ONE_OVER_PI * 0.5);
  let comp_fac = 1.0 - angle * count * ONE_OVER_PI * 0.5;
  a = a * comp_fac + c * angle;
  let r = w * (r_inv + hole);
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}


// ---------------------------------------------------------------------
// Phase 9b Batch I — RNG-using 3-4 param kernels (flam3 var37/50-53/56/78).
// All call rand01(wi). super_shape uses 1 rand; flower/conic 1 rand;
// parabola 2 rand; pie 3 rand; boarders 1 rand; wedge_julia 1 rand
// (discrete-branch — same shape as julian).
// ---------------------------------------------------------------------

// super_shape — flam3 var50_supershape (variations.c:1092). 6 params + RNG.
// flam3 precomputes pm_4 = m/4 and pneg1_n1 = -1/n1 per-xform; pyr3 inlines.
fn var_super_shape(p: vec2f, w: f32, rnd: f32, m: f32, n1: f32, n2: f32, n3: f32, holes: f32, wi: u32) -> vec2f {
  let pm_4 = m * 0.25;
  let pneg1_n1 = -1.0 / n1;
  let r0 = length(p);
  let theta = pm_4 * atan2(p.y, p.x) + PI * 0.25;
  let st = safe_sin(theta);
  let ct = safe_cos(theta);
  let t1 = pow(abs(ct), n2);
  let t2 = pow(abs(st), n3);
  let r = w * ((rnd * rand01(wi) + (1.0 - rnd) * r0) - holes) * pow(t1 + t2, pneg1_n1) / r0;
  return r * p;
}

// flower — flam3 var51_flower (variations.c:1118). 2 params + RNG.
fn var_flower(p: vec2f, w: f32, petals: f32, holes: f32, wi: u32) -> vec2f {
  let theta = atan2(p.y, p.x);
  let r0 = length(p);
  let r = w * (rand01(wi) - holes) * safe_cos(petals * theta) / r0;
  return r * p;
}

// conic — flam3 var52_conic (variations.c:1133). 2 params + RNG.
fn var_conic(p: vec2f, w: f32, ecc: f32, holes: f32, wi: u32) -> vec2f {
  let r0 = length(p);
  let ct = p.x / r0;
  let r = w * (rand01(wi) - holes) * ecc / (1.0 + ecc * ct) / r0;
  return r * p;
}

// parabola — flam3 var53_parabola (variations.c:1148). 2 params + 2 RNG.
// Captured to sequential `let r0, r1 = rand01(wi)` to force ISAAC stream order
// (WGSL §10.3 doesn't guarantee operand-eval order for binary ops).
fn var_parabola(p: vec2f, w: f32, height: f32, width: f32, wi: u32) -> vec2f {
  let r = length(p);
  let sr = safe_sin(r);
  let cr = safe_cos(r);
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  return vec2f(
    height * w * sr * sr * r0,
    width * w * cr * r1,
  );
}

// pie — flam3 var37_pie (variations.c:795). 3 params + 3 RNG.
fn var_pie(p: vec2f, w: f32, slices: f32, rotation: f32, thickness: f32, wi: u32) -> vec2f {
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let sl = trunc(r0 * slices + 0.5);
  let a = rotation + TAU * (sl + r1 * thickness) / slices;
  let r = w * r2;
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// boarders — flam3 var56_boarders (variations.c:1199). 0 params + 1 RNG.
// Complex branching on offset ratios. WGSL `round` doesn't exist as half-to-even;
// pyr3 uses `floor(x + 0.5)` (half-up), differs from flam3's `rint` only at
// exact half-integers — measure-zero edge case.
fn var_boarders(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r0 = rand01(wi);
  let roundX = floor(p.x + 0.5);
  let roundY = floor(p.y + 0.5);
  let offsetX = p.x - roundX;
  let offsetY = p.y - roundY;
  if (r0 >= 0.75) {
    return vec2f(w * (offsetX * 0.5 + roundX), w * (offsetY * 0.5 + roundY));
  }
  if (abs(offsetX) >= abs(offsetY)) {
    if (offsetX >= 0.0) {
      return vec2f(w * (offsetX * 0.5 + roundX + 0.25), w * (offsetY * 0.5 + roundY + 0.25 * offsetY / offsetX));
    }
    return vec2f(w * (offsetX * 0.5 + roundX - 0.25), w * (offsetY * 0.5 + roundY - 0.25 * offsetY / offsetX));
  }
  if (offsetY >= 0.0) {
    return vec2f(w * (offsetX * 0.5 + roundX + offsetX / offsetY * 0.25), w * (offsetY * 0.5 + roundY + 0.25));
  }
  return vec2f(w * (offsetX * 0.5 + roundX - offsetX / offsetY * 0.25), w * (offsetY * 0.5 + roundY - 0.25));
}

// ---------------------------------------------------------------------
// Phase 9b Batch K — mobius (flam3 var98_mobius). 8 params; first kernel
// to consume the vars_extra2 slot (param6, param7).
// ---------------------------------------------------------------------

// var_mobius — flam3 var98_mobius (variations.c:1923). 8 complex coefficients
// re_a / im_a / re_b / im_b / re_c / im_c / re_d / im_d.
// Computes Möbius transform: out = w · (a·p + b) / (c·p + d) in complex math.
fn var_mobius(p: vec2f, w: f32, re_a: f32, im_a: f32, re_b: f32, im_b: f32, re_c: f32, im_c: f32, re_d: f32, im_d: f32) -> vec2f {
  // u = a·p + b
  let re_u = re_a * p.x - im_a * p.y + re_b;
  let im_u = re_a * p.y + im_a * p.x + im_b;
  // v = c·p + d
  let re_v = re_c * p.x - im_c * p.y + re_d;
  let im_v = re_c * p.y + im_c * p.x + im_d;
  // out = w · u / v (complex division)
  let rad_v = w / (re_v * re_v + im_v * im_v);
  return vec2f(
    rad_v * (re_u * re_v + im_u * im_v),
    rad_v * (im_u * re_v - re_u * im_v),
  );
}

// wedge_julia — flam3 var78_wedge_julia (variations.c:1671). 4 params +
// DISCRETE branch RNG (julian-shape). Same `abs(power)` mod-2π equivalence
// as cpow/juliascope: branch order permuted but set of distinct angles same.
fn var_wedge_julia(p: vec2f, w: f32, angle: f32, count: f32, power: f32, dist: f32, wi: u32) -> vec2f {
  let sumsq = dot(p, p);
  let cn = dist / power * 0.5;
  let r = w * pow(sumsq, cn);
  let cf = 1.0 - angle * count / TAU;
  let n = floor(rand01(wi) * abs(power));
  var a = (atan2(p.y, p.x) + TAU * n) / power;
  let c = floor((count * a + PI) / PI * 0.5);
  a = a * cf + c * angle;
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// ---------------------------------------------------------------------
// DC (direct-color) variation color helpers. #114.
//
// Each DC variation has two sides: a position contribution (the chain
// just sums weights × var_*_pos, like any flam3-99 variation) and an
// RGB output (used to override palette[color_index] at splat time when
// the xform's dc_flag in color_params.w is non-zero). Position lives in
// apply_variation (cases 99-102 — most are identity / zero); color is
// computed here from the chain's input position pa_mut.
//
// dc_linear: simplest — maps spatial coord (x, y) to (R, G, B) via a
// clamped affine. No params.
// ---------------------------------------------------------------------

fn var_dc_linear_color(p: vec2f) -> vec3f {
  return clamp(
    vec3f(
      0.5 + 0.5 * p.x,
      0.5 + 0.5 * p.y,
      0.5 - 0.25 * (p.x + p.y),
    ),
    vec3f(0.0),
    vec3f(1.0),
  );
}

// HSL → RGB. h, s, l in [0, 1]. Standard conversion (no perceptual
// correction). Used by var_dc_perlin_color and var_dc_cylinder_color.
fn hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = fract(hsl.x);
  let s = clamp(hsl.y, 0.0, 1.0);
  let l = clamp(hsl.z, 0.0, 1.0);
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let h6 = h * 6.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 * 0.5)) - 1.0));
  let m = l - c * 0.5;
  var rgb: vec3f;
  if (h6 < 1.0)      { rgb = vec3f(c, x, 0.0); }
  else if (h6 < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (h6 < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (h6 < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (h6 < 5.0) { rgb = vec3f(x, 0.0, c); }
  else               { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(m);
}

// dc_perlin: hue from a 2D Perlin fBm noise field; saturation 1.0,
// lightness 0.55 → bright color, easy to read against a dark background.
// `scale` and `octaves` shape the noise frequency / detail; `color_seed`
// rotates the hue cycle so two dc_perlin xforms with different seeds
// produce different palettes from the same field. Uses the noise helpers
// from src/shaders/noise_perlin.wgsl (prepended by chaos.ts at module
// load — see "#114" comment there).
fn var_dc_perlin_color(p: vec2f, scale: f32, octaves: f32, color_seed: f32) -> vec3f {
  let n = perlin_fbm(p, octaves, max(scale, 1e-6));
  // Map noise [-1, 1] → hue [0, 1], cycle by color_seed.
  let hue = fract(0.5 + 0.5 * n + color_seed);
  return hsl_to_rgb(vec3f(hue, 1.0, 0.55));
}

// dc_gridout: discrete quadrant coloring. Floor position into integer
// cells (cells parameter controls density), hash each cell to an RGB
// triple. Produces a tile / pixelated look distinct from the smooth
// perlin field. cells <= 0 → fallback to 1 cell so we never divide-by-0.
fn var_dc_gridout_color(p: vec2f, cells: f32) -> vec3f {
  let n = max(cells, 1.0);
  let cx = i32(floor(p.x * n));
  let cy = i32(floor(p.y * n));
  // Mix the two cell coordinates with large primes then hash. The
  // 0x9e3779b9 offset (golden-ratio fractional bits, the canonical
  // Knuth hash seed) ensures cell (0,0) maps to a non-zero hash —
  // hash01(0) = 0 would otherwise give the origin cell pure black.
  let mixed = u32((cx * 73856093) ^ (cy * 19349663)) + 0x9e3779b9u;
  let h0 = hash01(mixed);
  let h1 = hash01(mixed ^ 0xdeadbeefu);
  let h2 = hash01(mixed ^ 0x13579bdfu);
  return vec3f(h0, h1, h2);
}

// dc_cylinder: position warp matches the original var_cylinder
// (out = (sin(x), y)); color is derived from the warped coords →
// hue spirals along the x dimension and lightness modulates with y.
// This is the "DC + shape" pattern — the variation contributes BOTH a
// position change AND a color override.
fn var_dc_cylinder_pos(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(safe_sin(p.x), p.y);
}

fn var_dc_cylinder_color(p: vec2f) -> vec3f {
  // Use the cylinder-mapped coords for the color — fold p.x via sin to
  // get a periodic hue cycle along x, modulate lightness by y.
  //
  // Raw `tanh` (not `safe_tanh`) on p.y is intentional: the Dawn f32
  // trig range cliff (#72) is a range-reduction issue specific to
  // sin/cos/tan (periodic functions reduced via π mod). tanh is
  // monotonic, saturates asymptotically toward ±1 for any finite arg,
  // and has no periodic range-reduction step → no Dawn cliff. The outer
  // clamp [0.2, 0.85] is the final guard regardless of tanh output.
  let hue = fract(0.5 + 0.5 * safe_sin(p.x));
  let lit = clamp(0.5 + 0.25 * tanh(p.y * 0.5), 0.2, 0.85);
  return hsl_to_rgb(vec3f(hue, 0.9, lit));
}

// ---------------------------------------------------------------------
// #114 batch 1 — post-flam3 plugin pack. Sources: JWildfire (LGPL-2.1+);
// see NOTICE.md for attribution. pyr3 reimplements each formula in WGSL;
// no JWF code is byte-copied.
// ---------------------------------------------------------------------

// var_cpow2 — JWildfire CPow2Func.java. 4 params + RNG (3 calls). Author:
// Peter Sdobnov ("Zueuk"). Numbered variant of pyr3's `cpow` (V41) with
// range-driven RNG branching. JWF caches precalc in init(); pyr3 has no
// per-xform init hook so we recompute each iter — all f32 mul/cos/sin,
// negligible cost.
fn var_cpow2(p: vec2f, w: f32, p_r: f32, p_a: f32, divisor: f32, range: f32, wi: u32) -> vec2f {
  let div = select(divisor, 1.0, divisor == 0.0);
  let rng_max = max(range, 1.0);
  let ang_step = TAU / div;
  let c = p_r * safe_cos(PI * 0.5 * p_a) / div;
  let d = p_r * safe_sin(PI * 0.5 * p_a) / div;
  let half_c = c * 0.5;
  let inv_range = 0.5 / rng_max;
  let full_range = TAU * rng_max;

  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);

  var a = atan2(p.y, p.x);
  let n = floor(r0 * rng_max) + select(0.0, 1.0, a < 0.0);
  a = a + TAU * n;
  if (safe_cos(a * inv_range) < (r1 * 2.0 - 1.0)) {
    a = a - full_range;
  }
  let sumsq = dot(p, p);
  let lnr2 = log(sumsq);
  let r = w * exp(half_c * lnr2 - d * a);
  let th = c * a + (d * 0.5) * lnr2 + ang_step * floor(div * r2);
  return vec2f(r * safe_cos(th), r * safe_sin(th));
}

// var_cpow3 — JWildfire CPow3Func.java. 4 params + RNG (4 calls). Author:
// Peter Sdobnov ("Zueuk"). Log-distribution branch picker variant of
// cpow2.
fn var_cpow3(p: vec2f, w: f32, p_r: f32, p_d: f32, divisor: f32, spread: f32, wi: u32) -> vec2f {
  let div = select(divisor, 1.0, divisor == 0.0);
  let ang_step = TAU / div;
  // JWF precalc: p_a = atan2((d<0 ? -log(-d) : log(d)) * r, 2π).
  // log(|d|) guards against d=0 by clamping to a tiny f32 floor.
  let d_abs = max(abs(p_d), 1e-30);
  let signed_log = select(log(d_abs), -log(d_abs), p_d < 0.0);
  let pa = atan2(signed_log * p_r, TAU);
  let cos_pa = safe_cos(pa);
  let sin_pa = safe_sin(pa);
  let tc = cos_pa * p_r * cos_pa / div;
  let td = cos_pa * p_r * sin_pa / div;
  let half_c = tc * 0.5;
  let half_d = td * 0.5;
  let coeff = select(-0.095 * spread / td, 0.0, td == 0.0);

  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let r3 = rand01(wi);

  var a = atan2(p.y, p.x);
  if (a < 0.0) { a = a + TAU; }
  if (safe_cos(a * 0.5) < (r0 * 2.0 - 1.0)) {
    a = a - TAU;
  }
  let branch_sign = select(-TAU, TAU, r1 < 0.5);
  a = a + branch_sign * round(log(max(r2, 1e-30)) * coeff);
  let sumsq = dot(p, p);
  let lnr2 = log(sumsq);
  let r = w * exp(half_c * lnr2 - td * a);
  let th = tc * a + half_d * lnr2 + ang_step * floor(div * r3);
  return vec2f(r * safe_cos(th), r * safe_sin(th));
}

// var_loonie2 — JWildfire Loonie2Func.java. 3 params (sides=int, star,
// circle). Author: dark-beam. N-sided loonie with star + circle blends.
// `sides` is stored as f32 in the registry; cast to integer at use site.
// MAX_LOONIE2_SIDES caps the inner loop at compile time — practical
// `sides` is 3–8, 16 is generous headroom. Inlined as a `let` (not a
// module-scope `const`) so extractWgslFn-based unit tests pull it
// alongside the function body.
fn var_loonie2(p: vec2f, w: f32, sides_f: f32, star: f32, circle: f32) -> vec2f {
  let MAX_LOONIE2_SIDES: i32 = 16;
  let sides = clamp(i32(sides_f), 1, MAX_LOONIE2_SIDES);
  let a = TAU / f32(sides);
  let sina = safe_sin(a);
  let cosa = safe_cos(a);
  // JWF init: a = -π/2 · star; _sins = sin(a) (negative). cos is even so
  // coss = cos(π/2·star) = cos(-π/2·star) — no sign change there.
  let sins = safe_sin(-star * PI * 0.5);
  let coss = safe_cos(star * PI * 0.5);
  let sinc = safe_sin(circle * PI * 0.5);
  let cosc = safe_cos(circle * PI * 0.5);
  let sqrvvar = w * w;

  var xrt = p.x;
  var yrt = p.y;
  var r2 = xrt * coss + abs(yrt) * sins;
  let circle_r = sqrt(xrt * xrt + yrt * yrt);

  // JWF iterates `for (i = 0; i < sides - 1; i++)`. Loop bound is
  // dynamic; WGSL needs a compile-time cap to avoid unbounded analysis.
  for (var i: i32 = 0; i < MAX_LOONIE2_SIDES; i = i + 1) {
    if (i >= sides - 1) { break; }
    let swp = xrt * cosa - yrt * sina;
    yrt = xrt * sina + yrt * cosa;
    xrt = swp;
    r2 = max(r2, xrt * coss + abs(yrt) * sins);
  }
  r2 = r2 * cosc + circle_r * sinc;
  // JWF post-loop `if (i > 1)` means "did the loop execute more than
  // once" — equivalent to sides > 2 since i ends at sides-1.
  if (sides > 2) {
    r2 = r2 * r2;
  } else {
    r2 = abs(r2) * r2;
  }

  if (r2 > 0.0 && r2 < sqrvvar) {
    let r = w * sqrt(abs(sqrvvar / r2 - 1.0));
    return vec2f(r * p.x, r * p.y);
  } else if (r2 < 0.0) {
    let r = w / sqrt(abs(sqrvvar / r2) - 1.0);
    return vec2f(r * p.x, r * p.y);
  }
  return vec2f(w * p.x, w * p.y);
}

// var_epispiral — JWildfire EpispiralFunc.java. 3 params (n, thickness,
// holes) + 1 rand call when thickness > 0. Author: cyberxaos. Polar
// epicycloid via 1/cos(n·θ). Apophysis 7X.15C added this as a built-in.
// Routed through safe_cos per the Dawn f32 trig range cliff convention
// (#72) — n*θ is theoretically bounded by ±π·n but the discipline holds.
fn var_epispiral(p: vec2f, w: f32, n: f32, thickness: f32, holes: f32, wi: u32) -> vec2f {
  let theta = atan2(p.y, p.x);
  let d = safe_cos(n * theta);
  // d ≈ 0 produces 1/d ≈ ±Inf — chaos-game bad-value check reseeds the
  // walker, matching flam3's policy for div-by-zero guarded variations.
  let r0 = rand01(wi);
  let recip = 1.0 / d;
  let t_thick = -holes + (r0 * thickness) * recip;
  let t_no_thick = -holes + recip;
  let t = select(t_no_thick, t_thick, abs(thickness) > 1e-30);
  return vec2f(w * t * safe_cos(theta), w * t * safe_sin(theta));
}

// ---------------------------------------------------------------------
// #114 batch 2a — Worley/Voronoi cellular primitive + dependent kernels.
//
// `worley2d_F1` returns the nearest-feature-point distance and position
// using the canonical 3x3-neighborhood scan. Hash is an integer XOR mix
// (Wang/Murmur-style) — deliberately NOT sin-based, since Dawn's f32 trig
// has a range cliff that silently zeros large arguments (see safe_sin
// note above + reference-dawn-f32-trig-range-cliff). One helper unlocks
// the cellular family — bwraps and crackle here, ~25 more in the
// long-tail. License: pyr3-original implementation (the hash + scan are
// textbook, no port).

fn _worley_hash2(cx: i32, cy: i32) -> vec2f {
  var s: u32 = u32(cx) * 2654435769u;
  s = s ^ (u32(cy) * 2246822519u);
  s = s ^ (s >> 16u);
  s = s * 0x85ebca6bu;
  s = s ^ (s >> 13u);
  s = s * 0xc2b2ae35u;
  s = s ^ (s >> 16u);
  let h1 = f32(s & 0xffffu) * (1.0 / 65535.0);
  let h2 = f32((s >> 16u) & 0xffffu) * (1.0 / 65535.0);
  return vec2f(h1, h2);
}

// Returns vec4f(F1, _padding, feat_x, feat_y) for the nearest cell
// feature point. F1 = euclidean distance from p to that feature.
fn worley2d_F1(p: vec2f) -> vec4f {
  let ix = i32(floor(p.x));
  let iy = i32(floor(p.y));
  var bestD2: f32 = 1.0e9;
  var bestFx: f32 = 0.0;
  var bestFy: f32 = 0.0;
  for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
    for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
      let cx = ix + dx;
      let cy = iy + dy;
      let h = _worley_hash2(cx, cy);
      let featX = f32(cx) + h.x;
      let featY = f32(cy) + h.y;
      let ddx = featX - p.x;
      let ddy = featY - p.y;
      let d2 = ddx * ddx + ddy * ddy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestFx = featX;
        bestFy = featY;
      }
    }
  }
  return vec4f(sqrt(bestD2), 0.0, bestFx, bestFy);
}

// var_bwraps — bubble-wrap lattice (Xyrus02 BWraps2 plugin; Slobo777
// Bubble-Wrap WIP). Verbatim port of JWildfire PreBWraps2Func init +
// transform. 5 params: cellsize / space / gain / inner_twist /
// outer_twist. Inside each hash-spaced bubble the point gets pulled
// toward the bubble center with a hyperbolic gain + a radius-dependent
// twist; outside, passes through.
//
// init constants:
//   radius      = ½ · (cellsize / (1 + space²))
//   _g2         = gain² / cellsize + ε
//   max_bubble  = _g2 · radius, clamped to 1 if >2 ("recurve") else
//                 scaled by 1/((max_bubble²/4) + 1) to fill the cell
//   _r2         = radius²
//   _rfactor    = radius / max_bubble
fn var_bwraps(
  p: vec2f, w: f32,
  cellsize: f32, space: f32, gain: f32,
  inner_twist: f32, outer_twist: f32,
) -> vec2f {
  if (abs(cellsize) < 1.0e-30) { return vec2f(w * p.x, w * p.y); }
  let radius = 0.5 * (cellsize / (1.0 + space * space));
  let _g2 = gain * gain / cellsize + 1.0e-6;
  var max_bubble = _g2 * radius;
  if (max_bubble > 2.0) {
    max_bubble = 1.0;
  } else {
    max_bubble = max_bubble * (1.0 / ((max_bubble * max_bubble) / 4.0 + 1.0));
  }
  let _r2 = radius * radius;
  let _rfactor = radius / max(max_bubble, 1.0e-30);
  // Cell coordinates (each cell of size `cellsize`).
  let cx = (floor(p.x / cellsize) + 0.5) * cellsize;
  let cy = (floor(p.y / cellsize) + 0.5) * cellsize;
  var lx = p.x - cx;
  var ly = p.y - cy;
  // Outside the inner bubble → unchanged.
  if ((lx * lx + ly * ly) > _r2) { return vec2f(w * p.x, w * p.y); }
  // Bubble distortion: two-step Lx *= _g2 then r-scale.
  lx = lx * _g2;
  ly = ly * _g2;
  let r_dist = _rfactor / ((lx * lx + ly * ly) / 4.0 + 1.0);
  lx = lx * r_dist;
  ly = ly * r_dist;
  // Radius-fraction (0..1) controls the twist mix.
  let r_frac = (lx * lx + ly * ly) / max(_r2, 1.0e-30);
  let theta = inner_twist * (1.0 - r_frac) + outer_twist * r_frac;
  let st = safe_sin(theta);
  let ct = safe_cos(theta);
  return vec2f(
    w * (cx + ct * lx + st * ly),
    w * (cy - st * lx + ct * ly),
  );
}

// _crackle_cell_centre — pyr3 port of JWildfire CrackleFunc.position():
// integer cell (cx, cy) → centre (cx + d·N(E), cy + d·N(F)) · s, where
// E = (cx·2.5, cy·2.5) and F = (cy·2.5 + 30.2, cx·2.5 - 12.1) drive
// independent noise samples. JWildfire uses 3D simplex (with a z-slice
// param); pyr3 substitutes 2D perlin2d (z-slice fixed at 0). Documented
// in NOTICE.md as "JWildfire 3D simplex → pyr3 2D perlin substitution".
fn _crackle_cell_centre(cx: i32, cy: i32, s: f32, d: f32) -> vec2f {
  let fx = f32(cx);
  let fy = f32(cy);
  let ex = perlin2d(vec2f(fx * 2.5, fy * 2.5));
  let ey = perlin2d(vec2f(fy * 2.5 + 30.2, fx * 2.5 - 12.1));
  return vec2f((fx + d * ex) * s, (fy + d * ey) * s);
}

// _crackle_vratio — pyr3 port of JWildfire VoronoiTools.vratio(P, Q, U).
// Returns 2·((U-Q)·(P-Q)) / |P-Q|². On the perpendicular bisector of P
// and Q this equals 1; values < 1 mean U is on Q's side, > 1 on P's
// side. Returns 1 when P == Q (degenerate cell).
fn _crackle_vratio(p: vec2f, q: vec2f, u: vec2f) -> f32 {
  let pq = p - q;
  let denom = pq.x * pq.x + pq.y * pq.y;
  if (denom < 1.0e-30) { return 1.0; }
  let num = (u.x - q.x) * pq.x + (u.y - q.y) * pq.y;
  return 2.0 * num / denom;
}

// var_crackle — full JWildfire CrackleFunc port (Neil Slater /
// "slobo777", JWildfire LGPL-2.1+; see NOTICE.md). 4 params
// (cellsize / power / distort / scale). Per-iter algorithm:
//
//   1. Replace input p with U = blurr·(sin θ, cos θ), blurr =
//      (rand+rand)/2 + (rand-0.5)/4, θ = 2π·rand. 4 RNG calls/iter.
//   2. Find the voronoi cell containing U among 9 perturbed centres
//      around floor(U / (cellsize/2)).
//   3. Recentre the 9-grid on the closest cell, then compute
//      L = max vratio(P[i], P[centre], U) over the 8 neighbors. L is
//      the "boundary-relative distance" of U inside the centre cell
//      (0 = at centre, 1 = on cell boundary).
//   4. trgL = L^power · scale; R = trgL / L; scale (U − centre) by R
//      and re-add centre. Outputs w · (DXo, DYo).
//
// The pre-#157 implementation used `worley2d_F1` directly with raw `p`
// and swapped param semantics — fundamentally different transform
// despite the shared name. Surfaced by 2026-06-07 full-variation
// review (#157).
fn var_crackle(
  p: vec2f, w: f32,
  cellsize: f32, power: f32, distort: f32, scale: f32,
  wi: u32,
) -> vec2f {
  if (abs(cellsize) < 1.0e-30) { return vec2f(w * p.x, w * p.y); }
  let s = cellsize * 0.5;
  // Step 1: input-blur (4 RNG calls). pyr3 contract requires using
  // rand01(wi) which sequences walker-local RNG.
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let r3 = rand01(wi);
  let r4 = rand01(wi);
  let blurr = (r1 + r2) * 0.5 + (r3 - 0.5) * 0.25;
  let theta = 2.0 * PI * r4;
  let u = vec2f(blurr * sin(theta), blurr * cos(theta));
  // Step 2: 9 cells around floor(U/s).
  let xcv0 = i32(floor(u.x / s));
  let ycv0 = i32(floor(u.y / s));
  var P: array<vec2f, 9>;
  for (var i = 0; i < 9; i = i + 1) {
    let di = i / 3 - 1;
    let dj = i % 3 - 1;
    P[i] = _crackle_cell_centre(xcv0 + di, ycv0 + dj, s, distort);
  }
  // Find closest of the 9 to U.
  var q = 0;
  var d2min = 1.0e30;
  for (var i = 0; i < 9; i = i + 1) {
    let dx = P[i].x - u.x;
    let dy = P[i].y - u.y;
    let d2 = dx * dx + dy * dy;
    if (d2 < d2min) { d2min = d2; q = i; }
  }
  // Step 3: recentre 9-grid on closest cell, recompute.
  let qdi = q / 3 - 1;
  let qdj = q % 3 - 1;
  let xcv = xcv0 + qdi;
  let ycv = ycv0 + qdj;
  for (var i = 0; i < 9; i = i + 1) {
    let di = i / 3 - 1;
    let dj = i % 3 - 1;
    P[i] = _crackle_cell_centre(xcv + di, ycv + dj, s, distort);
  }
  // Voronoi boundary distance L = max vratio over the 8 neighbours of
  // index-4 (the centre cell).
  var L = -1.0e30;
  for (var i = 0; i < 9; i = i + 1) {
    if (i == 4) { continue; }
    let ratio = _crackle_vratio(P[i], P[4], u);
    if (ratio > L) { L = ratio; }
  }
  // Step 4: distance-power-weighted scale.
  let DXo = u.x - P[4].x;
  let DYo = u.y - P[4].y;
  let l_safe = L + 1.0e-30;
  let trgL = pow(abs(l_safe), power) * scale;
  let R = trgL / l_safe;
  return vec2f(w * (P[4].x + DXo * R), w * (P[4].y + DYo * R));
}

// ---------------------------------------------------------------------
// #114 batch 2b-a — JWildfire S-tier first half. Sources: JWildfire
// (LGPL-2.1+); see NOTICE.md. pyr3 reimplements each formula in WGSL;
// no JWF code is byte-copied. Z-axis params dropped per pyr3's 2D
// engine; selected per-variation drops noted inline.
// ---------------------------------------------------------------------

// var_juliaq — JWildfire JuliaQFunc.java. 2 params (power, divisor)
// + 1 RNG call. Author: Peter Sdobnov ("Zueuk"). Generalized julia
// where `divisor` decouples the rotation step from the branch count.
// JWF's `random(Integer.MAX_VALUE) * inv_power_2pi` folds mod 2π —
// equivalent to picking a discrete branch index n in [0, |power|)
// and rotating by n·(2π/power). `power` is an int (cast at use).
// `divisor` is a real number (JWF int but accepts non-integer values
// at runtime); we keep it f32.
fn var_juliaq(p: vec2f, w: f32, power: f32, divisor: f32, wi: u32) -> vec2f {
  let power_safe = select(power, 1.0, abs(power) < 1.0e-30);
  let abs_pow = max(1.0, abs(power_safe));
  let inv_power = divisor / power_safe;
  let half_inv_power = 0.5 * inv_power;
  let inv_power_2pi = TAU / power_safe;
  let r01 = rand01(wi);
  let n = floor(r01 * abs_pow);
  let a = atan2(p.y, p.x) * inv_power + n * inv_power_2pi;
  // Folded back to bounded range manually before safe_*.
  let r = w * pow(p.x * p.x + p.y * p.y, half_inv_power);
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// var_glynnia — JWildfire GlynniaFunc.java. 0 params, 1 RNG call
// (discrete coin-flip branch). Author: eralex61. Two sub-formulas
// inside/outside the unit disk, each with a 50/50 secondary branch
// → 4 leaves total. precalc: vvar2 = w·√2/2. Math-degenerate cases
// (d==0 in either branch) return (0,0); the chaos game's bad-value
// reseed handles the propagation.
fn var_glynnia(p: vec2f, w: f32, wi: u32) -> vec2f {
  let vvar2 = w * 0.7071067811865476;
  let r = sqrt(p.x * p.x + p.y * p.y);
  let coin = rand01(wi);
  if (r >= 1.0) {
    if (coin > 0.5) {
      let inner = r + p.x;
      if (inner <= 0.0) { return vec2f(0.0, 0.0); }
      let d = sqrt(inner);
      if (d == 0.0) { return vec2f(0.0, 0.0); }
      return vec2f(vvar2 * d, -(vvar2 / d) * p.y);
    } else {
      let d = r + p.x;
      let radicand = r * (p.y * p.y + d * d);
      if (radicand <= 0.0) { return vec2f(0.0, 0.0); }
      let dx = sqrt(radicand);
      if (dx == 0.0) { return vec2f(0.0, 0.0); }
      let rr = w / dx;
      return vec2f(rr * d, rr * p.y);
    }
  } else {
    if (coin > 0.5) {
      let inner = r + p.x;
      if (inner <= 0.0) { return vec2f(0.0, 0.0); }
      let d = sqrt(inner);
      if (d == 0.0) { return vec2f(0.0, 0.0); }
      return vec2f(-vvar2 * d, -(vvar2 / d) * p.y);
    } else {
      let d = r + p.x;
      let radicand = r * (p.y * p.y + d * d);
      if (radicand <= 0.0) { return vec2f(0.0, 0.0); }
      let dx = sqrt(radicand);
      if (dx == 0.0) { return vec2f(0.0, 0.0); }
      let rr = w / dx;
      return vec2f(-rr * d, rr * p.y);
    }
  }
}

// var_loonie3 — JWildfire Loonie3Func.java. 0 params, no RNG.
// Author: dark-beam. Numbered variant of loonie/loonie2. The
// "radius" is (r²/x)² when x > tiny eps (a half-plane gating),
// else 2·w² (outside-half-plane escape branch). precalc: sqrvvar = w².
// Identity branch when r2 >= sqrvvar.
fn var_loonie3(p: vec2f, w: f32) -> vec2f {
  let sqrvvar = w * w;
  let SMALL_EPSILON: f32 = 1.0e-30;
  var r2: f32 = 2.0 * sqrvvar;
  if (p.x > SMALL_EPSILON) {
    let num = p.x * p.x + p.y * p.y;
    let q = num / p.x;
    r2 = q * q;
  }
  if (r2 < sqrvvar) {
    let r = w * sqrt(sqrvvar / r2 - 1.0);
    return vec2f(r * p.x, r * p.y);
  }
  return vec2f(w * p.x, w * p.y);
}

// var_falloff — JWildfire Falloff2Func.java type=0 (default) branch
// (Xyrus02-origin). 6 params (scatter, mindist, mul_x, mul_y, x0, y0)
// + 2 RNG calls. Distance-weighted random scatter outside a circle
// centered at (x0,y0). Z-axis params (mul_z/z0) + the invert flag +
// mul_c (color jitter, no analog in pyr3's chain) dropped to fit the
// 2D engine and 8-slot seam — kept in `var_falloff2` where they're
// part of the type-branch surface.
fn var_falloff(
  p: vec2f, w: f32,
  scatter: f32, mindist: f32,
  mul_x: f32, mul_y: f32,
  x0: f32, y0: f32,
  wi: u32,
) -> vec2f {
  let rmax = 0.04 * scatter;
  let dx = p.x - x0;
  let dy = p.y - y0;
  var d = sqrt(dx * dx + dy * dy);
  if (d < 0.0) { d = 0.0; }
  d = (d - mindist) * rmax;
  if (d < 0.0) { d = 0.0; }
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  return vec2f(
    w * (p.x + mul_x * r0 * d),
    w * (p.y + mul_y * r1 * d),
  );
}

// var_falloff2 — JWildfire Falloff2Func.java, ALL THREE type
// branches (0=default, 1=radial, 2=gaussian). 7 params (scatter,
// type, mul_x, mul_y, x0, y0, mindist). 2–3 RNG calls depending
// on branch. Author: Xyrus02. Z-axis params + invert + mul_c
// dropped per the 2D-only engine and 8-slot seam.
fn var_falloff2(
  p: vec2f, w: f32,
  scatter: f32, typ: f32,
  mul_x: f32, mul_y: f32,
  x0: f32, y0: f32,
  mindist: f32,
  wi: u32,
) -> vec2f {
  let rmax = 0.04 * scatter;
  let dx = p.x - x0;
  let dy = p.y - y0;
  var d = sqrt(dx * dx + dy * dy);
  if (d < 0.0) { d = 0.0; }
  d = (d - mindist) * rmax;
  if (d < 0.0) { d = 0.0; }
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let t = i32(clamp(typ, 0.0, 2.0));
  if (t == 1) {
    // radial: JWildfire Falloff2Func.calcFunctionRadial rotates around ORIGIN
    // (not (x0,y0)) — phi/r come from absolute coords + atan2(y, x).
    let r_abs = sqrt(p.x * p.x + p.y * p.y);
    let phi = atan2(p.y, p.x) + mul_y * d * r1;
    let rr = r_abs + mul_x * r0 * d;
    return vec2f(
      w * rr * safe_cos(phi),
      w * rr * safe_sin(phi),
    );
  } else if (t == 2) {
    // gaussian: 2π·π angular scatter
    let sigma = d * r1 * TAU;
    let phi = d * r2 * PI;
    let rad = d * r0;
    let sigma_c = safe_cos(sigma);
    return vec2f(
      w * (p.x + mul_x * rad * sigma_c * safe_cos(phi)),
      w * (p.y + mul_y * rad * sigma_c * safe_sin(phi)),
    );
  }
  // default type=0: plain distance-weighted scatter (matches var_falloff)
  return vec2f(
    w * (p.x + mul_x * r0 * d),
    w * (p.y + mul_y * r1 * d),
  );
}

// var_falloff3 — JWildfire AbstractFalloff3Func, blur_type=0 (gaussian)
// + blur_shape=0 (circle) default-mode path. 7 params (scatter, mul_x,
// mul_y, x0, y0, mindist, invert). 3 RNG calls. The "blur_type" and
// "blur_shape" selectors are folded down to the most-common defaults
// (the JWildfire UI ships these at 0/0); Z-axis params + alpha + mul_c
// dropped per pyr3's 2D-only engine. invert (0/1) kept since it's a
// load-bearing visual switch — `invert=1` puts the scatter INSIDE the
// circle rather than outside.
fn var_falloff3(
  p: vec2f, w: f32,
  scatter: f32, mul_x: f32, mul_y: f32,
  x0: f32, y0: f32, mindist: f32, invertFlag: f32,
  wi: u32,
) -> vec2f {
  let rmax = 0.04 * scatter;
  let dx = p.x - x0;
  let dy = p.y - y0;
  let radius = sqrt(dx * dx + dy * dy);
  let base_pos = max(radius, 0.0);
  let base_inv = max(1.0 - radius, 0.0);
  let base = select(base_pos, base_inv, invertFlag > 0.5);
  let dist = max((base - mindist) * rmax, 0.0);
  // JWildfire AbstractFalloff3Func centers RNG samples at 0 (range [-0.5, 0.5))
  // — preserves rotational symmetry of the scatter shell. Bare [0,1) shifts it.
  let r0 = rand01(wi) - 0.5;
  let r1 = rand01(wi) - 0.5;
  let r2 = rand01(wi) - 0.5;
  let sigma = dist * r1 * TAU;
  let phi = dist * r2 * PI;
  let rad = dist * r0;
  let sigma_c = safe_cos(sigma);
  return vec2f(
    w * (p.x + mul_x * rad * sigma_c * safe_cos(phi)),
    w * (p.y + mul_y * rad * sigma_c * safe_sin(phi)),
  );
}

// ---------------------------------------------------------------------
// #114 batch 2b-b — S-tier kaleidoscope/circle family. Sources:
// JWildfire (LGPL-2.1+); see NOTICE.md. pyr3 reimplements each formula
// in WGSL; no JWF code is byte-copied. petal is 0-param. `loc` was
// originally scoped here but dropped — no varLoc.pas in Apophysis 7X
// core or JWildfire (see V table comment in src/variations.ts).
// ---------------------------------------------------------------------

// var_collideoscope — JWildfire CollideoscopeFunc.java. 2 params
// (a, num) + no RNG. Author: Michael Faber. The "collide" twin of
// kaleidoscope — folds the polar angle into 2·num pie slices with
// alternating-sign offsets. `num` is an integer count (≥1); `a` is
// a real shift (UI-limited to [0,1] in JWF, but math is well-defined
// across the line). Precalc kn_pi/pi_kn/ka_kn live inside the kernel
// since they depend on the per-iterate param read.
fn var_collideoscope(p: vec2f, w: f32, a_param: f32, num_param: f32) -> vec2f {
  let num_i = max(1, i32(num_param));
  let num_f = f32(num_i);
  let kn_pi = num_f / PI;
  let pi_kn = PI / num_f;
  let ka = PI * a_param;
  let ka_kn = ka / num_f;
  var a = atan2(p.y, p.x);
  let r = w * sqrt(p.x * p.x + p.y * p.y);
  if (a >= 0.0) {
    let alt = i32(a * kn_pi);
    if ((alt % 2) == 0) {
      a = f32(alt) * pi_kn + ((ka_kn + a) % pi_kn);
    } else {
      a = f32(alt) * pi_kn + ((-ka_kn + a) % pi_kn);
    }
  } else {
    let alt = i32(-a * kn_pi);
    if ((alt % 2) != 0) {
      a = -(f32(alt) * pi_kn + ((-ka_kn - a) % pi_kn));
    } else {
      a = -(f32(alt) * pi_kn + ((ka_kn - a) % pi_kn));
    }
  }
  // `a` is now folded into [-π, π]-ish — safe trig OK but plain trig
  // would also be correct since |a| ≤ 2π·num. Use safe_* defensively
  // for high `num` values.
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// var_circlize — JWildfire CirclizeFunc.java. 1 param (hole) + no RNG.
// Author: Michael Faber. Square → circle perimeter map: each iterate
// picks the dominant axis, walks the unit square's perimeter
// accordingly, then maps perimeter → angle + axis → radius. Note JWF
// quirk: `hole` is intentionally NOT scaled by the weight (`pAmount`)
// — comment in JWF source reads "tsk tsk... hole is not scaled by
// vvar." We preserve that behavior for parity. side==0 (origin)
// degenerates → return (0,0).
fn var_circlize(p: vec2f, w: f32, hole: f32) -> vec2f {
  let var4_PI = w / (PI * 0.25);
  let absx = abs(p.x);
  let absy = abs(p.y);
  var perimeter: f32 = 0.0;
  var side: f32 = 0.0;
  if (absx >= absy) {
    if (p.x >= absy) {
      perimeter = absx + p.y;
    } else {
      perimeter = 5.0 * absx - p.y;
    }
    side = absx;
  } else {
    if (p.y >= absx) {
      perimeter = 3.0 * absy - p.x;
    } else {
      perimeter = 7.0 * absy + p.x;
    }
    side = absy;
  }
  if (side == 0.0) { return vec2f(0.0, 0.0); }
  let r = var4_PI * side + hole;
  let a = (PI * 0.25) * perimeter / side - (PI * 0.25);
  // |a| is bounded ≤ π/2 so plain trig is safe — keep safe_* for
  // defense against extreme `hole`/weight scaling at the call site.
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// var_circlize2 — JWildfire Circlize2Func.java. 1 param (hole) + no RNG.
// Author: Michael Faber (Angle Pack). Companion to circlize: identical
// perimeter parameterization, but the radius is w·(side+hole) instead
// of w·(4/π)·side+hole — `hole` IS scaled by the weight here (the
// "tsk tsk" quirk corrected in this sibling).
fn var_circlize2(p: vec2f, w: f32, hole: f32) -> vec2f {
  let absx = abs(p.x);
  let absy = abs(p.y);
  var perimeter: f32 = 0.0;
  var side: f32 = 0.0;
  if (absx >= absy) {
    if (p.x >= absy) {
      perimeter = absx + p.y;
    } else {
      perimeter = 5.0 * absx - p.y;
    }
    side = absx;
  } else {
    if (p.y >= absx) {
      perimeter = 3.0 * absy - p.x;
    } else {
      perimeter = 7.0 * absy + p.x;
    }
    side = absy;
  }
  if (side == 0.0) { return vec2f(0.0, 0.0); }
  let r = w * (side + hole);
  let a = (PI * 0.25) * perimeter / side - (PI * 0.25);
  return vec2f(r * safe_cos(a), r * safe_sin(a));
}

// var_eswirl — JWildfire ESwirlFunc.java. 2 params (in, out). No RNG.
// Author: Michael Faber ("eSeries"). Extended swirl: converts (x,y)
// to elliptic coords (μ, ν), twists ν by (μ·out + in/μ), maps back.
// JWF uses a safe_sqrt to dodge NaN at floating-point underflow.
// Trig args (μ·out + in/μ + acos(...)) can grow large for tiny μ —
// route through safe_* to dodge the Dawn f32 trig range cliff.
fn var_eswirl(p: vec2f, w: f32, in_p: f32, out_p: f32) -> vec2f {
  let tmp = p.y * p.y + p.x * p.x + 1.0;
  let tmp2 = 2.0 * p.x;
  let r1_in = tmp + tmp2;
  let r2_in = tmp - tmp2;
  let r1_sqrt = select(0.0, sqrt(max(r1_in, 0.0)), r1_in > 0.0);
  let r2_sqrt = select(0.0, sqrt(max(r2_in, 0.0)), r2_in > 0.0);
  var xmax = (r1_sqrt + r2_sqrt) * 0.5;
  if (xmax < 1.0) { xmax = 1.0; }
  // acosh(xmax) = log(xmax + sqrt(xmax^2 - 1)). xmax ≥ 1 so the radical
  // is non-negative; xmax==1.0 → mu==0 (cusp).
  let radicand = max(xmax * xmax - 1.0, 0.0);
  let mu = log(xmax + sqrt(radicand));
  var t = p.x / xmax;
  if (t > 1.0) { t = 1.0; }
  if (t < -1.0) { t = -1.0; }
  // acos(t) for t∈[-1,1] — bounded [0, π], plain acos is fine.
  var nu = acos(t);
  if (p.y < 0.0) { nu = -nu; }
  // Guard mu==0 (xmax==1.0 cusp): `in/mu` → ±Inf. JWF lets the chaos
  // game's bad-value reseed clean it up; we mirror by clamping mu to
  // 1e-30 (tiny but finite) so the iterate just diverges loudly instead
  // of poisoning the buffer.
  let mu_safe = select(mu, 1.0e-30, mu == 0.0);
  let nu_warp = nu + mu * out_p + in_p / mu_safe;
  // sinh/cosh of mu — mu = log(xmax + sqrt(xmax^2 - 1)) is bounded ≈
  // log(2·xmax) for large xmax, so for f32-representable xmax (<~1e38)
  // mu < ~88; sinh/cosh stay finite. Plain math.
  let sinhmu = sinh(mu);
  let coshmu = cosh(mu);
  return vec2f(w * coshmu * safe_cos(nu_warp), w * sinhmu * safe_sin(nu_warp));
}

// var_petal — JWildfire PetalFunc.java. 0 params, no RNG. Author:
// Raykoid666. Lobed-petal attractor: x = w·cos(x)·(cos(x)·cos(y))³,
// y = w·cos(x)·(sin(x)·cos(y))³. Trig args are raw coords — for
// large radii the trig cliff applies, route through safe_*.
fn var_petal(p: vec2f, w: f32) -> vec2f {
  let cx = safe_cos(p.x);
  let sx = safe_sin(p.x);
  let cy = safe_cos(p.y);
  let cxcy = cx * cy;
  let sxcy = sx * cy;
  let bx = cxcy * cxcy * cxcy;
  let by = sxcy * sxcy * sxcy;
  return vec2f(w * cx * bx, w * cx * by);
}

// ---------------------------------------------------------------------
// #114 batch 2b-c — Xyrus02 mid-tier + hexes cellular. Sources:
// xyrus02/apophysis-plugins (GPL-2+); JWildfire HexesFunc (LGPL-2.1+);
// see NOTICE.md. pyr3 reimplements each formula in WGSL; no source
// code is byte-copied. `juni` was originally scoped here but dropped —
// no JuniFunc.java in JWildfire, and the Xyrus02 juni source requires
// xform-affine context that pyr3's apply_variation seam doesn't expose
// (see V table comment in src/variations.ts).
// ---------------------------------------------------------------------

// var_bcircle — Xyrus02 bcircle plugin (apophysis-plugins).
// 2 params (scale, borderwidth). RNG only when borderwidth ≠ 0.
// Inside the unit disk (after scale), passthrough w·(x,y); outside,
// optionally emit a point on the unit circle perturbed by border noise.
// Origin guard matches source: (0,0) input → no contribution.
fn var_bcircle(p: vec2f, w: f32, scale: f32, borderwidth: f32, wi: u32) -> vec2f {
  let bcbw = abs(borderwidth);
  if (p.x == 0.0 && p.y == 0.0) { return vec2f(0.0, 0.0); }
  let x = p.x * scale;
  let y = p.y * scale;
  let r = sqrt(x * x + y * y);
  if (r <= 1.0) {
    return vec2f(w * x, w * y);
  }
  if (bcbw == 0.0) { return vec2f(0.0, 0.0); }
  let ang = atan2(y, x);
  let rand = rand01(wi);
  let omega = 0.2 * bcbw * rand + 1.0;
  // ang from atan2 is bounded in [-π, π] — plain trig fine; keep safe_*
  // defensively in case future call-sites scale the angle further.
  return vec2f(w * omega * safe_cos(ang), w * omega * safe_sin(ang));
}

// var_curl2 — Xyrus02 curl2 plugin (apophysis-plugins). 3 params
// (c1, c2, c3). No RNG. Author: Georg Kiehne / Xyrus-Worx.
// Cubic-polynomial complex inverse — the c2/c3 generalization of
// flam3's `curl` (which is the c1-only path).
fn var_curl2(p: vec2f, w: f32, c1: f32, c2: f32, c3: f32) -> vec2f {
  let cc2 = 2.0 * c2;
  let cc3 = 3.0 * c3;
  let x = p.x;
  let y = p.y;
  let x2 = x * x;
  let x3 = x2 * x;
  let y2 = y * y;
  let y3 = y2 * y;
  let re = c3 * x3 - cc3 * x * y2 + c2 * x2 - c2 * y2 + c1 * x + 1.0;
  let im = cc3 * x2 * y - c3 * y3 + cc2 * x * y + c1 * y;
  let denom = re * re + im * im;
  // Match source: no explicit guard; the chaos game reseed handles
  // ±Inf from a true zero denominator.
  let r = w / denom;
  return vec2f((x * re + y * im) * r, (y * re - x * im) * r);
}

// var_murl — JWildfire MurlFunc / Xyrus02 murl plugin. 2 params
// (c, power). No RNG. Author: Peter Sdobnov (Zueuk); ported to Java
// by Nic Anderson (chronologicaldot). Polar power + complex inverse
// blend. JWildfire's port adds the `power == 1` branch (c is NOT
// divided by power-1 there); pyr3 follows the JWildfire form.
fn var_murl(p: vec2f, w: f32, c_in: f32, power_in: f32) -> vec2f {
  let power_i = i32(power_in);
  let power_f = f32(power_i);
  let c = select(c_in / (power_f - 1.0), c_in, power_i == 1);
  let p2 = power_f / 2.0;
  let vp = w * (c + 1.0);
  let a = atan2(p.y, p.x) * power_f;
  // `a` can exceed [-π·power, π·power] — safe_* dodges Dawn's trig cliff
  // at high power counts.
  let sina = safe_sin(a);
  let cosa = safe_cos(a);
  let r = c * pow(p.x * p.x + p.y * p.y, p2);
  let re = r * cosa + 1.0;
  let im = r * sina;
  // Murl source uses 1e-29 to dodge degeneracy at (c=0, r=0). f32 floor
  // is ~1.18e-38, so 1e-29 is well-representable; but the Dawn FTZ
  // cliff (subnormals → 0) applies to any value ≤ ~1.18e-38, NOT 1e-29.
  // 1e-29 is safe — round-trips as a normal f32.
  let r1 = vp / (re * re + im * im + 1.0e-29);
  return vec2f(r1 * (p.x * re + p.y * im), r1 * (p.y * re - p.x * im));
}

// var_stwins — Xyrus02 stwins plugin (apophysis-plugins). 1 param
// (distort). No RNG. Author: xyrus02. Twin-sine ratio: scales the
// iterate by a fixed 0.05 multiplier, then mixes
// (x²−y²)·sin(2π·distort·(x+y)) / (x²+y²) back into (w·x, w·y).
fn var_stwins(p: vec2f, w: f32, distort: f32) -> vec2f {
  let multiplier: f32 = 0.05;
  let x = p.x * w * multiplier;
  let y = p.y * w * multiplier;
  let x2 = x * x;
  let y2 = y * y;
  let x_plus_y = x + y;
  let x2_minus_y2 = x2 - y2;
  let x2_plus_y2 = x2 + y2;
  // Trig arg `2π·distort·(x+y)` is unbounded for distort or coords away
  // from origin — Dawn trig cliff applies. safe_sin guards it.
  let result_num = x2_minus_y2 * safe_sin(TAU * distort * x_plus_y);
  let divident = select(x2_plus_y2, 1.0, x2_plus_y2 == 0.0);
  let result = result_num / divident;
  return vec2f(w * p.x + result, w * p.y + result);
}

// var_hexes — JWildfire HexesFunc (port of slobo777's Apophysis
// hexes plugin). 4 params (cellsize, power, rotate, scale). No RNG.
// Author: Neil Slater / slobo777.
//
// Breaks the plane into a hex lattice, finds the closest hex center
// to the iterate, then applies a per-cell power scaling + rotation
// expressed via voronoi-edge distance. The "rosette removal" blend
// at the cell edge (L ∈ [0.5, 0.8]) smooths the transition between
// closest-vs-second-closest-hex regions.
//
// pyr3 uses its OWN hex-grid helper, NOT worley2d_F1 — hexes is
// deterministic per-cell-center (no per-cell RNG hash) and uses an
// affine map to convert Cartesian ↔ hex coords. worley2d's
// hash-based feature points would produce a completely different
// (and wrong) lattice.
fn var_hexes(p: vec2f, w: f32, cellsize: f32, power: f32, rotate: f32, scale: f32) -> vec2f {
  if (cellsize == 0.0) { return vec2f(0.0, 0.0); }
  // Local consts (extractWgslFn doesn't pull module-scope const into
  // the test kernel — declare as let).
  let SQRT3: f32 = 1.7320508075688772935;
  let a_hex: f32 = 1.0 / 3.0;
  let b_hex: f32 = SQRT3 / 3.0;
  let c_hex: f32 = -1.0 / 3.0;
  let d_hex: f32 = SQRT3 / 3.0;
  let a_cart: f32 = 1.5;
  let b_cart: f32 = -1.5;
  let c_cart: f32 = SQRT3 / 2.0;
  let d_cart: f32 = SQRT3 / 2.0;
  // `rotate · 2π` — bounded for sane rotate inputs, plain trig fine.
  let rotSin = safe_sin(rotate * TAU);
  let rotCos = safe_cos(rotate * TAU);
  let Ux = p.x;
  let Uy = p.y;
  let s = cellsize;

  let hx0 = i32(floor((a_hex * Ux + b_hex * Uy) / s));
  let hy0 = i32(floor((c_hex * Ux + d_hex * Uy) / s));

  // Step 1: 3x3 candidate hex centers, find the closest.
  var bestD2: f32 = 1.0e30;
  var q: i32 = 0;
  for (var di: i32 = -1; di < 2; di = di + 1) {
    for (var dj: i32 = -1; dj < 2; dj = dj + 1) {
      let cx = (a_cart * f32(hx0 + di) + b_cart * f32(hy0 + dj)) * s;
      let cy = (c_cart * f32(hx0 + di) + d_cart * f32(hy0 + dj)) * s;
      let dx = cx - Ux;
      let dy = cy - Uy;
      let d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        q = (di + 1) * 3 + (dj + 1);
      }
    }
  }
  // Convert q back to (di, dj). Same enumeration as the source's
  // `cell_choice` table: q=0..8 → (di,dj) ∈ [-1,1]².
  let chosen_di = q / 3 - 1;
  let chosen_dj = q % 3 - 1;
  let hx = hx0 + chosen_di;
  let hy = hy0 + chosen_dj;

  // Step 2: 7-point ring centered on the chosen hex. Order matches the
  // JWF source: [center, +y, +x+y, +x, -y, -x-y, -x].
  let P0 = vec2f((a_cart * f32(hx) + b_cart * f32(hy)) * s, (c_cart * f32(hx) + d_cart * f32(hy)) * s);
  let P1 = vec2f((a_cart * f32(hx) + b_cart * f32(hy + 1)) * s, (c_cart * f32(hx) + d_cart * f32(hy + 1)) * s);
  let P2 = vec2f((a_cart * f32(hx + 1) + b_cart * f32(hy + 1)) * s, (c_cart * f32(hx + 1) + d_cart * f32(hy + 1)) * s);
  let P3 = vec2f((a_cart * f32(hx + 1) + b_cart * f32(hy)) * s, (c_cart * f32(hx + 1) + d_cart * f32(hy)) * s);
  let P4 = vec2f((a_cart * f32(hx) + b_cart * f32(hy - 1)) * s, (c_cart * f32(hx) + d_cart * f32(hy - 1)) * s);
  let P5 = vec2f((a_cart * f32(hx - 1) + b_cart * f32(hy - 1)) * s, (c_cart * f32(hx - 1) + d_cart * f32(hy - 1)) * s);
  let P6 = vec2f((a_cart * f32(hx - 1) + b_cart * f32(hy)) * s, (c_cart * f32(hx - 1) + d_cart * f32(hy)) * s);

  // voronoiL: half-plane projection vs each of the other 6 centers.
  // Inlined twice (no functions inside functions in WGSL).
  let L1 = hexes_voronoi_max(P0, P1, P2, P3, P4, P5, P6, Ux, Uy);

  let DXo = Ux - P0.x;
  let DYo = Uy - P0.y;
  // `power` is user-controlled — the source guards L1==0 with `L1 + 1e-100`.
  // 1e-100 is below f32 representable normals; we use 1.0e-30 (smallest
  // value that survives Dawn's FTZ cliff per reference-dawn-f32-ftz-cliff).
  let trgL = pow(L1 + 1.0e-30, power) * scale;
  let Vx0 = DXo * rotCos + DYo * rotSin;
  let Vy0 = -DXo * rotSin + DYo * rotCos;

  let L2 = hexes_voronoi_max(P0, P1, P2, P3, P4, P5, P6, Vx0 + P0.x, Vy0 + P0.y);
  let L = max(L1, L2);
  var R: f32 = 0.0;
  if (L < 0.5) {
    R = trgL / L1;
  } else if (L > 0.8) {
    R = trgL / L2;
  } else {
    R = ((trgL / L1) * (0.8 - L) + (trgL / L2) * (L - 0.5)) / 0.3;
  }
  let Vx = Vx0 * R + P0.x;
  let Vy = Vy0 * R + P0.y;
  return vec2f(w * Vx, w * Vy);
}

// Hex Voronoi half-plane max-ratio helper. Takes the chosen center P0
// plus the 6 ring centers (P1..P6) and the query point U; returns the
// max half-plane projection ratio across the 6 edges. Matches the JWF
// `hexes_voronoi` / `hexes_vratio` pair.
fn hexes_voronoi_max(P0: vec2f, P1: vec2f, P2: vec2f, P3: vec2f, P4: vec2f, P5: vec2f, P6: vec2f, Ux: f32, Uy: f32) -> f32 {
  var ratiomax: f32 = -1.0e20;
  ratiomax = hexes_vratio_step(P1, P0, Ux, Uy, ratiomax);
  ratiomax = hexes_vratio_step(P2, P0, Ux, Uy, ratiomax);
  ratiomax = hexes_vratio_step(P3, P0, Ux, Uy, ratiomax);
  ratiomax = hexes_vratio_step(P4, P0, Ux, Uy, ratiomax);
  ratiomax = hexes_vratio_step(P5, P0, Ux, Uy, ratiomax);
  ratiomax = hexes_vratio_step(P6, P0, Ux, Uy, ratiomax);
  return ratiomax;
}

fn hexes_vratio_step(P: vec2f, Q: vec2f, Ux: f32, Uy: f32, prev: f32) -> f32 {
  let PmQx = P.x - Q.x;
  let PmQy = P.y - Q.y;
  if (PmQx == 0.0 && PmQy == 0.0) {
    return select(prev, 1.0, 1.0 > prev);
  }
  // (PmQx)·(U−Q).x  + (PmQy)·(U−Q).y, doubled, divided by |P−Q|².
  // Parens around the dot product to avoid Dawn's `* ^ /` ambiguity.
  let num = 2.0 * ((Ux - Q.x) * PmQx + (Uy - Q.y) * PmQy);
  let den = PmQx * PmQx + PmQy * PmQy;
  let ratio = num / den;
  return select(prev, ratio, ratio > prev);
}

// ---------------------------------------------------------------------
// #114 batch 2b-d — Xyrus02 X-family + blur_circle (FINAL #114 batch).
// V125..V130. Sources: xyrus02/apophysis-plugins (GPL-2+); see
// NOTICE.md. pyr3 reimplements each formula in WGSL; no source code is
// byte-copied.
// ---------------------------------------------------------------------

// var_xheart — Xyrus02 xheart plugin (apophysis-plugins). 2 params
// (xheart_angle, xheart_ratio). No RNG. "Extended heart" — projects
// (x,y) through a (4/r²+4, rat/r²+4) folding then rotates by an angle
// precomputed from `xheart_angle`. Source's `r2_4 == 0` branch is dead
// (r²+4 ≥ 4) — kept defensively.
fn var_xheart(p: vec2f, w: f32, angle: f32, ratio: f32) -> vec2f {
  let ang = PI / 4.0 + (0.5 * (PI / 4.0) * angle);
  // ang is bounded ≈ [π/4 - π/8·|angle|, ...] — for sane inputs well
  // within the safe trig range; keep safe_* defensively.
  let cosa = safe_cos(ang);
  let sina = safe_sin(ang);
  let rat = 6.0 + 2.0 * ratio;
  var r2_4 = p.x * p.x + p.y * p.y + 4.0;
  if (r2_4 == 0.0) { r2_4 = 1.0; }
  let bx = 4.0 / r2_4;
  let by = rat / r2_4;
  let xRot = cosa * (bx * p.x) - sina * (by * p.y);
  let yRot = sina * (bx * p.x) + cosa * (by * p.y);
  // Per source: positive x preserves y, non-positive x mirrors y.
  let y_signed = select(-yRot, yRot, xRot > 0.0);
  return vec2f(w * xRot, w * y_signed);
}

// var_xhyperbol — Xyrus02 xhyperbol plugin (apophysis-plugins). 6
// params (m00, m01, m10, m11, m20, m21). No RNG. "Extended hyperbolic":
// applies a unit-disc inversion, runs the result through a 2x3 affine,
// then re-emits as |z'|²·(cos α, sin α). Source's epsilon (1e-300) is
// f64; pyr3 uses EPS (1e-10) — same role (avoid /0 at origin) and
// safely above Dawn's FTZ cliff (~1.18e-38).
fn var_xhyperbol(p: vec2f, w: f32, m00: f32, m01: f32, m10: f32, m11: f32, m20: f32, m21: f32) -> vec2f {
  let r = 1.0 / (p.x * p.x + p.y * p.y + EPS);
  let x = p.x * r;
  let y = p.y * r;
  let re = m00 * x + m01 * y + m20;
  let im = m10 * x + m11 * y + m21;
  // Source adds M_2PI to the angle: 2π-periodic for cos/sin so this is
  // mathematically a no-op; preserve for parity.
  let alpha = atan2(im, re) + TAU;
  // |alpha| ≤ 3π — plain trig is fine; safe_* defensively.
  let sa = safe_sin(alpha);
  let ca = safe_cos(alpha);
  let rsq = re * re + im * im;
  let xout = rsq * ca;
  let yout = rsq * sa;
  // #169: Apophysis source writes the final emission with `=` (not the
  // usual `+=` accumulation onto pVarTP). The renormalization by
  // `w / |z'|²` makes the result scale-invariant in the inversion, which
  // is the documented xhyperbol behavior — keep verbatim.
  let rinv = w / (xout * xout + yout * yout + EPS);
  return vec2f(xout * rinv, yout * rinv);
}

// var_xcurl2 — Xyrus02 xcurl2 plugin (apophysis-plugins). 3 params
// (c1, c2, c3). No RNG. DIFFERENT polynomial from V121 `curl2` (see
// V table comment). Source's own header says "old, probably wrong
// version of curl2" — but pyr3 ships both because the visual character
// differs. Also note the `y·re + x·im` SUM (not the standard Cartesian-
// inverse SIGN flip) — preserved verbatim from source.
fn var_xcurl2(p: vec2f, w: f32, c1: f32, c2: f32, c3: f32) -> vec2f {
  let x = p.x;
  let y = p.y;
  let x2 = x * x;
  let y2 = y * y;
  let x3 = x2 * x;
  let re = 1.0 + c1 * x + c2 * (x2 - y2) + c3 * (x3 - 3.0 * x);
  let im = c1 * y + c2 * (2.0 * x * y) + c3 * (3.0 * x * y - 1.0);
  let denom = re * re + im * im;
  let r = w / denom;
  return vec2f((x * re + y * im) * r, (y * re + x * im) * r);
}

// var_xtrb — Xyrus02 xtrb plugin (apophysis-plugins). 6 params
// (xtrb_power, xtrb_dist, xtrb_radius, xtrb_width, xtrb_a, xtrb_b).
// RNG: 2 calls per iter (one rand01 for the width-blend branch, one
// for the angle-modulo index in [0, abs(power))). Heavy precalc — 18
// derived geometry values computed inline (flam3 caches at xform
// load; pyr3 recomputes per iter since GPU params are per-dispatch).
//
// The Hex routine has 16 conditional branches doing tri-linear coord
// transforms; structure mirrors the source verbatim. xtrb_power must
// be a nonzero integer (source default 2); we trunc + min(1).
fn var_xtrb(p: vec2f, w: f32, power_in: f32, dist: f32, radius: f32, width: f32, a_param: f32, b_param: f32, wi: u32) -> vec2f {
  let power_i = max(1, i32(power_in));
  let power_f = f32(power_i);

  let angle_Br = 0.047 + a_param;
  let angle_Cr = 0.047 + b_param;
  let angle_Ar = PI - angle_Br - angle_Cr;

  // 0.5·angle_* ∈ small bounded range for sane (a, b) — plain trig fine.
  let sinA2 = safe_sin(0.5 * angle_Ar);
  let cosA2 = safe_cos(0.5 * angle_Ar);
  let sinB2 = safe_sin(0.5 * angle_Br);
  let cosB2 = safe_cos(0.5 * angle_Br);
  let sinC2 = safe_sin(0.5 * angle_Cr);
  let cosC2 = safe_cos(0.5 * angle_Cr);
  let sinC = safe_sin(angle_Cr);
  let cosC = safe_cos(angle_Cr);

  let aSide = radius * (sinC2 / cosC2 + sinB2 / cosB2);
  let bSide = radius * (sinC2 / cosC2 + sinA2 / cosA2);
  let cSide = radius * (sinB2 / cosB2 + sinA2 / cosA2);

  let width1 = 1.0 - width;
  let width2 = 2.0 * width;
  let width3 = 1.0 - width * width;

  let S2 = radius * (aSide + bSide + cSide);
  let Ha = S2 / aSide / 6.0;
  let Hb = S2 / bSide / 6.0;
  let Hc = S2 / cSide / 6.0;

  let ab = aSide / bSide;
  let ac = aSide / cSide;
  let ba = bSide / aSide;
  let bc = bSide / cSide;
  let ca = cSide / aSide;
  let cb = cSide / bSide;
  let S2a = 6.0 * Ha;
  let S2b = 6.0 * Hb;
  let S2c = 6.0 * Hc;
  let S2bc = S2 / (bSide + cSide) / 6.0;
  let S2ab = S2 / (aSide + bSide) / 6.0;
  let S2ac = S2 / (aSide + cSide) / 6.0;

  let absN = u32(abs(power_i));
  let cN = dist / power_f / 2.0;

  // DirectTrilinear inline:
  let U = p.y + radius;
  let V = p.x * sinC - p.y * cosC + radius;
  let Alpha0 = U;
  let Beta0 = V;

  let M = floor(Alpha0 / S2a);
  var OffsetAl = Alpha0 - M * S2a;
  let N = floor(Beta0 / S2b);
  var OffsetBe = Beta0 - N * S2b;
  var OffsetGa = S2c - ac * OffsetAl - bc * OffsetBe;

  let R = rand01(wi);

  // Track whether we entered the negative-Ga (mirrored) branch — the
  // final Alpha/Beta reassembly differs in that case.
  let neg = OffsetGa <= 0.0;
  if (neg) {
    OffsetAl = S2a - OffsetAl;
    OffsetBe = S2b - OffsetBe;
    OffsetGa = -OffsetGa;
  }

  // Hex routine (inlined). Local Al/Be/Ga = offset values; Al1/Be1 =
  // hex-transformed; De1/Ga1 are scratch.
  let Al = OffsetAl;
  let Be = OffsetBe;
  let Ga = OffsetGa;
  var Al1: f32 = 0.0;
  var Be1: f32 = 0.0;
  var Ga1: f32 = 0.0;
  var De1: f32 = 0.0;
  if (Be < Al) {
    if (Ga < Be) {
      if (R >= width3) {
        De1 = width * Be;
        Ga1 = width * Ga;
      } else {
        Ga1 = width1 * Ga + width2 * Hc * Ga / Be;
        De1 = width1 * Be + width2 * S2ab * (3.0 - Ga / Be);
      }
      Al1 = S2a - ba * De1 - ca * Ga1;
      Be1 = De1;
    } else {
      if (Ga < Al) {
        if (R >= width3) {
          Ga1 = width * Ga;
          De1 = width * Be;
        } else {
          De1 = width1 * Be + width2 * Hb * Be / Ga;
          Ga1 = width1 * Ga + width2 * S2ac * (3.0 - Be / Ga);
        }
        Al1 = S2a - ba * De1 - ca * Ga1;
        Be1 = De1;
      } else {
        if (R >= width3) {
          Al1 = width * Al;
          Be1 = width * Be;
        } else {
          Be1 = width1 * Be + width2 * Hb * Be / Al;
          Al1 = width1 * Al + width2 * S2ac * (3.0 - Be / Al);
        }
      }
    }
  } else {
    if (Ga < Al) {
      if (R >= width3) {
        De1 = width * Al;
        Ga1 = width * Ga;
      } else {
        Ga1 = width1 * Ga + width2 * Hc * Ga / Al;
        De1 = width1 * Al + width2 * S2ab * (3.0 - Ga / Al);
      }
      Be1 = S2b - ab * De1 - cb * Ga1;
      Al1 = De1;
    } else {
      if (Ga < Be) {
        if (R >= width3) {
          Ga1 = width * Ga;
          De1 = width * Al;
        } else {
          De1 = width1 * Al + width2 * Ha * Al / Ga;
          Ga1 = width1 * Ga + width2 * S2bc * (3.0 - Al / Ga);
        }
        Be1 = S2b - ab * De1 - cb * Ga1;
        Al1 = De1;
      } else {
        if (R >= width3) {
          Be1 = width * Be;
          Al1 = width * Al;
        } else {
          Al1 = width1 * Al + width2 * Ha * Al / Be;
          Be1 = width1 * Be + width2 * S2bc * (3.0 - Al / Be);
        }
      }
    }
  }

  var Alpha = Al1;
  var Beta = Be1;
  if (neg) {
    Alpha = S2a - Alpha;
    Beta = S2b - Beta;
  }
  Alpha = Alpha + M * S2a;
  Beta = Beta + N * S2b;

  // InverseTrilinear inline:
  let inx = (Beta - radius + (Alpha - radius) * cosC) / sinC;
  let iny = Alpha - radius;
  // Source: `rand() % absN`. Use a second rand01 sample modulo absN.
  // Cast to u32 (absN ≥ 1) — sample lands in [0, absN-1].
  let branch_u = select(0u, u32(rand01(wi) * f32(absN)), absN > 0u);
  let branch_f = f32(branch_u);
  // Angle arg is bounded by 2π·branch/|power| + atan2 ∈ [-π, π], scaled
  // by 1/power → safe trig OK below ~ 2π·256 even at large counts.
  let angle = (atan2(iny, inx) + TAU * branch_f) / power_f;
  // Source: pow(inx² + iny², cN). cN can be negative or fractional;
  // pow handles both, but a zero base with negative exponent → ±Inf.
  // Source has no guard; we follow (chaos game reseed handles it).
  // JWF applies pAmount twice: r = pAmount·pow(...) AND pVarTP.x += pAmount·X
  // (XTrbFunc.java:287,294). Mirror — output magnitude is w²·pow(...).
  let r_pow = pow(inx * inx + iny * iny, cN);
  return vec2f(w * w * r_pow * safe_cos(angle), w * w * r_pow * safe_sin(angle));
}

// var_xyrus_gridout — Xyrus02 gridout plugin (apophysis-plugins).
// 0 params. No RNG. Quantizes the iterate by ±1 in x or y depending
// on which integer-grid quadrant (rint(x), rint(y)) it falls into.
// Stair-step / cubist look.
//
// NOT the same as pyr3's V101 `dc_gridout` (color variation). Source's
// rint() = half-away-from-zero (NOT C99 default half-to-even); we
// mirror via floor/ceil with 0.5 bias.
fn var_xyrus_gridout(p: vec2f, w: f32) -> vec2f {
  let x = p.x;
  let y = p.y;
  let rx = select(ceil(x - 0.5), floor(x + 0.5), x >= 0.0);
  let ry = select(ceil(y - 0.5), floor(y + 0.5), y >= 0.0);
  var dx: f32 = 0.0;
  var dy: f32 = 0.0;
  if (ry <= 0.0) {
    if (rx > 0.0) {
      if (-ry >= rx) { dx = 1.0; } else { dy = 1.0; }
    } else {
      if (ry <= rx) { dx = 1.0; } else { dy = -1.0; }
    }
  } else {
    if (rx > 0.0) {
      if (ry >= rx) { dx = -1.0; } else { dy = 1.0; }
    } else {
      if (ry > -rx) { dx = -1.0; } else { dy = -1.0; }
    }
  }
  return vec2f(w * (x + dx), w * (y + dy));
}

// var_blur_circle — Xyrus02 blur_circle plugin (apophysis-plugins).
// 1 param (hole). RNG: 2 calls per iter (the (x,y) samples uniformly
// from [-1,1]²). Input p is IGNORED — output is purely RNG-driven.
//
// Author: xyrus02. "Disc-uniform blur" via square→circle perimeter
// parameterization (same family as circlize / circlize2). Source uses
// precomputed VVAR4_PI = w · 4/π; we inline.
//
// The kernel needs two distinct rand01 samples. Pulled sequentially via
// `rand01(wi)` calls — the per-walker ISAAC stream advances internally,
// so two back-to-back calls yield distinct draws.
fn var_blur_circle(p: vec2f, w: f32, hole: f32, wi: u32) -> vec2f {
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let x = 2.0 * r0 - 1.0;
  let y = 2.0 * r1 - 1.0;
  let absx = abs(x);
  let absy = abs(y);
  let s = select(absy, absx, absx > absy);
  let a = atan2(y, x);
  let PI3_4: f32 = 3.0 * PI / 4.0;
  let PI_4: f32 = PI / 4.0;
  var ps: f32 = 0.0;
  if (a < -PI3_4) {
    ps = absy;
  } else if (a < -PI_4) {
    ps = 2.0 * s + x;
  } else if (a < PI_4) {
    ps = 4.0 * s + y;
  } else if (a < PI3_4) {
    ps = 6.0 * s - x;
  } else {
    ps = 8.0 * s - y;
  }
  // Source has no s==0 guard; produces NaN there (both rands == 0.5
  // exactly). Mirror — chaos-game reseed cleans up.
  let r = (w * 4.0 / PI) * s + hole;
  let phi = PI_4 * ps / s - PI;
  // phi ∈ [-π, +π/2]-ish (bounded by ps/s and the constant offset);
  // plain trig is safe.
  return vec2f(r * safe_cos(phi), r * safe_sin(phi));
}

// ---------------------------------------------------------------------
// #120 — M-tier port. First batch starts with `bipolar2` (Brad Stefanov's
// 9-param rework of bipolar) since it's the variation that drove the
// seam expand 8→10. Subsequent batches land in this region too.
// ---------------------------------------------------------------------

// var_bipolar2 — JWildfire Bipolar2Func.java. 9 params (shift, a, b, c, d,
// e, f1, g1, h). "Bipolar in the Apophysis Plugin Pack with variables added
// by Brad Stefanov" — first variation to consume the post-#120 expanded
// seam (param8). Defaults: shift=0, a=1, b=2, c=0.5, d=1, e=2, f1=0.25,
// g1=1, h=1 — at the defaults this matches the spirit of base var_bipolar
// (V35) but with the extra tunables Stefanov added to break symmetry.
//
// Explicit (g == 0 || f/g <= 0) skip returns (0, 0) — matches JWildfire's
// early-return semantics where the variation simply contributes nothing
// for that walker step. The fmod ops stay in safe bounds (operands always
// positive on their entry path); WGSL `%` matches C `fmod` there.
fn var_bipolar2(
  p: vec2f, w: f32,
  shift: f32, a: f32, b: f32, c: f32,
  d: f32, e: f32, f1: f32, g1: f32, h: f32,
) -> vec2f {
  let HALF_PI: f32 = PI * 0.5;
  let TWO_OVER_PI: f32 = 2.0 / PI;
  let x2y2 = (p.x * p.x + p.y * p.y) * g1;
  let t = x2y2 + a;
  let x2 = b * p.x;
  let ps = -HALF_PI * shift;
  var y = c * atan2(e * p.y, x2y2 - d) + ps;
  if (y > HALF_PI) {
    y = -HALF_PI + ((y + HALF_PI) % PI);
  } else if (y < -HALF_PI) {
    y = HALF_PI - ((HALF_PI - y) % PI);
  }
  let fnum = t + x2;
  let gnum = t - x2;
  if (gnum == 0.0 || (fnum / gnum) <= 0.0) {
    return vec2f(0.0, 0.0);
  }
  return vec2f(
    w * f1 * TWO_OVER_PI * log(fnum / gnum),
    w * TWO_OVER_PI * y * h,
  );
}

// var_bubble2 — JWildfire Bubble2Func.java. 2D PROJECTION of the source
// 3D variation (drop z dim, drop z param) — same precedent as the #114
// falloff family. Source: "bubble2 from FracFx" (LGPL-2.1+, NOTICE.md).
// 2 params (x_scale, y_scale). Defaults x=1, y=1 — at the defaults this
// matches var_bubble (V20) exactly. Non-default x/y break the radial
// symmetry into an axis-anisotropic bubble.
fn var_bubble2(p: vec2f, w: f32, x_scale: f32, y_scale: f32) -> vec2f {
  // T = (x² + y²) / 4 + 1 (z² dropped by 2D projection); always >= 1.
  let r = w / (0.25 * dot(p, p) + 1.0);
  return vec2f(p.x * r * x_scale, p.y * r * y_scale);
}

// ---------------------------------------------------------------------
// #120 batch B3 — inverse hyperbolic family (6 vars). Sources: JWildfire
// AcoshFunc / ArcsinhFunc / ArctanhFunc / AcothFunc / AcosechFunc /
// Arcsech2Func (LGPL-2.1+, see NOTICE.md). Authors: Whittaker Courtney
// (acosh / acoth / acosech, based on the hyperbolic variations by
// Tatyana Zabanova + DarkBeam) and Tatyana Zabanova 2017 / DarkBeam 2018
// (arcsinh / arctanh / arcsech2). 0 params each; all scale by w · 2/π
// (arcsech2 by w · 2/π too — its asymmetric ±1 tail is constant). Two
// of the six (acosh, acosech) end with a 50/50 RNG sign flip; the other
// four are fully deterministic. Compose the complex_* primitives above.
// ---------------------------------------------------------------------

// acosh: log(z + sqrt(z² - 1)), then scale, then 50/50 sign flip.
fn var_acosh(p: vec2f, w: f32, wi: u32) -> vec2f {
  let d = complex_sqrt(complex_sqr(p) - vec2f(1.0, 0.0));
  let z = complex_log(p + d) * (w * 2.0 / PI);
  let sign = select(1.0, -1.0, rand01(wi) >= 0.5);
  return sign * z;
}

// arcsinh: log(z + sqrt(z² + 1)), then scale. Deterministic.
fn var_arcsinh(p: vec2f, w: f32) -> vec2f {
  let d = complex_sqrt(complex_sqr(p) + vec2f(1.0, 0.0));
  return complex_log(p + d) * (w * 2.0 / PI);
}

// arctanh: log((z+1)/(1-z)), then scale. NOTE: JWildfire skips the
// 0.5 factor that real atanh would include, so this is effectively
// (2 · atanh(z)) · w · 2/π — verbatim port of ArctanhFunc.java.
// Deterministic.
fn var_arctanh(p: vec2f, w: f32) -> vec2f {
  let num = p + vec2f(1.0, 0.0);
  let den = vec2f(1.0, 0.0) - p;
  return complex_log(complex_div(num, den)) * (w * 2.0 / PI);
}

// acoth: AcotH(z) = AtanH(1/z) = 0.5 · log((1/z + 1)/(1 - 1/z)). Then
// Flip (re ↔ im swap) and scale. Deterministic.
fn var_acoth(p: vec2f, w: f32) -> vec2f {
  let rz = complex_recip(p);
  let num = rz + vec2f(1.0, 0.0);
  let den = vec2f(1.0, 0.0) - rz;
  let atanh_val = 0.5 * complex_log(complex_div(num, den));
  // Flip: swap re ↔ im
  let flipped = vec2f(atanh_val.y, atanh_val.x);
  return flipped * (w * 2.0 / PI);
}

// acosech: AcosecH(z) = AcosH(1/z) = log(1/z + sqrt(1/z² - 1)). Then
// Flip + scale + 50/50 sign flip.
fn var_acosech(p: vec2f, w: f32, wi: u32) -> vec2f {
  let rz = complex_recip(p);
  let d = complex_sqrt(complex_sqr(rz) - vec2f(1.0, 0.0));
  let acosh_rz = complex_log(rz + d);
  let flipped = vec2f(acosh_rz.y, acosh_rz.x) * (w * 2.0 / PI);
  let sign = select(1.0, -1.0, rand01(wi) >= 0.5);
  return sign * flipped;
}

// arcsech2: log(1/z + sqrt(1/z² - 1)) via the decomposed-sqrt form
// sqrt(z-1)·sqrt(z+1), then asymmetric output with a UNWEIGHTED ±1
// constant on py based on the sign of the scaled-log's imaginary part.
// The ±1 tail is verbatim from JWildfire — independent of w (yes, this
// is surprising, but Arcsech2Func.java does it). Deterministic.
fn var_arcsech2(p: vec2f, w: f32) -> vec2f {
  let z = complex_recip(p);
  let z_sub = complex_sqrt(z - vec2f(1.0, 0.0));   // sqrt(z-1)
  let z_add = complex_sqrt(z + vec2f(1.0, 0.0));   // sqrt(z+1)
  let lg = complex_log(z + complex_mul(z_add, z_sub)) * (w * 2.0 / PI);
  // im<0 branch: px += re, py += 1
  // else:        px -= re, py -= 1
  let neg = lg.y < 0.0;
  let px = select(-lg.x, lg.x, neg);
  let py = select(lg.y - 1.0, lg.y + 1.0, neg);
  return vec2f(px, py);
}

// var_cell2 — JWildfire Cell2Func.java (Brad Stefanov; "Cell in the
// Apophysis Plugin Pack" + Stefanov's per-quadrant variables). The
// source ships 16 params; pyr3 ships a 6-param N/S-asymmetric SUBSET
// that fits the 10-cap seam. See #127 for the seam-expand discussion
// if the full 16-param surface ever matters.
//
// Subset choice rationale (#120 B3.5):
//   KEPT:    size, a, space_north_x, space_north_y, space_south_x,
//            space_south_y — preserves cell2's distinctive top/bottom-
//            different cellular tile, the visual identity of cell2 vs
//            cell (V75).
//   DROPPED: mirror_x/mirror_y (RNG-driven 50/50 flips — small effect,
//            adds an RNG draw); per-quadrant E/W asymmetry (collapsed
//            into single N/S scale pair); per-quadrant move offsets
//            (move_xa/ya/xb/yb — small positional jitters); the z dim
//            (per pyr3 2D-only convention).
//
// The JWildfire formula's south branch always negates y (y = -space·y);
// the output's final y also gets a sign-flip (-w · (dy + cell·size)).
// Both preserved here — they're load-bearing for cell2's look.
fn var_cell2(
  p: vec2f, w: f32,
  size: f32, a: f32,
  space_north_x: f32, space_north_y: f32,
  space_south_x: f32, space_south_y: f32,
) -> vec2f {
  // size floor — avoid /0 if user sliders the param to 0.
  let safe_size = select(size, 1e-30, abs(size) < 1e-30);
  let inv_cell_size = a / safe_size;
  let cell_x = floor(p.x * inv_cell_size);
  let cell_y = floor(p.y * inv_cell_size);
  let dx = p.x - cell_x * safe_size;
  let dy = p.y - cell_y * safe_size;
  var sx: f32 = cell_x;
  var sy: f32 = cell_y;
  if (sy >= 0.0) {
    sy = sy * space_north_y;
    sx = sx * space_north_x;
  } else {
    sy = -space_south_y * sy;
    sx = sx * space_south_x;
  }
  return vec2f(w * (dx + sx * safe_size), -w * (dy + sy * safe_size));
}

// ---------------------------------------------------------------------
// #120 batch B4 — Xyrus02 + Lu-Kout remainders (5 vars). Sources:
// JWildfire CurlSpFunc / Murl2Func / LissajousFunc / SpirographFunc /
// WaffleFunc (LGPL-2.1+, see NOTICE.md). Authors: Xyrus02 (curl_sp),
// Peter Sdobnov a.k.a. Zueuk + Nic Anderson (murl2), Jed Kelsey
// a.k.a. Lu-Kout (lissajous, spirograph, waffle). MandelbrotFunc was
// audited and intentionally DEFERRED (12 params + iterative inner
// loop + per-walker state — not a drop-in port, deserves its own
// architectural ship).
// ---------------------------------------------------------------------

// curl_sp — Xyrus02 spherical curl. Source ships 6 params; pyr3 drops
// `dc` (a color-output param; pyr3's chain doesn't expose color from
// non-DC variations). Helpers powq4c / spread / range are inlined.
// Deterministic.
fn var_curl_sp(
  p: vec2f, w: f32,
  pow_p: f32, c1: f32, c2: f32, sx: f32, sy: f32,
) -> vec2f {
  // SMALL_EPSILON guard on power; mirrors JWildfire init().
  let power = select(pow_p, 1e-30, pow_p == 0.0);
  let power_inv = 1.0 / power;
  let c2_x2 = 2.0 * c2;
  // powq4c(x, y) = (y == 1) ? x : pow(|x|, y) * sign(x)
  // For runtime y the fast path doesn't compile-time fold, so we
  // always go through the slow path — that matches what JWildfire's
  // GPU code does too.
  let x = pow(abs(p.x), power) * sign(p.x);
  let y = pow(abs(p.y), power) * sign(p.y);
  let d = x * x - y * y;
  // spread(a, b) = sqrt(a²+b²) · sign(a)
  let s1_arg_a = c1 * x + c2 * d;
  let s1_arg_b = sx;
  let re = sqrt(s1_arg_a * s1_arg_a + s1_arg_b * s1_arg_b) * select(-1.0, 1.0, s1_arg_a > 0.0) + 1.0;
  let s2_arg_a = c1 * y + c2_x2 * x * y;
  let s2_arg_b = sy;
  let im = sqrt(s2_arg_a * s2_arg_a + s2_arg_b * s2_arg_b) * select(-1.0, 1.0, s2_arg_a > 0.0);
  let c = pow(abs(re * re + im * im), power_inv);
  let r = w / max(c, 1e-30);
  return vec2f(
    (x * re + y * im) * r,
    (y * re - x * im) * r,
  );
}

// murl2 — Peter Sdobnov ("Zueuk") via Nic Anderson. 2 params (c, power).
// Polar power + complex inverse + radial division. The power is
// nominally an int in JWildfire (cast at setParameter); we accept f32
// and let WGSL pow() handle non-integer values too.
// Deterministic.
fn var_murl2(p: vec2f, w: f32, c: f32, power_f: f32) -> vec2f {
  let p2 = power_f * 0.5;
  // power == 0 → degenerate branch in JWildfire (invp = 1e11, vp scaled
  // by (c+1)^4). We use SMALL_EPSILON to avoid the explicit check while
  // still producing a finite output.
  let safe_pow = select(power_f, 1e-30, power_f == 0.0);
  let invp = 1.0 / safe_pow;
  // vp = w · (c+1)^(2/power) — JWildfire branches on c==-1 to set vp=0;
  // pow(0, x) returns 0 for x>0 so the natural formula handles it.
  let cp1 = c + 1.0;
  let vp = w * pow(abs(cp1), 2.0 * invp) * select(-1.0, 1.0, cp1 >= 0.0);
  let a1 = atan2(p.y, p.x) * safe_pow;
  let r0 = c * pow(abs(dot(p, p)), p2);
  let re0 = r0 * cos(a1) + 1.0;
  let im0 = r0 * sin(a1);
  let r1 = pow(abs(re0 * re0 + im0 * im0), invp);
  let a2 = atan2(im0, re0) * 2.0 * invp;
  let re1 = r1 * cos(a2);
  let im1 = r1 * sin(a2);
  let rl = vp / max(r1 * r1, 1e-30);
  return vec2f(
    rl * (p.x * re1 + p.y * im1),
    rl * (p.y * re1 - p.x * im1),
  );
}

// lissajous — Jed Kelsey (Lu-Kout). 7 params. RNG-driven: 2 random
// draws per call (t and y_jitter). Coordinates lie on a 2D Lissajous
// curve x = sin(a·t + d), y = sin(b·t), with a shared linear drift
// (c·t + e·y_jitter) added to both. Outputs ignore the input iterate
// (chaos-game shape comes purely from the curve geometry + drift).
fn var_lissajous(
  p: vec2f, w: f32,
  tmin: f32, tmax: f32,
  a: f32, b: f32, c: f32, d: f32, e: f32,
  wi: u32,
) -> vec2f {
  let t = (tmax - tmin) * rand01(wi) + tmin;
  let yj = rand01(wi) - 0.5;
  let drift = c * t + e * yj;
  return vec2f(
    w * (safe_sin(a * t + d) + drift),
    w * (safe_sin(b * t) + drift),
  );
}

// spirograph — Jed Kelsey (Lu-Kout). 9 params — fills the post-#120
// 10-cap seam. RNG-driven: 2 random draws (t in [tmin, tmax], y_jitter
// in [ymin, ymax]). Classic spirograph parametric curve x = (a+b)cos t
// − c₁·cos((a+b)/b · t), y = analogous with sin. Like lissajous, the
// input iterate doesn't shape the output — the chaos game's randomness
// drives it.
fn var_spirograph(
  p: vec2f, w: f32,
  a: f32, b: f32, d: f32,
  tmin: f32, tmax: f32,
  ymin: f32, ymax: f32,
  c1: f32, c2: f32,
  wi: u32,
) -> vec2f {
  let t = (tmax - tmin) * rand01(wi) + tmin;
  let yj = (ymax - ymin) * rand01(wi) + ymin;
  let ab = a + b;
  // Guard against b==0 (would NaN the ratio); fall back to identity.
  let safe_b = select(b, 1e-30, abs(b) < 1e-30);
  let ratio = ab / safe_b;
  let x1 = ab * safe_cos(t) - c1 * safe_cos(ratio * t);
  let y1 = ab * safe_sin(t) - c2 * safe_sin(ratio * t);
  return vec2f(
    w * (x1 + d * safe_cos(t) + yj),
    w * (y1 + d * safe_sin(t) + yj),
  );
}

// waffle — Jed Kelsey (Lu-Kout). 4 params + rotation. RNG-heavy:
// uses rand01 + rand_int(5) to pick a "mode" (5 cell-placement
// strategies), plus 1-3 more rand01 draws inside each mode. Produces
// a rotated waffle / grid texture. Input iterate ignored.
//
// JWildfire's slices is an int — we treat as f32 with floor at the
// `rand_int` call. The init() precalc (vcosr, vsinr) is inlined per
// call; cheap on GPU.
fn var_waffle(
  p: vec2f, w: f32,
  slices_f: f32, xthickness: f32, ythickness: f32, rotation: f32,
  wi: u32,
) -> vec2f {
  // slices clamped to [1, 64] to keep rand_int range sensible.
  let slices = max(1.0, floor(abs(slices_f)));
  let inv_slices = 1.0 / slices;
  let vcosr = w * safe_cos(rotation);
  let vsinr = w * safe_sin(rotation);
  // Mode pick: floor(rand01 · 5) ∈ {0,1,2,3,4}
  let mode = u32(min(4.0, floor(rand01(wi) * 5.0)));
  var a: f32 = 0.0;
  var r: f32 = 0.0;
  if (mode == 0u) {
    a = (floor(rand01(wi) * slices) + rand01(wi) * xthickness) * inv_slices;
    r = (floor(rand01(wi) * slices) + rand01(wi) * ythickness) * inv_slices;
  } else if (mode == 1u) {
    a = (floor(rand01(wi) * slices) + rand01(wi)) * inv_slices;
    r = (floor(rand01(wi) * slices) + ythickness) * inv_slices;
  } else if (mode == 2u) {
    a = (floor(rand01(wi) * slices) + xthickness) * inv_slices;
    r = (floor(rand01(wi) * slices) + rand01(wi)) * inv_slices;
  } else if (mode == 3u) {
    a = rand01(wi);
    r = (floor(rand01(wi) * slices) + ythickness + rand01(wi) * (1.0 - ythickness)) * inv_slices;
  } else {
    a = (floor(rand01(wi) * slices) + xthickness + rand01(wi) * (1.0 - xthickness)) * inv_slices;
    r = rand01(wi);
  }
  return vec2f(
    vcosr * a + vsinr * r,
    -vsinr * a + vcosr * r,
  );
}

// ---------------------------------------------------------------------
// #120 batch B5 — Glynn-set family (3 vars). Source: JWildfire
// GlynnSim1/2/3 Func.java (LGPL-2.1+, NOTICE.md), all by eralex61
// (deviantart.com/eralex61). All three are circle-emit-vs-passthrough
// patterns: inside a radius the kernel emits a random point on a
// circle (different per-variation shape); outside it either passes
// through or applies the alpha² circle inversion based on an RNG-
// contrast roll. The 2D-only siblings of GlynnSim2B (3D-rotated, 26
// params) — which is deferred to its own architectural ship.
//
// Phi parameters are in DEGREES in JWildfire; converted inline to
// radians via PI/180.
// ---------------------------------------------------------------------

// glynnSim1 — 6 params. Most complex of the trio: emits inner circle
// at (radius·cos(phi1), radius·sin(phi1)) offset, and the outside
// branch additionally re-emits inner-circle if the alpha²-inverted
// coord lands back inside the inner circle's radius1 bubble.
fn var_glynnSim1(
  p: vec2f, w: f32,
  radius: f32, radius1: f32, phi1: f32, thickness: f32, pow_p: f32, contrast: f32,
  wi: u32,
) -> vec2f {
  let DEG_TO_RAD = PI / 180.0;
  let a = phi1 * DEG_TO_RAD;
  let x1 = radius * safe_cos(a);
  let y1 = radius * safe_sin(a);
  let abs_pow = abs(pow_p);
  let r = sqrt(dot(p, p));
  if (r < radius) {
    let r_inner = radius1 * (thickness + (1.0 - thickness) * rand01(wi));
    let phi = TAU * rand01(wi);
    return w * vec2f(r_inner * safe_cos(phi) + x1, r_inner * safe_sin(phi) + y1);
  }
  let safe_r = max(r, 1e-30);
  let alpha = radius / safe_r;
  var x: f32;
  var y: f32;
  if (rand01(wi) > contrast * pow(abs(alpha), abs_pow)) {
    x = p.x;
    y = p.y;
  } else {
    let a2 = alpha * alpha;
    x = a2 * p.x;
    y = a2 * p.y;
  }
  let dxz = x - x1;
  let dyz = y - y1;
  let z = dxz * dxz + dyz * dyz;
  if (z < radius1 * radius1) {
    let r_inner = radius1 * (thickness + (1.0 - thickness) * rand01(wi));
    let phi = TAU * rand01(wi);
    return w * vec2f(r_inner * safe_cos(phi) + x1, r_inner * safe_sin(phi) + y1);
  }
  return w * vec2f(x, y);
}

// glynnSim2 — 6 params. Inner circle uses a (phi1, phi2) angular arc:
// phi varies in [_phi10, _phi10 + _delta], r varies in
// [radius, radius+thickness] (gamma-tightened). Outside branch is
// passthrough or alpha² without the re-emit check.
fn var_glynnSim2(
  p: vec2f, w: f32,
  radius: f32, thickness: f32, contrast: f32, pow_p: f32, phi1: f32, phi2: f32,
  wi: u32,
) -> vec2f {
  let DEG_TO_RAD = PI / 180.0;
  let phi10 = phi1 * DEG_TO_RAD;
  let phi20 = phi2 * DEG_TO_RAD;
  let r_plus_t = radius + thickness;
  let denom = max(r_plus_t, 1e-30);
  let gamma = thickness * (2.0 * radius + thickness) / denom;
  let delta = phi20 - phi10;
  let abs_pow = abs(pow_p);
  let r = sqrt(dot(p, p));
  if (r < radius) {
    let r_inner = r_plus_t - gamma * rand01(wi);
    let phi_inner = phi10 + delta * rand01(wi);
    return w * vec2f(r_inner * safe_cos(phi_inner), r_inner * safe_sin(phi_inner));
  }
  let safe_r = max(r, 1e-30);
  let alpha = radius / safe_r;
  if (rand01(wi) > contrast * pow(abs(alpha), abs_pow)) {
    return w * p;
  }
  let a2 = alpha * alpha;
  return w * vec2f(a2 * p.x, a2 * p.y);
}

// glynnSim3 — 4 params. Simplest: precomputes inner/outer radii
// (radius1 = radius+thickness, radius2 = radius²/radius1); inner
// circle is one of two radii chosen by a gamma RNG roll.
fn var_glynnSim3(
  p: vec2f, w: f32,
  radius: f32, thickness: f32, contrast: f32, pow_p: f32,
  wi: u32,
) -> vec2f {
  let radius1 = radius + thickness;
  let safe_r1 = max(radius1, 1e-30);
  let radius2 = (radius * radius) / safe_r1;
  let gamma = radius1 / max(radius1 + radius2, 1e-30);
  let abs_pow = abs(pow_p);
  let r = sqrt(dot(p, p));
  if (r < radius1) {
    let phi = TAU * rand01(wi);
    let r_inner = select(radius2, radius1, rand01(wi) < gamma);
    return w * vec2f(r_inner * safe_cos(phi), r_inner * safe_sin(phi));
  }
  let safe_r = max(r, 1e-30);
  let alpha = radius / safe_r;
  if (rand01(wi) > contrast * pow(abs(alpha), abs_pow)) {
    return w * p;
  }
  let a2 = alpha * alpha;
  return w * vec2f(a2 * p.x, a2 * p.y);
}

// ---------------------------------------------------------------------
// #120 batch B6 — Faber/Xyrus02/zephyrtronium novelties (4 vars).
// Sources: JWildfire FlipYFunc (Michael Faber), EclipseFunc (Faber),
// BarycentroidFunc (Xyrus02), ChunkFunc (zephyrtronium via Brad
// Stefanov). All LGPL-2.1+, NOTICE.md. All deterministic.
// ---------------------------------------------------------------------

// flipy — Michael Faber. 0 params. Asymmetric sign flip on y based on
// the sign of x. Simplest variation in the family. x always passes
// through.
fn var_flipy(p: vec2f, w: f32) -> vec2f {
  let y_sign = select(1.0, -1.0, p.x > 0.0);
  return vec2f(w * p.x, w * p.y * y_sign);
}

// eclipse — Michael Faber. 1 param (shift, clamped [-2, 2] at the
// import boundary). Branchy geometry: when |y| ≤ w, computes c₂ =
// sqrt(w² - y²), then conditionally either passes through, applies a
// shift, or negates x. Outside |y| ≤ w, plain passthrough.
fn var_eclipse(p: vec2f, w: f32, shift: f32) -> vec2f {
  if (abs(p.y) <= w) {
    let c2_sq = w * w - p.y * p.y;
    let c2 = sqrt(max(c2_sq, 0.0));
    var ox: f32;
    if (abs(p.x) <= c2) {
      let x_shifted = p.x + shift * w;
      if (abs(x_shifted) >= c2) {
        ox = -w * p.x;
      } else {
        ox = w * x_shifted;
      }
    } else {
      ox = w * p.x;
    }
    return vec2f(ox, w * p.y);
  }
  return w * p;
}

// barycentroid — Xyrus02. 4 params (a, b, c, d). Treats (a, b) and
// (c, d) as two basis vectors v₀, v₁; the iterate p is v₂. Computes
// the barycentric coordinates (u, v) of p with respect to the
// triangle [0, v₀, v₁], then emits sqrt(u² + x²)·sign(u) on the
// x-axis and sqrt(v² + y²)·sign(v) on the y-axis. Deterministic.
fn var_barycentroid(p: vec2f, w: f32, a: f32, b: f32, c: f32, d: f32) -> vec2f {
  // Dot products of (v₀, v₁, v₂).
  let dot00 = a * a + b * b;
  let dot01 = a * c + b * d;
  let dot02 = a * p.x + b * p.y;
  let dot11 = c * c + d * d;
  let dot12 = c * p.x + d * p.y;
  // Degenerate triangle (collinear v₀ + v₁) → denom = 0 → identity.
  let denom = dot00 * dot11 - dot01 * dot01;
  if (abs(denom) < 1e-30) {
    return w * p;
  }
  let inv_denom = 1.0 / denom;
  let u = (dot11 * dot02 - dot01 * dot12) * inv_denom;
  let v = (dot00 * dot12 - dot01 * dot02) * inv_denom;
  // sign(0) returns 0 in WGSL — matches JWildfire's sgn helper.
  let um = sqrt(u * u + p.x * p.x) * sign(u);
  let vm = sqrt(v * v + p.y * p.y) * sign(v);
  return vec2f(w * um, w * vm);
}

// chunk — zephyrtronium via Brad Stefanov. 7 params (a, b, c, d, e,
// f, mode). Computes a quadratic form r = w·(a·x² + b·xy + c·y² +
// d·x + e·y + f) at the iterate, then conditionally emits the input
// passthrough (mode 0: when r ≤ 0; mode 1: when r > 0) or contributes
// nothing (zero output). NOTE: JWildfire's source applies `pAmount`
// (weight) to the quadratic-form coefficients, NOT to the output
// passthrough. The output is the raw input coord — pyr3 mirrors.
fn var_chunk(
  p: vec2f, w: f32,
  a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, mode_p: f32,
) -> vec2f {
  let aa = w * a;
  let bb = w * b;
  let cc = w * c;
  let dd = w * d;
  let ee = w * e;
  let ff = w * f;
  let r = aa * p.x * p.x + bb * p.x * p.y + cc * p.y * p.y + dd * p.x + ee * p.y + ff;
  let mode = i32(mode_p);
  if (mode == 0 && r <= 0.0) {
    return p;
  }
  if (mode == 1 && r > 0.0) {
    return p;
  }
  return vec2f(0.0, 0.0);
}

// ---------------------------------------------------------------------
// #121 batch L1 — JWildfire 2D long tail (7 vars). Sources: EnnepersFunc
// (Raykoid666), ErfFunc (zephyrtronium / dark-beam), CircusFunc (Michael
// Faber), AsteriaFunc (dark-beam), CliffordFunc (Paul Bourke / JWF as
// clifford_js), DevilWarpFunc (dark-beam), VoronFunc (eralex61). All
// LGPL-2.1+, NOTICE.md. ennepers/erf/circus/clifford_js/devil_warp/voron
// are deterministic; asteria uses 1 RNG call per iter (branch decision).
//
// Convention note (#121 batches L1..L14): JWildfire source files live at
// `src/org/jwildfire/create/tina/variation/<Name>Func.java` in the
// upstream repo (https://github.com/thargor6/JWildfire). Earlier #114/
// #117 ports cited full paths; L1..L14 kernels cite author + class name
// only (e.g. "Faber. AsteriaFunc.java") to keep headers compact — apply
// the path template above to resolve. Some classes carry a `Func2`
// numeric suffix (Bipolar2Func, Hypertile1Func) which preserves
// JWildfire's own naming.
// ---------------------------------------------------------------------

// ennepers — Raykoid666. 0 params. Polynomial fold derived from the
// Enneper minimal surface 2D projection. JWildfire's source uses `=`
// (overwrite) but pyr3's accumulating model ports the RHS as the
// contribution. The trailing `+ x·y²` term sits OUTSIDE the amount
// multiplication — that's the JWildfire quirk; reproduce verbatim.
fn var_ennepers(p: vec2f, w: f32) -> vec2f {
  let xx = p.x;
  let yy = p.y;
  let ox = w * (xx - (xx * xx * xx) / 3.0) + xx * yy * yy;
  let oy = w * (yy - (yy * yy * yy) / 3.0) + yy * xx * xx;
  return vec2f(ox, oy);
}

// erf — zephyrtronium / dark-beam. 0 params. Per-component error
// function. JWildfire ships no GPU code path for this; we port the
// CPU semantics. WGSL has no `erf` built-in — use Abramowitz & Stegun
// 7.1.26 approximation (5-term polynomial × sign(x), max abs error
// ≈ 1.5e-7, more than enough for visual work).
fn erf_approx(x: f32) -> f32 {
  let a1: f32 =  0.254829592;
  let a2: f32 = -0.284496736;
  let a3: f32 =  1.421413741;
  let a4: f32 = -1.453152027;
  let a5: f32 =  1.061405429;
  let pp: f32 =  0.3275911;
  let s = select(-1.0, 1.0, x >= 0.0);
  let ax = abs(x);
  let t = 1.0 / (1.0 + pp * ax);
  let poly = (((((a5 * t) + a4) * t + a3) * t + a2) * t + a1) * t;
  let y = 1.0 - poly * exp(-ax * ax);
  return s * y;
}
fn var_erf(p: vec2f, w: f32) -> vec2f {
  return vec2f(w * erf_approx(p.x), w * erf_approx(p.y));
}

// circus — Michael Faber. 1 param (scale). Polar transform with an
// inside/outside r=1 branch — radius gets multiplied by `scale` if
// the iterate is inside the unit circle, else by `1/scale`. Phase
// angle is preserved. Deterministic.
fn var_circus(p: vec2f, w: f32, scale: f32) -> vec2f {
  // Bake reciprocal at the callsite; if scale==0 the inside branch
  // collapses to origin (matches JWildfire's bare divide).
  let scale_1 = select(1.0 / scale, 1e30, scale == 0.0);
  let r = sqrt(p.x * p.x + p.y * p.y);
  let a = atan2(p.y, p.x);
  let s = sin(a);
  let c = cos(a);
  let r_scaled = select(r * scale_1, r * scale, r <= 1.0);
  return vec2f(w * r_scaled * c, w * r_scaled * s);
}

// asteria — dark-beam. 1 param (alpha, units of π radians for the
// rotation). Branchy geometry: tests both `r < 1` (inside unit circle)
// and `r2 < 1` (where r2 = √((|x|−1)² + (|y|−1)²)) — when both fire,
// flips a single RNG; otherwise inverts in1. Two output branches:
// identity (linear · amount) or the asteria geometry: rotate the
// iterate by α, project via nx = xx/√(1−yy²) · (1 − √(1−(1−|yy|)²)),
// rotate back by −α.
fn var_asteria(p: vec2f, w: f32, alpha: f32, wi: u32) -> vec2f {
  // alpha is a slider param — adversarial values can push PI·alpha past
  // the Dawn f32 trig cliff. Route through safe_* per the convention.
  let sina = safe_sin(PI * alpha);
  let cosa = safe_cos(PI * alpha);
  let x0 = w * p.x;
  let y0 = w * p.y;
  var xx = x0;
  var yy = y0;
  let r = xx * xx + yy * yy;
  xx = (abs(xx) - 1.0) * (abs(xx) - 1.0);
  yy = (abs(yy) - 1.0) * (abs(yy) - 1.0);
  let r2 = sqrt(yy + xx);
  let in1_initial = r < 1.0;
  let out2 = r2 < 1.0;
  var in1: bool;
  if (in1_initial && out2) {
    in1 = rand01(wi) > 0.35;
  } else {
    in1 = !in1_initial;
  }
  if (in1) {
    return vec2f(x0, y0);
  }
  // Asteria branch — yy lives in [-1, 1] after rotation, but sqrt
  // domain guards prevent NaN at the edges. JWildfire has no guards;
  // we add `max(..., 0)` to stay finite under f32 rounding.
  let rxx = x0 * cosa - y0 * sina;
  let ryy = x0 * sina + y0 * cosa;
  let denom = sqrt(max(1.0 - ryy * ryy, 1e-30));
  let inner = max(1.0 - (-abs(ryy) + 1.0) * (-abs(ryy) + 1.0), 0.0);
  let nx = rxx / denom * (1.0 - sqrt(inner));
  let oxx = nx * cosa + ryy * sina;
  let oyy = -nx * sina + ryy * cosa;
  return vec2f(oxx, oyy);
}

// clifford_js — Paul Bourke's Clifford attractor, ported into
// JWildfire by Brad Stefanov. 4 params (a, b, c, d). Pure 2D map:
//   x' = sin(a·y) + c·cos(a·x)
//   y' = sin(b·x) + d·cos(b·y)
// All trig args are bounded under the typical |p|·|coef| ≤ 5 product —
// well under SIN_SAFE_MAX=1e6, so raw sin/cos are fine here.
fn var_clifford_js(p: vec2f, w: f32, a: f32, b: f32, c: f32, d: f32) -> vec2f {
  let nx = sin(a * p.y) + c * cos(a * p.x);
  let ny = sin(b * p.x) + d * cos(b * p.y);
  return vec2f(w * nx, w * ny);
}

// devil_warp — dark-beam. 6 params (a, b, effect, warp, rmin, rmax).
// Radial pow-warp anchored at origin: computes
//   r2 = 1 / (x² + y²)
//   r = pow(x² + r2·b·y², warp) − pow(y² + r2·a·x², warp)
// then clamps r ∈ [rmin, rmax] and scales by `effect`. Output:
//   (x·(1+r), y·(1+r)) — no amount-multiply on the output (matches
// JWildfire). The pow base can be negative when `warp` is fractional
// → returns 0 in WGSL (pow(neg, frac) is undefined; we accept the
// JWildfire-equivalent behavior under f32 here). Guard 1/(x²+y²)
// with a floor per [[reference-dawn-f32-ftz-cliff]].
fn var_devil_warp(
  p: vec2f, w: f32,
  a: f32, b: f32, effect: f32, warp: f32, rmin: f32, rmax: f32,
) -> vec2f {
  let xx = p.x;
  let yy = p.y;
  let rsum = max(xx * xx + yy * yy, 1e-30);
  let r2 = 1.0 / rsum;
  let base_a = xx * xx + r2 * b * yy * yy;
  let base_b = yy * yy + r2 * a * xx * xx;
  let pow_a = select(0.0, pow(base_a, warp), base_a > 0.0);
  let pow_b = select(0.0, pow(base_b, warp), base_b > 0.0);
  var r = pow_a - pow_b;
  r = clamp(r, rmin, rmax);
  r = effect * r;
  return vec2f(xx * (1.0 + r), yy * (1.0 + r));
}

// voron — eralex61. 5 params (k, step, num, xseed, yseed). Voronoi
// cell distance field with deterministic-jitter cell centers. Worst
// case is 9 cells × 25 jitter pts = 225 sqrt ops per iter; default
// num=1 collapses to 9 sqrt. DiscretNoise is a pure i32 hash
// (Marsaglia-style xor-shift + LCG) → returns [0, 1].
fn discret_noise_voron(x: i32) -> f32 {
  let s: i32 = (x << 13) ^ x;
  // Match JWildfire's (n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff
  // i32 arithmetic — wrapping mul is fine since we mask afterward.
  let r: i32 = ((s * (s * s * 15731 + 789221) + 1376312589) & 0x7fffffff);
  return f32(r) * (1.0 / 2147483647.0);
}
fn var_voron(
  p: vec2f, w: f32,
  k: f32, step: f32, num_f: f32, xseed_f: f32, yseed_f: f32,
) -> vec2f {
  let xseed = i32(xseed_f);
  let yseed = i32(yseed_f);
  let num = clamp(i32(num_f), 1, 25);
  let step_safe = select(step, 1e-30, step == 0.0);
  let M = i32(floor(p.x / step_safe));
  let N = i32(floor(p.y / step_safe));
  var rmin: f32 = 20.0;
  var X0: f32 = 0.0;
  var Y0: f32 = 0.0;
  for (var i: i32 = -1; i < 2; i = i + 1) {
    let M1 = M + i;
    for (var j: i32 = -1; j < 2; j = j + 1) {
      let N1 = N + j;
      let kx = 1 + i32(floor(num_f * discret_noise_voron(19 * M1 + 257 * N1 + xseed)));
      let K = clamp(kx, 1, 26);  // worst-case 1 + 25 = 26
      for (var l: i32 = 0; l < K; l = l + 1) {
        let X = (discret_noise_voron(l + 64 * M1 + 15 * N1 + xseed) + f32(M1)) * step;
        let Y = (discret_noise_voron(l + 21 * M1 + 33 * N1 + yseed) + f32(N1)) * step;
        let ox = p.x - X;
        let oy = p.y - Y;
        let r = sqrt(ox * ox + oy * oy);
        if (r < rmin) {
          rmin = r;
          X0 = X;
          Y0 = Y;
        }
      }
    }
  }
  return vec2f(w * (k * (p.x - X0) + X0), w * (k * (p.y - Y0) + Y0));
}

// ---------------------------------------------------------------------
// #121 batch L2 — JWildfire 2D long tail (7 vars). Sources: HenonFunc
// (TyrantWave), AtanFunc (FractalDesire via Brad Stefanov), CardioidFunc
// (Michael Faber), ChrysanthemumFunc (Jesus Sosa via Paul Bourke),
// BCollideFunc (Faber), BSplitFunc (Raykoid666 via Nic Anderson),
// BulgeFunc. All LGPL-2.1+, NOTICE.md. henon/atan/cardioid/bcollide/
// bsplit/bulge are deterministic; chrysanthemum is a base-shape RNG
// variation (samples u ∈ [0, 21π] per iter).
// ---------------------------------------------------------------------

// henon — TyrantWave's port of the Hénon map. 3 params (a, b, c).
//   x' = c - a·x² + y
//   y' = b·x
// Sibling of V156 clifford_js in the Bourke 2D attractor family.
fn var_henon(p: vec2f, w: f32, a: f32, b: f32, c: f32) -> vec2f {
  return vec2f(w * (c - a * p.x * p.x + p.y), w * b * p.x);
}

// atan — FractalDesire's 3-mode arctan saturation (via Brad Stefanov).
// 2 params (mode int 0..2, stretch f32). mode 0 = atan on y only; 1 =
// atan on x only; 2 = atan on both. Output y (or x or both) is
// normalized by 1/(π/2), so it saturates smoothly toward ±1 as the
// stretched coord grows. Pleasant pillar-cap squashing effect.
fn var_atan(p: vec2f, w: f32, mode_p: f32, stretch: f32) -> vec2f {
  let norm = w * 2.0 / PI;   // = w / (π/2)
  let mode = i32(mode_p);
  if (mode == 0) {
    return vec2f(w * p.x, norm * atan(stretch * p.y));
  }
  if (mode == 1) {
    return vec2f(norm * atan(stretch * p.x), w * p.y);
  }
  // mode == 2 (or anything else → fall through to dual atan)
  return vec2f(norm * atan(stretch * p.x), norm * atan(stretch * p.y));
}

// cardioid — Michael Faber. 1 param (a — angle multiplier). Polar curve
// r(θ) = √(x² + y² + sin(a·θ) + 1), output on the (cos θ, sin θ) ray.
// At a=1 traces a cardioid-like silhouette; integer a values produce
// multi-cusped rose shapes.
fn var_cardioid(p: vec2f, w: f32, a: f32) -> vec2f {
  let theta = atan2(p.y, p.x);
  // theta is atan2-bounded, but a is a slider param — `a*theta` can cross
  // the cliff under extreme `a`. Output trig of `theta` alone stays raw.
  let r_sq = p.x * p.x + p.y * p.y + safe_sin(a * theta) + 1.0;
  let r = w * sqrt(max(r_sq, 0.0));
  return vec2f(r * cos(theta), r * sin(theta));
}

// chrysanthemum — Jesus Sosa's port of Paul Bourke's chrysanthemum
// curve. 0 params, fully RNG-driven (base shape). Samples u ∈ [0, 21π]
// uniformly, then computes the namesake parametric curve. Max trig
// arg here is 28·u ≤ 28·21π ≈ 1847 — well under SIN_SAFE_MAX = 1e6, so
// raw sin/cos are safe.
fn var_chrysanthemum(p: vec2f, w: f32, wi: u32) -> vec2f {
  let u = 21.0 * PI * rand01(wi);
  let p4 = sin(17.0 * u / 3.0);
  let p8 = sin(2.0 * cos(3.0 * u) - 28.0 * u);
  let p4_4 = p4 * p4 * p4 * p4;
  let p8_2 = p8 * p8;
  let p8_8 = p8_2 * p8_2 * p8_2 * p8_2;
  let r_raw = 5.0 * (1.0 + sin(11.0 * u / 5.0)) - 4.0 * p4_4 * p8_8;
  let r = w * 0.1 * r_raw;
  return vec2f(r * cos(u), r * sin(u));
}

// bcollide — Michael Faber. 2 params (num int 1+, a clamped [0,1]).
// Maps the iterate into "bipolar" coordinates (tau, sigma) then folds
// sigma into `num` equal angular wedges (with a phase offset of π·a/num
// alternating between even/odd wedges). Returns the (sinh tau, sin sigma)
// projection scaled by 1/(cosh tau - cos sigma) — the Möbius-style
// bipolar inverse.
fn var_bcollide(p: vec2f, w: f32, num_p: f32, a: f32) -> vec2f {
  let num = max(1.0, num_p);
  let bcn_pi = num / PI;
  let pi_bcn = PI / num;
  let bca_bcn = PI * a / num;
  let xp1 = p.x + 1.0;
  let xm1 = p.x - 1.0;
  let y2 = p.y * p.y;
  let tau = 0.5 * (log(max(xp1 * xp1 + y2, 1e-30)) - log(max(xm1 * xm1 + y2, 1e-30)));
  let sigma_raw = PI - atan2(p.y, xp1) - atan2(p.y, 1.0 - p.x);
  let alt = i32(sigma_raw * bcn_pi);
  let alt_even = (alt & 1) == 0;
  let offset = select(-bca_bcn, bca_bcn, alt_even);
  // WGSL has no `%` for f32 — use the (a - floor(a/b)·b) idiom.
  let folded = sigma_raw + offset - floor((sigma_raw + offset) / pi_bcn) * pi_bcn;
  let sigma = f32(alt) * pi_bcn + folded;
  let temp = cosh(tau) - cos(sigma);
  let temp_safe = select(temp, 1e-30, abs(temp) < 1e-30);
  return vec2f(w * sinh(tau) / temp_safe, w * sin(sigma) / temp_safe);
}

// bsplit — Raykoid666's tan/sin shift (transcribed by Nic Anderson).
// 2 params (x, y shifts). Output is undefined when sin(x+sx) is near
// zero (singularity of tan / sin denominators); we emit (0, 0) at the
// singularity — mirrors JWildfire's `doHide=true` semantics (the point
// contributes nothing to the histogram).
//
// #167 audit: arg_x = p.x + sx is unbounded so the Dawn trig cliff is
// reachable, BUT a naive safe_sin swap would replace true zero-output
// at the singularity with the safe_* hash-spread fallback. That
// undoes the `doHide` semantics (cliff-zeroed walkers would re-emit
// non-zero output instead of being hidden). Keep raw `sin`/`cos` here;
// the `abs(sin_x) < 1e-6` guard already intercepts both the exact-zero
// singularity AND the cliff-produced exact-zero, both routing to (0,0).
fn var_bsplit(p: vec2f, w: f32, sx: f32, sy: f32) -> vec2f {
  let arg_x = p.x + sx;
  let sin_x = sin(arg_x);
  if (abs(sin_x) < 1e-6) {
    return vec2f(0.0, 0.0);
  }
  let cos_x = cos(arg_x);
  let tan_x = sin_x / cos_x;
  let tan_safe = select(tan_x, sign(tan_x) * 1e6, abs(cos_x) < 1e-6);
  return vec2f(
    w / tan_safe * cos(p.y + sy),
    w / sin_x * (-1.0 * p.y + sy),
  );
}

// bulge — radial r^N bulge effect. 1 param (N = exponent). Computes
// r = |p|, then outputs p · r^(N-1) · w. N>1 stretches the periphery
// outward (bulge); N<1 compresses toward the origin (pinch). r=0 is
// degenerate; the (rn/r) factor naturally → 0 there only when N>1,
// otherwise diverges — guard with f32-ftz floor per [[reference-
// dawn-f32-ftz-cliff]].
fn var_bulge(p: vec2f, w: f32, n: f32) -> vec2f {
  let r = sqrt(p.x * p.x + p.y * p.y);
  let r_safe = max(r, 1e-30);
  let rn = pow(r_safe, n);
  let scale = rn / r_safe;
  return vec2f(w * p.x * scale, w * p.y * scale);
}

// ---------------------------------------------------------------------
// #121 batch L3 — JWildfire 2D continuing (5 vars). Sources: ChecksFunc
// (Keeps + Xyrus02), CircularFunc + Circular2Func (Tatyana Zabanova
// via Brad Stefanov), CornersFunc (Whittaker Courtney), CircleBlurFunc
// (Zyorg). All LGPL-2.1+, NOTICE.md. checks/circular/circular2 use
// RNG (1-2 calls per iter); corners is deterministic; circleblur is
// a 2-RNG-call base shape (uniform disc sample).
// ---------------------------------------------------------------------

// checks — Keeps + Xyrus02 checkered pattern. 4 params (x, y, size, rnd).
// rounds the iterate to a cell index, alternates between two offset
// schemes based on (round(x/size) + round(y/size)) parity. Adds a
// per-axis random jitter `rnd` to soften the cell edges. EPSILON guard
// on size matches JWildfire's 1/(size+EPSILON) precalc.
fn var_checks(p: vec2f, w: f32, cx: f32, cy: f32, size: f32, rnd: f32, wi: u32) -> vec2f {
  let cs = 1.0 / (size + 1e-6);
  let ncx = -cx;
  let ncy = -cy;
  // WGSL has no `rint` built-in; round() is round-half-away-from-zero,
  // close enough for the alternation check.
  let is_xy = i32(round(p.x * cs)) + i32(round(p.y * cs));
  let rnx = rnd * rand01(wi);
  let rny = rnd * rand01(wi);
  var dx: f32;
  var dy: f32;
  if ((is_xy & 1) == 0) {
    dx = ncx + rnx;
    dy = ncy;
  } else {
    dx = cx;
    dy = cy + rny;
  }
  return vec2f(w * (p.x + dx), w * (p.y + dy));
}

// circular — Tatyana Zabanova's hash-jitter circular rotation
// (transcribed by Brad Stefanov). 2 params (angle deg, seed). Computes
// a deterministic spatial-hash `aux ∈ [0, 1]` from (x, y, seed), adds
// a per-iter RNG sample, scales by 2·angle·(π/180), and applies that
// as a polar rotation. The hash term breaks chaos-pattern repetition.
//
// #167 audit: the `sin(x·12.9898 + y·78.233 + seed) * 43758.5453` is
// the GLSL one-liner pseudo-hash — sin of a large unbounded arg IS the
// design. Routing it through `safe_sin` would replace the hash quality
// with the safe-fallback constant zero region, killing the spatial
// hashing entirely. At very large |p| the cliff degrades hash quality
// (zero output → identical jitter for nearby walkers, mild
// banding) but the render still functions. Keep raw.
fn var_circular(p: vec2f, w: f32, angle_deg: f32, seed: f32, wi: u32) -> vec2f {
  let c_a = angle_deg * PI / 180.0;
  // GLSL-style spatial-hash trick: sin(x·k1 + y·k2 + seed) * big_const.
  // Reduce range via subtract-floor to get a [0, 1] fractional.
  let aux_raw = sin(p.x * 12.9898 + p.y * 78.233 + seed) * 43758.5453;
  // JWildfire CircularFunc uses Java truncate-toward-zero `(int) aux_raw`
  // → range (-1, 1). WGSL `trunc` matches; `floor` would give [0, 1).
  let aux = aux_raw - trunc(aux_raw);
  let rnd = (2.0 * (rand01(wi) + aux) - 2.0) * c_a;
  let rad = sqrt(p.x * p.x + p.y * p.y);
  let ang = atan2(p.y, p.x);
  let by = sin(ang + rnd);
  let bx = cos(ang + rnd);
  return vec2f(w * bx * rad, w * by * rad);
}

// circular2 — Tatyana Zabanova's circular with exposed hash constants.
// 4 params (angle deg, seed, xx, yy). Same algorithm as circular but
// the (12.9898, 78.233) hash multipliers are user-controllable —
// changes the spatial frequency of the jitter pattern.
fn var_circular2(p: vec2f, w: f32, angle_deg: f32, seed: f32, xx: f32, yy: f32, wi: u32) -> vec2f {
  let c_a = angle_deg * PI / 180.0;
  let aux_raw = sin(p.x * xx + p.y * yy + seed) * 43758.5453;
  let aux = aux_raw - trunc(aux_raw);
  let rnd = (2.0 * (rand01(wi) + aux) - 2.0) * c_a;
  let rad = sqrt(p.x * p.x + p.y * p.y);
  let ang = atan2(p.y, p.x);
  return vec2f(w * cos(ang + rnd) * rad, w * sin(ang + rnd) * rad);
}

// corners — Whittaker Courtney. 9 params (x, y, mult_x, mult_y,
// x_power, y_power, xy_power_add, log_mode, log_base). Computes a
// power-law warp on (xs, ys) = (x², y²) and adds it with sign flipped
// by input-x/y sign, plus a constant x/y offset. log_mode=0 uses raw
// pow; log_mode=1 wraps with log_base. Deterministic.
fn var_corners(
  p: vec2f, w: f32,
  cx: f32, cy: f32, mult_x: f32, mult_y: f32,
  x_power: f32, y_power: f32, xy_power_add: f32,
  log_mode: f32, log_base: f32,
) -> vec2f {
  let xs = p.x * p.x;
  let ys = p.y * p.y;
  var ex: f32;
  var ey: f32;
  if (log_mode == 0.0) {
    ex = pow(max(xs, 0.0), x_power + xy_power_add) * mult_x;
    ey = pow(max(ys, 0.0), y_power + xy_power_add) * mult_y;
  } else {
    // log_base must be > 0 and != 1 — guard the base.
    let lb = log(max(abs(log_base), 1.000001));
    ex = pow(log((xs * mult_x) + 3.0) / lb, x_power + 2.25 + xy_power_add) - 1.33;
    ey = pow(log((ys * mult_y) + 3.0) / lb, y_power + 2.25 + xy_power_add) - 1.33;
  }
  // sign-flip branch on input (x, y) — keeps the corners' anti-symmetric
  // shape. ex/ey already include the amount-multiply; the +cx/+cy const
  // offset is added raw (matches JWildfire exactly).
  let ox = select(-w * ex - cx, w * ex + cx, p.x > 0.0);
  let oy = select(-w * ey - cy, w * ey + cy, p.y > 0.0);
  return vec2f(ox, oy);
}

// circleblur — Zyorg's uniform disc sampler. 0 params. Pure RNG base
// shape: rad ∈ [0, 1] sampled via sqrt(uniform) (correct disc-uniform
// sampling), angle uniform in [0, 2π]. Output the (cos θ, sin θ) · rad
// scaled by amount. Input (x, y) is ignored — it's a "base shape"
// variation (like noise, blur, circleblur is the disc version).
fn var_circleblur(p: vec2f, w: f32, wi: u32) -> vec2f {
  let rad = sqrt(rand01(wi));
  let a = rand01(wi) * 2.0 * PI;
  return vec2f(w * cos(a) * rad, w * sin(a) * rad);
}

// ---------------------------------------------------------------------
// #121 batch L4 — JWildfire 2D continuing (5 vars). Sources:
// Fibonacci2Func (Larry Berlin), HypertileFunc + Hypertile1Func +
// Hypertile2Func (Zueuk hyperbolic Möbius tiling family), IDiscFunc
// (Michael Faber). All LGPL-2.1+, NOTICE.md.
// ---------------------------------------------------------------------

// fibonacci2 — Larry Berlin. 2 params (sc, sc2). Golden-ratio-driven
// curve: z' = (φ^z - (-φ)^(-z)) / √5. Inlined constants ffive = 1/√5,
// fnatlog = log(φ). Two exponential radii combined with sin/cos of
// phase angles produce the characteristic Fibonacci-spiral fan.
fn var_fibonacci2(p: vec2f, w: f32, sc: f32, sc2: f32) -> vec2f {
  let ffive: f32 = 0.447213595;        // 1/√5
  let fnatlog: f32 = 0.481211825;      // log(φ)
  // a and b are linear in walker coords — unbounded. safe_* per convention.
  let a = p.y * fnatlog;
  let snum1 = safe_sin(a);
  let cnum1 = safe_cos(a);
  let b = (p.x * PI + p.y * fnatlog) * -1.0;
  let snum2 = safe_sin(b);
  let cnum2 = safe_cos(b);
  let eradius1 = sc * exp(sc2 * (p.x * fnatlog));
  let eradius2 = sc * exp(sc2 * ((p.x * fnatlog - p.y * PI) * -1.0));
  return vec2f(
    w * (eradius1 * cnum1 - eradius2 * cnum2) * ffive,
    w * (eradius1 * snum1 - eradius2 * snum2) * ffive,
  );
}

// hypertile — Zueuk. 3 params (p, q, n all int). Möbius transformation
// generator for {p, q} hyperbolic tilings. At callsite bake r and (re,
// im) from p/q/n then apply Möbius: (a + b·i) / (c + d·i) where (a, b)
// = (x+re, y-im), (c, d) = (re·x - im·y + 1, re·y + im·x).
fn var_hypertile(p: vec2f, w: f32, p_p: f32, q: f32, n: f32) -> vec2f {
  let pi_ = max(3.0, p_p);
  let q_safe = max(3.0, q);
  let pa = 2.0 * PI / pi_;
  let qa = 2.0 * PI / q_safe;
  // pa, qa are bounded by max(3, p)/q clamps so raw trig stays safe; an
  // multiplies by slider n which can be extreme — safe_* on `an` only.
  let denom = cos(pa) + cos(qa);
  let r2 = select(1.0, (1.0 - cos(pa)) / denom + 1.0, abs(denom) > 1e-30);
  let r = select(1.0, 1.0 / sqrt(max(r2, 1e-30)), r2 > 0.0);
  let an = n * pa;
  let re = r * safe_cos(an);
  let im = r * safe_sin(an);
  let a = p.x + re;
  let b = p.y - im;
  let c = re * p.x - im * p.y + 1.0;
  let d = re * p.y + im * p.x;
  let cd2 = c * c + d * d;
  let vr = w / max(cd2, 1e-30);
  return vec2f(vr * (a * c + b * d), vr * (b * c - a * d));
}

// hypertile1 — Zueuk. 2 params (p, q ints). Same Möbius tiling but `n`
// is randomized per iter via rand_int * pa (denser tile pattern).
fn var_hypertile1(p: vec2f, w: f32, p_p: f32, q: f32, wi: u32) -> vec2f {
  let pi_ = max(3.0, p_p);
  let q_safe = max(3.0, q);
  let pa = 2.0 * PI / pi_;
  let cos_pa = cos(pa);
  let denom = cos_pa + cos(2.0 * PI / q_safe);
  let r2 = select(1.0, 1.0 - (cos_pa - 1.0) / denom, abs(denom) > 1e-30);
  let r = select(1.0, 1.0 / sqrt(max(r2, 1e-30)), r2 > 0.0);
  let rpa = floor(rand01(wi) * 10.0) * pa;
  let cosa = cos(rpa);
  let sina = sin(rpa);
  let re = r * cosa;
  let im = r * sina;
  let a = p.x + re;
  let b = p.y - im;
  let c = re * p.x - im * p.y + 1.0;
  let d = re * p.y + im * p.x;
  let cd2 = c * c + d * d;
  let vr = w / max(cd2, 1e-30);
  return vec2f(vr * (a * c + b * d), vr * (b * c - a * d));
}

// hypertile2 — Zueuk. 2 params (p, q ints). Möbius tiling with the
// per-iter rotation jitter applied POST-projection (rotates output).
fn var_hypertile2(p: vec2f, w: f32, p_p: f32, q: f32, wi: u32) -> vec2f {
  let pi_ = max(3.0, p_p);
  let q_safe = max(3.0, q);
  let pa = 2.0 * PI / pi_;
  let cos_pa = cos(pa);
  let denom = cos_pa + cos(2.0 * PI / q_safe);
  let r2 = select(1.0, 1.0 - (cos_pa - 1.0) / denom, abs(denom) > 1e-30);
  let r = select(1.0, 1.0 / sqrt(max(r2, 1e-30)), r2 > 0.0);
  let a = p.x + r;
  let b = p.y;
  let c = r * p.x + 1.0;
  let d = r * p.y;
  let xx = a * c + b * d;
  let yy = b * c - a * d;
  let cd2 = c * c + d * d;
  let vr = w / max(cd2, 1e-30);
  // rpa = floor(rand·0x7fff)·pa can hit ~32767·pa ≈ 1e5 (small p). Below
  // the Dawn 1e6 cliff in practice, but use safe_* for convention.
  let rpa = floor(rand01(wi) * f32(0x00007fff)) * pa;
  let cosa = safe_cos(rpa);
  let sina = safe_sin(rpa);
  return vec2f(vr * (xx * cosa + yy * sina), vr * (yy * cosa - xx * sina));
}

// idisc — Michael Faber. 0 params. Inverse-radius disc projection:
// a = π / (r + 1), output on (cos a, sin a) ray scaled by atan2(y, x)/π.
fn var_idisc(p: vec2f, w: f32) -> vec2f {
  let r = sqrt(p.x * p.x + p.y * p.y);
  let a = PI / (r + 1.0);
  let v = atan2(p.y, p.x) * w / PI;
  return vec2f(v * cos(a), v * sin(a));
}

// ---------------------------------------------------------------------
// #121 batch L5 — JWildfire 2D continuing (5 vars). Sources: HoleFunc
// (Michael Faber), KaleidoscopeFunc + LayeredSpiralFunc (Will Evans),
// LinearTFunc (FractalDesire), LineFunc (Nic Anderson). All LGPL-2.1+,
// NOTICE.md. All deterministic except line (1 RNG/iter base shape).
// ---------------------------------------------------------------------

// hole — Michael Faber. 2 params (a, inside int 0/1). Polar radial
// branch: inside=0 emits sqrt(x²+y² + δ); inside=1 emits the inverse
// δ/(x²+y²+δ). δ = (α/π + 1)^a where α = atan2(y, x).
fn var_hole(p: vec2f, w: f32, a: f32, inside_p: f32) -> vec2f {
  let alpha = atan2(p.y, p.x);
  let delta = pow(max(alpha / PI + 1.0, 1e-30), a);
  let sumsq = p.x * p.x + p.y * p.y;
  let inside = i32(inside_p);
  let r = select(
    w * sqrt(max(sumsq + delta, 0.0)),
    w * delta / max(sumsq + delta, 1e-30),
    inside != 0,
  );
  return vec2f(r * cos(alpha), r * sin(alpha));
}

// kaleidoscope — Will Evans. 5 params (pull, rotate, line_up, x, y).
// Splits the plane at y=0 and applies a 45° rotation+offset to each
// half. Note: JWildfire's cos/sin(45.0) treat 45.0 as RADIANS (not
// degrees!) — port verbatim.
fn var_kaleidoscope(p: vec2f, w_amp: f32, pull: f32, rotate: f32, line_up: f32, off_x: f32, off_y: f32) -> vec2f {
  let c45 = cos(45.0);
  let s45 = sin(45.0);
  let ox = w_amp * (((rotate * p.x) * c45 - p.y * s45 + line_up) + off_x);
  let oy = select(
    w_amp * ((rotate * p.y) * c45 + p.x * s45 - pull - line_up),
    w_amp * (((rotate * p.y) * c45 + p.x * s45 + pull + line_up) + off_y),
    p.y > 0.0,
  );
  return vec2f(ox, oy);
}

// layered_spiral — Will Evans. 1 param (radius). Polar spiral where
// the angular phase is r² and the radial scale is x·radius. r² is
// unbounded → trig routed through safe_* per Dawn f32 cliff convention.
fn var_layered_spiral(p: vec2f, w: f32, radius: f32) -> vec2f {
  let a = p.x * radius;
  let t = p.x * p.x + p.y * p.y + 1e-30;
  return vec2f(w * a * safe_cos(t), w * a * safe_sin(t));
}

// linear_t — FractalDesire. 2 params (powX, powY). Per-axis power
// law with sign preservation: sign(x) · |x|^powX, same for y.
fn var_linear_t(p: vec2f, w: f32, pow_x: f32, pow_y: f32) -> vec2f {
  let sx = select(-1.0, 1.0, p.x >= 0.0);
  let sy = select(-1.0, 1.0, p.y >= 0.0);
  return vec2f(
    w * sx * pow(max(abs(p.x), 1e-30), pow_x),
    w * sy * pow(max(abs(p.y), 1e-30), pow_y),
  );
}

// line — Nic Anderson, chronologicaldot. 2 params (delta, phi). 2D
// projection of JWildfire's 3D base shape — drops the z component.
// Spherical-angle unit direction (δ, φ in units of π) → random point
// along the line, scaled by amount.
fn var_line(p: vec2f, w: f32, delta: f32, phi: f32, wi: u32) -> vec2f {
  // delta/phi are slider params — extreme values can push PI·param past
  // the Dawn f32 trig cliff. safe_* per convention.
  let cd = safe_cos(delta * PI);
  let sd = safe_sin(delta * PI);
  let cp = safe_cos(phi * PI);
  let sp = safe_sin(phi * PI);
  var ux = cd * cp;
  var uy = sd * cp;
  let uz = sp;
  let r = sqrt(max(ux * ux + uy * uy + uz * uz, 1e-30));
  ux = ux / r;
  uy = uy / r;
  let rand = rand01(wi) * w;
  return vec2f(ux * rand, uy * rand);
}

// ---------------------------------------------------------------------
// #121 batch L6 — JWildfire 2D continuing (4 vars). Sources: OvoidFunc
// (Faber), PhoenixJuliaFunc (TyrantWave), UnpolarFunc (Apophysis pack),
// ShredradFunc (Zy0rg). All LGPL-2.1+, NOTICE.md. phoenix_julia uses
// 1 RNG call (randint branch like julian); rest deterministic.
// ---------------------------------------------------------------------

// ovoid — Michael Faber. 2 params (x, y scale factors). Radial inverse
// r = w / (x² + y² + ε), then output = (x·r·px, y·r·py). (px, py)=(1,1)
// reduces to spherical; (0.94, 0.94) produces slight oval.
fn var_ovoid(p: vec2f, w: f32, px: f32, py: f32) -> vec2f {
  let t = p.x * p.x + p.y * p.y + 1e-6;
  let r = w / t;
  return vec2f(p.x * r * px, p.y * r * py);
}

// phoenix_julia — TyrantWave. 4 params. Julian variant with axis
// distortion preprocessing then a julian-style randint branch.
fn var_phoenix_julia(p: vec2f, w: f32, power: f32, dist: f32, x_distort: f32, y_distort: f32, wi: u32) -> vec2f {
  let pow_safe = select(power, 1.0, power == 0.0);
  // JWildfire PhoenixJuliaFunc.init: _invN = dist/power, _cN = dist/power/2.
  // No -0.5 offset (that's JulianFunc, not this one).
  let inv_n = dist / pow_safe;
  let inv_2pi_n = 2.0 * PI / pow_safe;
  let cn = dist / (2.0 * pow_safe);
  let preX = p.x * (x_distort + 1.0);
  let preY = p.y * (y_distort + 1.0);
  let randint = floor(rand01(wi) * abs(pow_safe));
  let a = atan2(preY, preX) * inv_n + randint * inv_2pi_n;
  let sumsq = p.x * p.x + p.y * p.y;
  let r = w * pow(max(sumsq, 1e-30), cn);
  return vec2f(r * cos(a), r * sin(a));
}

// unpolar — Apophysis plugin pack. 0 params. Inverse-polar mapping:
// r = exp(y); output = w/(2π)·r·(sin x, cos x). Note: atypical convention
// where x output uses sin and y output uses cos. p.x is an unbounded
// walker coord → trig routed through safe_* per Dawn f32 cliff convention
// (sibling V21 cylinder uses safe_sin).
fn var_unpolar(p: vec2f, w: f32) -> vec2f {
  let vvar_2 = (w / PI) * 0.5;
  let r = exp(p.y);
  return vec2f(vvar_2 * r * safe_sin(p.x), vvar_2 * r * safe_cos(p.x));
}

// shredrad — Zy0rg. 2 params (n, width). Radial shredder: divides the
// angular coord into n wedges, applies a width-controlled fold within
// each wedge. Bake α = 2π/n inline.
fn var_shredrad(p: vec2f, w: f32, n: f32, width: f32) -> vec2f {
  let n_safe = max(0.001, n);
  let alpha = 2.0 * PI / n_safe;
  let ang = atan2(p.y, p.x);
  let rad = sqrt(p.x * p.x + p.y * p.y);
  let xang = (ang + 3.0 * PI + alpha * 0.5) / alpha;
  // zang carries a floor(xang)·alpha term that grows linearly with xang;
  // for small n (alpha → ∞), zang is unbounded. safe_* per convention.
  let zang = ((xang - floor(xang)) * width + floor(xang)) * alpha - PI - alpha * 0.5 * width;
  return vec2f(w * rad * safe_cos(zang), w * rad * safe_sin(zang));
}

// ---------------------------------------------------------------------
// #121 batch L7 — JWildfire 2D continuing (4 vars). Sources: VogelFunc
// (Victor Ganora), YinYangFunc (dark-beam), SquishFunc (Faber Angle
// Pack), TargetFunc (Faber). All LGPL-2.1+, NOTICE.md. vogel/yin_yang/
// squish use RNG; target deterministic.
// ---------------------------------------------------------------------

// vogel — Victor Ganora. 2 params (n int, scale). Golden-angle
// phyllotaxis (Vogel spiral). Picks random integer i in [1, n], computes
// the golden-angle phase a = i·2π/φ², then emits a radial point at
// r = w·(|p| + √i) on that ray, plus a scale-modulated input offset.
fn var_vogel(p: vec2f, w: f32, n: f32, scale: f32, wi: u32) -> vec2f {
  let phi: f32 = 1.61803398874989;
  let M_2PI_PHI2: f32 = 2.0 * PI / (phi * phi);
  let n_safe = max(1.0, n);
  let i_idx = floor(rand01(wi) * n_safe) + 1.0;
  // a = i_idx·(2π/φ²) ≈ i_idx·2.4. For huge n (slider), can cross cliff.
  let a = i_idx * M_2PI_PHI2;
  let r = w * (sqrt(p.x * p.x + p.y * p.y) + sqrt(i_idx));
  let cosa = safe_cos(a);
  let sina = safe_sin(a);
  return vec2f(
    r * (cosa + scale * p.x),
    r * (sina + scale * p.y),
  );
}

// yin_yang — dark-beam. 5 params (radius, ang1, ang2, dual_t int 0/1,
// outside int 0/1). Geometric yin-yang symbol generator with rotation
// jitter (via dual_t branch) and an outside-pass-through toggle.
fn var_yin_yang(p: vec2f, w: f32, radius: f32, ang1: f32, ang2: f32, dual_t_p: f32, outside_p: f32, wi: u32) -> vec2f {
  // ang1/ang2 are slider params — defensive safe_* per convention.
  let sina = safe_sin(PI * ang1);
  let cosa = safe_cos(PI * ang1);
  let sinb = safe_sin(PI * ang2);
  let cosb = safe_cos(PI * ang2);
  let dual_t = i32(dual_t_p);
  let outside = i32(outside_p);
  var xx = p.x;
  var yy = p.y;
  var inv: f32 = 1.0;
  var RR = radius;
  let R2 = xx * xx + yy * yy;
  if (R2 < 1.0) {
    var nx = xx * cosa - yy * sina;
    var ny = xx * sina + yy * cosa;
    if (dual_t == 1 && rand01(wi) > 0.5) {
      inv = -1.0;
      RR = 1.0 - radius;
      nx = xx * cosb - yy * sinb;
      ny = xx * sinb + yy * cosb;
    }
    xx = nx;
    yy = ny;
    if (yy > 0.0) {
      let t = sqrt(max(1.0 - yy * yy, 0.0));
      let k = xx / max(abs(t), 1e-30) * sign(t);
      let t1 = (t - 0.5) * 2.0;
      let alfa = (1.0 - k) * 0.5;
      let beta = 1.0 - alfa;
      let dx = alfa * (RR - 1.0);
      let k1 = alfa * RR + beta * 1.0;
      return vec2f(
        w * (t1 * k1 + dx) * inv,
        w * sqrt(max(1.0 - t1 * t1, 0.0)) * k1 * inv,
      );
    }
    return vec2f(
      w * (xx * (1.0 - RR) + RR) * inv,
      w * (yy * (1.0 - RR)) * inv,
    );
  }
  if (outside == 1) {
    return vec2f(w * p.x, w * p.y);
  }
  return vec2f(0.0, 0.0);
}

// squish — Faber Angle Pack. 1 param (power int ≥ 2). Folds the iterate
// into a square's 8-region perimeter parameterization, picks a random
// rotation index, then emits onto one of 4 quadrant-aligned line
// segments. Distinctive square / cross silhouettes.
fn var_squish(p: vec2f, w: f32, power_p: f32, wi: u32) -> vec2f {
  let power = max(2.0, power_p);
  let inv_power = 1.0 / power;
  let ax = abs(p.x);
  let ay = abs(p.y);
  var s: f32;
  var p_param: f32;
  if (ax > ay) {
    s = ax;
    p_param = select(4.0 * s - p.y, p.y, p.x > 0.0);
  } else {
    s = ay;
    p_param = select(6.0 * s + p.x, 2.0 * s - p.x, p.y > 0.0);
  }
  let rand_rot = floor(power * rand01(wi));
  p_param = inv_power * (p_param + 8.0 * s * rand_rot);
  if (p_param <= 1.0 * s) {
    return vec2f(w * s, w * p_param);
  }
  if (p_param <= 3.0 * s) {
    return vec2f(w * (2.0 * s - p_param), w * s);
  }
  if (p_param <= 5.0 * s) {
    return vec2f(-w * s, w * (4.0 * s - p_param));
  }
  if (p_param <= 7.0 * s) {
    return vec2f(-w * (6.0 * s - p_param), -w * s);
  }
  return vec2f(w * s, -w * (8.0 * s - p_param));
}

// target — Faber. 3 params (even, odd, size). Log-radial ring rotator:
// divides log(r) into rings of `size` width, applies `even` or `odd`
// angle offset depending on which ring the iterate sits in. Produces
// rotating bullseye / target patterns.
fn var_target(p: vec2f, w: f32, even: f32, odd: f32, size: f32) -> vec2f {
  let t_size_2 = 0.5 * size;
  var a = atan2(p.y, p.x);
  let r = sqrt(p.x * p.x + p.y * p.y);
  var t = log(max(r, 1e-30));
  if (t < 0.0) {
    t = t - t_size_2;
  }
  // f32 mod via (a - floor(a/b)·b).
  let abs_t = abs(t);
  let size_safe = max(abs(size), 1e-30);
  t = abs_t - floor(abs_t / size_safe) * size_safe;
  // a starts atan2-bounded but `even`/`odd` are unbounded slider offsets;
  // a + odd can cross the cliff. safe_* per convention.
  a = a + select(odd, even, t < t_size_2);
  return vec2f(r * safe_cos(a) * w, r * safe_sin(a) * w);
}

// ---------------------------------------------------------------------
// #121 batch L8 — JWildfire 2D continuing (6 vars). Sources: FunnelFunc
// (Raykoid666), HolesqFunc (DarkBeam), Hole2Func (Faber/Stefanov/
// Sidwell — 10 shape modes), LaceFunc (Sosa via Bourke), JuliaOutsideFunc
// (Whittaker Courtney — 3-mode complex), FourthFunc (guagapunyaimel —
// per-quadrant 4-way mix). All LGPL-2.1+, NOTICE.md.
// ---------------------------------------------------------------------

// funnel — Raykoid666. 1 param (effect int). tanh + sec composition
// produces a funnel-shape projection. Beware: sec(x) = 1/cos(x) has
// singularities at x = π/2 + nπ — guard.
fn var_funnel(p: vec2f, w: f32, effect_p: f32) -> vec2f {
  let cx = cos(p.x);
  let cy = cos(p.y);
  let secx = 1.0 / select(cx, 1e-30, abs(cx) < 1e-30);
  let secy = 1.0 / select(cy, 1e-30, abs(cy) < 1e-30);
  let off = effect_p * PI;
  return vec2f(
    w * tanh(p.x) * (secx + off),
    w * tanh(p.y) * (secy + off),
  );
}

// holesq — DarkBeam. 0 params. Diamond-fold pattern: when |x|+|y| > 1
// pass through, else fold the dominant-axis coord toward the unit
// diamond's nearest edge.
fn var_holesq(p: vec2f, w: f32) -> vec2f {
  let x = w * p.x;
  let y = w * p.y;
  let fax = abs(x);
  let fay = abs(y);
  if (fax + fay > 1.0) {
    return vec2f(x, y);
  }
  if (fax > fay) {
    let t = select((x + fay - 1.0) * 0.5, (x - fay + 1.0) * 0.5, x >= 0.0);
    return vec2f(t, y);
  }
  let t = select((y + fax - 1.0) * 0.5, (y - fax + 1.0) * 0.5, y >= 0.0);
  return vec2f(x, t);
}

// hole2 — Faber/Stefanov/Sidwell. 6 params (a, b, c, d, inside int,
// shape int 0-9). 10-shape multi-mode polar radial with switch.
fn var_hole2(
  p: vec2f, w: f32,
  a: f32, b: f32, c: f32, d: f32,
  inside_p: f32, shape_p: f32,
) -> vec2f {
  let rhosq = p.x * p.x + p.y * p.y;
  let theta = atan2(p.y, p.x) * d;
  let delta = pow(max(theta / PI + 1.0, 1e-30), a) * c;
  let shape = i32(shape_p);
  // theta = atan2·d (d is a slider param), b is also a slider — any
  // `b*theta` product can cross the Dawn cliff. safe_* per convention.
  // sin(theta) and sin(0.5·b·theta) follow the same arg-shape rule. The
  // case 5 `tan(theta)` is bounded by `d*atan2` so safe_tan applies.
  var r1: f32 = 1.0;
  switch (shape) {
    case 0: { r1 = sqrt(max(rhosq, 0.0)) + delta; }
    case 1: { r1 = sqrt(max(rhosq + delta, 0.0)); }
    case 2: { r1 = sqrt(max(rhosq + safe_sin(b * theta) + delta, 0.0)); }
    case 3: { r1 = sqrt(max(rhosq + safe_sin(theta) + delta, 0.0)); }
    case 4: { r1 = sqrt(max(rhosq + theta * theta - delta + 1.0, 0.0)); }
    case 5: { r1 = sqrt(max(rhosq + abs(safe_tan(theta)) + delta, 0.0)); }
    case 6: { r1 = sqrt(max(rhosq * (1.0 + safe_sin(b * theta)) + delta, 0.0)); }
    case 7: { r1 = sqrt(max(rhosq + abs(safe_sin(0.5 * b * theta)) + delta, 0.0)); }
    case 8: { r1 = sqrt(max(rhosq + safe_sin(PI * safe_sin(b * theta)) + delta, 0.0)); }
    case 9: { r1 = sqrt(max(rhosq + (safe_sin(b * theta) + safe_sin(2.0 * b * theta + PI * 0.5)) * 0.5 + delta, 0.0)); }
    default: { r1 = 1.0; }
  }
  let inside = i32(inside_p);
  let r_final = select(w * r1, w / max(r1, 1e-30), inside != 0);
  // theta = atan2·d — `d` is unbounded slider, so output trig also routes
  // through safe_*.
  return vec2f(r_final * safe_cos(theta), r_final * safe_sin(theta));
}

// lace_js — Jesus Sosa via Paul Bourke. 0 params, RNG-driven. 4-way
// random branch picks one of 4 anchor-rotated radial projections.
fn var_lace_js(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r = 2.0;
  let r0 = sqrt(p.x * p.x + p.y * p.y);
  let weight = rand01(wi);
  let sqrt3_2 = 0.8660254037844386;   // √3/2
  var x: f32 = 0.5;
  var y: f32 = 0.75;
  if (weight > 0.75) {
    let theta = atan2(p.y, p.x - 1.0);
    y = -r0 * cos(theta) / r + 1.0;
    x = -r0 * sin(theta) / r;
  } else if (weight > 0.5) {
    let theta = atan2(p.y - sqrt3_2, p.x + 0.5);
    y = -r0 * cos(theta) / r - 0.5;
    x = -r0 * sin(theta) / r + sqrt3_2;
  } else if (weight > 0.25) {
    let theta = atan2(p.y + sqrt3_2, p.x + 0.5);
    y = -r0 * cos(theta) / r - 0.5;
    x = -r0 * sin(theta) / r - sqrt3_2;
  } else {
    let theta = atan2(p.y, p.x);
    y = -r0 * cos(theta) / r;
    x = -r0 * sin(theta) / r;
  }
  return vec2f(w * x, w * y);
}

// julia_outside — Whittaker Courtney. 3 params (re_div, im_div, mode
// int 0-2). Uses the complex_* helpers from #120 batch B3.
fn var_julia_outside(
  p: vec2f, w: f32,
  re_div: f32, im_div: f32, mode_p: f32, wi: u32,
) -> vec2f {
  let mode = i32(mode_p);
  var z = vec2f(p.x, p.y);
  var z2 = vec2f(p.x, p.y);
  let z3 = vec2f(re_div, im_div);
  // mode 0 or 2: z.Sqrt() first
  if (mode == 0 || mode == 2) {
    z = complex_sqrt(z);
  }
  // z.Inc() = z.re += 1
  z = vec2f(z.x + 1.0, z.y);
  // mode 0 or 2: z.Sqr()
  if (mode == 0 || mode == 2) {
    z = complex_sqr(z);
  }
  // mode 0 or 2: z2.Sqrt()
  if (mode == 0 || mode == 2) {
    z2 = complex_sqrt(z2);
  }
  // z2.Dec() = z2.re -= 1
  z2 = vec2f(z2.x - 1.0, z2.y);
  // mode 0 or 2: z2.Sqr()
  if (mode == 0 || mode == 2) {
    z2 = complex_sqr(z2);
  }
  // z.Div(z2)
  z = complex_div(z, z2);
  // mode 0 or 1: z.Sqrt()
  if (mode == 0 || mode == 1) {
    z = complex_sqrt(z);
  }
  // z.Div(z3)
  z = complex_div(z, z3);
  // mode 0 or 1: rng branch flips sign
  if (mode == 0 || mode == 1) {
    let sgn = select(-1.0, 1.0, rand01(wi) < 0.5);
    return vec2f(w * sgn * z.x, w * sgn * z.y);
  }
  return vec2f(w * z.x, w * z.y);
}

// fourth — guagapunyaimel. 5 params (spin, space, twist, x, y).
// Per-quadrant 4-way mix: Q-IV→spherical, Q-I→loonie, Q-III→susan,
// Q-II→linear. Bake sqrvvar = w·w at unpack.
fn var_fourth(
  p: vec2f, w: f32,
  spin: f32, space: f32, twist: f32, off_x: f32, off_y: f32,
) -> vec2f {
  let sqrvvar = w * w;
  // Q-IV: x>0 && y>0 → spherical-style 1/r
  if (p.x > 0.0 && p.y > 0.0) {
    let theta = atan2(p.y, p.x);
    let r = 1.0 / max(sqrt(p.x * p.x + p.y * p.y), 1e-30);
    return vec2f(w * r * cos(theta), w * r * sin(theta));
  }
  // Q-I: x>0 && y<0 → loonie
  if (p.x > 0.0 && p.y < 0.0) {
    let r2 = p.x * p.x + p.y * p.y;
    if (r2 < sqrvvar) {
      let r = w * sqrt(max(sqrvvar / max(r2, 1e-30) - 1.0, 0.0));
      return vec2f(r * p.x, r * p.y);
    }
    return vec2f(w * p.x, w * p.y);
  }
  // Q-III: x<0 && y>0 → susan
  if (p.x < 0.0 && p.y > 0.0) {
    let xx = p.x - off_x;
    let yy = p.y + off_y;
    let r0 = sqrt(xx * xx + yy * yy);
    if (r0 < w) {
      // theta = atan2(...) + spin + twist·(w-r0). spin and twist are
      // slider params — safe_* per convention.
      let theta = atan2(yy, xx) + spin + twist * (w - r0);
      let r = w * r0;
      return vec2f(r * safe_cos(theta) + off_x, r * safe_sin(theta) - off_y);
    }
    let r = w * (1.0 + space / max(r0, 1e-30));
    return vec2f(r * xx + off_x, r * yy - off_y);
  }
  // Q-II: linear passthrough
  return vec2f(w * p.x, w * p.y);
}

// ---------------------------------------------------------------------
// #121 batch L9 — JWildfire 2D continuing (4 vars). Sources: PulseFunc,
// Rays1Func + Rays2Func + Rays3Func (Raykoid666 trio). All LGPL-2.1+.
// ---------------------------------------------------------------------

// pulse — sin-modulated linear. x' = w(x + scalex·sin(x·freqx)), same y.
// p.x · freqx and p.y · freqy are unbounded coord×coef products → trig
// routed through safe_* per Dawn f32 cliff convention (sibling V85
// waves2 uses safe_sin).
fn var_pulse(p: vec2f, w: f32, freqx: f32, freqy: f32, scalex: f32, scaley: f32) -> vec2f {
  return vec2f(
    w * (p.x + scalex * safe_sin(p.x * freqx)),
    w * (p.y + scaley * safe_sin(p.y * freqy)),
  );
}

// rays1 — Raykoid666. 0 params. Radial ray burst. sqrt(r²) and tan() of
// unbounded radius → routed through safe_tan (sibling V50 var_rays
// pattern).
fn var_rays1(p: vec2f, w: f32) -> vec2f {
  let t = p.x * p.x + p.y * p.y;
  let tan_val = safe_tan(sqrt(max(t, 1e-30)));
  let inv_tan = 1.0 / select(tan_val, 1e-30, abs(tan_val) < 1e-30);
  let u = inv_tan + w * (2.0 / PI) * (2.0 / PI);
  let xs = w * u * t / select(p.x, 1e-30, p.x == 0.0);
  let ys = w * u * t / select(p.y, 1e-30, p.y == 0.0);
  return vec2f(xs, ys);
}

// rays2 — Raykoid666. 0 params. Increased trig complexity. tan(1/t²) is
// huge for small t and cos(inner) on unbounded arg → both routed through
// safe_* per Dawn f32 cliff convention.
fn var_rays2(p: vec2f, w: f32) -> vec2f {
  let t = p.x * p.x + p.y * p.y;
  let t_safe = max(t, 1e-30);
  let inner = (t_safe + 1e-6) * safe_tan(1.0 / t_safe + 1e-6);
  let cos_inner = safe_cos(inner);
  let u = 1.0 / select(cos_inner, 1e-30, abs(cos_inner) < 1e-30);
  let coef = w / 10.0;
  let xs = coef * u * t / select(p.x, 1e-30, p.x == 0.0);
  let ys = coef * u * t / select(p.y, 1e-30, p.y == 0.0);
  return vec2f(xs, ys);
}

// rays3 — Raykoid666. 0 params. Highest trig complexity. All four trig
// calls operate on unbounded t / t² / 1/t² args → safe_* per Dawn f32
// cliff convention.
fn var_rays3(p: vec2f, w: f32) -> vec2f {
  let t = p.x * p.x + p.y * p.y;
  let t_safe = max(t, 1e-30);
  let inner = safe_sin(t * t + 1e-6) * safe_sin(1.0 / (t_safe * t_safe) + 1e-6);
  let denom = sqrt(max(safe_cos(inner), 1e-30));
  let u = 1.0 / max(denom, 1e-30);
  let coef = w / 10.0;
  let xs = coef * u * safe_cos(t) * t / select(p.x, 1e-30, p.x == 0.0);
  let ys = coef * u * safe_tan(t) * t / select(p.y, 1e-30, p.y == 0.0);
  return vec2f(xs, ys);
}

// ---------------------------------------------------------------------
// #121 batch L10 — JWildfire 2D continuing (3 vars). Sources: TancosFunc
// (Raykoid666), TwoFaceFunc (DarkBeam), EJuliaFunc (Faber eSeries).
// All LGPL-2.1+, NOTICE.md. tancos/twoface deterministic; e_julia
// uses 1 RNG per iter (julian-style randint branch).
// ---------------------------------------------------------------------

// tancos — Raykoid666. 0 params. Mixed tanh + cos projection.
fn var_tancos(p: vec2f, w: f32) -> vec2f {
  let d1 = 1e-6 + p.x * p.x + p.y * p.y;
  let d2 = w / d1;
  return vec2f(
    d2 * tanh(d1) * 2.0 * p.x,
    d2 * cos(d1) * 2.0 * p.y,
  );
}

// twoface — DarkBeam. 0 params. Half-spherical: when x > 0, divide by
// r²; else pass through. Creates a sharp "spherical inversion on the
// right half-plane, identity on the left" effect.
fn var_twoface(p: vec2f, w: f32) -> vec2f {
  var v = w;
  if (p.x > 0.0) {
    v = v / max(p.x * p.x + p.y * p.y, 1e-30);
  }
  return vec2f(v * p.x, v * p.y);
}

// e_julia — Michael Faber's eSeries. 1 param (power int, negative
// allowed). Hyperbolic Julian-style variant using acosh/acos for the
// mu/nu coords, then sinh/cosh + sin/cos to project. Per-iter randint
// branch ∈ [0, |power|-1] picks angular slice.
fn var_e_julia(p: vec2f, w: f32, power_p: f32, wi: u32) -> vec2f {
  let pow_safe = select(power_p, 1.0, power_p == 0.0);
  let sign_flag = select(-1, 1, pow_safe > 0.0);
  let pow_abs = abs(pow_safe);
  var r2 = p.y * p.y + p.x * p.x;
  var x: f32;
  if (sign_flag == 1) {
    x = p.x;
  } else {
    r2 = 1.0 / max(r2, 1e-30);
    x = p.x * r2;
  }
  let tmp = r2 + 1.0;
  let tmp2 = 2.0 * x;
  let sqrt_a = sqrt(max(tmp + tmp2, 0.0));
  let sqrt_b = sqrt(max(tmp - tmp2, 0.0));
  var xmax = (sqrt_a + sqrt_b) * 0.5;
  if (xmax < 1.0) {
    xmax = 1.0;
  }
  let mu_raw = acosh(xmax);
  var t = x / xmax;
  if (t > 1.0) { t = 1.0; }
  if (t < -1.0) { t = -1.0; }
  var nu = acos(t);
  if (p.y < 0.0) { nu = -nu; }
  let randint = floor(rand01(wi) * pow_abs);
  nu = nu / pow_safe + (2.0 * PI / pow_safe) * randint;
  let mu = mu_raw / pow_safe;
  return vec2f(
    w * cosh(mu) * cos(nu),
    w * sinh(mu) * sin(nu),
  );
}

// ---------------------------------------------------------------------
// #121 batch L11 — 3 vars: cannabis_curve_wf, e_collide, e_mod.
// ---------------------------------------------------------------------

// cannabis_curve_wf — high-freq parametric flower base shape.
fn var_cannabis_curve_wf(p: vec2f, w: f32, filled: f32, wi: u32) -> vec2f {
  var a = atan2(p.y, p.x);
  var r = (1.0 + 0.9 * cos(8.0 * a)) * (1.0 + 0.1 * cos(24.0 * a)) * (0.9 + 0.1 * cos(200.0 * a)) * (1.0 + sin(a));
  a = a + PI * 0.5;
  if (filled > 0.0 && filled > rand01(wi)) {
    r = r * rand01(wi);
  }
  return vec2f(w * sin(a) * r, w * cos(a) * r);
}

// e_collide — Faber eSeries 2-param elliptic-coord collision fold.
fn var_e_collide(p: vec2f, w: f32, num_p: f32, a: f32) -> vec2f {
  let num = max(1.0, num_p);
  let ecn_pi = num / PI;
  let pi_ecn = PI / num;
  let eca_ecn = PI * a / num;
  let tmp = p.y * p.y + p.x * p.x + 1.0;
  let tmp2 = 2.0 * p.x;
  let sqrt_a = sqrt(max(tmp + tmp2, 0.0));
  let sqrt_b = sqrt(max(tmp - tmp2, 0.0));
  var xmax = (sqrt_a + sqrt_b) * 0.5;
  if (xmax < 1.0) { xmax = 1.0; }
  var t = p.x / xmax;
  if (t > 1.0) { t = 1.0; }
  if (t < -1.0) { t = -1.0; }
  var nu = acos(t);
  let alt = i32(nu * ecn_pi);
  let alt_even = (alt & 1) == 0;
  let offset = select(-eca_ecn, eca_ecn, alt_even);
  let arg = nu + offset;
  let folded = arg - floor(arg / pi_ecn) * pi_ecn;
  nu = f32(alt) * pi_ecn + folded;
  if (p.y <= 0.0) { nu = -nu; }
  return vec2f(
    w * xmax * cos(nu),
    w * sqrt(max(xmax - 1.0, 0.0)) * sqrt(xmax + 1.0) * sin(nu),
  );
}

// e_mod — Faber eSeries 2-param elliptic-coord modulus fold.
fn var_e_mod(p: vec2f, w: f32, radius: f32, distance: f32) -> vec2f {
  let tmp = p.y * p.y + p.x * p.x + 1.0;
  let tmp2 = 2.0 * p.x;
  let sqrt_a = sqrt(max(tmp + tmp2, 0.0));
  let sqrt_b = sqrt(max(tmp - tmp2, 0.0));
  var xmax = (sqrt_a + sqrt_b) * 0.5;
  if (xmax < 1.0) { xmax = 1.0; }
  var mu = acosh(xmax);
  var t = p.x / xmax;
  if (t > 1.0) { t = 1.0; }
  if (t < -1.0) { t = -1.0; }
  var nu = acos(t);
  if (p.y < 0.0) { nu = -nu; }
  if (mu < radius && -mu < radius) {
    let r_safe = max(radius, 1e-30);
    let two_r = 2.0 * r_safe;
    // JWF uses Java fmod (sign-of-dividend). WGSL `%` on f32 matches C99
    // fmod semantics, NOT Python/floor-mod. At nu≤0 the dividend can be
    // negative; floor-mod would wrap it positive (~ +0.5 r), fmod keeps
    // the negative sign (~ -0.5 r). Example r=1,d=0,mu=0.5,nu=-0.3 →
    // JWF/fmod mu'=0.5; floor-mod mu'=2.5.
    if (nu > 0.0) {
      mu = (mu + r_safe + distance * r_safe) % two_r - r_safe;
    } else {
      mu = (mu - r_safe - distance * r_safe) % two_r + r_safe;
    }
  }
  return vec2f(
    w * cosh(mu) * cos(nu),
    w * sinh(mu) * sin(nu),
  );
}

// ---------------------------------------------------------------------
// #121 batch L12 — 2 vars: intersection (Stefanov 10-param tile RNG),
// inv_squircular (0-param inverse squircular).
// ---------------------------------------------------------------------

// intersection — Brad Stefanov. 10 params. 50/50 split between
// "x-axis tile" mode and "y-axis tile" mode, each applying a log-scaled
// random horizontal/vertical step + a 3-zone fmod fold on the other axis.
fn var_intersection(
  p: vec2f, w: f32,
  xwidth: f32, xtilesize: f32, xmod1: f32, xmod2: f32, xheight: f32,
  yheight: f32, ytilesize: f32, ymod1: f32, ymod2: f32, ywidth: f32,
  wi: u32,
) -> vec2f {
  // JWF IntersectionFunc emits xy with NO pAmount factor — the variation
  // weight is effectively ignored (sibling V206 inv_squircular preserves
  // this convention). The `w * 0` short-circuit keeps the
  // dispatch-routed weight a true no-op (weight=0 should still produce
  // (0,0)) while otherwise matching the canonical no-w convention.
  if (w == 0.0) { return vec2f(0.0, 0.0); }
  // JWF uses fmod (sign-of-dividend). WGSL `%` matches.
  let xr1 = xmod2 * xmod1;
  let yr1 = ymod2 * ymod1;
  if (rand01(wi) < 0.5) {
    let x = select(-xwidth, xwidth, rand01(wi) < 0.5);
    let ox = xtilesize * (p.x + round(x * log(max(rand01(wi), 1e-30))));
    var oy: f32;
    if (p.y > xmod1) {
      let r1_safe = max(xr1, 1e-30);
      oy = xheight * (-xmod1 + (p.y + xmod1) % r1_safe);
    } else if (p.y < -xmod1) {
      let r1_safe = max(xr1, 1e-30);
      oy = xheight * (xmod1 - (xmod1 - p.y) % r1_safe);
    } else {
      oy = xheight * p.y;
    }
    return vec2f(ox, oy);
  }
  let y = select(-yheight, yheight, rand01(wi) < 0.5);
  let oy = ytilesize * (p.y + round(y * log(max(rand01(wi), 1e-30))));
  var ox: f32;
  if (p.x > ymod1) {
    let r1_safe = max(yr1, 1e-30);
    ox = ywidth * (-ymod1 + (p.x + ymod1) % r1_safe);
  } else if (p.x < -ymod1) {
    let r1_safe = max(yr1, 1e-30);
    ox = ywidth * (ymod1 - (ymod1 - p.x) % r1_safe);
  } else {
    ox = ywidth * p.x;
  }
  return vec2f(ox, oy);
}

// inv_squircular — 0 params. Inverse squircular projection: maps the
// plane into a squircle-shaped region. Uses sqrt(squircular formula).
fn var_inv_squircular(p: vec2f, w: f32) -> vec2f {
  if (w == 0.0) {
    return vec2f(0.0, 0.0);
  }
  let SQRT2: f32 = 1.41421356237;
  let u = p.x;
  let v = p.y;
  let r_in = u * u + v * v;
  let r2_arg = r_in * (w * w * r_in - 4.0 * u * u * v * v) / w;
  let r2 = sqrt(max(r2_arg, 0.0));
  let r = sqrt(max(r_in - r2, 0.0)) / SQRT2;
  let u_safe = select(u, 1e-30, u == 0.0);
  let v_safe = select(v, 1e-30, v == 0.0);
  return vec2f(r / u_safe, r / v_safe);
}

// ---------------------------------------------------------------------
// #121 batch L13 — 3 vars: lozi (TyrantWave 2D map), hypershift
// (Zy0rg Möbius radial), hex_modulus (Zabanova hexagonal fold).
// ---------------------------------------------------------------------

// lozi — TyrantWave. 3 params (a, b, c). Lozi map: x' = c - a·|x| + y,
// y' = b·x. Sibling of V159 henon (which uses x² instead of |x|).
fn var_lozi(p: vec2f, w: f32, a: f32, b: f32, c: f32) -> vec2f {
  return vec2f(w * (c - a * abs(p.x) + p.y), w * b * p.x);
}

// hypershift — Zy0rg. 2 params (shift, stretch). Möbius-style radial
// shift that maps the plane to a hyperbolic-like disc with shift offset.
fn var_hypershift(p: vec2f, w: f32, shift: f32, stretch: f32) -> vec2f {
  let scale = 1.0 - shift * shift;
  let rad1 = 1.0 / max(p.x * p.x + p.y * p.y, 1e-30);
  let x = rad1 * p.x + shift;
  let y = rad1 * p.y;
  let rad = w * scale / max(x * x + y * y, 1e-30);
  return vec2f(rad * x + shift, rad * y * stretch);
}

// hex_modulus — Zabanova via Stefanov. 1 param (size). Hexagonal-grid
// modulus fold: converts iterate to hexagonal axial coords, rounds to
// nearest hex cell, computes displacement from cell center.
fn var_hex_modulus(p: vec2f, w: f32, size: f32) -> vec2f {
  let M_SQRT3_2: f32 = 0.8660254037844386;
  let M_SQRT3: f32 = 1.7320508075688772;
  let hsize = M_SQRT3_2 / max(size, 1e-30);
  let weight = w / M_SQRT3_2;
  let X = p.x * hsize;
  let Y = p.y * hsize;
  let x = 0.5773502691896258 * X - Y / 3.0;
  let z = 2.0 * Y / 3.0;
  let y = -x - z;
  var rx = round(x);
  var ry = round(y);
  var rz = round(z);
  let x_diff = abs(rx - x);
  let y_diff = abs(ry - y);
  let z_diff = abs(rz - z);
  if (x_diff > y_diff && x_diff > z_diff) {
    rx = -ry - rz;
  } else if (y_diff > z_diff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  let FX_h = M_SQRT3 * rx + M_SQRT3_2 * rz;
  let FY_h = 1.5 * rz;
  return vec2f((X - FX_h) * weight, (Y - FY_h) * weight);
}

// ---------------------------------------------------------------------
// #121 batch L14 (final). 4 vars: boarders2 (Xyrus02 grid-cell border
// fold), b_mod (Faber bSeries modulus radial fold), b_transform (Faber
// bSeries Möbius transform with RNG), parallel (Stefanov 10-param tile
// parallel mode pair — x2height/x2move hardcoded inside kernel to fit
// the 10-param seam).
// ---------------------------------------------------------------------

// boarders2 — Xyrus02. 3 params (c, left, right). Per-iter RNG decides
// between center-pull (prob 1 - _cr) and edge-shift (prob _cr). Bake
// matches JWildfire Boarders2Func.init: _c = |c| (EPS if 0), _cl =
// |c|·|left|, _cr = |c| + |c|·|right| = |c|·(1+|right|), all with
// EPS=1e-6 guards on the pre-product abs values.
fn var_boarders2(p: vec2f, w: f32, c: f32, left: f32, right: f32, wi: u32) -> vec2f {
  let ac = max(abs(c), 1e-6);
  let al = max(abs(left), 1e-6);
  let ar = max(abs(right), 1e-6);
  let _c = ac;
  let _cl = ac * al;
  let _cr = ac + ac * ar;
  let roundX = round(p.x);
  let roundY = round(p.y);
  let offsetX = p.x - roundX;
  let offsetY = p.y - roundY;
  if (rand01(wi) >= _cr) {
    return vec2f(w * (offsetX * _c + roundX), w * (offsetY * _c + roundY));
  }
  if (abs(offsetX) >= abs(offsetY)) {
    if (offsetX >= 0.0) {
      return vec2f(
        w * (offsetX * _c + roundX + _cl),
        w * (offsetY * _c + roundY + _cl * offsetY / select(offsetX, 1e-30, offsetX == 0.0)),
      );
    }
    return vec2f(
      w * (offsetX * _c + roundX - _cl),
      w * (offsetY * _c + roundY - _cl * offsetY / select(offsetX, 1e-30, offsetX == 0.0)),
    );
  }
  if (offsetY >= 0.0) {
    return vec2f(
      w * (offsetX * _c + roundX + offsetX / select(offsetY, 1e-30, offsetY == 0.0) * _cl),
      w * (offsetY * _c + roundY + _cl),
    );
  }
  return vec2f(
    w * (offsetX * _c + roundX - offsetX / select(offsetY, 1e-30, offsetY == 0.0) * _cl),
    w * (offsetY * _c + roundY - _cl),
  );
}

// b_mod — Faber bSeries. 2 params (radius, distance). Bipolar coords
// with mu-axis modulus fold. Sibling of V163 bcollide / V184 shredrad.
fn var_b_mod(p: vec2f, w: f32, radius: f32, distance: f32) -> vec2f {
  let xp1 = p.x + 1.0;
  let xm1 = p.x - 1.0;
  let y2 = p.y * p.y;
  var tau = 0.5 * (log(max(xp1 * xp1 + y2, 1e-30)) - log(max(xm1 * xm1 + y2, 1e-30)));
  // sigma is bounded by two atan2 calls (∈ ~[-π, 3π]) — raw trig is safe.
  let sigma = PI - atan2(p.y, xp1) - atan2(p.y, 1.0 - p.x);
  if (tau < radius && -tau < radius) {
    let r_safe = max(radius, 1e-30);
    let two_r = 2.0 * r_safe;
    let arg = tau + r_safe + distance * r_safe;
    tau = arg - floor(arg / two_r) * two_r - r_safe;
  }
  let temp = cosh(tau) - cos(sigma);
  let temp_safe = select(temp, 1e-30, abs(temp) < 1e-30);
  return vec2f(w * sinh(tau) / temp_safe, w * sin(sigma) / temp_safe);
}

// b_transform — Faber bSeries. 4 params (rotate, power int, move,
// split). Bipolar coords with power-split + RNG randint angular slice.
fn var_b_transform(p: vec2f, w: f32, rotate: f32, power_p: f32, move_v: f32, split: f32, wi: u32) -> vec2f {
  let power = max(1.0, power_p);
  let xp1 = p.x + 1.0;
  let xm1 = p.x - 1.0;
  let y2 = p.y * p.y;
  var tau = 0.5 * (log(max(xp1 * xp1 + y2, 1e-30)) - log(max(xm1 * xm1 + y2, 1e-30))) / power + move_v;
  // sigma carries `rotate` (slider) + randint·2π/power — adversarially
  // unbounded. safe_* per convention.
  var sigma = PI - atan2(p.y, xp1) - atan2(p.y, 1.0 - p.x) + rotate;
  let randint = floor(rand01(wi) * power);
  sigma = sigma / power + (2.0 * PI / power) * randint;
  tau = tau + select(-split, split, p.x >= 0.0);
  let temp = cosh(tau) - safe_cos(sigma);
  let temp_safe = select(temp, 1e-30, abs(temp) < 1e-30);
  return vec2f(w * sinh(tau) / temp_safe, w * safe_sin(sigma) / temp_safe);
}

// parallel — Stefanov. 10 params + 2 hardcoded (x2height=0.5, x2move=1.0
// to fit 10-param seam — matches JWildfire defaults). Sibling of V205
// intersection but with an additive move offset.
fn var_parallel(
  p: vec2f, w: f32,
  x1width: f32, x1tilesize: f32, x1mod1: f32, x1mod2: f32, x1height: f32, x1move: f32,
  x2width: f32, x2tilesize: f32, x2mod1: f32, x2mod2: f32,
  wi: u32,
) -> vec2f {
  let x2height: f32 = 0.5;   // hardcoded — JWildfire default
  let x2move: f32 = 1.0;     // hardcoded — JWildfire default
  let xr1 = x1mod2 * x1mod1;
  let xr2 = x2mod2 * x2mod1;
  if (rand01(wi) < 0.5) {
    let x1 = select(-x1width, x1width, rand01(wi) < 0.5);
    let ox = w * x1tilesize * (p.x + round(x1 * log(max(rand01(wi), 1e-30))));
    var oy: f32;
    if (p.y > x1mod1) {
      let arg = p.y + x1mod1;
      let r_safe = max(xr1, 1e-30);
      oy = w * x1height * (-x1mod1 + (arg - floor(arg / r_safe) * r_safe)) + w * x1move;
    } else if (p.y < -x1mod1) {
      let arg = x1mod1 - p.y;
      let r_safe = max(xr1, 1e-30);
      oy = w * x1height * (x1mod1 - (arg - floor(arg / r_safe) * r_safe)) + w * x1move;
    } else {
      oy = w * x1height * p.y + w * x1move;
    }
    return vec2f(ox, oy);
  }
  let x2 = select(-x2width, x2width, rand01(wi) < 0.5);
  let ox = w * x2tilesize * (p.x + round(x2 * log(max(rand01(wi), 1e-30))));
  var oy: f32;
  if (p.y > x2mod1) {
    let arg = p.y + x2mod1;
    let r_safe = max(xr2, 1e-30);
    oy = w * x2height * (-x2mod1 + (arg - floor(arg / r_safe) * r_safe)) - w * x2move;
  } else if (p.y < -x2mod1) {
    let arg = x2mod1 - p.y;
    let r_safe = max(xr2, 1e-30);
    oy = w * x2height * (x2mod1 - (arg - floor(arg / r_safe) * r_safe)) - w * x2move;
  } else {
    oy = w * x2height * p.y - w * x2move;
  }
  return vec2f(ox, oy);
}

// ---------------------------------------------------------------------
// #170 sibling-pair completions + S-tier ports (V214..V219). Brownian
// intentionally NOT ported — JWildfire BrownianFunc relies on a
// persistent Draw2D canvas + DynamicArray2D state container, which
// has no analogue in pyr3's stateless WGSL chaos kernel.
// ---------------------------------------------------------------------

// waves3 — Zabanova/Stefanov sibling to V16 waves / V85 waves2. The
// y-axis frequency `sx_freq` modulates scalex per-iter; the x-axis
// frequency `sy_freq` modulates scaley.
fn var_waves3(p: vec2f, w: f32, scalex: f32, scaley: f32, freqx: f32, freqy: f32, sx_freq: f32, sy_freq: f32) -> vec2f {
  // y0·sx_freq, x0·sy_freq are unbounded products of walker coord and
  // slider — safe_* per Dawn f32 trig cliff convention.
  let scalexx = 0.5 * scalex * (1.0 + safe_sin(p.y * sx_freq));
  let scaleyy = 0.5 * scaley * (1.0 + safe_sin(p.x * sy_freq));
  return vec2f(
    w * (p.x + safe_sin(p.y * freqx) * scalexx),
    w * (p.y + safe_sin(p.x * freqy) * scaleyy),
  );
}

// waves4 — Zabanova/Stefanov sibling. Cell-banded variant: floor(y0·freqx/2π)
// indexes a hash → multiplies scalex by hash² (or 0/1 if `cont`=1).
fn var_waves4(p: vec2f, w: f32, scalex: f32, scaley: f32, freqx: f32, freqy: f32, cont_p: f32, yfact: f32) -> vec2f {
  let cell = floor(p.y * freqx / TAU);
  // Spatial-hash trick (same family as V167 circular). Raw sin/cos is
  // the design here — see the V167 audit comment for rationale.
  var ax = sin(cell * 12.9898 + cell * 78.233 + 1.0 + p.y * 0.001 * yfact) * 43758.5453;
  ax = ax - trunc(ax);
  let cont = cont_p > 0.5;
  if (cont) { ax = select(0.0, 1.0, ax > 0.5); }
  return vec2f(
    w * (p.x + safe_sin(p.y * freqx) * ax * ax * scalex),
    w * (p.y + safe_sin(p.x * freqy) * scaley),
  );
}

// scry2 — dark-beam. Loonie2-init (n-sided star + circle blend) plus a
// scry-style 1/d inversion. Loop structure mirrors V105 loonie2 verbatim
// up to the inversion choice; final emission is `p · 1/d` where d
// closes both the inside-loonie2 r² and the scry r1·(r2+1/w) factor.
fn var_scry2(p: vec2f, w: f32, sides_f: f32, star: f32, circle: f32) -> vec2f {
  let MAX_SCRY2_SIDES: i32 = 50;
  let sides = clamp(i32(sides_f), 1, MAX_SCRY2_SIDES);
  let a = TAU / f32(sides);
  let sina = safe_sin(a);
  let cosa = safe_cos(a);
  // JWF init mirrors loonie2: a = -π/2·star; sins = sin(a).
  let sins = safe_sin(-star * PI * 0.5);
  let coss = safe_cos(star * PI * 0.5);
  let sinc = safe_sin(circle * PI * 0.5);
  let cosc = safe_cos(circle * PI * 0.5);

  var xrt = p.x;
  var yrt = p.y;
  var r2 = xrt * coss + abs(yrt) * sins;
  let circle_r = sqrt(xrt * xrt + yrt * yrt);
  var iters: i32 = 0;
  for (var i: i32 = 0; i < MAX_SCRY2_SIDES; i = i + 1) {
    if (i >= sides - 1) { break; }
    let swp = xrt * cosa - yrt * sina;
    yrt = xrt * sina + yrt * cosa;
    xrt = swp;
    r2 = max(r2, xrt * coss + abs(yrt) * sins);
    iters = i + 1;
  }
  r2 = r2 * cosc + circle_r * sinc;
  let r1 = r2;
  if (iters > 1) {
    r2 = r2 * r2;
  } else {
    r2 = abs(r2) * r2;
  }
  // scry effect: d = r1·(r2 + 1/w). At w=0 the source returns early; we
  // emit (0,0) to match.
  if (w == 0.0) { return vec2f(0.0, 0.0); }
  let d = r1 * (r2 + 1.0 / w);
  if (d == 0.0) { return vec2f(0.0, 0.0); }
  let r = 1.0 / d;
  return vec2f(p.x * r, p.y * r);
}

// ennepers2 — dark-beam. 3 params (a, b, c). Polynomial fold derived
// from the Enneper minimal surface, sibling to V152 ennepers but with
// per-axis scale + sqrt(|p|) absorption term.
fn var_ennepers2(p: vec2f, w: f32, ap: f32, bp: f32, cp: f32) -> vec2f {
  let xx = p.x;
  let yy = p.y;
  let r2 = 1.0 / max(xx * xx + yy * yy, 1e-30);
  let dxy = (ap * xx) * (ap * xx) - (bp * yy) * (bp * yy);
  return vec2f(
    w * xx * (ap * ap - dxy * r2 - cp * sqrt(abs(xx))),
    w * yy * (bp * bp - dxy * r2 - cp * sqrt(abs(yy))),
  );
}

// apollony — Jesus Sosa's Apollonian gasket IFS (via Paul Bourke).
// 3-branch random pick per iter. No params. r = √3 hardcoded.
fn var_apollony(p: vec2f, w: f32, wi: u32) -> vec2f {
  let SQRT3: f32 = 1.7320508075688772;
  let dx = 1.0 + SQRT3 - p.x;
  let denom = dx * dx + p.y * p.y;
  let denom_safe = max(denom, 1e-30);
  let a0 = 3.0 * dx / denom_safe - (1.0 + SQRT3) / (2.0 + SQRT3);
  let b0 = 3.0 * p.y / denom_safe;
  let ab_sq = max(a0 * a0 + b0 * b0, 1e-30);
  let f1x = a0 / ab_sq;
  let f1y = -b0 / ab_sq;
  // Source: int w = (int)(4·random()); branch on w%3 (so 4 of every 4
  // rand draws produce 0/1/2/0 → branch 0 fires twice).
  let branch = i32(floor(4.0 * rand01(wi))) % 3;
  var x: f32;
  var y: f32;
  if (branch == 0) {
    x = a0;
    y = b0;
  } else if (branch == 1) {
    x = -f1x * 0.5 - f1y * SQRT3 * 0.5;
    y = f1x * SQRT3 * 0.5 - f1y * 0.5;
  } else {
    x = -f1x * 0.5 + f1y * SQRT3 * 0.5;
    y = -f1x * SQRT3 * 0.5 - f1y * 0.5;
  }
  return vec2f(w * x, w * y);
}

// circlecrop — Xyrus02. 5 params (radius, x, y, scatter_area, zero).
// Crops the iterate to a disc of radius `radius` centered at (x, y).
// `zero=1`: outside the disc → (0,0) (doHide semantics). `zero=0`:
// outside → wrap to disc edge with scatter-area-jittered radius.
fn var_circlecrop(
  p: vec2f, w: f32,
  radius: f32, cx: f32, cy: f32, scatter_area: f32, zero_p: f32,
  wi: u32,
) -> vec2f {
  let ca = clamp(scatter_area, -1.0, 1.0);
  let dx = p.x - cx;
  let dy = p.y - cy;
  let rad = sqrt(dx * dx + dy * dy);
  let ang = atan2(dy, dx);
  let rdc = radius + (rand01(wi) * 0.5 * ca);
  let esc = rad > radius;
  let zero = zero_p > 0.5;
  if (zero && esc) {
    return vec2f(0.0, 0.0);   // doHide → contribute nothing
  }
  // ang ∈ [-π, π] from atan2 — raw trig fine.
  if (!zero && esc) {
    return vec2f(w * rdc * cos(ang) + cx, w * rdc * sin(ang) + cy);
  }
  // Inside the disc (both zero=0 and zero=1 with !esc) → pass through scaled.
  return vec2f(w * dx + cx, w * dy + cy);
}

// ---------------------------------------------------------------------
// #133 — Conformal & complex-analytic warps (V220–V224). Five novel
// (not in JWildfire) variations from classical complex analysis,
// using the complex helpers above (complex_mul/sqr/div/log/exp/pow/sin).
// V220 newton: position warp + DC basin coloring (extends the
//              dc_cylinder V102 "position-warp + DC" precedent).
// V221 blaschke: 2-to-1 disk-symmetric Möbius factor.
// V222 cayley: upper-half-plane → unit disk conformal map.
// V223 complex_gamma: Γ(z) via Lanczos g=7 + reflection.
// V224 lambert_w: principal branch W₀ via Halley iteration.
// ---------------------------------------------------------------------

// Repeated-squaring integer power for complex numbers. Faster than
// complex_pow (log/exp roundtrip) for small integer exponents. Used by
// var_newton to compute zⁿ and zⁿ⁻¹ for n in [2, 8].
fn complex_pow_int(z: vec2f, k: i32) -> vec2f {
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

// V220 newton: one Newton step on zⁿ − 1.
//   z' = z − f(z)/f'(z) = z − (zⁿ − 1) / (n · zⁿ⁻¹)
//       = ((n−1)·zⁿ + 1) / (n · zⁿ⁻¹)
// Pole at z = 0 (zⁿ⁻¹ → 0). Guarded by complex_div's |b|² floor + an
// explicit zero-check on the divisor's magnitude.
fn var_newton(p: vec2f, w: f32, n_in: f32) -> vec2f {
  let n = clamp(i32(n_in + 0.5), 2, 8);
  let zn = complex_pow_int(p, n);
  let znm1 = complex_pow_int(p, n - 1);
  let nf = f32(n);
  let nm1 = f32(n - 1);
  let num = vec2f(nm1 * zn.x + 1.0, nm1 * zn.y);
  let den = vec2f(nf * znm1.x, nf * znm1.y);
  // complex_div's |b|² floor (1e-100) flushes to 0 on Dawn f32 (see
  // reference-dawn-f32-ftz-cliff). For z=0 (the n·zⁿ⁻¹ pole), an explicit
  // 1e-20 threshold on the denominator magnitude returns the passthrough
  // p instead of Inf — semantically equivalent to "z stays put at the
  // singularity" and the chaos game's bad-value check tolerates this.
  if (dot(den, den) < 1.0e-20) { return w * p; }
  return w * complex_div(num, den);
}

// V220 newton DC color: classify which root of zⁿ − 1 the post-step
// coordinate is closest to. Roots are evenly-spaced on the unit
// circle at angles 2πk/n. Hue = k/n via the existing hsl_to_rgb
// (saturation 1, lightness 0.55 — same look as dc_perlin / dc_cylinder).
// Called from the DC dispatch block in the chain loop AFTER the
// position warp; we recompute the post-step coord here so the color
// reflects which root the next chaos iter is heading toward (matches
// the classical Newton fractal coloring algorithm).
fn var_newton_color(p_pre: vec2f, n_in: f32) -> vec3f {
  let n = clamp(i32(n_in + 0.5), 2, 8);
  let z_post = var_newton(p_pre, 1.0, f32(n));
  var best_k: i32 = 0;
  var best_d2: f32 = 1.0e30;
  let two_pi_over_n = 6.2831853 / f32(n);
  for (var k: i32 = 0; k < 8; k = k + 1) {
    if (k >= n) { break; }
    let ang = two_pi_over_n * f32(k);
    let r_k = vec2f(cos(ang), sin(ang));
    let d = z_post - r_k;
    let d2 = dot(d, d);
    if (d2 < best_d2) { best_d2 = d2; best_k = k; }
  }
  let hue = f32(best_k) / f32(n);
  return hsl_to_rgb(vec3f(hue, 1.0, 0.55));
}

// ─────────────────────────────────────────────────────────────────────────
// Escape-time fractal single-steps (#145). V310–V313. Each is a single step
// of a classic escape-time iteration, expressed with the complex helpers.
// Each emits an optional DC escape-band color via escape_color (below) when
// the per-xform dc_flag is set. No trig → no safe_* needed. Pole guards
// mirror var_newton: an explicit |den|² < 1e-20 check returns the passthrough
// w*p (semantically "stays put at the singularity"; the chaos game's
// bad-value check tolerates it).
// ─────────────────────────────────────────────────────────────────────────

// V310 burning_ship: z' = (|Re z| + i·|Im z|)² + c. No pole; growth is
// caught by the chaos-game bad-value reseed.
fn var_burning_ship(p: vec2f, w: f32, cx: f32, cy: f32) -> vec2f {
  let za = vec2f(abs(p.x), abs(p.y));
  return w * (complex_sqr(za) + vec2f(cx, cy));
}

// V311 magnet1: z' = ((z² + c − 1) / (2z + c − 2))². Pole at 2z+c−2=0.
fn var_magnet1(p: vec2f, w: f32, cx: f32, cy: f32) -> vec2f {
  let c = vec2f(cx, cy);
  let num = complex_sqr(p) + c - vec2f(1.0, 0.0);
  let den = 2.0 * p + c - vec2f(2.0, 0.0);
  if (dot(den, den) < 1.0e-20) { return w * p; }
  let ratio = complex_div(num, den);
  return w * complex_sqr(ratio);
}

// V312 nova: relaxed Newton on f(z)=z³−1.  z' = z − relax·f/f' + c, f'=3z².
// Pole at z=0 (f'→0).
fn var_nova(p: vec2f, w: f32, cx: f32, cy: f32, relax: f32) -> vec2f {
  let z3 = complex_pow_int(p, 3);
  let z2 = complex_sqr(p);
  let num = z3 - vec2f(1.0, 0.0);
  let den = 3.0 * z2;
  if (dot(den, den) < 1.0e-20) { return w * p; }
  let step = relax * complex_div(num, den);
  return w * (p - step + vec2f(cx, cy));
}

// V313 halley: Halley step on f(z)=z³−1.  z' = z − 2ff'/(2f'²−ff'') + c,
// f'=3z², f''=6z. Pole at 2f'²−ff''=0.
fn var_halley(p: vec2f, w: f32, cx: f32, cy: f32) -> vec2f {
  let z3 = complex_pow_int(p, 3);
  let z2 = complex_sqr(p);
  let f = z3 - vec2f(1.0, 0.0);
  let fp = 3.0 * z2;
  let fpp = 6.0 * p;
  let num = 2.0 * complex_mul(f, fp);
  let den = 2.0 * complex_sqr(fp) - complex_mul(f, fpp);
  if (dot(den, den) < 1.0e-20) { return w * p; }
  return w * (p - complex_div(num, den) + vec2f(cx, cy));
}

// V310–V313 DC escape coloring (#145). Re-iterates the SAME map ≤12 times
// from the post-step point; smooth-escape banding (continuous escape count).
// Escapers band by iters-to-bailout; convergers hit the cap with small |z|,
// banding by convergence depth. hsl L=0.55 matches dc_perlin / var_newton_color.
fn escape_color(p_pre: vec2f, var_idx: u32, cx: f32, cy: f32, relax: f32) -> vec3f {
  var z = p_pre;
  var iters: i32 = 0;
  for (var i: i32 = 0; i < 12; i = i + 1) {
    if      (var_idx == 310u) { z = var_burning_ship(z, 1.0, cx, cy); }
    else if (var_idx == 311u) { z = var_magnet1(z, 1.0, cx, cy); }
    else if (var_idx == 312u) { z = var_nova(z, 1.0, cx, cy, relax); }
    else                      { z = var_halley(z, 1.0, cx, cy); }
    iters = i + 1;
    if (dot(z, z) > 256.0) { break; }
  }
  let r = max(length(z), 1.0001);
  let mu = f32(iters) + 1.0 - log2(max(log(r), 1.0e-6));
  return hsl_to_rgb(vec3f(fract(mu * 0.12), 1.0, 0.55));
}

// V221 blaschke: 2-to-1 disk-symmetric Möbius factor.
//   B(z) = z · (z − a) / (1 − ā · z)
// Two zeros: origin + a (configurable point in the unit disk). The unit
// circle is invariant. Pole at z = 1/ā lies outside the disk for |a|<1;
// complex_div's floor plus an explicit zero-check on the denominator
// magnitude handles the f32 cliff (same pattern as var_newton).
fn var_blaschke(p: vec2f, w: f32, ax: f32, ay: f32) -> vec2f {
  let a = vec2f(ax, ay);
  let a_conj = vec2f(ax, -ay);
  let num = complex_mul(p, p - a);
  let den = vec2f(1.0, 0.0) - complex_mul(a_conj, p);
  if (dot(den, den) < 1.0e-20) { return w * p; }
  return w * complex_div(num, den);
}

// V222 cayley: z' = (z − s·i) / (z + s·i). Conformal map from upper
// half-plane to the open unit disk. s=1 is the textbook form; s
// widens/narrows the strip near the real axis. Pole at z = −s·i.
fn var_cayley(p: vec2f, w: f32, s: f32) -> vec2f {
  let si = vec2f(0.0, s);
  let den = p + si;
  if (dot(den, den) < 1.0e-20) { return w * p; }
  return w * complex_div(p - si, den);
}

// V223 complex_gamma: Γ(z) via Lanczos g=7 (9 coefficients), with
// reflection branch Γ(z) = π / (sin(πz)·Γ(1−z)) for Re(z) < 0.5.
// Cephes / scipy.special.gamma equivalent precision in f64; f32 here
// suffers ~1% loss from catastrophic cancellation across the
// alternating-sign Lanczos coefficients. The `scale` param multiplies
// the output to keep walker trajectories bounded (Γ has factorial-like
// growth and an unscaled |Γ(10+i)| ≈ 362880 would blow the chaos game).
fn var_complex_gamma(p: vec2f, w: f32, scale: f32) -> vec2f {
  let LANCZOS_G: f32 = 7.0;
  let SQRT_2PI: f32 = 2.5066282746310002;
  var z = p;
  var reflect = false;
  if (z.x < 0.5) {
    reflect = true;
    z = vec2f(1.0 - z.x, -z.y);
  }
  let x = z - vec2f(1.0, 0.0);
  var A = vec2f(0.99999999999980993, 0.0);
  // Lanczos g=7 series: A = p[0] + Σ_{k=1..8} p[k] / (x + k)
  let c1: f32 = 676.5203681218851;
  let c2: f32 = -1259.1392167224028;
  let c3: f32 = 771.32342877765313;
  let c4: f32 = -176.61502916214059;
  let c5: f32 = 12.507343278686905;
  let c6: f32 = -0.13857109526572012;
  let c7: f32 = 9.9843695780195716e-6;
  let c8: f32 = 1.5056327351493116e-7;
  A = A + complex_div(vec2f(c1, 0.0), x + vec2f(1.0, 0.0));
  A = A + complex_div(vec2f(c2, 0.0), x + vec2f(2.0, 0.0));
  A = A + complex_div(vec2f(c3, 0.0), x + vec2f(3.0, 0.0));
  A = A + complex_div(vec2f(c4, 0.0), x + vec2f(4.0, 0.0));
  A = A + complex_div(vec2f(c5, 0.0), x + vec2f(5.0, 0.0));
  A = A + complex_div(vec2f(c6, 0.0), x + vec2f(6.0, 0.0));
  A = A + complex_div(vec2f(c7, 0.0), x + vec2f(7.0, 0.0));
  A = A + complex_div(vec2f(c8, 0.0), x + vec2f(8.0, 0.0));
  let t = x + vec2f(LANCZOS_G + 0.5, 0.0);
  let t_pow = complex_pow(t, x + vec2f(0.5, 0.0));
  let exp_neg_t = complex_exp(-t);
  var result = SQRT_2PI * complex_mul(t_pow, complex_mul(exp_neg_t, A));
  if (reflect) {
    // Original (pre-reflection) z = p. sin(πp) and divide.
    let pi_p = 3.14159265 * p;
    let sin_pi_p = complex_sin(pi_p);
    let pi_over_sin = complex_div(vec2f(3.14159265, 0.0), sin_pi_p);
    result = complex_div(pi_over_sin, result);
  }
  return (w * scale) * result;
}

// V224 lambert_w: principal-branch Lambert W (W₀) via Halley iteration.
// W(z) satisfies W·e^W = z. Magnitude-gated initial guess: |z| < 1 uses
// log(1+z) (small-z series), |z| ≥ 1 uses log(z) − log(log(z))
// (asymptotic). 2–4 Halley iterations land within ~f32 precision.
// Halley step: w_{n+1} = w_n − f / (f' − f·f''/(2·f'))
//   where f(w) = w·e^w − z, f'(w) = (w+1)·e^w, f''(w) = (w+2)·e^w.
//   Simplifies to: w_{n+1} = w_n − f / ((w+1)·e^w − f·(w+2)/(2·(w+1))).
fn var_lambert_w(p: vec2f, w: f32, iters_in: f32) -> vec2f {
  let z = p;
  let iters = clamp(i32(iters_in + 0.5), 1, 4);
  let mag = length(z);
  var wn: vec2f;
  // Threshold 2.0 (not 1.0): the asymptotic guess log(z) − log(log(z))
  // is degenerate at |z| ≤ e because log(z) → 0 → log(log) blows up.
  // log(1+z) is well-defined for all z except z = −1 and gives a usable
  // initial guess up through |z| ≈ 2; past that, Halley benefits from the
  // sharper asymptotic start.
  if (mag < 2.0) {
    wn = complex_log(vec2f(1.0, 0.0) + z);
  } else {
    let log_z = complex_log(z);
    wn = log_z - complex_log(log_z);
  }
  for (var i: i32 = 0; i < 4; i = i + 1) {
    if (i >= iters) { break; }
    let ew = complex_exp(wn);
    let w_ew = complex_mul(wn, ew);
    let f = w_ew - z;
    let wp1 = wn + vec2f(1.0, 0.0);
    let wp2 = wn + vec2f(2.0, 0.0);
    let two_wp1 = 2.0 * wp1;  // scalar * vec2 = (2·wp1.x, 2·wp1.y)
    if (dot(two_wp1, two_wp1) < 1.0e-20) { break; }
    let inner = complex_div(complex_mul(wp2, f), two_wp1);
    let fp = complex_mul(ew, wp1);
    let denom = fp - inner;
    if (dot(denom, denom) < 1.0e-20) { break; }
    wn = wn - complex_div(f, denom);
  }
  return w * wn;
}

// ---------------------------------------------------------------------
// #134 — Cartographic map-projection warps (V225–V229).
// Five novel global map projections treating (x,y) as (longitude, latitude).
// ---------------------------------------------------------------------

// V225 mercator: standard conformal cylindrical projection.
fn var_mercator(p: vec2f, w: f32) -> vec2f {
  let lat = clamp(p.y, -1.5, 1.5);
  let y_prime = log(abs(safe_tan(0.78539816 + lat * 0.5)) + 1e-6);
  return w * vec2f(p.x, y_prime);
}

// V226 lambert: Lambert azimuthal equal-area projection.
fn var_lambert(p: vec2f, w: f32) -> vec2f {
  let k = sqrt(2.0 / (1.0 + safe_cos(p.y) * safe_cos(p.x) + 1e-6));
  return w * vec2f(k * safe_cos(p.y) * safe_sin(p.x), k * safe_sin(p.y));
}

// V227 mollweide: Mollweide elliptical equal-area projection.
// Auxiliary angle via Newton iterations.
fn var_mollweide(p: vec2f, w: f32) -> vec2f {
  var t = p.y;
  let target_val = 3.14159265 * safe_sin(p.y);
  for (var i: i32 = 0; i < 4; i = i + 1) {
    let sin2 = safe_sin(2.0 * t);
    let cos2 = safe_cos(2.0 * t);
    let f = 2.0 * t + sin2 - target_val;
    let df = 2.0 + 2.0 * cos2;
    if (abs(df) < 1e-6) { break; }
    t = t - f / df;
  }
  let x_prime = 0.9003163 * p.x * safe_cos(t); // 2 * sqrt(2) / pi
  let y_prime = 1.4142135 * safe_sin(t);
  return w * vec2f(x_prime, y_prime);
}

// V228 hammer: Hammer / Aitoff equal-area projection.
fn var_hammer(p: vec2f, w: f32) -> vec2f {
  let z = sqrt(1.0 + safe_cos(p.y) * safe_cos(p.x * 0.5) + 1e-6);
  let x_prime = (2.828427 * safe_cos(p.y) * safe_sin(p.x * 0.5)) / z;
  let y_prime = (1.4142135 * safe_sin(p.y)) / z;
  return w * vec2f(x_prime, y_prime);
}

// V229 stereographic: Stereographic azimuthal projection.
fn var_stereographic(p: vec2f, w: f32) -> vec2f {
  let k = 2.0 / (1.0 + safe_cos(p.y) * safe_cos(p.x) + 1e-6);
  return w * vec2f(k * safe_cos(p.y) * safe_sin(p.x), k * safe_sin(p.y));
}

// ---------------------------------------------------------------------
// #130 — Single-step strange-attractor variations (V230–V232).
// Stateless single steps of famous chaotic maps.
// ---------------------------------------------------------------------

// V230 standard_map: Chirikov-Taylor standard map.
fn var_standard_map(p: vec2f, w: f32, k: f32) -> vec2f {
  let xp = p.x + k * safe_sin(p.y);
  let yp = p.y + xp;
  return w * vec2f(xp, yp);
}

// V231 de_jong: Peter de Jong strange attractor.
fn var_de_jong(p: vec2f, w: f32, a: f32, b: f32, c: f32, d: f32) -> vec2f {
  let xp = safe_sin(a * p.y) - safe_cos(b * p.x);
  let yp = safe_sin(c * p.x) - safe_cos(d * p.y);
  return w * vec2f(xp, yp);
}

// V232 ikeda: Ikeda laser dynamics map.
fn var_ikeda(p: vec2f, w: f32, u: f32) -> vec2f {
  let t = 0.4 - 6.0 / (1.0 + p.x * p.x + p.y * p.y);
  let st = safe_sin(t);
  let ct = safe_cos(t);
  let xp = 1.0 + u * (p.x * ct - p.y * st);
  let yp = u * (p.x * st + p.y * ct);
  return w * vec2f(xp, yp);
}

// ---------------------------------------------------------------------
// #129 — Fold-family variations (V233–V236).
// ---------------------------------------------------------------------

// V233 box_fold: Per-component reflection.
fn var_box_fold(p: vec2f, w: f32, limit: f32) -> vec2f {
  var xp = p.x;
  var yp = p.y;
  if (xp > limit) { xp = 2.0 * limit - xp; }
  else if (xp < -limit) { xp = -2.0 * limit - xp; }
  if (yp > limit) { yp = 2.0 * limit - yp; }
  else if (yp < -limit) { yp = -2.0 * limit - yp; }
  return w * vec2f(xp, yp);
}

// V234 sphere_fold: Radial inversion shell.
fn var_sphere_fold(p: vec2f, w: f32, rmin: f32, rmax: f32) -> vec2f {
  let r2 = p.x * p.x + p.y * p.y;
  let rmin2 = rmin * rmin;
  let rmax2 = rmax * rmax;
  var scale = 1.0;
  if (r2 < rmin2) {
    scale = rmax2 / rmin2;
  } else if (r2 < rmax2) {
    scale = rmax2 / max(r2, 1e-6);
  }
  return w * vec2f(p.x * scale, p.y * scale);
}

// V235 mandelbox_step: Box fold -> sphere fold -> affine.
fn var_mandelbox_step(p: vec2f, w: f32, scale: f32, rmin: f32, rmax: f32, cx: f32, cy: f32) -> vec2f {
  var xp = p.x;
  var yp = p.y;
  if (xp > 1.0) { xp = 2.0 - xp; }
  else if (xp < -1.0) { xp = -2.0 - xp; }
  if (yp > 1.0) { yp = 2.0 - yp; }
  else if (yp < -1.0) { yp = -2.0 - yp; }

  let r2 = xp * xp + yp * yp;
  let rmin2 = rmin * rmin;
  let rmax2 = rmax * rmax;
  var sfold = 1.0;
  if (r2 < rmin2) {
    sfold = rmax2 / rmin2;
  } else if (r2 < rmax2) {
    sfold = rmax2 / max(r2, 1e-6);
  }
  xp = xp * sfold * scale + cx;
  yp = yp * sfold * scale + cy;
  return w * vec2f(xp, yp);
}

// V236 kifs_fold: Kaleidoscopic wedge fold.
fn var_kifs_fold(p: vec2f, w: f32, n: f32, offset: f32) -> vec2f {
  let r = length(p);
  if (r < 1e-6) { return vec2f(0.0); }
  var a = atan2(p.y, p.x) - offset;
  let theta = 6.283185307179586 / max(1.0, abs(n));
  a = a - theta * floor(a / theta);
  if (a > theta * 0.5) {
    a = theta - a;
  }
  a = a + offset;
  return w * vec2f(r * safe_cos(a), r * safe_sin(a));
}

// ---------------------------------------------------------------------
// #140 — Area-preserving / toral chaos maps (V237–V240).
// ---------------------------------------------------------------------

// V237 arnold_cat: Arnold's cat map.
fn var_arnold_cat(p: vec2f, w: f32) -> vec2f {
  let xp = p.x * 2.0 + p.y;
  let yp = p.x + p.y;
  return w * (fract(vec2f(xp, yp) + 0.5) - 0.5);
}

// V238 bakers_map: Folded baker's map.
fn var_bakers_map(p: vec2f, w: f32) -> vec2f {
  let x = fract(p.x + 0.5);
  let y = fract(p.y + 0.5);
  var xp = 0.0;
  var yp = 0.0;
  if (x < 0.5) {
    xp = 2.0 * x;
    yp = y * 0.5;
  } else {
    xp = 2.0 * x - 1.0;
    yp = y * 0.5 + 0.5;
  }
  return w * (vec2f(xp, yp) - 0.5);
}

// V239 tent_map: Piecewise linear chaotic map.
fn var_tent_map(p: vec2f, w: f32) -> vec2f {
  let x = fract(p.x + 0.5);
  let y = fract(p.y + 0.5);
  let xp = 1.0 - abs(1.0 - 2.0 * x);
  let yp = 1.0 - abs(1.0 - 2.0 * y);
  return w * (vec2f(xp, yp) - 0.5);
}

// V240 logistic_map: Parabolic chaotic map.
fn var_logistic_map(p: vec2f, w: f32, r: f32) -> vec2f {
  let x = fract(p.x + 0.5);
  let y = fract(p.y + 0.5);
  let xp = r * x * (1.0 - x);
  let yp = r * y * (1.0 - y);
  return w * (vec2f(xp, yp) - 0.5);
}

// ---------------------------------------------------------------------
// #135 — Plane & roulette-curve warps (V241–V245).
// ---------------------------------------------------------------------

// V241 superellipse:
fn var_superellipse(p: vec2f, w: f32, a: f32, b: f32, n: f32) -> vec2f {
  let theta = atan2(p.y, p.x);
  let sa = max(abs(a), 1e-4);
  let sb = max(abs(b), 1e-4);
  let sn = max(n, 0.01);
  let c = abs(safe_cos(theta) / sa);
  let s = abs(safe_sin(theta) / sb);
  let r = pow(max(pow(c, sn) + pow(s, sn), 1e-6), -1.0 / sn);
  return w * vec2f(r * safe_cos(theta), r * safe_sin(theta));
}

// V242 limacon:
fn var_limacon(p: vec2f, w: f32, a: f32, b: f32) -> vec2f {
  let theta = atan2(p.y, p.x);
  let r = b + a * safe_cos(theta);
  return w * vec2f(r * safe_cos(theta), r * safe_sin(theta));
}

// V243 epicycloid:
fn var_epicycloid(p: vec2f, w: f32, k: f32) -> vec2f {
  let t = atan2(p.y, p.x);
  let k1 = k + 1.0;
  let xp = k1 * safe_cos(t) - safe_cos(k1 * t);
  let yp = k1 * safe_sin(t) - safe_sin(k1 * t);
  return w * vec2f(xp, yp);
}

// V244 catenary:
fn var_catenary(p: vec2f, w: f32, a: f32) -> vec2f {
  let sa = max(abs(a), 1e-4) * sign(a + 1e-8);
  let yp = sa * cosh(p.x / sa);
  return w * vec2f(p.x, yp);
}

// V245 tractrix:
fn var_tractrix(p: vec2f, w: f32) -> vec2f {
  let xp = p.x - tanh(p.x);
  let yp = 1.0 / cosh(p.x);
  return w * vec2f(xp, yp);
}

// V246 tinkerbell
fn var_tinkerbell(p: vec2f, w: f32, a: f32, b: f32, c: f32, d: f32) -> vec2f {
  let xp = p.x * p.x - p.y * p.y + a * p.x + b * p.y;
  let yp = 2.0 * p.x * p.y + c * p.x + d * p.y;
  return w * vec2f(xp, yp);
}

// V247 duffing (one Euler step)
fn var_duffing(p: vec2f, w: f32, h: f32, delta: f32, gamma: f32, omega: f32) -> vec2f {
  // synthetic time t = p.x for driving force
  let t = p.x;
  let xp = p.x + h * p.y;
  let yp = p.y + h * (p.x - p.x * p.x * p.x - delta * p.y + gamma * safe_cos(omega * t));
  return w * vec2f(xp, yp);
}

// V248 vanderpol (one Euler step)
fn var_vanderpol(p: vec2f, w: f32, h: f32, mu: f32) -> vec2f {
  let xp = p.x + h * p.y;
  let yp = p.y + h * (mu * (1.0 - p.x * p.x) * p.y - p.x);
  return w * vec2f(xp, yp);
}

// V249 rossler (projected to 2D, synthetic z=0)
fn var_rossler(p: vec2f, w: f32, h: f32, a: f32) -> vec2f {
  let z = length(p); // use radius as synthetic z
  let xp = p.x + h * (-p.y - z);
  let yp = p.y + h * (p.x + a * p.y);
  return w * vec2f(xp, yp);
}

// V250 droste
fn var_droste(p: vec2f, w: f32, s: f32) -> vec2f {
  let r = max(length(p), 1e-6);
  let theta = atan2(p.y, p.x);
  // log(z) = ln(r) + i*theta
  // multiply by (1 + i * ln(s)/(2pi))
  let lns_2pi = log(max(s, 1e-4)) / 6.283185307179586;
  let re = log(r) - lns_2pi * theta;
  let im = theta + lns_2pi * log(r);
  let er = exp(re);
  return w * vec2f(er * safe_cos(im), er * safe_sin(im));
}

// V251 logspiral (r = a * exp(k*theta))
fn var_logspiral(p: vec2f, w: f32, a: f32, k: f32) -> vec2f {
  let theta = atan2(p.y, p.x);
  let r = a * exp(k * theta);
  return w * vec2f(r * safe_cos(theta), r * safe_sin(theta));
}

// V252 fermat_spiral
fn var_fermat_spiral(p: vec2f, w: f32, a: f32) -> vec2f {
  let t = atan2(p.y, p.x);
  let theta = max(select(t, t + 6.283185307179586, t < 0.0), 1e-6);
  let r = a * sqrt(theta);
  return w * vec2f(r * safe_cos(theta), r * safe_sin(theta));
}

// V253 lituus
fn var_lituus(p: vec2f, w: f32, a: f32) -> vec2f {
  let t = atan2(p.y, p.x);
  let theta = max(select(t, t + 6.283185307179586, t < 0.0), 1e-6);
  let r = a / sqrt(theta);
  return w * vec2f(r * safe_cos(theta), r * safe_sin(theta));
}

// V254 hyperbolic_spiral
fn var_hyperbolic_spiral(p: vec2f, w: f32, a: f32) -> vec2f {
  let t = atan2(p.y, p.x);
  let theta = max(select(t, t + 6.283185307179586, t < 0.0), 1e-6);
  let r = a / theta;
  return w * vec2f(r * safe_cos(theta), r * safe_sin(theta));
}

// V255 weierstrass
fn var_weierstrass(p: vec2f, w: f32, a: f32, b: f32, terms: f32, amp: f32) -> vec2f {
  var Wx = 0.0;
  var Wy = 0.0;
  let N = u32(clamp(terms, 1.0, 16.0));
  var ap = 1.0;
  var bp = 1.0;
  for (var i = 0u; i < N; i++) {
    Wx += ap * safe_cos(bp * 3.1415926535 * p.x);
    Wy += ap * safe_cos(bp * 3.1415926535 * p.y);
    ap *= a;
    bp *= b;
  }
  return w * vec2f(p.x + amp * Wx, p.y + amp * Wy);
}

// V256 takagi
fn var_takagi(p: vec2f, w: f32, terms: f32, amp: f32) -> vec2f {
  var Tx = 0.0;
  var Ty = 0.0;
  let N = u32(clamp(terms, 1.0, 16.0));
  var pow2 = 1.0;
  for (var i = 0u; i < N; i++) {
    let x_scaled = pow2 * p.x;
    let y_scaled = pow2 * p.y;
    Tx += abs(x_scaled - floor(x_scaled + 0.5)) / pow2;
    Ty += abs(y_scaled - floor(y_scaled + 0.5)) / pow2;
    pow2 *= 2.0;
  }
  return w * vec2f(p.x + amp * Tx, p.y + amp * Ty);
}

// V257 cantor_stairs
fn var_cantor_stairs(p: vec2f, w: f32, terms: f32, amp: f32) -> vec2f {
  var Cx = p.x;
  var Cy = p.y;
  let N = u32(clamp(terms, 1.0, 8.0));
  for (var i = 0u; i < N; i++) {
    Cx = (Cx + safe_sin(Cx * 6.2831853)) * 0.5;
    Cy = (Cy + safe_sin(Cy * 6.2831853)) * 0.5;
  }
  return w * vec2f(p.x + amp * Cx, p.y + amp * Cy);
}

// V258 billiard_circle
fn var_billiard_circle(p: vec2f, w: f32, radius: f32, step: f32, angle: f32) -> vec2f {
  let r_clamp = max(radius, 1.0e-5);
  var px = p.x;
  var py = p.y;
  var r0 = length(p);
  if (r0 > r_clamp) {
    px = (px / r0) * r_clamp;
    py = (py / r0) * r_clamp;
    r0 = r_clamp;
  }
  var bx = 1.0;
  var by = 0.0;
  if (r0 > 1.0e-6) {
    bx = px / r0;
    by = py / r0;
  }
  let cos_a = safe_cos(angle);
  let sin_a = safe_sin(angle);
  let vx = bx * cos_a - by * sin_a;
  let vy = bx * sin_a + by * cos_a;

  let dot_pv = px * vx + py * vy;
  let len2 = px * px + py * py;
  let disc = dot_pv * dot_pv + r_clamp * r_clamp - len2;
  let t_hit = -dot_pv + sqrt(max(disc, 0.0));

  var fx = px + step * vx;
  var fy = py + step * vy;
  if (t_hit > 0.0 && t_hit < step) {
    let hx = px + t_hit * vx;
    let hy = py + t_hit * vy;
    let nx = -hx / r_clamp;
    let ny = -hy / r_clamp;
    let dot_vn = vx * nx + vy * ny;
    let rx = vx - 2.0 * dot_vn * nx;
    let ry = vy - 2.0 * dot_vn * ny;
    fx = hx + (step - t_hit) * rx;
    fy = hy + (step - t_hit) * ry;
  }
  return w * vec2f(fx, fy);
}

// V259 billiard_stadium
fn var_billiard_stadium(p: vec2f, w: f32, width: f32, height: f32, step: f32, angle: f32) -> vec2f {
  let R = max(height / 2.0, 1.0e-5);
  let w2 = max(width / 2.0, 1.0e-5);

  var px = p.x;
  var py = p.y;

  // Stadium containment clamp
  if (abs(px) > w2) {
    let cx = select(-w2, w2, px > 0.0);
    let dx = px - cx;
    let dist = length(vec2f(dx, py));
    if (dist > R) {
      px = cx + (dx / dist) * R;
      py = (py / dist) * R;
    }
  } else if (abs(py) > R) {
    py = select(-R, R, py > 0.0);
  }

  let vx = safe_cos(angle);
  let vy = safe_sin(angle);

  var t_hit = 1.0e10;
  var hit_wall = 0u; // 1=top, 2=bottom, 3=right_circle, 4=left_circle

  // 1. Top wall
  if (vy > 0.0) {
    let t = (R - py) / vy;
    let x = px + t * vx;
    if (t >= 0.0 && x >= -w2 && x <= w2 && t < t_hit) {
      t_hit = t;
      hit_wall = 1u;
    }
  }
  // 2. Bottom wall
  if (vy < 0.0) {
    let t = (-R - py) / vy;
    let x = px + t * vx;
    if (t >= 0.0 && x >= -w2 && x <= w2 && t < t_hit) {
      t_hit = t;
      hit_wall = 2u;
    }
  }
  // 3. Right circle
  // Epsilon on the cap gate so an interior near-horizontal walker doesn't
  // skip the cap due to f32 rounding nudging x just below w2.
  {
    let dx = px - w2;
    let dot_pv = dx * vx + py * vy;
    let len2 = dx * dx + py * py;
    let disc = dot_pv * dot_pv + R * R - len2;
    if (disc >= 0.0) {
      let t = -dot_pv + sqrt(disc);
      let x = px + t * vx;
      if (t >= 0.0 && x >= w2 - 1.0e-5 && t < t_hit) {
        t_hit = t;
        hit_wall = 3u;
      }
    }
  }
  // 4. Left circle
  {
    let dx = px + w2;
    let dot_pv = dx * vx + py * vy;
    let len2 = dx * dx + py * py;
    let disc = dot_pv * dot_pv + R * R - len2;
    if (disc >= 0.0) {
      let t = -dot_pv + sqrt(disc);
      let x = px + t * vx;
      if (t >= 0.0 && x <= -w2 + 1.0e-5 && t < t_hit) {
        t_hit = t;
        hit_wall = 4u;
      }
    }
  }

  var fx = px + step * vx;
  var fy = py + step * vy;
  if (t_hit > 0.0 && t_hit < step) {
    let hx = px + t_hit * vx;
    let hy = py + t_hit * vy;
    var nx = 0.0;
    var ny = 0.0;
    if (hit_wall == 1u) {
      ny = -1.0;
    } else if (hit_wall == 2u) {
      ny = 1.0;
    } else if (hit_wall == 3u) {
      let r_len = max(length(vec2f(hx - w2, hy)), 1.0e-5);
      nx = -(hx - w2) / r_len;
      ny = -hy / r_len;
    } else if (hit_wall == 4u) {
      let r_len = max(length(vec2f(hx + w2, hy)), 1.0e-5);
      nx = -(hx + w2) / r_len;
      ny = -hy / r_len;
    }
    let dot_vn = vx * nx + vy * ny;
    let rx = vx - 2.0 * dot_vn * nx;
    let ry = vy - 2.0 * dot_vn * ny;
    fx = hx + (step - t_hit) * rx;
    fy = hy + (step - t_hit) * ry;
  }
  return w * vec2f(fx, fy);
}

// V260 billiard_sinai
fn var_billiard_sinai(p: vec2f, w: f32, length_val: f32, radius: f32, step: f32, angle: f32) -> vec2f {
  let L2 = max(length_val / 2.0, 1.0e-5);
  let R = max(radius, 1.0e-5);

  var px = p.x;
  var py = p.y;

  // Containment clamps
  if (abs(px) > L2) { px = select(-L2, L2, px > 0.0); }
  if (abs(py) > L2) { py = select(-L2, L2, py > 0.0); }
  let r0 = length(vec2f(px, py));
  if (r0 < R) {
    if (r0 > 1.0e-6) {
      px = (px / r0) * R;
      py = (py / r0) * R;
    } else {
      // At origin: pick a deterministic-but-spread direction from coord bits
      // so walker families converging near origin don't all bounce identically.
      let seed = bitcast<u32>(p.x) ^ bitcast<u32>(p.y);
      let theta = hash01(seed) * 6.283185307179586;
      px = R * cos(theta);
      py = R * sin(theta);
    }
  }

  let vx = safe_cos(angle);
  let vy = safe_sin(angle);

  var t_hit = 1.0e10;
  var hit_wall = 0u;

  // 1. Left square wall
  if (vx < 0.0) {
    let t = (-L2 - px) / vx;
    let y = py + t * vy;
    if (t >= 0.0 && y >= -L2 && y <= L2 && t < t_hit) {
      t_hit = t;
      hit_wall = 1u;
    }
  }
  // 2. Right square wall
  if (vx > 0.0) {
    let t = (L2 - px) / vx;
    let y = py + t * vy;
    if (t >= 0.0 && y >= -L2 && y <= L2 && t < t_hit) {
      t_hit = t;
      hit_wall = 2u;
    }
  }
  // 3. Bottom square wall
  if (vy < 0.0) {
    let t = (-L2 - py) / vy;
    let x = px + t * vx;
    if (t >= 0.0 && x >= -L2 && x <= L2 && t < t_hit) {
      t_hit = t;
      hit_wall = 3u;
    }
  }
  // 4. Top square wall
  if (vy > 0.0) {
    let t = (L2 - py) / vy;
    let x = px + t * vx;
    if (t >= 0.0 && x >= -L2 && x <= L2 && t < t_hit) {
      t_hit = t;
      hit_wall = 4u;
    }
  }
  // 5. Circle obstacle
  {
    let dot_pv = px * vx + py * vy;
    let len2 = px * px + py * py;
    let disc = dot_pv * dot_pv - (len2 - R * R);
    if (disc >= 0.0) {
      let t = -dot_pv - sqrt(disc);
      if (t >= 0.0 && t < t_hit) {
        t_hit = t;
        hit_wall = 5u;
      }
    }
  }

  var fx = px + step * vx;
  var fy = py + step * vy;
  if (t_hit > 0.0 && t_hit < step) {
    let hx = px + t_hit * vx;
    let hy = py + t_hit * vy;
    var nx = 0.0;
    var ny = 0.0;
    if (hit_wall == 1u) { nx = 1.0; }
    else if (hit_wall == 2u) { nx = -1.0; }
    else if (hit_wall == 3u) { ny = 1.0; }
    else if (hit_wall == 4u) { ny = -1.0; }
    else if (hit_wall == 5u) {
      nx = hx / R;
      ny = hy / R;
    }
    let dot_vn = vx * nx + vy * ny;
    let rx = vx - 2.0 * dot_vn * nx;
    let ry = vy - 2.0 * dot_vn * ny;
    fx = hx + (step - t_hit) * rx;
    fy = hy + (step - t_hit) * ry;
  }
  return w * vec2f(fx, fy);
}

// V261 billiard_polygon
fn var_billiard_polygon(p: vec2f, w: f32, sides_val: f32, radius: f32, step: f32, angle: f32) -> vec2f {
  let sides = u32(clamp(sides_val + 0.5, 3.0, 12.0));
  let R = max(radius, 1.0e-5);

  // Containment clamp into the inscribed circle (always inside the polygon).
  let inradius = R * cos(3.141592653589793 / f32(sides));
  var px = p.x;
  var py = p.y;
  let r0_in = length(vec2f(px, py));
  if (r0_in > inradius) {
    let s = inradius / max(r0_in, 1.0e-6);
    px = px * s;
    py = py * s;
  }

  let vx = safe_cos(angle);
  let vy = safe_sin(angle);

  var t_hit = 1.0e10;
  var hit_seg = -1i;

  var ax = R * safe_cos(0.0);
  var ay = R * safe_sin(0.0);

  for (var k = 0u; k < sides; k = k + 1u) {
    let next_phi = (2.0 * 3.141592653589793 * f32(k + 1u)) / f32(sides);
    let bx = R * safe_cos(next_phi);
    let by = R * safe_sin(next_phi);

    let dx = bx - ax;
    let dy = by - ay;
    let det = -vx * dy + vy * dx;
    if (abs(det) > 1.0e-6) {
      let t = (-(ax - px) * dy + (ay - py) * dx) / det;
      let u = (vx * (ay - py) - vy * (ax - px)) / det;
      if (t >= 0.0 && u >= 0.0 && u <= 1.0 && t < t_hit) {
        t_hit = t;
        hit_seg = i32(k);
      }
    }
    ax = bx;
    ay = by;
  }

  var fx = px + step * vx;
  var fy = py + step * vy;
  if (t_hit > 0.0 && t_hit < step && hit_seg != -1i) {
    let hx = px + t_hit * vx;
    let hy = py + t_hit * vy;

    // Perpendicular-to-edge normal, sign-corrected toward the interior. Robust
    // to non-origin-centered polygons (the midpoint-to-origin shortcut wasn't).
    let phi_seg = (2.0 * 3.141592653589793 * f32(hit_seg)) / f32(sides);
    let phi_seg_next = (2.0 * 3.141592653589793 * f32(hit_seg + 1)) / f32(sides);
    let ax = R * safe_cos(phi_seg);
    let ay = R * safe_sin(phi_seg);
    let bx = R * safe_cos(phi_seg_next);
    let by = R * safe_sin(phi_seg_next);
    let ex = bx - ax;
    let ey = by - ay;
    let eLen = max(length(vec2f(ex, ey)), 1.0e-5);
    var nx = -ey / eLen;
    var ny =  ex / eLen;
    let mx = 0.5 * (ax + bx);
    let my = 0.5 * (ay + by);
    if (nx * mx + ny * my > 0.0) {
      nx = -nx;
      ny = -ny;
    }

    let dot_vn = vx * nx + vy * ny;
    let rx = vx - 2.0 * dot_vn * nx;
    let ry = vy - 2.0 * dot_vn * ny;
    fx = hx + (step - t_hit) * rx;
    fy = hy + (step - t_hit) * ry;
  }
  return w * vec2f(fx, fy);
}




// =====================================================================
// #138 — Relativistic & physical-field warps (V262, V264, V265)
//
// Three novel physics-motivated variations: a Lorentz boost in (x,y)
// (hyperbolic rotation, the Minkowski analog of swirl), a classical
// electric-dipole field warp, and an N-magnet pendulum whose nearest-
// magnet basin index drives a DC color override (second DC-flag synergy
// after #133 newton). All angle-bounded trig uses safe_*; inverse-cube
// singularities are regularised with an additive eps in dot(r,r) so a
// walker that lands near a charge / magnet core gets a bounded (large
// but finite) deflection rather than a NaN — the chaos kernel's bad-
// value retry catches extreme escapes downstream.
// =====================================================================

// V262 — lorentz_boost
// Hyperbolic rotation by rapidity φ along an axis at `angle`:
// rotate p into the boost frame, apply (cosh φ, sinh φ) in (x',ct'),
// rotate back. Reduces to identity at rapidity=0, swirl-like shear as φ
// grows. cosh/sinh are not on the Dawn f32 cliff (not periodic), but
// will overflow f32 for |φ| ≳ 88; the catalog default clamps below that.
fn var_lorentz_boost(p: vec2f, w: f32, rapidity: f32, angle: f32) -> vec2f {
  let cos_t = safe_cos(angle);
  let sin_t = safe_sin(angle);
  // Rotate into boost frame.
  let rx =  p.x * cos_t + p.y * sin_t;
  let ry = -p.x * sin_t + p.y * cos_t;
  let ch = cosh(rapidity);
  let sh = sinh(rapidity);
  // Minkowski hyperbolic rotation.
  let xp = rx * ch + ry * sh;
  let yp = rx * sh + ry * ch;
  // Rotate back to world frame.
  let x_out = xp * cos_t - yp * sin_t;
  let y_out = xp * sin_t + yp * cos_t;
  return w * vec2f(x_out, y_out);
}

// V263 — schwarzschild_lensing
// Gravitational deflection by a point mass at the origin. A ray with
// impact parameter b is bent by the Schwarzschild deflection angle
// α ≈ 4GM/(c²·b); `mass` lumps the 4G/c² constant. The position vector is
// ROTATED by α(b) about the lens — an angular deflection (strong near the
// lens, vanishing far away — the opposite radial dependence to swirl's r²),
// NOT a radial squeeze. b = |p| + eps softens the 1/0 at the core. α grows
// without bound as |p|→0, so the rotation trig MUST route through
// safe_sin/safe_cos (textbook Dawn f32 trig-cliff case).
fn var_schwarzschild_lensing(p: vec2f, w: f32, mass: f32, eps: f32) -> vec2f {
  let b = length(p) + max(eps, 1e-6);
  let alpha = mass / b;
  let ca = safe_cos(alpha);
  let sa = safe_sin(alpha);
  let x_out = p.x * ca - p.y * sa;
  let y_out = p.x * sa + p.y * ca;
  return w * vec2f(x_out, y_out);
}

// V264 — field_dipole
// Classical electric dipole: two opposite ±charge poles offset by
// ±separation/2 along (cos angle, sin angle). Walker is stepped along
// the local E-field: E = q · (r_pos/|r_pos|³ − r_neg/|r_neg|³).
// Eps=1e-4 regularises the 1/r³ singularity at the poles (force bounded
// to ~1e6 per unit charge); larger walker displacements get caught by
// the chaos kernel's bad-value retry.
fn var_field_dipole(p: vec2f, w: f32, charge: f32, separation: f32, step: f32, angle: f32) -> vec2f {
  let d = separation * 0.5;
  let dir = vec2f(safe_cos(angle), safe_sin(angle));
  let c_pos =  d * dir;
  let c_neg = -d * dir;
  let r_pos = p - c_pos;
  let r_neg = p - c_neg;
  let d_pos3 = pow(dot(r_pos, r_pos) + 1e-4, 1.5);
  let d_neg3 = pow(dot(r_neg, r_neg) + 1e-4, 1.5);
  let E = charge * (r_pos / d_pos3 - r_neg / d_neg3);
  return w * (p + step * E);
}

// V265 — magnetic_pendulum (position warp)
// N magnets arranged on a ring of `radius`. Walker is pulled by sum of
// inverse-square attractions and decayed by `damping·p` (linear restoring
// force toward origin — the pendulum-arm gravity component). Walkers
// settle into one of N basins; var_magnetic_pendulum_color emits the
// nearest-magnet index as a DC color override.
fn var_magnetic_pendulum_pos(p: vec2f, w: f32, magnets: f32, radius: f32, strength: f32, damping: f32) -> vec2f {
  let N = u32(clamp(magnets, 3.0, 6.0));
  let inv_N = 1.0 / f32(N);
  var F = vec2f(0.0);
  for (var i = 0u; i < N; i = i + 1u) {
    let theta = 6.283185307179586 * f32(i) * inv_N;
    let M = radius * vec2f(safe_cos(theta), safe_sin(theta));
    let r = M - p;
    let dist2 = dot(r, r) + 1e-4;
    F = F + (r / pow(dist2, 1.5));
  }
  return w * (p + strength * F - damping * p);
}

// V265 — magnetic_pendulum DC color mapping helper
// Returns a saturated hue indexed by which of the N magnets is closest
// to p — the per-walker basin assignment. Hue spans the full wheel so
// each basin gets a visually distinct colour even at N=3. Lightness
// 0.55 matches the dc_perlin / dc_cylinder / var_newton_color look.
fn var_magnetic_pendulum_color(p: vec2f, magnets: f32, radius: f32) -> vec3f {
  let N = u32(clamp(magnets, 3.0, 6.0));
  let inv_N = 1.0 / f32(N);
  var min_dist2 = 1e30;
  var closest_idx = 0u;
  for (var i = 0u; i < N; i = i + 1u) {
    let theta = 6.283185307179586 * f32(i) * inv_N;
    let M = radius * vec2f(safe_cos(theta), safe_sin(theta));
    let r = M - p;
    let dist2 = dot(r, r);
    if (dist2 < min_dist2) {
      min_dist2 = dist2;
      closest_idx = i;
    }
  }
  // Spread hue evenly across the wheel; full saturation + bright value
  // so the basin map reads cleanly against the palette-darkened
  // surroundings.
  let hue = f32(closest_idx) * inv_N;
  return hsl_to_rgb(vec3f(hue, 1.0, 0.55));
}

// V266 — jacobi_theta. θ₃(τ) directly: the q-series substrate made visible.
// Gentlest of the modular family — quasi-periodic horizontal banding. θ₃ is
// bounded (≈1 + 2q + …), so no output compression.
fn var_jacobi_theta(p: vec2f, w: f32, im_floor: f32) -> vec2f {
  let tau = to_upper_half_plane(p, im_floor);
  return w * theta3(modular_nome(tau));
}

// V267 — modular_lambda. λ(τ) = (θ₂/θ₃)⁴. Doubly-periodic, Γ(2)-self-similar.
// λ maps H onto ℂ∖{0,1}; off the axis it stays moderate → raw output.
fn var_modular_lambda(p: vec2f, w: f32, im_floor: f32) -> vec2f {
  let tau = to_upper_half_plane(p, im_floor);
  let q = modular_nome(tau);
  let r = complex_div(theta2(q), theta3(q));
  let r2 = complex_sqr(r);
  return w * complex_sqr(r2);           // (θ₂/θ₃)⁴
}

// V268 — klein_j. j = 256·(1−λ+λ²)³ / (λ²·(1−λ)²). Unbounded (j→∞ as λ→0,1)
// → log(1+|j|) radial compression (spec D3) keeps direction, tames the spike.
// j(i) = 1728 (the classic special value) — pinned by the GPU test.
fn var_klein_j(p: vec2f, w: f32, im_floor: f32) -> vec2f {
  let tau = to_upper_half_plane(p, im_floor);
  let q = modular_nome(tau);
  let r = complex_div(theta2(q), theta3(q));
  let r2 = complex_sqr(r);
  let lam = complex_sqr(r2);                          // λ
  let one = vec2f(1.0, 0.0);
  let a = one - lam + complex_sqr(lam);               // 1 − λ + λ²
  let numer = 256.0 * complex_pow_int(a, 3);          // 256·(1−λ+λ²)³
  let oml = one - lam;                                // 1 − λ
  let denom = complex_mul(complex_sqr(lam), complex_sqr(oml)); // λ²(1−λ)²
  // Near λ→0,1 the denom underflows and complex_div overflows f32 to ±Inf
  // (log(1+Inf)/Inf = NaN). Clamp to a finite range before compressing — the
  // direction is preserved, the spike is bounded. clamp(±Inf) → ±1e18.
  let j = clamp(complex_div(numer, denom), vec2f(-1e18), vec2f(1e18));
  let mag = length(j);
  let scale = log(1.0 + mag) / max(mag, 1e-12);       // log(1+|j|)·(j/|j|)
  return w * scale * j;
}

// V269 — weierstrass_p. ℘(z) = 1/z² + Σ'_{m,n} [1/(z−ω)² − 1/ω²], ω = m·ω₁ + n·ω₂,
// 5×5 lattice (m,n ∈ −2..2, origin excluded). The −1/ω² counterterm is what makes
// the sum converge. Double poles at every lattice point → log(1+|℘|) compression
// (spec D3); clamp guards the 1/z² overflow at the poles. ℘ is even: ℘(−z) = ℘(z)
// (symmetric lattice) — pinned by the test. PERF: heaviest of the family
// (24 lattice terms). 3×3 (−1..1) is the fallback if it drags renders — see #131.
fn var_weierstrass_p(p: vec2f, w: f32, o1re: f32, o1im: f32, o2re: f32, o2im: f32) -> vec2f {
  let z = p;
  let w1 = vec2f(o1re, o1im);
  let w2 = vec2f(o2re, o2im);
  var acc = complex_recip(complex_sqr(z));   // 1/z² central pole
  for (var m = -2; m <= 2; m = m + 1) {
    for (var n = -2; n <= 2; n = n + 1) {
      if (m == 0 && n == 0) { continue; }
      let omega = f32(m) * w1 + f32(n) * w2;
      acc = acc + complex_recip(complex_sqr(z - omega)) - complex_recip(complex_sqr(omega));
    }
  }
  let accc = clamp(acc, vec2f(-1e18), vec2f(1e18));    // bound the pole spike
  let mag = length(accc);
  let scale = log(1.0 + mag) / max(mag, 1e-12);
  return w * scale * accc;
}

// V270 — gauss_map. Per-axis continued-fraction map x → frac(1/x). 1/t is
// sign-guarded at |t| ≥ 1e-4. Stern-Brocot / arithmetic self-similarity; output
// per axis lands in [0,1). Param-free (spec D4).
fn gauss_frac(t: f32) -> f32 {
  let at = max(abs(t), 1.0e-4);
  let st = select(1.0, -1.0, t < 0.0);
  let r = st / at;                       // = 1/t, guarded
  return r - floor(r);
}
fn var_gauss_map(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(gauss_frac(p.x), gauss_frac(p.y));
}

// =====================================================================
// More Variations Marathon (#16) — shared helpers (V271–V303).
// Declaration-before-use ordering is load-bearing: bits_mask before
// fp_encode; assoc_legendre before sph_harmonic; assoc_laguerre before
// radial_psi2. All helpers are pure + bounded (see the design spec).
// =====================================================================

// --- #132 value noise (hash01-based lattice value noise in [-1,1]) ---
fn vnoise_corner(ix: i32, iy: i32) -> f32 {
  let ux = bitcast<u32>(ix) * 0x9e3779b1u;
  let uy = bitcast<u32>(iy) * 0x85ebca77u;
  return hash01(ux ^ uy) * 2.0 - 1.0;        // [-1,1)
}
fn value_noise2(px: f32, py: f32) -> f32 {
  let fx = floor(px);
  let fy = floor(py);
  let ix = i32(fx);
  let iy = i32(fy);
  let tx = px - fx;
  let ty = py - fy;
  let ux = tx * tx * (3.0 - 2.0 * tx);
  let uy = ty * ty * (3.0 - 2.0 * ty);
  let c00 = vnoise_corner(ix,     iy);
  let c10 = vnoise_corner(ix + 1, iy);
  let c01 = vnoise_corner(ix,     iy + 1);
  let c11 = vnoise_corner(ix + 1, iy + 1);
  let bottom = mix(c00, c10, ux);
  let top    = mix(c01, c11, ux);
  return mix(bottom, top, uy);                // [-1,1]
}

// --- #137 Bessel J0 (A&S 9.4.1 / 9.4.3), |J0|<=1 ---
fn bessel_j0_eval(x: f32) -> f32 {
  let ax = abs(x);
  if (ax < 3.0) {
    let y = (x * x) / 9.0;
    return 1.0 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866
      + y * (0.0444479 + y * (-0.0039444 + y * 0.0002100)))));
  }
  let z = 3.0 / ax;
  let y = z * z;
  let amp = 0.79788456 + y * (-0.00000077 + y * (-0.00552740 + y * (-0.00009512
    + y * (0.00137237 + y * (-0.00072805 + y * 0.00014476)))));
  let phase = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954
    + y * (0.00262573 + y * (-0.00054125 + y * (-0.00029333 + y * 0.00013558)))));
  return (amp / sqrt(ax)) * safe_cos(phase);
}

// --- #137 Airy Ai(x), |Ai|<~0.54 ---
fn airy_ai_eval(x: f32) -> f32 {
  if (x > 4.0) {
    let xi = (2.0 / 3.0) * pow(x, 1.5);
    return exp(-xi) / (2.0 * 1.7724539 * pow(x, 0.25));   // 2·sqrt(pi)
  }
  if (x < -5.0) {
    let ax = -x;
    let xi = (2.0 / 3.0) * pow(ax, 1.5);
    return safe_sin(xi + 0.78539816) / (1.7724539 * pow(ax, 0.25));
  }
  let c1 = 0.355028053887817;
  let c2 = 0.258819403792807;
  let x3 = x * x * x;
  var f = 1.0; var tf = 1.0;
  var g = x;   var tg = x;
  for (var k = 1; k < 12; k = k + 1) {
    let kf = f32(k);
    tf = tf * (x3 / ((3.0 * kf - 1.0) * (3.0 * kf)));
    f = f + tf;
    tg = tg * (x3 / ((3.0 * kf) * (3.0 * kf + 1.0)));
    g = g + tg;
  }
  return c1 * f - c2 * g;
}

// --- #137 Struve H1(x), power series, arg clamped to convergence radius ---
fn struve_h1_eval(x_in: f32) -> f32 {
  let x = clamp(x_in, -10.0, 10.0);
  let h = 0.5 * x;
  let h2 = h * h;
  var term = h2 / (0.8862269 * 1.3293404);
  var sum = term;
  for (var m = 1; m < 16; m = m + 1) {
    let mf = f32(m);
    term = term * (-(h2)) / ((mf + 0.5) * (mf + 1.5));
    sum = sum + term;
  }
  return sum;
}

// --- #141 fixed-point digit-scramble codec ---
fn bits_mask(bits: u32) -> u32 {
  return (1u << bits) - 1u;
}
fn fp_encode(c: f32, extent: f32, bits: u32) -> u32 {
  let s = max(extent, 1.0e-4);
  let levels = f32(1u << bits);
  let norm = (c + s) / (2.0 * s);
  let folded = norm - floor(norm);
  let idx = min(u32(folded * levels), bits_mask(bits));
  return idx;
}
fn fp_decode(i: u32, extent: f32, bits: u32) -> f32 {
  let s = max(extent, 1.0e-4);
  let levels = f32(1u << bits);
  let unit = (f32(i) + 0.5) / levels;
  return unit * 2.0 * s - s;
}

// --- #144 orthogonal polynomials (|x|<=1 caller-guaranteed) ---
fn cheb_T(x: f32, n: i32) -> f32 {
  if (n <= 0) { return 1.0; }
  if (n == 1) { return x; }
  var tkm2 = 1.0;
  var tkm1 = x;
  var tk = x;
  for (var k: i32 = 2; k <= n; k = k + 1) {
    tk = 2.0 * x * tkm1 - tkm2;
    tkm2 = tkm1;
    tkm1 = tk;
  }
  return tk;
}
fn legendre_P(x: f32, n: i32) -> f32 {
  if (n <= 0) { return 1.0; }
  if (n == 1) { return x; }
  var pkm2 = 1.0;
  var pkm1 = x;
  var pk = x;
  for (var k: i32 = 1; k < n; k = k + 1) {
    let fk = f32(k);
    pk = ((2.0 * fk + 1.0) * x * pkm1 - fk * pkm2) / (fk + 1.0);
    pkm2 = pkm1;
    pkm1 = pk;
  }
  return pk;
}

// --- #144 spherical-harmonic lobe magnitude (owned here; #148 reuses) ---
fn assoc_legendre(l: i32, m: i32, u: f32) -> f32 {
  var pmm = 1.0;
  if (m > 0) {
    let somx2 = sqrt(max(1.0 - u * u, 0.0));
    var fact = 1.0;
    for (var i: i32 = 1; i <= m; i = i + 1) {
      pmm = pmm * (-fact) * somx2;
      fact = fact + 2.0;
    }
  }
  if (l == m) { return pmm; }
  var pmmp1 = u * (2.0 * f32(m) + 1.0) * pmm;
  if (l == m + 1) { return pmmp1; }
  var pll = 0.0;
  for (var ll: i32 = m + 2; ll <= l; ll = ll + 1) {
    let fll = f32(ll);
    pll = ((2.0 * fll - 1.0) * u * pmmp1 - (fll + f32(m) - 1.0) * pmm) / (fll - f32(m));
    pmm = pmmp1;
    pmmp1 = pll;
  }
  return pll;
}
fn sph_harmonic(theta: f32, l: i32, m: i32) -> f32 {
  let u = safe_cos(theta);
  let plm = assoc_legendre(l, m, u);
  let azim = safe_cos(f32(m) * theta);
  let y = plm * azim;
  return clamp(abs(y), 0.0, 4.0);
}

// --- #147 Chladni plate field F and its analytic gradient ---
fn chladni_field_and_grad(x: f32, y: f32, n: f32, m: f32) -> vec3f {
  let an = PI * n;
  let am = PI * m;
  let cnx = safe_cos(an * x);
  let snx = safe_sin(an * x);
  let cmy = safe_cos(am * y);
  let smy = safe_sin(am * y);
  let cmx = safe_cos(am * x);
  let smx = safe_sin(am * x);
  let cny = safe_cos(an * y);
  let sny = safe_sin(an * y);
  let F  = cnx * cmy - cmx * cny;
  let Fx = -an * snx * cmy + am * smx * cny;
  let Fy = -am * cnx * smy + an * cmx * sny;
  return vec3f(F, Fx, Fy);
}

// --- #148 hydrogen radial wavefunction (assoc_laguerre → radial_psi2) ---
fn assoc_laguerre(k: i32, alpha: f32, x: f32) -> f32 {
  if (k <= 0) { return 1.0; }
  var lkm1 = 1.0;
  var lk = 1.0 + alpha - x;
  if (k == 1) { return lk; }
  for (var j = 1; j < k; j = j + 1) {
    let fj = f32(j);
    let lkp1 = ((2.0 * fj + 1.0 + alpha - x) * lk - (fj + alpha) * lkm1) / (fj + 1.0);
    lkm1 = lk;
    lk = lkp1;
  }
  return lk;
}
fn radial_psi2(n: i32, l: i32, rho: f32) -> f32 {
  let rho_f = max(rho, 0.0);
  let k = n - l - 1;
  let alpha = 2.0 * f32(l) + 1.0;
  let lag = assoc_laguerre(k, alpha, rho_f);
  var rpow = 1.0;
  if (l > 0) {
    let twoL = 2 * l;
    for (var j = 0; j < twoL; j = j + 1) { rpow = rpow * rho_f; }
  }
  return rpow * exp(-rho_f) * (lag * lag);
}

// =====================================================================
// Marathon follow-ons (#216/#218/#220/#221) — shared helpers (V304–V309).
// Declared here (after the marathon helper block, before the kernels) so the
// declaration-before-use ordering holds. All pure + bounded.
// =====================================================================

// --- #220 complete elliptic integrals via A&S 17.3.34 / 17.3.36 ---
// Polynomial approximations in m1 = 1 − m, valid for m ∈ [0,1] (|err| < 4e-5).
// E(m) ∈ [1, π/2] is inherently bounded; K(m) diverges logarithmically as
// m → 1 (m1 → 0), so elliptic_K_eval floors m1 at 1e-3.
fn elliptic_E_eval(m: f32) -> f32 {
  let m1 = clamp(1.0 - m, 0.0, 1.0);
  let l = log(1.0 / max(m1, 1.0e-6));
  let a = 1.0 + m1 * (0.4630151 + m1 * 0.1077812);
  let b = m1 * (0.2452727 + m1 * 0.0412496);
  return a + b * l;
}
fn elliptic_K_eval(m: f32) -> f32 {
  let m1 = clamp(1.0 - m, 1.0e-3, 1.0);   // m→1 logarithmic singularity floor
  let l = log(1.0 / m1);
  let a = 1.3862944 + m1 * (0.1119723 + m1 * 0.0725296);
  let b = 0.5 + m1 * (0.1213478 + m1 * 0.0288729);
  return a + b * l;
}

// --- #218 inverse error function (Winitzki approximation, |err| ~ 1e-3) ---
// erfinv(x) for x ∈ (−1,1); blows up at |x| → 1 so the argument is clamped.
fn erfinv_eval(x_in: f32) -> f32 {
  let x = clamp(x_in, -0.999999, 0.999999);
  let a = 0.147;
  let ln1 = log(1.0 - x * x);
  let t1 = 2.0 / (PI * a) + 0.5 * ln1;
  let inner = sqrt(max(t1 * t1 - ln1 / a, 0.0)) - t1;
  return sign(x) * sqrt(max(inner, 0.0));
}

// --- #221 base-3 fixed-point codec + Peano reflected-ternary scramble ---
// 3^trits must stay f32-exact for the encode multiply, so trits ≤ 15
// (3^15 = 14 348 907 < 2^24). Pure integer ops, bounded by tri_decode.
fn pow3(n: u32) -> u32 {
  var p = 1u;
  var i = 0u;
  loop { if (i >= n) { break; } p = p * 3u; i = i + 1u; }
  return p;
}
fn tri_encode(c: f32, extent: f32, trits: u32) -> u32 {
  let s = max(extent, 1.0e-4);
  let cells = pow3(trits);
  let levels = f32(cells);
  let norm = (c + s) / (2.0 * s);
  let folded = norm - floor(norm);
  return min(u32(folded * levels), cells - 1u);
}
fn tri_decode(i: u32, extent: f32, trits: u32) -> f32 {
  let s = max(extent, 1.0e-4);
  let levels = f32(pow3(trits));
  return ((f32(i) + 0.5) / levels) * 2.0 * s - s;
}
// Peano reflected-ternary permutation of a base-3 index: walk digits MSB→LSB
// carrying a running flip state that maps digit d → 2−d, toggling whenever the
// emitted digit is odd (the orientation-flip recursion at the heart of the
// Peano curve). The flip state lives only inside this loop — stateless across
// walkers.
fn peano_scramble(idx: u32, trits: u32) -> u32 {
  var flip = false;
  var out = 0u;
  var k = trits;
  loop {
    if (k == 0u) { break; }
    k = k - 1u;
    let place = pow3(k);
    let d = (idx / place) % 3u;
    let e = select(d, 2u - d, flip);
    out = out + e * place;
    if ((e & 1u) == 1u) { flip = !flip; }
  }
  return out;
}

// =====================================================================
// More Variations Marathon (#16) — variation kernels (V271–V303).
// =====================================================================

// --- #137 special-function radial profiles ---
// V273 — bessel_j0. r' = J0(freq·r); |J0|<=1 → output stays inside the
// input disk. Concentric interference rings at the zeros of J0.
fn var_bessel_j0(p: vec2f, w: f32, freq: f32) -> vec2f {
  let r = length(p);
  let j = bessel_j0_eval(freq * r);
  return w * (j * p);
}
// V274 — airy_radial. Radial scale by Ai(scale·(r − shift)); gain 3 lifts
// the small |Ai| (<0.54) into a visible scale. Asymmetric caustic fold.
fn var_airy_radial(p: vec2f, w: f32, scale: f32, shift: f32) -> vec2f {
  let r = length(p);
  let a = airy_ai_eval(scale * (r - shift));
  return w * ((3.0 * a) * p);
}
// V275 — cornu_spiral. Euler clothoid via Heald (1985) rational Fresnel
// approximation; chirp arg a=π·t²/2 routed through safe_sin/safe_cos.
fn var_cornu_spiral(p: vec2f, w: f32, freq: f32) -> vec2f {
  let t = freq * p.x;
  let s = abs(t);
  let sgn = select(1.0, -1.0, t < 0.0);
  let f = (1.0 + 0.926 * s) / (2.0 + 1.792 * s + 3.104 * (s * s));
  let g = 1.0 / (2.0 + 4.142 * s + 3.492 * (s * s) + 6.670 * (s * s * s));
  let a = (PI * (s * s)) / 2.0;
  let sa = safe_sin(a);
  let ca = safe_cos(a);
  let c_int = 0.5 + f * sa - g * ca;
  let s_int = 0.5 - f * ca - g * sa;
  let cx = sgn * c_int;
  let sy = sgn * s_int;
  return w * vec2f(cx, sy + 0.25 * p.y);
}
// V276 — struve_h1. r' = 0.6·H1(freq·r); series arg hard-clamped to |.|<=10.
fn var_struve_h1(p: vec2f, w: f32, freq: f32) -> vec2f {
  let r = length(p);
  let h = struve_h1_eval(freq * r);
  return w * ((0.6 * h) * p);
}

// --- #132 exotic warps ---
// V271 — nbody_lensing. Two softened gravitational attractors deflect the
// walker; ε floor (5e-3) removes the 1/0 singularity → bounded. No trig.
fn nbody_pull(p: vec2f, c: vec2f, m: f32, g: f32, eps: f32) -> vec2f {
  let d = c - p;
  let r2 = dot(d, d) + eps;
  let inv = g * m / (r2 * sqrt(r2));
  return inv * d;
}
fn var_nbody_lensing(p: vec2f, w: f32, c1x: f32, c1y: f32, c2x: f32, c2y: f32, m1: f32, m2: f32, g: f32, eps: f32) -> vec2f {
  let e = max(eps, 5.0e-3);
  var disp = nbody_pull(p, vec2f(c1x, c1y), m1, g, e);
  disp = disp + nbody_pull(p, vec2f(c2x, c2y), m2, g, e);
  return w * (p + disp);
}
// V272 — curl_noise. Divergence-free swirl: displacement = amp·(∂ψ/∂y, −∂ψ/∂x)
// where ψ is hash01-lattice value-noise (value_noise2 helper, ∈[-1,1]); the
// central-difference gradient is clamped to ±8 before scaling.
fn var_curl_noise(p: vec2f, w: f32, freq: f32, amp: f32) -> vec2f {
  let f = max(freq, 1.0e-3);
  let sx = p.x * f;
  let sy = p.y * f;
  let h = 1.0e-2;
  let dpsi_dx = (value_noise2(sx + h, sy) - value_noise2(sx - h, sy)) / (2.0 * h);
  let dpsi_dy = (value_noise2(sx, sy + h) - value_noise2(sx, sy - h)) / (2.0 * h);
  let disp = vec2f(dpsi_dy, -dpsi_dx);
  let dispc = clamp(disp, vec2f(-8.0), vec2f(8.0));
  return w * (p + amp * dispc);
}

// --- #144 orthogonal-polynomial & harmonic warps ---
// V280 — chebyshev. Per-axis T_n via cheb_T; input clamped to [-1,1] so
// |T_n|<=1 → bounded. order params rounded + clamped to [0,12].
fn var_chebyshev(p: vec2f, w: f32, order_x: f32, order_y: f32) -> vec2f {
  let nx = i32(clamp(round(order_x), 0.0, 12.0));
  let ny = i32(clamp(round(order_y), 0.0, 12.0));
  let cx = clamp(p.x, -1.0, 1.0);
  let cy = clamp(p.y, -1.0, 1.0);
  return w * vec2f(cheb_T(cx, nx), cheb_T(cy, ny));
}
// V281 — legendre. Per-axis P_n via legendre_P (Bonnet); same [-1,1] clamp.
fn var_legendre(p: vec2f, w: f32, order_x: f32, order_y: f32) -> vec2f {
  let nx = i32(clamp(round(order_x), 0.0, 12.0));
  let ny = i32(clamp(round(order_y), 0.0, 12.0));
  let cx = clamp(p.x, -1.0, 1.0);
  let cy = clamp(p.y, -1.0, 1.0);
  return w * vec2f(legendre_P(cx, nx), legendre_P(cy, ny));
}
// V282 — spherical_harmonic. r' = r·(1 − amt + amt·|Y_l^m(θ)|), a lobed
// rosette radial modulator (shared sph_harmonic helper). 0<=m<=l enforced;
// radial factor clamped to [-3,3]; origin short-circuits to (0,0).
fn var_spherical_harmonic(p: vec2f, w: f32, degree_l: f32, order_m: f32, amount: f32) -> vec2f {
  let r = length(p);
  if (r < 1.0e-6) { return vec2f(0.0, 0.0); }
  let theta = atan2(p.y, p.x);
  let l = i32(clamp(round(degree_l), 0.0, 6.0));
  let m = i32(clamp(round(order_m), 0.0, f32(l)));
  let ylm = sph_harmonic(theta, l, m);
  let amt = clamp(amount, 0.0, 2.0);
  let scale = (1.0 - amt) + amt * ylm;
  let rp = r * clamp(scale, -3.0, 3.0);
  let inv_r = 1.0 / r;
  return w * vec2f(p.x * inv_r * rp, p.y * inv_r * rp);
}
// V283 — fourier_warp. r' = r·(1 + amp·Σ_{k=1}^N cos(kθ+φ_k)/k). N capped 8;
// φ_k from hash01(seed,k); 1/k weighting + amp<0.9 + positive floor (0.05)
// keep the radial envelope strictly positive (no fold-through).
fn var_fourier_warp(p: vec2f, w: f32, harmonics: f32, amp: f32, phase_seed: f32) -> vec2f {
  let r = length(p);
  if (r < 1.0e-6) { return vec2f(0.0, 0.0); }
  let theta = atan2(p.y, p.x);
  let nN = i32(clamp(round(harmonics), 1.0, 8.0));
  let amt = clamp(amp, 0.0, 0.9);
  let sbase = u32(clamp(phase_seed, 0.0, 1024.0));
  var acc = 0.0;
  for (var k: i32 = 1; k <= nN; k = k + 1) {
    let fk = f32(k);
    let phi = hash01(sbase * 2654435761u + u32(k) * 40503u) * TAU;
    acc = acc + safe_cos(fk * theta + phi) / fk;
  }
  let env = 1.0 + amt * acc;
  let rp = r * clamp(env, 0.05, 3.0);
  let inv_r = 1.0 / r;
  return w * vec2f(p.x * inv_r * rp, p.y * inv_r * rp);
}

// --- #141 quasi-random & digit-scramble warps (fp_encode/fp_decode codec) ---
// V277 — radical_inverse. Per axis: encode to a `bits`-wide index, reverse
// its low `bits` bits, decode back. Pure u32 ops; bounded by fp_decode.
fn reverse_bits_n(x: u32, bits: u32) -> u32 {
  var v = x;
  var r = 0u;
  var k = 0u;
  loop {
    if (k >= bits) { break; }
    r = (r << 1u) | (v & 1u);
    v = v >> 1u;
    k = k + 1u;
  }
  return r;
}
fn var_radical_inverse(p: vec2f, w: f32, extent: f32, bits_f: f32) -> vec2f {
  let bits = u32(clamp(bits_f, 2.0, 24.0));
  let ix = fp_encode(p.x, extent, bits);
  let iy = fp_encode(p.y, extent, bits);
  let rx = reverse_bits_n(ix, bits) & bits_mask(bits);
  let ry = reverse_bits_n(iy, bits) & bits_mask(bits);
  return w * vec2f(fp_decode(rx, extent, bits), fp_decode(ry, extent, bits));
}
// V278 — gray_code. Binary-reflected Gray permutation g = x ^ (x>>1) per axis.
fn gray_encode(x: u32) -> u32 {
  return x ^ (x >> 1u);
}
fn var_gray_code(p: vec2f, w: f32, extent: f32, bits_f: f32) -> vec2f {
  let bits = u32(clamp(bits_f, 2.0, 24.0));
  let m = bits_mask(bits);
  let ix = fp_encode(p.x, extent, bits);
  let iy = fp_encode(p.y, extent, bits);
  let gx = gray_encode(ix) & m;
  let gy = gray_encode(iy) & m;
  return w * vec2f(fp_decode(gx, extent, bits), fp_decode(gy, extent, bits));
}
// V279 — morton_zorder. Interleave (ix,iy) bits into a 2·bits Morton code,
// then split at the midpoint to fold the plane along the Z-order curve.
// `bits` clamped to [2,16] so 2·bits<=32 (no u32 overflow).
fn part1by1(x_in: u32, bits: u32) -> u32 {
  var r = 0u;
  var i = 0u;
  loop {
    if (i >= bits) { break; }
    r = r | (((x_in >> i) & 1u) << (i << 1u));
    i = i + 1u;
  }
  return r;
}
fn morton_code(ix: u32, iy: u32, bits: u32) -> u32 {
  return part1by1(ix, bits) | (part1by1(iy, bits) << 1u);
}
fn var_morton_zorder(p: vec2f, w: f32, extent: f32, bits_f: f32) -> vec2f {
  let bits = u32(clamp(bits_f, 2.0, 16.0));
  let m = bits_mask(bits);
  let ix = fp_encode(p.x, extent, bits);
  let iy = fp_encode(p.y, extent, bits);
  let code = morton_code(ix, iy, bits);
  let nx = code & m;
  let ny = (code >> bits) & m;
  return w * vec2f(fp_decode(nx, extent, bits), fp_decode(ny, extent, bits));
}

// --- #146 optics warps ---
// V284 — snell_refraction. Geometric refraction across the flat y=0 interface;
// total internal reflection when |nr·sin1|>=1. Pure unit-direction rotation
// rescaled to |p| → |out|=|p|, strictly bounded. No trig of a coordinate.
fn var_snell_refraction(p: vec2f, w: f32, n_ratio: f32, strength: f32) -> vec2f {
  let r = length(p);
  if (r < 1.0e-6) { return w * p; }
  let dx = p.x / r;
  let dy = p.y / r;
  let nr = clamp(n_ratio, 0.05, 5.0);
  let sin1 = dx;
  let cos1 = dy;
  let sin2 = nr * sin1;
  var ox: f32;
  var oy: f32;
  if (abs(sin2) >= 1.0) {
    ox = dx;
    oy = -dy;
  } else {
    let cos2 = sqrt(max(1.0 - sin2 * sin2, 0.0));
    ox = sin2;
    oy = select(-cos2, cos2, cos1 >= 0.0);
  }
  let s = clamp(strength, 0.0, 1.0);
  var bx = mix(dx, ox, s);
  var by = mix(dy, oy, s);
  let bl = max(length(vec2f(bx, by)), 1.0e-6);
  bx = bx / bl;
  by = by / bl;
  return w * r * vec2f(bx, by);
}
// V285 — grin_lens. Graded-index converging lens: saturating radial pull
// g(r)=r/(r²+eps²) softens the focal singularity → bounded everywhere.
fn var_grin_lens(p: vec2f, w: f32, focal: f32, eps: f32) -> vec2f {
  let f = max(abs(focal), 0.05);
  let e = max(abs(eps), 1.0e-3);
  let r = length(p);
  if (r < 1.0e-6) { return w * p; }
  let soft = (e * e) / (r * r + e * e);
  let pull = (r / f) * soft;
  let dx = p.x / r;
  let dy = p.y / r;
  let nr = max(r - pull, -r);
  return w * nr * vec2f(dx, dy);
}
// V286 — caustic_fold. Displace along ∇φ of φ=cos(kx+ph)+cos(ky+ph) so rays
// fold onto bright caustic curves. safe_sin guards the freq-scaled coordinate.
fn var_caustic_fold(p: vec2f, w: f32, freq: f32, amp: f32, phase: f32) -> vec2f {
  let k = clamp(freq, 0.0, 16.0);
  let a = clamp(amp, 0.0, 2.0);
  let ax = k * p.x + phase;
  let ay = k * p.y + phase;
  let gx = -safe_sin(ax);
  let gy = -safe_sin(ay);
  var ox = p.x + a * gx;
  var oy = p.y + a * gy;
  ox = clamp(ox, -8.0, 8.0);
  oy = clamp(oy, -8.0, 8.0);
  return w * vec2f(ox, oy);
}

// --- #147 wave & nodal-pattern warps ---
// V287 — chladni. Step down −∇|F| of the symmetric Chladni plate field so
// walkers pile on the nodal (F=0) lines. n,m floored to integer modes [1,12];
// step is a unit-gradient displacement → bounded by |p|+step.
fn var_chladni(p: vec2f, w: f32, n_in: f32, m_in: f32, step: f32) -> vec2f {
  let n = clamp(floor(n_in + 0.5), 1.0, 12.0);
  let m = clamp(floor(m_in + 0.5), 1.0, 12.0);
  let fg = chladni_field_and_grad(p.x, p.y, n, m);
  let F  = fg.x;
  var gx = fg.y;
  var gy = fg.z;
  let s = select(1.0, -1.0, F < 0.0);
  gx = s * gx;
  gy = s * gy;
  let gl = sqrt(gx * gx + gy * gy);
  let inv = 1.0 / (gl + 1.0e-4);
  let nx = p.x - step * gx * inv;
  let ny = p.y - step * gy * inv;
  return w * vec2f(nx, ny);
}
// V288 — standing_wave. p + Σ_{k=1..K} amp·decay^(k-1)·(membrane mode terms).
// Fixed 4-iter loop runtime-masked to `modes`; geometric falloff → bounded.
fn var_standing_wave(p: vec2f, w: f32, modes_in: f32, freq: f32, amp: f32, decay: f32) -> vec2f {
  let kmax = clamp(floor(modes_in + 0.5), 1.0, 4.0);
  let d = clamp(decay, 0.0, 0.999);
  var dx = 0.0;
  var dy = 0.0;
  var ak = amp;
  for (var k = 1; k <= 4; k = k + 1) {
    let kf = f32(k) * PI * freq;
    let gate = select(0.0, 1.0, f32(k) <= kmax);   // 'active' is a WGSL reserved keyword
    dx = dx + gate * ak * safe_sin(kf * p.x) * safe_sin(kf * p.y);
    dy = dy + gate * ak * safe_sin(kf * p.y) * safe_cos(kf * p.x);
    ak = ak * d;
  }
  return w * vec2f(p.x + dx, p.y + dy);
}
// V289 — moire. Two superimposed gratings (one rotated by `angle`, detuned by
// `beat`); displacement is amp·(grating product) → slow moiré fringe. Bounded
// by amp per axis. All trig via safe_*.
fn var_moire(p: vec2f, w: f32, freq: f32, beat: f32, angle: f32, amp: f32) -> vec2f {
  let ca = safe_cos(angle);
  let sa = safe_sin(angle);
  let u = p.x * ca + p.y * sa;
  let v = -p.x * sa + p.y * ca;
  let f1 = freq;
  let f2 = freq + beat;
  let gx = safe_sin(f1 * PI * p.x) * safe_sin(f2 * PI * u);
  let gy = safe_sin(f1 * PI * p.y) * safe_sin(f2 * PI * v);
  return w * vec2f(p.x + amp * gx, p.y + amp * gy);
}

// --- #148 atomic-orbital warps (radial_psi2 + #144 sph_harmonic) ---
// V290 — radial_shell. Remap radius by |R_nl(r)|²; exp(−rho) envelope + soft
// cap r'=1.5·A/(1+A) → bounded [0,1.5). Angle preserved. No trig of a coord.
fn var_radial_shell(p: vec2f, w: f32, n_in: f32, l_in: f32, shell_scale: f32) -> vec2f {
  let n = clamp(i32(round(n_in)), 1, 4);
  let l = clamp(i32(round(l_in)), 0, n - 1);
  let r = length(p);
  let sc = max(shell_scale, 1.0e-3);
  let rho = (2.0 * r) / (f32(n) * sc);
  let amp = radial_psi2(n, l, rho);
  let r_out = 1.5 * (amp / (1.0 + amp));
  var dir = vec2f(1.0, 0.0);
  if (r > 1.0e-6) { dir = p / r; }
  return w * r_out * dir;
}
// V291 — hydrogen_orbital. Full |ψ_nlm|² = |R_nl|²·|Y_l^m|² radial remap.
// The in-plane azimuth phi = atan2(y,x) feeds #144's sph_harmonic(phi,l,m)
// (which takes cos(phi) = p.x/r internally as the polar proxy). lobe_mix blends
// pure radial shells (0) ↔ angular-modulated orbital (1). m clamped to [-l,l].
fn var_hydrogen_orbital(p: vec2f, w: f32, n_in: f32, l_in: f32, m_in: f32, shell_scale: f32, lobe_mix: f32) -> vec2f {
  let n = clamp(i32(round(n_in)), 1, 4);
  let l = clamp(i32(round(l_in)), 0, n - 1);
  let m = clamp(i32(round(m_in)), -l, l);
  let r = length(p);
  let sc = max(shell_scale, 1.0e-3);
  let rho = (2.0 * r) / (f32(n) * sc);
  let rad = radial_psi2(n, l, rho);
  let phi = atan2(p.y, p.x);                  // in-plane azimuth; cos(phi)=p.x/r
  let yl = sph_harmonic(phi, l, m);           // #144-owned, bounded real Y factor
  let ang2 = yl * yl;
  let amp_full = rad * ang2;
  let amp = mix(rad, amp_full, clamp(lobe_mix, 0.0, 1.0));
  let r_out = 1.5 * (amp / (1.0 + amp));
  var dir = vec2f(1.0, 0.0);
  if (r > 1.0e-6) { dir = p / r; }
  return w * r_out * dir;
}

// --- #151 statistical-distribution warps (radial inverse-CDF) ---
// Shared pattern: u = r²/(1+r²) ∈ (0,1) bounded sigmoid → closed-form quantile
// → re-emit along the original direction. Angle preserved; origin → origin.
// V292 — weibull_cdf. r' = λ·(−ln(1−u))^(1/k). Elementary, fully bounded.
fn var_weibull_cdf(p: vec2f, w: f32, lambda: f32, k: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let u  = clamp(r2 / (1.0 + r2), 1.0e-4, 1.0 - 1.0e-4);
  let kk = max(abs(k), 0.05);
  let rp = lambda * pow(-log(1.0 - u), 1.0 / kk);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}
// V293 — logistic_cdf. r' = μ + s·logit(u), logit hard-clamped to ±12; max(.,0).
fn var_logistic_cdf(p: vec2f, w: f32, mu: f32, s: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let u  = clamp(r2 / (1.0 + r2), 1.0e-4, 1.0 - 1.0e-4);
  let logit = clamp(log(u / (1.0 - u)), -12.0, 12.0);
  var rp = mu + s * logit;
  rp = max(rp, 0.0);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}
// V294 — cauchy_cdf. r' = γ·tan(π(u−0.5)), HARD-clamped to ±tail_clamp. The
// heavy-tailed member: two-layer defense (u-map endpoint guard + r' cap).
// safe_tan guards the (small) coord-derived arg per the safe-trig rule.
fn var_cauchy_cdf(p: vec2f, w: f32, gamma: f32, tail_clamp: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let u  = clamp(r2 / (1.0 + r2), 1.0e-4, 1.0 - 1.0e-4);
  let arg = PI * (u - 0.5);
  let raw = gamma * safe_tan(arg);
  let cap = max(tail_clamp, 0.01);
  let rp  = clamp(raw, -cap, cap);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}
// V295 — pareto_cdf. r' = x_m·(1−u)^(−1/α), algebraic heavy tail, HARD-clamped.
fn var_pareto_cdf(p: vec2f, w: f32, x_m: f32, alpha: f32, tail_clamp: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let u  = clamp(r2 / (1.0 + r2), 1.0e-4, 1.0 - 1.0e-4);
  let a  = max(abs(alpha), 0.05);
  let raw = x_m * pow(1.0 - u, -1.0 / a);
  let cap = max(tail_clamp, 0.01);
  let rp  = min(raw, cap);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}

// --- #152 wavelet & signal warps (radial modulation p → p·(1+amp·ψ)) ---
// V296 — morlet. ψ = exp(−t²/2)·cos(ωr), Gaussian-windowed cosine packet.
// cos arg freq·r may hit the Dawn trig cliff → safe_cos.
fn var_morlet(p: vec2f, w: f32, freq: f32, sigma: f32, amp: f32) -> vec2f {
  let r = length(p);
  let s = max(sigma, 0.05);
  let t = r / s;
  let env = exp(-0.5 * min(t * t, 80.0));
  let psi = env * safe_cos(freq * r);
  let scale = 1.0 + amp * psi;
  return w * scale * p;
}
// V297 — mexican_hat (Ricker). ψ = (1−t²)·exp(−t²/2). No trig (the safe anchor).
fn var_mexican_hat(p: vec2f, w: f32, sigma: f32, amp: f32) -> vec2f {
  let r = length(p);
  let s = max(sigma, 0.05);
  let t = r / s;
  let t2 = min(t * t, 80.0);
  let psi = (1.0 - t2) * exp(-0.5 * t2);
  let scale = 1.0 + amp * psi;
  return w * scale * p;
}
// V298 — chirp. ψ = exp(−β·r²)·sin(α·r²); α·r² is THE Dawn trig-cliff case → safe_sin.
fn var_chirp(p: vec2f, w: f32, alpha: f32, amp: f32, decay: f32) -> vec2f {
  let r2 = dot(p, p);
  let env = exp(-decay * min(r2, 160.0));
  let psi = env * safe_sin(alpha * r2);
  let scale = 1.0 + amp * psi;
  return w * scale * p;
}

// --- #153 celestial-mechanics warps ---
// V299 — kepler_orbit. Polar angle → mean anomaly M; two Newton iterations
// solve M=E−e·sin E; place on the ellipse. e clamped [0,0.95] so f'≥0.05.
fn var_kepler_orbit(p: vec2f, w: f32, e_in: f32, scale: f32) -> vec2f {
  let e = clamp(e_in, 0.0, 0.95);
  let M = atan2(p.y, p.x);
  let a = scale * (length(p) + 1.0e-6);
  var E = M;
  let s1 = safe_sin(E);
  let c1 = safe_cos(E);
  E = E - (E - e * s1 - M) / max(1.0 - e * c1, 0.05);
  let s2 = safe_sin(E);
  let c2 = safe_cos(E);
  E = E - (E - e * s2 - M) / max(1.0 - e * c2, 0.05);
  let ce = safe_cos(E);
  let se = safe_sin(E);
  let b = sqrt(max(1.0 - e * e, 0.0));
  return w * vec2f(a * (ce - e), a * b * se);
}
// V300 — restricted_3body. Step along ∇Ω of the rotating-frame effective
// potential (two eps-softened wells + centrifugal) with a Coriolis rotation;
// per-step displacement hard-clamped to step·2.0.
fn var_restricted_3body(p: vec2f, w: f32, mu_in: f32, step: f32, coriolis: f32) -> vec2f {
  let mu = clamp(mu_in, 0.01, 0.5);
  let p1 = vec2f(-mu, 0.0);
  let p2 = vec2f(1.0 - mu, 0.0);
  let r1 = p - p1;
  let r2 = p - p2;
  let d1 = pow(dot(r1, r1) + 1.0e-3, 1.5);
  let d2 = pow(dot(r2, r2) + 1.0e-3, 1.5);
  let g = p - (1.0 - mu) * (r1 / d1) - mu * (r2 / d2);
  let gc = vec2f(-g.y, g.x);
  var disp = step * (g + coriolis * gc);
  let dl = length(disp);
  let cap = 2.0;
  if (dl > cap) { disp = disp * (cap / dl); }
  return w * (p + disp);
}
// V301 — hill_epicyclic. Linear epicyclic propagator (phi=phase·κ) + guiding-
// center shear. Pure linear map (det≥1); phi trig via safe_* (cliff guard).
fn var_hill_epicyclic(p: vec2f, w: f32, kappa: f32, phase: f32, shear: f32) -> vec2f {
  let k = clamp(kappa, 0.2, 2.0);
  let phi = phase * k;
  let cf = safe_cos(phi);
  let sf = safe_sin(phi);
  let x_out = p.x * cf - (sf / k) * p.y;
  let y_out = (2.0 * k) * sf * p.x + p.y * cf;
  return w * vec2f(x_out, y_out + shear * p.x);
}

// --- #155 knots & braids ---
// V302 — torus_knot. (p,q) torus-knot rosette: φ=atan2 drives p-fold winding,
// q sets the tube modulation, input radius blends petals. Bounded by radius+tube.
fn var_torus_knot(p: vec2f, w: f32, pp: f32, qq: f32, radius: f32, tube: f32) -> vec2f {
  let phi = atan2(p.y, p.x);
  let pf = max(round(pp), 1.0);
  let qf = max(round(qq), 1.0);
  let rin = length(p);
  let amp = tube * clamp(rin, 0.0, 1.0);
  let rr = radius + amp * safe_cos(qf * phi);
  let kx = rr * safe_cos(pf * phi);
  let ky = rr * safe_sin(pf * phi);
  return w * vec2f(kx, ky);
}
// V303 — braid_warp. Continuous braid-σ strand weave: split the circle into
// `strands` lanes, twist each by a smooth per-lane sinusoid with alternating
// over/under sign. Radius PRESERVED (pure angular permutation) → bounded.
fn var_braid_warp(p: vec2f, w: f32, strands: f32, twist: f32, crossings: f32) -> vec2f {
  let n = max(round(strands), 2.0);
  let cr = max(round(crossings), 1.0);
  let r = length(p);
  let theta = atan2(p.y, p.x);
  let a = (theta + PI) / TAU;
  let lane = floor(a * n);
  let laneFrac = a * n - lane;
  let sgn = select(1.0, -1.0, (i32(lane) & 1) == 1);
  let weave = safe_sin(PI * laneFrac);
  let rad = clamp(r, 0.0, 1.0);
  let dtheta = twist * sgn * weave * safe_sin(cr * PI * laneFrac) * rad;
  let nt = theta + dtheta;
  return w * r * vec2f(safe_cos(nt), safe_sin(nt));
}

// =====================================================================
// Marathon follow-ons (#216/#218/#220/#221) — variation kernels (V304–V309).
// =====================================================================

// --- #216 optics follow-on (reuses #137 airy_ai_eval) ---
// V304 — airy_caustic. Supernumerary-ring caustic profile: modulate the radius
// by 1 + amp·Ai(scale·(r − r0)). Unlike airy_radial (pure Ai scaling), the +1
// envelope keeps the disk and overlays the diffraction fringes inside the
// caustic edge (the oscillatory Ai region is reached where r < r0). Clamped
// positive (0.05) so it never folds through the origin.
fn var_airy_caustic(p: vec2f, w: f32, scale: f32, r0: f32, amp: f32) -> vec2f {
  let r = length(p);
  let a = airy_ai_eval(scale * (r - r0));
  let env = clamp(1.0 + amp * a, 0.05, 3.0);
  return w * (env * p);
}

// --- #220 special-function follow-on (complete elliptic integrals) ---
// Both are radial inverse-profile remaps in the #151 idiom: u = r²/(1+r²) ∈
// (0,1) drives the parameter m; angle preserved; origin → origin.
// V305 — elliptic_E. r' = scale·E(m), E ∈ [1, π/2] inherently bounded → a
// gentle singularity-free radial projector (a soft ring).
fn var_elliptic_E(p: vec2f, w: f32, scale: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let m  = r2 / (1.0 + r2);
  let e  = elliptic_E_eval(m);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * (scale * e) * dir;
}
// V306 — elliptic_K. r' = scale·K(m); K diverges logarithmically as m→1 (the
// rim): elliptic_K_eval floors m1 at 1e-3 and r' is HARD-clamped to tail_clamp,
// so the bright outer ring stays bounded.
fn var_elliptic_K(p: vec2f, w: f32, scale: f32, tail_clamp: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let m  = r2 / (1.0 + r2);
  let k  = elliptic_K_eval(m);
  let cap = max(tail_clamp, 0.01);
  let rp = min(scale * k, cap);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}

// --- #218 statistical-distribution follow-on (inverse-CDF, erfinv) ---
// V307 — gaussian_cdf. Normal-quantile radial remap r' = μ + σ·√2·erfinv(2u−1),
// u = r²/(1+r²) endpoint-clamped (keeps the erfinv argument off ±1). Bell-shaped
// pile-up: the unit circle (u=0.5 → erfinv(0)=0) maps to radius μ.
fn var_gaussian_cdf(p: vec2f, w: f32, mu: f32, sigma: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let u  = clamp(r2 / (1.0 + r2), 1.0e-4, 1.0 - 1.0e-4);
  let q  = erfinv_eval(2.0 * u - 1.0);
  var rp = mu + sigma * 1.4142135 * q;
  rp = max(rp, 0.0);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}
// V308 — levy_cdf. Lévy (α=½ stable) quantile r' = c / (2·erfinv(1−u)²). The
// heaviest-tailed member: erfinv(1−u) → 0 as u → 1 (the rim) blows r' up, so it
// is HARD-clamped to tail_clamp (two-layer: u-endpoint guard + r' cap).
fn var_levy_cdf(p: vec2f, w: f32, c: f32, tail_clamp: f32) -> vec2f {
  let r2 = dot(p, p);
  let r  = sqrt(r2);
  let u  = clamp(r2 / (1.0 + r2), 1.0e-4, 1.0 - 1.0e-4);
  let e  = erfinv_eval(1.0 - u);
  let denom = max(2.0 * e * e, 1.0e-6);
  let raw = max(c, 1.0e-4) / denom;
  let cap = max(tail_clamp, 0.01);
  let rp = min(raw, cap);
  let dir = select(p / max(r, 1.0e-12), vec2f(0.0, 0.0), r < 1.0e-9);
  return w * rp * dir;
}

// --- #221 digit-scramble follow-on (base-3 Peano) ---
// V309 — peano. Per-axis base-3 Peano reflected-ternary scramble: encode each
// coordinate to a `trits`-digit base-3 index, apply the orientation-flip digit
// recursion (peano_scramble), decode back. A self-similar ternary fold —
// distinct from the base-2 digit-scramble family. Pure integer ops, bounded.
fn var_peano(p: vec2f, w: f32, extent: f32, trits_f: f32) -> vec2f {
  let trits = u32(clamp(trits_f, 2.0, 15.0));
  let ix = tri_encode(p.x, extent, trits);
  let iy = tri_encode(p.y, extent, trits);
  let sx = peano_scramble(ix, trits);
  let sy = peano_scramble(iy, trits);
  return w * vec2f(tri_decode(sx, extent, trits), tri_decode(sy, extent, trits));
}

// ---------------------------------------------------------------------
// Variation dispatcher — runtime switch over indices.
// V=97 (pre_blur) is handled pre-switch in the 2-pass variation chain
// loop and intentionally has NO `case 97u` entry — falls through to
// default → (0,0) so it contributes nothing to pv.
// V=99..102 (DC variations) — most return (0,0) position (color-only);
// dc_cylinder (102) and newton (220) are position-warp + DC variations:
// position contribution from their normal switch case, color override
// from the DC dispatch block in the chain loop when xf.color_params.w
// (dc_flag) is set.
// p0/p1 come from xf.vars[k].zw; p2..p5 come from xf.vars_extra[k];
// p6/p7 come from xf.vars_extra2[k].xy (Phase 9b Batch K seam extension);
// p8/p9 come from xf.vars_extra2[k].zw (#120 seam extension — bipolar2).
// ---------------------------------------------------------------------

fn apply_variation(
  idx: u32,
  p: vec2f,
  w: f32,
  p0: f32,
  p1: f32,
  p2: f32,
  p3: f32,
  p4: f32,
  p5: f32,
  p6: f32,
  p7: f32,
  p8: f32,
  p9: f32,
  a0: vec4f,
  a1: vec4f,
  wi: u32,
) -> vec2f {
  switch (idx) {
    case 0u:  { return var_linear(p, w); }
    case 1u:  { return var_sinusoidal(p, w); }
    case 2u:  { return var_spherical(p, w); }
    case 3u:  { return var_swirl(p, w); }
    case 4u:  { return var_horseshoe(p, w); }
    case 5u:  { return var_polar(p, w); }
    case 6u:  { return var_handkerchief(p, w); }
    case 7u:  { return var_heart(p, w); }
    case 8u:  { return var_disc(p, w); }
    case 9u:  { return var_spiral(p, w); }
    case 10u: { return var_hyperbolic(p, w); }
    case 11u: { return var_diamond(p, w); }
    case 12u: { return var_ex(p, w); }
    case 13u: { return var_julia(p, w, wi); }
    case 14u: { return var_julian(p, w, p0, p1, wi); }
    case 15u: { return var_bent(p, w); }
    case 16u: { return var_waves(p, w, a0, a1); }
    case 17u: { return var_fisheye(p, w); }
    case 18u: { return var_popcorn(p, w, a0, a1); }
    case 19u: { return var_eyefish(p, w); }
    case 20u: { return var_bubble(p, w); }
    case 21u: { return var_cylinder(p, w); }
    case 22u: { return var_disc2(p, w, p0, p1); }
    case 23u: { return var_pdj(p, w, p0, p1, p2, p3); }
    case 24u: { return var_exponential(p, w); }
    case 25u: { return var_power(p, w); }
    case 26u: { return var_cosine(p, w); }
    case 27u: { return var_tangent(p, w); }
    case 28u: { return var_secant2(p, w); }
    case 29u: { return var_cross(p, w); }
    case 30u: { return var_rings(p, w, a0, a1); }
    case 31u: { return var_fan(p, w, a0, a1); }
    case 32u: { return var_rings2(p, w, p0); }
    case 33u: { return var_fan2(p, w, p0, p1); }
    case 34u: { return var_perspective(p, w, p0, p1); }
    case 35u: { return var_bipolar(p, w, p0); }
    case 36u: { return var_curl(p, w, p0, p1); }
    case 37u: { return var_rectangles(p, w, p0, p1); }
    case 38u: { return var_blob(p, w, p0, p1, p2); }
    case 39u: { return var_ngon(p, w, p0, p1, p2, p3); }
    case 40u: { return var_wedge(p, w, p0, p1, p2, p3); }
    case 41u: { return var_cpow(p, w, p0, p1, p2, wi); }
    case 42u: { return var_curve(p, w, p0, p1, p2, p3); }
    case 43u: { return var_noise(p, w, wi); }
    case 44u: { return var_blur(p, w, wi); }
    case 45u: { return var_gaussian_blur(p, w, wi); }
    case 46u: { return var_arch(p, w, wi); }
    case 47u: { return var_radial_blur(p, w, p0, wi); }
    case 48u: { return var_juliascope(p, w, p0, p1, wi); }
    case 49u: { return var_square(p, w, wi); }
    case 50u: { return var_rays(p, w, wi); }
    case 51u: { return var_blade(p, w, wi); }
    case 52u: { return var_twintrian(p, w, wi); }
    case 53u: { return var_exp(p, w); }
    case 54u: { return var_log(p, w); }
    case 55u: { return var_sin(p, w); }
    case 56u: { return var_cos(p, w); }
    case 57u: { return var_tan(p, w); }
    case 58u: { return var_sec(p, w); }
    case 59u: { return var_csc(p, w); }
    case 60u: { return var_cot(p, w); }
    case 61u: { return var_sinh(p, w); }
    case 62u: { return var_cosh(p, w); }
    case 63u: { return var_tanh(p, w); }
    case 64u: { return var_sech(p, w); }
    case 65u: { return var_csch(p, w); }
    case 66u: { return var_coth(p, w); }
    case 67u: { return var_butterfly(p, w); }
    case 68u: { return var_edisc(p, w); }
    case 69u: { return var_elliptic(p, w); }
    case 70u: { return var_foci(p, w); }
    case 71u: { return var_loonie(p, w); }
    case 72u: { return var_polar2(p, w); }
    case 73u: { return var_scry(p, w); }
    case 74u: { return var_bent2(p, w, p0, p1); }
    case 75u: { return var_cell(p, w, p0); }
    case 76u: { return var_escher(p, w, p0); }
    case 77u: { return var_modulus(p, w, p0, p1); }
    case 78u: { return var_split(p, w, p0, p1); }
    case 79u: { return var_splits(p, w, p0, p1); }
    case 80u: { return var_stripes(p, w, p0, p1); }
    case 81u: { return var_whorl(p, w, p0, p1); }
    case 82u: { return var_flux(p, w, p0); }
    case 83u: { return var_popcorn2(p, w, p0, p1, p2); }
    case 84u: { return var_lazysusan(p, w, p0, p1, p2, p3, p4); }
    case 85u: { return var_waves2(p, w, p0, p1, p2, p3); }
    case 86u: { return var_oscope(p, w, p0, p1, p2, p3); }
    case 87u: { return var_separation(p, w, p0, p1, p2, p3); }
    case 88u: { return var_auger(p, w, p0, p1, p2, p3); }
    case 89u: { return var_wedge_sph(p, w, p0, p1, p2, p3); }
    case 90u: { return var_super_shape(p, w, p0, p1, p2, p3, p4, p5, wi); }
    case 91u: { return var_flower(p, w, p0, p1, wi); }
    case 92u: { return var_conic(p, w, p0, p1, wi); }
    case 93u: { return var_parabola(p, w, p0, p1, wi); }
    case 94u: { return var_pie(p, w, p0, p1, p2, wi); }
    case 95u: { return var_boarders(p, w, wi); }
    case 96u: { return var_wedge_julia(p, w, p0, p1, p2, p3, wi); }
    case 98u: { return var_mobius(p, w, p0, p1, p2, p3, p4, p5, p6, p7); }
    // #114 DC variations — position contributions.
    // dc_linear (99), dc_perlin (100), dc_gridout (101) are color-only:
    // identity contribution (0, 0). The visible effect comes from
    // rgb_override at splat time.
    case 99u:  { return vec2f(0.0, 0.0); }
    case 100u: { return vec2f(0.0, 0.0); }
    case 101u: { return vec2f(0.0, 0.0); }
    // dc_cylinder (102) warps position like flam3's var_cylinder.
    case 102u: { return var_dc_cylinder_pos(p, w); }
    // #114 batch 1 — post-flam3 plugin pack.
    case 103u: { return var_cpow2(p, w, p0, p1, p2, p3, wi); }
    case 104u: { return var_cpow3(p, w, p0, p1, p2, p3, wi); }
    case 105u: { return var_loonie2(p, w, p0, p1, p2); }
    case 106u: { return var_epispiral(p, w, p0, p1, p2, wi); }
    // #114 batch 2a — Worley/Voronoi cellular family.
    case 107u: { return var_bwraps(p, w, p0, p1, p2, p3, p4); }
    case 108u: { return var_crackle(p, w, p0, p1, p2, p3, wi); }
    // #114 batch 2b-a — JWildfire S-tier first half.
    case 109u: { return var_juliaq(p, w, p0, p1, wi); }
    case 110u: { return var_glynnia(p, w, wi); }
    case 111u: { return var_loonie3(p, w); }
    case 112u: { return var_falloff(p, w, p0, p1, p2, p3, p4, p5, wi); }
    case 113u: { return var_falloff2(p, w, p0, p1, p2, p3, p4, p5, p6, wi); }
    case 114u: { return var_falloff3(p, w, p0, p1, p2, p3, p4, p5, p6, wi); }
    // #114 batch 2b-b — S-tier kaleidoscope/circle family.
    case 115u: { return var_collideoscope(p, w, p0, p1); }
    case 116u: { return var_circlize(p, w, p0); }
    case 117u: { return var_circlize2(p, w, p0); }
    case 118u: { return var_eswirl(p, w, p0, p1); }
    case 119u: { return var_petal(p, w); }
    // #114 batch 2b-c — Xyrus02 mid-tier + hexes cellular.
    case 120u: { return var_bcircle(p, w, p0, p1, wi); }
    case 121u: { return var_curl2(p, w, p0, p1, p2); }
    case 122u: { return var_murl(p, w, p0, p1); }
    case 123u: { return var_stwins(p, w, p0); }
    case 124u: { return var_hexes(p, w, p0, p1, p2, p3); }
    // #114 batch 2b-d — Xyrus02 X-family + blur_circle (FINAL #114 batch).
    case 125u: { return var_xheart(p, w, p0, p1); }
    case 126u: { return var_xhyperbol(p, w, p0, p1, p2, p3, p4, p5); }
    case 127u: { return var_xcurl2(p, w, p0, p1, p2); }
    case 128u: { return var_xtrb(p, w, p0, p1, p2, p3, p4, p5, wi); }
    case 129u: { return var_xyrus_gridout(p, w); }
    case 130u: { return var_blur_circle(p, w, p0, wi); }
    case 131u: { return var_bipolar2(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8); }
    case 132u: { return var_bubble2(p, w, p0, p1); }
    case 133u: { return var_acosh(p, w, wi); }
    case 134u: { return var_arcsinh(p, w); }
    case 135u: { return var_arctanh(p, w); }
    case 136u: { return var_acoth(p, w); }
    case 137u: { return var_acosech(p, w, wi); }
    case 138u: { return var_arcsech2(p, w); }
    case 139u: { return var_cell2(p, w, p0, p1, p2, p3, p4, p5); }
    case 140u: { return var_curl_sp(p, w, p0, p1, p2, p3, p4); }
    case 141u: { return var_murl2(p, w, p0, p1); }
    case 142u: { return var_lissajous(p, w, p0, p1, p2, p3, p4, p5, p6, wi); }
    case 143u: { return var_spirograph(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8, wi); }
    case 144u: { return var_waffle(p, w, p0, p1, p2, p3, wi); }
    case 145u: { return var_glynnSim1(p, w, p0, p1, p2, p3, p4, p5, wi); }
    case 146u: { return var_glynnSim2(p, w, p0, p1, p2, p3, p4, p5, wi); }
    case 147u: { return var_glynnSim3(p, w, p0, p1, p2, p3, wi); }
    case 148u: { return var_flipy(p, w); }
    case 149u: { return var_eclipse(p, w, p0); }
    case 150u: { return var_barycentroid(p, w, p0, p1, p2, p3); }
    case 151u: { return var_chunk(p, w, p0, p1, p2, p3, p4, p5, p6); }
    case 152u: { return var_ennepers(p, w); }
    case 153u: { return var_erf(p, w); }
    case 154u: { return var_circus(p, w, p0); }
    case 155u: { return var_asteria(p, w, p0, wi); }
    case 156u: { return var_clifford_js(p, w, p0, p1, p2, p3); }
    case 157u: { return var_devil_warp(p, w, p0, p1, p2, p3, p4, p5); }
    case 158u: { return var_voron(p, w, p0, p1, p2, p3, p4); }
    case 159u: { return var_henon(p, w, p0, p1, p2); }
    case 160u: { return var_atan(p, w, p0, p1); }
    case 161u: { return var_cardioid(p, w, p0); }
    case 162u: { return var_chrysanthemum(p, w, wi); }
    case 163u: { return var_bcollide(p, w, p0, p1); }
    case 164u: { return var_bsplit(p, w, p0, p1); }
    case 165u: { return var_bulge(p, w, p0); }
    case 166u: { return var_checks(p, w, p0, p1, p2, p3, wi); }
    case 167u: { return var_circular(p, w, p0, p1, wi); }
    case 168u: { return var_circular2(p, w, p0, p1, p2, p3, wi); }
    case 169u: { return var_corners(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8); }
    case 170u: { return var_circleblur(p, w, wi); }
    case 171u: { return var_fibonacci2(p, w, p0, p1); }
    case 172u: { return var_hypertile(p, w, p0, p1, p2); }
    case 173u: { return var_hypertile1(p, w, p0, p1, wi); }
    case 174u: { return var_hypertile2(p, w, p0, p1, wi); }
    case 175u: { return var_idisc(p, w); }
    case 176u: { return var_hole(p, w, p0, p1); }
    case 177u: { return var_kaleidoscope(p, w, p0, p1, p2, p3, p4); }
    case 178u: { return var_layered_spiral(p, w, p0); }
    case 179u: { return var_linear_t(p, w, p0, p1); }
    case 180u: { return var_line(p, w, p0, p1, wi); }
    case 181u: { return var_ovoid(p, w, p0, p1); }
    case 182u: { return var_phoenix_julia(p, w, p0, p1, p2, p3, wi); }
    case 183u: { return var_unpolar(p, w); }
    case 184u: { return var_shredrad(p, w, p0, p1); }
    case 185u: { return var_vogel(p, w, p0, p1, wi); }
    case 186u: { return var_yin_yang(p, w, p0, p1, p2, p3, p4, wi); }
    case 187u: { return var_squish(p, w, p0, wi); }
    case 188u: { return var_target(p, w, p0, p1, p2); }
    case 189u: { return var_funnel(p, w, p0); }
    case 190u: { return var_holesq(p, w); }
    case 191u: { return var_hole2(p, w, p0, p1, p2, p3, p4, p5); }
    case 192u: { return var_lace_js(p, w, wi); }
    case 193u: { return var_julia_outside(p, w, p0, p1, p2, wi); }
    case 194u: { return var_fourth(p, w, p0, p1, p2, p3, p4); }
    case 195u: { return var_pulse(p, w, p0, p1, p2, p3); }
    case 196u: { return var_rays1(p, w); }
    case 197u: { return var_rays2(p, w); }
    case 198u: { return var_rays3(p, w); }
    case 199u: { return var_tancos(p, w); }
    case 200u: { return var_twoface(p, w); }
    case 201u: { return var_e_julia(p, w, p0, wi); }
    case 202u: { return var_cannabis_curve_wf(p, w, p0, wi); }
    case 203u: { return var_e_collide(p, w, p0, p1); }
    case 204u: { return var_e_mod(p, w, p0, p1); }
    case 205u: { return var_intersection(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, wi); }
    case 206u: { return var_inv_squircular(p, w); }
    case 207u: { return var_lozi(p, w, p0, p1, p2); }
    case 208u: { return var_hypershift(p, w, p0, p1); }
    case 209u: { return var_hex_modulus(p, w, p0); }
    case 210u: { return var_boarders2(p, w, p0, p1, p2, wi); }
    case 211u: { return var_b_mod(p, w, p0, p1); }
    case 212u: { return var_b_transform(p, w, p0, p1, p2, p3, wi); }
    case 213u: { return var_parallel(p, w, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, wi); }
    // #170 sibling-pair completions + S-tier ports.
    case 214u: { return var_waves3(p, w, p0, p1, p2, p3, p4, p5); }
    case 215u: { return var_waves4(p, w, p0, p1, p2, p3, p4, p5); }
    case 216u: { return var_scry2(p, w, p0, p1, p2); }
    case 217u: { return var_ennepers2(p, w, p0, p1, p2); }
    case 218u: { return var_apollony(p, w, wi); }
    case 219u: { return var_circlecrop(p, w, p0, p1, p2, p3, p4, wi); }
    // #133 — Conformal & complex-analytic warps.
    case 220u: { return var_newton(p, w, p0); }
    case 221u: { return var_blaschke(p, w, p0, p1); }
    case 222u: { return var_cayley(p, w, p0); }
    case 223u: { return var_complex_gamma(p, w, p0); }
    case 224u: { return var_lambert_w(p, w, p0); }
    // #134 — Cartographic map-projection warps.
    case 225u: { return var_mercator(p, w); }
    case 226u: { return var_lambert(p, w); }
    case 227u: { return var_mollweide(p, w); }
    case 228u: { return var_hammer(p, w); }
    case 229u: { return var_stereographic(p, w); }
    // #130 — Single-step strange-attractor maps
    case 230u: { return var_standard_map(p, w, p0); }
    case 231u: { return var_de_jong(p, w, p0, p1, p2, p3); }
    case 232u: { return var_ikeda(p, w, p0); }
    // #129 — Fold-family variations
    case 233u: { return var_box_fold(p, w, p0); }
    case 234u: { return var_sphere_fold(p, w, p0, p1); }
    case 235u: { return var_mandelbox_step(p, w, p0, p1, p2, p3, p4); }
    case 236u: { return var_kifs_fold(p, w, p0, p1); }
    // #140 — Area-preserving / toral chaos maps
    case 237u: { return var_arnold_cat(p, w); }
    case 238u: { return var_bakers_map(p, w); }
    case 239u: { return var_tent_map(p, w); }
    case 240u: { return var_logistic_map(p, w, p0); }
    // #135 — Plane & roulette-curve warps
    case 241u: { return var_superellipse(p, w, p0, p1, p2); }
    case 242u: { return var_limacon(p, w, p0, p1); }
    case 243u: { return var_epicycloid(p, w, p0); }
    case 244u: { return var_catenary(p, w, p0); }
    case 245u: { return var_tractrix(p, w); }
    case 246u: { return var_tinkerbell(p, w, p0, p1, p2, p3); }
    case 247u: { return var_duffing(p, w, p0, p1, p2, p3); }
    case 248u: { return var_vanderpol(p, w, p0, p1); }
    case 249u: { return var_rossler(p, w, p0, p1); }
    case 250u: { return var_droste(p, w, p0); }
    case 251u: { return var_logspiral(p, w, p0, p1); }
    case 252u: { return var_fermat_spiral(p, w, p0); }
    case 253u: { return var_lituus(p, w, p0); }
    case 254u: { return var_hyperbolic_spiral(p, w, p0); }
    case 255u: { return var_weierstrass(p, w, p0, p1, p2, p3); }
    case 256u: { return var_takagi(p, w, p0, p1); }
    case 257u: { return var_cantor_stairs(p, w, p0, p1); }
    case 258u: { return var_billiard_circle(p, w, p0, p1, p2); }
    case 259u: { return var_billiard_stadium(p, w, p0, p1, p2, p3); }
    case 260u: { return var_billiard_sinai(p, w, p0, p1, p2, p3); }
    case 261u: { return var_billiard_polygon(p, w, p0, p1, p2, p3); }
    case 262u: { return var_lorentz_boost(p, w, p0, p1); }
    case 263u: { return var_schwarzschild_lensing(p, w, p0, p1); }
    case 264u: { return var_field_dipole(p, w, p0, p1, p2, p3); }
    case 265u: { return var_magnetic_pendulum_pos(p, w, p0, p1, p2, p3); }
    // #131 — Modular / number-theory variations
    case 266u: { return var_jacobi_theta(p, w, p0); }
    case 267u: { return var_modular_lambda(p, w, p0); }
    case 268u: { return var_klein_j(p, w, p0); }
    case 269u: { return var_weierstrass_p(p, w, p0, p1, p2, p3); }
    case 270u: { return var_gauss_map(p, w); }
    // #132 — Exotic warps
    case 271u: { return var_nbody_lensing(p, w, p0, p1, p2, p3, p4, p5, p6, p7); }
    case 272u: { return var_curl_noise(p, w, p0, p1); }
    // #137 — Special-function radial profiles
    case 273u: { return var_bessel_j0(p, w, p0); }
    case 274u: { return var_airy_radial(p, w, p0, p1); }
    case 275u: { return var_cornu_spiral(p, w, p0); }
    case 276u: { return var_struve_h1(p, w, p0); }
    // #141 — Quasi-random & digit-scramble warps
    case 277u: { return var_radical_inverse(p, w, p0, p1); }
    case 278u: { return var_gray_code(p, w, p0, p1); }
    case 279u: { return var_morton_zorder(p, w, p0, p1); }
    // #144 — Orthogonal-polynomial & harmonic warps
    case 280u: { return var_chebyshev(p, w, p0, p1); }
    case 281u: { return var_legendre(p, w, p0, p1); }
    case 282u: { return var_spherical_harmonic(p, w, p0, p1, p2); }
    case 283u: { return var_fourier_warp(p, w, p0, p1, p2); }
    // #146 — Optics warps
    case 284u: { return var_snell_refraction(p, w, p0, p1); }
    case 285u: { return var_grin_lens(p, w, p0, p1); }
    case 286u: { return var_caustic_fold(p, w, p0, p1, p2); }
    // #147 — Wave & nodal-pattern warps
    case 287u: { return var_chladni(p, w, p0, p1, p2); }
    case 288u: { return var_standing_wave(p, w, p0, p1, p2, p3); }
    case 289u: { return var_moire(p, w, p0, p1, p2, p3); }
    // #148 — Atomic-orbital warps
    case 290u: { return var_radial_shell(p, w, p0, p1, p2); }
    case 291u: { return var_hydrogen_orbital(p, w, p0, p1, p2, p3, p4); }
    // #151 — Statistical-distribution warps
    case 292u: { return var_weibull_cdf(p, w, p0, p1); }
    case 293u: { return var_logistic_cdf(p, w, p0, p1); }
    case 294u: { return var_cauchy_cdf(p, w, p0, p1); }
    case 295u: { return var_pareto_cdf(p, w, p0, p1, p2); }
    // #152 — Wavelet & signal warps
    case 296u: { return var_morlet(p, w, p0, p1, p2); }
    case 297u: { return var_mexican_hat(p, w, p0, p1); }
    case 298u: { return var_chirp(p, w, p0, p1, p2); }
    // #153 — Celestial-mechanics warps
    case 299u: { return var_kepler_orbit(p, w, p0, p1); }
    case 300u: { return var_restricted_3body(p, w, p0, p1, p2); }
    case 301u: { return var_hill_epicyclic(p, w, p0, p1, p2); }
    // #155 — Knots & braids
    case 302u: { return var_torus_knot(p, w, p0, p1, p2, p3); }
    case 303u: { return var_braid_warp(p, w, p0, p1, p2); }
    // ── Marathon follow-ons (#216/#218/#220/#221) ──
    case 304u: { return var_airy_caustic(p, w, p0, p1, p2); }   // #216 optics
    case 305u: { return var_elliptic_E(p, w, p0); }             // #220 special fn
    case 306u: { return var_elliptic_K(p, w, p0, p1); }         // #220 special fn
    case 307u: { return var_gaussian_cdf(p, w, p0, p1); }       // #218 distribution
    case 308u: { return var_levy_cdf(p, w, p0, p1); }           // #218 distribution
    case 309u: { return var_peano(p, w, p0, p1); }              // #221 digit-scramble
    case 310u: { return var_burning_ship(p, w, p0, p1); }       // #145 escape-time
    case 311u: { return var_magnet1(p, w, p0, p1); }            // #145 escape-time
    case 312u: { return var_nova(p, w, p0, p1, p2); }           // #145 escape-time
    case 313u: { return var_halley(p, w, p0, p1); }             // #145 escape-time
    default:  { return vec2f(0.0, 0.0); }
  }
}

// #18 (PYR3-058): saturating atomic add into the histogram — pins at u32::MAX
// instead of wrapping, mirroring flam3's `bump_no_overflow` (rect.c:460-461).
// Each deposit's delta is <= 255 (opacity*255 / palette-scaled), but a bucket
// can exceed 2^32 on a pathological single-pixel attractor at the 4K preset.
// A WRAPPED count channel reads as LOW density at the brightest spot, so the
// density estimator + log tonemap punch a black hole through the peak; wrapped
// r/g/b corrupt the color there too. WGSL has no atomic saturating-add, so this
// is a compare-exchange loop. Takes the bucket index (not a pointer) so it can
// reference the module-scope `hist` binding directly. delta==0 is a no-op fast
// path (skips the CAS) — common when opacity or a palette channel is 0.
fn atomic_add_sat(idx: u32, delta: u32) {
  if (delta == 0u) {
    return;
  }
  var old = atomicLoad(&hist[idx]);
  loop {
    // Pin at u32::MAX when old + delta would overflow (matches flam3: add only
    // while `U32_MAX - old >= delta`, else saturate).
    let capped = select(old + delta, 0xffffffffu, (0xffffffffu - old) < delta);
    let res = atomicCompareExchangeWeak(&hist[idx], old, capped);
    if (res.exchanged) {
      break;
    }
    old = res.old_value;
  }
}

@compute @workgroup_size(64)
fn chaos_main(@builtin(global_invocation_id) gid: vec3u) {
  let walker_id = gid.x;

  // #11 (PYR3-057): bail the padding threads from the rounded-up final
  // workgroup BEFORE any RNG draw. Their isaac_states[] slot is stale or
  // zero-init, so without this guard they'd run the full chaos loop and
  // atomicAdd bogus-RNG trajectories into the histogram on every render
  // (a ~1-5% density bias + within-hardware non-determinism when the walker
  // count changes between renders).
  if (walker_id >= u.walker_count) {
    return;
  }

  // Per-walker ISAAC state is in `isaac_states[walker_id]` (storage). Pre-initialized
  // host-side via `packIsaacStates()` (src/isaac.ts → src/chaos.ts). The
  // legacy PCG32 per-walker `var rng: u32` warm-up is gone.

  // Walker state = (x, y, color). flam3's RENDER path seeds the color
  // coordinate RANDOMLY: rect.c:393-397 fills iter_storage[0]=isaac_11,
  // [1]=isaac_11, [2]=isaac_01 (color), [3]=isaac_01. The earlier
  // PYR3-029 Phase 5 "RNG-alignment fix" seeded color to 0.0, citing
  // flam3.c:449-451 — but that is the BOUNDING-BOX ESTIMATOR path
  // (flam3_estimate_bounding_box), NOT render_rectangle. Seeding color
  // to 0 means that for genomes with color_speed=0 the color coord never
  // moves off 0, so every hit deposits palette[0] (the dark end) → the
  // whole image renders ~10x too dim (GH issue #3, electricsheep.248.23585).
  // Restore the random color seed to match the real render path; with
  // color_speed=0 each walker keeps a random palette index for life, so
  // hits spread across the full palette (≈ palette mean) like flam3.
  //
  // WGSL §10.3 eval-order guard — captured `let` bindings force flam3's
  // left-to-right ISAAC draw order (x, y, color).
  let init_x = rand_11(walker_id);
  let init_y = rand_11(walker_id);
  let init_z = rand01(walker_id);
  var p = vec3f(init_x, init_y, init_z);

  // Phase 9-rotate: hoist cos/sin outside the iter loop. rotation_rad is uniform —
  // recomputing per iter would cost ~16M transcendental evals per frame for nothing.
  let cos_r = cos(u.rotation_rad);
  let sin_r = sin(u.rotation_rad);

  // Phase 9d: previous xform index for xaos lookup. -1 sentinel = first iter
  // (uniform pick, no xaos multiplier — matches flam3.c:181 `if (xi >= 0)`).
  var prev_xform: i32 = -1;

  // Phase 9-parity: consecutive bad-value counter for flam3-faithful retry on
  // NaN/extreme variation outputs. flam3 (flam3.c:257-269 + variations.c:2421-2424)
  // reseeds bad outputs to random [-1, 1] AND retries up to 4 times (skip splat)
  // before giving up on the 5th. Without this, every reseeded walker pollutes
  // the histogram with un-burned-in trajectories, producing the gray-blue haze
  // observed on .flame imports.
  var consec_bad: u32 = 0u;

  let total_iters = u.iters_per_walker + u.fuse;
  for (var i = 0u; i < total_iters; i = i + 1u) {
    // PYR3-029 Phase 5c: flam3-canonical xform-pick via precomputed
    // distribution table. Mirrors flam3.c:291-293:
    //   fn = xform_distrib[lastxf*GRAIN + (irand & GRAIN_M1)]
    // Row index: prev_xform if >= 0, else the fallback row (MAX_XFORMS_U).
    // The table encodes (weight × xaos[prev][curr]) cumulative distribution
    // per row at host-build time, so the runtime pick is a single masked
    // lookup — 1 RNG draw, 1 storage fetch, 1 multiply-add for the index.
    // This replaces the prior weighted-scan algorithm which was statistically
    // equivalent but used 28-bit precision of irand (vs flam3's 14-bit
    // table-index), so given the same RNG state the two engines produced
    // wholly different xform-pick sequences. Trajectory divergence was the
    // dominant lever for coverage.248.02226 / .245.06687.
    let pick_row = select(MAX_XFORMS_U, u32(prev_xform), prev_xform >= 0);
    let pick_table_idx = pick_row * CHOOSE_XFORM_GRAIN + (isaac_irand(walker_id) & CHOOSE_XFORM_GRAIN_M1);
    let fn_idx: u32 = xform_distrib[pick_table_idx];
    let xf = xforms[fn_idx];
    let a0 = xf.affine0;
    let a1 = xf.affine1;

    // Affine pre-transform.
    let pa = vec2f(
      a0.x * p.x + a0.y * p.y + a0.z,
      a1.x * p.x + a1.y * p.y + a1.z,
    );

    // Variation chain — pre_blur (V=97) mutates pa BEFORE the regular chain
    // runs (flam3-canonical). 2-pass loop: pass 1 applies pre_blur deltas; pass 2
    // runs everything else. Defensive clamp on num_vars: a NaN/Inf in `a1.w`
    // would `u32`-cast to a huge value and stall the workgroup. Phase 9b
    // post-mortem hardening (BACKLOG, 2026-05-12).
    let num_vars = min(u32(a1.w), MAX_VARS_PER_XFORM);
    var pa_mut = pa;
    for (var k = 0u; k < num_vars; k = k + 1u) {
      let v = xforms[fn_idx].vars[k];
      if (u32(v.x) == 97u) {
        let r0 = rand01(walker_id);
        let r1 = rand01(walker_id);
        let r2 = rand01(walker_id);
        let r3 = rand01(walker_id);
        let rndG = v.y * (r0 + r1 + r2 + r3 - 2.0);
        let r4 = rand01(walker_id);
        let rndA = r4 * TAU;
        // Note: v.y (weight) is already folded into rndG; do NOT multiply again here.
        pa_mut = pa_mut + vec2f(cos(rndA) * rndG, sin(rndA) * rndG);
      }
    }
    var pv = vec2f(0.0, 0.0);
    // #114 — DC override accumulator for THIS xform's chain. When the
    // xform's dc_flag (color_params.w) is set, the chain has at least
    // one DC variation; the last DC variation in the chain wins (last
    // write to dc_rgb_override). When dc_flag = 0, this stays unused.
    var dc_rgb_override: vec3f = vec3f(0.0);
    var dc_override_active: bool = false;
    for (var k = 0u; k < num_vars; k = k + 1u) {
      let v = xforms[fn_idx].vars[k];
      let ve = xforms[fn_idx].vars_extra[k];
      let ve2 = xforms[fn_idx].vars_extra2[k];
      let var_idx = u32(v.x);
      if (var_idx != 97u) {
        pv = pv + apply_variation(var_idx, pa_mut, v.y, v.z, v.w, ve.x, ve.y, ve.z, ve.w, ve2.x, ve2.y, ve2.z, ve2.w, a0, a1, walker_id);
      }
      // #114 — DC color computation. Only when this xform is flagged DC
      // (cheap branch: 0.0 for all flam3-99-only xforms, ie almost all)
      // AND this specific variation's weight is non-zero. The weight
      // gate is the load-bearing part of the editor's active-toggle: the
      // expand pass (symmetry.ts:expandGenomeForGPU) zeroes weight for
      // any variation the user toggled off, so checking v.y > 0 here
      // turns DC off for inactive variations alongside the normal
      // position-contribution path (which is already implicitly gated
      // by w being threaded through apply_variation). Without this
      // gate, an inactive dc_perlin still recolored the xform.
      // Last DC variation in the chain wins (sequential writes to
      // dc_rgb_override). For dc_cylinder, color is computed from pa_mut
      // (the input coord), NOT the post-warp coord — matches JWildfire.
      if (xf.color_params.w > 0.5 && v.y > 0.0) {
        if (var_idx == 99u) {
          dc_rgb_override = var_dc_linear_color(pa_mut);
          dc_override_active = true;
        } else if (var_idx == 100u) {
          // dc_perlin params: scale (v.z), octaves (v.w), color_seed (ve.x).
          dc_rgb_override = var_dc_perlin_color(pa_mut, v.z, v.w, ve.x);
          dc_override_active = true;
        } else if (var_idx == 101u) {
          // dc_gridout params: cells (v.z).
          dc_rgb_override = var_dc_gridout_color(pa_mut, v.z);
          dc_override_active = true;
        } else if (var_idx == 102u) {
          dc_rgb_override = var_dc_cylinder_color(pa_mut);
          dc_override_active = true;
        } else if (var_idx == 220u) {
          // #133 V220 newton: position-warp + DC basin color. Color
          // helper recomputes one Newton step internally to classify
          // the nearest root for the basin hue.
          dc_rgb_override = var_newton_color(pa_mut, v.z);
          dc_override_active = true;
        } else if (var_idx == 265u) {
          // magnetic_pendulum params: magnets (v.z), radius (v.w).
          dc_rgb_override = var_magnetic_pendulum_color(pa_mut, v.z, v.w);
          dc_override_active = true;
        } else if (var_idx == 310u) {
          // #145 burning_ship escape-band color. cx (v.z), cy (v.w).
          dc_rgb_override = escape_color(pa_mut, 310u, v.z, v.w, 0.0);
          dc_override_active = true;
        } else if (var_idx == 311u) {
          // #145 magnet1 escape-band color. cx (v.z), cy (v.w).
          dc_rgb_override = escape_color(pa_mut, 311u, v.z, v.w, 0.0);
          dc_override_active = true;
        } else if (var_idx == 312u) {
          // #145 nova escape-band color. cx (v.z), cy (v.w), relax (ve.x).
          dc_rgb_override = escape_color(pa_mut, 312u, v.z, v.w, ve.x);
          dc_override_active = true;
        } else if (var_idx == 313u) {
          // #145 halley escape-band color. cx (v.z), cy (v.w).
          dc_rgb_override = escape_color(pa_mut, 313u, v.z, v.w, 0.0);
          dc_override_active = true;
        }
      }
    }

    // PYR3-029 Phase 5b: pv_pre = variation-chain output BEFORE post-affine.
    // Matches flam3's `pyr3_pvx_pre_for_trace` (variations.c:2433-2434).
    let pv_pre = pv;

    // Phase 9c — per-xform post-affine. flam3 variations.c:2412-2418 applies
    // post AFTER the variation chain, before bad-value check. has_post flag
    // (xf.post0.w) gates: 0 = identity / skip, 1 = apply.
    if (xf.post0.w != 0.0) {
      let pp = xf.post0;
      let pq = xf.post1;
      pv = vec2f(
        pp.x * pv.x + pp.y * pv.y + pp.z,
        pq.x * pv.x + pq.y * pv.y + pq.z,
      );
    }

    // Color contraction.
    let new_z = mix(p.z, xf.color_params.x, xf.color_params.y);

    // Bad-value detection — flam3 variations.c:2421-2424 + flam3.c:257-269.
    // On bad: reseed pv to random [-1, 1] AND increment consec_bad. While in the
    // retry window (consec_bad in [1, 4]) we ROLL BACK i (matching flam3's
    // `i -= 4; continue`) so the retry doesn't consume from the walker's iter
    // budget, AND skip the rest of the iter body (finalxform + splat). On the
    // 5th consec bad (consec_bad == 5) we give up: fall through to splat the
    // random reseed and reset consec. Threshold `1e10` matches flam3
    // `private.h:22` `badvalue(x)`.
    let is_bad = any(pv != pv) || any(abs(pv) > vec2f(1e10));
    if (is_bad) {
      // Matches flam3 variations.c:2455-2456 — uses flam3_random_isaac_11
      // (symmetric [-1, 1]). PYR3-029 Phase 5 RNG-transform fix.
      //
      // WGSL §10.3 eval-order guard — captured `let` bindings force flam3's
      // left-to-right ISAAC draw order on the reseed.
      let reseed_x = rand_11(walker_id);
      let reseed_y = rand_11(walker_id);
      pv = vec2f(reseed_x, reseed_y);
      consec_bad = consec_bad + 1u;
    } else {
      consec_bad = 0u;
    }

    // PYR3-029 Phase 5b: per-iter trace emission. Walker 0, first 1000
    // post-fuse iters only. Schema mirrors flam3 -rngtrace stderr format.
    // Note: bad iters that get rolled back still emit a trace entry; the
    // next loop turn re-tries the same `i` with a fresh xform pick. Both
    // engines do this — bad-iter traces are valuable for diagnosing where
    // sequences first diverge.
    if (u.trace_mode == 1u && walker_id == 0u && i >= u.fuse) {
      let post_fuse = i - u.fuse;
      if (post_fuse < 1000u) {
        let base = post_fuse * 16u;
        trace_buffer[base + 0u] = f32(post_fuse);
        trace_buffer[base + 1u] = f32(fn_idx);
        trace_buffer[base + 2u] = pa.x;
        trace_buffer[base + 3u] = pa.y;
        trace_buffer[base + 4u] = pv_pre.x;
        trace_buffer[base + 5u] = pv_pre.y;
        trace_buffer[base + 6u] = pv.x;
        trace_buffer[base + 7u] = pv.y;
        trace_buffer[base + 8u] = select(0.0, 1.0, is_bad);
        trace_buffer[base + 9u] = new_z;
        // Slots 10-15 reserved (could carry color contraction inputs, RNG
        // draw counts, etc. in follow-on iterations).
      }
    }

    // Trajectory continues from pv regardless of bad/good — flam3 sets `p = q`
    // unconditionally at flam3.c:275 (or via i-=4+continue, which means the
    // top of the next iter sees p still at the previous good value while the
    // bad q already overwrote it via flam3.c:261). pyr3 mirrors by writing
    // p_pre_final into p before the retry-continue.
    let p_pre_final = vec3f(pv, new_z);

    // flam3-faithful retry: roll back i (matches flam3.c:262 `i -= 4`) and
    // continue, skipping finalxform AND splat for this iter. The rollback
    // means the walker's iter budget is preserved exactly per flam3 — bad
    // sequences cost nothing to the post-fuse splat count.
    if (consec_bad > 0u && consec_bad < 5u) {
      p = p_pre_final;
      // Underflow-safe rollback: don't decrement past 0. The for-loop's
      // `i = i + 1u` increment then re-advances so net `i` is unchanged.
      if (i > 0u) { i = i - 1u; }
      continue;
    }

    // Past retry window: either good (consec_bad == 0) or give-up
    // (consec_bad == 5). flam3's `lastxf = fn+1` (line 273) only fires here,
    // AFTER the retry-continue branch. pyr3's prev_xform must defer likewise
    // so xaos lookups during retry sequences use the last *accepted* xform.
    if (consec_bad >= 5u) { consec_bad = 0u; }
    prev_xform = i32(fn_idx);

    // Default splat = pre-lens. If finalxform is present, lens it.
    var splat_p = p_pre_final;

    if (u.final_xform_idx >= 0) {
      let fxf = xforms[u.final_xform_idx];

      // finalxform opacity gate.
      // flam3.c:336-337 short-circuits the RNG draw when opacity == 1.0
      // (preserves RNG-determinism on the common opaque case). When the gate
      // fails, splat_p stays at p_pre_final (default at line 1645), so we
      // deposit at the pre-finalxform position — flam3 leaves q[] unchanged
      // when its opacity gate fails (flam3.c:335-341). WGSL `||` is not
      // spec-guaranteed short-circuit; nested-if keeps the rand01 unconsumed
      // when opacity == 1.0.
      var apply_fx: bool;
      if (fxf.color_params.z == 1.0) {
        apply_fx = true;
      } else {
        apply_fx = rand01(walker_id) < fxf.color_params.z;
      }

      if (apply_fx) {
        let fa0 = fxf.affine0;
        let fa1 = fxf.affine1;

        // Affine pre-transform on the pre-lens position.
        let fpa = vec2f(
          fa0.x * pv.x + fa0.y * pv.y + fa0.z,
          fa1.x * pv.x + fa1.y * pv.y + fa1.z,
        );

        // Variation chain — same pre_blur (V=97) 2-pass pattern as the main loop.
        // Defensive clamp on f_num_vars per the same Phase 9b post-mortem
        // hardening as the regular xform path above.
        let f_num_vars = min(u32(fa1.w), MAX_VARS_PER_XFORM);
        var fpa_mut = fpa;
        for (var k = 0u; k < f_num_vars; k = k + 1u) {
          let v = xforms[u.final_xform_idx].vars[k];
          if (u32(v.x) == 97u) {
            let r0 = rand01(walker_id);
            let r1 = rand01(walker_id);
            let r2 = rand01(walker_id);
            let r3 = rand01(walker_id);
            let rndG = v.y * (r0 + r1 + r2 + r3 - 2.0);
            let r4 = rand01(walker_id);
            let rndA = r4 * TAU;
            // Note: v.y (weight) is already folded into rndG; do NOT multiply again here.
            fpa_mut = fpa_mut + vec2f(cos(rndA) * rndG, sin(rndA) * rndG);
          }
        }
        var fpv = vec2f(0.0, 0.0);
        // #114 — DC override on the finalxform. Same mechanism as the
        // main chain (last active DC wins, color computed from the
        // variation's input coord); preempts the main xform's
        // dc_override when set, since the finalxform is the "lens" that
        // colors the splat post-chain.
        for (var k = 0u; k < f_num_vars; k = k + 1u) {
          let v = xforms[u.final_xform_idx].vars[k];
          let ve = xforms[u.final_xform_idx].vars_extra[k];
          let ve2 = xforms[u.final_xform_idx].vars_extra2[k];
          let var_idx = u32(v.x);
          if (var_idx != 97u) {
            fpv = fpv + apply_variation(var_idx, fpa_mut, v.y, v.z, v.w, ve.x, ve.y, ve.z, ve.w, ve2.x, ve2.y, ve2.z, ve2.w, fa0, fa1, walker_id);
          }
          if (fxf.color_params.w > 0.5 && v.y > 0.0) {
            if (var_idx == 99u) {
              dc_rgb_override = var_dc_linear_color(fpa_mut);
              dc_override_active = true;
            } else if (var_idx == 100u) {
              dc_rgb_override = var_dc_perlin_color(fpa_mut, v.z, v.w, ve.x);
              dc_override_active = true;
            } else if (var_idx == 101u) {
              dc_rgb_override = var_dc_gridout_color(fpa_mut, v.z);
              dc_override_active = true;
            } else if (var_idx == 102u) {
              dc_rgb_override = var_dc_cylinder_color(fpa_mut);
              dc_override_active = true;
            } else if (var_idx == 220u) {
              // #133 V220 newton: position-warp + DC basin color
              // (finalxform parallel).
              dc_rgb_override = var_newton_color(fpa_mut, v.z);
              dc_override_active = true;
            } else if (var_idx == 265u) {
              // magnetic_pendulum params: magnets (v.z), radius (v.w).
              dc_rgb_override = var_magnetic_pendulum_color(fpa_mut, v.z, v.w);
              dc_override_active = true;
            }
          }
        }

        // Phase 9c — finalxform may also have a post-affine.
        if (fxf.post0.w != 0.0) {
          let pp = fxf.post0;
          let pq = fxf.post1;
          fpv = vec2f(
            pp.x * fpv.x + pp.y * fpv.y + pp.z,
            pq.x * fpv.x + pq.y * fpv.y + pq.z,
          );
        }

        // Color contraction (finalxform's color/colorSpeed apply to the splat).
        let f_new_z = mix(new_z, fxf.color_params.x, fxf.color_params.y);

        // NaN / extreme guard — fall back to pre-lens splat on bad lens output.
        // Threshold `1e10` matches the main bad-value check above and flam3
        // `private.h:22` `badvalue(x)`.
        if (any(fpv != fpv) || any(abs(fpv) > vec2f(1e10))) {
          splat_p = p_pre_final;
        } else {
          splat_p = vec3f(fpv, f_new_z);
        }
      }
    }

    // Trajectory update — flam3-canonical: continues from pre-lens point.
    //
    // Walker jitter — per-iter sub-ulp perturbation on the trajectory commit
    // (splat coords stay un-jittered; retry/rollback path stays un-jittered).
    // It counteracts an f32 bias: with jitter off, f32 rounding collapses
    // walkers onto near-singular orbits (issue #6 R 24→51).
    //
    // #43 Tier 4: scale-relative amplitude. The perturbation scales with the
    // walker's local coord magnitude — so f32-precision-relative behavior is
    // preserved across the full magnitude range a walker traverses (near-
    // singular passes near origin get a proportionally smaller nudge; outer
    // attractor points get a proportionally larger one). `u.walker_jitter` is
    // now a DIMENSIONLESS proportional factor (NOT an absolute amplitude).
    //
    // History (replaced by scale-relative; kept for git-blame context):
    //   1e-6 abs (R24) → 1e-8 (R17) → 1e-10 (R11) — see #6/#10/#43.
    //   The static-amplitude story bottomed out at a per-class basin near
    //   1e-20 with only a per-fixture win; scale-relative replaces it.
    //
    // Floor on local_mag at 1e-30 keeps walkers near (0,0) from receiving a
    // literally-zero amplitude (which would re-introduce the collapse cliff).
    let local_mag = max(max(abs(p_pre_final.x), abs(p_pre_final.y)), 1e-30);
    let amp = local_mag * u.walker_jitter;
    let jx = (rand01(walker_id) - 0.5) * amp;
    let jy = (rand01(walker_id) - 0.5) * amp;
    p = vec3f(p_pre_final.x + jx, p_pre_final.y + jy, p_pre_final.z);

    if (i >= u.fuse) {
      // PYR3-015: regular-xform alpha-scaling (replaces v0.9-era splat-skip).
      // flam3's per-xform opacity scales the deposit at the histogram bucket
      // — variations.c:2044, 2167 (adjust_percentage). The predecessor tracks the
      // equivalent port as PYR3-035. Splat-skip (the prior stand-in) was
      // sample-noisier but statistically equivalent across the buffer
      // (opacity=0 → no deposit; opacity=0.5 → ½ samples kept). Alpha-scaling
      // matches that by scaling BOTH the rgb channels AND the count (alpha)
      // by `opacity` — making the deposit weight linear in opacity instead
      // of stochastic. opacity=0 → zero deposit (matches splat-skip continue);
      // opacity=1 → full deposit; intermediate values deposit proportionally.
      // Scaling count too is load-bearing: scaling only rgb leaves a
      // "ghost density" at low-opacity samples, contaminating tonemap.
      // The FINALXFORM half of v1.x-C-opacity is handled separately in the
      // finalxform block above (PYR3-009, gates the lens — not the splat).
      let opacity = xf.color_params.z;
      // Phase 9-rotate: apply CCW rotation around (cx, cy) before scale + canvas-center.
      // Matches flam3 rect.c:818-823 matrix [cos, -sin; sin, cos]. cos_r / sin_r are
      // hoisted from u.rotation_rad above the iter loop. rotation_rad=0 → cos=1, sin=0
      // collapses to the unrotated transform.
      let dx = splat_p.x - u.cx;
      let dy = splat_p.y - u.cy;
      let rx = dx * cos_r - dy * sin_r;
      let ry = dx * sin_r + dy * cos_r;
      let px = rx * u.scale + f32(u.width) * 0.5;
      let py = ry * u.scale + f32(u.height) * 0.5;
      let xi = i32(floor(px));
      let yi = i32(floor(py));
      if (xi >= 0 && xi < i32(u.width) && yi >= 0 && yi < i32(u.height)) {
        // Phase 9-bg-palmode: branch palette sampling on u.palette_mode.
        // 'step' = floor index lookup (matches existing pyr3 behavior + flam3
        // default). 'linear' = lerp adjacent palette entries by fractional
        // part. flam3 boundary semantics (rect.c:475-481): when color_index0
        // >= 255, clamp to 254 and frac=1.0 so we lerp 254→255 fully toward 255.
        let cx_f = clamp(splat_p.z, 0.0, 1.0) * PALETTE_LAST_F;
        var pal: vec4f;
        if (u.palette_mode == 1u) {
          var i0 = u32(cx_f);
          var frac = cx_f - f32(i0);
          if (i0 >= PALETTE_LAST_U) {
            i0 = PALETTE_LAST_U - 1u;
            frac = 1.0;
          }
          pal = mix(palette[i0], palette[i0 + 1u], frac);
        } else {
          let pal_idx = min(u32(cx_f), PALETTE_LAST_U);
          pal = palette[pal_idx];
        }
        // #114 — DC (direct-color) override. When this xform's chain
        // contains a DC variation, replace the palette-indexed RGB with
        // the position-computed dc_rgb_override. Alpha (pal.w) keeps the
        // palette's value; only RGB is overridden. dc_override_active is
        // false for every flam3-99-only xform, so the existing render
        // path is unchanged.
        if (dc_override_active) {
          pal = vec4f(dc_rgb_override, pal.w);
        }
        // PYR3-015 alpha-scaling: rgb AND count (alpha) channels scaled by
        // xform opacity. Scaling count too is load-bearing — at opacity=0,
        // depositing count=255 with rgb=0 creates a "ghost density" region
        // that the tonemap reads as legitimate dark pixels (regressed
        // coverage.248.33248 R 4.92 → 8.57 before this fix). Scaling both
        // makes the deposit weight linear in opacity, matching the
        // statistical effect of the v0.9 splat-skip but deterministic.
        // Base unit is 255 per hit (Phase 9-supersample-real / count-units
        // fix matching flam3 rect.c:460-461 `bump_no_overflow(b[0][3], 255.0)`).
        let weight = opacity * 255.0;
        let r_add = u32(pal.x * weight);
        let g_add = u32(pal.y * weight);
        let b_add = u32(pal.z * weight);
        let count_add = u32(weight);
        let base = (u32(yi) * u.width + u32(xi)) * 4u;
        // #18: saturating adds — pin at u32::MAX instead of wrapping (flam3
        // bump_no_overflow). A wrapped count = black hole at the brightest pixel.
        atomic_add_sat(base + 0u, r_add);
        atomic_add_sat(base + 1u, g_add);
        atomic_add_sat(base + 2u, b_add);
        atomic_add_sat(base + 3u, count_add);
      }
    }
  }
}
