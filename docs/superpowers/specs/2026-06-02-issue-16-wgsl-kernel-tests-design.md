# Issue #16 — WGSL kernel test coverage + PYR3-029 RNG regression suite

**Status:** design approved 2026-06-02
**Branch:** `feature/issue-16-wgsl-kernel-tests`
**Milestone:** v1.4 - render improvements
**Type/size:** test · size/L
**Spun off from #16's original scope:** #70 (`loadInFlight` extract), #71 (BE parity rig in CI)

## Problem

The 4,116 variation tests in `npm test` validate the **TypeScript reference** impls (`ts_var_*`
in `src/variations.ts`), but production renders the **WGSL port** in `src/shaders/chaos.wgsl`,
which no fast test executes — `chaos.test.ts` drives the dispatch path through a mock device
that no-ops `dispatchWorkgroups`, so the WGSL kernel never runs. The only existing catch for a
WGSL regression (sign flip, wrong param index, re-introduced PYR3-029 RNG bug) is the parity
rig, which is gated behind `VITEST_INCLUDE_PARITY=1` and not run in CI (#71). The
`src/variations.ts:340` comment documents the intended "Layer 3" WGSL-vs-reference assertion
as *planned*.

This issue closes the gap for the four load-bearing PYR3-029 RNG behaviors specifically.

## Resolved enumeration — the four PYR3-029 RNG behaviors

| # | Behavior | Location | Why it matters |
|---|----------|----------|----------------|
| 1 | Masked 28-bit rand transforms `rand01` / `rand_11` use `(raw & 0x0FFFFFFF)` before scaling, NOT the prior full-32-bit divide | `src/shaders/chaos.wgsl:248-269` | Without the mask, same ISAAC state produced different transformed values → exponential trajectory divergence after a handful of iters. Was the root cause of `coverage.248.02226` / `coverage.245.06687`. |
| 2 | Random color seed at fuse start: `init_z = rand01(walker_id)` (NOT 0.0 from the earlier mis-fix) | `src/shaders/chaos.wgsl:1602-1605` | The earlier Phase 5 "RNG-alignment fix" cited the bounding-box estimator path; the real render path (rect.c:393-397) seeds color randomly. With color=0 and color_speed=0, every hit deposits palette[0] (dark end) → image ~10× too dim. Regressed GH #3 / `electricsheep.248.23585`. |
| 3 | Table-driven xform-pick distribution `fn = xform_distrib[lastxf*GRAIN + (irand & GRAIN_M1)]`, GRAIN=16384 — replaces weighted-scan | `src/genome.ts:415 packXformDistrib` + `src/shaders/chaos.wgsl:1638-1640` | The prior weighted-scan used 28-bit irand precision vs flam3's 14-bit table-index, so given the same RNG state the two engines picked wholly different xform sequences. Was the dominant lever for `coverage.248.02226` / `coverage.245.06687` spatial-coverage gap. |
| 4 | Bad-value reseed uses `rand_11` (symmetric [-1,1]), not `rand01` | `src/shaders/chaos.wgsl:1717-1719` | Matches flam3 `variations.c:2455-2456`. Without it, NaN/extreme-value reseeds biased toward the positive quadrant, contaminating the histogram on pathological xforms. |

Phase 5b's per-iter trace emission is diagnostic infrastructure (walker-0 trace gate) and is
explicitly NOT a render behavior — out of scope for this regression suite.

## Approach

Mirror the proven `*.gpu.test.ts` pattern from `src/chaos-saturate.gpu.test.ts` (#18):

1. Extract the WGSL function source verbatim from `src/shaders/chaos.wgsl` via a brace-balanced
   regex pull. (The existing `chaos-saturate.gpu.test.ts:36` does this inline; we extract it
   into a shared helper.)
2. Build a minimal compute pipeline that wraps just that function plus a tiny `@compute` driver
   `main`.
3. Run on real Dawn via `webgpu` npm inside `describe.skipIf(!device)` so the test no-ops cleanly
   on a GPU-less host (Ubuntu CI stays green; local Mac runs them green by default).
4. Tolerance: bit-exact for integer math (rand transforms, xform-pick indices); f32 epsilon for
   any float-bearing assertion.

The alternative — port each WGSL fn to TS and assert TS-vs-WGSL within tolerance (the full
"Layer 3" envisioned in `variations.ts:340`) — is a much larger work item that would expand
this issue to cover all 100+ variations. **Deferred** as a follow-up issue if/when it's
prioritized.

## Coverage targets

This issue covers the RNG/structural kernels which are the load-bearing path for the four
PYR3-029 behaviors. Variation kernels (the `apply_variation` switch entries) are explicitly
out of scope — they are the Layer 3 follow-up.

| # | Behavior | Test |
|---|----------|------|
| 1 | Masked rand transforms | Extract `rand01` + `rand_11` + the ISAAC helpers they depend on. Seed a known ISAAC state, draw N values, assert exact transformed outputs match the flam3 formulas (`((masked) - 0x7FFFFFF) / 134217727.0` for `rand_11`; `masked / 268435455.0` for `rand01`). |
| 2 | Random color seed at fuse start | Dispatch a 1-walker, 1-iter `chaos.wgsl::main` with `fuse=0` and `trace_mode=1`. Read back the trace buffer. Assert `init_z` is in `[0, 1]` (NOT exactly 0), and the ISAAC draw order matches flam3 (x → y → color, i.e. trace[2] uses the third masked rand value, not the first). |
| 3 | Table-driven xform-pick distribution | Pure-TS test (no GPU): build a hand-crafted Genome (2 xforms, known weights, optional xaos row), call `packXformDistrib(genome)`, assert the resulting `Uint32Array` exactly matches a hand-computed cumulative-scan reference for the no-xaos case AND for a 2-row xaos case. A GPU smoke (one `it()` in the `.gpu.test.ts`) seeds a known ISAAC state, dispatches 1 walker × 1 iter against a 2-xform genome with a uniform distribution table, reads the trace buffer, and asserts the picked `fn_idx` matches `xform_distrib[0*GRAIN + (irand & GRAIN_M1)]` for the known first irand draw. |
| 4 | Symmetric bad-value reseed | Build a test kernel that simulates the bad-value path: write a known NaN into `pv` for walker 0, run a single tick of the reseed branch (extracted from `chaos.wgsl:1711-1723`), read back. Assert both reseeded components are in `[-1, 1]` and bit-exact equal to `rand_11(walker_id)` applied twice against the test's known ISAAC state. |

## File layout

```text
src/shaders/extract.ts                ← new — reusable WGSL fn-extraction helper
src/shaders/extract.test.ts           ← new — helper unit tests
src/chaos-rng.gpu.test.ts             ← new — PYR3-029 #1, #2, #4 (real Dawn)
src/chaos-xform-pick.test.ts          ← new — PYR3-029 #3 (pure-TS golden)
src/chaos-saturate.gpu.test.ts        ← MODIFIED (drive-by) — use shared extractor
```

Two new test files, named for their scope. Both picked up by `npm test`; the `.gpu.test.ts`
file no-ops on Ubuntu CI via `describe.skipIf(!device)`. The shared `extract.ts` replaces the
ad-hoc regex in `chaos-saturate.gpu.test.ts:36` (small drive-by cleanup, scoped).

The CLAUDE.md mention of `spatial-filter.wgsl` is stale — no such file exists in
`src/shaders/`. Drive-by doc fix queued for the final commit.

## Acceptance / done-when

- Each of the four PYR3-029 RNG behaviors has a named regression test that fails on
  reintroduction of the original bug (verified by hand-reverting each fix on a scratch branch
  and watching the test go red).
- All new tests no-op cleanly when no GPU adapter is present:
  - Ubuntu CI stays green
  - Local Mac runs them green by default
- Total wall-clock impact on `npm test`: target < 5s additional (existing
  `chaos-saturate.gpu.test.ts` adds ~1.5s locally).
- Issue body / CLAUDE.md "Verification expectations" updated to reflect the now-named
  coverage gate.

## Out of scope (filed as separate issues)

- #70 — `loadInFlight` extract + sequencing regression tests
- #71 — run BE parity rig in CI
- *Layer 3 variation-kernel coverage* — to be filed if/when prioritized; would extend the
  same `*.gpu.test.ts` pattern to each `apply_variation` switch arm

## Pairs with

- #18 — the precedent (`chaos-saturate.gpu.test.ts`); we extend its pattern
- `variations.ts:340` — the "Layer 3" comment documenting the WGSL-vs-reference vision
- PYR3-029 commit history — fixes shipped 2026-05-28; the four behaviors above are extracted
  verbatim from the code comments at the cited lines
