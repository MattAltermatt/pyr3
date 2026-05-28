# pyr3 v0.20 — Corpus expansion + `--preset 4k` CLI flag

**Status:** spec (2026-05-28). Implementation plan to follow via
`writing-plans` skill.

## Context

v0.19 (`40d19e1`, shipped 2026-05-28) closed the `[PYR3-029]` precision
arc by accepting the f32 floor and baking tier-1 / tier-2 semantics into
the per-fixture `meta.json` schema. The 19-fixture parity corpus is now
narratively honest about which fixtures sit in the engine-precision-drift
band vs the healthy-parity band.

**v0.20's job: enlarge the parity gate from 19 → 25 fixtures and ship
the `--preset 4k` first-class CLI flag** so v1.0 (the next phase) has
both (a) a regression gate diverse enough to show the tier split as a
deliberate property of the corpus rather than an accident of which 19
fixtures kotlin happened to golden, and (b) a clean CLI seam ready for
batch scripting against multiple render presets in the future.

The public-facing v1.0 showcase gallery (the visual story at
`https://mattaltermatt.github.io/pyr3/v1.0/`) is **explicitly
out-of-scope for v0.20** — that's `[PYR3-007]` (4K-on-click landing
gallery, v1.0) and `[PYR3-013]` (full showcase mirror, post-v1). The
parity gate and the showcase gallery are distinct artifacts with
distinct purposes; v0.20 expands only the gate.

`[PYR3-023]` residual closes here. After v0.20, the only remaining v1.0
work is the ship-gate green check + the GitHub repo replacement.

## Locked decisions (from brainstorm 2026-05-28)

| Decision | Value | Rationale |
|---|---|---|
| Parity corpus target | 19 → 25 | Modest +6 expansion; suite stays ≤ ~120s; tier ratio should land near 18:7 (healthy) |
| 3 new kotlin goldens | `244.00617`, `244.42746`, `248.23554` | Untapped from kotlin's 22-fixture golden set — natural completion |
| 3 new ESF picks | From kotlin's `v1.0-showcase.txt`, excluding fixtures already in pyr3's parity-or-4K set | Cross-purpose with public showcase — parity gate watches "what users will see" |
| CLI flag | `--preset NAME` family; v0.20 ships `--preset 4k` AND `--preset quick` | User-stated reason: future CLI batch scripts run multiple presets; named preset is the extension seam |
| `--quick` top-level flag | **Removed** in v0.20 — migrated to `--preset quick` | No stop-gap: destination shape is the `--preset` family; legacy `--quick` belongs to the pre-v0.20 era. All callers (`src/parity-fe-be.test.ts`, any scripts/docs) migrate in this phase. |
| 4K meta harmonization | `baselineR` → `expectedR` in `fixtures/kotlin-4k-refs/meta.json` | Matches v0.19 schema for the 19-fixture corpus; `tier` already added in v0.19 |
| `[PYR3-023]` status | ✅ resolved (corpus expansion + CLI flag landed in v0.20) | Closes the residual since the BE 4K parity rig is now first-class |
| Wrapper script | `scripts/pyr3-023-be-render-4k.mjs` deleted | First-class flag supersedes it — keeping both is a footgun |

## Scope (everything in v0.20)

### 1. Parity corpus 19 → 25

**The 3 untapped kotlin goldens.** Lift directly from
`/Users/matt/dev/MattAltermatt/pyr3-kotlin/parity/goldens/` per the
v0.8 pattern (`244.00617`, `244.42746`, `248.23554`). For each:

- Copy `.flam3` source from kotlin's `parity/src/test/resources/<id>.flam3`
  (or `parity/goldens/<id>/<id>.flam3` if mirrored)
- Render new flam3-C golden via `scripts/regen-flam3c-goldens.mjs
  --fixtures=244.00617,244.42746,248.23554`
- Auto-write meta.json (v0.19 schema) via the regen script's tier-aware
  branch
- Each fixture's R determines its tier

**The 3 new ESF picks.** Selection rule: take kotlin's
`v1.0-showcase.txt`, exclude any fixture already in pyr3 (the 19
parity + 5 4K showcase), pick 3 that span the brightness band (one
from each of br < 10, br 10-20, br > 20 if feasible — checked at
selection time by parsing each candidate's `.flame` brightness
attribute). Candidates from the kotlin list (pre-checked):

- `electricsheep.247.08620` — br= TBD at impl-time
- `electricsheep.245.07670` — br= TBD
- `electricsheep.244.59334` — br= TBD
- (alternates if any of the above have undesirable traits: `248.13972`,
  `247.44220`, `245.04339`, `244.84478`, `243.10218`)

For each pick: copy `.flam3` from
`/Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/<sheep>/<bucket>/<file>`
into `fixtures/flam3-goldens/<id>/<id>.flam3`. Run the regen script.
Inspect the produced R + tier. If a pick lands the tier ratio outside
~17:8 to ~19:6, swap with an alternate.

**Acceptance:** 25 fixtures in `fixtures/flam3-goldens/`; each has
`golden.png` + `meta.json` (v0.19 schema with `expectedR`, `thresholdR`,
`tier`, optional `notes`); `npm run test:parity` runs 25 fixtures green
in ≤ ~150s wall.

### 2. `--preset NAME` CLI flag family on `bin/pyr3-render.ts`

New CLI surface:

```text
bin/pyr3-render.ts [options] <input.flame> <output.png>

Options:
  --preset NAME           Named preset bundle. Supported in v0.20: quick, 4k
  --max-dim N             Cap long-edge to N px (conflicts with --preset)
  --sample-inflate F      Multiply per-walker sample count by F (existing)
  ... (other existing flags unchanged)
```

**Two presets ship in v0.20.** Both go through the same `--preset NAME`
extension seam:

| Preset | Long-edge | quality | oversample | Notes |
|---|---|---|---|---|
| `quick` | 1024 | low (matches FE QUICK_MAX_SPP) | 1 | Replaces the v0.19 `--quick` top-level flag |
| `4k` | 3840 | 200 (full single-pass) | 1 | Mirrors kotlin's `Preset.SHOWCASE_4K` |

**`--quick` legacy flag is REMOVED in v0.20.** No stop-gap: the
destination is the `--preset` family. All callers migrate:

- `src/parity-fe-be.test.ts` (line ~161) — `'--quick'` →
  `'--preset', 'quick'`
- `bin/pyr3-render.ts` argv parsing — drop the `--quick` branch
- README / CLAUDE.md / any docs referencing `--quick` — update to
  `--preset quick`

Conflict handling: `--preset 4k --max-dim 4096` errors out cleanly
("`--preset` already sets long-edge"). `--preset` with an unknown
name errors with a list of valid presets.

The rescale math lives in a new `src/presets.ts` module exporting
something like:

```ts
export type PresetName = 'quick' | '4k';
export interface PresetSpec {
  maxDim: number;
  quality: number;
  oversample: number;
}
export const PRESETS: Record<PresetName, PresetSpec> = {
  quick: { maxDim: 1024, quality: ..., oversample: 1 },
  '4k':  { maxDim: 3840, quality: 200, oversample: 1 },
};
export function applyPreset(genome: Genome, preset: PresetSpec): Genome { ... }
```

`bin/pyr3-render.ts` imports `applyPreset` and uses it identically for
both presets. The 4K-specific flame-rewrite helper inside
`scripts/pyr3-023-be-render-4k.mjs` is the source — port it generically
into `applyPreset`. The wrapper script is deleted.

`parity-4k.test.ts` invocation updates: change `spawnSync('node',
['scripts/pyr3-023-be-render-4k.mjs', ...])` to `spawnSync('node',
[...tsxImports, 'bin/pyr3-render.ts', '--preset', '4k', ...])`. Same
output bytes expected (no behavior change — pure refactor of the
invocation seam).

`parity-fe-be.test.ts` invocation updates: change `'--quick'` to
`'--preset', 'quick'`. Same output bytes expected.

### 3. 4K meta field harmonization

`fixtures/kotlin-4k-refs/meta.json` — schema migration mirror of v0.19's
work on the 19-fixture corpus:

```json
{
  "_comment": "v0.20 (2026-05-28): expectedR rename. ...",
  "fixtures": {
    "<id>": {
      "expectedR": ...,    // was baselineR
      "thresholdR": ...,
      "tier": 1 | 2,        // already present from v0.19
      "notes": "..."        // tier-2 only, already present from v0.19
    }
  }
}
```

Update `src/parity-4k.test.ts` interface — `baselineR` → `expectedR`.

### 4. `[PYR3-023]` BACKLOG closure

Header changes from `gpu · M · 🪨 · queued · v1.x` to `gpu · M · ✅
resolved (corpus expansion + --preset 4k landed in v0.20)`. Prepend
closure paragraph. BE 4K parity rig is now first-class infrastructure;
no residual work remains for the v1.0 ship gate beyond the v1.0 gate
green check itself.

### 5. Documentation churn

- `BACKLOG.md` — `[PYR3-023]` closure (above)
- `ROADMAP.md` — v0.20 row past-tense after ship; "Next phases" collapses
  to 1 (v1.0 ship)
- `CHANGELOG.md` — new v0.20 entry naming corpus expansion + CLI flag +
  PYR3-023 closure
- `CLAUDE.md` (project) — Quick commands § update:
  `node scripts/pyr3-023-be-render-4k.mjs` → `npm run render -- --preset 4k`
  (or equivalent direct CLI form)

## Out of scope (explicit)

- **Showcase gallery** (`[PYR3-007]` / `[PYR3-013]`) — separate v1.0
  ship-gate item / post-v1 work
- **HD / thumb / social presets** — YAGNI until a CLI batch script
  actually needs them. The `--preset NAME` seam supports them when
  the time comes; no scaffolding shipped early
- **Showcase URL scrape** — the `mattaltermatt.github.io/pyr3/v1.0/`
  URL is the v1.0 showcase reference for `[PYR3-007]`, not for v0.20
- **PYR3-022** (default-palette fallback parser gap) — not v0.20

## Verification

1. **Corpus expansion** — `scripts/regen-flam3c-goldens.mjs
   --fixtures=<the-6-new-ids>` renders + measures each new fixture.
   Spot-check tier distribution lands at ~18:7 or 17:8.
2. **`--preset 4k` parity** — render `electricsheep.247.19679.flam3` via
   the new flag; byte-compare PNG output against the pre-v0.20
   `scripts/pyr3-023-be-render-4k.mjs` output. Must match (or differ
   only in PNG metadata).
3. **`--preset quick` parity** — render any 19-fixture corpus member via
   the new flag with the pre-v0.20 `--quick`; byte-compare. Must match.
4. **`npm run test:parity`** — 25/25 green in ≤ ~150s; tier-2 fixtures
   pass at `expectedR + 1.0`.
5. **`npm run test:parity-4k`** — 5/5 green via the new `--preset 4k`
   path (interface rename + invocation seam swap).
6. **`npm run test:parity-fe-be`** — 19/19 (or 25/25 once corpus expands)
   green via the new `--preset quick` path. ~10 min wall.
7. **`npm run typecheck`** + **`npm test`** — green.
8. **User-verify** — eyeball gallery at
   `.remember/verify/v0.20-corpus-expansion.html` showing the 6 new
   fixtures side-by-side (flam3-C golden / pyr3 BE render / diff). Hand
   off; wait for ok before FF-merge.

## What this does NOT do

- **No engine changes** — v0.20 is corpus + CLI seam only.
- **No tier rule change** — `expectedR ≥ 5.0` cutoff inherited from v0.19.
- **No 4K threshold recalibration** — the 5 existing 4K showcase fixture
  thresholds (calibrated 2026-05-27, `round(expectedR + 2.0)`) stay.
  Field rename is mechanical.
- **No new PYR3 IDs filed** in this spec. If the corpus-expansion picks
  surface unexpected behavior, a new ID gets filed at impl time.

## Open implementation choices (defer to plan, not blocking)

These are tactical, not load-bearing — locked at plan-writing time:

- **`src/presets.ts` exact shape** — `applyPreset(genome, preset)` returns
  a new genome vs mutates in place? Match existing engine convention.
- **`--preset` flag parsing** — minimist's default vs hand-roll? Existing
  `bin/pyr3-render.ts` uses one or the other; match existing pattern.
- **What the OLD `--quick` did exactly** — read the impl at plan time so
  the `quick` preset spec matches byte-for-byte (long-edge, quality
  numbers, oversample, SPP).
- **Test ordering** — 25 fixtures alphabetical (current convention) or
  tier-first? Keep alphabetical (less surprising).
