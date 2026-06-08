# Feature index foundation — Implementation Plan (#48)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `features.flam3idx` — a binary per-genome feature spine — produced by a pyr3-side bake CLI, consumed by a pyr3-side client. Output ships to runtime via ESF's chunks Release (ESF-side packaging tracked in `electric-sheep-fold/docs/pyr3-feature-index-integration.md`, NOT in scope for this plan).

**Architecture:** Two new modules + one CLI. `src/feature-index.ts` owns the binary format (encode + decode helpers, shared types). `src/feature-index-client.ts` is the runtime fetch+cache+query layer (mirrors `src/avail-client.ts`). `bin/pyr3-bake-features.ts` walks an ESF corpus checkout, renders Draft, computes stats, emits the binary file. Runtime stays GPU-only at consumption time (no GPU in tests).

**Tech Stack:** TypeScript, WebGPU (via `webgpu` npm in the bake CLI host), Vitest, brotli (existing `src/brotli.ts`).

**Spec:** `docs/superpowers/specs/2026-05-31-feature-index-foundation-design.md` (locked)
**Branch:** `feature/issue-48-feature-index` (already created)
**Issue:** #48 (v1.2 milestone)
**ESF integration:** `electric-sheep-fold/docs/pyr3-feature-index-integration.md` (parked — work on ESF NOT in this session)

---

## File structure

```text
file                                role
---------------------------------   -----------------------------------------------
src/feature-index.ts                NEW — binary format owner: types, magic + version
                                    constants, encode (header + records), decode
                                    (header parse, record view accessors). Pure
                                    logic, no I/O, no fetch.

src/feature-index.test.ts           NEW — round-trip tests (encode→decode), header
                                    parse, magic-rejection, schema-mismatch detection,
                                    bitset pack/unpack, quantize round-trip

src/feature-index-client.ts        NEW — runtime fetch + brotli decode + caching
                                    + the FeatureIndex query API (has, get, filter).
                                    Mirrors src/avail-client.ts shape + caching.

src/feature-index-client.test.ts   NEW — fetch failure → sentinel fallback, magic
                                    rejection, schema-mismatch fallback, lookup +
                                    filter against a synthetic 8-sheep brotli'd file

src/feature-score.ts                NEW — 🎚️ tunable weight vector + score(stats)
                                    function. Imports from feature-index for the
                                    SheepFeatures type. Lives in pyr3 so #49 + the
                                    sort modes share one formula.

src/feature-score.test.ts           NEW — weight applies correctly, bounds (0..1),
                                    monotonicity in coverage / entropy / color_var

bin/pyr3-bake-features.ts          NEW — CLI entry point. Walks ESF corpus,
                                    renders Draft per sheep, builds records,
                                    writes `.part` sidecar + final file.

bin/bake-extract-xml.ts             NEW — pure XML extraction helpers (variation
                                    bitset + xform count). Lives in bin/ because
                                    it's bake-tool surface; reuses parseFlame
                                    from src/flame-import.ts.

bin/bake-extract-xml.test.ts        NEW — extraction unit tests against fixture
                                    flames

bin/bake-stats.ts                   NEW — pure compute helpers (coverage, mean
                                    luminance, density entropy, color variance,
                                    quantization). Takes raw histogram +
                                    canvas-readback buffers, returns 4 q8 bytes.

bin/bake-stats.test.ts              NEW — quantization round-trip + each stat's
                                    formula tested against hand-crafted inputs

package.json                        +`bake-features` npm script wiring the CLI
```

7 new src/bin modules + 4 new test files + 1 package.json line.

---

## Phase 1 — Binary format (the contract)

### Task 1: Format types + encode/decode primitives (INLINE)

**Why this is first and must run inline:** the binary layout is the contract every later task depends on. Bake writes it; client reads it; format tests pin it. Lock in the lead session so types/constants don't drift across subagents.

**Files:**
- Create: `src/feature-index.ts`
- Create: `src/feature-index.test.ts`

- [ ] **Step 1: Constants + types**

```typescript
// src/feature-index.ts
export const FEATURE_INDEX_MAGIC = 'pyf3'; // 4 ASCII bytes at offset 0
export const FEATURE_INDEX_SCHEMA_V1 = 1;
export const FEATURE_INDEX_HEADER_BYTES = 41; // 4 magic + 1 version + 32 tag + 4 count
export const FEATURE_INDEX_RECORD_BYTES = 30; // 2 gen + 4 id + 16 vars + 1 xforms + 4 stats + 1 reserved
export const VARIATION_BITSET_BYTES = 16; // 128 bits; pyr3 currently uses indices 0-98

export interface SheepFeatures {
  variations: number[];      // unpacked: bitset → variation indices
  xforms: number;
  coverage: number;          // 0..1 dequantized
  meanLum: number;
  entropy: number;
  colorVar: number;
}

export interface SheepRef { gen: number; id: number; }

export interface FeatureRecord extends SheepRef, SheepFeatures {}

export interface FeatureIndexHeader {
  schemaVersion: number;
  corpusTag: string;         // trimmed of trailing NULs
  recordCount: number;
}
```

- [ ] **Step 2: Bitset helpers**

```typescript
/** Set bit `index` in a 16-byte little-endian bitset. Mutates `bytes`. */
export function bitsetSet(bytes: Uint8Array, index: number): void {
  if (index < 0 || index >= VARIATION_BITSET_BYTES * 8) {
    throw new Error(`feature-index: variation index ${index} out of bitset range`);
  }
  bytes[index >>> 3]! |= 1 << (index & 7);
}

/** Unpack the bitset to a sorted ascending list of set bit indices. */
export function bitsetUnpack(bytes: Uint8Array, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < VARIATION_BITSET_BYTES; i++) {
    let b = bytes[offset + i]!;
    let base = i * 8;
    while (b !== 0) {
      const bit = b & -b;
      out.push(base + Math.log2(bit));
      b ^= bit;
    }
  }
  return out;
}
```

- [ ] **Step 3: Quantization helpers**

```typescript
/** 0..1 → 0..255. Clamps; finite-only. */
export function quantizeQ8(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const clamped = Math.max(0, Math.min(1, v));
  return Math.round(clamped * 255) & 0xff;
}

export function dequantizeQ8(b: number): number {
  return b / 255;
}
```

- [ ] **Step 4: Header encode + decode**

```typescript
export function encodeHeader(header: FeatureIndexHeader): Uint8Array {
  const out = new Uint8Array(FEATURE_INDEX_HEADER_BYTES);
  // magic
  out[0] = 0x70; out[1] = 0x79; out[2] = 0x66; out[3] = 0x33; // "pyf3"
  out[4] = header.schemaVersion & 0xff;
  // corpus tag — 32 bytes UTF-8, NUL-padded
  const tagBytes = new TextEncoder().encode(header.corpusTag.slice(0, 32));
  out.set(tagBytes, 5);
  // record count u32 LE
  const dv = new DataView(out.buffer);
  dv.setUint32(37, header.recordCount, true);
  return out;
}

export function decodeHeader(bytes: Uint8Array): FeatureIndexHeader {
  if (bytes.length < FEATURE_INDEX_HEADER_BYTES) {
    throw new Error('feature-index: truncated header');
  }
  if (bytes[0] !== 0x70 || bytes[1] !== 0x79 || bytes[2] !== 0x66 || bytes[3] !== 0x33) {
    throw new Error('feature-index: magic mismatch (expected "pyf3")');
  }
  const schemaVersion = bytes[4]!;
  const tagEnd = bytes.indexOf(0x00, 5);
  const corpusTag = new TextDecoder().decode(bytes.subarray(5, tagEnd >= 0 && tagEnd <= 37 ? tagEnd : 37));
  const recordCount = new DataView(bytes.buffer, bytes.byteOffset).getUint32(37, true);
  return { schemaVersion, corpusTag, recordCount };
}
```

- [ ] **Step 5: Record encode + decode**

```typescript
/** Encode one record into a 30-byte buffer (header NOT included). Caller
 *  appends to the output stream after the file header. */
export function encodeRecord(rec: FeatureRecord): Uint8Array {
  const out = new Uint8Array(FEATURE_INDEX_RECORD_BYTES);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, rec.gen, true);
  dv.setUint32(2, rec.id, true);
  for (const v of rec.variations) bitsetSet(out.subarray(6, 22), v);
  out[22] = rec.xforms & 0xff;
  out[23] = quantizeQ8(rec.coverage);
  out[24] = quantizeQ8(rec.meanLum);
  out[25] = quantizeQ8(rec.entropy);
  out[26] = quantizeQ8(rec.colorVar);
  // bytes 27-29 reserved, zero-filled by Uint8Array default
  return out;
}

/** Decode a record from a byte view at the given offset. Used by both the
 *  client (zero-alloc iteration) and the tests (sanity decode). */
export function decodeRecord(bytes: Uint8Array, offset = 0): FeatureRecord {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset);
  return {
    gen: dv.getUint16(0, true),
    id: dv.getUint32(2, true),
    variations: bitsetUnpack(bytes, offset + 6),
    xforms: bytes[offset + 22]!,
    coverage: dequantizeQ8(bytes[offset + 23]!),
    meanLum: dequantizeQ8(bytes[offset + 24]!),
    entropy: dequantizeQ8(bytes[offset + 25]!),
    colorVar: dequantizeQ8(bytes[offset + 26]!),
  };
}
```

- [ ] **Step 6: Tests**

`src/feature-index.test.ts` covers:
- header round-trip (encode → decode equality on a tag with non-ASCII fillers, on max recordCount)
- magic mismatch rejection
- bitsetSet → bitsetUnpack equality for indices [0, 7, 8, 63, 64, 98]
- quantize → dequantize accuracy (every step within ±1/255)
- record round-trip with full field set

- [ ] **Step 7: Verify + commit**

```bash
npm run typecheck && npm test -- --run src/feature-index.test.ts
git add src/feature-index.ts src/feature-index.test.ts
git commit -m "feat(feature-index): binary format types + encode/decode primitives"
```

---

## Phase 2 — Pure compute helpers (subagent-able)

### Task 2: XML extraction (variation bitset + xform count) (subagent)

**Files:**
- Create: `bin/bake-extract-xml.ts`
- Create: `bin/bake-extract-xml.test.ts`

Pure-logic module: takes a parsed `Genome` (from `parseFlame`), returns `{ variationBitset: Uint8Array, xformCount: number }`. No I/O, no GPU.

Variation bitset walk: for each xform, for each variation in `xform.variations`, set bit at `variation.index` (from the V enum in `src/variations.ts`). Use `bitsetSet` from `feature-index.ts`.

Tests against three fixture flames (one with 1 var, one with multi-var multi-xform overlap, one with high-index variations like `mobius` index 98).

Commit: `feat(bake): XML extraction — variation bitset + xform count`

### Task 3: Stat compute (coverage, lum, entropy, color variance) (subagent)

**Files:**
- Create: `bin/bake-stats.ts`
- Create: `bin/bake-stats.test.ts`

Pure compute. Inputs: a density-histogram view (Float32Array, one entry per pixel cell) + a canvas-pixel-readback view (Uint8Array, RGBA per pixel). Outputs: 4 numbers in [0,1].

Formulas locked in spec:
- `histogramCoverage(hist)` = (count of cells > 0) / cells.length
- `meanLuminance(rgba)` = mean of (R+G+B)/3 across pixels, / 255
- `densityEntropy(hist)` = Shannon entropy of normalized density / log2(cell_count). Skip zeros.
- `colorVariance(rgba)` = stddev of (R, G, B) treated as a 3D point cloud, scaled by 1/sqrt(3)/127.5 (max possible stddev → 1)

Tests against hand-crafted inputs:
- empty histogram → coverage 0, entropy 0
- uniform histogram → coverage 1, entropy 1 (maximum)
- single-pixel-only histogram → coverage 1/N, entropy 0
- all-black canvas → meanLum 0, colorVar 0
- mixed-color canvas → meanLum / colorVar known computed values

Commit: `feat(bake): pure stats — coverage, luminance, entropy, color variance`

---

## Phase 3 — Bake CLI (inline — touches Renderer + I/O)

### Task 4: Bake CLI wiring + resumable .part sidecar (INLINE)

**Why inline:** uses the same WebGPU-globals stamp + happy-dom shim pattern as `bin/pyr3-render.ts`, plus shell-level I/O the subagent perms gap struggles with. Lead-runs-inline per CLAUDE.md.

**Files:**
- Create: `bin/pyr3-bake-features.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: CLI skeleton with arg parse**

Mirror `bin/pyr3-render.ts` for: WebGPU globals stamp, happy-dom DOMParser shim, arg parsing (just three flags: `--esf-root`, `--tag`, `--out`, plus optional `--resume`).

- [ ] **Step 2: Corpus walker**

Read ESF's manifest (`corpus/gens.json` or whatever ESF's existing index shape is — verify against the ESF repo before coding; the chunks loader at `src/avail-client.ts` is a working consumer of the same data). Iterate gen → id in canonical order (gen ascending, id ascending). For each id, resolve to a `.flame` file path under `${esfRoot}/corpus/<gen>/<bucket>/electricsheep.<id>.flam3` (bucket = id rounded down to nearest 10000 per `reference-kotlin-v11-renders` memory).

- [ ] **Step 3: Per-sheep loop**

```
for each (gen, id) in canonical order:
  if --resume and (gen, id) ≤ last recorded → skip
  read .flame xml → parseFlame → genome
  ext = extractFromXml(genome)          // Task 2
  applyPreset(genome, tierToSpec(QUALITY_TIERS[0])) → renderGenome
  renderer.resize({ width: 512, height: 512, oversample: 1 })
  await startChunkedRender({ ... }) // standard pattern from bin/pyr3-render.ts
  density = renderer.readHistogram()    // existing API
  rgba = await readCanvasPixels()        // existing helper
  stats = computeStats(density, rgba)    // Task 3
  rec = { gen, id, variations: bitsetUnpack(ext.bitset), xforms: ext.xformCount, ...stats }
  appendToPartFile(rec)
```

Log progress every 100 sheep (count + elapsed + ETA).

- [ ] **Step 4: Finalization**

When the walk completes, read the `.part` file, sort the records (canonical order — should already be sorted but defensive), prepend `encodeHeader({ schemaVersion: 1, corpusTag: args.tag, recordCount: records.length })`, brotli-compress (existing `src/brotli.ts` or the equivalent encode-side helper), write to `args.out`. Delete the `.part` sidecar on success.

- [ ] **Step 5: package.json npm script**

```json
"scripts": {
  ...
  "bake-features": "tsx bin/pyr3-bake-features.ts"
}
```

- [ ] **Step 6: Smoke test against a 10-sheep slice**

Pick a small gen (e.g., gen 165 — sparse), run the bake against just that gen via a `--limit-gen 165` flag if added, verify the output decodes via Task 1's helpers, validate sizes + first record's known field values.

If you skip `--limit-gen` (YAGNI for v1), validate by running the bake to N sheep via SIGINT + checking the `.part` sidecar decodes.

- [ ] **Step 7: Verify + commit**

```bash
npm run typecheck && npm test
git add bin/pyr3-bake-features.ts bin/bake-extract-xml.ts bin/bake-extract-xml.test.ts \
        bin/bake-stats.ts bin/bake-stats.test.ts package.json
git commit -m "feat(bake): pyr3-bake-features CLI — resumable Draft-render walk"
```

(Note: Task 2 + Task 3 commits land first; this commit just adds the orchestrator + scripts entry. If subagents already committed Tasks 2 and 3, this commit only adds the CLI + package.json line.)

---

## Phase 4 — Client (subagent-able)

### Task 5: Feature-index client + score formula (subagent)

**Files:**
- Create: `src/feature-index-client.ts`
- Create: `src/feature-index-client.test.ts`
- Create: `src/feature-score.ts`
- Create: `src/feature-score.test.ts`

**Client (`feature-index-client.ts`):**

```typescript
import { decodeHeader, decodeRecord, FEATURE_INDEX_HEADER_BYTES, FEATURE_INDEX_RECORD_BYTES } from './feature-index';
import { decodeBrotli } from './brotli'; // existing decoder

let cache: Promise<FeatureIndex> | null = null;

export async function loadFeatureIndex(fetchImpl: typeof fetch = fetch): Promise<FeatureIndex> {
  if (cache !== null) return cache;
  cache = (async () => {
    try {
      const resp = await fetchImpl(`${import.meta.env.BASE_URL}chunks/features.flam3idx`);
      if (!resp.ok) return emptyIndex();
      const buf = new Uint8Array(await resp.arrayBuffer());
      const decompressed = await decodeBrotli(buf);
      const header = decodeHeader(decompressed);
      if (header.schemaVersion !== 1) {
        console.warn(`feature-index: schema ${header.schemaVersion}, expected 1 — disabling filters`);
        return emptyIndex();
      }
      const records = decompressed.subarray(FEATURE_INDEX_HEADER_BYTES);
      return makeIndex(header, records);
    } catch (err) {
      console.warn('feature-index: load failed', err);
      return emptyIndex();
    }
  })();
  return cache;
}

function makeIndex(header, records): FeatureIndex {
  const count = header.recordCount;
  // Binary search by (gen, id) on the 30-byte-stride sorted view
  function findOffset(gen, id) { /* binary search */ }
  return {
    schemaVersion: header.schemaVersion,
    has: (g, i) => findOffset(g, i) >= 0,
    get: (g, i) => {
      const off = findOffset(g, i);
      return off < 0 ? null : decodeRecord(records, off);
    },
    filter: (pred) => {
      const out = [];
      for (let off = 0; off < count * FEATURE_INDEX_RECORD_BYTES; off += FEATURE_INDEX_RECORD_BYTES) {
        const rec = decodeRecord(records, off);
        if (pred(rec)) out.push({ gen: rec.gen, id: rec.id });
      }
      return out;
    },
  };
}

function emptyIndex(): FeatureIndex {
  return { schemaVersion: 0, has: () => false, get: () => null, filter: () => [] };
}
```

**Score formula (`feature-score.ts`):**

```typescript
export interface ScoreWeights {
  coverage: number;
  entropy: number;
  colorVar: number;
  dimPenalty: number;
}

/** 🎚️ Initial weights — tunable as the gallery's sort-by-interest gets real
 *  user feedback. All four sum to ≈1 so the score lands in 0..1 cleanly. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  coverage: 0.35,
  entropy: 0.30,
  colorVar: 0.25,
  dimPenalty: 0.10,
};

export function interestScore(f: SheepFeatures, w = DEFAULT_SCORE_WEIGHTS): number {
  return Math.max(0, Math.min(1,
    w.coverage * f.coverage
    + w.entropy * f.entropy
    + w.colorVar * f.colorVar
    - w.dimPenalty * (1 - f.meanLum)
  ));
}
```

**Tests:**

Client tests use the encode helpers from Task 1 to build a synthetic 8-sheep brotli'd file, then assert:
- header parsed correctly
- magic mismatch → empty index
- schema mismatch (write v=2, read v=1 client) → empty index + warn
- `has` / `get` lookups for hits + misses
- `filter` predicate returns matching refs only
- two-call caching (second `loadFeatureIndex()` returns cached promise)

Score tests assert: bounds [0,1], monotonicity per field, weight-vector application, dim-penalty.

Commit: `feat(feature-index): runtime client + score formula`

---

## Phase 5 — Review + verify

### Task 6: Code review (subagent — fresh code-reviewer)

Dispatch `feature-dev:code-reviewer` against the branch. Focus areas:
- Binary format encode/decode symmetry (round-trip invariants)
- bitset boundary correctness (index 0, 7, 8, 63, 64, 98 — bit-shift off-by-ones)
- Quantization precision (no Math.floor where Math.round was intended)
- Resumability — `.part` file's last-record detection robust to truncation mid-write?
- Cache invalidation in the client (module-level promise — does it survive HMR / re-entry?)
- pyr3 conventions: createElement + textContent only (no innerHTML — none expected since this module is data-only); zero environment branching in `src/feature-index.ts`; one-line commit subjects; no `#48` in code comments.

Address blockers + warns; defer notes per the v1.2 review pattern (`#52` style backlog entries if appropriate).

### Task 7: Final verify (INLINE)

- [ ] **Typecheck + unit suite**

```bash
npm run typecheck
npm test
```

Both clean. No GPU tests here — the bake's GPU path is exercised by the smoke test in Task 4, not the unit suite.

- [ ] **Optional: smoke-bake N sheep**

Verify the CLI on a small slice:

```bash
npm run bake-features -- --esf-root .. --tag smoke --out /tmp/smoke.flam3idx
# kill after ~5-10 sheep with SIGINT
ls -lh /tmp/smoke.flam3idx.part  # confirm sidecar exists
```

Then point a dev-mode load at it (manual — not part of CI). The `--out` path can be served via a tiny static fetch override; or just confirm the binary loads via `decodeHeader` + `decodeRecord` from a node script.

- [ ] **No Chrome verify**

#48 ships data + library code, no UI. The visible-in-Chrome step lands when #49 (filter UI) ships against this index.

- [ ] **Hand off + FF-merge**

Per CLAUDE.md user-verify-before-FF-merge: surface to the user that the bake CLI is ready + the client decodes a smoke file. Wait for explicit FF-merge go.

When approved:

```bash
git switch main
git merge --ff-only feature/issue-48-feature-index
git push origin main
gh issue close 48 --reason completed
```

The ESF integration is a separate downstream activity — see `electric-sheep-fold/docs/pyr3-feature-index-integration.md`. **Closing #48 does NOT require the corpus to be re-baked** — that's a separate operational job whenever the user is ready to run the 3-4h bake.

---

## Out of scope (for #48; tracked elsewhere)

- ESF-side packaging (committed to `electric-sheep-fold/docs/pyr3-feature-index-integration.md`)
- Filter UI / chip controls / sort dropdown (#49)
- Find-similar / perceptual hash (deferred per spec — v1.3+)
- Incremental bake (`--resume` covers crash-recovery, not corpus-diff)
- The actual 3-4h corpus bake (operational step, not a code-shipping task)

---

_Plan produced via `superpowers:writing-plans`-style pattern, 2026-05-31. Spec: `docs/superpowers/specs/2026-05-31-feature-index-foundation-design.md`._
