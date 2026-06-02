// #72 CPU DE-oracle: confirm flam3-faithful windowed-density filter selection
// recovers 248.25703 parity BEFORE touching the GPU DE shader.
//
// Pipeline: GPU chaos (no DE) → read back raw super-res u32 histogram →
//   (A) pyr3's actual GPU DE (read density.filtered)            [baseline ≈ R 14]
//   (B) CPU f64 flam3-faithful DE (scatter, windowed f_select)  [candidate]
// Both → visualize_f64 (the #27 f64 tonemap port) → R vs flam3-C golden.
//
// Usage:
//   node --import tsx/esm --import ./bin/wgsl-loader-register.mjs \
//     scripts/pyr3-072-de-oracle.ts <fixtureDir-with-flam3+golden>
// where the dir holds `<name>.flam3` and `golden.png`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { createChaosPass } from '../src/chaos';
import { createDensityPass } from '../src/density';
import { type Genome } from '../src/genome';
import { type Tonemap, DEFAULT_TONEMAP } from '../src/tonemap';
import { deriveCalibration } from '../src/calibration';
import { buildGaussianKernel } from '../src/spatial-filter';
import { meanAbsDiffRgba } from '../src/compare';
import { computeDispatch, DEFAULT_SPP, createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText } from '../bin/host';
import { visualizeF64 } from './lib-visualize-f64';

installWebGPUHost();

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(resolve(__dirname, '..'), '.remember', 'tmp', 'pyr3-072-oracle');

// ---- flam3-faithful density estimation (CPU f64, scatter) ----
// Mirrors flam3 rect.c:78-145 + filters.c:272-396 (Scott Draves & Erik Reckase).
const DE_THRESH = 100;
const GAUSS_SUPPORT = 1.5;
const gauss = (x: number) => Math.exp(-2 * x * x) * Math.sqrt(2 / Math.PI);

function flam3DE(
  hist: Uint32Array, superW: number, superH: number,
  maxRad: number, minRad: number, curve: number, ss: number,
  k1: number, k2: number,
): Float32Array {
  const compMax = maxRad * ss + 1;
  const compMin = minRad * ss + 1;
  const win = Math.floor(ss / 2); // flam3 ss = floor(oversample/2); density window = (2*win+1)^2
  const scf = (ss & 1) === 0;
  const scfact = Math.pow(ss / (ss + 1), 2);

  // de_filt_sum memo keyed by width (rounded) — Σ gaussian over the disc.
  const sumMemo = new Map<number, number>();
  const filtSum = (width: number): number => {
    const key = Math.round(width * 100);
    const hit = sumMemo.get(key);
    if (hit !== undefined) return hit;
    const half = Math.ceil(width);
    let s = 0;
    for (let dj = -half; dj <= half; dj++)
      for (let dk = -half; dk <= half; dk++) {
        const dd = Math.sqrt(dj * dj + dk * dk) / width;
        if (dd <= 1.0) s += gauss(GAUSS_SUPPORT * dd);
      }
    sumMemo.set(key, s);
    return s;
  };

  const widthFor = (fselect: number): number => {
    let idx: number;
    if (fselect <= DE_THRESH) idx = Math.ceil(fselect) - 1;
    else idx = DE_THRESH + Math.floor(Math.pow(fselect - DE_THRESH, curve));
    if (idx < 0) idx = 0;
    let h: number;
    if (idx < DE_THRESH) h = compMax / Math.pow(idx + 1, curve);
    else { const adj = Math.pow(idx - DE_THRESH, 1 / curve) + DE_THRESH; h = compMax / Math.pow(adj + 1, curve); }
    return h <= compMin ? compMin : h;
  };

  const out = new Float32Array(superW * superH * 4);
  for (let y = 0; y < superH; y++) {
    for (let x = 0; x < superW; x++) {
      const b = (y * superW + x) * 4;
      const cnt = hist[b + 3];
      if (cnt === 0) continue;

      // f_select = scfact * Σ (count/255) over the (2*win+1)^2 window around (x,y).
      let fsel = 0;
      for (let dy = -win; dy <= win; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= superH) continue;
        for (let dx = -win; dx <= win; dx++) {
          const nx = x + dx; if (nx < 0 || nx >= superW) continue;
          fsel += hist[(ny * superW + nx) * 4 + 3] / 255;
        }
      }
      if (scf) fsel *= scfact;

      const width = widthFor(fsel);
      const norm = filtSum(width);
      const ls = (k1 * Math.log(1 + cnt * k2)) / cnt;
      const r = hist[b], g = hist[b + 1], bl = hist[b + 2];
      const half = Math.ceil(width);
      for (let dj = -half; dj <= half; dj++) {
        const ty = y + dj; if (ty < 0 || ty >= superH) continue;
        for (let dk = -half; dk <= half; dk++) {
          const tx = x + dk; if (tx < 0 || tx >= superW) continue;
          const dd = Math.sqrt(dj * dj + dk * dk) / width;
          if (dd > 1.0) continue;
          const w = (gauss(GAUSS_SUPPORT * dd) / norm) * ls;
          const o = (ty * superW + tx) * 4;
          out[o] += r * w; out[o + 1] += g * w; out[o + 2] += bl * w; out[o + 3] += cnt * w;
        }
      }
    }
  }
  return out;
}

async function readBufF32(device: GPUDevice, src: GPUBuffer, byteLength: number): Promise<Float32Array> {
  const rb = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, 0, rb, 0, byteLength);
  device.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(rb.getMappedRange().slice(0));
  rb.unmap(); rb.destroy();
  return out;
}

function loadGolden(path: string, w: number, h: number): Uint8Array {
  const png = PNG.sync.read(readFileSync(path));
  if (png.width !== w || png.height !== h) throw new Error(`golden ${png.width}x${png.height} != ${w}x${h}`);
  return new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
}
function savePng(path: string, rgba: Uint8Array, w: number, h: number): void {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  writeFileSync(path, PNG.sync.write(png));
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: pyr3-072-de-oracle.ts <fixtureDir>');
  const name = basename(dir);
  const flamePath = join(dir, `${name}.flam3`);
  const goldenPath = join(dir, 'golden.png');

  const text = readFileSync(flamePath, 'utf8');
  const genome: Genome = parseGenomeText(text, flamePath).genome;
  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
  const superW = width * oversample, superH = height * oversample;
  const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
  const tonemap: Tonemap = genome.tonemap ?? DEFAULT_TONEMAP;
  const background: [number, number, number] = (genome.background ?? [0, 0, 0]) as [number, number, number];
  const density = genome.density!;
  if (!density) throw new Error('fixture has no DE params');

  const device = await acquireDawnDevice('pyr3-072-oracle');
  const seed = 0x12345 >>> 0;

  const chaos = createChaosPass(device, { width: superW, height: superH, walkers: 4096, itersPerWalker: 256, fuse: 200, oversample });
  const densityPass = createDensityPass(device, { width: superW, height: superH }, chaos.histogram);
  const targetSpp = genome.quality ?? DEFAULT_SPP;
  const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(targetSpp, width, height);
  const { k1, k2 } = deriveCalibration({ scale: genome.scale, sampleCount: actualSamples, brightness: tonemap.brightness, oversample });

  chaos.setPalette(genome.palette);
  chaos.reset();
  chaos.dispatch(genome, seed, { walkers: dispatchWalkers, itersPerWalker: dispatchIters });

  // Raw super-res histogram (u32) for the CPU flam3 DE.
  const histByteLen = superW * superH * 4 * 4;
  const histRaw = await readBufF32(device, chaos.histogram, histByteLen);
  const histU32 = new Uint32Array(histRaw.buffer, histRaw.byteOffset, histRaw.length);

  // Baseline: pyr3's actual GPU DE.
  densityPass.dispatch(density, k1, k2, oversample);
  const pyr3Filtered = await readBufF32(device, densityPass.filtered, histByteLen);

  const kernel1d = buildGaussianKernel(filterRadius, oversample);
  const fwidth = kernel1d.length;
  const vizArgs = {
    kernel1d, outW: width, outH: height, superW, superH, oversample, fwidth,
    k1, k2, gamma: tonemap.gamma, vibrancy: tonemap.vibrancy, highpow: tonemap.highlightPower,
    linrange: tonemap.gammaThreshold, background,
  } as const;

  const golden = loadGolden(goldenPath, width, height);

  const pyr3Rgba = visualizeF64({ hist: pyr3Filtered, histKind: 'f32', ...vizArgs });
  const R_pyr3 = meanAbsDiffRgba(pyr3Rgba, golden);

  const ss = Math.floor(oversample / 2);
  console.log(`[#72 oracle] ${name}  ${width}x${height} OS=${oversample} ss=${ss}  maxRad=${density.maxRad} curve=${density.curve}`);
  console.log(`  pyr3 GPU DE          R=${R_pyr3.toFixed(3)}`);

  const flamFiltered = flam3DE(histU32, superW, superH, density.maxRad, density.minRad, density.curve, ss, k1, k2);
  const flamRgba = visualizeF64({ hist: flamFiltered, histKind: 'f32', ...vizArgs });
  const R_flam = meanAbsDiffRgba(flamRgba, golden);
  console.log(`  flam3-faithful CPU DE R=${R_flam.toFixed(3)}   Δ vs pyr3 = ${(R_pyr3 - R_flam).toFixed(3)}`);

  mkdirSync(OUT_DIR, { recursive: true });
  savePng(join(OUT_DIR, `${name}-pyr3-de.png`), pyr3Rgba, width, height);
  savePng(join(OUT_DIR, `${name}-flam3-de.png`), flamRgba, width, height);
  console.log(`  wrote renders → ${OUT_DIR}`);

  chaos.destroy(); densityPass.destroy();
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((e: unknown) => { console.error('pyr3-072-oracle failed:', e); process.exit(1); });
