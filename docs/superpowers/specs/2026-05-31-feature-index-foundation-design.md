# Feature index foundation — v1.2 design spec

**Issue:** #48 — Feature index foundation
**Milestone:** `v1.2 - gallery and discovery`
**Date:** 2026-05-31
**Status:** locked via brainstorm; ready for implementation plan

---

## Goal

Ship the **precomputed per-genome data spine** that the v1.2 gallery's
discovery features (sort, filter, future find-similar) read from. The
spine is a single binary file, distributed alongside the existing
per-gen `avail.flam3idx` files in ESF's chunks Release, fetched and
cached at runtime by a pyr3 client mirroring `src/avail-client.ts`.

## Locked decisions (brainstorm output)

```text
decision                          choice + rationale
-------------------------------   ------------------------------------------
storage layer                     binary index, NOT SQL. v1.2 query ceiling
                                  is chip filters only (T1) — equality + set
                                  AND on a small fixed field set. SQL via
                                  sql.js would add ~1MB wasm + load time for
                                  query power v1.2 doesn't use. Hybrid
                                  escape hatch stays open: same binary
                                  records can be loaded into a sql.js table
                                  later if a T2 query DSL ever lands.
                                  
field set                         raw stats only — not a precomputed score.
                                  Score formula stays client-side + tunable
                                  (🎚️) so the weighting can evolve without
                                  triggering a full rebake of the 3-4h
                                  Draft-render sweep.
                                  
bake compute                      runs LOCALLY on the user's Apple M-series
                                  via a pyr3 CLI (`bin/pyr3-bake-features.ts`).
                                  CI has no GPU; the bake is a manual
                                  recurring job invoked when the corpus
                                  refreshes (currently roughly never).
                                  
bake output ship                  via ESF's existing Release pipeline
                                  alongside avail.flam3idx — clean
                                  separation (corpus data + its derived
                                  data co-located on ESF) + uses the
                                  transport pyr3 already understands.
                                  
client                            new module `src/feature-index-client.ts`
                                  mirroring `avail-client.ts` shape +
                                  caching semantics.
```

## Record layout (per sheep)

22 bytes per sheep, structured for direct slicing without per-record
allocation:

```text
offset  bytes  field                  notes
------  -----  ---------------------  ------------------------------------------
0       16     variation_bitset       bit N = 1 iff variation index N appears
                                      in any xform. 128-bit slot; indices
                                      0-98 currently used (91 variations,
                                      indices up to 98), 29-bit headroom.
                                      
16       1     xform_count            u8, 1-30 expected range
                                      
17       1     coverage_q8            u8, fraction of "lit" pixels in the
                                      rendered Draft(512) canvas (R+G+B
                                      above a small threshold), 0..1
                                      quantized to 0..255. Pixel-derived
                                      rather than density-cell-derived
                                      because the renderer's public
                                      surface exposes the final canvas
                                      but not the internal histogram;
                                      both signals correlate strongly
                                      with "how filled the canvas looks"
                                      — which is the gallery's actual
                                      sort-by-interest goal.
                                      
18       1     mean_luminance_q8      u8, dequantized to 0..1
                                      
19       1     density_entropy_q8     u8, log-spread of density histogram,
                                      normalized 0..1 then quantized
                                      
20       1     color_variance_q8      u8, hue-channel variance, normalized
                                      0..1 then quantized
                                      
21       1     (reserved)             zero-filled; reserved for one future
                                      field at the same schema version.
                                      Larger additions bump schema_version.
                                      
22       —     end-of-record          22 bytes total
```

Quantization is q8 (0..1 → 0..255) for compactness; 256 distinct values
is enough resolution for sort + threshold filtering at v1.2's chip-UI
granularity. If finer resolution is needed later, a schema bump can
switch to f16 or f32 floats per stat.

Total size: 52,365 × 22 = ~1.1 MB raw → ~400-500 KB brotli-compressed.

## File layout: `features.flam3idx`

Single whole-corpus file, sibling of the per-gen `avail.flam3idx`
files in ESF's chunks tar. Header + sorted record table:

```text
section                    bytes        notes
------------------------   ----------   ------------------------------------------
magic                      4            ASCII "pyf3"
schema_version             1            u8 — bumped when record layout changes;
                                        client falls back to no-index mode on
                                        mismatch (filters disabled, warning
                                        logged) until next bake
corpus_tag                 32           UTF-8 padded; the ESF release tag the
                                        bake was run against (e.g.
                                        "corpus-chunks-genome-2026-05-29")
record_count               4            u32 little-endian
─── records ───
(gen u16, id u32, 22-byte record) × record_count
                                        sorted: gen ascending, id ascending
                                        within gen (canonical corpus order —
                                        matches pageOfSheep traversal)
```

Header: 41 bytes. Whole file ~1.1 MB raw, ~500 KB compressed.

**Why one file vs per-gen:**
The consumer pattern is "filter / sort across the WHOLE corpus." Per-gen
sharding would force 80+ fetches at startup just to populate filter chip
counts. One file = one fetch on first gallery-with-filters open. The
500 KB cold-load cost lands in the same ballpark as a single chunk JPEG.

**Why include (gen, id) per record:**
Lookup-by-(gen,id) is the gallery's actual access pattern (cell render
→ check if it has a filter score / variation match). Binary search over
the sorted table is O(log n) — ~16 comparisons across the 52k corpus.

## Bake CLI: `bin/pyr3-bake-features.ts`

Lives in pyr3 (engine modules + XML parser already here). Runs locally
against an ESF corpus checkout. Reuses the single-engine-two-consumers
seam — same WebGPU-globals stamp + happy-dom DOMParser shim
`bin/pyr3-render.ts` uses today.

```bash
npm run bake-features -- \
  --esf-root /Users/matt/dev/MattAltermatt/electric-sheep-fold \
  --tag corpus-chunks-genome-2026-06-01 \
  --out features.flam3idx
```

Per sheep:

1. Read `.flame` XML from disk.
2. Parse XML via existing `parseFlame` → genome.
3. Extract: variation bitset (walk xforms, OR-set each variation index),
   xform count (= genome.xforms.length).
4. Apply Draft tier (longEdge 512, spp 8) via `tierToSpec(QUALITY_TIERS[0])`.
5. Render via the shared `Renderer` (same call shape as bin/pyr3-render.ts).
6. Read back histogram + canvas pixels.
7. Compute four stats (all derived from the rendered RGBA canvas — the
   renderer doesn't expose its internal density buffer in its public
   surface, so the bake works with what's available; the pixel-derived
   signals correlate strongly with the underlying chaos coverage for
   the gallery's purposes):
   - `coverage` = fraction of pixels with R+G+B above LIT_THRESHOLD
   - `mean_luminance` = average of (R+G+B)/3 / 255 across pixels
   - `density_entropy` = Shannon entropy of a 256-bin luminance histogram
     built from the canvas, normalized 0..1
   - `color_variance` = stddev of (R, G, B) treated as a 3D point cloud,
     normalized so the theoretical max maps to 1
8. Quantize each stat to q8.
9. Append 22-byte record to a `.part` sidecar file.

**Resumability (load-bearing for a 3-4h job):**
The `.part` sidecar carries `(gen, id, record)` tuples as they're
written. On `--resume`, the bake reads the sidecar's last (gen, id) and
skips ahead in the corpus walk. A kernel panic / power loss drops only
the in-flight record.

**Finalization:**
When the corpus walk completes, the bake sorts the `.part` records
(canonical order), prepends the header, brotli-compresses the whole
thing, and writes the `--out` path.

**Bake-cost estimate:**
~250 ms/sheep at Draft tier (longEdge 512, spp 8) on Apple M-series,
across 52,365 sheep ≈ 3.6 hours. Parallel-batching by gen could shorten,
but a serial loop is fine for a once-a-year job — keep the bake script
single-threaded for v1.2.

## Client: `src/feature-index-client.ts`

```typescript
export interface SheepFeatures {
  variations: number[];     // unpacked bitset → variation indices
  xforms: number;
  coverage: number;         // 0..1 dequantized
  meanLum: number;
  entropy: number;
  colorVar: number;
}

export interface FeatureIndex {
  has(gen: number, id: number): boolean;
  get(gen: number, id: number): SheepFeatures | null;
  /** Single-pass O(N) scan returning matching (gen, id) refs.
   *  Predicate runs on a zero-alloc record view for speed. */
  filter(predicate: (raw: FeatureRecordView) => boolean): SheepRef[];
  /** Schema version of the loaded index. The caller (gallery) gates
   *  filter UI on this — schema 0 means "no index available". */
  schemaVersion: number;
}

export function loadFeatureIndex(
  fetchImpl?: typeof fetch,
): Promise<FeatureIndex>;
```

**Decode:** fetch → brotli decompress (existing `src/brotli.ts`) →
parse header → keep records as a single `Uint8Array` view. Iteration
walks the byte view at 30-byte stride (2 bytes gen u16 + 4 bytes id
u32 + 22 byte record). Lookups are O(log n) binary search on the
sorted (gen, id) prefix; the view's stride is exact, no padding.

**Caching:** module-level `Promise<FeatureIndex>` — same idiom as
`loadAvail`. One fetch per session.

**Failure modes:**
- Fetch fails / 404 → resolve to a sentinel `FeatureIndex` with
  `schemaVersion: 0` and `has() === false` for every key. Gallery sees
  "no index" + disables filter UI; logs once.
- Magic mismatch → same as fetch fail; loud console.error.
- Schema version greater than client supports → same; warn "stale
  pyr3 deploy or future ESF feature-index version".
- Corpus tag mismatch (header tag ≠ pyr3's `CHUNK_RELEASE_TAG`) →
  load successfully but warn once. Index is likely still mostly valid
  (corpus changes are typically additive).

## ESF integration

ESF-side work is tracked in **`electric-sheep-fold/docs/pyr3-feature-index-integration.md`**
— the markdown plan for that side lives there, not in pyr3. Summary:
ESF's build script picks up `features.flam3idx` from a known location
(either a committed artifact or a pre-publish step that imports it) and
packs it alongside the per-gen `avail.flam3idx` files in the
`corpus-chunks-genome-*.tar` Release asset.

The pyr3 side reads it from the same chunk pipeline that already serves
`avail.flam3idx` — no new transport, no new infrastructure.

## Pyr3 ↔ ESF coupling

```text
boundary                    contract
-------------------------   -------------------------------------------------
pyr3 → ESF                  pyr3 produces `features.flam3idx` (binary).
                            Spec lives in pyr3 (this doc).
                            
ESF → pyr3                  ESF includes `features.flam3idx` in its chunks
                            tar at the corpus root (NOT per-gen).
                            Header's `corpus_tag` matches the Release tag.
                            
pyr3 runtime                fetches via the same `BASE_URL + chunks/...`
                            path the avail-client uses. Tag pin in
                            deploy.yml + chunks loader handles transport.
```

## Versioning + freshness

Three safety nets, layered from cheap to expensive:

1. **Magic bytes** (`pyf3`) — wrong-content-type / wrong-file detection
   at fetch time. Cheap rejection.
2. **Schema version byte** — incompatible record-layout changes (new
   field set, different quantization) bump this. Client falls back to
   no-index mode; gallery disables filter UI.
3. **Corpus tag** — content-freshness check. Mismatch is a warning, not
   a hard fail; the index may still be largely valid since corpus
   refreshes are typically additive.

## Out of scope (deferred to v1.3+ or sibling issues)

- **Perceptual hash field** — needed for find-similar. Not in v1.2's
  filter scope (#49). When find-similar lands, a `schema_version=2`
  bump appends a 16-byte phash field per record. ~330 KB to the file
  size — still cheap.
- **Incremental bake** (only re-render sheep whose XML changed) — full
  corpus bake is the current target. Add when corpus refresh cadence
  warrants it.
- **Interestingness score formula in code** — first-draft weights live
  in `src/feature-score.ts` (load-bearing 🎚️ tunable); gallery sort +
  filter consumers import from there. This issue ships the *inputs*
  only; the formula is part of #49's scope.
- **Filter chip UI / sort dropdown** — entirely #49's scope.
- **Server-side SQL / sql.js fallback** — only revisit if a T2 query
  DSL becomes a real v1.3+ feature (see brainstorm tier ladder).

## Tests

- `src/feature-index-client.test.ts` — header parse, magic-rejection,
  schema-mismatch fallback, record lookup, filter predicate against a
  synthetic 8-sheep brotli'd file.
- `bin/bake-features.test.ts` — XML extraction (variation bitset +
  xform count) against fixture flames; quantization round-trip checks.
- The GPU-render portion of the bake reuses the existing `Renderer`
  (already tested); no new GPU tests needed.

## Verification gate (v1.2 ship contract addition)

The full bake against the current corpus produces a `features.flam3idx`
of plausible size (~400-600 KB compressed) and the pyr3 client loads it
without errors. Chrome MCP verify is NOT in scope — #48 ships data; the
visible-in-Chrome verification lands with #49 (filter UI).

---

_Spec produced via `superpowers:brainstorming`, 2026-05-31. Sibling
plan: `docs/superpowers/plans/2026-05-31-feature-index-foundation.md`.
ESF-side plan: `electric-sheep-fold/docs/pyr3-feature-index-integration.md`._
