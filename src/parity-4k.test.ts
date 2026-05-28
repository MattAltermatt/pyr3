// @vitest-environment node
//
// PYR3-023: BE 4K parity gate vs kotlin v1.1 `SHOWCASE_4K`.
//
// For each .flame in `fixtures/showcase-probe-sources/` that has a
// matching JPG reference in `fixtures/kotlin-4k-refs/`:
//   1. Render BE 4K via `scripts/pyr3-023-be-render-4k.mjs` (3840
//      long-edge, q=200, oversample=1 — matches kotlin's
//      `SHOWCASE_4K` preset Preset.kt:39-49)
//   2. Decode kotlin v1.1 JPG (3840×2160) via `jpeg-js`
//   3. R-compare pyr3 PNG vs kotlin JPG (apples-to-apples post-3840
//      alignment in v0.16; no downscale required)
//   4. Assert R ≤ `kotlin4kThresholdR` (null = record-only)
//
// Toggled by `VITEST_INCLUDE_PARITY_4K=1`. Per-fixture threshold lives
// in a sibling `fixtures/kotlin-4k-refs/<id>.meta.json` (separate from
// the 19-fixture parity rig metas since this set is the 5-fixture
// showcase subset).
//
// NOTE: PYR3-029 chaos-walker-coverage divergence is the dominant R
// contributor for most fixtures. Calibrated thresholds in this rig
// will be loose UNTIL PYR3-029 lands its chaos-game fix; this rig
// gates AGAINST WORSE — it catches engine changes that make divergence
// worse, even if "current" divergence is already substantial.

import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpegJs from 'jpeg-js';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from './compare';
import { renderDiffPng } from './diff-image';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const SOURCES_DIR = join(REPO_ROOT, 'fixtures', 'showcase-probe-sources');
const REFS_DIR = join(REPO_ROOT, 'fixtures', 'kotlin-4k-refs');
const META_PATH = join(REFS_DIR, 'meta.json');
const RESULTS_PATH = join(REPO_ROOT, '.remember', 'tmp', 'pyr3-023-4k-results.jsonl');

interface FixtureMeta {
  baselineR?: number | null;
  thresholdR?: number | null;
}

interface Metadata {
  fixtures: Record<string, FixtureMeta>;
}

interface Fixture {
  id: string;
  flam3Path: string;
  kotlinJpgPath: string;
  meta: FixtureMeta;
}

function readMeta(): Metadata {
  if (!existsSync(META_PATH)) return { fixtures: {} };
  return JSON.parse(readFileSync(META_PATH, 'utf8')) as Metadata;
}

function discoverFixtures(): Fixture[] {
  const meta = readMeta();
  const found: Fixture[] = [];
  for (const entry of readdirSync(SOURCES_DIR)) {
    if (!entry.endsWith('.flam3')) continue;
    const id = entry.replace(/^electricsheep\./, '').replace(/\.flam3$/, '');
    const flam3Path = join(SOURCES_DIR, entry);
    const kotlinJpgPath = join(REFS_DIR, `electricsheep.${id}.gpu.4k.jpg`);
    if (!existsSync(kotlinJpgPath)) continue;
    found.push({
      id,
      flam3Path,
      kotlinJpgPath,
      meta: meta.fixtures?.[id] ?? {},
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function decodeJpegRgba(path: string) {
  const decoded = jpegJs.decode(readFileSync(path), { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
  };
}

function decodePngRgba(path: string) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
  };
}

const fixtures = discoverFixtures();

describe('BE 4K parity — pyr3 BE @ 3840 vs kotlin v1.1 SHOWCASE_4K', () => {
  // Truncate JSONL at start of suite; one line appended per fixture.
  if (existsSync(dirname(RESULTS_PATH))) writeFileSync(RESULTS_PATH, '');

  for (const fixture of fixtures) {
    it(
      `[${fixture.id}] BE 4K render matches kotlin v1.1 within kotlin4kThresholdR`,
      { timeout: 180_000 },
      () => {
        const outPath = join(REFS_DIR, `electricsheep.${fixture.id}.pyr3-be-4k.png`);
        const diffPath = join(REFS_DIR, `electricsheep.${fixture.id}.fe-be-diff.png`);

        const result = spawnSync(
          'node',
          ['scripts/pyr3-023-be-render-4k.mjs', fixture.flam3Path, outPath],
          {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
            encoding: 'utf8',
          },
        );
        if (result.status !== 0) {
          throw new Error(
            `pyr3-023-be-render-4k failed for ${fixture.id} (exit=${result.status}):\n` +
              `stderr:\n${result.stderr ?? ''}\n` +
              `stdout:\n${result.stdout ?? ''}`,
          );
        }

        const pyr3 = decodePngRgba(outPath);
        const kotlin = decodeJpegRgba(fixture.kotlinJpgPath);

        if (pyr3.width !== kotlin.width || pyr3.height !== kotlin.height) {
          throw new Error(
            `fixture ${fixture.id} dim mismatch: pyr3 ${pyr3.width}×${pyr3.height} vs ` +
              `kotlin ${kotlin.width}×${kotlin.height}`,
          );
        }

        const R = meanAbsDiffRgba(pyr3.rgba, kotlin.rgba);
        const channel = perChannelDrift(pyr3.rgba, kotlin.rgba);
        const region = perRegionDrift(pyr3.rgba, kotlin.rgba, pyr3.width, pyr3.height);

        writeFileSync(diffPath, renderDiffPng(pyr3.rgba, kotlin.rgba, pyr3.width, pyr3.height));

        const f = (n: number) => n.toFixed(4);
        // eslint-disable-next-line no-console
        console.log(
          `[${fixture.id}] R(pyr3-BE-4K, kotlin)=${f(R)}  ` +
            `perChannel(r=${f(channel.r)} g=${f(channel.g)} b=${f(channel.b)})  ` +
            `perRegion(tl=${f(region.qTl)} tr=${f(region.qTr)} bl=${f(region.qBl)} br=${f(region.qBr)})`,
        );

        try {
          writeFileSync(
            RESULTS_PATH,
            (existsSync(RESULTS_PATH) ? readFileSync(RESULTS_PATH, 'utf8') : '') +
              JSON.stringify({
                fixture: fixture.id,
                width: pyr3.width,
                height: pyr3.height,
                R,
                perChannel: channel,
                perRegion: region,
                kotlin4kThresholdR: fixture.meta.thresholdR ?? null,
              }) + '\n',
          );
        } catch {
          // .remember/tmp may be missing in fresh checkouts — ignore.
        }

        expect(R).toBeDefined();
        expect(R).toBeGreaterThanOrEqual(0);
        const t = fixture.meta.thresholdR;
        if (t !== null && t !== undefined) {
          expect(R, `${fixture.id} R=${f(R)} exceeded kotlin4kThresholdR=${t}`)
            .toBeLessThanOrEqual(t);
        }
      },
    );
  }

  afterAll(() => {
    // Surface a summary line in the test log.
    if (existsSync(RESULTS_PATH)) {
      const lines = readFileSync(RESULTS_PATH, 'utf8').split('\n').filter(Boolean);
      const rows = lines.map((l) => JSON.parse(l));
      const rs = rows.map((r) => r.R as number);
      const min = Math.min(...rs);
      const max = Math.max(...rs);
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      // eslint-disable-next-line no-console
      console.log(
        `[parity-4k] ${rows.length} fixtures: R min=${min.toFixed(2)} mean=${mean.toFixed(2)} max=${max.toFixed(2)}`,
      );
    }
  });
});
