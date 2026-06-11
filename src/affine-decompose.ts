// pyr3 — affine decomposition for the /v1/edit xforms section v2.
//
// The genome's source of truth is the 2x3 raw matrix (a, b, c, d, e, f):
//
//   new_x = a·x + b·y + c
//   new_y = d·x + e·y + f
//
// The editor exposes a friendlier 6-parameter view (scale x, scale y,
// rotation, shear, position x, position y). This module is the two-way
// translation, with QR-style decomposition + canonical sign (scale_x ≥ 0).
//
// Composition order is shear → scale → rotate → translate.

export interface RawAffine {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
}

export interface DecomposedAffine {
  scaleX: number;
  scaleY: number;
  /** Counter-clockwise rotation in RADIANS. The UI converts to degrees. */
  rotation: number;
  /** Horizontal shear factor (skews X by `shear · y`). 0 = no shear. */
  shear: number;
  positionX: number;
  positionY: number;
}

/** Forward map: decomposed → raw matrix. Runs on every decomposed edit
 *  to keep the genome's a..f authoritative. */
export function decomposedToRaw(d: DecomposedAffine): RawAffine {
  const c = Math.cos(d.rotation);
  const s = Math.sin(d.rotation);
  return {
    a: d.scaleX * c,
    b: d.scaleX * d.shear * c - d.scaleY * s,
    c: d.positionX,
    d: d.scaleX * s,
    e: d.scaleX * d.shear * s + d.scaleY * c,
    f: d.positionY,
  };
}

/** Inverse map: raw matrix → decomposed view. Used to populate the
 *  editor's decomposed fields from a freshly-opened genome. Canonical
 *  form: scale_x ≥ 0 absorbs any sign flip on the X column. scale_y
 *  carries the determinant sign (negative → matrix flips orientation). */
/** Singular X-column threshold. Below this, shear = (a·b+d·e)/scaleX² divides
 *  by a vanishing denominator and explodes the displayed shear/scaleY. Chosen
 *  well below the smallest scaleX seen in real fixtures (~0.0085) so no genuine
 *  xform collapses to the sentinel — only hand-crafted degenerate matrices do. */
export const SINGULAR_SCALE_EPS = 1e-6;

export function rawToDecomposed(r: RawAffine): DecomposedAffine {
  const scaleX = Math.sqrt(r.a * r.a + r.d * r.d);
  if (scaleX < SINGULAR_SCALE_EPS) {
    // (Near-)singular X column. The decomposition is non-unique and the shear
    // term would blow up. Return a sentinel that round-trips through
    // decomposedToRaw to a translation-only matrix rather than emitting huge
    // finite values. (#251 — the guard was previously `=== 0`, catching only
    // an EXACT zero; a tiny-but-nonzero column exploded the fields. There is no
    // editor disable for this case — it is unreachable from real fixtures.)
    return { scaleX: 0, scaleY: 0, rotation: 0, shear: 0, positionX: r.c, positionY: r.f };
  }
  const rotation = Math.atan2(r.d, r.a);
  const det = r.a * r.e - r.b * r.d;
  const scaleY = det / scaleX;
  const shear = (r.a * r.b + r.d * r.e) / (scaleX * scaleX);
  return { scaleX, scaleY, rotation, shear, positionX: r.c, positionY: r.f };
}
