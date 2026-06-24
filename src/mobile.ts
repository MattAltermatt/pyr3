// pyr3 — device-TYPE detection for the mobile consumption experience (#66).
// NOT to be confused with device.ts (GPU device init). SEAM_EXEMPT: reads
// window/matchMedia, which only exist in the browser; the CLI never imports it.

/** Viewport width (px) at or below which pyr3 shows the stripped mobile
 *  experience. A narrowed desktop window below this also gets mobile mode —
 *  standard responsive behavior, and keeps the check trivially testable. */
export const MOBILE_MAX_WIDTH = 820;

/** True when pyr3 should present the consumption-only mobile experience.
 *  Primary signal: viewport width ≤ MOBILE_MAX_WIDTH. Secondary: a coarse
 *  pointer (touch) at a slightly wider width still counts (small tablets in
 *  portrait that edge just past the breakpoint). */
export function isMobile(): boolean {
  const w = window.innerWidth;
  if (w <= MOBILE_MAX_WIDTH) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  return coarse && w <= MOBILE_MAX_WIDTH + 160;
}

/** Subscribe to viewport crossings of the mobile breakpoint. Calls `cb`
 *  whenever a resize changes the isMobile() verdict. Returns a teardown. */
export function onMobileChange(cb: (mobile: boolean) => void): () => void {
  let last = isMobile();
  const onResize = (): void => {
    const now = isMobile();
    if (now !== last) {
      last = now;
      cb(now);
    }
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
