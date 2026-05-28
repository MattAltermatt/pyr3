# 🔬 Local flam3-C build — `/Users/matt/dev/sheep/flam3/`

> Bit-level reference for pyr3 ⇄ flam3 single-arm bisection during the
> PYR3-010 variation-arm audit and PYR3-017-class fixture investigations.
> Inherited from prior pyr3-kotlin parity work — the C source itself was
> instrumented for the same bilateral-diff use-case kotlin used.

## Paths

| Path | What |
|---|---|
| `/Users/matt/dev/sheep/flam3/` | Forked + custom-edited flam3-C source (git: `master`, upstream `scottdraves/flam3` at `f8b6c78`) |
| `/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac` | arm64 Mach-O binary, 32-bit float + ISAAC RNG, **no** rngtrace |
| `/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac-rngtrace` | arm64 Mach-O binary, same + `-DRNG_TRACE` build flag enables per-iter bilateral trace |
| `/Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac-rngtrace-v0.9` | Frozen v0.9 reference build (do not modify) |

**Status:** the source tree has uncommitted edits to `flam3.c`, `isaac.h`,
`variations.c`, `rect.c` (plus autoconf-rebuild noise). Do **not** rebuild
without first reviewing the diff against upstream — the existing binaries
are the canonical bit-level reference. If a rebuild is needed, the diff
against upstream is the authoritative spec of what pyr3 expects.

## Invocation

The binary reads a `.flame` XML document from **stdin** and writes a PNG
per genome to **cwd**. Configuration is via **env vars**, not CLI flags
(flam3 convention).

### Basic single-genome render

```bash
cd /tmp
env qs=2 prefix=probe- /Users/matt/dev/sheep/flam3/flam3-render-32bit-isaac \
    < some-single-genome.flame
# writes probe-00000.png
```

### Multi-genome `.flame` files

Some pyr3 fixtures (e.g. `247.29388.flam3`) contain multiple `<flame>`
elements (electric-sheep parent-pair files). flam3-render expects a
`<flames>` root in that case:

```bash
(echo '<flames>'; cat fixture.flame; echo '</flames>') | \
  env qs=2 prefix=probe- .../flam3-render-32bit-isaac
# writes probe-00000.png, probe-00001.png, ...
```

### Known env vars (from `flam3.c` arg-parsing)

- `qs=<N>` — quality scaling factor (lower = faster preview; full quality
  = leave unset or `qs=1`)
- `ss=<N>` — size scaling factor
- `prefix=<str>` — output PNG filename prefix
- `out=<path>` — explicit output path (single render)
- `format=png|jpg` — output format
- `isaac_seed=<str>` — string seed for ISAAC RNG (deterministic across runs)
- `nstrips=<N>` — vertical strips for memory-constrained renders
- `name_enable=0|1` — use genome `<flame name="...">` as filename

### `-rngtrace` build only

- `isaac_seed_hex=<128-hex-chars>` — binary-safe 64-byte randrsl seed. Takes
  precedence over `isaac_seed`. Matches pyr3-kotlin's `Isaac.packIsaacStates`
  PCG32 XSH-RS derivation. **Use this for bit-exact bilateral seed
  alignment with pyr3.**

## Instrumentation channels (6 total)

The custom edits add 6 instrumentation channels for bilateral diff. The
no-rngtrace binary has channels 2–6; the `-rngtrace` binary adds channel 1.

### 1. Per-iter bilateral RNG-trace (`-rngtrace` binary only)

Compiled with `-DRNG_TRACE`. Emits one line per iter to **stderr** for
the first 1000 iters post-fuse (i ≥ 0 && i/4 < 1000):

```
[iter=<N> walker=0 pick=<xf> pax=<f64> pay=<f64> pvx_pre=<f64> pvy_pre=<f64> pvx=<f64> pvy=<f64> isBad=<0|1> draw=<count>]
```

- `pick` — xform-pick from iter top (xform index)
- `pax`/`pay` — affine output / variation input (`variations.c:2171-2173`)
- `pvx_pre`/`pvy_pre` — variation-chain output, post-affine input (`variations.c:2412`)
- `pvx`/`pvy` — final post-postaffine, possibly reseeded (`q[0]/q[1]`)
- `isBad` — bad-value branch fired this iter (1) or not (0)
- `draw` — cumulative ISAAC draw count (matches pyr3's `IsaacState.drawCount`)

All scalars are `%.17g` (signed) for f64-exact round-trip. Mirrors pyr3's
`CpuF64Backend` trace format byte-for-byte.

### 2. Per-variation JSONL dump (always-on, env-gated)

```bash
env FLAM3_DUMP_VARS=/tmp/vars.jsonl ... flam3-render-32bit-isaac
```

Emits one JSONL line per variation invocation to the file:

```json
{"var":"swirl","tx":<f64>,"ty":<f64>,"weight":<f64>,"params":{},"out_x":<f64>,"out_y":<f64>}
```

`out_x`/`out_y` are the **signed delta** the variation contributed to
`(f.p0, f.p1)`, **not** the absolute output. Per-variation contribution
isolation = ideal probe for **PYR3-017** (`248.02226` systematic-brightness
divergence) and PYR3-010 per-arm bisection.

### 3. One-shot palette+scalars JSON

```bash
env PYR3_DUMP_PALETTE=/tmp/palette.json ... flam3-render-32bit-isaac
```

Writes once per render:

```json
{
  "palette": [[r,g,b,a], ... 256 entries ...],
  "gamma": <f64>, "vibrancy": <f64>, "highlight_power": <f64>,
  "background": [r,g,b], "contrast": <f64>, "brightness": <f64>,
  "palette_mode": <int>, "palette_index": <int>
}
```

Use to verify pyr3's `palette.ts` baking pipeline produces the same
post-interpolation 256-RGB table flam3 uses.

### 4. One-shot tonemap coefficients JSON

```bash
env PYR3_DUMP_TONEMAP=/tmp/tm.json ... flam3-render-32bit-isaac
```

Writes once per render:

```json
{
  "k1": <f64>, "k2": <f64>, "gamma": <f64>, "vibrancy": <f64>,
  "highlight_power": <f64>, "contrast": <f64>, "brightness": <f64>,
  "sample_density": <f64>, "oversample": <int>, "nbatches": <int>,
  "sumfilt": <f64>, "width": <int>, "height": <int>,
  "prefilter_white": <int>, "white_level": <int>
}
```

Direct test for pyr3's `calibration.ts` vs flam3's `rect.c:933-937` k1/k2
math. Use to settle PYR3-017's "calibration math ruled out" hypothesis
empirically — render the same fixture, diff k1/k2 between flam3 and pyr3.

### 5. Always-on `[FLAM3-DEBUG]` stderr

Tonemap/calibration scalars printed to stderr each render (formerly behind
`#if 0`, now `#if 1` in `rect.c`):

```
[FLAM3-DEBUG] iw=<W> ih=<H> ppux=<f> ppuy=<f>
[FLAM3-DEBUG] contrast=<f> brightness=<f> PREFILTER=<int> temporal_filter=<f>
[FLAM3-DEBUG] oversample=<int> nbatches=<int> area=<f> WHITE_LEVEL=<int> sample_density=<f> sumfilt=<f>
[FLAM3-DEBUG] k1=<f> k2=<f>
```

Quick eyeball check during interactive probes.

### 6. Always-on `[PYR3-DEBUG] BUCKETS` stderr

Histogram bucket post-chaos stats:

```
[PYR3-DEBUG] BUCKETS sum_r=<i64> sum_g=<i64> sum_b=<i64> sum_alpha=<i64> sum_count=<i64>
[PYR3-DEBUG] BUCKETS nonzero=<int> total_pixels=<int> max_cnt_per_px=<int> mean_cnt_nonzero=<int>
```

Direct test for histogram-bucket parity between pyr3 and flam3 — if pyr3's
post-chaos counts diverge, the chaos game has a state-divergence bug
upstream of tonemap.

## Probe recipes for PYR3-010 / PYR3-017

### Per-arm single-xform probe (PYR3-010)

```bash
# 1. Build a synthetic 1-xform .flame (template: scripts/pyr3-017-probe.ts).
# 2. Render via flam3 with full instrumentation:
env FLAM3_DUMP_VARS=/tmp/flam3-vars.jsonl \
    PYR3_DUMP_PALETTE=/tmp/flam3-palette.json \
    PYR3_DUMP_TONEMAP=/tmp/flam3-tm.json \
    qs=4 prefix=arm- \
  .../flam3-render-32bit-isaac < single-xform.flame
# 3. Render via pyr3 with matching dump points (TBD: pyr3 doesn't yet have
#    matching dump infrastructure — that's a PYR3-019+ scaffold task).
# 4. Diff the JSONL outputs at the variation-contribution granularity.
```

### Bit-exact RNG-aligned iter trace (PYR3-010 hard arms)

```bash
# 1. Pyr3 emits its IsaacState.randrsl as 128 hex chars after seed-derive.
# 2. Pass to flam3 via isaac_seed_hex:
env isaac_seed_hex=<128hex> qs=4 prefix=trace- \
  .../flam3-render-32bit-isaac-rngtrace < single-xform.flame 2> /tmp/flam3-trace.log
# 3. Pyr3 emits a matching per-iter trace in its CpuF64Backend (or a
#    new TS-side trace emit; see "Pyr3-side dump infrastructure" below).
# 4. Diff /tmp/flam3-trace.log vs pyr3-trace.log line-by-line.
#    First diverging field == the load-bearing bug.
```

### Calibration & tonemap parity (PYR3-017 hypothesis re-test)

```bash
env PYR3_DUMP_TONEMAP=/tmp/tm.json qs=2 prefix=p- \
  .../flam3-render-32bit-isaac < .../248.02226.flam3
# Diff /tmp/tm.json's k1/k2 vs pyr3's internal calibration outputs.
# PYR3-017's analytic verification said they should match — this is the
# empirical re-test that closes the hypothesis for good.
```

## Pyr3-side dump infrastructure (PYR3-019+ scaffold)

To consume the flam3 traces above, pyr3 needs symmetric emit points:

- **TS trace** (CPU-equivalent path or trace-mode renderer) — emit matching
  iter-bottom lines with the same 11 fields.
- **`packIsaacStates` parity** — mirror pyr3-kotlin's PCG32 XSH-RS derivation
  so `isaac_seed_hex` bridges flam3 and pyr3 bit-exactly.
- **Per-variation JSONL emit** — mirror channel #2 in `src/chaos.ts` or
  `src/variations.ts`.
- **Palette + tonemap dump** — mirror channels #3 + #4 in
  `src/palette.ts` + `src/calibration.ts`.

This scaffold lives in `[PYR3-019]`+ entries (to be filed during PYR3-010
A.2 fan-out as per-arm probes surface specific dump-channel needs).

## Adjacent: JWildfire at `/Users/matt/dev/sheep/jwildfire-9.00/`

Also present is `jwildfire-9.00/` (Java/WebGL fractal flame editor,
Apophysis-family) with rendered outputs at `jwildfire-renders/`. JWildfire
has its own variation extensions (not all of which are in flam3's 98-arm
set), so it's **not a v1.0-parity reference** — flam3-C is the only
canonical reference for pyr3's ship gate. JWildfire is useful for
authoring/cross-validating .flame files only.

## Lineage commentary

The instrumentation comments embedded in the C source name "pyr3 v0.6 /
v0.7 / v0.9" — these refer to pyr3-kotlin's version history, not this
TS rewrite's. The instrumentation was authored during pyr3-kotlin's
bilateral-diff phase and is reusable here unchanged. See pyr3-kotlin's
`docs/superpowers/v0.9-seed-aligned-iter-diff.md` for the original
design doc (mentioned in `flam3.c:2575+`).
