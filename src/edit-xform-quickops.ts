// pyr3 — /v1/edit xform quick-ops.
//
// Relative-modifier ops on the decomposed affine. Each op takes the
// current state and applies a single delta — the position fields
// (posX / posY) are preserved verbatim. Unlike the v1 "shape presets"
// these never overwrite the full affine; they nudge it.
//
// Rotation is stored in DEGREES here (the strip surfaces are degree-
// labelled). Callers that hold radians convert to/from at the seam.
//
// Strip order matches the on-screen button strip:
//   rotate+45  ·  rotate−45
//   scale ×2    ·  scale ×½
//   flip y      ·  flip x
//   shear +0.1
//
// No rotate +90° — users hit rotate +45° twice. Two clicks beats a
// crowded grid.

/** Decomposed affine in the quick-ops contract: rotation in degrees,
 *  position as posX/posY. Distinct from `affine-decompose.ts`'s
 *  `DecomposedAffine` (radians, positionX/Y) — call sites adapt at
 *  the seam. */
export interface DecomposedAffine {
  scaleX: number;
  scaleY: number;
  /** CCW rotation in DEGREES. */
  rotation: number;
  shear: number;
  posX: number;
  posY: number;
}

export type QuickOpId =
  | 'rotate+45'
  | 'rotate-45'
  | 'scale2x'
  | 'scaleHalf'
  | 'flipY'
  | 'flipX'
  | 'shear+0.1';

/** Apply a relative-modifier quick-op to a decomposed affine. Returns
 *  a new object; the input is not mutated. */
export function applyQuickOp(op: QuickOpId, d: DecomposedAffine): DecomposedAffine {
  const next: DecomposedAffine = { ...d };
  switch (op) {
    case 'rotate+45':
      next.rotation = ((next.rotation + 45) % 360 + 360) % 360;
      break;
    case 'rotate-45':
      next.rotation = ((next.rotation - 45) % 360 + 360) % 360;
      break;
    case 'scale2x':
      next.scaleX *= 2;
      next.scaleY *= 2;
      break;
    case 'scaleHalf':
      next.scaleX /= 2;
      next.scaleY /= 2;
      break;
    case 'flipY':
      next.scaleY = -next.scaleY;
      break;
    case 'flipX':
      next.scaleX = -next.scaleX;
      break;
    case 'shear+0.1':
      next.shear += 0.1;
      break;
  }
  return next;
}

/** Strip definition — the 7 button order, label, delta tag, glyph icon.
 *  Consumed by the affine quick-ops strip in edit-section-xforms.ts (regular +
 *  final xform detail panes share that one builder). */
export const QUICK_OPS_DEFS: readonly { id: QuickOpId; label: string; delta: string; icon: string }[] = [
  { id: 'rotate+45', label: 'rotate', delta: '+45°', icon: '↻' },
  { id: 'rotate-45', label: 'rotate', delta: '−45°', icon: '↺' },
  { id: 'scale2x',   label: 'scale',  delta: '×2',   icon: '⤢' },
  { id: 'scaleHalf', label: 'scale',  delta: '×½',   icon: '⤡' },
  { id: 'flipY',     label: 'flip y', delta: '',     icon: '⇕' },
  { id: 'flipX',     label: 'flip x', delta: '',     icon: '⇔' },
  { id: 'shear+0.1', label: 'shear',  delta: '+0.1', icon: '⇄' },
];
