// pyr3 — density estimation compute pass (Phase 9-supersample-real DE rewrite).
//
// Flam3-faithful per-bucket-scatter via per-output-gather. For each output
// (super-)pixel, iterate the surrounding neighborhood; for each NEIGHBOR
// with non-zero count, compute THAT neighbor's adaptive radius + sigma +
// per-bucket kernel, look up the neighbor's kernel-sum normalization
// constant, and add `ls(neighbor) × neighbor.color × kernel_weight` to our
// output accumulator (no per-output normalization — the kernel is normalized
// per-bucket so each neighbor scatters exactly 1.0 worth of weight across its
// own kernel area). Matches flam3 rect.c:140-148 and filt.c (filter_coefs
// indexing).
//
// Per-output gather pattern is required because GPU scatter via f32-atomic
// is awkward; the math is equivalent to flam3's scatter (each contribution
// of source bucket B to target pixel P with weight w_BP, where Σ_P w_BP = 1
// per source B).
//
// Output buffer (`filtered`) is already log-density-tone-mapped per bucket
// — visualize_f32.wgsl reads it directly without re-applying ls.

struct DEUniforms {
  width: u32,           // super-resolution width
  height: u32,          // super-resolution height
  // max_rad / min_rad are in OUTPUT-pixel units as authored in `<flame
  // estimator_radius>` / `<flame estimator_minimum>`. The DE shader operates
  // at super-resolution, so it scales them via `comp_max_radius = max_rad ×
  // oversample + 1` (matches flam3 filt.c:297). pyr3 uses these scaled values
  // directly — `max_rad` as uploaded is ALREADY scaled host-side.
  max_rad: f32,
  min_rad: f32,
  curve: f32,
  k1: f32,
  k2: f32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform>            u:           DEUniforms;
@group(0) @binding(1) var<storage, read>      hist:        array<u32>;
@group(0) @binding(2) var<storage, read_write> filtered:   array<f32>;
// Per-radius kernel-sum normalization. Indexed by floor(r) clamped to
// [0, MAX_RAD]; LUT size = MAX_RAD + 1. Built host-side in density.ts.
@group(0) @binding(3) var<storage, read>      kernel_norm: array<f32>;

// Sized to fit the largest comp_max_radius in super-pixel units: original
// MAX_RAD_CAP in OUTPUT-pixel units is 30, scaled by max oversample=8 → ~241.
// 256 is a safe ceiling (matches MAX_RAD_LUT in density.ts).
const MAX_RAD_CAP: i32 = 256;

@compute @workgroup_size(8, 8, 1)
fn density_main(@builtin(global_invocation_id) gid: vec3u) {
  let xi = gid.x;
  let yi = gid.y;
  if (xi >= u.width || yi >= u.height) { return; }

  // Search radius is the maximum possible bucket radius — any neighbor up to
  // max_rad away might have us in its kernel.
  let R = i32(ceil(clamp(u.max_rad, 0.0, f32(MAX_RAD_CAP))));

  var sum = vec4f(0.0);
  for (var dy = -R; dy <= R; dy = dy + 1) {
    let ny = i32(yi) + dy;
    if (ny < 0 || ny >= i32(u.height)) { continue; }
    for (var dx = -R; dx <= R; dx = dx + 1) {
      let nx = i32(xi) + dx;
      if (nx < 0 || nx >= i32(u.width)) { continue; }

      let n_idx = (u32(ny) * u.width + u32(nx)) * 4u;
      let n_count = f32(hist[n_idx + 3u]);
      if (n_count <= 0.0) { continue; }

      // Neighbor's own adaptive radius (per flam3 rect.c:100 → filters.c:341).
      // The radius formula uses HITS (b[0][4]/255 in flam3), NOT the 255×hits
      // count. With our `n_count = hist[+3] = 255×hits`, divide by 255 to match
      // flam3's `f_select += b[0][4]/255.0`. Without this, pyr3's DE collapses
      // to ~1 super-pixel for any walker count > 0 (radius = 11/pow(256, 0.6)
      // ≈ 0.38 px) — effectively a no-op single-tap filter, leaving the
      // bimodal-vs-unimodal flam3-parity gap visible on imported flames.
      let n_hits = n_count / 255.0;
      let n_rad = clamp(u.max_rad / pow(n_hits + 1.0, u.curve), u.min_rad, u.max_rad);
      let d2 = f32(dx * dx + dy * dy);
      if (d2 > n_rad * n_rad) { continue; }

      // Neighbor's Gaussian: sigma = radius / 3 (matches density.wgsl Phase 6
      // convention; flam3 uses similar profile via filt.c support=1.5).
      let n_sigma = max(n_rad / 3.0, 1e-6);
      let kw = exp(-d2 / (2.0 * n_sigma * n_sigma));

      // Look up neighbor's kernel-sum normalization. Without this each bucket
      // contributes >1.0 worth of weight to its kernel area; flam3 normalizes
      // each bucket's kernel to sum=1 so total scattered weight = 1 per bucket.
      let n_rad_i = u32(clamp(i32(round(n_rad)), 0, MAX_RAD_CAP));
      let knorm = max(kernel_norm[n_rad_i], 1e-6);

      // Per-bucket log-density tone-map (flam3 rect.c:140 — ls applied at
      // scatter time, not at collapse time).
      let ls = (u.k1 * log(1.0 + n_count * u.k2)) / n_count;
      let w = (kw / knorm) * ls;

      sum.r = sum.r + f32(hist[n_idx + 0u]) * w;
      sum.g = sum.g + f32(hist[n_idx + 1u]) * w;
      sum.b = sum.b + f32(hist[n_idx + 2u]) * w;
      sum.a = sum.a + n_count * w;
    }
  }

  let dest = (yi * u.width + xi) * 4u;
  filtered[dest + 0u] = sum.r;
  filtered[dest + 1u] = sum.g;
  filtered[dest + 2u] = sum.b;
  filtered[dest + 3u] = sum.a;
}
