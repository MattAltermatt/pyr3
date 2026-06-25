// npm run bake:natives — ingest pyr3-native flames into the reserved gen-1000
// corpus surface for the Flame Gallery (#435). Accepts BOTH `.png` files with
// an embedded `pyr3` tEXt-chunk genome AND raw `.pyr3.json` genome files; both
// dedup against each other by canonical genome hash (a PNG and its `.pyr3.json`
// twin collapse to one ledger entry). Idempotent: an append-only content-hash ledger gives
// every flame a STABLE id (so /esf/gen/1000/id/M share URLs never break) and
// dedups identical flames. The source folder is the full collection —
// re-running scans it all and re-emits the gen-1000 data. (Gen is 1000 — above
// every ESF gen — so pyr3 originals lead the newest-first gallery; see PYR3_GEN.)
//
// Emits (all committed):
//   public/chunks/1000/{lo:05d}.flam3chunk  id→pyr3-json (brotli JSON)
//   public/chunks/1000/avail.flam3idx       sorted id list (brotli LEB128)
//   public/chunks/pyr3-gens.json            gen manifest entry (merged client-side)
//   public/chunks/pyr3-features.flam3idx    gen feature records (merged client-side)
//   flames/pyr3-natives/ledger.json         hash→id ledger
//
// Usage: npm run bake:natives -- [--src <dir>]   (default src: ~/pyr3-flames/json —
//   the curated library produced by `npm run flames:ingest`; a bare flat-root scan
//   would now hit incoming/ + renders/ subdirs, so the default points at json/)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { readPngTextChunks } from '../src/png-text-chunk';
import { genomeFromJson, genomeToJson, type Pyr3JsonV1 } from '../src/serialize';
import { encodeAvailRaw } from '../src/avail';
import {
  encodeHeader,
  encodeRecord,
  FEATURE_INDEX_SCHEMA_CURRENT,
  type FeatureRecord,
} from '../src/feature-index';
import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { applyPreset, QUALITY_TIERS, tierToSpec } from '../src/presets';
import { readTextureTight } from '../src/gpu-readback';
import type { Genome } from '../src/genome';
import { PYR3_NATIVE_GEN } from '../src/native-gen';
import { installWebGPUHost, acquireDawnDevice } from './host';
import {
  histogramCoverage,
  meanLuminance,
  densityEntropy,
  colorVariance,
} from './bake-stats';
import { groupIdsByChunk, buildChunkObject } from './native-bake/chunk-emit';
import { canonicalFlameHash } from './native-bake/canonical-hash';
import { emptyLedger, ledgerHas, ledgerAppend, type Ledger } from './native-bake/ledger';
import { buildFeatureRecord, type Stats } from './native-bake/feature-record';

// Reserved gen for pyr3 natives (#435) — shared single source of truth with
// the gallery/viewer display mapping. Chosen above every ESF gen so the
// newest-first gallery leads with pyr3 originals; the feature-index merge
// orders the native block by gen.
const PYR3_GEN = PYR3_NATIVE_GEN;
const REPO = fileURLToPath(new URL('..', import.meta.url));
const LEDGER_PATH = join(REPO, 'flames/pyr3-natives/ledger.json');
const CHUNK_DIR = join(REPO, 'public/chunks', String(PYR3_GEN));
const GENS_SIDECAR = join(REPO, 'public/chunks/pyr3-gens.json');
const FEATURES_SIDECAR = join(REPO, 'public/chunks/pyr3-features.flam3idx');

interface Flame {
  id: number;
  genome: Genome;
  json: string; // canonical pyr3-JSON stored in the chunk
}

/** Mirror of computeStats in bin/pyr3-bake-features.ts — derive the four
 *  filter stats from a rendered RGBA buffer (apples-to-apples with ESF). */
function computeStats(rgba: Uint8Array, pixelCount: number): Stats {
  const LIT_THRESHOLD = 24;
  const litMask = new Float32Array(pixelCount);
  const lumHist = new Float32Array(256);
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const sum = r + g + b;
    litMask[i] = sum > LIT_THRESHOLD ? 1 : 0;
    lumHist[Math.min(255, Math.floor(sum / 3))]! += 1;
  }
  return {
    coverage: histogramCoverage(litMask),
    meanLum: meanLuminance(rgba),
    entropy: densityEntropy(lumHist),
    colorVar: colorVariance(rgba),
  };
}

function loadLedger(): Ledger {
  if (!existsSync(LEDGER_PATH)) return emptyLedger();
  return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
}

function pad5(n: number): string {
  return String(n).padStart(5, '0');
}

async function main(): Promise<void> {
  const srcIdx = process.argv.indexOf('--src');
  const src = srcIdx >= 0 ? process.argv[srcIdx + 1]! : join(homedir(), 'pyr3-flames', 'json');
  console.log(`bake:natives — src=${src}`);

  // 1. Load ledger + scan source PNGs. The folder is the full collection.
  let ledger = loadLedger();
  const flames: Flame[] = [];
  const seenHash = new Set<string>();
  let added = 0;
  let dup = 0;
  let skippedNonPyr3 = 0;

  for (const f of readdirSync(src)) {
    const lower = f.toLowerCase();
    const isPng = lower.endsWith('.png');
    const isJson = lower.endsWith('.json');
    if (!isPng && !isJson) continue;

    // Extract the pyr3-JSON genome from either source: a PNG's `pyr3` tEXt
    // chunk, or a raw `.pyr3.json` file. A bad/non-pyr3 file is skipped, not
    // fatal — the collection can hold stray PNGs or unrelated JSON.
    let parsed: Pyr3JsonV1;
    try {
      if (isPng) {
        const embedded = readPngTextChunks(new Uint8Array(readFileSync(join(src, f))))['pyr3'];
        if (!embedded) {
          skippedNonPyr3++;
          continue;
        }
        parsed = JSON.parse(embedded) as Pyr3JsonV1;
      } else {
        parsed = JSON.parse(readFileSync(join(src, f), 'utf8')) as Pyr3JsonV1;
      }
    } catch {
      skippedNonPyr3++;
      continue;
    }

    // Validate it parses to a real genome before it earns a ledger id.
    let genome: Genome;
    try {
      genome = genomeFromJson(parsed);
    } catch {
      skippedNonPyr3++;
      continue;
    }

    // Dedup by canonical genome hash — a PNG and its `.pyr3.json` twin (same
    // visual definition, differing only by name/size/quality) collapse to one.
    const hash = canonicalFlameHash(parsed);
    if (seenHash.has(hash)) {
      dup++;
      continue; // same flame already collected this run
    }
    seenHash.add(hash);
    if (!ledgerHas(ledger, hash)) {
      ledger = ledgerAppend(ledger, hash);
      added++;
    }
    const id = ledger.entries[hash]!.id;
    genome.nick = 'pyr3'; // provenance badge (#435)
    flames.push({ id, genome, json: JSON.stringify(genomeToJson(genome)) });
  }

  flames.sort((a, b) => a.id - b.id);
  console.log(
    `  scanned: +${added} new, ${dup} dup, ${skippedNonPyr3} non-pyr3 skipped, total ${flames.length}`,
  );
  if (flames.length === 0) {
    console.log('  nothing to emit.');
    return;
  }

  // 2. Draft-render each flame for stats (same path as pyr3-bake-features.ts).
  installWebGPUHost();
  const tier = QUALITY_TIERS[0]!; // Draft (longEdge 512, spp 8)
  const width = tier.longEdge;
  const height = tier.longEdge;
  const format = 'rgba8unorm' as const;
  const device = await acquireDawnDevice('bake:natives');
  const renderer = createRenderer(device, format, {
    width,
    height,
    oversample: 1,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });
  const texture = device.createTexture({
    label: 'bake-natives.output',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const pixelCount = width * height;

  const statsById = new Map<number, Stats>();
  for (const flame of flames) {
    const renderGenome = applyPreset(flame.genome, tierToSpec(tier));
    renderer.render({ genome: renderGenome, outputView: texture.createView() });
    const rgba = await readTextureTight(device, texture, width, height, 4);
    statsById.set(flame.id, computeStats(rgba, pixelCount));
    console.log(`  rendered id ${flame.id}`);
  }

  // 3. Emit chunk windows (id→canonical pyr3-JSON).
  mkdirSync(CHUNK_DIR, { recursive: true });
  for (const [lo, ids] of groupIdsByChunk(flames.map((f) => f.id))) {
    const windowFlames = flames.filter((f) => ids.includes(f.id));
    const obj = buildChunkObject(windowFlames.map((f) => ({ id: f.id, json: f.json })));
    const json = JSON.stringify({ _v: 'pyr3-natives', ...obj });
    writeFileSync(join(CHUNK_DIR, `${pad5(lo)}.flam3chunk`), brotliCompressSync(Buffer.from(json)));
  }

  // 4. Emit avail.
  const ids = flames.map((f) => f.id);
  writeFileSync(join(CHUNK_DIR, 'avail.flam3idx'), brotliCompressSync(Buffer.from(encodeAvailRaw(ids))));

  // 5. Emit gens sidecar.
  writeFileSync(
    GENS_SIDECAR,
    JSON.stringify(
      { gens: [{ gen: PYR3_GEN, count: ids.length, min_id: ids[0]!, max_id: ids.at(-1)! }] },
      null,
      2,
    ),
  );

  // 6. Emit feature sidecar (records sorted by id; gen is constant PYR3_GEN).
  const recs: FeatureRecord[] = flames.map((f) =>
    buildFeatureRecord(PYR3_GEN, f.id, f.genome, statsById.get(f.id)!),
  );
  const header = encodeHeader({
    schemaVersion: FEATURE_INDEX_SCHEMA_CURRENT,
    corpusTag: 'pyr3-natives',
    recordCount: recs.length,
  });
  const body = Buffer.concat([
    Buffer.from(header),
    ...recs.map((r) => Buffer.from(encodeRecord(r))),
  ]);
  writeFileSync(FEATURES_SIDECAR, brotliCompressSync(body));

  // 7. Persist ledger.
  mkdirSync(join(REPO, 'flames/pyr3-natives'), { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));

  console.log(`bake:natives done — ${ids.length} flames in gen ${PYR3_GEN} (ids ${ids[0]}..${ids.at(-1)})`);
}

// Run only when invoked as a CLI, so test imports of sibling helpers stay
// side-effect-free (no GPU acquisition, no fs scan).
const isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
