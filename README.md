# 🔥 pyr3 — fractal flame renderer for the web and CLI

**pyr3** (pronounced "pyre") is a TypeScript + WebGPU fractal-flame renderer in the
[flam3](https://github.com/scottdraves/flam3) lineage. **One engine, two consumers:**

- 🌐 **Browser viewer** — Vite + WebGPU + GitHub Pages. Drop a `.flame` file or visit a
  share-link URL; the flame renders in the canvas.
- 💻 **Headless CLI** — Node + `webgpu` npm + `tsx`. `npm run render flame.xml out.png`
  renders the same flame to a PNG using the same TS modules and the same WGSL compute
  shaders.

## Status

🚧 **v0.30 — Fix: flames with >32 xforms no longer render black.** Engine in place (browser + CLI
render from one codebase); both parity rigs green — BE-vs-flam3-C (`npm run
test:parity`, 25/25) and FE↔BE quick-mode (`npm run test:parity-fe-be`, 25/25).
flam3-C is the canonical lineage source of truth. **The hero
`electricsheep.247.19679` renders at R=2.78 vs flam3-C** — well inside the noise
floor.

Recent ships: **v0.30** raised `MAX_XFORMS` 32 → 128 + added a flame-import clamp
guard, fixing the silent black-render of high-xform-count flames (`MAX_XFORMS` buffer
overflow) — `electricsheep.242.01373` (54 xforms) now renders (`[PYR3-033]`); **v0.29** added the **🎯 4K** button — the viewer now renders the current
flame at 3840-long-edge in the browser (~2.7s for the hero), building progressively via the
decoupled display/dispatch orchestrator. This reverses the v0.14 FE-4K removal: the old
crash/slowness was the chunked orchestrator (1887 rAF+present chunks) plus oversample-4;
fat back-to-back dispatches at oversample-1 fix both, with a `maxStorageBufferBindingSize`
guard for GPUs that can't fit a 4K histogram (`[PYR3-027]`); **v0.28** decoupled the chaos splat-scale `oversample` from the genome
(reads the authoritative pipeline config now) and ported flam3's full 701-palette
library as a parser fallback for inline-palette-less flames (`[PYR3-008]` +
`[PYR3-022]`; `[PYR3-004]` variation audit closed 99/99); **v0.27** restored the live `/showcase` gallery (now served as a
deploy-time Release asset, keeping the ~221M of 4K JPEGs out of git) and de-bloated
the repo (`.git` 603M→41M via history rewrite); **v0.26** automated the deploy — pushing to `main` now publishes
`pyr3.app` via GitHub Actions (`actions/deploy-pages`), baking in the corpus chunks
from the electric-sheep-fold Release; **v0.25** scrubbed the codebase of
predecessor-project references ahead of the public repo; **v0.24** added the corpus
share-URL viewer (`pyr3.app/v1/gen/{gen}/id/{id}` loads any Electric Sheep corpus
flame in-browser); **v0.23** rebuilt the viewer's top bar into a single slim row;
**v0.21** shipped the public `/showcase` gallery. Full history in
[CHANGELOG.md](CHANGELOG.md).

The only remaining known outliers — `coverage.248.02226` (R≈29.9) and
`coverage.245.06687` — are accepted GPU-f32-floor (tier-2) fixtures under
`[PYR3-029]`, **not** regressions. v1.0 ships once the `v1.0`
[milestone](https://github.com/MattAltermatt/pyr3/milestones) closes out.

## The contract

Pyr3 renders are **"similar but not the same" as flam3-C** — lineage-respectful, but pyr3
exercises independent judgment where flam3's C-era constraints don't apply. **v1.0 ships
when both the browser and CLI independently render fixtures within R tolerance of flam3-C
golden PNGs.**

## Lineage

pyr3 is an independent TypeScript + WebGPU reimplementation in the **flam3** lineage — the
fractal-flame algorithm of Scott Draves & Erik Reckase. It reads the upstream
[flam3](https://github.com/scottdraves/flam3) C reference renderer (GPL-3.0-or-later) for
algorithmic clarity; flam3-C is its parity ground truth.

See [NOTICE.md](NOTICE.md) for third-party attribution.

## Quick start

```sh
npm install
npm test                  # unit suite only (~1s)
npm run test:parity       # 25-fixture flam3-C parity suite (~90s, needs Dawn WebGPU)
npm run test:all          # unit + parity
npm run dev               # browser viewer at http://localhost:5173/
npm run render fixtures/electricsheep.247.19679.flam3 out.png    # CLI
```

## Verifying parity

The Phase 2 rig compares pyr3 renders against flam3-C goldens via an R-metric
(mean absolute diff, RGB-only) plus per-channel / per-region drift and a
visibility-scaled `diff.png` per fixture.

```sh
npm run test:parity                              # BE path: vitest gates R per fixture
npm run test:parity-fe-be                        # FE↔BE path: headless-WebGPU Playwright rig
open fixtures/flam3-goldens/247.29388/diff.png   # eyeball the divergence map
```

Fixtures live at `fixtures/flam3-goldens/<id>/` — each has `golden.png` (flam3-C
output), `<id>.flam3` (source), and `meta.json` carrying the calibrated tier
contract: `expectedR` (measured R vs flam3-C), `thresholdR` (= `expectedR + 1.0`),
and `tier` (`1` = healthy parity band R<5; `2` = documented GPU-f32-vs-CPU-f64
precision drift). The FE↔BE gate adds `feBeExpectedR` + `feBeThresholdR`.

## Corpus share links

A URL of the form `https://pyr3.app/v1/gen/{gen}/id/{id}`
opens the renderer and loads that exact Electric Sheep corpus flame directly
in the browser. No file upload needed.

**How it works:** the renderer parses the `/v1` path (`src/load-intent.ts`),
fetches the matching same-origin brotli chunk (`/chunks/{gen}/{lo:05d}.flam3chunk`
via `src/chunk-fetch.ts`), and decodes it (`src/brotli.ts`) — natively via
`DecompressionStream("brotli")` on Safari/Firefox, or via a code-split
`brotli-dec-wasm` decoder on Chromium (which has no native brotli stream) —
then hands the extracted flam3 XML to the existing flame-import path. An
availability manifest client (`src/avail.ts`) enables fast dead-link detection
for missing sheep. URLs are base-aware (`import.meta.env.BASE_URL`), so the same
build works at the apex `pyr3.app` and the `mattaltermatt.github.io/pyr3/`
fallback (which redirects to the apex).

The legacy inline `?flame=<encoded>` share-link codec was removed in v0.32
(superseded by the corpus URL above).

The `/v1/gen` and `/v1/gen/{gen}` browse routes are reserved but show
placeholder content — the visual gallery is deferred. Custom-flame sharing
(`/v1/flame/...`) is also deferred.

See [`docs/corpus-share-url.md`](docs/corpus-share-url.md) for the pyr3-side
summary and a pointer to the canonical cross-repo spec.

## Docs & planning

Open work and ship history moved to GitHub in the 2026-05-30 pivot:

- [**Issues**](https://github.com/MattAltermatt/pyr3/issues) — the task registry (labelled by
  type: `feat` · `bug` · `parity` · `chore` · `infra` · `docs` · `test` · `cli` · `perf`)
- [**Milestones**](https://github.com/MattAltermatt/pyr3/milestones) — `v1.0` is the ship gate
  (close every issue in it → tag v1.0); `post-v1` is the deferred backlog
- [**Releases**](https://github.com/MattAltermatt/pyr3/releases) — ship notes, v1.0 onward
- [HISTORY.md](HISTORY.md) — frozen pre-1.0 ship log (v0.0 → v0.36)

In-repo docs:

- [VISION.md](VISION.md) — what pyr3 is and isn't
- [CLAUDE.md](CLAUDE.md) — project notes for the Claude Code agent
- [`docs/corpus-share-url.md`](docs/corpus-share-url.md) — corpus share-URL + chunk delivery (pyr3-side summary)

## License

GPL-3.0-or-later — see [LICENSE](LICENSE) for the verbatim FSF text.
