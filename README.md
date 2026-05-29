# 🔥 pyr3 — fractal flame renderer for the web and CLI

**pyr3** (pronounced "pyre") is a TypeScript + WebGPU fractal-flame renderer in the
[flam3](https://github.com/scottdraves/flam3) lineage. **One engine, two consumers:**

- 🌐 **Browser viewer** — Vite + WebGPU + GitHub Pages. Drop a `.flame` file or visit a
  share-link URL; the flame renders in the canvas.
- 💻 **Headless CLI** — Node + `webgpu` npm + `tsx`. `npm run render flame.xml out.png`
  renders the same flame to a PNG using the same TS modules and the same WGSL compute
  shaders.

## Status

🚧 **v0.27 — `/showcase` gallery live + repo de-bloat (atop v0.26 CI deploy).** Engine in place (browser + CLI
render from one codebase); both parity rigs green — BE-vs-flam3-C (`npm run
test:parity`, 25/25) and FE↔BE quick-mode (`npm run test:parity-fe-be`, 25/25).
flam3-C is the canonical lineage source of truth. **The hero
`electricsheep.247.19679` renders at R=2.78 vs flam3-C** — well inside the noise
floor.

Recent ships: **v0.27** restored the live `/showcase` gallery (now served as a
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
`[PYR3-029]`, **not** regressions. v1.0 ships once the remaining chunks land;
see [ROADMAP.md](ROADMAP.md) and [BACKLOG.md](BACKLOG.md).

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
npm run test:parity       # 19-fixture flam3-C parity suite (~90s, needs Dawn WebGPU)
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
node scripts/fe-parity.ts 247.29388              # FE path: prints chrome-devtools-mcp steps
open fixtures/flam3-goldens/247.29388/diff.png   # eyeball the divergence map
```

Fixtures live at `fixtures/flam3-goldens/<id>/` — each has `golden.png` (flam3-C
output), `<id>.flam3` (source), and `meta.json` carrying calibrated `baselineR`
+ `thresholdR`.

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

Legacy `?flame=<encoded>` share links continue to work unchanged.

The `/v1/gen` and `/v1/gen/{gen}` browse routes are reserved but show
placeholder content — the visual gallery is deferred. Custom-flame sharing
(`/v1/flame/...`) is also deferred.

See [`docs/corpus-share-url.md`](docs/corpus-share-url.md) for the pyr3-side
summary and a pointer to the canonical cross-repo spec.

## Docs

- [VISION.md](VISION.md) — what pyr3 is and isn't
- [ROADMAP.md](ROADMAP.md) — phase plan + shipped table
- [BACKLOG.md](BACKLOG.md) — open task registry (`[PYR3-NNN]` IDs)
- [CHANGELOG.md](CHANGELOG.md) — ship history
- [CLAUDE.md](CLAUDE.md) — project notes for the Claude Code agent
- [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md) — v1.0 design spec
- [`docs/corpus-share-url.md`](docs/corpus-share-url.md) — corpus share-URL + chunk delivery (pyr3-side summary)

## License

GPL-3.0-or-later — see [LICENSE](LICENSE) for the verbatim FSF text.
