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
// Phase 9d: must match MAX_XFORMS in src/genome.ts. Used as the row stride
// of the xaos_buffer (xaos[from][to] = xaos_buffer[from * MAX_XFORMS_U + to]).
const MAX_XFORMS_U: u32 = 32u;

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
  _pad13: u32,
  _pad14: u32,
  _pad15: u32,
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
  color_params: vec4f,       // color, colorSpeed, opacity, _   (Phase 9d: opacity in slot 2)
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
// Phase 9d: row-major MAX_XFORMS × MAX_XFORMS multiplier matrix. Entry
// [from * MAX_XFORMS + to] multiplies xforms[to].weight when previous xform
// pick was `from`. Default 1.0 everywhere when no genome xaos is present.
@group(0) @binding(4) var<storage, read> xaos_buffer: array<f32>;
// ISAAC state, one per walker. Initialized host-side via `packIsaacStates`
// (src/isaac.ts → src/chaos.ts).
@group(0) @binding(5) var<storage, read_write> isaac_states: array<IsaacState>;

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

fn rand01(wi: u32) -> f32 {
  return f32(isaac_irand(wi)) * (1.0 / 4294967296.0);
}

// ---------------------------------------------------------------------
// Variation kernels — order matches V indices in src/variations.ts.
// All take post-affine `p` and weight `w`. Some take extra params or rng.
// ---------------------------------------------------------------------

fn var_linear(p: vec2f, w: f32) -> vec2f {
  return p * w;
}

fn var_sinusoidal(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(sin(p.x), sin(p.y));
}

fn var_spherical(p: vec2f, w: f32) -> vec2f {
  let r2 = dot(p, p) + EPS;
  return p * (w / r2);
}

fn var_swirl(p: vec2f, w: f32) -> vec2f {
  let r2 = dot(p, p);
  let s = sin(r2);
  let c = cos(r2);
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
  return w * r * vec2f(sin(phi + r), cos(phi - r));
}

fn var_heart(p: vec2f, w: f32) -> vec2f {
  let phi = atan2(p.x, p.y);
  let r = length(p);
  return w * r * vec2f(sin(phi * r), -cos(phi * r));
}

fn var_disc(p: vec2f, w: f32) -> vec2f {
  // flam3 var8_disc uses precalc_atan_xy = atan2(tx, ty) — i.e. swapped
  // arg order vs the standard atan2(y, x). This rotates the disc nonlinearity
  // by 90° relative to the standard convention. (variations.c:264, flag set
  // via VAR_DISC → precalc_atan_xy_flag=1.)
  let phi = atan2(p.x, p.y);
  let r = length(p);
  return w * (phi / PI) * vec2f(sin(PI * r), cos(PI * r));
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
  return (w / r) * vec2f(cosa + sin(r), sina - cos(r));
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
  return w * vec2f(sina * cos(r_orig), cosa * sin(r_orig));
}

fn var_ex(p: vec2f, w: f32) -> vec2f {
  // flam3 ex uses precalc_atan_xy = atan2(tx, ty), see top-of-file comment.
  let phi = atan2(p.x, p.y);
  let r = length(p);
  let n0 = sin(phi + r);
  let n1 = cos(phi - r);
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
  return w * r * vec2f(cos(theta), sin(theta));
}

fn var_julian(p: vec2f, w: f32, power: f32, dist: f32, wi: u32) -> vec2f {
  let r = length(p);
  let phi = atan2(p.y, p.x);
  let p_abs = abs(power);
  let n = floor(rand01(wi) * p_abs);
  let theta = (phi + TAU * n) / power;
  let new_r = w * pow(r, dist / power);
  return vec2f(new_r * cos(theta), new_r * sin(theta));
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
    p.x + b * sin(p.y / (c * c + EPS)),
    p.y + e * sin(p.x / (f * f + EPS)),
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
    p.x + c * sin(tan(3.0 * p.y)),
    p.y + f * sin(tan(3.0 * p.x)),
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
// new_x = w*sin(tx), new_y = w*ty. No singularities.
fn var_cylinder(p: vec2f, w: f32) -> vec2f {
  return vec2f(w * sin(p.x), w * p.y);
}

// var_pdj — flam3 var24_pdj (variations.c:579-596). Pure: no rng, no atan2,
// no affine. Four params (pdj_a/b/c/d) — the first variation to consume
// pyr3's extended param seam (param2/param3 in addition to param0/param1
// via vars_extra). flam3 kernel verbatim:
//   nx1 = cos(pdj_b * tx); nx2 = sin(pdj_c * tx);
//   ny1 = sin(pdj_a * ty); ny2 = cos(pdj_d * ty);
//   out = w * (ny1 - nx1, nx2 - ny2)
fn var_pdj(p: vec2f, w: f32, pa: f32, pb: f32, pc: f32, pd: f32) -> vec2f {
  let nx1 = cos(pb * p.x);
  let nx2 = sin(pc * p.x);
  let ny1 = sin(pa * p.y);
  let ny2 = cos(pd * p.y);
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
  var cosadd = cos(twist) - 1.0;
  var sinadd = sin(twist);
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
  let sinr = sin(t);
  let cosr = cos(t);
  let r = (w * atan2(p.x, p.y)) / PI;
  return vec2f((sinr + cosadd) * r, (cosr + sinadd) * r);
}

// ---------------------------------------------------------------------
// Phase 9b Batch A — pure 0-param kernels (no rng, no affine reads).
// Each kernel mirrors the same-named ts_var_* in src/variations.ts.
// ---------------------------------------------------------------------

// var_exponential — flam3 var18_exponential (variations.c:452). No precalc flag.
//   dx = w * exp(tx - 1);  dy = PI * ty;  out = dx * (cos(dy), sin(dy))
// exp(tx-1) is unbounded as tx grows; for tx ≳ 24 the output exceeds the 1e10
// bad-value threshold and the chaos-game retry path reseeds — matches flam3.
fn var_exponential(p: vec2f, w: f32) -> vec2f {
  let dx = w * exp(p.x - 1.0);
  let dy = PI * p.y;
  return vec2f(dx * cos(dy), dx * sin(dy));
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
//   out = w * (cos(PI*tx) * cosh(ty), -sin(PI*tx) * sinh(ty))
fn var_cosine(p: vec2f, w: f32) -> vec2f {
  let a = p.x * PI;
  return w * vec2f(cos(a) * cosh(p.y), -sin(a) * sinh(p.y));
}

// var_tangent — flam3 var42_tangent (variations.c:885). No precalc flag.
//   out = w * (sin(tx) / cos(ty), tan(ty))
// cos(ty) ≈ 0 yields ±Inf; the chaos-game bad-value check reseeds — matches flam3.
fn var_tangent(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(sin(p.x) / cos(p.y), tan(p.y));
}

// var_secant2 — flam3 var46_secant2 (variations.c:976). Uses precalc_sqrt only.
// Non-standard weight handling per flam3 comment: weight is BOTH folded into r
// (= w * length(p)) before cos AND multiplied onto the output. cos(r) ≈ 0 at
// r = π/2 + kπ yields ±Inf which the chaos-game bad-value check reseeds —
// matches flam3 (flam3 also does not guard this).
fn var_secant2(p: vec2f, w: f32) -> vec2f {
  let r = w * length(p);
  let cr = cos(r);
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
// Mod semantics match pyr3 chaos.comp:819 — GLSL `mod()` is Euclidean
// (`a - b * floor(a/b)`), NOT C's truncate-toward-zero `fmod`. For negative
// `(phi + dy)` the two diverge in sign, sending walkers to different folded
// angles. pyr3 GLSL's documented divergence from C-fmod is what produced the
// v1.0 reference renders; mirror it here per parity-default rule.
fn var_fan(p: vec2f, w: f32, a0: vec4f, a1: vec4f) -> vec2f {
  let c = a0.z;
  let f = a1.z;
  let dx = PI * (c * c + EPS);
  let dy = f;
  let dx2 = 0.5 * dx;
  let phi = atan2(p.x, p.y);
  let r = w * length(p);
  let t = (phi + dy) - dx * floor((phi + dy) / dx);
  let a = select(phi + dx2, phi - dx2, t > dx2);
  return vec2f(r * cos(a), r * sin(a));
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
  return vec2f(r * sin(a), r * cos(a));
}

// var_perspective — flam3 var30_perspective (variations.c:687). 2 params
// (perspective_angle, perspective_dist). flam3 precomputes `persp_vsin`
// and `persp_vfcos` per-xform; pyr3 inlines (no per-xform precalc hook —
// disc2 precedent). Per-iter cost is one sin + one cos, dwarfed by the
// kernel's own div + the chaos loop's overall trig cost.
fn var_perspective(p: vec2f, w: f32, angle: f32, dist: f32) -> vec2f {
  let half_pi_angle = angle * (PI * 0.5);
  let vsin = sin(half_pi_angle);
  let vfcos = dist * cos(half_pi_angle);
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
  let r = r0 * (low + (high - low) * (0.5 + 0.5 * sin(waves * a)));
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
  let amp = (corners * (1.0 / (cos(phi) + EPS) - 1.0) + circle) / (r_factor + EPS);
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
  return vec2f(r * cos(a), r * sin(a));
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
// At p=0: sumsq=0 → lnr=-Inf → ang=±Inf (when vd≠0) → sin/cos(±Inf)=NaN; or
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
  return vec2f(m * cos(ang), m * sin(ang));
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
//   tmpr = rand0 * 2π;  r = w * rand1;  out = (tx, ty) * r * (cos(tmpr), sin(tmpr))
fn var_noise(p: vec2f, w: f32, wi: u32) -> vec2f {
  let tmpr = rand01(wi) * TAU;
  let r = w * rand01(wi);
  return vec2f(p.x * r * cos(tmpr), p.y * r * sin(tmpr));
}

// var_blur — flam3 var34_blur (variations.c:746). 0 params + 2 rand calls.
// Like noise but output is just (r*cos, r*sin) — uniform disc of radius w.
fn var_blur(p: vec2f, w: f32, wi: u32) -> vec2f {
  let tmpr = rand01(wi) * TAU;
  let r = w * rand01(wi);
  return vec2f(r * cos(tmpr), r * sin(tmpr));
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
  return vec2f(r * cos(ang), r * sin(ang));
}

// var_arch — flam3 var41_arch (variations.c:857). 0 params + 1 rand call.
// Non-standard weight handling (flam3 comment). cos(ang) ≈ 0 produces ±Inf
// which the chaos-game retry path reseeds — matches flam3.
fn var_arch(p: vec2f, w: f32, wi: u32) -> vec2f {
  let ang = rand01(wi) * w * PI;
  let sinr = sin(ang);
  let cosr = cos(ang);
  return vec2f(w * sinr, w * (sinr * sinr) / cosr);
}

// var_radial_blur — flam3 var36_radial_blur (variations.c:775). 1 param
// (radial_blur_angle) + 4 rand calls. flam3 precomputes
// `radialBlur_spinvar = sin(angle * π/2)` and `radialBlur_zoomvar = cos(angle * π/2)`
// per-xform; pyr3 inlines (disc2 / perspective precedent).
//
// Same WGSL eval-order guard as gaussian_blur — captured `let` bindings
// force left-to-right ISAAC stream order.
fn var_radial_blur(p: vec2f, w: f32, angle: f32, wi: u32) -> vec2f {
  let half_pi_angle = angle * (PI * 0.5);
  let spinvar = sin(half_pi_angle);
  let zoomvar = cos(half_pi_angle);
  let r0 = rand01(wi);
  let r1 = rand01(wi);
  let r2 = rand01(wi);
  let r3 = rand01(wi);
  let rndG = w * (r0 + r1 + r2 + r3 - 2.0);
  let ra = length(p);
  let tmpa = atan2(p.y, p.x) + spinvar * rndG;
  let sa = sin(tmpa);
  let ca = cos(tmpa);
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
  return vec2f(r * cos(tmpr), r * sin(tmpr));
}

// var_square — flam3 var43_square (variations.c:900). 0 params + 2 rand calls.
// Generates a point in [-w/2, w/2]² independent of input position.
fn var_square(p: vec2f, w: f32, wi: u32) -> vec2f {
  return vec2f(w * (rand01(wi) - 0.5), w * (rand01(wi) - 0.5));
}

// var_rays — flam3 var44_rays (variations.c:915). 0 params + 1 rand call.
// Non-standard weight handling.
fn var_rays(p: vec2f, w: f32, wi: u32) -> vec2f {
  let ang = w * rand01(wi) * PI;
  let sumsq = dot(p, p);
  let r = w / (sumsq + EPS);
  let tanr = w * tan(ang) * r;
  return vec2f(tanr * cos(p.x), tanr * sin(p.y));
}

// var_blade — flam3 var45_blade (variations.c:946). 0 params + 1 rand call.
// Non-standard weight handling. Both x and y output use `p.x` (not `p.y`) —
// that's flam3's actual behavior at lines 971-972, not a typo.
fn var_blade(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r = rand01(wi) * w * length(p);
  let sinr = sin(r);
  let cosr = cos(r);
  return vec2f(w * p.x * (cosr + sinr), w * p.x * (cosr - sinr));
}

// var_twintrian — flam3 var47_twintrian (variations.c:998). 0 params + 1
// rand call. log10(sin²) can be -Inf; flam3's own badvalue check clamps
// `diff = -30` (variations.c:1025-1026) — pyr3 mirrors that clamp. Both x
// and y output use `p.x` (intentional per flam3).
fn var_twintrian(p: vec2f, w: f32, wi: u32) -> vec2f {
  let r = rand01(wi) * w * length(p);
  let sinr = sin(r);
  let cosr = cos(r);
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
  return w * e * vec2f(cos(p.y), sin(p.y));
}

fn var_log(p: vec2f, w: f32) -> vec2f {
  let sumsq = dot(p, p);
  return w * vec2f(0.5 * log(sumsq), atan2(p.y, p.x));
}

fn var_sin(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(sin(p.x) * cosh(p.y), cos(p.x) * sinh(p.y));
}

fn var_cos(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(cos(p.x) * cosh(p.y), -sin(p.x) * sinh(p.y));
}

fn var_tan(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (cos(2.0 * p.x) + cosh(2.0 * p.y));
  return w * den * vec2f(sin(2.0 * p.x), sinh(2.0 * p.y));
}

fn var_sec(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (cos(2.0 * p.x) + cosh(2.0 * p.y));
  return w * den * vec2f(cos(p.x) * cosh(p.y), sin(p.x) * sinh(p.y));
}

fn var_csc(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (cosh(2.0 * p.y) - cos(2.0 * p.x));
  return w * den * vec2f(sin(p.x) * cosh(p.y), -cos(p.x) * sinh(p.y));
}

fn var_cot(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (cosh(2.0 * p.y) - cos(2.0 * p.x));
  return w * den * vec2f(sin(2.0 * p.x), -sinh(2.0 * p.y));
}

fn var_sinh(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(sinh(p.x) * cos(p.y), cosh(p.x) * sin(p.y));
}

fn var_cosh(p: vec2f, w: f32) -> vec2f {
  return w * vec2f(cosh(p.x) * cos(p.y), sinh(p.x) * sin(p.y));
}

fn var_tanh(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (cos(2.0 * p.y) + cosh(2.0 * p.x));
  return w * den * vec2f(sinh(2.0 * p.x), sin(2.0 * p.y));
}

fn var_sech(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (cos(2.0 * p.y) + cosh(2.0 * p.x));
  return w * den * vec2f(cos(p.y) * cosh(p.x), -sin(p.y) * sinh(p.x));
}

fn var_csch(p: vec2f, w: f32) -> vec2f {
  let den = 2.0 / (cosh(2.0 * p.x) - cos(2.0 * p.y));
  return w * den * vec2f(sinh(p.x) * cos(p.y), -cosh(p.x) * sin(p.y));
}

fn var_coth(p: vec2f, w: f32) -> vec2f {
  let den = 1.0 / (cosh(2.0 * p.x) - cos(2.0 * p.y));
  return w * den * vec2f(sinh(2.0 * p.x), sin(2.0 * p.y));
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
  let csv = cos(a1);
  let snv = select(sin(a1), -sin(a1), p.y > 0.0);
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
  let tmp = w / (expx + expnx - cos(p.y));
  return vec2f(tmp * (expx - expnx), tmp * sin(p.y));
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
  let seb = sin(beta);
  let ceb = cos(beta);
  let vc = 0.5 * (1.0 + ceb);
  let vd = 0.5 * seb;
  let m = w * exp(vc * lnr - vd * a);
  let n = vc * a + vd * lnr;
  return vec2f(m * cos(n), m * sin(n));
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
// Note flam3's swap: output y reads cos(tx*xsize*π), output x reads cos(ty*ysize*π).
fn var_split(p: vec2f, w: f32, xs: f32, ys: f32) -> vec2f {
  let outY = select(-w * p.y, w * p.y, cos(p.x * xs * PI) >= 0.0);
  let outX = select(-w * p.x, w * p.x, cos(p.y * ys * PI) >= 0.0);
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
  return vec2f(w * r * cos(a), w * r * sin(a));
}

// var_flux — flam3 var97_flux (variations.c:1911). 1 param (flux_spread).
// Double-sqrt + atan2-difference.
fn var_flux(p: vec2f, w: f32, spread: f32) -> vec2f {
  let xpw = p.x + w;
  let xmw = p.x - w;
  let tysq = p.y * p.y;
  let avgr = w * (2.0 + spread) * sqrt(sqrt(tysq + xpw * xpw) / sqrt(tysq + xmw * xmw));
  let avga = (atan2(p.y, xmw) - atan2(p.y, xpw)) * 0.5;
  return vec2f(avgr * cos(avga), avgr * sin(avga));
}


// ---------------------------------------------------------------------
// Phase 9b Batch H — 3-4-param non-RNG kernels.
// ---------------------------------------------------------------------

fn var_popcorn2(p: vec2f, w: f32, px: f32, py: f32, pc: f32) -> vec2f {
  return w * vec2f(
    p.x + px * sin(tan(p.y * pc)),
    p.y + py * sin(tan(p.x * pc)),
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
    return vec2f(r * cos(a) + lx, r * sin(a) - ly);
  }
  let r = w * (1.0 + space / r0);
  return vec2f(r * x + lx, r * y - ly);
}

fn var_waves2(p: vec2f, w: f32, sx: f32, fx: f32, sy: f32, fy: f32) -> vec2f {
  return w * vec2f(p.x + sx * sin(p.y * fx), p.y + sy * sin(p.x * fy));
}

// flam3 uses `p1 -=` inside the envelope (|ty|<=t).
fn var_oscope(p: vec2f, w: f32, freq: f32, amp: f32, damping: f32, sep: f32) -> vec2f {
  let tpf = TAU * freq;
  let t = select(
    amp * exp(-abs(p.x) * damping) * cos(tpf * p.x) + sep,
    amp * cos(tpf * p.x) + sep,
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
  let s = sin(freq * p.x);
  let t = sin(freq * p.y);
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
  return vec2f(r * cos(a), r * sin(a));
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
  let st = sin(theta);
  let ct = cos(theta);
  let t1 = pow(abs(ct), n2);
  let t2 = pow(abs(st), n3);
  let r = w * ((rnd * rand01(wi) + (1.0 - rnd) * r0) - holes) * pow(t1 + t2, pneg1_n1) / r0;
  return r * p;
}

// flower — flam3 var51_flower (variations.c:1118). 2 params + RNG.
fn var_flower(p: vec2f, w: f32, petals: f32, holes: f32, wi: u32) -> vec2f {
  let theta = atan2(p.y, p.x);
  let r0 = length(p);
  let r = w * (rand01(wi) - holes) * cos(petals * theta) / r0;
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
  let sr = sin(r);
  let cr = cos(r);
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
  return vec2f(r * cos(a), r * sin(a));
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
  return vec2f(r * cos(a), r * sin(a));
}

// ---------------------------------------------------------------------
// Variation dispatcher — runtime switch over 99 indices (V=0..98).
// V=97 (pre_blur) is handled pre-switch in the 2-pass variation chain
// loop and intentionally has NO `case 97u` entry — falls through to
// default → (0,0) so it contributes nothing to pv.
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
    default:  { return vec2f(0.0, 0.0); }
  }
}

@compute @workgroup_size(64)
fn chaos_main(@builtin(global_invocation_id) gid: vec3u) {
  let walker_id = gid.x;

  // Per-walker ISAAC state is in `isaac_states[walker_id]` (storage). Pre-initialized
  // host-side via `packIsaacStates()` (src/isaac.ts → src/chaos.ts). The
  // legacy PCG32 per-walker `var rng: u32` warm-up is gone.

  // Walker state = (x, y, color). Initial pos uniform in [-1, 1]^2; color in [0, 1].
  var p = vec3f(
    rand01(walker_id) * 2.0 - 1.0,
    rand01(walker_id) * 2.0 - 1.0,
    rand01(walker_id),
  );

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
    // Phase 9d: pick xform by cumulative `weight × xaos[prev][curr]`. When
    // prev_xform < 0 (first iter), use_xaos is false → multiplier 1.0 → reduces
    // to plain weighted pick. Cache the multipliers in a function-local array
    // so the pick-scan doesn't re-read xaos_buffer (halves storage traffic).
    let use_xaos = prev_xform >= 0;
    let xaos_row_base = u32(max(prev_xform, 0i)) * MAX_XFORMS_U;
    var mults: array<f32, 32>;
    var pick_total: f32 = 0.0;
    for (var j = 0u; j < u.num_xforms; j = j + 1u) {
      let mult = select(1.0, xaos_buffer[xaos_row_base + j], use_xaos);
      mults[j] = mult;
      pick_total = pick_total + xforms[j].affine0.w * mult;
    }
    let r = rand01(walker_id) * pick_total;
    var fn_idx: u32 = u.num_xforms - 1u;
    var acc: f32 = 0.0;
    for (var j = 0u; j < u.num_xforms; j = j + 1u) {
      acc = acc + xforms[j].affine0.w * mults[j];
      if (r < acc) {
        fn_idx = j;
        break;
      }
    }
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
    for (var k = 0u; k < num_vars; k = k + 1u) {
      let v = xforms[fn_idx].vars[k];
      let ve = xforms[fn_idx].vars_extra[k];
      let ve2 = xforms[fn_idx].vars_extra2[k];
      let var_idx = u32(v.x);
      if (var_idx != 97u) {
        pv = pv + apply_variation(var_idx, pa_mut, v.y, v.z, v.w, ve.x, ve.y, ve.z, ve.w, ve2.x, ve2.y, a0, a1, walker_id);
      }
    }

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
      pv = vec2f(rand01(walker_id) * 2.0 - 1.0, rand01(walker_id) * 2.0 - 1.0);
      consec_bad = consec_bad + 1u;
    } else {
      consec_bad = 0u;
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
      for (var k = 0u; k < f_num_vars; k = k + 1u) {
        let v = xforms[u.final_xform_idx].vars[k];
        let ve = xforms[u.final_xform_idx].vars_extra[k];
        let ve2 = xforms[u.final_xform_idx].vars_extra2[k];
        let var_idx = u32(v.x);
        if (var_idx != 97u) {
          fpv = fpv + apply_variation(var_idx, fpa_mut, v.y, v.z, v.w, ve.x, ve.y, ve.z, ve.w, ve2.x, ve2.y, fa0, fa1, walker_id);
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

    // Trajectory update — flam3-canonical: continues from pre-lens point.
    //
    // v0.36-H walker jitter (port from pyr3 chaos.comp:2580-2599):
    // ±5e-7 per-iter sub-ulp perturbation on the trajectory commit.
    // Recovers attractor concentration on f32-precision-sensitive
    // genomes — without it, walkers either get trapped in low-density
    // regions OR escape attractors prematurely, both reading as
    // "samples spread too uniformly." Splat coords stay un-jittered
    // (splat_p above); the jitter only affects trajectory continuation.
    // Retry path at the rollback gate intentionally stays un-jittered
    // to match pyr3 chaos.comp:2553-2557. See
    // docs/render-divergence-investigation.md.
    let jx = (rand01(walker_id) - 0.5) * 1e-6;
    let jy = (rand01(walker_id) - 0.5) * 1e-6;
    p = vec3f(p_pre_final.x + jx, p_pre_final.y + jy, p_pre_final.z);

    if (i >= u.fuse) {
      // Phase 9d: probabilistic splat skip per opacity. Trajectory has already
      // been updated above; only the visual contribution is gated. Nested if
      // guarantees rand01 isn't called when opacity == 1.0 (WGSL `&&` is not
      // spec-guaranteed short-circuit, so a single-line guard could leak RNG
      // state advance into the opaque case).
      let opacity = xf.color_params.z;
      if (opacity < 1.0) {
        if (rand01(walker_id) >= opacity) {
          continue;
        }
      }
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
        let r_add = u32(pal.x * 255.0);
        let g_add = u32(pal.y * 255.0);
        let b_add = u32(pal.z * 255.0);
        let base = (u32(yi) * u.width + u32(xi)) * 4u;
        atomicAdd(&hist[base + 0u], r_add);
        atomicAdd(&hist[base + 1u], g_add);
        atomicAdd(&hist[base + 2u], b_add);
        // Phase 9-supersample-real (count-units fix): bump count by 255 per hit
        // to match flam3 rect.c:460-461 (`bump_no_overflow(b[0][3], 255.0)`).
        // pyr3 previously bumped by 1, putting tmp = count/255 deep in the
        // alpha-curve linrange branch on hot pixels where flam3 lands in the
        // pure-gamma branch with alpha clamped to 1.0. The ×255 alignment
        // shifts the alpha-curve regime to match flam3's, fixing the
        // grey-cyan vs vivid-teal saturation gap on imported flames.
        atomicAdd(&hist[base + 3u], 255u);
      }
    }
  }
}
