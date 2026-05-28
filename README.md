# 🔥 pyr3 — fractal flame renderer for the web and CLI

**pyr3** (pronounced "pyre") is a TypeScript + WebGPU fractal-flame renderer in the
[flam3](https://github.com/scottdraves/flam3) lineage. **One engine, two consumers:**

- 🌐 **Browser viewer** — Vite + WebGPU + GitHub Pages. Drop a `.flame` file or visit a
  share-link URL; the flame renders in the canvas.
- 💻 **Headless CLI** — Node + `webgpu` npm + `tsx`. `npm run render flame.xml out.png`
  renders the same flame to a PNG using the same TS modules and the same WGSL compute
  shaders.

## Status

🚧 **v0.17 — Phase 3, both v1.0 ship-gate infrastructure wired.** Engine in place
(browser + CLI both render); three parity rigs green: 19-fixture BE-vs-flam3-C
(`npm run test:parity`), 19-fixture FE↔BE quick-mode (`npm run test:parity-fe-be`,
v0.15), and 5-fixture BE-vs-kotlin-v1.1 SHOWCASE_4K (`npm run test:parity-4k`,
v0.17). **The README hero `electricsheep.247.19679` renders at R=2.78 vs kotlin
v1.1 4K** — well inside the noise floor. 4/5 of the showcase set ship cleanly;
one outlier (248.22289 at R=44.96) is blocked on `[PYR3-029]` chaos-walker-
coverage parity audit, which is also the resolution path for the long-standing
PYR3-017/021/024 cluster (Phase C investigator ruled out palette/tonemap/density
empirically; root cause located in the chaos game itself). v1.0 ships when
PYR3-029 lands and the showcase set expands to ~20-50 fixtures. See
[ROADMAP.md](ROADMAP.md) and [BACKLOG.md](BACKLOG.md#pyr3-029).

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
