// JS f64 reference implementation of 2D Perlin noise (Ken Perlin 2002
// "improved noise"). Used only as a test oracle for the WGSL counterpart
// in src/shaders/noise_perlin.wgsl — never executed at render time.
//
// The permutation table is the canonical Perlin reference table; the
// WGSL version inlines the same 256 bytes so both implementations are
// bit-for-bit identical (within f32 vs f64 tolerance ≈ 1e-5).

const P_BASE: readonly number[] = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

export const PERM_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(512);
  for (let i = 0; i < 256; i++) t[i] = P_BASE[i]!;
  for (let i = 0; i < 256; i++) t[256 + i] = P_BASE[i]!;
  return t;
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

// 8-direction 2D gradient lookup. Matches the WGSL `grad2` exactly:
// 4 of 8 directions are axis-flipped pairs; the (h & 2) bit doubles the
// minor-axis component to give the classic Perlin gradient set.
function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  const a = (h & 1) !== 0 ? -u : u;
  const b = (h & 2) !== 0 ? -2 * v : 2 * v;
  return a + b;
}

export function perlin2d(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const A = (PERM_TABLE[X]! + Y) & 255;
  const B = (PERM_TABLE[X + 1]! + Y) & 255;
  const g00 = grad2(PERM_TABLE[A]!, xf, yf);
  const g10 = grad2(PERM_TABLE[B]!, xf - 1, yf);
  const g01 = grad2(PERM_TABLE[A + 1]!, xf, yf - 1);
  const g11 = grad2(PERM_TABLE[B + 1]!, xf - 1, yf - 1);
  return lerp(lerp(g00, g10, u), lerp(g01, g11, u), v);
}

// Fractional Brownian motion: sum of octaves of perlin2d with doubling
// frequency and halving amplitude. Normalized to roughly [-1, 1].
export function perlinFbm(
  x: number,
  y: number,
  octaves: number,
  scale: number,
): number {
  let total = 0;
  let amp = 1;
  let freq = scale;
  let maxv = 0;
  const O = Math.max(1, Math.min(8, Math.floor(octaves)));
  for (let i = 0; i < O; i++) {
    total += perlin2d(x * freq, y * freq) * amp;
    maxv += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / maxv;
}
