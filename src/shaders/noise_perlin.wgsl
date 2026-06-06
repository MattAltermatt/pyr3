// 2D classic Perlin noise (Ken Perlin 2002 improved noise). Permutation
// table is the canonical Perlin reference, inlined verbatim so renders
// are deterministic across browser + Node CLI. The JS oracle in
// src/noise-perlin-oracle.ts uses the same table — both implementations
// match within f32 vs f64 tolerance (~1e-5 in the chaos.gpu test).
//
// Used by var_dc_perlin (chaos.wgsl) to color flame xforms by a 2D noise
// field. Only the perlin_fbm entry point is called from chaos.wgsl;
// perlin2d / fade / grad2 are internal helpers exposed for unit tests
// via extractWgslFn.

const PERLIN_PERM: array<u32, 512> = array<u32, 512>(
  151u, 160u, 137u, 91u, 90u, 15u, 131u, 13u, 201u, 95u, 96u, 53u, 194u, 233u, 7u, 225u,
  140u, 36u, 103u, 30u, 69u, 142u, 8u, 99u, 37u, 240u, 21u, 10u, 23u, 190u, 6u, 148u,
  247u, 120u, 234u, 75u, 0u, 26u, 197u, 62u, 94u, 252u, 219u, 203u, 117u, 35u, 11u, 32u,
  57u, 177u, 33u, 88u, 237u, 149u, 56u, 87u, 174u, 20u, 125u, 136u, 171u, 168u, 68u, 175u,
  74u, 165u, 71u, 134u, 139u, 48u, 27u, 166u, 77u, 146u, 158u, 231u, 83u, 111u, 229u, 122u,
  60u, 211u, 133u, 230u, 220u, 105u, 92u, 41u, 55u, 46u, 245u, 40u, 244u, 102u, 143u, 54u,
  65u, 25u, 63u, 161u, 1u, 216u, 80u, 73u, 209u, 76u, 132u, 187u, 208u, 89u, 18u, 169u,
  200u, 196u, 135u, 130u, 116u, 188u, 159u, 86u, 164u, 100u, 109u, 198u, 173u, 186u, 3u, 64u,
  52u, 217u, 226u, 250u, 124u, 123u, 5u, 202u, 38u, 147u, 118u, 126u, 255u, 82u, 85u, 212u,
  207u, 206u, 59u, 227u, 47u, 16u, 58u, 17u, 182u, 189u, 28u, 42u, 223u, 183u, 170u, 213u,
  119u, 248u, 152u, 2u, 44u, 154u, 163u, 70u, 221u, 153u, 101u, 155u, 167u, 43u, 172u, 9u,
  129u, 22u, 39u, 253u, 19u, 98u, 108u, 110u, 79u, 113u, 224u, 232u, 178u, 185u, 112u, 104u,
  218u, 246u, 97u, 228u, 251u, 34u, 242u, 193u, 238u, 210u, 144u, 12u, 191u, 179u, 162u, 241u,
  81u, 51u, 145u, 235u, 249u, 14u, 239u, 107u, 49u, 192u, 214u, 31u, 181u, 199u, 106u, 157u,
  184u, 84u, 204u, 176u, 115u, 121u, 50u, 45u, 127u, 4u, 150u, 254u, 138u, 236u, 205u, 93u,
  222u, 114u, 67u, 29u, 24u, 72u, 243u, 141u, 128u, 195u, 78u, 66u, 215u, 61u, 156u, 180u,
  // Repeat the same 256 entries for wrap-around indexing without modulo.
  151u, 160u, 137u, 91u, 90u, 15u, 131u, 13u, 201u, 95u, 96u, 53u, 194u, 233u, 7u, 225u,
  140u, 36u, 103u, 30u, 69u, 142u, 8u, 99u, 37u, 240u, 21u, 10u, 23u, 190u, 6u, 148u,
  247u, 120u, 234u, 75u, 0u, 26u, 197u, 62u, 94u, 252u, 219u, 203u, 117u, 35u, 11u, 32u,
  57u, 177u, 33u, 88u, 237u, 149u, 56u, 87u, 174u, 20u, 125u, 136u, 171u, 168u, 68u, 175u,
  74u, 165u, 71u, 134u, 139u, 48u, 27u, 166u, 77u, 146u, 158u, 231u, 83u, 111u, 229u, 122u,
  60u, 211u, 133u, 230u, 220u, 105u, 92u, 41u, 55u, 46u, 245u, 40u, 244u, 102u, 143u, 54u,
  65u, 25u, 63u, 161u, 1u, 216u, 80u, 73u, 209u, 76u, 132u, 187u, 208u, 89u, 18u, 169u,
  200u, 196u, 135u, 130u, 116u, 188u, 159u, 86u, 164u, 100u, 109u, 198u, 173u, 186u, 3u, 64u,
  52u, 217u, 226u, 250u, 124u, 123u, 5u, 202u, 38u, 147u, 118u, 126u, 255u, 82u, 85u, 212u,
  207u, 206u, 59u, 227u, 47u, 16u, 58u, 17u, 182u, 189u, 28u, 42u, 223u, 183u, 170u, 213u,
  119u, 248u, 152u, 2u, 44u, 154u, 163u, 70u, 221u, 153u, 101u, 155u, 167u, 43u, 172u, 9u,
  129u, 22u, 39u, 253u, 19u, 98u, 108u, 110u, 79u, 113u, 224u, 232u, 178u, 185u, 112u, 104u,
  218u, 246u, 97u, 228u, 251u, 34u, 242u, 193u, 238u, 210u, 144u, 12u, 191u, 179u, 162u, 241u,
  81u, 51u, 145u, 235u, 249u, 14u, 239u, 107u, 49u, 192u, 214u, 31u, 181u, 199u, 106u, 157u,
  184u, 84u, 204u, 176u, 115u, 121u, 50u, 45u, 127u, 4u, 150u, 254u, 138u, 236u, 205u, 93u,
  222u, 114u, 67u, 29u, 24u, 72u, 243u, 141u, 128u, 195u, 78u, 66u, 215u, 61u, 156u, 180u,
);

fn perlin_fade(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// 8-direction 2D gradient lookup; matches the JS oracle's grad2 exactly.
fn perlin_grad2(hash: u32, x: f32, y: f32) -> f32 {
  let h = hash & 7u;
  let u = select(y, x, h < 4u);
  let v = select(x, y, h < 4u);
  let a = select(u, -u, (h & 1u) != 0u);
  let b = select(2.0 * v, -2.0 * v, (h & 2u) != 0u);
  return a + b;
}

fn perlin2d(p: vec2f) -> f32 {
  // Floor with f32→i32 + bitmask 255 — matches JS `Math.floor(x) & 255`.
  let fx = floor(p.x);
  let fy = floor(p.y);
  let X = u32(i32(fx) & 255);
  let Y = u32(i32(fy) & 255);
  let xf = p.x - fx;
  let yf = p.y - fy;
  let u = perlin_fade(xf);
  let v = perlin_fade(yf);
  let A = (PERLIN_PERM[X] + Y) & 255u;
  let B = (PERLIN_PERM[X + 1u] + Y) & 255u;
  let g00 = perlin_grad2(PERLIN_PERM[A],       xf,       yf);
  let g10 = perlin_grad2(PERLIN_PERM[B],       xf - 1.0, yf);
  let g01 = perlin_grad2(PERLIN_PERM[A + 1u],  xf,       yf - 1.0);
  let g11 = perlin_grad2(PERLIN_PERM[B + 1u],  xf - 1.0, yf - 1.0);
  return mix(mix(g00, g10, u), mix(g01, g11, u), v);
}

// Fractional Brownian motion. Octaves are clamped to [1, 8] to match the
// oracle and to keep the WGSL loop bounded for the shader compiler.
fn perlin_fbm(p: vec2f, octaves: f32, scale: f32) -> f32 {
  var total: f32 = 0.0;
  var amp: f32 = 1.0;
  var freq: f32 = scale;
  var maxv: f32 = 0.0;
  let O = u32(clamp(octaves, 1.0, 8.0));
  for (var i: u32 = 0u; i < O; i = i + 1u) {
    total = total + perlin2d(p * freq) * amp;
    maxv = maxv + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  return total / maxv;
}
