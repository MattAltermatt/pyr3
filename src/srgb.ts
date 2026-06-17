// #334 — sRGB transfer inverse, used to author the default EXR export.
//
// pyr3's fragment shader writes already-sRGB-encoded display values (the same
// bytes PNG viewers interpret as sRGB — see bin/pyr3-render.ts). EXR consumers
// (Preview / Photoshop-32bit / Affinity / Krita / djv) instead assume the file
// is scene-LINEAR and apply an sRGB encode on view. So to make the EXR open
// looking exactly like the editor, we store the LINEAR LIGHT of the display
// image — sRGB_to_linear(displayPixel) — and the viewer's linear→sRGB encode
// round-trips back to the editor look. Storing the display bytes directly would
// double-gamma (wash out); storing raw accumulation would blow out (white).

/** Inverse sRGB transfer (electro-optical): display-encoded [0,1] → linear. */
export function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92;
  return Math.pow((c + 0.055) / 1.055, 2.4);
}
