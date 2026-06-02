// PYR3-027 f64 tonemap oracle probe.
//
// Runs the GPU pipeline (chaos + density) → reads back the post-DE filtered
// f32 buffer → runs a JS f64 port of visualize_u32.wgsl on it. Compares
// R(GPU f32 tonemap) vs R(CPU f64 tonemap) against the flam3-C golden.
//
// Question: does swapping the GPU f32 tonemap math for a CPU f64 implementation
// produce a measurable parity win on the current tier-2 fixtures? If yes,
// #27's premise (precision floor in the visualize fragment shader) holds and
// the shim is worth shipping. If R(f64) ≈ R(f32) within noise, the residual
// is upstream (chaos / DE) and #27 should be closed as superseded.
//
// Usage:
//   npx tsx scripts/pyr3-027-f64-tonemap-oracle.ts [fixture-id...]
// Defaults to the 4 current tier-2 fixtures.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { createChaosPass, HIST_CHANNELS } from '../src/chaos';
import { createDensityPass } from '../src/density';
import { type Genome } from '../src/genome';
import { type Tonemap, DEFAULT_TONEMAP } from '../src/tonemap';
import { deriveCalibration, PREFILTER_WHITE } from '../src/calibration';
import { buildGaussianKernel } from '../src/spatial-filter';
import { meanAbsDiffRgba } from '../src/compare';
import { computeDispatch, DEFAULT_SPP, createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { installWebGPUHost, acquireDawnDevice, parseGenomeText } from '../bin/host';

installWebGPUHost();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const GOLDENS_DIR = join(REPO_ROOT, 'fixtures', 'flam3-goldens');
const OUT_DIR = join(REPO_ROOT, '.remember', 'tmp', 'pyr3-027-oracle');

const DEFAULT_TIER2_FIXTURES = ['248.23554', '244.82986', 'coverage.248.02226', '244.42746'];

// ---------- f64 port of visualize_u32.wgsl tonemap math ----------

function rgb2hsv_f64(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = (g - b) / d;
    else if (mx === g) h = 2 + (b - r) / d;
    else h = 4 + (r - g) / d;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = mx > 0 ? d / mx : 0;
  return [h, s, mx];
}

function hsv2rgb_f64(h: number, s: number, v: number): [number, number, number] {
  const hh = h / 60;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const ix = ((i % 6) + 6) % 6;
  if (ix === 0) return [v, t, p];
  if (ix === 1) return [q, v, p];
  if (ix === 2) return [p, v, t];
  if (ix === 3) return [p, q, v];
  if (ix === 4) return [t, p, v];
  return [v, p, q];
}

function calc_alpha_f64(density: number, g_inv: number, linrange: number): number {
  if (density <= 0) return 0;
  if (density < linrange) {
    const funcval = Math.pow(linrange, g_inv);
    const frac = density / linrange;
    return (1 - frac) * density * (funcval / linrange) + frac * Math.pow(density, g_inv);
  }
  return Math.pow(density, g_inv);
}

function calc_newrgb_f64(r: number, g: number, b: number, ls: number, highpow: number): [number, number, number] {
  if (ls === 0 || (r === 0 && g === 0 && b === 0)) return [0, 0, 0];
  const sR = ls * (r / PREFILTER_WHITE);
  const sG = ls * (g / PREFILTER_WHITE);
  const sB = ls * (b / PREFILTER_WHITE);
  let maxa = sR;
  let maxc = r / PREFILTER_WHITE;
  if (sG > maxa) { maxa = sG; maxc = g / PREFILTER_WHITE; }
  if (sB > maxa) { maxa = sB; maxc = b / PREFILTER_WHITE; }

  if (maxa > 255 && highpow >= 0) {
    const newls = 255 / maxc;
    const lsratio = Math.pow(newls / ls, highpow);
    const nr = (newls * (r / PREFILTER_WHITE)) / 255;
    const ng = (newls * (g / PREFILTER_WHITE)) / 255;
    const nb = (newls * (b / PREFILTER_WHITE)) / 255;
    const hsv = rgb2hsv_f64(nr, ng, nb);
    hsv[1] *= lsratio;
    const out = hsv2rgb_f64(hsv[0], hsv[1], hsv[2]);
    return [out[0] * 255, out[1] * 255, out[2] * 255];
  }
  const newls = 255 / maxc;
  let adjhlp = -highpow;
  if (adjhlp > 1) adjhlp = 1;
  if (maxa <= 255) adjhlp = 1;
  const mix = (1 - adjhlp) * newls + adjhlp * ls;
  return [mix * (r / PREFILTER_WHITE), mix * (g / PREFILTER_WHITE), mix * (b / PREFILTER_WHITE)];
}

interface OracleInputs {
  hist: Float32Array | Uint32Array;
  histKind: 'f32' | 'u32';    // 'f32' = post-DE (already log-tonemapped per bucket); 'u32' = raw chaos histogram
  kernel1d: Float32Array;
  outW: number; outH: number;
  superW: number; superH: number;
  oversample: number;
  fwidth: number;
  k1: number; k2: number;
  gamma: number; vibrancy: number; highpow: number; linrange: number;
  background: [number, number, number];
}

function visualize_f64(o: OracleInputs): Uint8Array {
  const out = new Uint8Array(o.outW * o.outH * 4);
  const g_inv = 1 / o.gamma;
  const halfW = o.fwidth >>> 1;
  const isF32 = o.histKind === 'f32';

  for (let yi = 0; yi < o.outH; yi++) {
    for (let xi = 0; xi < o.outW; xi++) {
      const cx = xi * o.oversample + (o.oversample >>> 1);
      const cy = yi * o.oversample + (o.oversample >>> 1);

      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
      for (let dy = 0; dy < o.fwidth; dy++) {
        const ky = o.kernel1d[dy]!;
        const sy = Math.min(Math.max(cy + dy - halfW, 0), o.superH - 1);
        for (let dx = 0; dx < o.fwidth; dx++) {
          const kx = o.kernel1d[dx]!;
          const sx = Math.min(Math.max(cx + dx - halfW, 0), o.superW - 1);
          const sb = (sy * o.superW + sx) * 4;
          const r = o.hist[sb + 0]!;
          const g = o.hist[sb + 1]!;
          const b = o.hist[sb + 2]!;
          const cnt = o.hist[sb + 3]!;
          const w = kx * ky;
          if (isF32) {
            // DE-on: density.filtered is already log-tonemapped per bucket.
            // Visualize just spatial-filters; no second ls application.
            sumR += r * w;
            sumG += g * w;
            sumB += b * w;
            sumA += cnt * w;
          } else if (cnt > 0) {
            // DE-off: raw u32 counts; apply ls = k1*log(1+cnt*k2)/cnt per bucket.
            const ls = (o.k1 * Math.log(1 + cnt * o.k2)) / cnt;
            sumR += r * ls * w;
            sumG += g * ls * w;
            sumB += b * ls * w;
            sumA += cnt * ls * w;
          }
        }
      }

      const oi = (yi * o.outW + xi) * 4;
      if (sumA <= 0) {
        out[oi + 0] = Math.round(o.background[0] * 255);
        out[oi + 1] = Math.round(o.background[1] * 255);
        out[oi + 2] = Math.round(o.background[2] * 255);
        out[oi + 3] = 255;
        continue;
      }

      const tmp = sumA / PREFILTER_WHITE;
      let alpha = calc_alpha_f64(tmp, g_inv, o.linrange);
      const ls_alpha = (o.vibrancy * 256 * alpha) / Math.max(tmp, 1e-12);
      alpha = Math.min(Math.max(alpha, 0), 1);

      const newrgb = calc_newrgb_f64(sumR, sumG, sumB, ls_alpha, o.highpow);
      const perchR = (1 - o.vibrancy) * 256 * Math.pow(Math.max(sumR / PREFILTER_WHITE, 0), g_inv);
      const perchG = (1 - o.vibrancy) * 256 * Math.pow(Math.max(sumG / PREFILTER_WHITE, 0), g_inv);
      const perchB = (1 - o.vibrancy) * 256 * Math.pow(Math.max(sumB / PREFILTER_WHITE, 0), g_inv);

      const compR = newrgb[0] + perchR + (1 - alpha) * 256 * o.background[0];
      const compG = newrgb[1] + perchG + (1 - alpha) * 256 * o.background[1];
      const compB = newrgb[2] + perchB + (1 - alpha) * 256 * o.background[2];

      const fr = Math.min(Math.max(compR / 256, 0), 1);
      const fg = Math.min(Math.max(compG / 256, 0), 1);
      const fb = Math.min(Math.max(compB / 256, 0), 1);

      out[oi + 0] = Math.min(255, Math.max(0, Math.round(fr * 255)));
      out[oi + 1] = Math.min(255, Math.max(0, Math.round(fg * 255)));
      out[oi + 2] = Math.min(255, Math.max(0, Math.round(fb * 255)));
      out[oi + 3] = 255;
    }
  }
  return out;
}

// ---------- helpers ----------

async function readBufferToFloat32(device: GPUDevice, src: GPUBuffer, byteLength: number): Promise<Float32Array> {
  const readBuf = device.createBuffer({
    label: 'pyr3-027-oracle.readback',
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3-027-oracle.encoder' });
  encoder.copyBufferToBuffer(src, 0, readBuf, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  readBuf.destroy();
  return out;
}

function readPngRgba(path: string, width: number, height: number): Uint8Array {
  const png = PNG.sync.read(readFileSync(path));
  if (png.width !== width || png.height !== height) {
    throw new Error(`golden dim mismatch: png=${png.width}×${png.height}, want=${width}×${height}`);
  }
  return new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
}

function writePngRgba(path: string, rgba: Uint8Array, width: number, height: number): void {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  writeFileSync(path, PNG.sync.write(png));
}

async function probeFixture(fixtureId: string): Promise<{
  fixture: string;
  width: number; height: number;
  R_f32: number; R_f64: number;
  brightness: number; gamma: number; vibrancy: number; highpow: number;
}> {
  const fixtureDir = join(GOLDENS_DIR, fixtureId);
  const flamePath = join(fixtureDir, `${fixtureId}.flam3`);
  const goldenPath = join(fixtureDir, 'golden.png');
  if (!existsSync(flamePath)) throw new Error(`missing flame: ${flamePath}`);
  if (!existsSync(goldenPath)) throw new Error(`missing golden: ${goldenPath}`);

  const text = readFileSync(flamePath, 'utf8');
  const genome: Genome = parseGenomeText(text, flamePath).genome;
  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
  const superW = width * oversample;
  const superH = height * oversample;
  const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
  const tonemap: Tonemap = genome.tonemap ?? DEFAULT_TONEMAP;
  const background: [number, number, number] = (genome.background ?? [0, 0, 0]) as [number, number, number];

  const device = await acquireDawnDevice('pyr3-027-oracle');

  // --- 1. GPU render the normal way: produces the f32-PNG (today's path). ---
  const format = 'rgba8unorm' as const;
  const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });
  const tex = device.createTexture({
    label: 'pyr3-027-oracle.gpu-out',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  // Use a fixed seed so f32 and f64 oracle compare on the SAME histogram.
  const seed = 0x12345 >>> 0;
  renderer.render({ genome, outputView: tex.createView(), seed });

  // Read GPU output via texture → buffer.
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const readSize = bytesPerRow * height;
  const readBuf = device.createBuffer({
    label: 'pyr3-027-oracle.gpu-readback',
    size: readSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  {
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow, rowsPerImage: height }, { width, height });
    device.queue.submit([enc.finish()]);
  }
  await readBuf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  const f32Rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    f32Rgba.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
  }

  // --- 2. Reuse the renderer's chaos+density to populate the histogram, then read it back. ---
  // Re-run chaos with the SAME seed; the renderer's iterate/render is deterministic given the seed.
  // After render() above, the renderer's chaos histogram is still populated. We need access to
  // either chaos.histogram (DE off) or density.filtered (DE on). The Renderer interface doesn't
  // expose those, so we mirror buildPipelines here against the same GPUDevice.
  //
  // To keep the comparison fair, we replay chaos+density on a FRESH pipeline using the same seed.
  const chaos = createChaosPass(device, {
    width: superW, height: superH,
    walkers: 4096, itersPerWalker: 256, fuse: 200, oversample,
  });
  const density = createDensityPass(device, { width: superW, height: superH }, chaos.histogram);

  const targetSpp = genome.quality ?? DEFAULT_SPP;
  const { dispatchWalkers, dispatchIters, actualSamples } = computeDispatch(targetSpp, width, height);

  chaos.setPalette(genome.palette);
  chaos.reset();
  chaos.dispatch(genome, seed, { walkers: dispatchWalkers, itersPerWalker: dispatchIters });

  const { k1, k2 } = deriveCalibration({
    scale: genome.scale, sampleCount: actualSamples,
    brightness: tonemap.brightness, oversample,
  });
  const useDE = genome.density !== undefined;
  if (useDE) {
    density.dispatch(genome.density!, k1, k2, oversample);
  }

  // Read the same buffer the visualize shader would read.
  const histByteLen = superW * superH * 4 * 4; // 4 channels × 4 bytes (f32 / u32)
  const histBuffer = useDE ? density.filtered : chaos.histogram;
  const histRaw = await readBufferToFloat32(device, histBuffer, histByteLen);
  const hist: Float32Array | Uint32Array = useDE
    ? histRaw
    : new Uint32Array(histRaw.buffer, histRaw.byteOffset, histRaw.length);

  const kernel1d = buildGaussianKernel(filterRadius, oversample);
  const fwidth = kernel1d.length;

  // --- 3. Run f64 oracle on the same histogram. ---
  const f64Rgba = visualize_f64({
    hist, histKind: useDE ? 'f32' : 'u32',
    kernel1d,
    outW: width, outH: height,
    superW, superH, oversample,
    fwidth,
    k1, k2,
    gamma: tonemap.gamma, vibrancy: tonemap.vibrancy,
    highpow: tonemap.highlightPower, linrange: tonemap.gammaThreshold,
    background,
  });

  // --- 4. Compute R against flam3-C golden. ---
  const goldenRgba = readPngRgba(goldenPath, width, height);
  const R_f32 = meanAbsDiffRgba(f32Rgba, goldenRgba);
  const R_f64 = meanAbsDiffRgba(f64Rgba, goldenRgba);

  // --- 5. Save the f64-tonemap render for visual inspection. ---
  mkdirSync(OUT_DIR, { recursive: true });
  writePngRgba(join(OUT_DIR, `${fixtureId}-f64-tonemap.png`), f64Rgba, width, height);
  writePngRgba(join(OUT_DIR, `${fixtureId}-f32-tonemap.png`), f32Rgba, width, height);

  // Cleanup GPU resources for this fixture.
  tex.destroy();
  readBuf.destroy();
  chaos.destroy();
  density.destroy();
  renderer.destroy();

  return {
    fixture: fixtureId,
    width, height,
    R_f32, R_f64,
    brightness: tonemap.brightness,
    gamma: tonemap.gamma,
    vibrancy: tonemap.vibrancy,
    highpow: tonemap.highlightPower,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtures = args.length > 0 ? args : DEFAULT_TIER2_FIXTURES;

  console.log(`[pyr3-027-oracle] fixtures=${fixtures.length}  out_dir=${OUT_DIR}`);
  console.log('');

  const rows: Awaited<ReturnType<typeof probeFixture>>[] = [];
  for (const id of fixtures) {
    console.log(`[pyr3-027-oracle] probing ${id}…`);
    const r = await probeFixture(id);
    rows.push(r);
    console.log(
      `  ${id.padEnd(22)} R(f32)=${r.R_f32.toFixed(3)}  R(f64)=${r.R_f64.toFixed(3)}  ` +
      `Δ=${(r.R_f32 - r.R_f64).toFixed(3)}  (bri=${r.brightness}, γ=${r.gamma}, vib=${r.vibrancy}, hp=${r.highpow})`,
    );
  }

  console.log('');
  console.log('fixture                 R(f32)    R(f64)    Δ (f32-f64)   verdict');
  console.log('----------------------  --------  --------  -----------   -----------');
  for (const r of rows) {
    const delta = r.R_f32 - r.R_f64;
    const verdict = delta >= 1.0 ? '✓ f64 wins' : delta <= -1.0 ? '✗ f64 worse' : '— noise';
    console.log(
      `${r.fixture.padEnd(22)}  ${r.R_f32.toFixed(3).padStart(8)}  ${r.R_f64.toFixed(3).padStart(8)}  ${delta.toFixed(3).padStart(11)}   ${verdict}`,
    );
  }

  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('pyr3-027-oracle: failed —', e);
  process.exit(1);
});
