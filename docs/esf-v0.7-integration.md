# ESF v0.7 integration — distinct-flame view + genome-only chunks

**Source repo:** [`electric-sheep-fold`](https://github.com/MattAltermatt/electric-sheep-fold) at `/Users/matt/dev/MattAltermatt/electric-sheep-fold`
**Filed:** 2026-06-01 — paired with ESF milestone [`index v0.7`](https://github.com/MattAltermatt/electric-sheep-fold/milestone/1).
**Milestone status (updated 2026-06-01):** all 4 engineering issues shipped (#21, #22, #10, #9); #8 closed wontfix (spike found static checks already comprehensive). Coordinated v0.7 release tagged **`2026-06-01`** on GitHub.
**Status on ESF side:** all code on `main`; v0.7 release published.

---

## TL;DR for pyr3

1. **`index.json` schema bumped 6 → 7.** Two new fields on every record:
   `thumb_hash` (sha1) and `is_thumb_representative` (bool). Filter on
   `is_thumb_representative` to dedupe pyr3's gallery from 52,284 → **51,257**
   distinct genome thumbnails (1,027 byte-equal duplicates collapsed).
2. **Chunks artifact renamed.** ESF's `release-build` now emits ONLY
   `corpus-chunks-genome-{date}.tar` (was `corpus-chunks-{date}.tar`). The
   "all" variant is opt-in via `sheep-fold chunk` (no flag) for the day
   pyr3 adds animation rendering. Pyr3 needs to update its fetch path /
   asset-name when the next ESF Release tag goes live.
3. **`features.flam3idx` packaging plumbing done.** Pyr3's local bake CLI
   writes to `/Users/matt/dev/MattAltermatt/electric-sheep-fold/build/features.flam3idx`
   and ESF's `release-build` auto-packages it at the chunks tar root.
   Pyr3 fetches it from `${BASE_URL}chunks/features.flam3idx` at runtime.

---

## 1. The new index fields (v7)

`_schema_version: 6 → 7`. Two fields added to every genome/animation/corrupt record:

### `thumb_hash : str | null`

SHA-1 hex of the canonicalized first `<flame>` element. Canonicalization strips attrs that don't affect the rendered visual:

- **On `<flame>`:** `name`, `nick`, `url`, `parents`, `time`, `oversample`, `filter`, `quality`, `batches`, `size`, `temporal_samples`
- **On `<xform>`:** `animate`
- Attribute order normalized (sorted alphabetically); xform document order preserved (chaos array is positional).

Two files render the same thumbnail iff their `thumb_hash` is equal. `null` only on corrupt records with no parseable flame.

### `is_thumb_representative : bool`

`true` on **exactly one** record per distinct `thumb_hash`, **scoped to `kind == "genome"` records only**. Animations and corrupt records ALWAYS get `false` because ESF's genome-only chunked bake doesn't load them — picking an animation as the rep would silently hide a standalone genome's thumbnail.

**Pick rule** (within the genome candidates of a hash group):
1. Lowest `sheep_id`
2. Tie-break across gens: lowest `gen`

---

## 2. Pyr3-side actions

### a. Gallery filter — paste into wherever the thumbnail list is built

```ts
// distinct-flame gallery view — one thumbnail per visually-unique genome
const thumbnails = index.genomes.filter(r => r.is_thumb_representative)
// expect ~51,257 entries for the 2026-06-01 corpus snapshot
```

Or via jq for ad-hoc inspection:

```sh
jq '.genomes[] | select(.is_thumb_representative)' index.json
```

### b. Update the chunks fetch URL — v0.7 release is live

```
OLD: ${BASE_URL}corpus-chunks-{date}.tar
NEW: ${BASE_URL}corpus-chunks-genome-{date}.tar
```

Bump `CHUNK_RELEASE_TAG` → **`2026-06-01`** in pyr3's `deploy.yml` (or wherever the asset-name resolver lives) to pick up this release. The `gens.json` inside the tar carries `"kind": "genome"` so pyr3 can detect the variant at load time if it wants belt-and-suspenders.

### c. The 81 promoted orphan keyframes are NOT in `index.json`

ESF's genome-only bake includes 52,365 flames (confirmed by live smoke test 2026-06-01):
- **52,284** standalone `kind=genome` files — each has an index record.
- **81** promoted orphan keyframes — animation-internal genomes whose id is a gap in the standalone set. They exist in the chunked tar (in gen 244 specifically) but NOT in `index.json`.

If pyr3 wants thumbnail dedup over the FULL 52,365 (not just the standalones), it has to hash the orphan keyframes itself. But all 81 are already visually distinct vs each other AND vs the standalones (verified in ESF probe), so the practical dedup set is:

```ts
// total visible distinct thumbnails in the genome-only bake
const distinct = thumbnails.length + 81   // = 51,338
```

Pyr3 might just always show the 81 orphans alongside the deduped standalones — they have no index records to filter against, and they're each unique anyway.

### d. Optional: features.flam3idx (pair with pyr3#48)

Pyr3's local bake CLI should write its output to:

```
/Users/matt/dev/MattAltermatt/electric-sheep-fold/build/features.flam3idx
```

ESF's `scripts/build_release.sh` auto-picks up that path; the binary lands at the chunks tar root as `features.flam3idx` (lowercase, exact). Pyr3's runtime fetches it from `${BASE_URL}chunks/features.flam3idx`. Release tag must match what pyr3's bake CLI was given via `--tag` (per the existing pair doc).

**Note for this release (2026-06-01):** pyr3 did NOT hand a `features.flam3idx` over to ESF before the v0.7 cut, so the 2026-06-01 tar ships WITHOUT one (backwards-compatible — the tar omits the file cleanly). When pyr3 bakes one, drop it at the path above and re-run ESF's `release-build` to include it in a subsequent dated release.

---

## 3. Useful jq recipes

**Distinct-flame gallery view (the new canonical filter):**

```sh
jq '.genomes[] | select(.is_thumb_representative)' index.json
```

**Trace one id's dedup group — find all sheep with the same thumbnail:**

```sh
jq -r '.genomes
       | (map(select(.id == "169/05140")) | .[0].thumb_hash) as $h
       | .[] | select(.thumb_hash == $h) | .id' index.json
```

**Pick a genome by thumb_hash (when pyr3 has a hash and wants the rep):**

```sh
jq '.genomes[] | select(.thumb_hash == "be8110f1b820…" and .is_thumb_representative)' index.json
```

**Post-load sanity check on `index.json`:**

```sh
jq '{_schema_version, distinct_thumbs: [.genomes[] | select(.is_thumb_representative)] | length}' index.json
# expect: {"_schema_version": 7, "distinct_thumbs": 51257}
```

---

## 4. Reference numbers (2026-06-01 corpus snapshot)

```text
166,614  total .flam3 files in corpus
 52,284  kind == "genome" files (single-flame standalones)
114,330  kind == "animation" files (NOT in genome-only bake)
      0  corrupt
 51,257  is_thumb_representative=true  (1,027 byte-equal dupes collapsed)

Genome-only chunks tar (corpus-chunks-genome-{date}.tar):
 52,365  total flames  (52,284 standalones + 81 promoted orphan keyframes)
   46 MB tar size (uncompressed; brotli q11 inside)
```

---

## 5. ESF milestone — fully shipped

All 4 engineering issues closed; #8 closed wontfix. The 2026-06-01 release rides everything:

- ✅ **#21** `thumb_hash` + `is_thumb_representative` for distinct-flame view
- ✅ **#22** `features.flam3idx` packaging + genome-only chunks tar default
- ✅ **#10** id-set diff for consistency checks (server-side hardening; transparent to pyr3)
- ✅ **#9** `release-build --skip-unchanged` + `--prune-old` (server-side pipeline; transparent to pyr3)
- ❌ **#8** runtime `produces_nan: bool` — closed wontfix; static checks already comprehensive

ESF milestone (closed):
[https://github.com/MattAltermatt/electric-sheep-fold/milestone/1](https://github.com/MattAltermatt/electric-sheep-fold/milestone/1)

The next ESF improvement push is the `release-automation` milestone (skill + release-notes templating, ESF #23). Orthogonal to pyr3 integration.

---

## 6. ESF shipped commits (for traceability)

```
ae0670c  index v0.7: thumb_hash + is_thumb_representative for distinct-flame view (#21)
3f2cff3  chunks-tar: package features.flam3idx + switch release-build to genome-only (#22)
4426b42  verify: id-set diff catches same-count bogus rewrites (#10)
73e4b4e  release-build: --skip-unchanged + --prune-old via per-gen content fingerprints (#9)
```

All on ESF `main`; CI green; 300/300 tests passing; rolled into the **2026-06-01** GitHub Release.

---

_Pair doc on ESF side: `docs/pyr3-feature-index-integration.md` in the electric-sheep-fold repo._
