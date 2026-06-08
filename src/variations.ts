// Variation registry for pyr3.
//
// Each variation has a stable numeric INDEX matching the WGSL switch
// dispatcher in `src/shaders/chaos.wgsl`. As of 2026-06-07 the catalog
// holds V0..V219 (220 entries) — flam3 originals + DC family + Apophysis
// plugin pack + JWildfire 2D long tail (V152..V213 from #121, V214..V219
// from #170 sibling-pair completions).
//
// Adding a variation = (1) add an entry to V, (2) add a `var_X` kernel
// in chaos.wgsl, (3) add a switch case in `apply_variation`. The genome
// data shape (the seam) is stable; only the dispatcher table grows.
//
// Pre-V130 entries had paired TypeScript reference implementations for
// f64-oracle parity testing; that convention was retired from V131
// onward in favor of in-file GPU smoke tests (extractWgslFn against a
// thin TS oracle defined inside the .gpu.test.ts file). Reading
// post-V130 sources, expect kernel WGSL + a sibling .gpu.test.ts file,
// not a reference impl module.

export const V = {
  linear: 0,
  sinusoidal: 1,
  spherical: 2,
  swirl: 3,
  horseshoe: 4,
  polar: 5,
  handkerchief: 6,
  heart: 7,
  disc: 8,
  spiral: 9,
  hyperbolic: 10,
  diamond: 11,
  ex: 12,
  julia: 13,
  julian: 14,
  bent: 15,
  waves: 16,
  fisheye: 17,
  popcorn: 18,
  eyefish: 19,
  bubble: 20,
  cylinder: 21,
  disc2: 22,
  pdj: 23,
  // Phase 9b Batch A — pure 0-param kernels (no rng, no affine, no precalc).
  // Order matches flam3 numbering (V18/V19/V20/V42/V46/V48) but pyr3 indices
  // are dense 24..29.
  exponential: 24,
  power: 25,
  cosine: 26,
  tangent: 27,
  secant2: 28,
  cross: 29,
  // Phase 9b Batch B — 1-2 param kernels, no rng. rings/fan read affine c/f
  // (same shape as waves/popcorn). All fit existing 2-param seam — no
  // vars_extra needed. Order: rings/fan (no params), rings2/fan2 (param-based),
  // perspective (inline precalc), bipolar/curl/rectangles.
  rings: 30,
  fan: 31,
  rings2: 32,
  fan2: 33,
  perspective: 34,
  bipolar: 35,
  curl: 36,
  rectangles: 37,
  // Phase 9b Batch C — 3-4 param kernels, all consume vars_extra. cpow uses
  // RNG (same shape as julian). ngon uses precalc_atanyx (STANDARD atan2(ty,tx))
  // — different convention from blob/wedge which use precalc_atan_xy (swapped).
  blob: 38,
  ngon: 39,
  wedge: 40,
  cpow: 41,
  curve: 42,
  // Phase 9b Batch D — RNG-using kernels. juliascope uses discrete branch
  // (testable via runMultiBranchRng like julian/cpow). The rest use continuous
  // rand values and skip per-row TS-vs-flam3 parity (see test file for the
  // gap rationale + BACKLOG entry for the proper rand-capture infra).
  // radial_blur inlines precalc (sin/cos of angle*π/2) per disc2 precedent.
  noise: 43,
  blur: 44,
  gaussian_blur: 45,
  arch: 46,
  radial_blur: 47,
  juliascope: 48,
  square: 49,
  rays: 50,
  blade: 51,
  twintrian: 52,
  // Phase 9b Batch E — transcendental function kernels (flam3 var82..95).
  // All 0-param, no RNG, no affine reads. Mostly pure sin/cos/sinh/cosh
  // combinations. log uses precalc_atanyx + precalc_sumsq. NOTE the name
  // collision possibility: pyr3 already has `sinusoidal` (V=1) / `cosine`
  // (V=26) / `tangent` (V=27) / `exponential` (V=24) — these new `exp`/
  // `sin`/`cos`/`tan` are SEPARATE flam3 variations with different kernel
  // math (`exp(tx) * (cos(ty), sin(ty))` vs exponential's `exp(tx-1) * ...`).
  exp: 53,
  log: 54,
  sin: 55,
  cos: 56,
  tan: 57,
  sec: 58,
  csc: 59,
  cot: 60,
  sinh: 61,
  cosh: 62,
  tanh: 63,
  sech: 64,
  csch: 65,
  coth: 66,
  // Phase 9b Batch F — 0-param non-RNG kernels (flam3 var57/61/62/64/66/70/72).
  butterfly: 67,
  edisc: 68,
  elliptic: 69,
  foci: 70,
  loonie: 71,
  polar2: 72,
  scry: 73,
  // Phase 9b Batch G — 1-2 param non-RNG kernels (flam3 var54/58/63/68/74-76/80/97).
  bent2: 74,
  cell: 75,
  escher: 76,
  modulus: 77,
  split: 78,
  splits: 79,
  stripes: 80,
  whorl: 81,
  flux: 82,
  // Phase 9b Batch H — 3-4-param non-RNG kernels (flam3 var65/69/71/73/79/81/96).
  popcorn2: 83,
  lazysusan: 84,
  waves2: 85,
  oscilloscope: 86,
  separation: 87,
  auger: 88,
  wedge_sph: 89,
  // Phase 9b Batch I — RNG-using 3-4 param kernels (flam3 var37/50-53/56/78).
  super_shape: 90,
  flower: 91,
  conic: 92,
  parabola: 93,
  pie: 94,
  boarders: 95,
  wedge_julia: 96,
  // Phase 9b Batch J — pre_blur (var67). Structural: mutates pa BEFORE chain.
  pre_blur: 97,
  // Phase 9b Batch K — mobius (var98, 8 params). Drove the seam extension
  // 6 → 8 (new vars_extra2 slot).
  mobius: 98,
  // #114 — DC (direct-color) variations. These override the per-scatter
  // histogram RGB with a position-computed color instead of looking up
  // palette[color_index]. Detection is per-xform via the dc_flag slot
  // baked at pack time (genome.ts) and read by chaos.wgsl. Origin: Neil
  // Slater's Apophysis 7X plugin pack; JWildfire signature feature.
  dc_linear: 99,
  dc_perlin: 100,
  dc_gridout: 101,
  dc_cylinder: 102,
  // #114 batch 1 (post-flam3 plugin pack) — three numbered-variant siblings
  // of existing pyr3 vars + epispiral. Sources: JWildfire (LGPL-2.1+).
  // cpow2/cpow3 = Peter Sdobnov ("Zueuk"); loonie2 = dark-beam;
  // epispiral = cyberxaos / Apophysis 7X.15C. All 3–4 params, no new
  // packing infra needed — same seam as #117 DC family.
  cpow2: 103,
  cpow3: 104,
  loonie2: 105,
  epispiral: 106,
  // #114 batch 2a — Worley/Voronoi cellular family. One WGSL helper
  // (worley2d_F1) unlocks the cellular long-tail; bwraps + crackle are
  // the first two consumers. Reference: Apophysis 7X plugin pack /
  // JWildfire BWraps2Func + CrackleFunc (LGPL-2.1+, see NOTICE.md).
  bwraps: 107,
  crackle: 108,
  // #114 batch 2b-a — JWildfire S-tier first half. Six well-loved
  // community variations from JWildfire's plugin pack (LGPL-2.1+,
  // see NOTICE.md). juliaq/glynnia/loonie3 are 0–2 param mathematical
  // siblings of existing pyr3 vars; the falloff trio (falloff =
  // Falloff2-type0 / falloff2 = full Falloff2Func / falloff3 =
  // AbstractFalloff3Func gaussian-circle path) are RNG-driven 2D-only
  // ports — Z-axis params and the rarely-used invert/mul_c/blur-type-
  // shape selectors dropped to fit the 8-slot seam.
  juliaq: 109,
  glynnia: 110,
  loonie3: 111,
  falloff: 112,
  falloff2: 113,
  falloff3: 114,
  // #114 batch 2b-b — S-tier kaleidoscope / circle family. Five
  // well-loved JWildfire variations (LGPL-2.1+, see NOTICE.md):
  // collideoscope (Michael Faber kaleidoscope-collide),
  // circlize + circlize2 (Michael Faber square→circle perimeter map),
  // eswirl (Michael Faber extended-swirl bipolar), and petal
  // (Raykoid666 lobed attractor — no params). The originally-scoped
  // `loc` variation was dropped: no `varLoc.pas` exists in either
  // Apophysis 7X core (XFormMan.pas cvarnames at the 7x15c tag has 29
  // entries, none of them `loc`) nor JWildfire's variation directory.
  // The survey doc's "7X.15C added `loc`" claim was traced to a
  // mis-reading of the `NRLOCVAR` constant — `Local Variations
  // count`, not a variation name. V120 stays unassigned this batch.
  collideoscope: 115,
  circlize: 116,
  circlize2: 117,
  eswirl: 118,
  petal: 119,
  // #114 batch 2b-c — Xyrus02 mid-tier + hexes cellular. Five
  // variations ported from `xyrus02/apophysis-plugins` (GPL-2+, see
  // NOTICE.md) and JWildfire HexesFunc (LGPL-2.1+):
  //   - bcircle      — Xyrus02. Inside-disk passthrough + outside-disk
  //                    optional random-border emit (RNG when bw≠0).
  //   - curl2        — Xyrus02 / Georg Kiehne. Cubic polynomial inverse
  //                    a la curl, 3 coeffs c1/c2/c3.
  //   - murl         — Xyrus02 / Peter Sdobnov, ported by chronologicaldot
  //                    into JWildfire's MurlFunc. Polar power + complex
  //                    inverse blend.
  //   - stwins       — Xyrus02. "Stwin" twin-sine ratio with 1 param
  //                    (distort). Note canonical name in the Xyrus02
  //                    source is "stwin"; the plugin DIRECTORY ships
  //                    as `stwins`, and pyr3 follows the directory name
  //                    for consistency with the survey doc + community use.
  //   - hexes        — Neil Slater / slobo777, via JWildfire HexesFunc.
  //                    Hex-grid voronoi warp with rotate/power/scale
  //                    per cell. Uses its own hex-grid helper, not
  //                    worley2d_F1 — Hexes is deterministic per-cell-
  //                    center (no per-cell RNG hash), so the cell
  //                    centers come from an integer affine transform.
  //
  // The originally-scoped `juni` variation was dropped: the Xyrus02
  // source (`xyrus02/apophysis-plugins/plugins/juni`) requires the
  // xform-affine context (`vp->a, b, c, d, e, f`) and a Z-axis
  // coordinate that pyr3's 2D-only `apply_variation` seam does not
  // expose. JWildfire has no `JuniFunc.java` either (verified against
  // the JWildfire variation directory listing 2026-06-06). The
  // appropriate place for juni would be a future xform-pre-affine
  // seam extension, tracked separately. V125 stays unassigned this
  // batch — keeps the dense numbering for whatever Sub D ships.
  bcircle: 120,
  curl2: 121,
  murl: 122,
  stwins: 123,
  hexes: 124,
  // #114 batch 2b-d — Xyrus02 X-family + blur_circle (FINAL #114 batch).
  // Six variations from xyrus02/apophysis-plugins (GPL-2+, NOTICE.md):
  //   - xheart       — Xyrus02. "Extended heart" — 2 params (angle, ratio)
  //                    drive a rotated heart-curve fold.
  //   - xhyperbol    — Xyrus02. "Extended hyperbolic" — 6 params encode
  //                    a 2x3 affine the iterate goes through before
  //                    the |z|⁻² reflection.
  //   - xcurl2       — Xyrus02. The author's own comment in xcurl2.h
  //                    reads "old, probably wrong version of curl2" —
  //                    a DIFFERENT polynomial shape from V121 `curl2`
  //                    (which is the Georg Kiehne formulation). pyr3
  //                    ships both since the visual character differs.
  //   - xtrb         — Xyrus02. Triangle-borders (boarders-on-a-triangle-
  //                    lattice). 6 params + RNG. Most complex of the
  //                    batch — precalcs 18 derived geometry values per
  //                    iter (xform-precalc is not exposed in pyr3's GPU
  //                    seam, so we recompute inline).
  //   - gridout      — Xyrus02 (Michael + Joel Faber). 0 params. Snaps
  //                    iterate to the nearest grid cell-edge step,
  //                    producing a stair-step quantization look. NOT
  //                    the same as pyr3's V101 `dc_gridout` — that one
  //                    is a COLOR variation (position contribution
  //                    (0,0) + per-cell hue hash); this is a position
  //                    warp with no color override.
  //   - blur_circle  — Xyrus02. 1 param (hole). Disc-uniform blur:
  //                    uniformly samples a unit square, square→circle
  //                    perimeter parameterization (similar to circlize),
  //                    emits onto a hole-offset circle.
  //
  // No drops this batch. All 6 fit the 8-param seam (xhyperbol+xtrb
  // are the tightest at 6).
  xheart: 125,
  xhyperbol: 126,
  xcurl2: 127,
  xtrb: 128,
  gridout: 129,
  blur_circle: 130,
  // #120 batch B1 — M-tier port flagship. bipolar2 is Brad Stefanov's
  // 9-param rework of bipolar (V35); the first variation to consume the
  // post-#120 expanded seam (8 → 10). Source: JWildfire Bipolar2Func.java
  // (LGPL-2.1+, see NOTICE.md). 9 params: shift, a, b, c, d, e, f1, g1, h.
  bipolar2: 131,
  // #120 batch B2 — bubble2 (2D projection of JWildfire 3D Bubble2Func).
  // Source: "bubble2 from FracFx" (LGPL-2.1+, NOTICE.md). 2 params after
  // 2D projection (x_scale, y_scale; the original z param + output
  // channel dropped per pyr3's 2D-only convention — same precedent as
  // the #114 falloff family).
  bubble2: 132,
  // #120 batch B3 — inverse hyperbolic family. Sources: JWildfire (LGPL-2.1+,
  // NOTICE.md). Authors: Whittaker Courtney (acosh / acoth / acosech) +
  // Tatyana Zabanova 2017 / DarkBeam 2018 (arcsinh / arctanh / arcsech2).
  // All 0-param. acosh + acosech end with a 50/50 RNG sign flip on output;
  // the other four are fully deterministic. Compose the complex_*
  // primitives in chaos.wgsl.
  acosh: 133,
  arcsinh: 134,
  arctanh: 135,
  acoth: 136,
  acosech: 137,
  arcsech2: 138,
  // #120 batch B3.5 — cell2 (6-param N/S asymmetric subset of JWildfire
  // 16-param Cell2Func). Author: Brad Stefanov, building on "Cell in the
  // Apophysis Plugin Pack". Per-quadrant E/W asymmetry + move offsets +
  // mirror flags dropped to fit the 10-cap. See #127 for the seam-expand
  // discussion if the full 16-param surface is ever needed.
  cell2: 139,
  // #120 batch B4 — Xyrus02 + Lu-Kout remainders. Authors: Xyrus02
  // (curl_sp — spherical curl, drops the source's dc color param);
  // Peter Sdobnov "Zueuk" / Nic Anderson (murl2 — polar power +
  // complex inverse); Jed Kelsey "Lu-Kout" (lissajous + spirograph +
  // waffle — RNG-driven parametric curves & grid texture). All from
  // JWildfire (LGPL-2.1+, NOTICE.md). MandelbrotFunc audited and
  // deferred — its iterative inner kernel + per-walker state is a
  // separate architectural ship, not a drop-in.
  curl_sp: 140,
  murl2: 141,
  lissajous: 142,
  spirograph: 143,
  waffle: 144,
  // #120 batch B5 — Glynn-set family (eralex61). 2D siblings of GlynnSim2B
  // which ships 26 params and is deferred to its own architectural design.
  // All three are RNG-driven (inside-radius circle emit + outside-radius
  // passthrough/alpha² inversion based on contrast roll).
  glynnSim1: 145,
  glynnSim2: 146,
  glynnSim3: 147,
  // #120 batch B6 — Faber/Xyrus02/zephyrtronium novelties. All
  // deterministic. flipy = 0 params, eclipse = 1, barycentroid = 4,
  // chunk = 7. Helix deferred (3D-only). Colordomain deferred (HSV
  // color output). Voron candidate for a later batch.
  flipy: 148,
  eclipse: 149,
  barycentroid: 150,
  chunk: 151,
  // #121 L-tier batch L1 — JWildfire 2D long tail. All 2D-only,
  // verified existing in thargor6/JWildfire/src/.../variation/.
  // ennepers + erf are 0-param shapes (erf needs A&S 7.1.26 approx —
  // JWildfire has no GPU code path for it). circus + asteria are
  // small 1-param transforms (asteria uses 1 RNG call). clifford_js
  // is the 4-param Clifford attractor (deterministic; JWildfire keeps
  // the `_js` suffix). devil_warp is 6-param pow-warp with rmin/rmax
  // clamp. voron is the largest WGSL — 5 params + DiscretNoise hash
  // + 3×3 neighbor cell loop.
  ennepers: 152,
  erf: 153,
  circus: 154,
  asteria: 155,
  clifford_js: 156,
  devil_warp: 157,
  voron: 158,
  // #121 L-tier batch L2 — more JWildfire 2D long tail. henon
  // (TyrantWave's Hénon map, sibling of V156 clifford_js Bourke
  // attractor family). atan (FractalDesire, 3-mode arctan saturation).
  // cardioid (Faber, classic polar curve). chrysanthemum (Sosa via
  // Bourke, RNG-driven base shape — well-known mathematical curve).
  // bcollide (Faber, boundary-collision via logarithm/atan2). bsplit
  // (Raykoid666, tan/sin shift with singularity guard). bulge (radial
  // r^N bulge distortion).
  henon: 159,
  atan: 160,
  cardioid: 161,
  chrysanthemum: 162,
  bcollide: 163,
  bsplit: 164,
  bulge: 165,
  // #121 L-tier batch L3 — JWildfire 2D continuing. checks (Keeps +
  // Xyrus02 checkered pattern, 4 params + RNG). circular + circular2
  // (Tatyana Zabanova via Brad Stefanov, 2+4 params + RNG; hash-jitter
  // angular rotation). elliptic (3-mode Apophysis/JWildfire/precision;
  // needs sqrt_safe + sqrt1pm1 helpers). circleblur (Zyorg uniform
  // disc sample). Triaged out from L3 candidate set: arc_truchet (per-
  // genome init tiltArray), atan2_spirals (14 params > seam), cosq/
  // boxfold (3D), dragon (recursive pre-init).
  checks: 166,
  circular: 167,
  circular2: 168,
  corners: 169,
  circleblur: 170,
  // #121 L-tier batch L4 — JWildfire 2D continuing. fibonacci2 (Larry
  // Berlin, golden-ratio-based exp/sin/cos curve). hypertile + hypertile1
  // + hypertile2 (Zueuk hyperbolic Möbius tiling family, deterministic +
  // 2 RNG variants). idisc (Faber π/(r+1) radial projection).
  // Triaged out: combimirror/conicalspiral/cone (3D + DC + 13 params).
  fibonacci2: 171,
  hypertile: 172,
  hypertile1: 173,
  hypertile2: 174,
  idisc: 175,
  // #121 L-tier batch L5 — JWildfire 2D continuing. foci (Apophysis
  // pack, sinh/cos projection). hole (Faber 2-param radial). kaleidoscope
  // (Will Evans 5-param mirror split). layered_spiral (Will Evans 1-param
  // radial-modulated spiral). linearT (FractalDesire 2-param power-law).
  // line (Nic Anderson 2-param base shape — 2D projection drops z).
  // Triaged out: jac_cn/jac_dn/jac_sn (need shared Jacobi_elliptic
  // helper, deferred to L6+); maurer_rose (16 params).
  hole: 176,
  kaleidoscope: 177,
  layered_spiral: 178,
  linear_t: 179,
  line: 180,
  // #121 L-tier batch L6 — JWildfire 2D continuing. ovoid (Faber, 2
  // params, radial-scaled inverse-r²). phoenix_julia (TyrantWave, 4
  // params, Julian variant with x/y distortion). scry (Apophysis pack,
  // 0 params, scrying-mirror-like inversion). shredrad (Zy0rg, 2 params,
  // radial-shredding mod-fold). Triaged out: mobiq (3D + 16 params),
  // pixel_flow (DC), separation/split/splits/sinusoidal (already shipped).
  ovoid: 181,
  phoenix_julia: 182,
  unpolar: 183,
  shredrad: 184,
  // #121 L-tier batch L7 — JWildfire 2D continuing. vogel (Ganora
  // golden-angle phyllotaxis). yin_yang (dark-beam 5-param symbol).
  // squish (Faber Angle Pack square-fold). target (Faber log-radial
  // ring rotator). Triaged out: truchet_flow (vec2 + smoothstep base
  // shape, too complex); taurus (3D).
  vogel: 185,
  yin_yang: 186,
  squish: 187,
  target: 188,
  // #121 L-tier batch L8. polar2 (Apo log-polar), funnel (Raykoid666
  // tanh+sec), holesq (DarkBeam diamond fold), hole2 (Faber/Stefanov/
  // Sidwell 10-shape multi-mode), lace_js (Sosa via Bourke RNG-branch),
  // julia_outside (Whittaker Courtney 3-mode complex w/ RNG), fourth
  // (guagapunyaimel per-quadrant 4-way pick). Triaged: hopalong (uses
  // persistent x0/y0 state across iters — pyr3 kernel is stateless).
  funnel: 189,
  holesq: 190,
  hole2: 191,
  lace_js: 192,
  julia_outside: 193,
  fourth: 194,
  // #121 L-tier batch L9. pulse (sin-modulated linear), rays1/rays2/rays3
  // (Raykoid666 trio of radial-ray-burst kernels with increasing trig
  // complexity). Triaged: octagon/onion/octapol (3D), linear_t/noise/pie
  // (already shipped), pixel_flow (DC).
  pulse: 195,
  rays1: 196,
  rays2: 197,
  rays3: 198,
  // #121 L-tier batch L10 — V200 milestone passed. sinh (cothe), tancos
  // (Raykoid666), tanh (cothe), twoface (DarkBeam), e_julia (Faber
  // eSeries — hyperbolic Julian variant with acosh/acos/sinh/cosh + RNG).
  // Triaged: y (15+ params), spherical3/z_translate (3D).
  tancos: 199,
  twoface: 200,
  e_julia: 201,
  // #121 L-tier batch L11. butterfly (classic 2D curve), cannabis_curve_wf
  // (high-freq parametric flower), e_collide + e_mod (Faber eSeries
  // collision/modulus elliptic-coord folds).
  cannabis_curve_wf: 202,
  e_collide: 203,
  e_mod: 204,
  // #121 L-tier batch L12. intersection (Stefanov 10-param tile
  // intersector with RNG), inv_squircular (inverse squircular projection).
  // Triaged: ex_blur (3D), x/y (15+ params), log/separation/pre_blur
  // (already shipped), mobius_strip/ortho (3D).
  intersection: 205,
  inv_squircular: 206,
  // #121 L-tier batch L13. lozi (TyrantWave's Lozi map, sibling of
  // V159 henon), hypershift (Zy0rg Möbius-style radial shift),
  // hex_modulus (Zabanova hexagonal-grid modulus fold). Triaged:
  // macmillan (persistent state); joukowski (vec2/G GLSL helpers);
  // koch/klein_group/maurer_lines (large or 16+ params).
  lozi: 207,
  hypershift: 208,
  hex_modulus: 209,
  // #121 L-tier batch L14 (final). boarders2 (Xyrus02 grid-cell border
  // fold), b_mod (Faber bSeries modulus radial fold, sibling of V163
  // bcollide), b_transform (Faber bSeries Möbius transform with
  // power-split + RNG), parallel (Stefanov 12-param tile parallel
  // mode pair, sibling of V205 intersection).
  boarders2: 210,
  b_mod: 211,
  b_transform: 212,
  parallel: 213,
  // #170 sibling-pair completions + S-tier ports. waves3/waves4
  // (Zabanova/Stefanov sequels to V16/V85), scry2 (dark-beam loonie2+scry
  // hybrid), ennepers2 (dark-beam Enneper variant), apollony (Sosa
  // Apollonian gasket IFS), circlecrop (Xyrus02 disc clipper). Brownian
  // intentionally NOT ported — it requires persistent Draw2D canvas
  // state (DynamicArray2D), incompatible with pyr3's stateless WGSL
  // kernel.
  waves3: 214,
  waves4: 215,
  scry2: 216,
  ennepers2: 217,
  apollony: 218,
  circlecrop: 219,
  // #133 — Conformal & complex-analytic warps. Five original (not in JWF)
  // variations from classical complex analysis. Newton extends the
  // dc_cylinder (V102) "position-warp + DC color" precedent: its DC basin
  // coloring (which root of zⁿ − 1 a splat converges to) is the umbrella
  // #128 headline shot. blaschke/cayley/complex_gamma/lambert_w are pure
  // position warps. complex_gamma (V223) carries a Lanczos g=7 + reflection
  // branch; lambert_w (V224) is principal-branch Halley iteration.
  newton: 220,
  blaschke: 221,
  cayley: 222,
  complex_gamma: 223,
  lambert_w: 224,
  // #134 — Cartographic map-projection warps. Five confirmed-novel 0-param
  // variations that treat (x,y) as (longitude, latitude) and apply classic
  // global map projections.
  mercator: 225,
  lambert: 226,
  mollweide: 227,
  hammer: 228,
  stereographic: 229,
} as const;

export type VariationIndex = (typeof V)[keyof typeof V];

export const VARIATION_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(V).map(([name, idx]) => [idx, name]),
);

/** #114 — variations whose RGB overrides the palette-indexed coloring per
 *  scatter. Used by genome.packXformInto to bake the per-xform dc_flag, and
 *  by edit-section-xforms to render the "(overridden by …)" annotation. */
export const DC_VARIATION_SET: ReadonlySet<number> = new Set<number>([
  V.dc_linear,
  V.dc_perlin,
  V.dc_gridout,
  V.dc_cylinder,
  V.newton,  // #133 — newton emits DC basin color when dc_flag set
]);

export interface Variation {
  index: VariationIndex;
  weight: number;
  param0?: number;
  param1?: number;
  // Phase 9b — extended seam (2026-05-12). Variations like `pdj` (4 params),
  // `blob` (3), `ngon` (4), `wedge` (4), etc. fill `param2..param5`. Positional
  // mapping is owned by VARIATION_PARAMS in src/serialize.ts. WGSL side stores
  // these in `xf.vars_extra[k]` (a parallel `array<vec4f, 8>`); GPU pack layout
  // see XFORM_FLOATS / packXformInto in src/genome.ts.
  param2?: number;
  param3?: number;
  param4?: number;
  param5?: number;
  // Phase 9b Batch K (2026-05-12): seam extended 6 → 8 to support `mobius`
  // (var98, 8 params re_a / im_a / re_b / im_b / re_c / im_c / re_d / im_d).
  // Backed by a new `vars_extra2: array<vec4f, 8>` WGSL slot.
  param6?: number;
  param7?: number;
  // #120 (2026-06-06): seam extended 8 → 10 to support `bipolar2` (9 params)
  // and the rest of the M-tier port. Free wire-up — `vars_extra2[k].zw` were
  // reserved as pad in Batch K (see `vars_extra2: array<vec4f, 8>` comment in
  // chaos.wgsl and the layout block in src/genome.ts).
  param8?: number;
  param9?: number;
  /** Editor-only on/off toggle. When `false`, the packer zeros this
   *  variation's weight in the chain. Default: undefined = active. */
  active?: boolean;
}

// Builder helpers — concise spec at genome-construction time.
export const linear = (weight = 1): Variation => ({ index: V.linear, weight });
export const spherical = (weight = 1): Variation => ({ index: V.spherical, weight });
export const julian = (weight = 1, power = 2, dist = 1): Variation => ({
  index: V.julian,
  weight,
  param0: power,
  param1: dist,
});
// Batch B builders. rings/fan read affine (no params); rings2/fan2/perspective/
// bipolar/curl/rectangles consume the existing 2-param seam.
// Batch C builders. All consume vars_extra. param order matches the
// VARIATION_PARAMS registry in src/serialize.ts (sets positional → named map).
// Batch D builders.
// Batch E builders — all 0-param transcendentals.

export const MAX_VARIATIONS_PER_XFORM = 8;

// =====================================================================
// TS reference implementations of variation kernels.
//
// Each function MUST mirror the WGSL kernel in src/shaders/chaos.wgsl
// EXACTLY — same atan2 arg order, same trig derivation. These are the
// canonical math; the WGSL kernel is the GPU port. Layer 3 (planned)
// will assert WGSL matches these within fp32 ε.
//
// Adding a new variation: (1) add the WGSL kernel, (2) add the TS impl
// here, (3) add a fixture under tests/fixtures/variations/<name>.json,
// (4) add an entry to TS_VARIATIONS in src/variations.test.ts.
// =====================================================================

export interface VarInput {
  tx: number;
  ty: number;
  weight: number;
  params?: Record<string, number>;
  randBranch?: number; // 0 or 1; required for julia (and other RNG-consuming variations)
  // Phase 9b Batch D — continuous-RNG kernels (noise/blur/gaussian_blur/
  // arch/radial_blur/square/rays/blade/twintrian). Caller supplies the rand01()
  // values flam3 consumed for this invocation. The current test harness does
  // NOT yet capture these values from instrumented flam3 (BACKLOG entry queued),
  // so the Batch D smoke tests just inject placeholder values to exercise the
  // TS impl without asserting per-row parity. When rand-capture lands, the
  // TS impls already accept the right shape — no impl changes needed.
  randValues?: number[];
}

export interface VarOutput {
  x: number;
  y: number;
}

const PI = Math.PI;
const VAR_EPS = 1e-10;

// var_linear (chaos.wgsl:114) — returns p * w.
export function ts_var_linear(i: VarInput): VarOutput {
  return { x: i.weight * i.tx, y: i.weight * i.ty };
}

// var_polar (chaos.wgsl:146) — flam3 precalc_atan_xy uses atan2(tx, ty),
// which is swapped-arg vs standard. DO NOT "fix" to atan2(ty, tx).
export function ts_var_polar(i: VarInput): VarOutput {
  const phi = Math.atan2(i.tx, i.ty);
  const r = Math.hypot(i.tx, i.ty);
  return { x: i.weight * (phi / PI), y: i.weight * (r - 1.0) };
}

// var_disc (chaos.wgsl:164) — same swapped-arg atan2 as polar.
export function ts_var_disc(i: VarInput): VarOutput {
  const phi = Math.atan2(i.tx, i.ty);
  const r = Math.hypot(i.tx, i.ty);
  return {
    x: i.weight * (phi / PI) * Math.sin(PI * r),
    y: i.weight * (phi / PI) * Math.cos(PI * r),
  };
}

// var_spiral (chaos.wgsl:179) — flam3 precalc_angles_flag uses
// sina = tx/r, cosa = ty/r (90° rotated from standard +X convention).
//
// Intentional pyr3 modernization: flam3 uses two distinct values —
// `precalc_sqrt` (unbiased r) for sina/cosa, and `r = precalc_sqrt + EPS`
// for the denominator + sin/cos arg. pyr3 (both TS and WGSL) collapses
// these to a single biased `r`. Numerical difference is ~6e-15 at
// normal radii, far below absEps=1e-6. The WGSL kernel makes the same
// simplification, so TS and WGSL stay byte-for-byte aligned.
export function ts_var_spiral(i: VarInput): VarOutput {
  const r = Math.hypot(i.tx, i.ty) + VAR_EPS;
  const sina = i.tx / r;
  const cosa = i.ty / r;
  return {
    x: (i.weight / r) * (cosa + Math.sin(r)),
    y: (i.weight / r) * (sina - Math.cos(r)),
  };
}

// var_julia (chaos.wgsl:212) — uses precalc_atan_xy = atan2(tx, ty).
// RNG branch is supplied externally via i.randBranch (0 or 1) so the impl
// is deterministic. Caller MUST provide randBranch ∈ {0, 1}.
export function ts_var_julia(i: VarInput): VarOutput {
  if (i.randBranch !== 0 && i.randBranch !== 1) {
    throw new Error(`ts_var_julia: randBranch must be 0 or 1, got ${i.randBranch}`);
  }
  const phi = Math.atan2(i.tx, i.ty);
  const theta = phi * 0.5 + (i.randBranch === 1 ? PI : 0.0);
  const r = Math.sqrt(Math.hypot(i.tx, i.ty));
  return {
    x: i.weight * r * Math.cos(theta),
    y: i.weight * r * Math.sin(theta),
  };
}

// =====================================================================
// Phase 9-test-harness PR 2 — TS reference impls for the remaining 16
// of pyr3's core 21 variations. Each mirrors the WGSL kernel in
// chaos.wgsl line-for-line; cite line numbers in comments. Standard
// f64 math; no perf concerns (used only by Layer 1 tests).
// =====================================================================

// var_sinusoidal (chaos.wgsl:215) — w * (sin(p.x), sin(p.y)).
export function ts_var_sinusoidal(i: VarInput): VarOutput {
  return { x: i.weight * Math.sin(i.tx), y: i.weight * Math.sin(i.ty) };
}

// var_spherical (chaos.wgsl:219) — w / (r²+EPS) * p.
export function ts_var_spherical(i: VarInput): VarOutput {
  const r2 = i.tx * i.tx + i.ty * i.ty + VAR_EPS;
  const k = i.weight / r2;
  return { x: k * i.tx, y: k * i.ty };
}

// var_swirl (chaos.wgsl:224) — rotate p by angle r².
export function ts_var_swirl(i: VarInput): VarOutput {
  const r2 = i.tx * i.tx + i.ty * i.ty;
  const s = Math.sin(r2);
  const c = Math.cos(r2);
  return {
    x: i.weight * (s * i.tx - c * i.ty),
    y: i.weight * (c * i.tx + s * i.ty),
  };
}

// var_horseshoe (chaos.wgsl:231) — (w/r) * ((tx-ty)(tx+ty), 2 tx ty).
export function ts_var_horseshoe(i: VarInput): VarOutput {
  const r = Math.hypot(i.tx, i.ty) + VAR_EPS;
  const k = i.weight / r;
  return {
    x: k * (i.tx - i.ty) * (i.tx + i.ty),
    y: k * 2.0 * i.tx * i.ty,
  };
}

// var_handkerchief (chaos.wgsl:249) — uses precalc_atan_xy = atan2(tx, ty).
export function ts_var_handkerchief(i: VarInput): VarOutput {
  const phi = Math.atan2(i.tx, i.ty);
  const r = Math.hypot(i.tx, i.ty);
  return {
    x: i.weight * r * Math.sin(phi + r),
    y: i.weight * r * Math.cos(phi - r),
  };
}

// var_heart (chaos.wgsl:255) — uses precalc_atan_xy = atan2(tx, ty).
export function ts_var_heart(i: VarInput): VarOutput {
  const phi = Math.atan2(i.tx, i.ty);
  const r = Math.hypot(i.tx, i.ty);
  return {
    x: i.weight * r * Math.sin(phi * r),
    y: i.weight * r * -Math.cos(phi * r),
  };
}

// var_hyperbolic (chaos.wgsl:283) — flam3 precalc_angles_flag.
export function ts_var_hyperbolic(i: VarInput): VarOutput {
  const r = Math.hypot(i.tx, i.ty) + VAR_EPS;
  const sina = i.tx / r;
  const cosa = i.ty / r;
  return { x: i.weight * (sina / r), y: i.weight * (r * cosa) };
}

// var_diamond (chaos.wgsl:290) — flam3 precalc_angles_flag; uses unbiased r
// for sin/cos arg per WGSL.
export function ts_var_diamond(i: VarInput): VarOutput {
  const r = Math.hypot(i.tx, i.ty) + VAR_EPS;
  const sina = i.tx / r;
  const cosa = i.ty / r;
  const r_orig = Math.hypot(i.tx, i.ty);
  return {
    x: i.weight * (sina * Math.cos(r_orig)),
    y: i.weight * (cosa * Math.sin(r_orig)),
  };
}

// var_ex (chaos.wgsl:298) — uses precalc_atan_xy = atan2(tx, ty).
export function ts_var_ex(i: VarInput): VarOutput {
  const phi = Math.atan2(i.tx, i.ty);
  const r = Math.hypot(i.tx, i.ty);
  const n0 = Math.sin(phi + r);
  const n1 = Math.cos(phi - r);
  const m0 = n0 * n0 * n0;
  const m1 = n1 * n1 * n1;
  return { x: i.weight * r * (m0 + m1), y: i.weight * r * (m0 - m1) };
}

// var_julian (chaos.wgsl:317) — parametric (julian_power, julian_dist) +
// RNG-using. n = floor(rand01() * |power|) selects branch ∈ [0, |power|-1].
// Caller MUST provide:
//   - i.randBranch: integer ∈ [0, |power|-1] (the n value for that row)
//   - i.params.julian_power, i.params.julian_dist
// Impl mirrors WGSL exactly (note WGSL uses atan2(p.y, p.x) — STANDARD arg
// order — for julian, NOT swapped; this differs from polar/disc/etc.).
export function ts_var_julian(i: VarInput): VarOutput {
  const power = i.params?.['julian_power'];
  const dist = i.params?.['julian_dist'];
  if (power === undefined || dist === undefined) {
    throw new Error(`ts_var_julian: requires params.julian_power and params.julian_dist`);
  }
  if (i.randBranch === undefined || i.randBranch < 0 || i.randBranch >= Math.abs(power)) {
    throw new Error(`ts_var_julian: randBranch must be ∈ [0, |power|-1], got ${i.randBranch}`);
  }
  const r = Math.hypot(i.tx, i.ty);
  const phi = Math.atan2(i.ty, i.tx);
  const n = i.randBranch;
  const theta = (phi + 2.0 * PI * n) / power;
  const newR = i.weight * Math.pow(r, dist / power);
  return { x: newR * Math.cos(theta), y: newR * Math.sin(theta) };
}

// var_bent (chaos.wgsl:327) — branch on sign of components.
export function ts_var_bent(i: VarInput): VarOutput {
  const x = i.tx < 0 ? i.tx * 2.0 : i.tx;
  const y = i.ty < 0 ? i.ty * 0.5 : i.ty;
  return { x: i.weight * x, y: i.weight * y };
}

// var_waves (chaos.wgsl:333) — reads xform affine b, c, e, f. Caller MUST
// provide:
//   - i.params.b, i.params.c, i.params.e, i.params.f
// (corresponding to flam3 c[1][0], c[2][0], c[1][1], c[2][1]).
export function ts_var_waves(i: VarInput): VarOutput {
  const b = i.params?.['b'];
  const c = i.params?.['c'];
  const e = i.params?.['e'];
  const f = i.params?.['f'];
  if (b === undefined || c === undefined || e === undefined || f === undefined) {
    throw new Error(`ts_var_waves: requires params.b, .c, .e, .f`);
  }
  return {
    x: i.weight * (i.tx + b * Math.sin(i.ty / (c * c + VAR_EPS))),
    y: i.weight * (i.ty + e * Math.sin(i.tx / (f * f + VAR_EPS))),
  };
}

// var_fisheye (chaos.wgsl:344) — note x/y swap is intentional (flam3 spec).
export function ts_var_fisheye(i: VarInput): VarOutput {
  const r = 2.0 / (Math.hypot(i.tx, i.ty) + 1.0);
  return { x: i.weight * r * i.ty, y: i.weight * r * i.tx };
}

// var_popcorn (chaos.wgsl:349) — reads xform affine c, f. Caller MUST
// provide:
//   - i.params.c, i.params.f
export function ts_var_popcorn(i: VarInput): VarOutput {
  const c = i.params?.['c'];
  const f = i.params?.['f'];
  if (c === undefined || f === undefined) {
    throw new Error(`ts_var_popcorn: requires params.c, .f`);
  }
  return {
    x: i.weight * (i.tx + c * Math.sin(Math.tan(3.0 * i.ty))),
    y: i.weight * (i.ty + f * Math.sin(Math.tan(3.0 * i.tx))),
  };
}

// var_eyefish (chaos.wgsl:358) — like fisheye but no x/y swap.
export function ts_var_eyefish(i: VarInput): VarOutput {
  const r = 2.0 / (Math.hypot(i.tx, i.ty) + 1.0);
  return { x: i.weight * r * i.tx, y: i.weight * r * i.ty };
}

// var_bubble (chaos.wgsl:365) — denominator is always >= 1, no EPS needed.
export function ts_var_bubble(i: VarInput): VarOutput {
  const k = i.weight / (0.25 * (i.tx * i.tx + i.ty * i.ty) + 1.0);
  return { x: k * i.tx, y: k * i.ty };
}

// var_cylinder — flam3 var29_cylinder (variations.c:680). Pure: no params,
// no rng, no affine. new_x = w*sin(tx), new_y = w*ty.
export function ts_var_cylinder(i: VarInput): VarOutput {
  return { x: i.weight * Math.sin(i.tx), y: i.weight * i.ty };
}

// var_disc2 — flam3 var49_disc2 (variations.c:1054 kernel, :1977 precalc).
// Parametric (disc2_rot, disc2_twist) + uses precalc_atan_xy (swapped atan2).
// Inlines flam3's `disc2_precalc()` since pyr3 has no per-xform precalc hook;
// the trig + branch is dwarfed by the kernel's own sin/cos/atan2 cost.
//
// Caller MUST provide:
//   - i.params.disc2_rot   (= flam3 disc2_rot,   default 0)
//   - i.params.disc2_twist (= flam3 disc2_twist, default 0)
export function ts_var_disc2(i: VarInput): VarOutput {
  const rot = i.params?.['disc2_rot'];
  const twist = i.params?.['disc2_twist'];
  if (rot === undefined || twist === undefined) {
    throw new Error(`ts_var_disc2: requires params.disc2_rot and params.disc2_twist`);
  }
  const TAU = 2 * PI;
  const timespi = rot * PI;
  let cosadd = Math.cos(twist) - 1.0;
  let sinadd = Math.sin(twist);
  if (twist > TAU) {
    const k = 1.0 + twist - TAU;
    cosadd *= k;
    sinadd *= k;
  } else if (twist < -TAU) {
    const k = 1.0 + twist + TAU;
    cosadd *= k;
    sinadd *= k;
  }
  const t = timespi * (i.tx + i.ty);
  const sinr = Math.sin(t);
  const cosr = Math.cos(t);
  const r = (i.weight * Math.atan2(i.tx, i.ty)) / PI;
  return {
    x: (sinr + cosadd) * r,
    y: (cosr + sinadd) * r,
  };
}

// var_pdj — flam3 var24_pdj (variations.c:579-596). Pure: no rng, no atan2,
// no affine. Four params (pdj_a/b/c/d) — the first variation to consume the
// Phase 9b extended seam (param2/param3 in addition to param0/param1).
//
// Kernel (from flam3 C):
//   nx1 = cos(pdj_b * tx);   nx2 = sin(pdj_c * tx);
//   ny1 = sin(pdj_a * ty);   ny2 = cos(pdj_d * ty);
//   out = w * (ny1 - nx1, nx2 - ny2)
//
// Caller MUST provide:
//   - i.params.pdj_a / pdj_b / pdj_c / pdj_d
export function ts_var_pdj(i: VarInput): VarOutput {
  const pa = i.params?.['pdj_a'];
  const pb = i.params?.['pdj_b'];
  const pc = i.params?.['pdj_c'];
  const pd = i.params?.['pdj_d'];
  if (pa === undefined || pb === undefined || pc === undefined || pd === undefined) {
    throw new Error(`ts_var_pdj: requires params.pdj_a, .pdj_b, .pdj_c, .pdj_d`);
  }
  const nx1 = Math.cos(pb * i.tx);
  const nx2 = Math.sin(pc * i.tx);
  const ny1 = Math.sin(pa * i.ty);
  const ny2 = Math.cos(pd * i.ty);
  return {
    x: i.weight * (ny1 - nx1),
    y: i.weight * (nx2 - ny2),
  };
}

// =====================================================================
// Phase 9b Batch A — pure 0-param kernels (no rng, no affine reads).
// =====================================================================

// var_exponential — flam3 var18_exponential (variations.c:452). No precalc flag;
// pure expression in (tx, ty).
//   dx = w * exp(tx - 1);  dy = pi * ty
//   out = (dx * cos(dy), dx * sin(dy))
export function ts_var_exponential(i: VarInput): VarOutput {
  const dx = i.weight * Math.exp(i.tx - 1.0);
  const dy = PI * i.ty;
  return { x: dx * Math.cos(dy), y: dx * Math.sin(dy) };
}

// var_power — flam3 var19_power (variations.c:472). Uses precalc_angles_flag:
// sina = tx/r, cosa = ty/r (NOT standard atan2; matches flam3's swapped angle
// convention shared with spiral / hyperbolic / diamond). pyr3 modernization:
// single biased r (= length(p) + EPS) used for both sina/cosa AND the pow base,
// matching the same collapse documented on var_spiral. Numerical diff vs flam3
// at small r is ~1e-10, far below absEps=1e-6.
export function ts_var_power(i: VarInput): VarOutput {
  const r = Math.hypot(i.tx, i.ty) + VAR_EPS;
  const sina = i.tx / r;
  const cosa = i.ty / r;
  const k = i.weight * Math.pow(r, sina);
  return { x: k * cosa, y: k * sina };
}

// var_cosine — flam3 var20_cosine (variations.c:489). No precalc flag.
//   out = w * (cos(pi*tx) * cosh(ty), -sin(pi*tx) * sinh(ty))
export function ts_var_cosine(i: VarInput): VarOutput {
  const a = i.tx * PI;
  return {
    x: i.weight * Math.cos(a) * Math.cosh(i.ty),
    y: -i.weight * Math.sin(a) * Math.sinh(i.ty),
  };
}

// var_tangent — flam3 var42_tangent (variations.c:885). No precalc flag.
//   out = w * (sin(tx)/cos(ty), tan(ty))
// cos(ty) can be 0 (e.g., ty = π/2); divide-by-zero produces ±Inf which the
// chaos-game bad-value check catches and reseeds — matches flam3 behavior.
export function ts_var_tangent(i: VarInput): VarOutput {
  return {
    x: (i.weight * Math.sin(i.tx)) / Math.cos(i.ty),
    y: i.weight * Math.tan(i.ty),
  };
}

// var_secant2 — flam3 var46_secant2 (variations.c:976). Uses precalc_sqrt
// only. Non-standard weight handling per flam3 comment: weight is BOTH folded
// into r (= w * sqrt(tx²+ty²)) before cos AND multiplied onto the output. Branch
// on sign of cos(r) selects ±1 offset on the y axis.
export function ts_var_secant2(i: VarInput): VarOutput {
  const r = i.weight * Math.hypot(i.tx, i.ty);
  const cr = Math.cos(r);
  const icr = 1.0 / cr;
  return {
    x: i.weight * i.tx,
    y: cr < 0 ? i.weight * (icr + 1.0) : i.weight * (icr - 1.0),
  };
}

// var_cross — flam3 var48_cross (variations.c:1033). No precalc flag.
//   s = tx² - ty²;  r = w * sqrt(1 / (s² + EPS))
//   out = (tx * r, ty * r)
export function ts_var_cross(i: VarInput): VarOutput {
  const s = i.tx * i.tx - i.ty * i.ty;
  const r = i.weight * Math.sqrt(1.0 / (s * s + VAR_EPS));
  return { x: i.tx * r, y: i.ty * r };
}

// =====================================================================
// Phase 9b Batch B — 1-2 param kernels, no rng. rings/fan read affine c/f
// (same shape as waves/popcorn). All fit existing 2-param seam.
// =====================================================================

// var_rings — flam3 var21_rings (variations.c:508). Reads affine c[2][0]
// (= pyr3 affine `c`). Uses precalc_angles convention (sina=tx/r, cosa=ty/r).
// pyr3 modernization (same as spiral): single biased r — sub-EPS diff.
//
// Caller MUST provide:
//   - i.params.c  (= pyr3 affine c, = flam3 c[2][0])
export function ts_var_rings(i: VarInput): VarOutput {
  const c = i.params?.['c'];
  if (c === undefined) throw new Error(`ts_var_rings: requires params.c`);
  const r0 = Math.hypot(i.tx, i.ty);
  const r_eps = r0 + VAR_EPS;
  const sina = i.tx / r_eps;
  const cosa = i.ty / r_eps;
  const dx = c * c + VAR_EPS;
  const r = i.weight * (((r0 + dx) % (2.0 * dx)) - dx + r0 * (1.0 - dx));
  return { x: r * cosa, y: r * sina };
}

// var_fan — flam3 var22_fan (variations.c:528). Reads affine c[2][0] / c[2][1]
// (= pyr3 affine `c` / `f`). Uses precalc_atan_xy (swapped atan2).
// `(a+dy)/dx` can be negative; flam3 uses C truncation toward zero — JS uses
// `Math.trunc` for the same behavior.
//
// Caller MUST provide:
//   - i.params.c  (= pyr3 affine c, = flam3 c[2][0])
//   - i.params.f  (= pyr3 affine f, = flam3 c[2][1])
export function ts_var_fan(i: VarInput): VarOutput {
  const c = i.params?.['c'];
  const f = i.params?.['f'];
  if (c === undefined || f === undefined) {
    throw new Error(`ts_var_fan: requires params.c, .f`);
  }
  const dx = PI * (c * c + VAR_EPS);
  const dy = f;
  const dx2 = 0.5 * dx;
  const phi = Math.atan2(i.tx, i.ty);
  const r = i.weight * Math.hypot(i.tx, i.ty);
  // TS reference uses C-fmod (trunc-toward-zero) to match the flam3-emitted
  // fixture at tests/fixtures/variations/fan.json. The WGSL `var_fan` in
  // chaos.wgsl now uses the SAME C-fmod semantics (the v0.13 PYR3-010 fix
  // replaced its former Euclidean `floor`-mod — see the chaos.wgsl comment),
  // so the two references agree and no fan.json regen is outstanding.
  const t = phi + dy - dx * Math.trunc((phi + dy) / dx);
  const a = t > dx2 ? phi - dx2 : phi + dx2;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_rings2 — flam3 var26_rings2 (variations.c:640). Uses precalc_angles;
// output uses (sina, cosa) NOT (cosa, sina) — swap vs `rings`. 1 param.
//
// Caller MUST provide:
//   - i.params.rings2_val
export function ts_var_rings2(i: VarInput): VarOutput {
  const val = i.params?.['rings2_val'];
  if (val === undefined) throw new Error(`ts_var_rings2: requires params.rings2_val`);
  const r0 = Math.hypot(i.tx, i.ty);
  const r_eps = r0 + VAR_EPS;
  const sina = i.tx / r_eps;
  const cosa = i.ty / r_eps;
  const dx = val * val + VAR_EPS;
  const r = r0 - 2.0 * dx * Math.trunc((r0 + dx) / (2.0 * dx)) + r0 * (1.0 - dx);
  return { x: i.weight * sina * r, y: i.weight * cosa * r };
}

// var_fan2 — flam3 var25_fan2 (variations.c:598). Uses precalc_atan_xy (swapped
// atan2). 2 params (fan2_x, fan2_y). Output uses (sin, cos) — swap vs `fan`.
//
// Caller MUST provide:
//   - i.params.fan2_x / fan2_y
export function ts_var_fan2(i: VarInput): VarOutput {
  const x = i.params?.['fan2_x'];
  const y = i.params?.['fan2_y'];
  if (x === undefined || y === undefined) {
    throw new Error(`ts_var_fan2: requires params.fan2_x, .fan2_y`);
  }
  const phi = Math.atan2(i.tx, i.ty);
  const r = i.weight * Math.hypot(i.tx, i.ty);
  const dy = y;
  const dx = PI * (x * x + VAR_EPS);
  const dx2 = 0.5 * dx;
  const t = phi + dy - dx * Math.trunc((phi + dy) / dx);
  const a = t > dx2 ? phi - dx2 : phi + dx2;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

// var_perspective — flam3 var30_perspective (variations.c:687). 2 params
// (perspective_angle, perspective_dist). flam3 precomputes
// `persp_vsin = sin(angle * PI/2)` and `persp_vfcos = dist * cos(angle * PI/2)`
// per-xform; pyr3 inlines (no per-xform precalc hook — same precedent as disc2).
//
// Caller MUST provide:
//   - i.params.perspective_angle / perspective_dist
export function ts_var_perspective(i: VarInput): VarOutput {
  const angle = i.params?.['perspective_angle'];
  const dist = i.params?.['perspective_dist'];
  if (angle === undefined || dist === undefined) {
    throw new Error(`ts_var_perspective: requires params.perspective_angle, .perspective_dist`);
  }
  const half_pi_angle = angle * (PI * 0.5);
  const vsin = Math.sin(half_pi_angle);
  const vfcos = dist * Math.cos(half_pi_angle);
  const t = 1.0 / (dist - i.ty * vsin);
  return { x: i.weight * dist * i.tx * t, y: i.weight * vfcos * i.ty * t };
}

// var_bipolar — flam3 var55_bipolar (variations.c:1180). 1 param (bipolar_shift).
// Note `M_2_PI` in C is `2/π`, NOT 2π. `(t+x2)/(t-x2)` can be ≤ 0; log goes
// NaN/Inf which the chaos-game retry path reseeds — matches flam3.
//
// Caller MUST provide:
//   - i.params.bipolar_shift
export function ts_var_bipolar(i: VarInput): VarOutput {
  const shift = i.params?.['bipolar_shift'];
  if (shift === undefined) throw new Error(`ts_var_bipolar: requires params.bipolar_shift`);
  const HALF_PI = PI * 0.5;
  const TWO_OVER_PI = 2.0 / PI;
  const x2y2 = i.tx * i.tx + i.ty * i.ty;
  const t = x2y2 + 1.0;
  const x2 = 2.0 * i.tx;
  const ps = -HALF_PI * shift;
  let y = 0.5 * Math.atan2(2.0 * i.ty, x2y2 - 1.0) + ps;
  if (y > HALF_PI) {
    y = -HALF_PI + ((y + HALF_PI) % PI);
  } else if (y < -HALF_PI) {
    y = HALF_PI - ((HALF_PI - y) % PI);
  }
  return {
    x: i.weight * 0.25 * TWO_OVER_PI * Math.log((t + x2) / (t - x2)),
    y: i.weight * TWO_OVER_PI * y,
  };
}

// var_curl — flam3 var39_curl (variations.c:832). 2 params (curl_c1, curl_c2).
// Pure rational kernel — no precalc, no trig.
//
// Caller MUST provide:
//   - i.params.curl_c1 / curl_c2
export function ts_var_curl(i: VarInput): VarOutput {
  const c1 = i.params?.['curl_c1'];
  const c2 = i.params?.['curl_c2'];
  if (c1 === undefined || c2 === undefined) {
    throw new Error(`ts_var_curl: requires params.curl_c1, .curl_c2`);
  }
  const re = 1.0 + c1 * i.tx + c2 * (i.tx * i.tx - i.ty * i.ty);
  const im = c1 * i.ty + 2.0 * c2 * i.tx * i.ty;
  const r = i.weight / (re * re + im * im);
  return {
    x: (i.tx * re + i.ty * im) * r,
    y: (i.ty * re - i.tx * im) * r,
  };
}

// var_rectangles — flam3 var40_rectangles (variations.c:843). 2 params
// (rectangles_x, rectangles_y). Pass-through on the axis where the param is 0
// (matches flam3's literal `==0` test).
//
// Caller MUST provide:
//   - i.params.rectangles_x / rectangles_y
export function ts_var_rectangles(i: VarInput): VarOutput {
  const x = i.params?.['rectangles_x'];
  const y = i.params?.['rectangles_y'];
  if (x === undefined || y === undefined) {
    throw new Error(`ts_var_rectangles: requires params.rectangles_x, .rectangles_y`);
  }
  const ox =
    x === 0
      ? i.weight * i.tx
      : i.weight * ((2.0 * Math.floor(i.tx / x) + 1.0) * x - i.tx);
  const oy =
    y === 0
      ? i.weight * i.ty
      : i.weight * ((2.0 * Math.floor(i.ty / y) + 1.0) * y - i.ty);
  return { x: ox, y: oy };
}

// =====================================================================
// Phase 9b Batch C — 3-4 param kernels consuming vars_extra (param2/3).
// cpow uses RNG (same shape as julian — caller supplies randBranch).
// =====================================================================

// var_blob — flam3 var23_blob (variations.c:557). 3 params (blob_low,
// blob_high, blob_waves). Uses precalc_atan_xy (swapped atan2) +
// precalc_angles (sina=tx/r, cosa=ty/r).
//
// Caller MUST provide:
//   - i.params.blob_low / blob_high / blob_waves
export function ts_var_blob(i: VarInput): VarOutput {
  const low = i.params?.['blob_low'];
  const high = i.params?.['blob_high'];
  const waves = i.params?.['blob_waves'];
  if (low === undefined || high === undefined || waves === undefined) {
    throw new Error(`ts_var_blob: requires params.blob_low, .blob_high, .blob_waves`);
  }
  const r0 = Math.hypot(i.tx, i.ty);
  const r_eps = r0 + VAR_EPS;
  const sina = i.tx / r_eps;
  const cosa = i.ty / r_eps;
  const a = Math.atan2(i.tx, i.ty); // swapped (atan_xy)
  const r = r0 * (low + (high - low) * (0.5 + 0.5 * Math.sin(waves * a)));
  return { x: i.weight * sina * r, y: i.weight * cosa * r };
}

// var_ngon — flam3 var38_ngon (variations.c:811). 4 params (ngon_sides,
// ngon_power, ngon_circle, ngon_corners). Uses precalc_atanyx (STANDARD
// atan2(ty, tx) — different from blob/wedge which use precalc_atan_xy).
//
// Caller MUST provide:
//   - i.params.ngon_sides / ngon_power / ngon_circle / ngon_corners
export function ts_var_ngon(i: VarInput): VarOutput {
  const sides = i.params?.['ngon_sides'];
  const power = i.params?.['ngon_power'];
  const circle = i.params?.['ngon_circle'];
  const corners = i.params?.['ngon_corners'];
  if (sides === undefined || power === undefined || circle === undefined || corners === undefined) {
    throw new Error(`ts_var_ngon: requires params.ngon_sides, .ngon_power, .ngon_circle, .ngon_corners`);
  }
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const r_factor = Math.pow(sumsq, power / 2.0);
  const theta = Math.atan2(i.ty, i.tx); // standard (atan_yx)
  const b = (2 * PI) / sides;
  let phi = theta - b * Math.floor(theta / b);
  if (phi > b / 2) phi -= b;
  const amp = (corners * (1.0 / (Math.cos(phi) + VAR_EPS) - 1.0) + circle) / (r_factor + VAR_EPS);
  return { x: i.weight * i.tx * amp, y: i.weight * i.ty * amp };
}

// var_wedge — flam3 var77_wedge (variations.c:1649). 4 params (wedge_angle,
// wedge_hole, wedge_count, wedge_swirl). Uses precalc_atanyx (standard) +
// precalc_sqrt.
//
// Caller MUST provide:
//   - i.params.wedge_angle / wedge_hole / wedge_count / wedge_swirl
export function ts_var_wedge(i: VarInput): VarOutput {
  const angle = i.params?.['wedge_angle'];
  const hole = i.params?.['wedge_hole'];
  const count = i.params?.['wedge_count'];
  const swirl = i.params?.['wedge_swirl'];
  if (angle === undefined || hole === undefined || count === undefined || swirl === undefined) {
    throw new Error(`ts_var_wedge: requires params.wedge_angle, .wedge_hole, .wedge_count, .wedge_swirl`);
  }
  const r0 = Math.hypot(i.tx, i.ty);
  let a = Math.atan2(i.ty, i.tx) + swirl * r0;
  const ONE_OVER_PI = 1.0 / PI;
  const c = Math.floor((count * a + PI) * ONE_OVER_PI * 0.5);
  const comp_fac = 1 - angle * count * ONE_OVER_PI * 0.5;
  a = a * comp_fac + c * angle;
  const r = i.weight * (r0 + hole);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_cpow — flam3 var59_cpow (variations.c:1291). 3 params (cpow_r, cpow_i,
// cpow_power) + RNG. Uses precalc_atanyx (standard) + precalc_sumsq. RNG:
// `n = floor(cpow_power * rand01())` — same shape as julian. Caller supplies
// `randBranch ∈ [0, |cpow_power|-1]`.
//
// Caller MUST provide:
//   - i.params.cpow_r / cpow_i / cpow_power
//   - i.randBranch (integer in [0, |cpow_power|-1])
export function ts_var_cpow(i: VarInput): VarOutput {
  const r_param = i.params?.['cpow_r'];
  const i_param = i.params?.['cpow_i'];
  const power = i.params?.['cpow_power'];
  if (r_param === undefined || i_param === undefined || power === undefined) {
    throw new Error(`ts_var_cpow: requires params.cpow_r, .cpow_i, .cpow_power`);
  }
  if (i.randBranch === undefined || i.randBranch < 0 || i.randBranch >= Math.abs(power)) {
    throw new Error(`ts_var_cpow: randBranch must be ∈ [0, |cpow_power|-1], got ${i.randBranch}`);
  }
  const a = Math.atan2(i.ty, i.tx);
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const lnr = 0.5 * Math.log(sumsq);
  const va = (2.0 * PI) / power;
  const vc = r_param / power;
  const vd = i_param / power;
  const ang = vc * a + vd * lnr + va * i.randBranch;
  const m = i.weight * Math.exp(vc * lnr - vd * a);
  return { x: m * Math.cos(ang), y: m * Math.sin(ang) };
}

// var_curve — flam3 var60_curve (variations.c:1312). 4 params (curve_xamp,
// curve_yamp, curve_xlength, curve_ylength). Gaussian-falloff perturbation
// on each axis. flam3 clamps xlength² / ylength² to 1e-20 minimum.
//
// Caller MUST provide:
//   - i.params.curve_xamp / curve_yamp / curve_xlength / curve_ylength
export function ts_var_curve(i: VarInput): VarOutput {
  const xamp = i.params?.['curve_xamp'];
  const yamp = i.params?.['curve_yamp'];
  const xlen = i.params?.['curve_xlength'];
  const ylen = i.params?.['curve_ylength'];
  if (xamp === undefined || yamp === undefined || xlen === undefined || ylen === undefined) {
    throw new Error(`ts_var_curve: requires params.curve_xamp, .curve_yamp, .curve_xlength, .curve_ylength`);
  }
  const pc_xlen = Math.max(xlen * xlen, 1e-20);
  const pc_ylen = Math.max(ylen * ylen, 1e-20);
  return {
    x: i.weight * (i.tx + xamp * Math.exp((-i.ty * i.ty) / pc_xlen)),
    y: i.weight * (i.ty + yamp * Math.exp((-i.tx * i.tx) / pc_ylen)),
  };
}

// =====================================================================
// Phase 9b Batch D — RNG-using kernels. juliascope uses discrete branch
// (testable via runMultiBranchRng). Others use continuous rand values
// via i.randValues; smoke-tested only until rand-capture infra ships
// (BACKLOG entry: Phase 9b RNG test infra).
// =====================================================================

function expectRandValues(name: string, i: VarInput, n: number): number[] {
  const rv = i.randValues;
  if (rv === undefined || rv.length < n) {
    throw new Error(`${name}: requires randValues array of length >= ${n}`);
  }
  return rv;
}

// var_noise — flam3 var31_noise (variations.c:696). 0 params + 2 rand calls.
//   tmpr = rand0 * 2π;  r = w * rand1;  out = (tx*r*cos(tmpr), ty*r*sin(tmpr))
export function ts_var_noise(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_noise', i, 2);
  const tmpr = rv[0]! * 2 * PI;
  const r = i.weight * rv[1]!;
  return { x: i.tx * r * Math.cos(tmpr), y: i.ty * r * Math.sin(tmpr) };
}

// var_blur — flam3 var34_blur (variations.c:746). 0 params + 2 rand calls.
//   Same structure as noise but output is just (r*cos, r*sin) — produces a
//   uniform disc of radius w, independent of input position.
export function ts_var_blur(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_blur', i, 2);
  const tmpr = rv[0]! * 2 * PI;
  const r = i.weight * rv[1]!;
  return { x: r * Math.cos(tmpr), y: r * Math.sin(tmpr) };
}

// var_gaussian_blur — flam3 var35_gaussian (variations.c:760). 0 params + 4
// rand calls. Sum of 4 uniform [0,1) minus 2.0 approximates a Gaussian via
// central limit theorem. Output is a Gaussian-distributed point around origin.
export function ts_var_gaussian_blur(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_gaussian_blur', i, 5);
  const ang = rv[0]! * 2 * PI;
  const r = i.weight * (rv[1]! + rv[2]! + rv[3]! + rv[4]! - 2.0);
  return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
}

// var_arch — flam3 var41_arch (variations.c:857). 0 params + 1 rand call.
// Non-standard weight handling (flam3 comment). cos≈0 → ±Inf → reseed.
export function ts_var_arch(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_arch', i, 1);
  const ang = rv[0]! * i.weight * PI;
  const sinr = Math.sin(ang);
  const cosr = Math.cos(ang);
  return { x: i.weight * sinr, y: (i.weight * (sinr * sinr)) / cosr };
}

// var_radial_blur — flam3 var36_radial_blur (variations.c:775). 1 param
// (radial_blur_angle) + 4 rand calls (pseudo-gaussian). flam3 precomputes
// `radialBlur_spinvar = sin(angle * π/2)` and `radialBlur_zoomvar = cos(angle * π/2)`
// per-xform; pyr3 inlines (disc2 / perspective precedent).
//
// Caller MUST provide:
//   - i.params.radial_blur_angle
//   - i.randValues: 4 uniform [0,1) values for the pseudo-gaussian
export function ts_var_radial_blur(i: VarInput): VarOutput {
  const angle = i.params?.['radial_blur_angle'];
  if (angle === undefined) throw new Error(`ts_var_radial_blur: requires params.radial_blur_angle`);
  const rv = expectRandValues('ts_var_radial_blur', i, 4);
  const half_pi_angle = angle * (PI * 0.5);
  const spinvar = Math.sin(half_pi_angle);
  const zoomvar = Math.cos(half_pi_angle);
  const rndG = i.weight * (rv[0]! + rv[1]! + rv[2]! + rv[3]! - 2.0);
  const ra = Math.hypot(i.tx, i.ty);
  const tmpa = Math.atan2(i.ty, i.tx) + spinvar * rndG;
  const sa = Math.sin(tmpa);
  const ca = Math.cos(tmpa);
  const rz = zoomvar * rndG - 1;
  return { x: ra * ca + rz * i.tx, y: ra * sa + rz * i.ty };
}

// var_juliascope — flam3 var33_juliaScope (variations.c:725). 2 params
// (juliascope_power, juliascope_dist) + RNG. Like julian but the parity of
// t_rnd flips the sign on the precalc_atanyx contribution.
//
// Caller MUST provide:
//   - i.params.juliascope_power / juliascope_dist
//   - i.randBranch: integer ∈ [0, |juliascope_power|-1]
export function ts_var_juliascope(i: VarInput): VarOutput {
  const power = i.params?.['juliascope_power'];
  const dist = i.params?.['juliascope_dist'];
  if (power === undefined || dist === undefined) {
    throw new Error(`ts_var_juliascope: requires params.juliascope_power and params.juliascope_dist`);
  }
  if (i.randBranch === undefined || i.randBranch < 0 || i.randBranch >= Math.abs(power)) {
    throw new Error(`ts_var_juliascope: randBranch must be ∈ [0, |power|-1], got ${i.randBranch}`);
  }
  const phi = Math.atan2(i.ty, i.tx);
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const t_rnd = i.randBranch;
  const tmpr = (t_rnd & 1) === 0
    ? (2 * PI * t_rnd + phi) / power
    : (2 * PI * t_rnd - phi) / power;
  const r = i.weight * Math.pow(sumsq, dist / power / 2.0);
  return { x: r * Math.cos(tmpr), y: r * Math.sin(tmpr) };
}

// var_square — flam3 var43_square (variations.c:900). 0 params + 2 rand calls.
// Generates a point in [-w/2, w/2] × [-w/2, w/2] independent of input.
export function ts_var_square(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_square', i, 2);
  return { x: i.weight * (rv[0]! - 0.5), y: i.weight * (rv[1]! - 0.5) };
}

// var_rays — flam3 var44_rays (variations.c:915). 0 params + 1 rand call.
// Non-standard weight handling. precalc_sumsq + EPS denominator.
export function ts_var_rays(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_rays', i, 1);
  const ang = i.weight * rv[0]! * PI;
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const r = i.weight / (sumsq + VAR_EPS);
  const tanr = i.weight * Math.tan(ang) * r;
  return { x: tanr * Math.cos(i.tx), y: tanr * Math.sin(i.ty) };
}

// var_blade — flam3 var45_blade (variations.c:946). 0 params + 1 rand call.
// Non-standard weight handling. Both x and y output use `tx` (not ty) — that
// is flam3's actual behavior, not a typo.
export function ts_var_blade(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_blade', i, 1);
  const r = rv[0]! * i.weight * Math.hypot(i.tx, i.ty);
  const sinr = Math.sin(r);
  const cosr = Math.cos(r);
  return {
    x: i.weight * i.tx * (cosr + sinr),
    y: i.weight * i.tx * (cosr - sinr),
  };
}

// var_twintrian — flam3 var47_twintrian (variations.c:998). 0 params + 1
// rand call. log10(sinr²) can be -Inf; flam3 clamps `diff = -30` via its
// own `badvalue` check inside the kernel — pyr3 mirrors that clamp.
// `tx` (not ty) intentional on the y output per flam3.
export function ts_var_twintrian(i: VarInput): VarOutput {
  const rv = expectRandValues('ts_var_twintrian', i, 1);
  const r = rv[0]! * i.weight * Math.hypot(i.tx, i.ty);
  const sinr = Math.sin(r);
  const cosr = Math.cos(r);
  let diff = Math.log10(sinr * sinr) + cosr;
  // flam3 private.h:22 `badvalue(x) ((x) != (x) || (x) > 1e10 || (x) < -1e10)`
  if (diff !== diff || diff > 1e10 || diff < -1e10) diff = -30.0;
  return {
    x: i.weight * i.tx * diff,
    y: i.weight * i.tx * (diff - sinr * PI),
  };
}

// =====================================================================
// Phase 9b Batch E — 14 transcendental function kernels (flam3 var82..95).
// All 0-param, no RNG, no affine. log uses precalc_atanyx + precalc_sumsq.
// =====================================================================

// var_exp — flam3 var82_exp (variations.c:1747). exp(tx) * (cos(ty), sin(ty)).
// Distinct from var18_exponential (V=24) which uses exp(tx-1) * (cos(π·ty), sin(π·ty)).
export function ts_var_exp(i: VarInput): VarOutput {
  const e = Math.exp(i.tx);
  return { x: i.weight * e * Math.cos(i.ty), y: i.weight * e * Math.sin(i.ty) };
}

// var_log — flam3 var83_log (variations.c:1756). Uses precalc_atanyx (standard
// atan2(ty, tx)) + precalc_sumsq. Output is half_log(sumsq) on x, atan2(ty, tx) on y.
// log(0) = -Inf when p=0 → bad-value retry. Matches flam3.
export function ts_var_log(i: VarInput): VarOutput {
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  return {
    x: i.weight * 0.5 * Math.log(sumsq),
    y: i.weight * Math.atan2(i.ty, i.tx),
  };
}

// var_sin — flam3 var84_sin (variations.c:1763). sin(tx)·cosh(ty), cos(tx)·sinh(ty).
export function ts_var_sin(i: VarInput): VarOutput {
  return {
    x: i.weight * Math.sin(i.tx) * Math.cosh(i.ty),
    y: i.weight * Math.cos(i.tx) * Math.sinh(i.ty),
  };
}

// var_cos — flam3 var85_cos (variations.c:1773). cos(tx)·cosh(ty), −sin(tx)·sinh(ty).
// Note flam3 line 1780 uses `p1 -=` (subtract, not add).
export function ts_var_cos(i: VarInput): VarOutput {
  return {
    x: i.weight * Math.cos(i.tx) * Math.cosh(i.ty),
    y: -i.weight * Math.sin(i.tx) * Math.sinh(i.ty),
  };
}

// var_tan — flam3 var86_tan (variations.c:1783). Complex tan formula:
//   denom = 1/(cos(2·tx) + cosh(2·ty));  out = denom · (sin(2·tx), sinh(2·ty))
// At denom=0 (cos(2·tx) ≈ −cosh(2·ty)) → ±Inf → retry. Matches flam3.
export function ts_var_tan(i: VarInput): VarOutput {
  const den = 1.0 / (Math.cos(2 * i.tx) + Math.cosh(2 * i.ty));
  return {
    x: i.weight * den * Math.sin(2 * i.tx),
    y: i.weight * den * Math.sinh(2 * i.ty),
  };
}

// var_sec — flam3 var87_sec (variations.c:1795).
//   denom = 2/(cos(2·tx) + cosh(2·ty));  out = denom · (cos(tx)·cosh(ty), sin(tx)·sinh(ty))
export function ts_var_sec(i: VarInput): VarOutput {
  const den = 2.0 / (Math.cos(2 * i.tx) + Math.cosh(2 * i.ty));
  return {
    x: i.weight * den * Math.cos(i.tx) * Math.cosh(i.ty),
    y: i.weight * den * Math.sin(i.tx) * Math.sinh(i.ty),
  };
}

// var_csc — flam3 var88_csc (variations.c:1807).
//   denom = 2/(cosh(2·ty) − cos(2·tx));  out_x = denom · sin(tx) · cosh(ty);
//   out_y = −denom · cos(tx) · sinh(ty)  (note `-=` in flam3 line 1816)
export function ts_var_csc(i: VarInput): VarOutput {
  const den = 2.0 / (Math.cosh(2 * i.ty) - Math.cos(2 * i.tx));
  return {
    x: i.weight * den * Math.sin(i.tx) * Math.cosh(i.ty),
    y: -i.weight * den * Math.cos(i.tx) * Math.sinh(i.ty),
  };
}

// var_cot — flam3 var89_cot (variations.c:1819).
//   denom = 1/(cosh(2·ty) − cos(2·tx));  out = denom · (sin(2·tx), −sinh(2·ty))
export function ts_var_cot(i: VarInput): VarOutput {
  const den = 1.0 / (Math.cosh(2 * i.ty) - Math.cos(2 * i.tx));
  return {
    x: i.weight * den * Math.sin(2 * i.tx),
    y: -i.weight * den * Math.sinh(2 * i.ty),
  };
}

// var_sinh — flam3 var90_sinh (variations.c:1831). sinh(tx)·cos(ty), cosh(tx)·sin(ty).
export function ts_var_sinh(i: VarInput): VarOutput {
  return {
    x: i.weight * Math.sinh(i.tx) * Math.cos(i.ty),
    y: i.weight * Math.cosh(i.tx) * Math.sin(i.ty),
  };
}

// var_cosh — flam3 var91_cosh (variations.c:1841). cosh(tx)·cos(ty), sinh(tx)·sin(ty).
export function ts_var_cosh(i: VarInput): VarOutput {
  return {
    x: i.weight * Math.cosh(i.tx) * Math.cos(i.ty),
    y: i.weight * Math.sinh(i.tx) * Math.sin(i.ty),
  };
}

// var_tanh — flam3 var92_tanh (variations.c:1851).
//   denom = 1/(cos(2·ty) + cosh(2·tx));  out = denom · (sinh(2·tx), sin(2·ty))
export function ts_var_tanh(i: VarInput): VarOutput {
  const den = 1.0 / (Math.cos(2 * i.ty) + Math.cosh(2 * i.tx));
  return {
    x: i.weight * den * Math.sinh(2 * i.tx),
    y: i.weight * den * Math.sin(2 * i.ty),
  };
}

// var_sech — flam3 var93_sech (variations.c:1863).
//   denom = 2/(cos(2·ty) + cosh(2·tx));  out_x = denom · cos(ty) · cosh(tx);
//   out_y = −denom · sin(ty) · sinh(tx)
export function ts_var_sech(i: VarInput): VarOutput {
  const den = 2.0 / (Math.cos(2 * i.ty) + Math.cosh(2 * i.tx));
  return {
    x: i.weight * den * Math.cos(i.ty) * Math.cosh(i.tx),
    y: -i.weight * den * Math.sin(i.ty) * Math.sinh(i.tx),
  };
}

// var_csch — flam3 var94_csch (variations.c:1875).
//   denom = 2/(cosh(2·tx) − cos(2·ty));  out_x = denom · sinh(tx) · cos(ty);
//   out_y = −denom · cosh(tx) · sin(ty)
export function ts_var_csch(i: VarInput): VarOutput {
  const den = 2.0 / (Math.cosh(2 * i.tx) - Math.cos(2 * i.ty));
  return {
    x: i.weight * den * Math.sinh(i.tx) * Math.cos(i.ty),
    y: -i.weight * den * Math.cosh(i.tx) * Math.sin(i.ty),
  };
}

// var_coth — flam3 var95_coth (variations.c:1887).
//   denom = 1/(cosh(2·tx) − cos(2·ty));  out = denom · (sinh(2·tx), sin(2·ty))
export function ts_var_coth(i: VarInput): VarOutput {
  const den = 1.0 / (Math.cosh(2 * i.tx) - Math.cos(2 * i.ty));
  return {
    x: i.weight * den * Math.sinh(2 * i.tx),
    y: i.weight * den * Math.sin(2 * i.ty),
  };
}

// Batch F builders (all 0-param).

// =====================================================================
// Phase 9b Batch F — 0-param non-RNG kernels.
// =====================================================================

// var_butterfly — flam3 var57_butterfly (variations.c:1238). 0 params.
// wx = w * 4/sqrt(3*pi) ≈ 1.302940 (flam3 inlines the constant).
export function ts_var_butterfly(i: VarInput): VarOutput {
  const wx = i.weight * 1.3029400317411197908970256609023;
  const y2 = i.ty * 2.0;
  const r = wx * Math.sqrt(Math.abs(i.ty * i.tx) / (VAR_EPS + i.tx * i.tx + y2 * y2));
  return { x: r * i.tx, y: r * y2 };
}

// var_edisc — flam3 var61_edisc (variations.c:1328). 0 params. Uses precalc_sumsq.
// w / 11.57034632 is flam3's magic normalization constant.
export function ts_var_edisc(i: VarInput): VarOutput {
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const tmp = sumsq + 1.0;
  const tmp2 = 2.0 * i.tx;
  const r1 = Math.sqrt(tmp + tmp2);
  const r2 = Math.sqrt(tmp - tmp2);
  const xmax = (r1 + r2) * 0.5;
  const a1 = Math.log(xmax + Math.sqrt(xmax - 1.0));
  const a2 = -Math.acos(i.tx / xmax);
  const w = i.weight / 11.57034632;
  let snv = Math.sin(a1);
  const csv = Math.cos(a1);
  const snhu = Math.sinh(a2);
  const cshu = Math.cosh(a2);
  if (i.ty > 0.0) snv = -snv;
  return { x: w * cshu * csv, y: w * snhu * snv };
}

// var_elliptic — flam3 var62_elliptic (variations.c:1354). 0 params. Uses precalc_sumsq.
// w / (π/2) normalization. Conditional log sign on y based on sign of ty.
export function ts_var_elliptic(i: VarInput): VarOutput {
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const tmp = sumsq + 1.0;
  const x2 = 2.0 * i.tx;
  const xmax = 0.5 * (Math.sqrt(tmp + x2) + Math.sqrt(tmp - x2));
  const a = i.tx / xmax;
  const b_raw = 1.0 - a * a;
  const ssx_raw = xmax - 1.0;
  const b = b_raw < 0 ? 0 : Math.sqrt(b_raw);
  const ssx = ssx_raw < 0 ? 0 : Math.sqrt(ssx_raw);
  const w = i.weight / (Math.PI * 0.5);
  const yLog = w * Math.log(xmax + ssx);
  return {
    x: w * Math.atan2(a, b),
    y: i.ty > 0 ? yLog : -yLog,
  };
}

// var_foci — flam3 var64_foci (variations.c:1412). 0 params.
//   expx = exp(tx) * 0.5;  expnx = 0.25 / expx;
//   tmp = w / (expx + expnx - cos(ty));  out = tmp · (expx - expnx, sin(ty))
export function ts_var_foci(i: VarInput): VarOutput {
  const expx = Math.exp(i.tx) * 0.5;
  const expnx = 0.25 / expx;
  const tmp = i.weight / (expx + expnx - Math.cos(i.ty));
  return { x: tmp * (expx - expnx), y: tmp * Math.sin(i.ty) };
}

// var_loonie — flam3 var66_loonie (variations.c:1456). 0 params + non-standard
// weight handling. Uses precalc_sumsq.
//   if r² < w²:  r = w · sqrt(w²/r² - 1);  out = r · (tx, ty)
//   else:        out = w · (tx, ty)
export function ts_var_loonie(i: VarInput): VarOutput {
  const r2 = i.tx * i.tx + i.ty * i.ty;
  const w2 = i.weight * i.weight;
  if (r2 < w2) {
    const r = i.weight * Math.sqrt(w2 / r2 - 1.0);
    return { x: r * i.tx, y: r * i.ty };
  }
  return { x: i.weight * i.tx, y: i.weight * i.ty };
}

// var_polar2 — flam3 var70_polar2 (variations.c:1544). 0 params. Uses
// precalc_atan (atan_xy, SWAPPED) + precalc_sumsq.
//   p2v = w/π;  out = (p2v · atan2(tx, ty), p2v/2 · log(sumsq))
export function ts_var_polar2(i: VarInput): VarOutput {
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const p2v = i.weight / PI;
  // EPS guard on log matches pyr3 chaos.comp:1590 (WGSL var_polar2). Without
  // it, walkers near origin → log(0) = -∞ → splat at ±∞.
  return {
    x: p2v * Math.atan2(i.tx, i.ty),
    y: (p2v / 2.0) * Math.log(sumsq + VAR_EPS),
  };
}

// var_scry — flam3 var72_scry (variations.c:1563). 0 params + non-standard
// weight handling (per flam3 comment: weight not multiplied at output but
// values still approach 0 as weight → 0). Uses precalc_sqrt + precalc_sumsq.
//   r = 1 / (sqrt(sumsq) · (sumsq + 1/(w+EPS)));  out = (tx, ty) · r
export function ts_var_scry(i: VarInput): VarOutput {
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const sqrtSumsq = Math.sqrt(sumsq);
  const r = 1.0 / (sqrtSumsq * (sumsq + 1.0 / (i.weight + VAR_EPS)));
  return { x: i.tx * r, y: i.ty * r };
}

// Batch G builders.

// =====================================================================
// Phase 9b Batch G — 1-2 param non-RNG kernels.
// =====================================================================

// var_bent2 — flam3 var54_bent2 (variations.c:1164). 2 params.
export function ts_var_bent2(i: VarInput): VarOutput {
  const bx = i.params?.['bent2_x'];
  const by = i.params?.['bent2_y'];
  if (bx === undefined || by === undefined) throw new Error(`ts_var_bent2: requires params.bent2_x, .bent2_y`);
  const nx = i.tx < 0 ? i.tx * bx : i.tx;
  const ny = i.ty < 0 ? i.ty * by : i.ty;
  return { x: i.weight * nx, y: i.weight * ny };
}

// var_cell — flam3 var58_cell (variations.c:1253). 1 param (cell_size).
// flam3 uses `p1 -=` (subtract) on y output — pyr3 mirrors.
export function ts_var_cell(i: VarInput): VarOutput {
  const size = i.params?.['cell_size'];
  if (size === undefined) throw new Error(`ts_var_cell: requires params.cell_size`);
  const inv = 1.0 / size;
  let x = Math.floor(i.tx * inv);
  let y = Math.floor(i.ty * inv);
  const dx = i.tx - x * size;
  const dy = i.ty - y * size;
  if (y >= 0) {
    if (x >= 0) { y *= 2; x *= 2; }
    else { y *= 2; x = -(2 * x + 1); }
  } else {
    if (x >= 0) { y = -(2 * y + 1); x *= 2; }
    else { y = -(2 * y + 1); x = -(2 * x + 1); }
  }
  return {
    x: i.weight * (dx + x * size),
    y: -i.weight * (dy + y * size),
  };
}

// var_escher — flam3 var63_escher (variations.c:1385). 1 param (escher_beta).
// Uses precalc_atanyx + precalc_sumsq. Similar shape to cpow but no RNG.
export function ts_var_escher(i: VarInput): VarOutput {
  const beta = i.params?.['escher_beta'];
  if (beta === undefined) throw new Error(`ts_var_escher: requires params.escher_beta`);
  const a = Math.atan2(i.ty, i.tx);
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const lnr = 0.5 * Math.log(sumsq);
  const seb = Math.sin(beta);
  const ceb = Math.cos(beta);
  const vc = 0.5 * (1.0 + ceb);
  const vd = 0.5 * seb;
  const m = i.weight * Math.exp(vc * lnr - vd * a);
  const n = vc * a + vd * lnr;
  return { x: m * Math.cos(n), y: m * Math.sin(n) };
}

// var_modulus — flam3 var68_modulus (variations.c:1498). 2 params.
export function ts_var_modulus(i: VarInput): VarOutput {
  const mx = i.params?.['modulus_x'];
  const my = i.params?.['modulus_y'];
  if (mx === undefined || my === undefined) throw new Error(`ts_var_modulus: requires params.modulus_x, .modulus_y`);
  const xr = 2 * mx;
  const yr = 2 * my;
  let outX: number;
  if (i.tx > mx) outX = i.weight * (-mx + ((i.tx + mx) % xr));
  else if (i.tx < -mx) outX = i.weight * (mx - ((mx - i.tx) % xr));
  else outX = i.weight * i.tx;
  let outY: number;
  if (i.ty > my) outY = i.weight * (-my + ((i.ty + my) % yr));
  else if (i.ty < -my) outY = i.weight * (my - ((my - i.ty) % yr));
  else outY = i.weight * i.ty;
  return { x: outX, y: outY };
}

// var_split — flam3 var74_split (variations.c:1603). 2 params.
// Note flam3's swap: output y reads cos(tx*xsize*π), output x reads cos(ty*ysize*π).
export function ts_var_split(i: VarInput): VarOutput {
  const xs = i.params?.['split_xsize'];
  const ys = i.params?.['split_ysize'];
  if (xs === undefined || ys === undefined) throw new Error(`ts_var_split: requires params.split_xsize, .split_ysize`);
  const outY = Math.cos(i.tx * xs * PI) >= 0 ? i.weight * i.ty : -i.weight * i.ty;
  const outX = Math.cos(i.ty * ys * PI) >= 0 ? i.weight * i.tx : -i.weight * i.tx;
  return { x: outX, y: outY };
}

// var_splits — flam3 var75_splits (variations.c:1619). 2 params.
export function ts_var_splits(i: VarInput): VarOutput {
  const sx = i.params?.['splits_x'];
  const sy = i.params?.['splits_y'];
  if (sx === undefined || sy === undefined) throw new Error(`ts_var_splits: requires params.splits_x, .splits_y`);
  const outX = i.tx >= 0 ? i.weight * (i.tx + sx) : i.weight * (i.tx - sx);
  const outY = i.ty >= 0 ? i.weight * (i.ty + sy) : i.weight * (i.ty - sy);
  return { x: outX, y: outY };
}

// var_stripes — flam3 var76_stripes (variations.c:1635). 2 params (space, warp).
export function ts_var_stripes(i: VarInput): VarOutput {
  const space = i.params?.['stripes_space'];
  const warp = i.params?.['stripes_warp'];
  if (space === undefined || warp === undefined) throw new Error(`ts_var_stripes: requires params.stripes_space, .stripes_warp`);
  const roundx = Math.floor(i.tx + 0.5);
  const offsetx = i.tx - roundx;
  return {
    x: i.weight * (offsetx * (1.0 - space) + roundx),
    y: i.weight * (i.ty + offsetx * offsetx * warp),
  };
}

// var_whorl — flam3 var80_whorl (variations.c:1710). 2 params. Non-standard weight.
// When r==weight, 1/(weight-r) is ±Inf → retry path catches.
export function ts_var_whorl(i: VarInput): VarOutput {
  const inside = i.params?.['whorl_inside'];
  const outside = i.params?.['whorl_outside'];
  if (inside === undefined || outside === undefined) throw new Error(`ts_var_whorl: requires params.whorl_inside, .whorl_outside`);
  const r = Math.hypot(i.tx, i.ty);
  const baseAng = Math.atan2(i.ty, i.tx);
  const a = r < i.weight
    ? baseAng + inside / (i.weight - r)
    : baseAng + outside / (i.weight - r);
  return { x: i.weight * r * Math.cos(a), y: i.weight * r * Math.sin(a) };
}

// var_flux — flam3 var97_flux (variations.c:1911). 1 param (flux_spread).
export function ts_var_flux(i: VarInput): VarOutput {
  const spread = i.params?.['flux_spread'];
  if (spread === undefined) throw new Error(`ts_var_flux: requires params.flux_spread`);
  const xpw = i.tx + i.weight;
  const xmw = i.tx - i.weight;
  const tysq = i.ty * i.ty;
  const avgr = i.weight * (2 + spread) * Math.sqrt(Math.sqrt(tysq + xpw * xpw) / Math.sqrt(tysq + xmw * xmw));
  const avga = (Math.atan2(i.ty, xmw) - Math.atan2(i.ty, xpw)) * 0.5;
  return { x: avgr * Math.cos(avga), y: avgr * Math.sin(avga) };
}

// Batch H builders.

// =====================================================================
// Phase 9b Batch H — 3-4-param non-RNG kernels.
// =====================================================================

// var_popcorn2 — flam3 var71_popcorn2 (variations.c:1554). 3 params (x, y, c).
export function ts_var_popcorn2(i: VarInput): VarOutput {
  const px = i.params?.['popcorn2_x'];
  const py = i.params?.['popcorn2_y'];
  const pc = i.params?.['popcorn2_c'];
  if (px === undefined || py === undefined || pc === undefined) throw new Error(`ts_var_popcorn2: requires params.popcorn2_x, .popcorn2_y, .popcorn2_c`);
  return {
    x: i.weight * (i.tx + px * Math.sin(Math.tan(i.ty * pc))),
    y: i.weight * (i.ty + py * Math.sin(Math.tan(i.tx * pc))),
  };
}

// var_lazysusan — flam3 var65_lazysusan (variations.c:1428). 5 params.
// Branches on r < weight. lazysusan_y SUBTRACTED on y output.
export function ts_var_lazysusan(i: VarInput): VarOutput {
  const lx = i.params?.['lazysusan_x'];
  const ly = i.params?.['lazysusan_y'];
  const spin = i.params?.['lazysusan_spin'];
  const twist = i.params?.['lazysusan_twist'];
  const space = i.params?.['lazysusan_space'];
  if (lx === undefined || ly === undefined || spin === undefined || twist === undefined || space === undefined) {
    throw new Error(`ts_var_lazysusan: requires params.lazysusan_x, .lazysusan_y, .lazysusan_spin, .lazysusan_twist, .lazysusan_space`);
  }
  const x = i.tx - lx;
  const y = i.ty + ly;
  let r = Math.hypot(x, y);
  if (r < i.weight) {
    const a = Math.atan2(y, x) + spin + twist * (i.weight - r);
    r = i.weight * r;
    return { x: r * Math.cos(a) + lx, y: r * Math.sin(a) - ly };
  }
  r = i.weight * (1.0 + space / r);
  return { x: r * x + lx, y: r * y - ly };
}

// var_waves2 — flam3 var81_waves2 (variations.c:1735). 4 params.
export function ts_var_waves2(i: VarInput): VarOutput {
  const sx = i.params?.['waves2_scalex'];
  const fx = i.params?.['waves2_freqx'];
  const sy = i.params?.['waves2_scaley'];
  const fy = i.params?.['waves2_freqy'];
  if (sx === undefined || fx === undefined || sy === undefined || fy === undefined) throw new Error(`ts_var_waves2: requires params.waves2_scalex, .waves2_freqx, .waves2_scaley, .waves2_freqy`);
  return {
    x: i.weight * (i.tx + sx * Math.sin(i.ty * fx)),
    y: i.weight * (i.ty + sy * Math.sin(i.tx * fy)),
  };
}

// var_oscope — flam3 var69_oscope (variations.c:1521). 4 params.
// flam3 uses `p1 -=` inside the envelope (|ty|<=t).
export function ts_var_oscope(i: VarInput): VarOutput {
  const freq = i.params?.['oscope_frequency'];
  const amp = i.params?.['oscope_amplitude'];
  const damping = i.params?.['oscope_damping'];
  const sep = i.params?.['oscope_separation'];
  if (freq === undefined || amp === undefined || damping === undefined || sep === undefined) throw new Error(`ts_var_oscope: requires params.oscope_frequency, .oscope_amplitude, .oscope_damping, .oscope_separation`);
  const tpf = 2 * PI * freq;
  const t = damping === 0
    ? amp * Math.cos(tpf * i.tx) + sep
    : amp * Math.exp(-Math.abs(i.tx) * damping) * Math.cos(tpf * i.tx) + sep;
  if (Math.abs(i.ty) <= t) {
    return { x: i.weight * i.tx, y: -i.weight * i.ty };
  }
  return { x: i.weight * i.tx, y: i.weight * i.ty };
}

// var_separation — flam3 var73_separation (variations.c:1584). 4 params.
export function ts_var_separation(i: VarInput): VarOutput {
  const sx = i.params?.['separation_x'];
  const sxi = i.params?.['separation_xinside'];
  const sy = i.params?.['separation_y'];
  const syi = i.params?.['separation_yinside'];
  if (sx === undefined || sxi === undefined || sy === undefined || syi === undefined) throw new Error(`ts_var_separation: requires params.separation_x, .separation_xinside, .separation_y, .separation_yinside`);
  const sx2 = sx * sx;
  const sy2 = sy * sy;
  const outX = i.tx > 0
    ? i.weight * (Math.sqrt(i.tx * i.tx + sx2) - i.tx * sxi)
    : -i.weight * (Math.sqrt(i.tx * i.tx + sx2) + i.tx * sxi);
  const outY = i.ty > 0
    ? i.weight * (Math.sqrt(i.ty * i.ty + sy2) - i.ty * syi)
    : -i.weight * (Math.sqrt(i.ty * i.ty + sy2) + i.ty * syi);
  return { x: outX, y: outY };
}

// var_auger — flam3 var96_auger (variations.c:1899). 4 params.
// Note `auger_weight` is a PARAM, distinct from kernel `weight`.
export function ts_var_auger(i: VarInput): VarOutput {
  const freq = i.params?.['auger_freq'];
  const ww = i.params?.['auger_weight'];
  const scale = i.params?.['auger_scale'];
  const sym = i.params?.['auger_sym'];
  if (freq === undefined || ww === undefined || scale === undefined || sym === undefined) throw new Error(`ts_var_auger: requires params.auger_freq, .auger_weight, .auger_scale, .auger_sym`);
  const s = Math.sin(freq * i.tx);
  const t = Math.sin(freq * i.ty);
  const dy = i.ty + ww * (scale * s / 2.0 + Math.abs(i.ty) * s);
  const dx = i.tx + ww * (scale * t / 2.0 + Math.abs(i.tx) * t);
  return {
    x: i.weight * (i.tx + sym * (dx - i.tx)),
    y: i.weight * dy,
  };
}

// var_wedge_sph — flam3 var79_wedge_sph (variations.c:1689). 4 params.
// Like wedge but uses 1/(r+EPS) instead of r.
export function ts_var_wedge_sph(i: VarInput): VarOutput {
  const angle = i.params?.['wedge_sph_angle'];
  const hole = i.params?.['wedge_sph_hole'];
  const count = i.params?.['wedge_sph_count'];
  const swirl = i.params?.['wedge_sph_swirl'];
  if (angle === undefined || hole === undefined || count === undefined || swirl === undefined) throw new Error(`ts_var_wedge_sph: requires params.wedge_sph_angle, .wedge_sph_hole, .wedge_sph_count, .wedge_sph_swirl`);
  const r0 = Math.hypot(i.tx, i.ty);
  const r_inv = 1.0 / (r0 + VAR_EPS);
  let a = Math.atan2(i.ty, i.tx) + swirl * r_inv;
  const ONE_OVER_PI = 1.0 / PI;
  const c = Math.floor((count * a + PI) * ONE_OVER_PI * 0.5);
  const comp_fac = 1 - angle * count * ONE_OVER_PI * 0.5;
  a = a * comp_fac + c * angle;
  const r = i.weight * (r_inv + hole);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// Batch I builders. RNG-using; smoke-tested except wedge_julia (discrete-branch).


// =====================================================================
// Phase 9b Batch I — RNG-using 3-4 param kernels.
// Smoke-tested (continuous RNG infra not yet shipped) except wedge_julia
// which uses discrete branch like julian/cpow.
// =====================================================================

// var_super_shape — flam3 var50_supershape (variations.c:1092). 6 params + RNG.
// Uses precalc_atanyx + precalc_sqrt. flam3 precomputes pm_4 = m/4 and
// pneg1_n1 = -1/n1; pyr3 inlines.
export function ts_var_super_shape(i: VarInput): VarOutput {
  const rnd = i.params?.["super_shape_rnd"];
  const m = i.params?.["super_shape_m"];
  const n1 = i.params?.["super_shape_n1"];
  const n2 = i.params?.["super_shape_n2"];
  const n3 = i.params?.["super_shape_n3"];
  const holes = i.params?.["super_shape_holes"];
  if (rnd === undefined || m === undefined || n1 === undefined || n2 === undefined || n3 === undefined || holes === undefined) throw new Error("ts_var_super_shape: requires all 6 super_shape_* params");
  const rv = i.randValues;
  if (rv === undefined || rv.length < 1) throw new Error("ts_var_super_shape: requires randValues[0]");
  const pm_4 = m / 4;
  const pneg1_n1 = -1 / n1;
  const r0 = Math.hypot(i.tx, i.ty);
  const theta = pm_4 * Math.atan2(i.ty, i.tx) + Math.PI / 4;
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  const t1 = Math.pow(Math.abs(ct), n2);
  const t2 = Math.pow(Math.abs(st), n3);
  const r = i.weight * ((rnd * rv[0]! + (1 - rnd) * r0) - holes) * Math.pow(t1 + t2, pneg1_n1) / r0;
  return { x: r * i.tx, y: r * i.ty };
}

// var_flower — flam3 var51_flower (variations.c:1118). 2 params + RNG.
export function ts_var_flower(i: VarInput): VarOutput {
  const petals = i.params?.["flower_petals"];
  const holes = i.params?.["flower_holes"];
  if (petals === undefined || holes === undefined) throw new Error("ts_var_flower: requires params.flower_petals, .flower_holes");
  const rv = i.randValues;
  if (rv === undefined || rv.length < 1) throw new Error("ts_var_flower: requires randValues[0]");
  const theta = Math.atan2(i.ty, i.tx);
  const r0 = Math.hypot(i.tx, i.ty);
  const r = i.weight * (rv[0]! - holes) * Math.cos(petals * theta) / r0;
  return { x: r * i.tx, y: r * i.ty };
}

// var_conic — flam3 var52_conic (variations.c:1133). 2 params + RNG.
export function ts_var_conic(i: VarInput): VarOutput {
  const ecc = i.params?.["conic_eccentricity"];
  const holes = i.params?.["conic_holes"];
  if (ecc === undefined || holes === undefined) throw new Error("ts_var_conic: requires params.conic_eccentricity, .conic_holes");
  const rv = i.randValues;
  if (rv === undefined || rv.length < 1) throw new Error("ts_var_conic: requires randValues[0]");
  const r0 = Math.hypot(i.tx, i.ty);
  const ct = i.tx / r0;
  const r = i.weight * (rv[0]! - holes) * ecc / (1 + ecc * ct) / r0;
  return { x: r * i.tx, y: r * i.ty };
}

// var_parabola — flam3 var53_parabola (variations.c:1148). 2 params + 2 RNG.
export function ts_var_parabola(i: VarInput): VarOutput {
  const height = i.params?.["parabola_height"];
  const width = i.params?.["parabola_width"];
  if (height === undefined || width === undefined) throw new Error("ts_var_parabola: requires params.parabola_height, .parabola_width");
  const rv = i.randValues;
  if (rv === undefined || rv.length < 2) throw new Error("ts_var_parabola: requires randValues[0..1]");
  const r = Math.hypot(i.tx, i.ty);
  const sr = Math.sin(r);
  const cr = Math.cos(r);
  return {
    x: height * i.weight * sr * sr * rv[0]!,
    y: width * i.weight * cr * rv[1]!,
  };
}

// var_pie — flam3 var37_pie (variations.c:795). 3 params + 3 RNG.
export function ts_var_pie(i: VarInput): VarOutput {
  const slices = i.params?.["pie_slices"];
  const rotation = i.params?.["pie_rotation"];
  const thickness = i.params?.["pie_thickness"];
  if (slices === undefined || rotation === undefined || thickness === undefined) throw new Error("ts_var_pie: requires params.pie_slices, .pie_rotation, .pie_thickness");
  const rv = i.randValues;
  if (rv === undefined || rv.length < 3) throw new Error("ts_var_pie: requires randValues[0..2]");
  const sl = Math.trunc(rv[0]! * slices + 0.5);
  const a = rotation + 2 * Math.PI * (sl + rv[1]! * thickness) / slices;
  const r = i.weight * rv[2]!;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_boarders — flam3 var56_boarders (variations.c:1199). 0 params + 1 RNG.
// flam3 uses rint (round-half-to-even); pyr3 uses floor(x+0.5) — differs only
// at exact half-integers, negligible in practice.
export function ts_var_boarders(i: VarInput): VarOutput {
  const rv = i.randValues;
  if (rv === undefined || rv.length < 1) throw new Error("ts_var_boarders: requires randValues[0]");
  const roundX = Math.floor(i.tx + 0.5);
  const roundY = Math.floor(i.ty + 0.5);
  const offsetX = i.tx - roundX;
  const offsetY = i.ty - roundY;
  if (rv[0]! >= 0.75) {
    return { x: i.weight * (offsetX * 0.5 + roundX), y: i.weight * (offsetY * 0.5 + roundY) };
  }
  if (Math.abs(offsetX) >= Math.abs(offsetY)) {
    if (offsetX >= 0.0) {
      return { x: i.weight * (offsetX * 0.5 + roundX + 0.25), y: i.weight * (offsetY * 0.5 + roundY + 0.25 * offsetY / offsetX) };
    }
    return { x: i.weight * (offsetX * 0.5 + roundX - 0.25), y: i.weight * (offsetY * 0.5 + roundY - 0.25 * offsetY / offsetX) };
  }
  if (offsetY >= 0.0) {
    return { x: i.weight * (offsetX * 0.5 + roundX + offsetX / offsetY * 0.25), y: i.weight * (offsetY * 0.5 + roundY + 0.25) };
  }
  return { x: i.weight * (offsetX * 0.5 + roundX - offsetX / offsetY * 0.25), y: i.weight * (offsetY * 0.5 + roundY - 0.25) };
}

// var_wedge_julia — flam3 var78_wedge_julia (variations.c:1671). 4 params +
// DISCRETE RNG branch. Same shape as julian/cpow.
export function ts_var_wedge_julia(i: VarInput): VarOutput {
  const angle = i.params?.["wedge_julia_angle"];
  const count = i.params?.["wedge_julia_count"];
  const power = i.params?.["wedge_julia_power"];
  const dist = i.params?.["wedge_julia_dist"];
  if (angle === undefined || count === undefined || power === undefined || dist === undefined) throw new Error("ts_var_wedge_julia: requires all 4 wedge_julia_* params");
  if (i.randBranch === undefined || i.randBranch < 0 || i.randBranch >= Math.abs(power)) throw new Error("ts_var_wedge_julia: randBranch must be in [0, |power|-1]");
  const sumsq = i.tx * i.tx + i.ty * i.ty;
  const cn = dist / power / 2;
  const r = i.weight * Math.pow(sumsq, cn);
  const cf = 1 - angle * count / (2 * Math.PI);
  let a = (Math.atan2(i.ty, i.tx) + 2 * Math.PI * i.randBranch) / power;
  const c = Math.floor((count * a + Math.PI) / Math.PI * 0.5);
  a = a * cf + c * angle;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// Batch J builder.

// =====================================================================
// Phase 9b Batch J — pre_blur (flam3 var67_pre_blur, variations.c:1480).
// SPECIAL: this variation mutates the input position (tx, ty) — chaos.wgsl
// runs a separate 2-pass chain. The TS impl returns the DELTA to add to (tx, ty);
// callers must apply it themselves (the test harness does this).
//
// rndG = w · (r0 + r1 + r2 + r3 - 2.0)
// rndA = r4 · 2π
// delta = w · rndG · (cos(rndA), sin(rndA))
// =====================================================================

export function ts_var_pre_blur(i: VarInput): VarOutput {
  const rv = i.randValues;
  if (rv === undefined || rv.length < 5) throw new Error("ts_var_pre_blur: requires randValues[0..4]");
  const rndG = i.weight * (rv[0]! + rv[1]! + rv[2]! + rv[3]! - 2.0);
  const rndA = rv[4]! * 2 * Math.PI;
  // Note: weight already folded into rndG; do NOT multiply again here.
  return {
    x: Math.cos(rndA) * rndG,
    y: Math.sin(rndA) * rndG,
  };
}

// Batch K builder. mobius has 8 params — first kernel to consume the
// vars_extra2 slot (param6, param7).

// =====================================================================
// Phase 9b Batch K — mobius (flam3 var98_mobius, variations.c:1923).
// 8 params: complex coefficients (re_a + i·im_a)/(re_c + i·im_c) etc.
// =====================================================================

export function ts_var_mobius(i: VarInput): VarOutput {
  const re_a = i.params?.["mobius_re_a"];
  const im_a = i.params?.["mobius_im_a"];
  const re_b = i.params?.["mobius_re_b"];
  const im_b = i.params?.["mobius_im_b"];
  const re_c = i.params?.["mobius_re_c"];
  const im_c = i.params?.["mobius_im_c"];
  const re_d = i.params?.["mobius_re_d"];
  const im_d = i.params?.["mobius_im_d"];
  if (re_a === undefined || im_a === undefined || re_b === undefined || im_b === undefined ||
      re_c === undefined || im_c === undefined || re_d === undefined || im_d === undefined) {
    throw new Error(`ts_var_mobius: requires all 8 mobius_(re|im)_(a|b|c|d) params`);
  }
  // u = a·p + b (complex)
  const re_u = re_a * i.tx - im_a * i.ty + re_b;
  const im_u = re_a * i.ty + im_a * i.tx + im_b;
  // v = c·p + d (complex)
  const re_v = re_c * i.tx - im_c * i.ty + re_d;
  const im_v = re_c * i.ty + im_c * i.tx + im_d;
  // out = w · u / v (complex division)
  const rad_v = i.weight / (re_v * re_v + im_v * im_v);
  return {
    x: rad_v * (re_u * re_v + im_u * im_v),
    y: rad_v * (im_u * re_v - re_u * im_v),
  };
}

// =====================================================================
// #114 batch 2b-a — JWildfire S-tier first half.
// V109..V114. Source: JWildfire (LGPL-2.1+); see NOTICE.md.
// =====================================================================

// var_juliaq (chaos.wgsl) — JWildfire JuliaQFunc.java. 2 params
// (power, divisor) + 1 RNG call. Author: Peter Sdobnov ("Zueuk").
// Generalized julia — divisor over power decouples branch count
// from rotation. JWF's `random(Integer.MAX_VALUE) * inv_power_2pi`
// reduces to "pick discrete branch n in [0, power), rotate by
// n·(2π/power)" since adjacent integers fold mod 2π — equivalent
// to `floor(rand01() * |power|)`. randBranch (∈ [0, |power|)) is
// supplied externally so the impl is deterministic.
export function ts_var_juliaq(i: VarInput): VarOutput {
  const power = i.params?.["power"] ?? 3;
  const divisor = i.params?.["divisor"] ?? 2;
  const absPower = Math.max(1, Math.abs(power));
  const inv_power = divisor / power;
  const half_inv_power = 0.5 * inv_power;
  const inv_power_2pi = (2 * PI) / power;
  const branch = i.randBranch ?? 0;
  const a = Math.atan2(i.ty, i.tx) * inv_power + branch * inv_power_2pi;
  const r = i.weight * Math.pow(i.tx * i.tx + i.ty * i.ty, half_inv_power);
  // unused but referenced to keep eslint quiet on the precalc
  void absPower;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_glynnia (chaos.wgsl) — JWildfire GlynniaFunc.java. 0 params,
// 1 RNG call (discrete coin-flip branch). Author: eralex61. Two
// nested branches: outside vs inside unit disk × coin-flip → 4
// sub-formulas. precalc: _vvar2 = w·√2/2. randBranch ∈ {0, 1}.
export function ts_var_glynnia(i: VarInput): VarOutput {
  const branch = i.randBranch ?? 0;
  const vvar2 = i.weight * Math.SQRT2 * 0.5;
  const r = Math.sqrt(i.tx * i.tx + i.ty * i.ty);
  if (r >= 1.0) {
    if (branch === 1) {
      const d = Math.sqrt(r + i.tx);
      if (d === 0) return { x: 0, y: 0 };
      return { x: vvar2 * d, y: -(vvar2 / d) * i.ty };
    } else {
      const d = r + i.tx;
      const dx = Math.sqrt(r * (i.ty * i.ty + d * d));
      if (dx === 0) return { x: 0, y: 0 };
      const rr = i.weight / dx;
      return { x: rr * d, y: rr * i.ty };
    }
  } else {
    if (branch === 1) {
      const d = Math.sqrt(r + i.tx);
      if (d === 0) return { x: 0, y: 0 };
      return { x: -vvar2 * d, y: -(vvar2 / d) * i.ty };
    } else {
      const d = r + i.tx;
      const dx = Math.sqrt(r * (i.ty * i.ty + d * d));
      if (dx === 0) return { x: 0, y: 0 };
      const rr = i.weight / dx;
      return { x: -rr * d, y: rr * i.ty };
    }
  }
}

// var_loonie3 (chaos.wgsl) — JWildfire Loonie3Func.java. 0 params,
// no RNG. Author: dark-beam. Like loonie but the "radius" is
// (r²/x)² when x > SMALL_EPSILON, else 2·w² (escape-shape outside
// the right half-plane). precalc: _sqrvvar = w².
export function ts_var_loonie3(i: VarInput): VarOutput {
  const sqrvvar = i.weight * i.weight;
  let r2 = 2 * sqrvvar;
  const SMALL_EPSILON = 1e-30;
  if (i.tx > SMALL_EPSILON) {
    const num = i.tx * i.tx + i.ty * i.ty;
    const q = num / i.tx;
    r2 = q * q;
  }
  if (r2 < sqrvvar) {
    const rr = i.weight * Math.sqrt(sqrvvar / r2 - 1.0);
    return { x: rr * i.tx, y: rr * i.ty };
  }
  return { x: i.weight * i.tx, y: i.weight * i.ty };
}

// var_falloff (chaos.wgsl) — JWildfire Falloff2Func.java type=0 path
// (Xyrus02-origin). 6 params (scatter, mindist, mul_x, mul_y, x0, y0).
// 2 RNG calls. The simplest of the falloff family — moves each iterate
// away from (x0,y0) by a distance-weighted random offset. Z-axis
// params (mul_z/z0/mul_c/invert) dropped to fit pyr3's 2D engine;
// the type selector is dropped here (caller wants only type=0); the
// `falloff2` entry handles all three branches. Documented in the
// catalog blurb. randValues[0..1] supply the two pContext.random()
// draws.
export function ts_var_falloff(i: VarInput): VarOutput {
  const scatter = i.params?.["scatter"] ?? 1;
  const mindist = i.params?.["mindist"] ?? 0.5;
  const mul_x = i.params?.["mul_x"] ?? 1;
  const mul_y = i.params?.["mul_y"] ?? 1;
  const x0 = i.params?.["x0"] ?? 0;
  const y0 = i.params?.["y0"] ?? 0;
  const rmax = 0.04 * scatter;
  const dx = i.tx - x0;
  const dy = i.ty - y0;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0) d = 0;
  d = (d - mindist) * rmax;
  if (d < 0) d = 0;
  const r0 = i.randValues?.[0] ?? 0;
  const r1 = i.randValues?.[1] ?? 0;
  return {
    x: i.weight * (i.tx + mul_x * r0 * d),
    y: i.weight * (i.ty + mul_y * r1 * d),
  };
}

// var_falloff2 (chaos.wgsl) — JWildfire Falloff2Func.java FULL (all 3
// type branches: 0=default, 1=radial, 2=gaussian). 7 params
// (scatter, type, mul_x, mul_y, x0, y0, mindist). 2–4 RNG calls
// depending on branch. Author: Xyrus02. Z-axis params + invert + mul_c
// dropped to fit the 2D engine and 8-slot seam.
export function ts_var_falloff2(i: VarInput): VarOutput {
  const scatter = i.params?.["scatter"] ?? 1;
  const typ = Math.max(0, Math.min(2, Math.trunc(i.params?.["type"] ?? 0)));
  const mul_x = i.params?.["mul_x"] ?? 1;
  const mul_y = i.params?.["mul_y"] ?? 1;
  const x0 = i.params?.["x0"] ?? 0;
  const y0 = i.params?.["y0"] ?? 0;
  const mindist = i.params?.["mindist"] ?? 0.5;
  const rmax = 0.04 * scatter;
  const dx = i.tx - x0;
  const dy = i.ty - y0;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0) d = 0;
  d = (d - mindist) * rmax;
  if (d < 0) d = 0;
  const r0 = i.randValues?.[0] ?? 0;
  const r1 = i.randValues?.[1] ?? 0;
  const r2 = i.randValues?.[2] ?? 0;
  const r3 = i.randValues?.[3] ?? 0;
  if (typ === 1) {
    // radial: JWildfire's calcFunctionRadial rotates around ORIGIN (absolute
    // coords + atan2(y, x)). The (x0, y0) offset shifts only the distance
    // gate above, not the rotation pivot.
    const r_abs = Math.sqrt(i.tx * i.tx + i.ty * i.ty);
    const phi = Math.atan2(i.ty, i.tx) + mul_y * d * r1;
    const rr = r_abs + mul_x * r0 * d;
    return {
      x: i.weight * rr * Math.cos(phi),
      y: i.weight * rr * Math.sin(phi),
    };
  } else if (typ === 2) {
    // gaussian: 2π-spread angular scatter
    const sigma = d * r1 * 2 * PI;
    const phi = d * r2 * PI;
    const rad = d * r0;
    return {
      x: i.weight * (i.tx + mul_x * rad * Math.cos(sigma) * Math.cos(phi)),
      y: i.weight * (i.ty + mul_y * rad * Math.cos(sigma) * Math.sin(phi)),
    };
  }
  // default (type=0): plain distance-weighted scatter
  void r3;
  return {
    x: i.weight * (i.tx + mul_x * r0 * d),
    y: i.weight * (i.ty + mul_y * r1 * d),
  };
}

// var_falloff3 (chaos.wgsl) — JWildfire AbstractFalloff3Func, blur_type=0
// (gaussian) + blur_shape=0 (circle) path. 7 params (scatter, mul_x,
// mul_y, x0, y0, mindist, invert). 3 RNG calls. Default-mode port —
// blur_type 1/2 (radial/log) and blur_shape 1 (square) dropped to keep
// behavior matching the JWildfire UI default, plus Z params dropped per
// the 2D constraint. Documented in blurb.
export function ts_var_falloff3(i: VarInput): VarOutput {
  const scatter = i.params?.["scatter"] ?? 1;
  const mul_x = i.params?.["mul_x"] ?? 1;
  const mul_y = i.params?.["mul_y"] ?? 1;
  const x0 = i.params?.["x0"] ?? 0;
  const y0 = i.params?.["y0"] ?? 0;
  const mindist = i.params?.["mindist"] ?? 0.5;
  const invertFlag = (i.params?.["invert"] ?? 0) !== 0;
  const rmax = 0.04 * scatter;
  // BS_CIRCLE distance
  const dx = i.tx - x0;
  const dy = i.ty - y0;
  const radius = Math.sqrt(dx * dx + dy * dy);
  const base = invertFlag ? Math.max(1 - radius, 0) : Math.max(radius, 0);
  const dist = Math.max((base - mindist) * rmax, 0);
  // JWildfire centers samples at 0 (range [-0.5, 0.5)) per AbstractFalloff3Func.
  const r0 = (i.randValues?.[0] ?? 0) - 0.5;
  const r1 = (i.randValues?.[1] ?? 0) - 0.5;
  const r2 = (i.randValues?.[2] ?? 0) - 0.5;
  // BT_GAUSSIAN (blur_type=0): scatter inside a 2π·π angular window
  const sigma = dist * r1 * 2 * PI;
  const phi = dist * r2 * PI;
  const rad = dist * r0;
  const sigma_c = Math.cos(sigma);
  return {
    x: i.weight * (i.tx + mul_x * rad * sigma_c * Math.cos(phi)),
    y: i.weight * (i.ty + mul_y * rad * sigma_c * Math.sin(phi)),
  };
}

// =====================================================================
// #114 batch 2b-b — S-tier kaleidoscope/circle family.
// V115..V119. Sources: JWildfire (LGPL-2.1+); see NOTICE.md.
// =====================================================================

// var_collideoscope (chaos.wgsl) — JWildfire CollideoscopeFunc.java.
// 2 params (a, num) + no RNG. Author: Michael Faber. Folds the polar
// angle into 2·num pie slices with alternating-sign offsets — the
// collide variant of kaleidoscope. precalc: kn_pi = num/π, pi_kn = π/num,
// ka_kn = (π·a)/num.
export function ts_var_collideoscope(i: VarInput): VarOutput {
  const a_param = i.params?.["a"] ?? 0.20;
  const num_raw = i.params?.["num"] ?? 1;
  const num = Math.max(1, Math.trunc(num_raw));
  const kn_pi = num / PI;
  const pi_kn = PI / num;
  const ka = PI * a_param;
  const ka_kn = ka / num;
  let a = Math.atan2(i.ty, i.tx);
  const r = i.weight * Math.sqrt(i.tx * i.tx + i.ty * i.ty);
  if (a >= 0.0) {
    const alt = Math.trunc(a * kn_pi);
    if (alt % 2 === 0) {
      a = alt * pi_kn + ((ka_kn + a) % pi_kn);
    } else {
      a = alt * pi_kn + ((-ka_kn + a) % pi_kn);
    }
  } else {
    const alt = Math.trunc(-a * kn_pi);
    if (alt % 2 !== 0) {
      a = -(alt * pi_kn + ((-ka_kn - a) % pi_kn));
    } else {
      a = -(alt * pi_kn + ((ka_kn - a) % pi_kn));
    }
  }
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_circlize (chaos.wgsl) — JWildfire CirclizeFunc.java. 1 param (hole) +
// no RNG. Author: Michael Faber. Maps square ↔ circle via the L∞-norm
// perimeter parameterization: each input picks the dominant axis, walks
// the unit-square's perimeter accordingly, then maps perimeter → angle
// + axis → radius. Note the canonical quirk: `hole` is NOT scaled by
// the variation weight (intentional in JWF — see the inline "tsk tsk"
// comment in CirclizeFunc.java).
export function ts_var_circlize(i: VarInput): VarOutput {
  const hole = i.params?.["hole"] ?? 0.40;
  const var4_PI = i.weight / (PI / 4);
  const absx = Math.abs(i.tx);
  const absy = Math.abs(i.ty);
  let perimeter: number;
  let side: number;
  if (absx >= absy) {
    if (i.tx >= absy) {
      perimeter = absx + i.ty;
    } else {
      perimeter = 5.0 * absx - i.ty;
    }
    side = absx;
  } else {
    if (i.ty >= absx) {
      perimeter = 3.0 * absy - i.tx;
    } else {
      perimeter = 7.0 * absy + i.tx;
    }
    side = absy;
  }
  if (side === 0) return { x: 0, y: 0 };
  const r = var4_PI * side + hole;
  const a = (PI / 4) * perimeter / side - PI / 4;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_circlize2 (chaos.wgsl) — JWildfire Circlize2Func.java. 1 param
// (hole) + no RNG. Author: Michael Faber (Angle Pack). Companion to
// circlize: same perimeter parameterization, but the radius is
// w·(side+hole) instead of w·(4/π)·side+hole — `hole` IS scaled by
// the weight here (corrected from the sibling). Yields a more uniform
// ring at hole > 0.
export function ts_var_circlize2(i: VarInput): VarOutput {
  const hole = i.params?.["hole"] ?? 0.0;
  const absx = Math.abs(i.tx);
  const absy = Math.abs(i.ty);
  let perimeter: number;
  let side: number;
  if (absx >= absy) {
    if (i.tx >= absy) {
      perimeter = absx + i.ty;
    } else {
      perimeter = 5.0 * absx - i.ty;
    }
    side = absx;
  } else {
    if (i.ty >= absx) {
      perimeter = 3.0 * absy - i.tx;
    } else {
      perimeter = 7.0 * absy + i.tx;
    }
    side = absy;
  }
  if (side === 0) return { x: 0, y: 0 };
  const r = i.weight * (side + hole);
  const a = (PI / 4) * perimeter / side - PI / 4;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

// var_eswirl (chaos.wgsl) — JWildfire ESwirlFunc.java. 2 params (in, out).
// No RNG. Author: Michael Faber ("eSeries" pack). "Extended swirl" —
// works in elliptic coords (μ,ν) on the (x,y) plane, twists the ν
// angle by (mu·out + in/mu), then converts back. JWF uses safe-sqrt
// on the two radicals to dodge NaN at floating-point underflow.
// Equivalent to JWF's acosh on a clamped xmax ≥ 1.0 (elliptic radius)
// and acos on tx/xmax (clamped to [-1,1]).
export function ts_var_eswirl(i: VarInput): VarOutput {
  const in_p = i.params?.["in"] ?? 1.2;
  const out_p = i.params?.["out"] ?? 0.2;
  const tmp = i.ty * i.ty + i.tx * i.tx + 1.0;
  const tmp2 = 2.0 * i.tx;
  const safe1 = tmp + tmp2 > 0 ? Math.sqrt(tmp + tmp2) : 0;
  const safe2 = tmp - tmp2 > 0 ? Math.sqrt(tmp - tmp2) : 0;
  let xmax = (safe1 + safe2) * 0.5;
  if (xmax < 1.0) xmax = 1.0;
  const mu = Math.acosh(xmax);  // μ > 0
  let t = i.tx / xmax;
  if (t > 1.0) t = 1.0;
  else if (t < -1.0) t = -1.0;
  let nu = Math.acos(t);  // -π < ν < π
  if (i.ty < 0) nu *= -1.0;
  // Guard against mu→0 (xmax==1.0 edge) by matching the WGSL kernel's
  // 1e-30 epsilon — keeps TS↔WGSL parity at the cusp. JWF originally divides
  // by raw mu returning ±Inf which the chaos game reseed cleans up.
  const mu_safe = mu === 0 ? 1e-30 : mu;
  nu = nu + mu * out_p + in_p / mu_safe;
  const sinhmu = Math.sinh(mu);
  const coshmu = Math.cosh(mu);
  return {
    x: i.weight * coshmu * Math.cos(nu),
    y: i.weight * sinhmu * Math.sin(nu),
  };
}

// var_petal (chaos.wgsl) — JWildfire PetalFunc.java. 0 params, no RNG.
// Author: Raykoid666. Petal-shape attractor: x = w·cos(x)·(cos(x)·cos(y))³,
// y = w·cos(x)·(sin(x)·cos(y))³. Note JWF computes cos(x)·cos(y) and
// sin(x)·cos(y) cubed by multiplying out the triple product (matches
// JWF GPU code: `(cosf(x)*cosf(y))*(cosf(x)*cosf(y))*(cosf(x)*cosf(y))`).
export function ts_var_petal(i: VarInput): VarOutput {
  const a = Math.cos(i.tx);
  const cxcy = Math.cos(i.tx) * Math.cos(i.ty);
  const sxcy = Math.sin(i.tx) * Math.cos(i.ty);
  const bx = cxcy * cxcy * cxcy;
  const by = sxcy * sxcy * sxcy;
  return { x: i.weight * a * bx, y: i.weight * a * by };
}

// =====================================================================
// #114 batch 2b-c — Xyrus02 mid-tier + hexes cellular.
// V120..V124. Sources: xyrus02/apophysis-plugins (GPL-2+); JWildfire
// HexesFunc (LGPL-2.1+); see NOTICE.md.
// =====================================================================

// var_bcircle (chaos.wgsl) — Xyrus02 bcircle plugin (apophysis-plugins).
// 2 params (scale, borderwidth). RNG only when borderwidth ≠ 0.
// Inside the unit disk (after scale), passthrough w·(x,y); outside,
// optionally emit a point on the unit circle perturbed by border noise.
// The `borderwidth=0` path is fully deterministic and tested with parity.
// Caller MUST supply `randValues[0] ∈ [0,1]` when borderwidth ≠ 0;
// matches the source's `random01()` call.
export function ts_var_bcircle(i: VarInput): VarOutput {
  const scale = i.params?.["scale"] ?? 1.0;
  const borderwidth = i.params?.["borderwidth"] ?? 0.0;
  const bcbw = Math.abs(borderwidth);
  // Origin guard: source returns (0,0) contribution.
  if (i.tx === 0 && i.ty === 0) return { x: 0, y: 0 };
  const x = i.tx * scale;
  const y = i.ty * scale;
  const r = Math.sqrt(x * x + y * y);
  if (r <= 1.0) {
    return { x: i.weight * x, y: i.weight * y };
  }
  if (bcbw === 0) {
    // Outside disk + no border = identity contribution (no warp).
    return { x: 0, y: 0 };
  }
  const ang = Math.atan2(y, x);
  const rand = i.randValues?.[0] ?? 0.5;
  const omega = 0.2 * bcbw * rand + 1;
  return { x: i.weight * omega * Math.cos(ang), y: i.weight * omega * Math.sin(ang) };
}

// var_curl2 (chaos.wgsl) — Xyrus02 curl2 plugin (apophysis-plugins).
// 3 params (c1, c2, c3). No RNG. Author: Georg Kiehne / Xyrus-Worx.
// Cubic-polynomial complex inverse — the c2/c3 generalization of
// flam3's `curl` (which is the c1-only path). Returns
// (x·re + y·im, y·re − x·im) / (re² + im²), where re/im are the
// real/imaginary parts of the cubic polynomial
// (c3·(x+iy)³ + c2·(x+iy)² + c1·(x+iy) + 1) evaluated at the iterate.
export function ts_var_curl2(i: VarInput): VarOutput {
  const c1 = i.params?.["c1"] ?? 1.0;
  const c2 = i.params?.["c2"] ?? 0.0;
  const c3 = i.params?.["c3"] ?? 0.0;
  const cc2 = 2 * c2;
  const cc3 = 3 * c3;
  const x = i.tx;
  const y = i.ty;
  const x2 = x * x;
  const x3 = x2 * x;
  const y2 = y * y;
  const y3 = y2 * y;
  // Real part: c3·(x³−3xy²) + c2·(x²−y²) + c1·x + 1
  const re = c3 * x3 - cc3 * x * y2 + c2 * x2 - c2 * y2 + c1 * x + 1.0;
  // Imaginary part: c3·(x²y−y³)·1 (factor 3 lives in cc3 elsewhere; matches
  // Xyrus02 source: `c3*x²·y − c3·y³ + cc2·x·y + c1·y`).
  const im = cc3 * x2 * y - c3 * y3 + cc2 * x * y + c1 * y;
  const denom = re * re + im * im;
  // Source has no explicit guard; division by zero produces ±Inf which the
  // chaos game's bad-value reseed handles. We follow.
  const r = i.weight / denom;
  return { x: (x * re + y * im) * r, y: (y * re - x * im) * r };
}

// var_murl (chaos.wgsl) — JWildfire MurlFunc / Xyrus02 murl plugin.
// 2 params (c, power). No RNG. Author: Peter Sdobnov (Zueuk);
// ported into Java by Nic Anderson (chronologicaldot). Polar power
// (rotation by `power·atan2(y,x)`) combined with a complex inverse
// blend through the (re, im) intermediate. JWildfire's port adds the
// `power = 1` special case (c is NOT divided by power-1 in that
// branch). pyr3 follows the JWildfire form for consistency with the
// other Faber-pack ports in this batch.
export function ts_var_murl(i: VarInput): VarOutput {
  const c_raw = i.params?.["c"] ?? 0.0;
  const power_raw = i.params?.["power"] ?? 2.0;
  // JWildfire applies floor()/trunc() on power before use; matches the
  // C source which stores `int murl_power`. We use trunc with a min of 1
  // (Xyrus02 default = 2; pyr3 catalog default = 1 for a simpler shape).
  const power = Math.trunc(power_raw);
  // The c-scaling path differs between the source (power != 1) and the
  // JWildfire port (power != 1) — both gate on `power != 1`.
  const c = power !== 1 ? c_raw / (power - 1) : c_raw;
  const p2 = power / 2.0;
  const vp = i.weight * (c + 1);
  const a = Math.atan2(i.ty, i.tx) * power;
  const sina = Math.sin(a);
  const cosa = Math.cos(a);
  const r = c * Math.pow(i.tx * i.tx + i.ty * i.ty, p2);
  const re = r * cosa + 1;
  const im = r * sina;
  // Murl source guard: re² + im² + 1e-29 to dodge degeneracy at c=0,r=0.
  const r1 = vp / (re * re + im * im + 1e-29);
  return {
    x: r1 * (i.tx * re + i.ty * im),
    y: r1 * (i.ty * re - i.tx * im),
  };
}

// var_stwins (chaos.wgsl) — Xyrus02 stwins plugin (apophysis-plugins).
// 1 param (distort). No RNG. Author: xyrus02. Twin-sine ratio: scales
// the iterate by a fixed 0.05 multiplier, then mixes
// (x²−y²)·sin(2π·distort·(x+y)) / (x²+y²) back into (w·x, w·y). The
// fixed multiplier prevents overlap at distort=1 (source comment:
// "at multiplier=1 the function begins to overlap at 0.05").
// Note: the canonical Xyrus02 plugin registers as "stwin" (singular);
// the source directory + survey doc + community use prefer "stwins"
// (plural). pyr3 ships under "stwins" for ecosystem alignment.
export function ts_var_stwins(i: VarInput): VarOutput {
  const distort = i.params?.["distort"] ?? 1.0;
  const multiplier = 0.05;
  const x = i.tx * i.weight * multiplier;
  const y = i.ty * i.weight * multiplier;
  const x2 = x * x;
  const y2 = y * y;
  const x_plus_y = x + y;
  const x2_minus_y2 = x2 - y2;
  const x2_plus_y2 = x2 + y2;
  let divident = 1.0;
  if (x2_plus_y2 !== 0) divident = x2_plus_y2;
  const result = (x2_minus_y2 * Math.sin(2 * PI * distort * x_plus_y)) / divident;
  return {
    x: i.weight * i.tx + result,
    y: i.weight * i.ty + result,
  };
}

// var_hexes (chaos.wgsl) — JWildfire HexesFunc (port of slobo777's
// Apophysis hexes plugin). 4 params (cellsize, power, rotate, scale).
// No RNG. Author: Neil Slater / slobo777, ported to JWildfire by
// Andreas Maschke.
//
// Breaks the plane into a hex lattice, finds the closest hex center
// to the iterate, then applies a per-cell power scaling + rotation
// expressed via voronoi-edge distance. The "rosette removal" blend
// at the cell edge (L ∈ [0.5, 0.8]) smooths the transition between
// closest-vs-second-closest-hex regions.
//
// Coord conversion (Cartesian ↔ hex) uses an affine matrix; these are
// the constants from the JWildfire source:
//   a_hex = 1/3,        b_hex = √3/3
//   c_hex = -1/3,       d_hex = √3/3
//   a_cart = 1.5,       b_cart = -1.5
//   c_cart = √3/2,      d_cart = √3/2
// At cellsize=0 the source returns (0,0) — we follow.
export function ts_var_hexes(i: VarInput): VarOutput {
  const cellsize = i.params?.["cellsize"] ?? 1.0;
  const power = i.params?.["power"] ?? 1.0;
  const rotate = i.params?.["rotate"] ?? 0.166;
  const scale = i.params?.["scale"] ?? 1.0;
  if (cellsize === 0) return { x: 0, y: 0 };

  const SQRT3 = 1.7320508075688772935;
  const a_hex = 1.0 / 3.0;
  const b_hex = SQRT3 / 3.0;
  const c_hex = -1.0 / 3.0;
  const d_hex = SQRT3 / 3.0;
  const a_cart = 1.5;
  const b_cart = -1.5;
  const c_cart = SQRT3 / 2.0;
  const d_cart = SQRT3 / 2.0;

  const rotSin = Math.sin(rotate * 2.0 * PI);
  const rotCos = Math.cos(rotate * 2.0 * PI);

  const Ux = i.tx;
  const Uy = i.ty;
  const s = cellsize;

  const cellCentre = (hx: number, hy: number): [number, number] => {
    return [(a_cart * hx + b_cart * hy) * s, (c_cart * hx + d_cart * hy) * s];
  };

  const hx0 = Math.floor((a_hex * Ux + b_hex * Uy) / s);
  const hy0 = Math.floor((c_hex * Ux + d_hex * Uy) / s);

  // Step 1: build the 3x3 grid of candidate centers, find the closest.
  const P_init: [number, number][] = [];
  const cell_choice: [number, number][] = [];
  for (let di = -1; di < 2; di++) {
    for (let dj = -1; dj < 2; dj++) {
      P_init.push(cellCentre(hx0 + di, hy0 + dj));
      cell_choice.push([di, dj]);
    }
  }
  let q = 0;
  let bestD2 = Infinity;
  for (let k = 0; k < 9; k++) {
    const dx = P_init[k]![0] - Ux;
    const dy = P_init[k]![1] - Uy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; q = k; }
  }
  const hx = hx0 + cell_choice[q]![0];
  const hy = hy0 + cell_choice[q]![1];

  // Step 2: rebuild the 7-point ring centered on the chosen hex.
  // Order matches the JWF source: [center, +y, +x+y, +x, -y, -x-y, -x].
  const P: [number, number][] = [
    cellCentre(hx, hy),
    cellCentre(hx, hy + 1),
    cellCentre(hx + 1, hy + 1),
    cellCentre(hx + 1, hy),
    cellCentre(hx, hy - 1),
    cellCentre(hx - 1, hy - 1),
    cellCentre(hx - 1, hy),
  ];

  // Voronoi ratio against the chosen hex (index 0) — finds the maximum
  // half-plane projection vs the other 6 centers. JWF inlines this.
  const voronoiL = (Ux2: number, Uy2: number): number => {
    const Qx = P[0]![0];
    const Qy = P[0]![1];
    let ratiomax = -1.0e20;
    for (let k = 1; k < 7; k++) {
      const PmQx = P[k]![0] - Qx;
      const PmQy = P[k]![1] - Qy;
      if (PmQx === 0 && PmQy === 0) {
        if (1.0 > ratiomax) ratiomax = 1.0;
        continue;
      }
      const ratio = 2.0 * ((Ux2 - Qx) * PmQx + (Uy2 - Qy) * PmQy) / (PmQx * PmQx + PmQy * PmQy);
      if (ratio > ratiomax) ratiomax = ratio;
    }
    return ratiomax;
  };

  const L1 = voronoiL(Ux, Uy);

  // Delta from center, rotated by `rotate·2π`.
  const DXo = Ux - P[0]![0];
  const DYo = Uy - P[0]![1];
  const trgL = Math.pow(L1 + 1e-100, power) * scale;
  const Vx0 = DXo * rotCos + DYo * rotSin;
  const Vy0 = -DXo * rotSin + DYo * rotCos;

  const L2 = voronoiL(Vx0 + P[0]![0], Vy0 + P[0]![1]);
  const L = L1 > L2 ? L1 : L2;
  let R: number;
  if (L < 0.5) {
    R = trgL / L1;
  } else if (L > 0.8) {
    R = trgL / L2;
  } else {
    R = ((trgL / L1) * (0.8 - L) + (trgL / L2) * (L - 0.5)) / 0.3;
  }

  const Vx = Vx0 * R + P[0]![0];
  const Vy = Vy0 * R + P[0]![1];
  return { x: i.weight * Vx, y: i.weight * Vy };
}

// =====================================================================
// #114 batch 2b-d — Xyrus02 X-family + blur_circle (FINAL #114 batch).
// V125..V130. All sourced from xyrus02/apophysis-plugins (GPL-2+);
// see NOTICE.md. pyr3 reimplements each formula in WGSL + TS; no
// source code is byte-copied.
// =====================================================================

// var_xheart (chaos.wgsl) — Xyrus02 xheart plugin (apophysis-plugins).
// 2 params (xheart_angle, xheart_ratio). No RNG. "Extended heart" —
// projects (x,y) through a (4/r²+4, rat/r²+4) folding then rotates by
// an angle precomputed from `xheart_angle`. The x-sign branch
// re-mirrors the y component: positive x keeps y, negative x flips it.
// Origin guard matches source: r²+4 = 4 ≠ 0 so the `r2_4 == 0` branch
// is dead code; we keep it defensively.
export function ts_var_xheart(i: VarInput): VarOutput {
  const angle = i.params?.["xheart_angle"] ?? 0.0;
  const ratio = i.params?.["xheart_ratio"] ?? 0.0;
  const ang = PI / 4 + (0.5 * (PI / 4) * angle);
  const cosa = Math.cos(ang);
  const sina = Math.sin(ang);
  const rat = 6 + 2 * ratio;
  let r2_4 = i.tx * i.tx + i.ty * i.ty + 4;
  if (r2_4 === 0) r2_4 = 1;
  const bx = 4 / r2_4;
  const by = rat / r2_4;
  const xRot = cosa * (bx * i.tx) - sina * (by * i.ty);
  const yRot = sina * (bx * i.tx) + cosa * (by * i.ty);
  if (xRot > 0) {
    return { x: i.weight * xRot, y: i.weight * yRot };
  }
  return { x: i.weight * xRot, y: -i.weight * yRot };
}

// var_xhyperbol (chaos.wgsl) — Xyrus02 xhyperbol plugin
// (apophysis-plugins). 6 params (m00, m01, m10, m11, m20, m21). No RNG.
// "Extended hyperbolic" — applies a unit-disc inversion (z → z/|z|²),
// runs the result through a 2x3 affine, then re-emits as
// |z'|² · (cos α, sin α) with α = atan2(im, re) + 2π. A final |z|⁻²
// reflection (the second `flip`) wraps the output back. Source uses
// `epsilon = 1e-300` in flip's denominator; f32 has no 1e-300, we use
// `EPS` (1e-10) — same role (avoid /0 at origin), still well-
// representable.
export function ts_var_xhyperbol(i: VarInput): VarOutput {
  const m00 = i.params?.["m00"] ?? 1.0;
  const m01 = i.params?.["m01"] ?? 0.0;
  const m10 = i.params?.["m10"] ?? 0.0;
  const m11 = i.params?.["m11"] ?? 1.0;
  const m20 = i.params?.["m20"] ?? 0.0;
  const m21 = i.params?.["m21"] ?? 0.0;
  const EPS_FLIP = VAR_EPS;
  const r = 1.0 / (i.tx * i.tx + i.ty * i.ty + EPS_FLIP);
  const x = i.tx * r;
  const y = i.ty * r;
  const re = m00 * x + m01 * y + m20;
  const im = m10 * x + m11 * y + m21;
  // Source adds M_2PI to the angle; the cos/sin are 2π-periodic so this
  // is a no-op mathematically. Preserve verbatim for parity.
  const alpha = Math.atan2(im, re) + 2 * PI;
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  const rsq = re * re + im * im;
  const xout = rsq * ca;
  const yout = rsq * sa;
  const rinv = i.weight / (xout * xout + yout * yout + EPS_FLIP);
  return { x: xout * rinv, y: yout * rinv };
}

// var_xcurl2 (chaos.wgsl) — Xyrus02 xcurl2 plugin (apophysis-plugins).
// 3 params (c1, c2, c3). No RNG. Author: xyrus02.
//
// IMPORTANT: this is a DIFFERENT shape from V121 `curl2` (the Georg
// Kiehne formulation). The xcurl2 source carries the author's own
// comment: "old, probably wrong version of curl2..." — pyr3 ships
// both because the visual character differs. xcurl2's polynomial:
//   re = 1 + c1·x + c2·(x²−y²) + c3·(x³ − 3x)
//   im =     c1·y + c2·2xy     + c3·(3xy − 1)
// (NOT the cubic-conjugate form used by V121).
//
// Note also the source's `FPy += (FTy * re + FTx * im) * r` uses a
// SUM (not the standard Cartesian-inverse SIGN flip in V121's
// `y·Re − x·Im`). Preserved verbatim.
export function ts_var_xcurl2(i: VarInput): VarOutput {
  const c1 = i.params?.["c1"] ?? 0.0;
  const c2 = i.params?.["c2"] ?? 0.0;
  const c3 = i.params?.["c3"] ?? 0.0;
  const x = i.tx;
  const y = i.ty;
  const x2 = x * x;
  const y2 = y * y;
  const x3 = x2 * x;
  const re = 1 + c1 * x + c2 * (x2 - y2) + c3 * (x3 - 3 * x);
  const im = c1 * y + c2 * (2 * x * y) + c3 * (3 * x * y - 1);
  const denom = re * re + im * im;
  const r = i.weight / denom;
  return {
    x: (x * re + y * im) * r,
    y: (y * re + x * im) * r,
  };
}

// var_xtrb (chaos.wgsl) — Xyrus02 xtrb plugin (apophysis-plugins).
// 6 params (xtrb_power, xtrb_dist, xtrb_radius, xtrb_width, xtrb_a,
// xtrb_b). RNG: 2 calls per iter (rand_irand for the angle modulo and
// rand01 for the width-blend branch).
//
// Author: xyrus02. "TriBorders" — builds a dual tessellation on a
// triangular grid (the way `boarders` does on a square grid) using
// trilinear coordinates. Heavy precalc (18 derived values from the 6
// params) — flam3 caches these at xform-load; pyr3 recomputes inline
// per iter (the param read happens per-iter anyway in the GPU
// dispatcher).
//
// Caller MUST supply `randValues[0] ∈ [0,1]` for the `R` width-blend
// sample AND `randBranch ∈ {0..power-1}` for the angle modulo.
export function ts_var_xtrb(i: VarInput): VarOutput {
  const power_in = i.params?.["xtrb_power"] ?? 2;
  const dist = i.params?.["xtrb_dist"] ?? 1.0;
  const radius = i.params?.["xtrb_radius"] ?? 1.0;
  const width = i.params?.["xtrb_width"] ?? 0.5;
  const aParam = i.params?.["xtrb_a"] ?? 1.0;
  const bParam = i.params?.["xtrb_b"] ?? 1.0;
  const power = Math.trunc(power_in) || 1;

  const angle_Br = 0.047 + aParam;
  const angle_Cr = 0.047 + bParam;
  const angle_Ar = PI - angle_Br - angle_Cr;

  const sinA2 = Math.sin(0.5 * angle_Ar);
  const cosA2 = Math.cos(0.5 * angle_Ar);
  const sinB2 = Math.sin(0.5 * angle_Br);
  const cosB2 = Math.cos(0.5 * angle_Br);
  const sinC2 = Math.sin(0.5 * angle_Cr);
  const cosC2 = Math.cos(0.5 * angle_Cr);
  const sinC = Math.sin(angle_Cr);
  const cosC = Math.cos(angle_Cr);

  const aSide = radius * (sinC2 / cosC2 + sinB2 / cosB2);
  const bSide = radius * (sinC2 / cosC2 + sinA2 / cosA2);
  const cSide = radius * (sinB2 / cosB2 + sinA2 / cosA2);

  const width1 = 1 - width;
  const width2 = 2 * width;
  const width3 = 1 - width * width;

  const S2 = radius * (aSide + bSide + cSide);
  const Ha = S2 / aSide / 6.0;
  const Hb = S2 / bSide / 6.0;
  const Hc = S2 / cSide / 6.0;

  const ab = aSide / bSide;
  const ac = aSide / cSide;
  const ba = bSide / aSide;
  const bc = bSide / cSide;
  const ca = cSide / aSide;
  const cb = cSide / bSide;
  const S2a = 6.0 * Ha;
  const S2b = 6.0 * Hb;
  const S2c = 6.0 * Hc;
  const S2bc = S2 / (bSide + cSide) / 6.0;
  const S2ab = S2 / (aSide + bSide) / 6.0;
  const S2ac = S2 / (aSide + cSide) / 6.0;

  const absN = Math.abs(power);
  const cN = dist / power / 2;

  // DirectTrilinear: (x,y) → (Alpha, Beta, Gamma).
  const directTrilinear = (xv: number, yv: number): [number, number, number] => {
    const U = yv + radius;
    const V = xv * sinC - yv * cosC + radius;
    return [U, V, S2c - ac * U - bc * V];
  };

  // Hex routine — see source. Mutates Al/Be to Al1/Be1.
  const hex = (Al: number, Be: number, Ga: number, R: number): [number, number] => {
    let Al1 = 0.0;
    let Be1 = 0.0;
    let Ga1 = 0.0;
    let De1 = 0.0;
    if (Be < Al) {
      if (Ga < Be) {
        if (R >= width3) {
          De1 = width * Be;
          Ga1 = width * Ga;
        } else {
          Ga1 = width1 * Ga + width2 * Hc * Ga / Be;
          De1 = width1 * Be + width2 * S2ab * (3 - Ga / Be);
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
            Ga1 = width1 * Ga + width2 * S2ac * (3 - Be / Ga);
          }
          Al1 = S2a - ba * De1 - ca * Ga1;
          Be1 = De1;
        } else {
          if (R >= width3) {
            Al1 = width * Al;
            Be1 = width * Be;
          } else {
            Be1 = width1 * Be + width2 * Hb * Be / Al;
            Al1 = width1 * Al + width2 * S2ac * (3 - Be / Al);
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
          De1 = width1 * Al + width2 * S2ab * (3 - Ga / Al);
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
            Ga1 = width1 * Ga + width2 * S2bc * (3 - Al / Ga);
          }
          Be1 = S2b - ab * De1 - cb * Ga1;
          Al1 = De1;
        } else {
          if (R >= width3) {
            Be1 = width * Be;
            Al1 = width * Al;
          } else {
            Al1 = width1 * Al + width2 * Ha * Al / Be;
            Be1 = width1 * Be + width2 * S2bc * (3 - Al / Be);
          }
        }
      }
    }
    return [Al1, Be1];
  };

  const [Alpha0, Beta0, _Gamma0] = directTrilinear(i.tx, i.ty);
  const M = Math.floor(Alpha0 / S2a);
  let OffsetAl = Alpha0 - M * S2a;
  const N = Math.floor(Beta0 / S2b);
  let OffsetBe = Beta0 - N * S2b;
  let OffsetGa = S2c - ac * OffsetAl - bc * OffsetBe;

  const R = i.randValues?.[0] ?? 0.5;
  let Alpha: number;
  let Beta: number;
  if (OffsetGa > 0) {
    [Alpha, Beta] = hex(OffsetAl, OffsetBe, OffsetGa, R);
  } else {
    OffsetAl = S2a - OffsetAl;
    OffsetBe = S2b - OffsetBe;
    OffsetGa = -OffsetGa;
    const [Al1, Be1] = hex(OffsetAl, OffsetBe, OffsetGa, R);
    Alpha = S2a - Al1;
    Beta = S2b - Be1;
  }
  Alpha = Alpha + M * S2a;
  Beta = Beta + N * S2b;

  // InverseTrilinear: (Alpha, Beta) → (x, y) via power-modulo angle + r·power.
  const inx = (Beta - radius + (Alpha - radius) * cosC) / sinC;
  const iny = Alpha - radius;
  // Source: rand() % absN — integer in [0, absN). Caller supplies via randBranch.
  const branch = absN > 0 ? Math.floor((i.randBranch ?? 0) % absN) : 0;
  const angle = (Math.atan2(iny, inx) + 2 * PI * branch) / power;
  const rOut = Math.pow(inx * inx + iny * iny, cN);
  return {
    x: i.weight * rOut * Math.cos(angle),
    y: i.weight * rOut * Math.sin(angle),
  };
}

// var_gridout (chaos.wgsl) — Xyrus02 gridout plugin (apophysis-plugins,
// authors Michael Faber + Joel Faber). 0 params. No RNG. Snaps the
// iterate by ±1 along x or y depending on which integer-grid quadrant
// (`rint(x), rint(y)`) it falls into. Produces a stair-step / cubist
// look.
//
// NOT the same as pyr3's V101 `dc_gridout` — that one is a COLOR
// variation (position passthrough + per-cell hash hue); this is a pure
// position warp with no DC behavior.
//
// rint() in C rounds to nearest integer with ties-to-even by default;
// the source's `rint` macro here uses round-half-away-from-zero
// (`(int)(x + 0.5)` for x>=0, `(int)(x - 0.5)` for x<0). We mirror.
export function ts_var_xyrus_gridout(i: VarInput): VarOutput {
  const x = i.tx;
  const y = i.ty;
  // Source rint: half-away-from-zero (NOT half-to-even).
  const rx = x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
  const ry = y >= 0 ? Math.floor(y + 0.5) : Math.ceil(y - 0.5);
  let dx = 0.0;
  let dy = 0.0;
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
  return { x: i.weight * (x + dx), y: i.weight * (y + dy) };
}

// var_blur_circle (chaos.wgsl) — Xyrus02 blur_circle plugin
// (apophysis-plugins). 1 param (hole). RNG: 2 calls per iter (the
// (x,y) samples uniformly from the [-1,1]² square).
//
// Author: xyrus02. "Disc-uniform blur": uniformly samples a unit
// square, runs a square→circle perimeter parameterization (same family
// as circlize / circlize2), then emits onto a hole-offset circle.
// Input (i.tx, i.ty) is IGNORED — output is purely RNG-driven.
//
// Source uses precomputed `VVAR4_PI = w · 4/π`; we inline.
// Caller MUST supply `randValues[0]` and `randValues[1]` (each ∈ [0,1]).
export function ts_var_blur_circle(i: VarInput): VarOutput {
  const hole = i.params?.["hole"] ?? 0.0;
  const r0 = i.randValues?.[0] ?? 0.5;
  const r1 = i.randValues?.[1] ?? 0.5;
  const x = 2.0 * r0 - 1.0;
  const y = 2.0 * r1 - 1.0;
  const absx = Math.abs(x);
  const absy = Math.abs(y);
  const s = absx > absy ? absx : absy;
  const a = Math.atan2(y, x);
  const PI3_4 = 3 * PI / 4;
  const PI_4 = PI / 4;
  let ps: number;
  if (a < -PI3_4) ps = absy;
  else if (a < -PI_4) ps = 2.0 * s + x;
  else if (a < PI_4) ps = 4.0 * s + y;
  else if (a < PI3_4) ps = 6.0 * s - x;
  else ps = 8.0 * s - y;
  // s could be 0 if both rands sample exactly to 0.5 (degenerate);
  // source has no guard but produces NaN there. Mirror.
  const r = (i.weight * 4.0 / PI) * s + hole;
  const phi = PI_4 * ps / s - PI;
  return { x: r * Math.cos(phi), y: r * Math.sin(phi) };
}
