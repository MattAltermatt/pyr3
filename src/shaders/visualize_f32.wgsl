// pyr3 — visualize pass (DE-on / filter-on f32 path).
//
// Reads from a SUPER-RESOLUTION f32 RGBA storage buffer (DE.filtered when DE
// active, else cast histogram). Per Phase 9-supersample-real:
//
//   Per output pixel:
//     1. For each of fwidth × fwidth super-pixels in a Gaussian-kernel
//        neighborhood centered on the output cell, apply per-super-pixel
//        log-density tone-map (ls = k1·log(1 + c·k2)/c), then accumulate
//        weighted by kernel_2d[i,j] = kernel_1d[i] × kernel_1d[j].
//     2. The kernel sums to 1.0, so the weighted accumulation IS the
//        super-res → output-res Gaussian collapse — matches flam3 filt.c
//        semantics where the spatial filter does Gaussian-blur + downsample
//        in a single step.
//     3. Apply alpha curve / vibrancy / highpow / per-channel-gamma composite
//        on the collapsed output value (matches flam3 rect.c:1167+).
//
// For oversample=1 and fwidth=1, the loop runs once and the output is just
// the per-output-pixel tone-map (Spiral Galaxy continuity).

struct VizUniforms {
  width: u32,         // output (canvas) width
  height: u32,        // output (canvas) height
  k1: f32,
  k2: f32,
  gamma: f32,
  vibrancy: f32,
  highpow: f32,
  linrange: f32,
  oversample: u32,    // super-resolution multiplier (≥ 1)
  fwidth: u32,        // Gaussian-collapse kernel half-width × 2 + 1 (taps)
  _pad2: u32,
  _pad3: u32,
  // Phase 9-bg-palmode: flam3 background (rect.c:1138/1210). .xyz = [r,g,b]
  // in [0,1]; .w unused (vec4 for std140-style 16-byte alignment).
  background: vec4f,
  // Issue #116 — Color Curves. Bit-field per channel:
  // bit0=composite, bit1=R, bit2=G, bit3=B, bit4=luma.
  // When 0, the curves block in fs() is skipped — byte-identical to
  // pre-#116 output. Branch is load-bearing for the parity rig.
  curvesActive: u32,
  _pad4: u32,
  _pad5: u32,
  _pad6: u32,
};

@group(0) @binding(0) var<uniform>          u:        VizUniforms;
@group(0) @binding(1) var<storage, read>    hist:     array<f32>;
@group(0) @binding(2) var<storage, read>    kernel1d: array<f32>;
@group(0) @binding(3) var<storage, read>    curves:   array<f32>;  // 5 × 256

const PREFILTER_WHITE: f32 = 255.0;

// Issue #116 — color-curves LUT lookup. 256-entry per-channel f32 LUT;
// linear-interp between adjacent entries.
fn lut(ch: u32, x: f32) -> f32 {
  let idx = clamp(x, 0.0, 1.0) * 255.0;
  let i0 = u32(floor(idx));
  let i1 = min(i0 + 1u, 255u);
  return mix(curves[ch * 256u + i0], curves[ch * 256u + i1], idx - f32(i0));
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let mx = max(max(c.r, c.g), c.b);
  let mn = min(min(c.r, c.g), c.b);
  let d = mx - mn;
  var h: f32 = 0.0;
  if (d > 0.0) {
    if (mx == c.r) {
      h = (c.g - c.b) / d;
    } else if (mx == c.g) {
      h = 2.0 + (c.b - c.r) / d;
    } else {
      h = 4.0 + (c.r - c.g) / d;
    }
    h *= 60.0;
    if (h < 0.0) { h += 360.0; }
  }
  let s = select(0.0, d / mx, mx > 0.0);
  return vec3f(h, s, mx);
}

fn hsv2rgb(c: vec3f) -> vec3f {
  let h = c.x / 60.0;
  let s = c.y;
  let v = c.z;
  let i = floor(h);
  let f = h - i;
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));
  let ix = i32(i) % 6;
  if (ix == 0) { return vec3f(v, t, p); }
  if (ix == 1) { return vec3f(q, v, p); }
  if (ix == 2) { return vec3f(p, v, t); }
  if (ix == 3) { return vec3f(p, q, v); }
  if (ix == 4) { return vec3f(t, p, v); }
  return vec3f(v, p, q);
}

// flam3_calc_alpha — palettes.c:274-289
fn calc_alpha(density: f32, g_inv: f32, linrange: f32) -> f32 {
  if (density <= 0.0) { return 0.0; }
  if (density < linrange) {
    let funcval = pow(linrange, g_inv);
    let frac = density / linrange;
    return (1.0 - frac) * density * (funcval / linrange) + frac * pow(density, g_inv);
  }
  return pow(density, g_inv);
}

// flam3_calc_newrgb — palettes.c:292-349
fn calc_newrgb(c: vec3f, ls: f32, highpow: f32) -> vec3f {
  if (ls == 0.0 || (c.r == 0.0 && c.g == 0.0 && c.b == 0.0)) {
    return vec3f(0.0);
  }

  // Identify most-saturated channel post-scale (palettes.c:308-314).
  let scaled = ls * (c / PREFILTER_WHITE);
  var maxa = scaled.r;
  var maxc = c.r / PREFILTER_WHITE;
  if (scaled.g > maxa) { maxa = scaled.g; maxc = c.g / PREFILTER_WHITE; }
  if (scaled.b > maxa) { maxa = scaled.b; maxc = c.b / PREFILTER_WHITE; }

  if (maxa > 255.0 && highpow >= 0.0) {
    // HSV path — hue-preserving desaturation under highpow (palettes.c:318-333).
    let newls = 255.0 / maxc;
    let lsratio = pow(newls / ls, highpow);
    var newrgb = newls * (c / PREFILTER_WHITE) / 255.0;
    var hsv = rgb2hsv(newrgb);
    hsv.y *= lsratio;
    newrgb = hsv2rgb(hsv);
    return newrgb * 255.0;
  } else {
    // Soft-clamp path — interpolate between newls and ls (palettes.c:334-348).
    let newls = 255.0 / maxc;
    var adjhlp = -highpow;
    if (adjhlp > 1.0) { adjhlp = 1.0; }
    if (maxa <= 255.0) { adjhlp = 1.0; }
    return ((1.0 - adjhlp) * newls + adjhlp * ls) * (c / PREFILTER_WHITE);
  }
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // See visualize_u32.wgsl `vs` — naga rejects `let` array runtime indexing.
  var p = array(
    vec2f(-1.0, -3.0),
    vec2f(-1.0,  1.0),
    vec2f( 3.0,  1.0),
  );
  return vec4f(p[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let xi = u32(frag.x);
  let yi = u32(frag.y);
  if (xi >= u.width || yi >= u.height) {
    // Phase 9-bg-palmode: out-of-canvas overshoot fragments take the bg color
    // for consistency with the in-canvas empty-pixel return below.
    return vec4f(u.background.xyz, 1.0);
  }

  let N = u.oversample;
  let fw = u.fwidth;
  let halfW = fw / 2u;
  let super_w = u.width * N;
  let super_h = u.height * N;
  // Center the kernel on the visual middle of the output cell. With parity
  // matched (filt.c:233-234), the kernel centers correctly: odd N+odd fw gives
  // center on a super-pixel; even N+even fw gives center between super-pixels.
  let cx = xi * N + N / 2u;
  let cy = yi * N + N / 2u;

  // DE-on path: density.filtered is already log-density-tone-mapped per
  // bucket (flam3 rect.c:140-148). visualize collapses with the spatial
  // filter Gaussian only — no second ls application.
  var sum = vec4f(0.0);
  for (var dy: u32 = 0u; dy < fw; dy = dy + 1u) {
    let ky = kernel1d[dy];
    let sy_s = i32(cy) + i32(dy) - i32(halfW);
    let sy = u32(clamp(sy_s, 0, i32(super_h) - 1));
    for (var dx: u32 = 0u; dx < fw; dx = dx + 1u) {
      let kx = kernel1d[dx];
      let sx_s = i32(cx) + i32(dx) - i32(halfW);
      let sx = u32(clamp(sx_s, 0, i32(super_w) - 1));
      let sb = (sy * super_w + sx) * 4u;
      let w = kx * ky;
      sum = sum + vec4f(
        hist[sb + 0u],
        hist[sb + 1u],
        hist[sb + 2u],
        hist[sb + 3u],
      ) * w;
    }
  }
  // Kernel sums to 1.0 (sumof(kx) = 1, sumof(kx*ky) = 1×1 = 1), so `sum` IS
  // the weighted avg, no division needed.
  var c = sum;
  if (c.a <= 0.0) {
    // Phase 9-bg-palmode: empty pixels show the genome's background color.
    // alpha=0 limit of `(1-alpha) * 256 * background / 256` is bg itself.
    return vec4f(u.background.xyz, 1.0);
  }

  // c is already log-compressed-and-collapsed; alpha curve / vibrancy /
  // highpow chain operates on the already-tone-mapped value.

  // Alpha curve (palettes.c:274-289).
  let g_inv = 1.0 / u.gamma;
  let tmp = c.a / PREFILTER_WHITE;
  var alpha = calc_alpha(tmp, g_inv, u.linrange);
  let ls_alpha = u.vibrancy * 256.0 * alpha / max(tmp, 1e-12);
  alpha = clamp(alpha, 0.0, 1.0);

  // Vibrancy + highpow composite (rect.c:1109-1129).
  let newrgb = calc_newrgb(c.rgb, ls_alpha, u.highpow);
  let perch = (1.0 - u.vibrancy) * 256.0 * pow(max(c.rgb / PREFILTER_WHITE, vec3f(0.0)), vec3f(g_inv));
  // Phase 9-bg-palmode: blend background under partial-alpha (rect.c:1138/1210
  // simplified for vib_gam_n=1 — see spec non-goals).
  let composed = newrgb + perch + (1.0 - alpha) * 256.0 * u.background.xyz;

  var rgb = clamp(composed / 256.0, vec3f(0.0), vec3f(1.0));
  // Issue #116 — Color Curves block. curvesActive == 0 ⇒ branch skipped
  // ⇒ byte-identical to pre-#116 output. Branch is PERMANENT and
  // load-bearing for the parity rig.
  if (u.curvesActive != 0u) {
    if ((u.curvesActive & 1u) != 0u) {
      rgb = vec3f(lut(0u, rgb.r), lut(0u, rgb.g), lut(0u, rgb.b));
    }
    if ((u.curvesActive & 2u)  != 0u) { rgb.r = lut(1u, rgb.r); }
    if ((u.curvesActive & 4u)  != 0u) { rgb.g = lut(2u, rgb.g); }
    if ((u.curvesActive & 8u)  != 0u) { rgb.b = lut(3u, rgb.b); }
    if ((u.curvesActive & 16u) != 0u) {
      let y_in = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
      let y_out = lut(4u, y_in);
      let scale = select(1.0, y_out / y_in, y_in > 1e-6);
      rgb = clamp(rgb * scale, vec3f(0.0), vec3f(1.0));
    }
  }
  return vec4f(rgb, 1.0);
}
