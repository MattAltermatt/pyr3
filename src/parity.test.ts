// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { meanAbsDiffRgba, perChannelDrift, perRegionDrift } from './compare';
import { renderDiffPng } from './diff-image';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'flam3-goldens');

interface FixtureMeta {
  id: string;
  width: number;
  height: number;
  expectedR: number | null;
  thresholdR: number | null;
  tier: 1 | 2 | null;
  notes?: string;
  source: string;
}

interface Fixture {
  id: string;
  dir: string;
  flam3Path: string;
  goldenPath: string;
  meta: FixtureMeta;
}

function discoverFixtures(): Fixture[] {
  const found: Fixture[] = [];
  const entries = readdirSync(FIXTURES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, entry.name);
    const metaPath = join(dir, 'meta.json');
    const goldenPath = join(dir, 'golden.png');
    const flam3Path = join(dir, `${entry.name}.flam3`);
    if (!existsSync(metaPath) || !existsSync(goldenPath) || !existsSync(flam3Path)) continue;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as FixtureMeta;
    found.push({ id: entry.name, dir, flam3Path, goldenPath, meta });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

const fixtures = discoverFixtures();

describe('BE parity — pyr3 render vs flam3-C golden', () => {
  for (const fixture of fixtures) {
    it(
      `[${fixture.id}] renders and reports R + per-channel + per-region drift`,
      { timeout: 180_000 },
      () => {
        const outputPath = join(fixture.dir, 'pyr3-render.png');

        const result = spawnSync(
          'node',
          [
            '--import',
            'tsx/esm',
            '--import',
            './bin/wgsl-loader-register.mjs',
            'bin/pyr3-render.ts',
            fixture.flam3Path,
            outputPath,
          ],
          {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
            encoding: 'utf8',
          },
        );

        if (result.status !== 0) {
          throw new Error(
            `pyr3-render failed for ${fixture.id} (exit=${result.status}, signal=${result.signal}):\n` +
              `stderr:\n${result.stderr ?? ''}\n` +
              `stdout:\n${result.stdout ?? ''}`,
          );
        }

        const goldenBuf = readFileSync(fixture.goldenPath);
        const pyr3Buf = readFileSync(outputPath);
        const goldenPng = PNG.sync.read(goldenBuf);
        const pyr3Png = PNG.sync.read(pyr3Buf);

        if (goldenPng.width !== pyr3Png.width || goldenPng.height !== pyr3Png.height) {
          throw new Error(
            `fixture ${fixture.id} dim mismatch: ` +
              `golden ${goldenPng.width}×${goldenPng.height} vs ` +
              `pyr3 ${pyr3Png.width}×${pyr3Png.height}`,
          );
        }

        const w = goldenPng.width;
        const h = goldenPng.height;
        const goldenRgba = new Uint8Array(
          goldenPng.data.buffer,
          goldenPng.data.byteOffset,
          goldenPng.data.byteLength,
        );
        const pyr3Rgba = new Uint8Array(
          pyr3Png.data.buffer,
          pyr3Png.data.byteOffset,
          pyr3Png.data.byteLength,
        );

        const R = meanAbsDiffRgba(pyr3Rgba, goldenRgba);
        const channel = perChannelDrift(pyr3Rgba, goldenRgba);
        const region = perRegionDrift(pyr3Rgba, goldenRgba, w, h);

        const diffPath = join(fixture.dir, 'diff.png');
        writeFileSync(diffPath, renderDiffPng(pyr3Rgba, goldenRgba, w, h));

        const f = (n: number) => n.toFixed(4);
        const diffRel = `fixtures/flam3-goldens/${fixture.id}/diff.png`;
        // eslint-disable-next-line no-console
        console.log(
          `[${fixture.id}] R=${f(R)}  ` +
            `perChannel(r=${f(channel.r)} g=${f(channel.g)} b=${f(channel.b)})  ` +
            `perRegion(tl=${f(region.qTl)} tr=${f(region.qTr)} bl=${f(region.qBl)} br=${f(region.qBr)})  ` +
            `diff→ ${diffRel}`,
        );

        expect(R).toBeDefined();
        expect(R).toBeGreaterThanOrEqual(0);

        // Active gate. Threshold null = record-only. Tier-2 fixtures (engine-precision-drift,
        // R≥5 on the v0.19 corpus) get a tier-2 surface in the failure message so a regression
        // there reads as "f32-floor moved" vs a tier-1 "real bug".
        if (fixture.meta.thresholdR !== null) {
          const tierLabel = fixture.meta.tier === 2
            ? `Tier-2 (engine-precision-drift floor)`
            : `Tier-1`;
          expect(
            R,
            `${tierLabel} fixture ${fixture.id} R=${f(R)} exceeded thresholdR=${fixture.meta.thresholdR}`,
          ).toBeLessThanOrEqual(fixture.meta.thresholdR);
        }
      },
    );
  }
});
