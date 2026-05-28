// @vitest-environment node
//
// PYR3-026: FE↔BE parity gate at quick-mode dims.
//
// For each fixture in `fixtures/flam3-goldens/`:
//   1. Render BE via `bin/pyr3-render.ts --quick` (matched FE preset)
//   2. Render FE via Playwright + headless Chromium WebGPU + the
//      `window.__pyr3LoadFlame` / `window.__pyr3CapturePixels` dev hooks
//   3. R-compare FE rgba vs BE rgba (no flam3 golden involved here —
//      this gate is "the two pyr3 engines agree on their own output",
//      not "either engine matches flam3-C"; that's `parity.test.ts`)
//
// Toggled by `VITEST_INCLUDE_PARITY_FE_BE=1`. Per-fixture threshold
// lives in `meta.json` as `feBeThresholdR` (null = record-only).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from './compare';
import { renderDiffPng } from './diff-image';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'flam3-goldens');

// Dedicated vite port — avoids colliding with a developer's running
// `npm run dev` on :5173. `--strictPort` makes vite fail loud if taken.
const DEV_PORT = 5180;
const DEV_URL = `http://localhost:${DEV_PORT}/`;

interface FixtureMeta {
  id: string;
  width: number;
  height: number;
  expectedR: number | null;
  thresholdR: number | null;
  tier: 1 | 2 | null;
  notes?: string;
  feBeExpectedR?: number | null;
  feBeThresholdR?: number | null;
  source: string;
}

interface Fixture {
  id: string;
  dir: string;
  flam3Path: string;
  meta: FixtureMeta;
}

function discoverFixtures(): Fixture[] {
  const found: Fixture[] = [];
  for (const entry of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, entry.name);
    const metaPath = join(dir, 'meta.json');
    const flam3Path = join(dir, `${entry.name}.flam3`);
    if (!existsSync(metaPath) || !existsSync(flam3Path)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as FixtureMeta;
    found.push({ id: entry.name, dir, flam3Path, meta });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

async function waitForDevServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server not ready at ${url} after ${timeoutMs}ms`);
}

const fixtures = discoverFixtures();

// Per-fixture R results are appended JSONL to .remember/tmp/pyr3-026-results.jsonl
// (truncated at beforeAll). Consumed by `scripts/pyr3-026-build-html.mjs` to
// build the eyeball gallery and (post-calibration) to compare across runs.
const RESULTS_PATH = join(REPO_ROOT, '.remember', 'tmp', 'pyr3-026-results.jsonl');

let viteProc: ChildProcess | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

describe('FE↔BE parity — pyr3 browser vs CLI at quick-mode dims', () => {
  beforeAll(async () => {
    mkdirSync(dirname(RESULTS_PATH), { recursive: true });
    writeFileSync(RESULTS_PATH, '');

    viteProc = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    viteProc.stderr?.on('data', (b: Buffer) => {
      const s = b.toString();
      if (s.includes('Error') || s.includes('error')) {
        // eslint-disable-next-line no-console
        console.error('[vite·stderr]', s.trim());
      }
    });
    await waitForDevServer(DEV_URL);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,WebGPU',
        '--use-vulkan=swiftshader',
      ],
    });
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', (err) => {
      // eslint-disable-next-line no-console
      console.error('[fe·pageerror]', err.message);
    });
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __pyr3LoadFlame?: unknown }).__pyr3LoadFlame === 'function'
        && typeof (window as unknown as { __pyr3CapturePixels?: unknown }).__pyr3CapturePixels === 'function',
      { timeout: 30_000 },
    );
  }, 90_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (viteProc) {
      viteProc.kill('SIGTERM');
      // Give vite a beat to release the port for the next run
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  for (const fixture of fixtures) {
    it(
      `[${fixture.id}] R(FE, BE) within feBeThresholdR`,
      { timeout: 120_000 },
      async () => {
        if (!page) throw new Error('Playwright page not initialized');

        // 1. BE render via --quick (matches FE QUICK_MAX_DIM / QUICK_MAX_SPP /
        //    QUICK_OVERSAMPLE preset; mirrors src/main.ts rerender math).
        const bePath = join(fixture.dir, 'pyr3-fe-be-be.png');
        const result = spawnSync(
          'node',
          [
            '--import',
            'tsx/esm',
            '--import',
            './bin/wgsl-loader-register.mjs',
            'bin/pyr3-render.ts',
            '--quick',
            fixture.flam3Path,
            bePath,
          ],
          {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 60_000,
            encoding: 'utf8',
          },
        );
        if (result.status !== 0) {
          throw new Error(
            `pyr3-render --quick failed for ${fixture.id} (exit=${result.status}, signal=${result.signal}):\n` +
              `stderr:\n${result.stderr ?? ''}\n` +
              `stdout:\n${result.stdout ?? ''}`,
          );
        }
        const beBuf = readFileSync(bePath);
        const bePng = PNG.sync.read(beBuf);
        const beRgba = new Uint8Array(
          bePng.data.buffer,
          bePng.data.byteOffset,
          bePng.data.byteLength,
        );

        // 2. FE capture via Playwright. The dev hook serializes loads
        //    behind a queue so the initial welcome-flame paint settles
        //    before our fixture lands. Base64-shuttle rgba bytes back —
        //    Playwright's `evaluate` JSON-serializes typed arrays poorly.
        const flam3Text = readFileSync(fixture.flam3Path, 'utf8');
        const capture = await page.evaluate(async (text) => {
          const w = window as unknown as {
            __pyr3LoadFlame: (t: string, label?: string) => Promise<void>;
            __pyr3CapturePixels: () => Promise<{
              width: number;
              height: number;
              rgba: Uint8ClampedArray;
              format: GPUTextureFormat;
            }>;
          };
          await w.__pyr3LoadFlame(text, 'parity-fe-be.flam3');
          const c = await w.__pyr3CapturePixels();
          const u8 = new Uint8Array(c.rgba.buffer, c.rgba.byteOffset, c.rgba.byteLength);
          let bin = '';
          // Chunked btoa to avoid `Maximum call stack size exceeded`
          // on large pixel arrays via spread/apply.
          const CHUNK = 0x8000;
          for (let i = 0; i < u8.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
          }
          return { width: c.width, height: c.height, rgbaB64: btoa(bin) };
        }, flam3Text);
        const feRgba = new Uint8Array(Buffer.from(capture.rgbaB64, 'base64'));

        // 3. Dim alignment (BE follows genome's declared dims under
        //    QUICK_MAX_DIM=1024; FE applies same sizeScale math; they
        //    MUST match — load-bearing invariant of this test).
        if (capture.width !== bePng.width || capture.height !== bePng.height) {
          throw new Error(
            `fixture ${fixture.id} dim mismatch: ` +
              `FE ${capture.width}×${capture.height} vs ` +
              `BE ${bePng.width}×${bePng.height}`,
          );
        }
        if (feRgba.byteLength !== beRgba.byteLength) {
          throw new Error(
            `fixture ${fixture.id} byte-length mismatch: ` +
              `FE ${feRgba.byteLength} vs BE ${beRgba.byteLength}`,
          );
        }

        // 4. R(FE, BE) + per-channel + per-region.
        const w = capture.width;
        const h = capture.height;
        const R = meanAbsDiffRgba(feRgba, beRgba);
        const channel = perChannelDrift(feRgba, beRgba);
        const region = perRegionDrift(feRgba, beRgba, w, h);

        // 5. Persist the FE render + diff for the eyeball gallery.
        const feOutPath = join(fixture.dir, 'pyr3-fe-be-fe.png');
        const fePng = new PNG({ width: w, height: h });
        fePng.data = Buffer.from(feRgba.buffer, feRgba.byteOffset, feRgba.byteLength);
        writeFileSync(feOutPath, PNG.sync.write(fePng));
        const diffPath = join(fixture.dir, 'fe-be-diff.png');
        writeFileSync(diffPath, renderDiffPng(feRgba, beRgba, w, h));

        const f = (n: number) => n.toFixed(4);
        const diffRel = `fixtures/flam3-goldens/${fixture.id}/fe-be-diff.png`;
        // eslint-disable-next-line no-console
        console.log(
          `[${fixture.id}] R(FE,BE)=${f(R)}  ` +
            `perChannel(r=${f(channel.r)} g=${f(channel.g)} b=${f(channel.b)})  ` +
            `perRegion(tl=${f(region.qTl)} tr=${f(region.qTr)} bl=${f(region.qBl)} br=${f(region.qBr)})  ` +
            `diff→ ${diffRel}`,
        );

        appendFileSync(
          RESULTS_PATH,
          JSON.stringify({
            fixture: fixture.id,
            width: w,
            height: h,
            R,
            perChannel: channel,
            perRegion: region,
            feBeThresholdR: fixture.meta.feBeThresholdR ?? null,
          }) + '\n',
        );

        expect(R).toBeDefined();
        expect(R).toBeGreaterThanOrEqual(0);

        // Active gate (post-calibration). Threshold null/undefined = record-only.
        // FE↔BE drift is dominated by quick-mode SPP noise, not f32 precision;
        // tier label is informational rather than semantically gated here.
        const t = fixture.meta.feBeThresholdR;
        if (t !== null && t !== undefined) {
          const tierLabel = fixture.meta.tier === 2 ? `Tier-2` : `Tier-1`;
          expect(
            R,
            `${tierLabel} fixture ${fixture.id} R(FE,BE)=${f(R)} exceeded feBeThresholdR=${t}`,
          ).toBeLessThanOrEqual(t);
        }
      },
    );
  }
});
