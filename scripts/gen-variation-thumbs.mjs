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
import { CATALOG_DATA } from '../src/variation-catalog-data.ts';
const CATALOG_ENTRIES = CATALOG_DATA;

// #166: build a catalog-warpFn fallback so post-V130 ports (which broke
// the ts_var_* reference-impl convention — see [[variations.ts]]) still
// produce thumbnails. The catalog warpFn shape is `(x, y) -> [x, y]`;
// adapt to the bake harness's `({tx, ty, ...}) -> {x, y}` shape.
const CATALOG_BY_NAME = Object.create(null);
for (const entry of CATALOG_ENTRIES) {
  if (typeof entry.warpFn === 'function') {
    CATALOG_BY_NAME[entry.name] = entry.warpFn;
  }
}
function adaptCatalogFn(warpFn) {
  return ({ tx, ty }) => {
    const [x, y] = warpFn(tx, ty);
    return { x, y };
  };
}

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

// ──────────────────────────────────────────────────────────────────────
// Fallback schematics for variations whose math reads xform-affine
// context that the bake doesn't supply. Each helper plots a recognizable
// shape so a user browsing the picker isn't faced with a black square.
// ──────────────────────────────────────────────────────────────────────

function pset(png, px, py) {
  if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) return;
  const idx = (py * SIZE + px) * 4;
  png.data[idx] = 255;
  png.data[idx + 1] = 255;
  png.data[idx + 2] = 255;
  png.data[idx + 3] = 255;
}

/** Plot a circle of radius r (px) around (cx, cy) — used for rings, julia, etc. */
function plotCircle(png, cx, cy, r) {
  const steps = Math.max(16, Math.floor(r * 6));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pset(png, Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
  }
}

/** Plot a line from (x0,y0) to (x1,y1) — Bresenham-ish. */
function plotLine(png, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let i = 0; i < dx + dy + 1; i++) {
    pset(png, x, y);
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/** Plot a sine wave across the width — used for waves / waves2. */
function plotSineWave(png, amp, freq) {
  for (let x = 0; x < SIZE; x++) {
    const y = Math.round(SIZE / 2 + amp * Math.sin((x / SIZE) * Math.PI * 2 * freq));
    pset(png, x, y);
  }
}

const CENTER = SIZE / 2;

/** Map variation name → schematic-drawing function. Each receives the PNG
 *  and is expected to plot recognizable pixels for that family. Variations
 *  not in this map (and that baked empty) fall back to a "first letter"
 *  glyph elsewhere. */
const SCHEMATIC = {
  // ── Wave / ring family — radially symmetric or sinusoidal ──
  rings: (png) => { for (const r of [10, 18, 26]) plotCircle(png, CENTER, CENTER, r); },
  rings2: (png) => { for (const r of [8, 16, 24]) plotCircle(png, CENTER, CENTER, r); },
  waves: (png) => plotSineWave(png, 12, 2),
  waves2: (png) => plotSineWave(png, 10, 3),
  fan: (png) => {
    // 8 radial spokes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      plotLine(png, CENTER, CENTER,
        Math.round(CENTER + 28 * Math.cos(a)), Math.round(CENTER + 28 * Math.sin(a)));
    }
  },
  fan2: (png) => SCHEMATIC.fan(png),
  popcorn: (png) => {
    // Scattered dots in a roughly grid pattern
    for (let i = 0; i < 60; i++) {
      const x = (i * 13) % SIZE, y = (i * 23 + 7) % SIZE;
      pset(png, x, y);
    }
  },
  popcorn2: (png) => SCHEMATIC.popcorn(png),
  // ── Julia family — concentric/swirly attractor shapes ──
  julian: (png) => { plotCircle(png, CENTER, CENTER, 22); plotCircle(png, CENTER, CENTER, 12); for (let i = 0; i < 32; i++) pset(png, Math.round(CENTER + 6 * Math.cos(i / 5)), Math.round(CENTER + 6 * Math.sin(i / 5))); },
  juliascope: (png) => SCHEMATIC.julian(png),
  wedge_julia: (png) => SCHEMATIC.julian(png),
  // ── Perspective / wedge — trapezoidal box ──
  perspective: (png) => {
    plotLine(png, 16, 20, 48, 20);
    plotLine(png, 8, 44, 56, 44);
    plotLine(png, 16, 20, 8, 44);
    plotLine(png, 48, 20, 56, 44);
  },
  wedge: (png) => SCHEMATIC.fan(png),
  wedge_sph: (png) => SCHEMATIC.fan(png),
  // ── Rectangular / grid family ──
  rectangles: (png) => {
    for (const r of [[16, 16, 48, 48], [22, 22, 42, 42], [28, 28, 36, 36]]) {
      const [x0, y0, x1, y1] = r;
      plotLine(png, x0, y0, x1, y0);
      plotLine(png, x1, y0, x1, y1);
      plotLine(png, x1, y1, x0, y1);
      plotLine(png, x0, y1, x0, y0);
    }
  },
  ngon: (png) => {
    // 5-sided polygon
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      pts.push([Math.round(CENTER + 22 * Math.cos(a)), Math.round(CENTER + 22 * Math.sin(a))]);
    }
    for (let i = 0; i < 5; i++) plotLine(png, pts[i][0], pts[i][1], pts[(i + 1) % 5][0], pts[(i + 1) % 5][1]);
  },
  // ── Blur / noise family — scattered dot field ──
  noise: (png) => {
    let s = 12345;
    for (let i = 0; i < 80; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      pset(png, (s >>> 0) % SIZE, (s >>> 8) % SIZE);
    }
  },
  blur: (png) => SCHEMATIC.noise(png),
  gaussian_blur: (png) => SCHEMATIC.noise(png),
  pre_blur: (png) => SCHEMATIC.noise(png),
  square: (png) => SCHEMATIC.rectangles(png),
  rays: (png) => {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      plotLine(png, CENTER, CENTER,
        Math.round(CENTER + 28 * Math.cos(a)), Math.round(CENTER + 28 * Math.sin(a)));
    }
  },
  blade: (png) => {
    // X shape
    plotLine(png, 10, 10, SIZE - 10, SIZE - 10);
    plotLine(png, SIZE - 10, 10, 10, SIZE - 10);
  },
  twintrian: (png) => SCHEMATIC.blade(png),
  radial_blur: (png) => SCHEMATIC.rays(png),
  // ── Split / stripes — horizontal bars ──
  split: (png) => { for (const y of [20, 32, 44]) for (let x = 8; x < SIZE - 8; x++) pset(png, x, y); },
  splits: (png) => SCHEMATIC.split(png),
  stripes: (png) => SCHEMATIC.split(png),
  // ── Periodic / modular field ──
  modulus: (png) => {
    for (let y = 8; y < SIZE - 8; y += 8) for (let x = 8; x < SIZE - 8; x += 8) pset(png, x, y);
  },
  super_shape: (png) => SCHEMATIC.ngon(png),
  parabola: (png) => {
    for (let x = 0; x < SIZE; x++) {
      const t = (x - CENTER) / 20;
      const y = Math.round(CENTER + t * t * 6);
      pset(png, x, y);
    }
  },
  pie: (png) => {
    // Pie chart — three slices
    plotCircle(png, CENTER, CENTER, 24);
    plotLine(png, CENTER, CENTER, CENTER + 24, CENTER);
    plotLine(png, CENTER, CENTER, CENTER - 12, CENTER - 20);
    plotLine(png, CENTER, CENTER, CENTER - 12, CENTER + 20);
  },
  separation: (png) => {
    // Two horizontal bars with a gap
    for (let x = 8; x < SIZE - 8; x++) { pset(png, x, 22); pset(png, x, 42); }
  },
  lazysusan: (png) => SCHEMATIC.julian(png),
  oscope: (png) => plotSineWave(png, 14, 3),
  whorl: (png) => SCHEMATIC.julian(png),
  pdj: (png) => SCHEMATIC.blade(png),
  mobius: (png) => SCHEMATIC.julian(png),
};

/** Last-resort fallback: render the variation's first letter as a 5x7
 *  bitmap glyph centered in the canvas. */
const GLYPH_5X7 = {
  A: ['.111.', '1...1', '1...1', '11111', '1...1', '1...1', '1...1'],
  B: ['1111.', '1...1', '1...1', '1111.', '1...1', '1...1', '1111.'],
  C: ['.111.', '1...1', '1....', '1....', '1....', '1...1', '.111.'],
  // (omitted — most empty variations have a SCHEMATIC entry; the glyph
  //  fallback is only for the residual handful, which we'll grow on demand)
};

function plotGlyph(png, ch) {
  const g = GLYPH_5X7[ch.toUpperCase()];
  if (!g) return false;
  const startX = Math.floor((SIZE - 5 * 4) / 2);
  const startY = Math.floor((SIZE - 7 * 4) / 2);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (g[row][col] === '1') {
        // Draw as a 4x4 block per glyph pixel for visibility.
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
          pset(png, startX + col * 4 + dx, startY + row * 4 + dy);
        }
      }
    }
  }
  return true;
}

/** Bake one variation. Writes <OUT_DIR>/<name>.png. Returns hits count. */
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

  // If the bake produced zero pixels (variation reads xform context the
  // bake doesn't supply), fall back to a hand-drawn schematic that
  // matches the variation's name pattern. So the picker shows a
  // recognizable shape for "rings" / "waves" / "fan" / etc., instead of
  // a black square.
  if (hits === 0) {
    const schematic = SCHEMATIC[name];
    if (schematic) {
      schematic(png);
    } else {
      // Last resort: render the first letter. Returns false if the glyph
      // isn't defined yet — leaves the PNG black; expand GLYPH_5X7 on demand.
      plotGlyph(png, name[0]);
    }
  }

  const buf = PNG.sync.write(png);
  writeFileSync(join(OUT_DIR, `${name}.png`), buf);
  return hits;
}

let count = 0;
let skipped = 0;
let fromCatalog = 0;
let fromGlyph = 0;

const tsByName = Object.create(null);
for (const exportName of Object.keys(TS)) {
  if (exportName.startsWith('ts_var_')) {
    tsByName[exportName.slice('ts_var_'.length)] = TS[exportName];
  }
}

// Bake every variation in the catalog. Each name is sourced in this
// priority: (1) the ts_var_* reference impl, (2) the catalog warpFn,
// (3) the SCHEMATIC drop-back, (4) a first-letter glyph (handled by
// bake() itself).
for (const entry of CATALOG_ENTRIES) {
  const name = entry.name;
  let fn = tsByName[name];
  let source = 'ts_var_';
  if (typeof fn !== 'function') {
    const catalogFn = CATALOG_BY_NAME[name];
    if (catalogFn) {
      fn = adaptCatalogFn(catalogFn);
      source = 'catalog';
      fromCatalog++;
    } else {
      // No ts_var_* AND no catalog warpFn — let bake() draw a glyph
      // by passing a no-op fn.
      fn = () => null;
      source = 'glyph';
      fromGlyph++;
    }
  }
  const hits = bake(name, fn);
  if (hits === 0 && source === 'ts_var_') {
    // The variation may need specific params (e.g. radial_blur with angle=0)
    // — empty thumbnails still get written so the picker has SOMETHING to
    // load, but log so we know to revisit.
    console.warn(`  warn: ${name} produced 0 plotted points (ts_var_)`);
  }
  count++;
}

console.log(`baked ${count} variation thumbnails → ${OUT_DIR}`);
console.log(`  ${count - fromCatalog - fromGlyph} from ts_var_, ${fromCatalog} from catalog warpFn, ${fromGlyph} from glyph fallback`);
if (skipped > 0) console.log(`  skipped ${skipped} non-function exports`);
