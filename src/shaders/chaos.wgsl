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
//   vars[k]       = (index_as_f32, weight, param0, param1)
//   vars_extra[k] = (param2, param3, param4, param5)
// Both are MAX_VARIATIONS_PER_XFORM long (currently 8). Phase 9b grew the
// per-variation param seam from 2 → 6 to unlock multi-param variations
// (pdj=4, blob=3, ngon=4, wedge=4, cpow=3, …). The pack layout in
// src/genome.ts emits these in lockstep — bumping MAX_VARIATIONS_PER_XFORM
// requires updating BOTH `8`s here AND src/genome.ts XFORM_FLOATS together.
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
  vars_extra2: array<vec4f, 8>,  // param6, param7, _, _            (Phase 9b Batch K)
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
  let sins = safe_sin(star * PI * 0.5);
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

// var_bwraps — bubble-wrap lattice (Apophysis 7X / community plugin pack;
// porting tradition: JWildfire BWraps2Func.java). 5 params:
// cellsize / space / gain / inner_twist / outer_twist. Inside each
// hash-spaced bubble the point gets pulled toward the bubble center with
// a hyperbolic gain + a radius-dependent twist; outside, passes through.
fn var_bwraps(
  p: vec2f, w: f32,
  cellsize: f32, space: f32, gain: f32,
  inner_twist: f32, outer_twist: f32,
) -> vec2f {
  if (abs(cellsize) < 1.0e-30) { return vec2f(w * p.x, w * p.y); }
  let radius = 0.5 * (cellsize / (1.0 + space * space));
  let g2 = gain * gain / max(radius * radius, 1.0e-30) + 1.0e-30;
  let r2 = radius * radius;
  // Cell coordinates (each cell of size `cellsize`).
  let xx = p.x / cellsize;
  let yy = p.y / cellsize;
  let cx = (floor(xx) + 0.5) * cellsize;
  let cy = (floor(yy) + 0.5) * cellsize;
  let lx = p.x - cx;
  let ly = p.y - cy;
  // Outside the inner bubble → unchanged.
  if ((lx * lx + ly * ly) > r2) { return vec2f(w * p.x, w * p.y); }
  // Inside → hyperbolic pull toward (cx,cy) + radius-dependent twist.
  let denom = lx * lx + ly * ly + 1.0;
  let s = g2 / denom;
  let sx = lx * s;
  let sy = ly * s;
  let r_frac = (sx * sx + sy * sy) / max(r2, 1.0e-30);
  let theta = inner_twist * (1.0 - r_frac) + outer_twist * r_frac;
  let st = safe_sin(theta);
  let ct = safe_cos(theta);
  return vec2f(
    w * (cx + (sx * ct + sy * st)),
    w * (cy + (-sx * st + sy * ct)),
  );
}

// var_crackle — Voronoi-cell scatter (Neil Slater / "slobo777").
// 4 params (cellsize / power / distort / scale): jumps each iterate to
// the nearest Worley feature point, with a distance-power-weighted
// distort blend back toward the original input. Produces the
// crystalline / cracked-tile look that JWildfire flames are known for.
fn var_crackle(
  p: vec2f, w: f32,
  cellsize: f32, power: f32, distort: f32, scale: f32,
) -> vec2f {
  let cs = max(abs(cellsize), 1.0e-6);
  let scaled = vec2f(p.x / cs, p.y / cs);
  let wo = worley2d_F1(scaled);
  let feat_x = wo.z * cs;
  let feat_y = wo.w * cs;
  // Distort factor: pow(F1, power) gives near-zero at cell boundaries
  // (the "crack") and grows toward 1 near the feature center.
  let d_scale = pow(wo.x + 1.0e-6, power) * distort;
  let out_x = feat_x + (p.x - feat_x) * d_scale;
  let out_y = feat_y + (p.y - feat_y) * d_scale;
  return vec2f(w * scale * out_x, w * scale * out_y);
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
    // radial: rotate around (x0,y0) by a distance-weighted random angle
    let phi = atan2(dy, dx) + mul_y * d * r1;
    let r_in = sqrt(dx * dx + dy * dy);
    let rr = r_in + mul_x * r0 * d;
    return vec2f(
      w * (x0 + rr * safe_cos(phi)),
      w * (y0 + rr * safe_sin(phi)),
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
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
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
  let im = c3 * x2 * y - c3 * y3 + cc2 * x * y + c1 * y;
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
  let r_pow = pow(inx * inx + iny * iny, cN);
  return vec2f(w * r_pow * safe_cos(angle), w * r_pow * safe_sin(angle));
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
// The kernel needs two distinct rand01 samples. We derive them from
// `wi` and (wi ^ 0xA5A5A5A5u) — the same pattern used in other
// 2-sample kernels (no module-scope salt const that extractWgslFn
// would skip).
fn var_blur_circle(p: vec2f, w: f32, hole: f32, wi: u32) -> vec2f {
  let r0 = rand01(wi);
  let r1 = rand01(wi ^ 0xA5A5A5A5u);
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
// Variation dispatcher — runtime switch over indices.
// V=97 (pre_blur) is handled pre-switch in the 2-pass variation chain
// loop and intentionally has NO `case 97u` entry — falls through to
// default → (0,0) so it contributes nothing to pv.
// V=99..102 (DC variations) — most return (0,0) position (color-only);
// dc_cylinder (102) warps position like the original cylinder. Color is
// computed in the chain loop via the var_dc_*_color helpers above when
// xf.color_params.w (dc_flag) is set.
// p0/p1 come from xf.vars[k].zw; p2..p5 come from xf.vars_extra[k];
// p6/p7 come from xf.vars_extra2[k].xy (Phase 9b Batch K seam extension).
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
    case 108u: { return var_crackle(p, w, p0, p1, p2, p3); }
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
        pv = pv + apply_variation(var_idx, pa_mut, v.y, v.z, v.w, ve.x, ve.y, ve.z, ve.w, ve2.x, ve2.y, a0, a1, walker_id);
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
            fpv = fpv + apply_variation(var_idx, fpa_mut, v.y, v.z, v.w, ve.x, ve.y, ve.z, ve.w, ve2.x, ve2.y, fa0, fa1, walker_id);
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
