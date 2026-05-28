# pyr3 v0.20 Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Per pyr3 project CLAUDE.md ("Task granularity: Claude-sized, not human-sized"), tasks here batch related work into 5–10 logical increments rather than 18+ micro-steps. Each task ends in passing-tests + commit.

**Goal:** Ship pyr3 v0.20 — parity corpus 19 → 25 + `--preset {quick,4k}` CLI flag family + `[PYR3-023]` closure.

**Architecture:** Contract + CLI surface only. No engine / shader / RNG changes. New `src/presets.ts` module owns the preset specs; `bin/pyr3-render.ts` consumes via `applyPreset()`. 6 new fixtures (3 untapped kotlin goldens + 3 ESF picks from kotlin's `v1.0-showcase.txt`) extend the parity corpus. 4K showcase meta (`fixtures/kotlin-4k-refs/meta.json`) rename mirrors v0.19's 19-fixture schema. The legacy `scripts/pyr3-023-be-render-4k.mjs` is deleted — `--preset 4k` is the destination, no stop-gap.

**Tech Stack:** TypeScript + WebGPU (Dawn-node `webgpu` npm) + Vitest + tsx. flam3-C binary at `/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac` for golden regen.

**Execution mode:** Hybrid per CLAUDE.md. Tasks marked **[lead-inline]** need shell-level Bash for flam3-C invocation, file moves, npm runs, or git. Tasks marked **[subagent-OK]** are pure TS / docs work that a subagent could own; lead can also do inline.

**Branch:** `feature/pyr3-v020-corpus-expansion` (already created and bearing the spec commit `e45d8a1`).

---

### Task 1: Corpus expansion 19 → 25 (lift kotlin + render ESF)  **[lead-inline]**

**Files:**
- Create (×6): `fixtures/flam3-goldens/<id>/<id>.flam3`
- Create (×6): `fixtures/flam3-goldens/<id>/golden.png`
- Create (×6): `fixtures/flam3-goldens/<id>/meta.json` (v0.19 schema, written by regen script)

**The 3 untapped kotlin lifts:**
- `244.00617` ← `/Users/matt/dev/MattAltermatt/pyr3-kotlin/parity/goldens/244.00617/source.flam3` (rename to `244.00617.flam3`)
- `244.42746` ← same path with id substituted
- `248.23554` ← same

**The 3 ESF picks (paths pre-confirmed):**
- `electricsheep.247.08620` ← `/Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/247/00000/electricsheep.247.08620.flam3`
- `electricsheep.245.07670` ← `/Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/245/00000/electricsheep.245.07670.flam3`
- `electricsheep.244.59334` ← `/Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/244/50000/electricsheep.244.59334.flam3`

- [ ] **Step 1.1:** For each of the 6 new fixtures, create the dir under `fixtures/flam3-goldens/<id>/` and copy the `.flam3` source. Use `cp` not symlink — fixtures need to be self-contained for repo portability.

```bash
# Kotlin lifts
for id in 244.00617 244.42746 248.23554; do
  mkdir -p "fixtures/flam3-goldens/$id"
  cp "/Users/matt/dev/MattAltermatt/pyr3-kotlin/parity/goldens/$id/source.flam3" \
     "fixtures/flam3-goldens/$id/$id.flam3"
done

# ESF picks
cp /Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/247/00000/electricsheep.247.08620.flam3 fixtures/flam3-goldens/electricsheep.247.08620/electricsheep.247.08620.flam3
# (similar for 245.07670, 244.59334 — mkdir first)
```

The `regen-flam3c-goldens.mjs` script's `listFixtures` reads the directory listing, so creating empty `meta.json` files first is required for the script to see them. Pre-seed each with a stub `meta.json` carrying just `id`, `width`, `height` (parse from the .flame `<flame size="W H">` attribute):

- [ ] **Step 1.2:** Pre-seed `meta.json` for each of the 6 new fixtures. The regen script needs `metaPath` to exist for discovery; it'll overwrite the body. Use this stub:

```json
{
  "id": "<id>",
  "width": <from .flame size>,
  "height": <from .flame size>,
  "expectedR": null,
  "thresholdR": null,
  "tier": null,
  "source": "flam3-render-32bit-isaac qs=1 isaac_seed=<id>",
  "calibration": "v0.20 pre-seed; regen script will rewrite",
  "feBeExpectedR": null,
  "feBeThresholdR": null
}
```

(One-liner: a small node script that reads each .flame's `size="W H"` attr and emits the stub. Stamp inline.)

- [ ] **Step 1.3:** Run the regen script restricted to the 6 new fixtures:

```bash
node scripts/regen-flam3c-goldens.mjs --fixtures=244.00617,244.42746,248.23554,electricsheep.247.08620,electricsheep.245.07670,electricsheep.244.59334
```

Expected: per-fixture stderr summary lines, then a final tier-aware summary table. Each fixture should produce a fresh `golden.png` and a fully-populated v0.19-schema `meta.json` with `expectedR` measured (3-run mean) and `tier` computed.

- [ ] **Step 1.4:** Sanity-check tier ratio. Read each new meta.json's `tier` field. Add to the existing 14:5 split. If the new total tier-2 count is > ~8 (i.e., the ratio drops below ~17:8), surface the tier-2 picks and offer to swap a Tier-2 ESF pick for one of the alternates listed in the spec (`248.13972`, `247.44220`, `245.04339`, `244.84478`, `243.10218`).

- [ ] **Step 1.5:** Verify `npm run test:parity` passes with all 25 fixtures.

```bash
npm run test:parity 2>&1 | tail -10
```

Expected: `Tests  25 passed (25)`. Wall-clock ≤ ~150s. The PYR3-014 birpc heartbeat warning at the tail is the known cosmetic noise — not a failure.

- [ ] **Step 1.6:** Commit. (Note: golden.png files are large binaries; verify they're not gitignored before staging.)

```bash
git add fixtures/flam3-goldens/244.00617 fixtures/flam3-goldens/244.42746 \
        fixtures/flam3-goldens/248.23554 \
        fixtures/flam3-goldens/electricsheep.247.08620 \
        fixtures/flam3-goldens/electricsheep.245.07670 \
        fixtures/flam3-goldens/electricsheep.244.59334
git commit -m "v0.20 corpus: +6 fixtures (3 kotlin goldens + 3 ESF picks from v1.0-showcase.txt)"
```

---

### Task 2: Build `src/presets.ts` preset module  **[subagent-OK]**

**Files:**
- Create: `src/presets.ts`
- Create: `src/presets.test.ts`

The module owns: preset name enum, per-preset spec, and the `applyPreset(genome, preset)` helper. Both `--preset quick` and `--preset 4k` go through one code path. Per-preset short-edge rounding handles the kotlin `Math.floorDiv` semantics for `4k` vs v0.19-`--quick`'s `Math.round`.

- [ ] **Step 2.1:** Write `src/presets.test.ts` first (TDD). Tests cover:
  - PRESETS table has exactly `quick` and `4k` keys
  - `applyPreset(genome, PRESETS.quick)` rescales 800×592 genome to 1024 long-edge using `Math.round` (matches the pre-v0.20 `--quick` behavior at `bin/pyr3-render.ts:108-117`)
  - `applyPreset(genome, PRESETS['4k'])` rescales 800×592 genome to 3840 long-edge using `Math.floor` for the short edge (matches `scripts/pyr3-023-be-render-4k.mjs:65-66`)
  - `applyPreset` caps quality at preset max-SPP (quick=16, 4k=200) via `Math.min`
  - `applyPreset` sets oversample=1 for both presets
  - `applyPreset` does NOT mutate the input genome (returns a new object)

- [ ] **Step 2.2:** Run the test — must fail (module doesn't exist):

```bash
npx vitest run src/presets.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './presets'`.

- [ ] **Step 2.3:** Write `src/presets.ts`:

```ts
import type { Genome } from './genome';

export type PresetName = 'quick' | '4k';

export interface PresetSpec {
  maxDim: number;
  maxSpp: number;
  oversample: number;
  /** How to round the short-edge dim when rescaling.
   *  - 'round' matches v0.19's --quick behavior (FE pixel-for-pixel parity).
   *  - 'floor' matches kotlin's Math.floorDiv in Preset.SHOWCASE_4K. */
  shortEdgeRound: 'round' | 'floor';
}

export const PRESETS: Record<PresetName, PresetSpec> = {
  quick: { maxDim: 1024, maxSpp: 16, oversample: 1, shortEdgeRound: 'round' },
  '4k':  { maxDim: 3840, maxSpp: 200, oversample: 1, shortEdgeRound: 'floor' },
};

export function applyPreset(genome: Genome, preset: PresetSpec): Genome {
  const declW = genome.size?.width ?? 1024;
  const declH = genome.size?.height ?? 1024;
  const maxDecl = Math.max(declW, declH);

  if (maxDecl <= preset.maxDim) {
    // No rescale needed; just cap quality + force oversample.
    return {
      ...genome,
      oversample: preset.oversample,
      quality: Math.min(genome.quality ?? preset.maxSpp, preset.maxSpp),
    };
  }

  const sizeScale = preset.maxDim / maxDecl;
  const roundFn = preset.shortEdgeRound === 'floor' ? Math.floor : Math.round;
  // Long-edge exact = preset.maxDim; short-edge via preset's rounding rule.
  const newW = declW === maxDecl
    ? preset.maxDim
    : Math.max(1, roundFn((preset.maxDim * declW) / declH));
  const newH = declH === maxDecl
    ? preset.maxDim
    : Math.max(1, roundFn((preset.maxDim * declH) / declW));

  return {
    ...genome,
    size: { width: newW, height: newH },
    scale: genome.scale * sizeScale,
    oversample: preset.oversample,
    quality: Math.min(genome.quality ?? preset.maxSpp, preset.maxSpp),
  };
}

export function isPresetName(s: string): s is PresetName {
  return s === 'quick' || s === '4k';
}
```

- [ ] **Step 2.4:** Run tests, all should pass:

```bash
npx vitest run src/presets.test.ts 2>&1 | tail -10
```

Expected: all tests green.

- [ ] **Step 2.5:** Commit.

```bash
git add src/presets.ts src/presets.test.ts
git commit -m "v0.20 presets: src/presets.ts module + applyPreset() helper"
```

---

### Task 3: Migrate `bin/pyr3-render.ts` from `--quick` to `--preset NAME`  **[subagent-OK]**

**Files:**
- Modify: `bin/pyr3-render.ts:33-125` (argv parsing + preset application)

Replace the `let quick = false;` branch and the post-parse rescale block (the `QUICK_FE_*` constants + size-cap logic at lines ~99-125) with a `preset: PresetName | null` argv handler that calls `applyPreset(genome, PRESETS[preset])`. Keep `--max-dim N` as a standalone knob (conflicts with `--preset`). Keep `--sample-inflate=N` and `--no-de` unchanged.

- [ ] **Step 3.1:** Replace the argv-parse block (around lines 36-67):

```ts
import { PRESETS, applyPreset, isPresetName, type PresetName } from '../src/presets';

// ... inside main() ...
const rawArgs = process.argv.slice(2);
const args: string[] = [];
let forceDeOff = false;
let preset: PresetName | null = null;
let maxDim: number | null = null;
let sampleInflate = 1;
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i]!;
  if (a === '--no-de') {
    forceDeOff = true;
  } else if (a === '--preset') {
    const v = rawArgs[++i];
    if (v === undefined || !isPresetName(v)) {
      console.error(`--preset requires one of: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    preset = v;
  } else if (a === '--max-dim') {
    const v = rawArgs[++i];
    const n = v === undefined ? NaN : Number(v);
    if (!Number.isFinite(n) || n < 1) {
      console.error('--max-dim requires a positive integer argument');
      process.exit(1);
    }
    maxDim = Math.max(1, Math.floor(n));
  } else if (a.startsWith('--sample-inflate=')) {
    const n = Number(a.slice('--sample-inflate='.length));
    if (!Number.isFinite(n) || n <= 0) {
      console.error('--sample-inflate=N requires a positive number');
      process.exit(1);
    }
    sampleInflate = n;
  } else {
    args.push(a);
  }
}
if (preset !== null && maxDim !== null) {
  console.error('--preset and --max-dim are mutually exclusive');
  process.exit(1);
}
if (args.length < 1) {
  console.error(
    'usage: npm run render [--no-de] [--preset {quick,4k}] [--max-dim N] [--sample-inflate=F] <input.flam3 | input.pyr3.json> [output.png]',
  );
  process.exit(1);
}
```

- [ ] **Step 3.2:** Replace the post-parse rescale block (around lines 99-125):

```ts
// Apply preset (replaces v0.19's --quick logic; both quick and 4k flow through here).
if (preset !== null) {
  genome = applyPreset(genome, PRESETS[preset]);
}
// Standalone --max-dim cap (legacy knob; conflicts with --preset, checked above).
if (maxDim !== null) {
  const declW = genome.size?.width ?? 1024;
  const declH = genome.size?.height ?? 1024;
  const maxDecl = Math.max(declW, declH);
  if (maxDecl > maxDim) {
    const sizeScale = maxDim / maxDecl;
    genome = {
      ...genome,
      size: {
        width: Math.max(1, Math.round(declW * sizeScale)),
        height: Math.max(1, Math.round(declH * sizeScale)),
      },
      scale: genome.scale * sizeScale,
    };
  }
}
```

- [ ] **Step 3.3:** `npm run typecheck` — must pass. Catches missed `quick` references.

- [ ] **Step 3.4:** Sanity render via the new flag:

```bash
node --import tsx/esm --import ./bin/wgsl-loader-register.mjs bin/pyr3-render.ts \
  --preset quick fixtures/flam3-goldens/coverage.248.11405/coverage.248.11405.flam3 \
  /tmp/v020-quick-smoke.png
```

Expected: completes in ~3s; PNG written. Compare bytes to a pre-v0.20 `--quick` render of the same fixture (cached `pyr3-render.png` in the fixture dir, OR re-render at the v0.19 commit). Must match.

```bash
node --import tsx/esm --import ./bin/wgsl-loader-register.mjs bin/pyr3-render.ts \
  --preset 4k fixtures/showcase-probe-sources/electricsheep.247.19679.flam3 \
  /tmp/v020-4k-smoke.png
```

Expected: completes in ~13s; PNG written. Byte-compare against a pre-v0.20 `node scripts/pyr3-023-be-render-4k.mjs` render of the same fixture (kept at `fixtures/kotlin-4k-refs/electricsheep.247.19679.pyr3-be-4k.png` from the v0.17 calibration run). Must match.

- [ ] **Step 3.5:** Commit.

```bash
git add bin/pyr3-render.ts
git commit -m "v0.20 cli: bin/pyr3-render.ts uses --preset {quick,4k}; --quick flag removed"
```

---

### Task 4: Migrate callers — test files  **[subagent-OK]**

**Files:**
- Modify: `src/parity-fe-be.test.ts:161` (`'--quick'` → `'--preset', 'quick'`)
- Modify: `src/parity-4k.test.ts:118` (`'scripts/pyr3-023-be-render-4k.mjs'` → `'--import', 'tsx/esm', ..., 'bin/pyr3-render.ts', '--preset', '4k', ...`)

- [ ] **Step 4.1:** Update `src/parity-fe-be.test.ts`. The `spawnSync` call at line ~152-171 builds argv including `'--quick'`. Replace:

```ts
// before:
'bin/pyr3-render.ts',
'--quick',
fixture.flam3Path,
bePath,

// after:
'bin/pyr3-render.ts',
'--preset', 'quick',
fixture.flam3Path,
bePath,
```

- [ ] **Step 4.2:** Update `src/parity-4k.test.ts`. The `spawnSync` at line ~116-125 invokes the wrapper script directly. Replace with the standard render invocation pattern (matches `src/parity.test.ts:58-76` and `src/parity-fe-be.test.ts:152-171`):

```ts
const result = spawnSync(
  'node',
  [
    '--import', 'tsx/esm',
    '--import', './bin/wgsl-loader-register.mjs',
    'bin/pyr3-render.ts',
    '--preset', '4k',
    fixture.flam3Path,
    outPath,
  ],
  {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    encoding: 'utf8',
  },
);
```

- [ ] **Step 4.3:** `npm run typecheck` — must pass.

- [ ] **Step 4.4:** `npm test` — must pass (unit suite ~1s).

- [ ] **Step 4.5:** `npm run test:parity-fe-be` — 25/25 (or 19/19 if Task 1 not yet done) green via the new `--preset quick` path. Wall-clock ~10 min via swiftshader.

```bash
npm run test:parity-fe-be 2>&1 | tail -10
```

Expected: all fixtures pass; per-fixture R(FE, BE) within `feBeThresholdR` (unchanged from v0.19).

- [ ] **Step 4.6:** `npm run test:parity-4k` — 5/5 green via `--preset 4k`.

```bash
VITEST_INCLUDE_PARITY_4K=1 npx vitest run src/parity-4k.test.ts 2>&1 | tail -15
```

Expected: 5/5 pass at the v0.19-calibrated thresholds.

- [ ] **Step 4.7:** Commit.

```bash
git add src/parity-fe-be.test.ts src/parity-4k.test.ts
git commit -m "v0.20 tests: parity-fe-be + parity-4k callers use --preset {quick,4k}"
```

---

### Task 5: 4K meta harmonization + delete legacy wrapper  **[subagent-OK]**

**Files:**
- Modify: `fixtures/kotlin-4k-refs/meta.json` (`baselineR` → `expectedR` per fixture; `_comment` notes the v0.20 rename)
- Modify: `src/parity-4k.test.ts:44-47` (`FixtureMeta` interface: `baselineR` → `expectedR`)
- Delete: `scripts/pyr3-023-be-render-4k.mjs`

- [ ] **Step 5.1:** Edit `fixtures/kotlin-4k-refs/meta.json`. For each of the 5 fixtures, rename the `baselineR` key to `expectedR`. Keep `thresholdR`, `tier`, and `notes` (where present) unchanged. Update the `_comment` field to:

```json
"_comment": "PYR3-023 BE 4K parity gate per-fixture thresholds (vs kotlin v1.1 SHOWCASE_4K JPGs). v0.20 (2026-05-28): expectedR rename (was baselineR — harmonized with the 19-fixture corpus schema from v0.19). tier was added in v0.19. 4K thresholds use round(expectedR + 2.0) (JPG noise floor headroom)."
```

- [ ] **Step 5.2:** Update `src/parity-4k.test.ts` `FixtureMeta` interface:

```ts
interface FixtureMeta {
  expectedR?: number | null;  // was baselineR
  thresholdR?: number | null;
  tier?: 1 | 2 | null;
  notes?: string;
}
```

Audit body for `meta.baselineR` reads — none expected (current code only reads `meta.thresholdR`), but verify via grep.

- [ ] **Step 5.3:** Delete the legacy wrapper:

```bash
git rm scripts/pyr3-023-be-render-4k.mjs
```

- [ ] **Step 5.4:** `npm run typecheck` — must pass.

- [ ] **Step 5.5:** `VITEST_INCLUDE_PARITY_4K=1 npx vitest run src/parity-4k.test.ts` — 5/5 green (re-verifies post-rename).

- [ ] **Step 5.6:** Commit.

```bash
git add fixtures/kotlin-4k-refs/meta.json src/parity-4k.test.ts
git commit -m "v0.20 4K meta: baselineR -> expectedR; legacy pyr3-023-be-render-4k.mjs deleted"
```

---

### Task 6: Eyeball verify HTML + run full verify suite  **[lead-inline]**

**Files:**
- Create: `.remember/verify/v0.20-corpus-expansion.html` (gitignored — the eyeball-verify deliverable)

- [ ] **Step 6.1:** Build the verify HTML showing the 6 new fixtures in the standard 3-column layout (flam3-C golden / pyr3 BE render / diff). Reuse the existing `scripts/build-flam3c-pivot-verify-html.mjs` shape — either (a) extend it with a `--fixtures=...` filter and run it for just the 6 new ones, or (b) write a small v0.20-specific HTML builder that lifts the same template.

Recommended: write a small one-shot builder (`scripts/build-v020-verify-html.mjs`) since the v0.18-flam3c-pivot HTML serves the full corpus role. The v0.20 HTML is specifically about validating the 6 new picks.

Layout per fixture: header pill row showing `expectedR / threshold / tier`; row of 3 images (golden / pyr3 / diff). All-25-fixture summary table at the top for tier ratio confirmation.

- [ ] **Step 6.2:** Run all verify gates one final time:

```bash
npm run typecheck && npm test && npm run test:parity 2>&1 | tail -5
```

Expected: green on each.

- [ ] **Step 6.3:** Open the verify HTML in the OS finder for inspection later (user-verify step):

```bash
echo "open .remember/verify/v0.20-corpus-expansion.html"
```

(Surface the path; don't auto-open during agentic execution.)

- [ ] **Step 6.4:** Commit the verify builder script (the HTML output is gitignored).

```bash
git add scripts/build-v020-verify-html.mjs
git commit -m "v0.20 verify: HTML builder for 6 new fixtures"
```

---

### Task 7: Docs churn + PYR3-023 closure + user-verify + FF-merge  **[lead-inline]**

**Files:**
- Modify: `BACKLOG.md` (PYR3-023 closure)
- Modify: `ROADMAP.md` (v0.20 shipped row; "Next phases" collapses to v1.0 only)
- Modify: `CHANGELOG.md` (v0.20 entry)
- Modify: `CLAUDE.md` (project) — Quick commands § update (no more `--quick`; preset family documented)

- [ ] **Step 7.1:** `BACKLOG.md` — PYR3-023 entry. Update header from `gpu · M · 🪨 · queued · v1.x — BE 4K parity gate vs kotlin v1.1 (V1.0 SHIP GATE)` to `gpu · M · ✅ resolved (corpus expansion + --preset 4k landed in v0.20)`. Prepend a 3-line closure paragraph stating: BE 4K parity rig is first-class infrastructure; `--preset 4k` CLI flag supersedes `scripts/pyr3-023-be-render-4k.mjs`; corpus + showcase work split per the v0.20 brainstorm (showcase gallery stays as PYR3-007 / PYR3-013, distinct artifact).

- [ ] **Step 7.2:** `ROADMAP.md` — convert the placeholder v0.20 row to past-tense with the actual commit ref. Collapse "Next phases" §1 (`v0.20`) to a one-line shipped pointer at the CHANGELOG. The "Next 2 phases" section becomes "Next 1 phase" (v1.0 ship gate green + GitHub repo replacement).

- [ ] **Step 7.3:** `CHANGELOG.md` — new top entry for v0.20. Cover:
  - Corpus 19 → 25 (6 new fixtures named)
  - Final tier ratio (e.g., 18:7 or whatever Task 1 produced)
  - `--preset NAME` CLI family ships with quick + 4k
  - `--quick` removed; callers migrated
  - 4K meta harmonized
  - `scripts/pyr3-023-be-render-4k.mjs` deleted
  - PYR3-023 closes
  - Unblocks v1.0 ship-gate green check

- [ ] **Step 7.4:** `CLAUDE.md` (project) — Quick commands § replace:
  ```
  node scripts/pyr3-023-be-render-4k.mjs <in> <out>
  ```
  with:
  ```
  npm run render -- --preset 4k <in.flam3> <out.png>
  ```
  Also update any inline references to `--quick` (search via `grep -n 'quick' CLAUDE.md`) to mention `--preset quick` or `--preset {quick,4k}` as appropriate.

- [ ] **Step 7.5:** Commit docs.

```bash
git add BACKLOG.md CHANGELOG.md CLAUDE.md ROADMAP.md
git commit -m "v0.20 docs: PYR3-023 closure + ROADMAP/CHANGELOG/CLAUDE.md churn"
```

- [ ] **Step 7.6:** Squash all v0.20 feature-branch commits into a single ship commit (per CLAUDE.md "Squash feature-branch commits before FF-merge when safe"). The branch will have ~7 commits at this point (spec + per-task); squash to one v0.20 ship commit.

```bash
git reset --soft $(git merge-base main HEAD)
git commit -m "$(cat <<'EOF'
v0.20: parity corpus 19→25 + --preset {quick,4k} CLI flag family

Corpus expansion via 3 untapped kotlin goldens (244.00617, 244.42746,
248.23554) + 3 ESF picks from kotlin's v1.0-showcase.txt (electricsheep
.247.08620, .245.07670, .244.59334). Final tier ratio: <update from Task 1>.

CLI: src/presets.ts owns the preset specs. bin/pyr3-render.ts consumes
applyPreset(); legacy --quick flag removed (no stop-gap); both quick
and 4k now go through --preset NAME. scripts/pyr3-023-be-render-4k.mjs
deleted.

4K meta (fixtures/kotlin-4k-refs/meta.json) harmonized — baselineR
renamed to expectedR (mirrors v0.19's 19-fixture schema).

PYR3-023 closes; v0.20 is the final infrastructure ship before v1.0
gate-green check + GitHub repo replacement.

Verify: typecheck + npm test + test:parity (25/25) + test:parity-4k
(5/5) + test:parity-fe-be (25/25) all green.
EOF
)"
```

- [ ] **Step 7.7:** Hand off for user-verify. Surface:
  - branch name + final commit hash + diff stat
  - test gate results
  - eyeball HTML path
  - PYR3-023 closure diff
  - tier ratio change summary

Wait for explicit user ok before FF-merge.

- [ ] **Step 7.8:** FF-merge to main + delete local branch.

```bash
git checkout main
git merge --ff-only feature/pyr3-v020-corpus-expansion
git branch -d feature/pyr3-v020-corpus-expansion
```

---

## Self-Review

**Spec coverage:** Every locked-decision row in the spec maps to a task — corpus expansion (T1), `--preset NAME` family (T2+T3), caller migrations (T4), 4K meta harmonization + script deletion (T5), PYR3-023 closure + docs (T7), user-verify gate (T7).

**Placeholder scan:** The CHANGELOG entry in Step 7.6 carries `<update from Task 1>` for the final tier ratio — this is the only intentional placeholder, filled in at execution time once Task 1 measures actual R values. No other TBDs.

**Type consistency:** `PresetName`, `PresetSpec`, `PRESETS`, `applyPreset`, `isPresetName` are defined in Task 2 and used identically in Task 3. The `FixtureMeta` rename in Task 5 (`baselineR` → `expectedR`) is consistent with the v0.19 19-fixture schema already shipped to main.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-pyr3-v020-corpus-expansion.md`. Two execution options:

**1. Subagent-Driven** — Fresh subagent per task, review between tasks, fast iteration. Tasks 2, 3, 4, 5, 7 are subagent-clean (pure TS / docs); Tasks 1, 6 need lead-inline Bash for flam3-C + npm + git.

**2. Inline Execution (recommended given the session momentum so far)** — Continue lead-inline as in v0.19. Hybrid model: lead drives all Bash-touching tasks (T1, T6, T7's final FF-merge); subagent could be invoked for one of the pure-TS tasks (T2 presets module is the cleanest candidate) if context conservation matters, but session has plenty of room.
