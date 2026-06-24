// The reserved corpus gen for pyr3-native flames (#435). Chosen ABOVE every
// ESF gen (max 248) so the gallery's newest-first order leads with pyr3
// originals. Single source of truth: the bake assigns this gen, the merge
// orders it, and the gallery + viewer DISPLAY it as "pyr3" rather than the raw
// number. The on-the-wire gen (URLs, chunk paths, feature records) stays the
// integer — only the human-facing label is mapped.
export const PYR3_NATIVE_GEN = 1000;

/** Human-facing label for a corpus gen: the pyr3-native gen shows as "pyr3";
 *  every ESF gen shows its number. Also the URL path segment — the native gen
 *  appears as `/…/gen/pyr3/…` rather than `/…/gen/1000/…` (#435). */
export function formatGenLabel(gen: number): string {
  return gen === PYR3_NATIVE_GEN ? 'pyr3' : String(gen);
}

/** Inverse of formatGenLabel for a URL gen segment: "pyr3" → the native gen,
 *  a non-negative integer string → that number, anything else → null. Numeric
 *  is still accepted so any old `/gen/1000/…` link keeps resolving. */
export function parseGenSegment(seg: string): number | null {
  if (seg === 'pyr3') return PYR3_NATIVE_GEN;
  if (/^\d+$/.test(seg)) return Number(seg);
  return null;
}
