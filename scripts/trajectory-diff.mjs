#!/usr/bin/env node
// Step-by-step walker trajectory: f64 vs simulated-f32 (Math.fround per op).
// Tests whether f32 precision drift on t36's combination (linear 0.43 + bubble shear)
// is detectable as walker-trajectory divergence over N iters.

const fr = Math.fround;

// xform 1 (linear, 0.43-scale affine)
function linear_f64(p) {
  const pa = [0.431736 * p[0] + 0 + 0, 0 + 0.431736 * p[1] + 0];
  return [pa[0], pa[1]]; // linear var = identity on pa
}
function linear_f32(p) {
  const pa = [
    fr(fr(0.431736) * p[0] + 0 + 0),
    fr(0 + fr(0.431736) * p[1] + 0),
  ];
  return [fr(pa[0]), fr(pa[1])];
}

// xform 2 (bubble, shear affine: a=0.0122 b=0.826 c=0 d=1)
function bubble_f64(p) {
  // pyr3 affine: tx = a*x + c*y + e, ty = b*x + d*y + f
  // (matches flam3 col-major after pyr3 row shuffle)
  const pa = [0.0121754 * p[0], 0.825949 * p[0] + p[1]];
  const r2 = pa[0] * pa[0] + pa[1] * pa[1];
  const f = 4.0 / (r2 + 4.0);
  return [f * pa[0], f * pa[1]];
}
function bubble_f32(p) {
  const pa = [
    fr(fr(0.0121754) * p[0]),
    fr(fr(0.825949) * p[0] + p[1]),
  ];
  const r2 = fr(fr(pa[0] * pa[0]) + fr(pa[1] * pa[1]));
  const f = fr(4.0 / fr(r2 + 4.0));
  return [fr(f * pa[0]), fr(f * pa[1])];
}

// Iterate: alternate linear and bubble.
let p64 = [0.5, 0.5];
let p32 = [fr(0.5), fr(0.5)];

console.log('iter  f64.x          f64.y          f32.x          f32.y          delta_x        delta_y');
for (let i = 0; i < 50; i++) {
  if (i % 2 === 0) {
    p64 = linear_f64(p64);
    p32 = linear_f32(p32);
  } else {
    p64 = bubble_f64(p64);
    p32 = bubble_f32(p32);
  }
  const dx = Math.abs(p64[0] - p32[0]);
  const dy = Math.abs(p64[1] - p32[1]);
  console.log(`${String(i).padStart(4)}  ${p64[0].toExponential(7)}  ${p64[1].toExponential(7)}  ${p32[0].toExponential(7)}  ${p32[1].toExponential(7)}  ${dx.toExponential(2)}      ${dy.toExponential(2)}`);
}
