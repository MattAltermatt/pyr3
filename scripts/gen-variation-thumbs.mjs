#!/usr/bin/env node
// Bake 64×64 PNG thumbnails for every variation in src/variations.ts.
//
// For each ts_var_*, apply it to a 20×20 grid of points in [-1, 1]² and
// plot the image as white pixels in a black PNG. The picker's <img> tags
// load these directly. Re-run on variation additions.
//
// Run via: npm run gen:variation-thumbs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as TS from '../src/variations.ts';
import { VARIATION_PARAMS, VARIATION_DEFAULTS } from '../src/serialize.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'variation-thumbs');
const SIZE = 64;
const GRID = 20;
const WORLD_HALF = 1.5; // [-1.5, 1.5]² shown — gives variations room to breathe.

mkdirSync(OUT_DIR, { recursive: true });

/** Map (x, y) world → (px, py) image. (0,0) world is centered; +y is up. */
function toPx(x, y) {
  return [
    Math.round((x / (2 * WORLD_HALF) + 0.5) * SIZE),
    Math.round((-y / (2 * WORLD_HALF) + 0.5) * SIZE),
  ];
}

/** Build a params object from VARIATION_PARAMS + VARIATION_DEFAULTS so
 *  parameterized variations (julian, ngon, blob, ...) bake with their
 *  flam3-canonical defaults instead of NaN-producing zeros. */
function defaultParamsFor(name) {
  const keys = VARIATION_PARAMS[name];
  if (!keys) return {};
  const defaults = VARIATION_DEFAULTS[name];
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = defaults?.[i] ?? 0;
  }
  return out;
}

/** Bake one variation. Writes <OUT_DIR>/<name>.png. Returns true on success. */
function bake(name, fn) {
  const png = new PNG({ width: SIZE, height: SIZE });
  // Fill black background.
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  }

  let hits = 0;
  for (let gy = 0; gy <= GRID; gy++) {
    for (let gx = 0; gx <= GRID; gx++) {
      const tx = -1 + (2 * gx) / GRID;
      const ty = -1 + (2 * gy) / GRID;
      let out;
      try {
        out = fn({
          tx, ty,
          weight: 1,
          params: defaultParamsFor(name),
          randBranch: 0,
          randValues: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
        });
      } catch {
        continue;
      }
      if (!out || !Number.isFinite(out.x) || !Number.isFinite(out.y)) continue;
      const [px, py] = toPx(out.x, out.y);
      if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
      const idx = (py * SIZE + px) * 4;
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = 255;
      hits++;
    }
  }

  const buf = PNG.sync.write(png);
  writeFileSync(join(OUT_DIR, `${name}.png`), buf);
  return hits;
}

let count = 0;
let skipped = 0;
for (const exportName of Object.keys(TS)) {
  if (!exportName.startsWith('ts_var_')) continue;
  const name = exportName.slice('ts_var_'.length);
  const fn = TS[exportName];
  if (typeof fn !== 'function') {
    skipped++;
    continue;
  }
  const hits = bake(name, fn);
  if (hits === 0) {
    // The variation may need specific params (e.g. radial_blur with angle=0)
    // — empty thumbnails still get written so the picker has SOMETHING to
    // load, but log so we know to revisit.
    console.warn(`  warn: ${name} produced 0 plotted points`);
  }
  count++;
}
console.log(`baked ${count} variation thumbnails → ${OUT_DIR}`);
if (skipped > 0) console.log(`  skipped ${skipped} non-function exports`);
