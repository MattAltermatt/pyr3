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
// ── Routine vs pre-release: read this before invoking ──────────────────
//
// As of v1.2 (#58), this full 26-fixture sweep is PRE-RELEASE ONLY.
// Routine "I touched the render path" guidance is:
//   - `npm run test:parity`         — BE↔flam3-C, ~91s (always)
//   - `npm run test:fe-be-smoke`    — 3-fixture FE↔BE smoke, ~90s (#59)
//   - `npm test`                    — seam-invariant unit tests (#60) catch
//                                     the kind of regressions this rig used
//                                     to be the only thing protecting against
// Run THIS full sweep when prepping a release tag (or whenever you have
// 13 minutes to burn and want maximum certainty).
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
import { nearestDownscale, renderDiffPng } from '../scripts/parity-diff-image';

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

// #35: deterministic FE↔BE seed derived from the fixture id (FNV-1a 32-bit).
// Stable across runs + across machines so R(FE,BE) reflects pure engine drift,
// not Math.random() seed variance. Both engines render the same RNG sequence.
function fixtureSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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

// Smoke filter (#59): when VITEST_INCLUDE_PARITY_FE_BE_SMOKE=1 is set,
// restrict the sweep to a 3-fixture representative set — hero, the
// historical tier-2 outlier, and a healthy tier-1. Cuts wall time from
// ~13min to ~90s for the routine "I touched the FE viewer" gate. Full
// sweep (VITEST_INCLUDE_PARITY_FE_BE=1) is unchanged + remains the
// pre-release sanity check.
const SMOKE_IDS = new Set([
  '247.19679',  // hero — user-visible regression surface
  '248.23554',  // long-standing tier-2 outlier (post-jitter R≈11)
  '244.42746',  // representative healthy tier-1 baseline
]);
const isSmoke = process.env.VITEST_INCLUDE_PARITY_FE_BE_SMOKE === '1';
const allFixtures = discoverFixtures();
const fixtures = isSmoke
  ? allFixtures.filter((f) => SMOKE_IDS.has(f.id))
  : allFixtures;

// Per-fixture R results are appended JSONL to .remember/tmp/pyr3-026-results.jsonl
// (truncated at beforeAll) for ad-hoc inspection / cross-run comparison.
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

    // #28: top-N divergence summary. Sorted by max(R, R_FE_g, R_BE_g) desc
    // so the most-anomalous fixtures surface first. Record-only — no gate.
    // process.stderr.write bypasses vitest's stdout capture (which swallows
    // test-internal console.log by default); also writes to a stable file
    // so the summary is queryable after the run.
    if (!existsSync(RESULTS_PATH)) return;
    const rows = readFileSync(RESULTS_PATH, 'utf8')
      .split('\n')
      .filter((s) => s.length > 0)
      .map((s) => JSON.parse(s) as {
        fixture: string;
        R: number;
        R_FE_golden?: number;
        R_BE_golden?: number;
      });
    if (rows.length === 0) return;
    rows.sort((a, b) => {
      const ma = Math.max(a.R, a.R_FE_golden ?? 0, a.R_BE_golden ?? 0);
      const mb = Math.max(b.R, b.R_FE_golden ?? 0, b.R_BE_golden ?? 0);
      return mb - ma;
    });
    const f = (n: number | undefined): string => (n === undefined ? '    -' : n.toFixed(2).padStart(5));
    const topN = Math.min(10, rows.length);
    const lines: string[] = [];
    lines.push(`\n#28 — top ${topN} divergent fixtures (sorted by max R across 3 pairings):`);
    lines.push(`  fixture                       R(FE,BE) R(FE,g) R(BE,g)`);
    for (const r of rows.slice(0, topN)) {
      lines.push(`  ${r.fixture.padEnd(28)}  ${f(r.R)}   ${f(r.R_FE_golden)}   ${f(r.R_BE_golden)}`);
    }
    const summary = lines.join('\n') + '\n';
    process.stderr.write(summary);
    writeFileSync(join(REPO_ROOT, '.remember', 'tmp', 'pyr3-3way-summary.txt'), summary);
  });

  for (const fixture of fixtures) {
    it(
      `[${fixture.id}] R(FE, BE) within feBeThresholdR`,
      { timeout: 120_000 },
      async () => {
        if (!page) throw new Error('Playwright page not initialized');

        // 1. BE render via --quick (matches FE QUICK_MAX_DIM / QUICK_MAX_SPP /
        //    QUICK_OVERSAMPLE preset; mirrors src/main.ts rerender math). #35:
        //    --seed pins BOTH engines to the same RNG sequence so R measures
        //    only systematic engine drift, not Math.random() noise.
        const seed = fixtureSeed(fixture.id);
        const bePath = join(fixture.dir, 'pyr3-fe-be-be.png');
        const result = spawnSync(
          'node',
          [
            '--import',
            'tsx/esm',
            '--import',
            './bin/wgsl-loader-register.mjs',
            'bin/pyr3-render.ts',
            '--preset', 'quick',
            '--seed', String(seed),
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
        const capture = await page.evaluate(async ({ text, seed: feSeed }) => {
          const w = window as unknown as {
            __pyr3SetSeed: (n: number) => void;
            __pyr3LoadFlame: (t: string, label?: string) => Promise<void>;
            __pyr3CapturePixels: () => Promise<{
              width: number;
              height: number;
              rgba: Uint8ClampedArray;
              format: GPUTextureFormat;
            }>;
          };
          // #35: pin the FE seed BEFORE __pyr3LoadFlame so the upcoming render
          // uses it; BE was spawned with --seed of the same value.
          w.__pyr3SetSeed(feSeed);
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
        }, { text: flam3Text, seed });
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

        // #28: 3-way R values — FE-vs-golden and BE-vs-golden alongside the
        // existing R(FE,BE). Surfaces engine-drift geometry: which engine is
        // closer to flam3-C, where the two pyr3 engines disagree regardless
        // of golden alignment. Record-only — no gate, no diff PNG, no HTML.
        // (User pivoted away from a verify HTML — ad-hoc investigation pages
        // get built on-demand for specific divergences.)
        const goldenPng = PNG.sync.read(readFileSync(join(fixture.dir, 'golden.png')));
        const goldenNative = new Uint8Array(
          goldenPng.data.buffer,
          goldenPng.data.byteOffset,
          goldenPng.data.byteLength,
        );
        const goldenQuick = goldenPng.width === w && goldenPng.height === h
          ? goldenNative
          : nearestDownscale(goldenNative, goldenPng.width, goldenPng.height, w, h);
        const R_FE_g = meanAbsDiffRgba(feRgba, goldenQuick);
        const R_BE_g = meanAbsDiffRgba(beRgba, goldenQuick);

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
          `[${fixture.id}] R(FE,BE)=${f(R)}  R(FE,g)=${f(R_FE_g)}  R(BE,g)=${f(R_BE_g)}  ` +
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
            R_FE_golden: R_FE_g,
            R_BE_golden: R_BE_g,
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
