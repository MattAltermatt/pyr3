// #119 — Variation Catalog warp diagram.
//
// For each variation that has a deterministic 2D impl (most do; the
// RNG-driven ones don't), the catalog renders a small SVG showing how
// the function warps a regular grid. Domain: [-π, π]². ViewBox -2..2 so
// the unit-square / unit-circle is visible without extreme zoom. Outputs
// that explode (e.g. spherical near the origin) get clipped to keep the
// path data finite.

const GRID_N = 14;
const SAMPLES = 60;
const RANGE = Math.PI;
const CLIP = 50;

export interface BuildWarpOpts {
  /** When provided, axis lines + warp lines pick up these classes
   *  instead of the defaults. Useful for testing. */
  classes?: {
    axis?: string;
    line?: string;
  };
}

/** Build an SVG `<svg>...</svg>` string for the variation's warp diagram.
 *  Returns a complete root element so callers can `innerHTML = ...` into a
 *  pane container. The y-axis is flipped (SVG y grows downward) so
 *  positive-y math input corresponds to upward on screen. */
export function buildWarpSvg(
  fn: (x: number, y: number) => [number, number],
  opts: BuildWarpOpts = {},
): string {
  const axisClass = opts.classes?.axis ?? 'warp-axis';
  const lineClass = opts.classes?.line ?? 'warp-line';

  const parts: string[] = [];
  parts.push(`<line class="${axisClass}" x1="${-RANGE}" y1="0" x2="${RANGE}" y2="0"/>`);
  parts.push(`<line class="${axisClass}" x1="0" y1="${-RANGE}" x2="0" y2="${RANGE}"/>`);

  for (let dir = 0; dir < 2; dir++) {
    for (let i = 0; i <= GRID_N; i++) {
      const fixed = -RANGE + (2 * RANGE * i) / GRID_N;
      let d = '';
      let penDown = false;
      for (let j = 0; j <= SAMPLES; j++) {
        const moving = -RANGE + (2 * RANGE * j) / SAMPLES;
        const [x0, y0] = dir === 0 ? [moving, fixed] : [fixed, moving];
        const [wx, wy] = fn(x0, y0);
        if (!Number.isFinite(wx) || !Number.isFinite(wy) || Math.abs(wx) > CLIP || Math.abs(wy) > CLIP) {
          // Lift the pen — the next valid sample restarts the path.
          penDown = false;
          continue;
        }
        d += (penDown ? 'L' : 'M') + ' ' + wx.toFixed(4) + ' ' + wy.toFixed(4) + ' ';
        penDown = true;
      }
      if (d.length > 0) parts.push(`<path class="${lineClass}" d="${d.trim()}"/>`);
    }
  }

  // xmlns is required so DOMParser-then-importNode correctly typecasts the
  // result into the SVG namespace; without it, the elements come through as
  // unknown HTML elements and SVG presentation attributes go inert.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 4 4" preserveAspectRatio="xMidYMid meet">`
       + `<g transform="scale(1,-1)">${parts.join('')}</g>`
       + `</svg>`;
}
