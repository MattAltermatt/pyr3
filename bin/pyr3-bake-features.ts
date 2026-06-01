#!/usr/bin/env -S node --experimental-strip-types
// pyr3-bake-features — Draft-render every sheep in an ESF corpus + emit the
// binary feature index pyr3's gallery discovery consumes (#48, v1.2).
//
// Usage:
//   npm run bake-features -- --esf-root <path> --tag <corpus-release-tag> \
//                             --out <features.flam3idx> [--resume] [--limit N]
//
// What it does, per sheep:
//   1. Read corpus/<gen>/<bucket>/electricsheep.<gen>.<id>.flam3
//   2. Parse XML → genome
//   3. Extract XML features (variation bitset, xform count) → bin/bake-extract-xml
//   4. Apply Draft tier (longEdge 512, spp 8) + render to an offscreen RGBA texture
//   5. Read back the RGBA pixels
//   6. Derive a luminance histogram + lit-pixel mask from RGBA → run bin/bake-stats
//   7. Append the 30-byte record to a `.part` sidecar
//
// Resumability: the `.part` is a flat append-only stream of 30-byte records.
// `--resume` reads the LAST record's (gen, id) and skips ahead in the corpus
// walk. A power loss drops only the in-flight record (truncated tail is
// detected by length-not-multiple-of-30 and silently dropped on next resume).
//
// Finalization: when the corpus walk completes, the bake reads the `.part`,
// prepends the file header, brotli-compresses, and writes the `--out` path.
// `.part` stays on disk until the final write succeeds — never delete data
// before the success ack.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

import { parseFlame } from '../src/flame-import';
import { createRenderer, DEFAULT_FILTER_RADIUS } from '../src/renderer';
import { applyPreset, QUALITY_TIERS, tierToSpec } from '../src/presets';
import {
  bitsetUnpack,
  encodeHeader,
  encodeRecord,
  FEATURE_INDEX_RECORD_BYTES,
  FEATURE_INDEX_SCHEMA_V1,
  type FeatureRecord,
  type SheepRef,
} from '../src/feature-index';
import { extractXmlFeatures } from './bake-extract-xml';
import {
  colorVariance,
  densityEntropy,
  histogramCoverage,
  meanLuminance,
} from './bake-stats';

// ── Browser-API shims so engine modules import cleanly under Node ───────

const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

// ── Arg parsing ─────────────────────────────────────────────────────────

interface Args {
  esfRoot: string;
  tag: string;
  outPath: string;
  resume: boolean;
  limit: number | null;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let esfRoot: string | null = null;
  let tag: string | null = null;
  let outPath: string | null = null;
  let resume = false;
  let limit: number | null = null;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a === '--esf-root') esfRoot = raw[++i] ?? null;
    else if (a === '--tag') tag = raw[++i] ?? null;
    else if (a === '--out') outPath = raw[++i] ?? null;
    else if (a === '--resume') resume = true;
    else if (a === '--limit') {
      const n = Number(raw[++i]);
      if (!Number.isFinite(n) || n < 1) {
        console.error('--limit requires a positive integer');
        process.exit(1);
      }
      limit = Math.floor(n);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (esfRoot === null || tag === null || outPath === null) {
    console.error('usage: --esf-root <path> --tag <release-tag> --out <path> [--resume] [--limit N]');
    process.exit(1);
  }
  return { esfRoot, tag, outPath, resume, limit };
}

// ── Corpus walker ───────────────────────────────────────────────────────

interface SheepEntry extends SheepRef {
  path: string;
}

function parseGenDirName(name: string): number | null {
  // Skip private/meta directories like _index, _live-fetch-logs, etc.
  if (!/^\d+$/.test(name)) return null;
  return Number(name);
}

function parseSheepFilename(name: string): { gen: number; id: number } | null {
  // electricsheep.<gen>.<id>.flam3 — extract numeric id
  const m = name.match(/^electricsheep\.(\d+)\.(\d+)\.flam3$/);
  if (m === null) return null;
  return { gen: Number(m[1]), id: Number(m[2]) };
}

/** Load the genome-id allowlist from ESF's `corpus/_index/index.json`.
 *  Filters:
 *   - `kind === "genome"` — pyr3's deployed corpus is genome-only;
 *     parseFlame only handles single-`<flame>` files cleanly (animation
 *     files have multiple keyframes and silently lose all but the first).
 *   - `xform_count > 0` — ESF marks 109 zero-xform flames as `kind="genome"`,
 *     but parseFlame throws on them ("no <xform> children; cannot render").
 *     Excluding here means the bake never attempts them + the batched
 *     wrapper script's MAX_NOPROGRESS check doesn't trip on the
 *     consecutive zero-xform run in gen 198.
 *  Returns a Set of "gen/id" strings for O(1) membership tests. */
function loadGenomeAllowlist(esfRoot: string): Set<string> {
  const indexPath = join(esfRoot, 'corpus', '_index', 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`pyr3-bake: ESF index missing: ${indexPath}`);
    process.exit(1);
  }
  const raw = readFileSync(indexPath, 'utf8');
  // The index is ~85MB — parse once at startup. Interface shape mirrors
  // ESF's v7 schema (the fields we read; v7 added thumb_hash + others).
  const data = JSON.parse(raw) as {
    genomes: Array<{
      id: string;
      gen: number;
      sheep_id: number;
      kind: string;
      xform_count: number;
    }>;
  };
  const allow = new Set<string>();
  for (const r of data.genomes) {
    if (r.kind === 'genome' && r.xform_count > 0) {
      allow.add(`${r.gen}/${r.sheep_id}`);
    }
  }
  return allow;
}

/** Enumerate every genome-kind .flame in canonical corpus order (gen
 *  ascending, id ascending). Animation kinds are skipped — they have
 *  multiple `<flame>` keyframes per file and aren't in the deployed
 *  pyr3 corpus anyway. */
function walkCorpus(esfRoot: string): SheepEntry[] {
  const corpusRoot = join(esfRoot, 'corpus');
  if (!existsSync(corpusRoot) || !statSync(corpusRoot).isDirectory()) {
    console.error(`pyr3-bake: corpus directory missing: ${corpusRoot}`);
    process.exit(1);
  }
  const t0 = Date.now();
  const allow = loadGenomeAllowlist(esfRoot);
  console.log(`  genome allowlist loaded (${allow.size} entries, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const out: SheepEntry[] = [];
  const gens = readdirSync(corpusRoot)
    .map((name) => ({ name, gen: parseGenDirName(name) }))
    .filter((e): e is { name: string; gen: number } => e.gen !== null)
    .sort((a, b) => a.gen - b.gen);
  for (const { name: genName, gen } of gens) {
    const genDir = join(corpusRoot, genName);
    const buckets = readdirSync(genDir)
      .filter((b) => /^\d+$/.test(b))
      .sort((a, b) => Number(a) - Number(b));
    for (const bucket of buckets) {
      const bucketDir = join(genDir, bucket);
      const sheepFiles = readdirSync(bucketDir)
        .map((name) => ({ name, parsed: parseSheepFilename(name) }))
        .filter((e): e is { name: string; parsed: { gen: number; id: number } } => e.parsed !== null)
        .sort((a, b) => a.parsed.id - b.parsed.id);
      for (const { name, parsed } of sheepFiles) {
        if (parsed.gen !== gen) {
          console.warn(`pyr3-bake: filename/dir gen mismatch — ${join(bucketDir, name)}`);
          continue;
        }
        if (!allow.has(`${gen}/${parsed.id}`)) continue;
        out.push({ gen, id: parsed.id, path: join(bucketDir, name) });
      }
    }
  }
  return out;
}

// ── Resume detection ────────────────────────────────────────────────────

function partFilePath(outPath: string): string {
  return `${outPath}.part`;
}

/** Format a seconds count as "Xs" / "X.Xmin" / "Xh Ym" depending on
 *  magnitude — so a 4h ETA reads cleanly as "3h 47m" instead of "227.3min". */
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '?';
  if (sec < 60) return `${sec.toFixed(0)}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}min`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec - h * 3600) / 60);
  return `${h}h ${m}m`;
}

/** Returns the last (gen, id) successfully written to the `.part` file, or
 *  null when the file is missing / empty / corrupt. Truncated trailing
 *  bytes (count not a multiple of 30) are silently discarded — the caller
 *  truncates the file to the recoverable length before resuming so the
 *  next append lands at a clean record boundary. */
function readResumePoint(partPath: string): {
  last: SheepRef | null;
  cleanByteLength: number;
} {
  if (!existsSync(partPath)) return { last: null, cleanByteLength: 0 };
  const buf = readFileSync(partPath);
  const recCount = Math.floor(buf.length / FEATURE_INDEX_RECORD_BYTES);
  if (recCount === 0) return { last: null, cleanByteLength: 0 };
  const lastOffset = (recCount - 1) * FEATURE_INDEX_RECORD_BYTES;
  // Records have (gen u16 LE, id u32 LE) at offsets 0 and 2 of the record.
  const dv = new DataView(buf.buffer, buf.byteOffset + lastOffset);
  const gen = dv.getUint16(0, true);
  const id = dv.getUint32(2, true);
  return { last: { gen, id }, cleanByteLength: recCount * FEATURE_INDEX_RECORD_BYTES };
}

// ── Stat compute over RGBA readback ─────────────────────────────────────

/** Derive the four stats from the rendered RGBA buffer.
 *  - coverage = fraction of pixels with combined R+G+B above LIT_THRESHOLD
 *    (filters out near-black backgrounds the way a viewer would perceive
 *    "the canvas is filled")
 *  - meanLum / colorVar = direct from RGBA channels
 *  - entropy = Shannon entropy of the 256-bin luminance histogram across
 *    all pixels — measures how spread the brightness distribution is
 */
function computeStats(rgba: Uint8Array, pixelCount: number): {
  coverage: number;
  meanLum: number;
  entropy: number;
  colorVar: number;
} {
  const LIT_THRESHOLD = 24; // R+G+B > 24 ⇒ at least one channel above ~8
  const litMask = new Float32Array(pixelCount);
  const lumHist = new Float32Array(256);
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const sum = r + g + b;
    litMask[i] = sum > LIT_THRESHOLD ? 1 : 0;
    const lum = Math.min(255, Math.floor(sum / 3));
    lumHist[lum]! += 1;
  }
  return {
    coverage: histogramCoverage(litMask),
    meanLum: meanLuminance(rgba),
    entropy: densityEntropy(lumHist),
    colorVar: colorVariance(rgba),
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`pyr3-bake-features: tag=${args.tag} esf=${args.esfRoot}`);

  const entries = walkCorpus(args.esfRoot);
  console.log(`  ${entries.length} sheep enumerated`);

  // Resume detection — must run before opening the part file for append.
  const partPath = partFilePath(args.outPath);
  let toProcess = entries;
  if (args.resume) {
    const { last, cleanByteLength } = readResumePoint(partPath);
    if (last !== null) {
      // Truncate any partial trailing bytes so the next append is clean.
      const existing = readFileSync(partPath).subarray(0, cleanByteLength);
      writeFileSync(partPath, existing);
      const idx = entries.findIndex((e) => e.gen === last.gen && e.id === last.id);
      if (idx >= 0) toProcess = entries.slice(idx + 1);
      console.log(`  resuming after (${last.gen}, ${last.id}) — ${toProcess.length} remaining`);
    }
  } else if (existsSync(partPath)) {
    console.log(`  --resume not set; truncating existing ${partPath}`);
    writeFileSync(partPath, new Uint8Array(0));
  } else {
    mkdirSync(dirname(args.outPath), { recursive: true });
  }

  if (args.limit !== null) {
    toProcess = toProcess.slice(0, args.limit);
    console.log(`  --limit ${args.limit} → processing ${toProcess.length} sheep`);
  }

  if (toProcess.length === 0) {
    console.log('  nothing to process — going straight to finalize');
    await finalize(args, partPath);
    return;
  }

  // ── WebGPU setup (Draft tier, 512×512) ─────────────────────────────
  const tier = QUALITY_TIERS[0]!; // Draft (longEdge 512, spp 8)
  const width = tier.longEdge;
  const height = tier.longEdge;
  const format = 'rgba8unorm' as const;

  const navigator = { gpu: create([]) };
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) {
    console.error('pyr3-bake: no GPU adapter from Dawn');
    process.exit(1);
  }
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  void device.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    console.error(`pyr3-bake: WebGPU device lost (${info.reason ?? 'unknown'}): ${info.message}`);
    process.exitCode = 1;
  });

  const renderer = createRenderer(device, format, {
    width,
    height,
    oversample: 1,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });

  const texture = device.createTexture({
    label: 'pyr3-bake.output',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readBufSize = bytesPerRow * height;

  const pixelCount = width * height;
  const t0 = Date.now();
  let processed = 0;
  let failed = 0;
  // Aim for ~100 progress lines across the whole run regardless of size — so
  // a smoke of 100 sheep gets a line per sheep, the full 52k corpus gets a
  // line every ~500 sheep (~one line per couple of GPU-minutes).
  const logEvery = Math.max(1, Math.floor(toProcess.length / 100));
  console.log(`  starting render loop — logging every ${logEvery} sheep`);

  for (const entry of toProcess) {
    try {
      const xml = readFileSync(entry.path, 'utf8');
      const parsed = parseFlame(xml);
      const xmlFeatures = extractXmlFeatures(parsed.genome);

      const renderGenome = applyPreset(parsed.genome, tierToSpec(tier));
      renderer.render({ genome: renderGenome, outputView: texture.createView() });

      // Fresh readback buffer per sheep — dawn-node maps don't repeat well.
      const readBuf = device.createBuffer({
        size: readBufSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readBuf, bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      readBuf.destroy();

      // Strip row padding into a tight RGBA buffer.
      const rgba = new Uint8Array(pixelCount * 4);
      for (let y = 0; y < height; y++) {
        const srcOff = y * bytesPerRow;
        const dstOff = y * unpaddedBytesPerRow;
        rgba.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
      }

      const stats = computeStats(rgba, pixelCount);
      const rec: FeatureRecord = {
        gen: entry.gen,
        id: entry.id,
        variations: bitsetUnpack(xmlFeatures.variationBitset),
        xforms: xmlFeatures.xformCount,
        coverage: stats.coverage,
        meanLum: stats.meanLum,
        entropy: stats.entropy,
        colorVar: stats.colorVar,
      };
      appendFileSync(partPath, encodeRecord(rec));

      processed++;
      if (processed % logEvery === 0 || processed === toProcess.length) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = processed / elapsed;
        const remaining = toProcess.length - processed;
        const eta = remaining / rate;
        const pct = (processed / toProcess.length * 100).toFixed(1);
        console.log(
          `  ${processed}/${toProcess.length} (${pct}%) — ${rate.toFixed(2)} sheep/s, ETA ${formatDuration(eta)}`,
        );
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`pyr3-bake: ${entry.gen}/${entry.id} FAILED — ${msg}`);
    }
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(
    `  walk complete: ${processed} ok, ${failed} failed in ${formatDuration(elapsed)}`,
  );

  await finalize(args, partPath);
}

/** Read the .part stream, prepend the header, brotli-compress, write the
 *  final file. Leaves the .part on disk on success — operator deletes it
 *  when satisfied (gives a free backup against a botched compression). */
async function finalize(args: Args, partPath: string): Promise<void> {
  if (!existsSync(partPath)) {
    console.error(`pyr3-bake: no .part file at ${partPath}; nothing to finalize`);
    process.exit(1);
  }
  const partBytes = readFileSync(partPath);
  const recCount = Math.floor(partBytes.length / FEATURE_INDEX_RECORD_BYTES);
  if (recCount === 0) {
    console.error('pyr3-bake: .part empty; nothing to finalize');
    process.exit(1);
  }
  // The walk emits records in canonical order already, but sort defensively.
  // Records are 30 bytes each; sort by (gen u16 LE at +0, id u32 LE at +2).
  const sorted = sortRecordsCanonical(partBytes, recCount);

  const header = encodeHeader({
    schemaVersion: FEATURE_INDEX_SCHEMA_V1,
    corpusTag: args.tag,
    recordCount: recCount,
  });

  const uncompressed = new Uint8Array(header.length + sorted.length);
  uncompressed.set(header, 0);
  uncompressed.set(sorted, header.length);

  // Brotli with quality 11 (max) for the smallest file — bake is a once-a-
  // year job, the extra compression time (seconds) is irrelevant; the
  // ~500KB → potentially ~400KB savings ships forever.
  const compressed = brotliCompressSync(uncompressed, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
    },
  });

  writeFileSync(args.outPath, compressed);
  console.log(
    `  finalized: ${recCount} records, ${(uncompressed.length / 1024).toFixed(1)}KB raw → ${(compressed.length / 1024).toFixed(1)}KB brotli → ${args.outPath}`,
  );
  console.log(`  .part sidecar kept at ${partPath} — delete after sanity-checking ${args.outPath}`);
}

/** Sort `partBytes` (a flat stream of 30-byte records) into canonical order
 *  (gen ascending, id ascending). Allocates a fresh Uint8Array. */
function sortRecordsCanonical(partBytes: Uint8Array, recCount: number): Uint8Array {
  const order: number[] = new Array(recCount);
  for (let i = 0; i < recCount; i++) order[i] = i;
  const dv = new DataView(partBytes.buffer, partBytes.byteOffset);
  order.sort((a, b) => {
    const aOff = a * FEATURE_INDEX_RECORD_BYTES;
    const bOff = b * FEATURE_INDEX_RECORD_BYTES;
    const genA = dv.getUint16(aOff, true);
    const genB = dv.getUint16(bOff, true);
    if (genA !== genB) return genA - genB;
    const idA = dv.getUint32(aOff + 2, true);
    const idB = dv.getUint32(bOff + 2, true);
    return idA - idB;
  });
  const out = new Uint8Array(recCount * FEATURE_INDEX_RECORD_BYTES);
  for (let i = 0; i < recCount; i++) {
    const srcOff = order[i]! * FEATURE_INDEX_RECORD_BYTES;
    const dstOff = i * FEATURE_INDEX_RECORD_BYTES;
    out.set(
      partBytes.subarray(srcOff, srcOff + FEATURE_INDEX_RECORD_BYTES),
      dstOff,
    );
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
