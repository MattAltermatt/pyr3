/** Decode an IEEE 754 half-precision (binary16) value stored in the low 16
 *  bits of `h` to a JS number. Used to read back rgba16float GPU textures
 *  for higher-precision export (#334). */
export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  let val: number;
  if (exp === 0) {
    val = frac * Math.pow(2, -24); // subnormal
  } else if (exp === 0x1f) {
    val = frac === 0 ? Infinity : NaN;
  } else {
    val = (1 + frac / 1024) * Math.pow(2, exp - 15);
  }
  return sign ? -val : val;
}
