# 🔥 pyr3 — fractal flame renderer for the web and CLI

**pyr3** (pronounced "pyre") is a TypeScript + WebGPU fractal-flame renderer in the
[flam3](https://github.com/scottdraves/flam3) lineage. **One engine, two consumers:**

- 🌐 **Browser viewer** — Vite + WebGPU + GitHub Pages. Drop a `.flame` file or visit a
  share-link URL; the flame renders in the canvas.
- 💻 **Headless CLI** — Node + `webgpu` npm + `tsx`. `npm run render flame.xml out.png`
  renders the same flame to a PNG using the same TS modules and the same WGSL compute
  shaders.

## Status

🚧 **v0.23 — v1.0 FE-polish pass in flight (atop v0.22).** Engine in place
(browser + CLI both render from one codebase); all three parity rigs green —
BE-vs-flam3-C (`npm run test:parity`), FE↔BE quick-mode (`npm run
test:parity-fe-be`, 25/25), and the 5-fixture BE 4K showcase
(`npm run test:parity-4k`). flam3-C is the canonical lineage source of truth
(the 2026-05-28 pivot replaced the prior kotlin-v1.1 reference). **The README
hero `electricsheep.247.19679` renders at R=2.78 vs flam3-C** — well inside the
noise floor.

**v0.22** fixed the last v1.0 render blocker (`[PYR3-034]`): `.flame` import
silently dropped underscore-named variations (`radial_blur`, `gaussian_blur`,
`pre_blur`, `super_shape`, `wedge_julia`, `wedge_sph`), so
`electricsheep.243.00171` lost its soft-blue halo — now restored. The same fix
also resolved the 248.22289 4K divergence (R 44.96 → 5.57). The public
`/showcase` gallery shipped in v0.21.

**v0.23** rebuilds the browser viewer's top bar into a single slim row
(wordmark · about · flame name · attribution · centered Open button · WebGPU
status pill · repo link-chips), turns render progress into an on-demand drop-down
detail row, adds a first-paint "dreaming…" cue and a user-facing toast on
`.flame` load failure, removes the Share button (the url-codec + inbound
`?flame=` decoding stay intact, share is being redesigned later), and rebrands
the `help/*.html` pages to "pyr3". This closes the FE-cleanup slice of
`[PYR3-031]` and the FE-facing slice of `[PYR3-032]`.

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

| Repo | What | Status |
|---|---|---|
| 🦁 [**pyr3-kotlin**](https://github.com/MattAltermatt/pyr3) | JVM/Vulkan predecessor (v1.x-E shipped). The mature source of GPU shader fixes, variation arms, parser edge-cases. | Will be archived after this repo passes its v1.0 ship gate. |
| 🪟 [**pyr3-peek**](https://github.com/MattAltermatt/pyr3-peek) | TS + WebGPU browser viewer. Phase 0 copies this wholesale as basis. | Will be archived after this repo passes its v1.0 ship gate. |
| 🦀 **pyr3-rust** | Private archive (Rust core + WASM + React experiment). | Not public. |

See [NOTICE.md](NOTICE.md) for third-party attribution and the full lineage trail.

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

## Docs

- [VISION.md](VISION.md) — what pyr3 is and isn't
- [ROADMAP.md](ROADMAP.md) — phase plan + shipped table
- [BACKLOG.md](BACKLOG.md) — open task registry (`[PYR3-NNN]` IDs)
- [CHANGELOG.md](CHANGELOG.md) — ship history
- [CLAUDE.md](CLAUDE.md) — project notes for the Claude Code agent
- [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md) — v1.0 design spec

## License

GPL-3.0-or-later — see [LICENSE](LICENSE) for the verbatim FSF text.
