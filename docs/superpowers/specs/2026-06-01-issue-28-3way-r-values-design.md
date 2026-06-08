# #28 — 3-way parity: programmatic R values (no HTML)

**Date:** 2026-06-01
**Status:** Approved (brainstorm Q&A, 2026-06-01)
**Tracking:** GitHub issue [#28](https://github.com/MattAltermatt/pyr3/issues/28)

## Problem

The pre-release FE↔BE parity rig (`src/parity-fe-be.test.ts`) computes `R(FE, BE)` per fixture but doesn't surface `R(FE, golden)` or `R(BE_quick, golden)`. When a parity divergence appears, the geometry of disagreement (which engine drifted from flam3-C, where the two pyr3 engines disagree) requires manually pulling data from multiple sources.

Original issue framing called for a 6-column HTML grid showing all three pairings. User pivoted (brainstorm, 2026-06-01): "if there are issues, it makes sense to build custom HTMLs for the issue." Default flow should be programmatic — surface the R values, build investigation HTMLs ad-hoc only when something looks anomalous.

## Decision

Extend `parity-fe-be.test.ts` to compute two additional R values per fixture and surface them in:
1. The existing per-fixture `console.log` line.
2. The existing JSONL output at `.remember/tmp/pyr3-026-results.jsonl`.
3. A new sorted summary table printed at end of sweep (top-10 most-divergent fixtures).

No HTML. No new npm script. No new diff PNGs. No new gated thresholds — the new R values are record-only.

## Implementation

In `src/parity-fe-be.test.ts`, inside the per-fixture `it()` block, after `feRgba` and `beRgba` are decoded:

```ts
// #28: load golden + downscale to FE quick-mode dims, compute the 3-way R values.
const goldenPng = PNG.sync.read(readFileSync(join(fixture.dir, 'golden.png')));
const goldenNativeRgba = new Uint8Array(
  goldenPng.data.buffer, goldenPng.data.byteOffset, goldenPng.data.byteLength,
);
const goldenQuickRgba = goldenPng.width === w && goldenPng.height === h
  ? goldenNativeRgba
  : nearestDownscale(goldenNativeRgba, goldenPng.width, goldenPng.height, w, h);

const R_FE_g = meanAbsDiffRgba(feRgba, goldenQuickRgba);
const R_BE_g = meanAbsDiffRgba(beRgba, goldenQuickRgba);
```

`nearestDownscale` is the same helper used by `scripts/pyr3-018-fe-collect.ts`. Extract it into a shared util at `src/diff-image.ts` and import from both call sites.

Per-fixture log line grows:
```
[fixture] R(FE,BE)=X.XX  R(FE,g)=Y.YY  R(BE,g)=Z.ZZ  perChannel(...)  perRegion(...)  diff→ ...
```

JSONL record grows two fields:
```json
{ "fixture": "...", "R": X, "R_FE_golden": Y, "R_BE_golden": Z, ... }
```

In `afterAll()` (or a new top-level summary block at the end of `describe`), read back the JSONL, sort by `max(R, R_FE_golden, R_BE_golden)` descending, and `console.log` a tidy ASCII table of the top 10.

## Gates

No new gates. `R_FE_golden` and `R_BE_golden` are record-only. If they prove useful over time, a future issue can add thresholds + a re-calibration sweep (mirrors #35 → #62 mechanism → sweep).

The existing `feBeThresholdR` gate on `R(FE,BE)` is unchanged.

## What's NOT included

- No HTML verify page (user-pivoted away).
- No new diff PNGs (`fe-vs-golden.png`, `be-vs-golden.png` — not generated).
- No npm script (`verify:3way` — not added).
- No `--3way` flag — always on (cheap addition, 2 extra R computes per fixture).

If a future investigation needs visual artifacts, write a one-off
`.remember/verify/<slug>.html` targeted at the specific divergence.

## Testing

The existing per-fixture invariants stay (`expect(R).toBeGreaterThanOrEqual(0)`, `feBeThresholdR` gate honored).

`R_FE_golden` and `R_BE_golden` are just additional numbers in the log — no new test invariants needed unless one looks suspicious during the next sweep.

Verify the mechanism via `npm run test:fe-be-smoke` (3 fixtures, ~135s).

## Spec self-review

- No placeholders / TBDs.
- Internally consistent: data flow (per-fixture compute → log → JSONL → summary) is linear.
- Scope tight: 1 source file change + 1 shared util extraction.
- No ambiguity: golden gets downscaled when dims differ; summary sorts by max R across the 3 pairings.
