// pyr3 — Phase 9-filter spatial AA Gaussian filter pass.
//
// Two compute entry points implementing a separable 2D convolution:
//   cs_horiz  reads `src`, samples along X, writes `dst`
//   cs_vert   reads `src`, samples along Y, writes `dst`
//
// The host pipeline runs cs_horiz from the input buffer into a temp buffer,
// then cs_vert from the temp into the output buffer. Both passes share the
// same bind-group layout — the host swaps the buffer bindings between calls.
//
// Kernel coefficients live in a storage buffer (read-only) of length 2r+1
// where r = half-width. Dynamic indexing of storage arrays is well-defined
// in WGSL (unlike uniform-array dynamic indexing, which has stride quirks).
//
// Edge handling: clamp-to-edge — sample positions outside [0, dim) are
// clamped to the nearest valid pixel. This matches flam3's filt.c boundary
// behavior on the supersampled buffer.

struct Uniforms {
  width:  u32,
  height: u32,
  r:      u32,
  _pad:   u32,
};

@group(0) @binding(0) var<storage, read>       src:    array<vec4f>;
@group(0) @binding(1) var<storage, read_write> dst:    array<vec4f>;
@group(0) @binding(2) var<uniform>             u:      Uniforms;
@group(0) @binding(3) var<storage, read>       kernel: array<f32>;

@compute @workgroup_size(8, 8)
fn cs_horiz(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.width || gid.y >= u.height) { return; }
  var acc = vec4f(0.0);
  let r = i32(u.r);
  let xi = i32(gid.x);
  let wmax = i32(u.width) - 1;
  for (var k = -r; k <= r; k = k + 1) {
    let sx = clamp(xi + k, 0, wmax);
    let sidx = u32(sx) + gid.y * u.width;
    acc = acc + src[sidx] * kernel[u32(k + r)];
  }
  dst[gid.x + gid.y * u.width] = acc;
}

@compute @workgroup_size(8, 8)
fn cs_vert(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.width || gid.y >= u.height) { return; }
  var acc = vec4f(0.0);
  let r = i32(u.r);
  let yi = i32(gid.y);
  let hmax = i32(u.height) - 1;
  for (var k = -r; k <= r; k = k + 1) {
    let sy = clamp(yi + k, 0, hmax);
    let sidx = gid.x + u32(sy) * u.width;
    acc = acc + src[sidx] * kernel[u32(k + r)];
  }
  dst[gid.x + gid.y * u.width] = acc;
}
