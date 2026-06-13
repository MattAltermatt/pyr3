# pyr3

> Fractal flames in your browser — and on the command line.

<p align="center">
  <a href="https://pyr3.app"><img src="docs/assets/hero.jpg" alt="A pyr3-rendered fractal flame — amber and crimson lattice on black" width="100%"></a>
</p>

<p align="center">
  <b><a href="https://pyr3.app">▶&nbsp; Open the viewer</a></b>
  &nbsp;·&nbsp;
  <b><a href="https://pyr3.app/showcase">🖼&nbsp; Browse the gallery</a></b>
</p>

**pyr3** (say "pyre") renders *fractal flames* — the glowing, organic shapes of the
[Electric Sheep](https://electricsheep.org/) screensaver — live in your browser using your
GPU. Nothing to install: open a flame, render it in 4K, and arrow-key through the flock of
52,000+ sheep. The same engine also runs headless on the command line.

**No code required — just click a link above:**

- ▶ **[Open the viewer](https://pyr3.app)** — a live flame paints instantly; tap a quality
  tier (up to **4K, in the browser**) to render it sharper, or drop into the Electric Sheep
  corpus and press **← / →** (or the `‹ prev` / `next ›` buttons) to roam 52,000+ flames.
- 🖼 **[Browse the gallery](https://pyr3.app/showcase)** — a wall of rendered flames to scroll.
- 🎛 **[Edit a flame](https://pyr3.app/v1/edit)** — visual editor: xforms (decomposed
  scale / rotation / position), affine + post-affine, the full **314-variation catalog** — the
  99 flam3 core variations, **JWildfire / Apophysis expansions** (folds, attractors,
  cartographic warps), and pyr3's own **direct-color (DC) family** (`dc_linear` · `dc_perlin` ·
  `dc_gridout` · `dc_cylinder`) — plus palette picker, undo/redo, name templates, save to
  `.pyr3.json`.
- 🎨 **[Design a palette](https://pyr3.app/v1/gradient)** — a standalone gradient editor: drag
  color stops (linear / smooth / step interpolation), recolor via an HSV picker, reverse /
  mirror / rotate / invert-luminance transforms, save to a personal library, and import/export
  `.pyre-palette.json` files.
- 🎬 **[Animate a flame](https://pyr3.app/v1/animate)** — keyframe interpolation, per-xform
  motion, temporal-sampling motion blur, and a playback scrubber; export the sequence to frames.
- 📺 **[Run as a screensaver](https://pyr3.app/v1/screensaver)** — build-up mode (watch one
  flame paint over a minute) or slideshow mode (prefetch + crossfade through the corpus).
  Press **R** to record any session to `.webm`.

> Needs a WebGPU-capable browser — Chrome/Edge 113+, Safari 18+ (macOS Sequoia), or Firefox
> Nightly. If yours can't, the viewer says so and points you to a fix.

---

The rest of this page is for **running and building pyr3 yourself**.

## One engine, two consumers

pyr3 is a single TypeScript + WebGPU renderer with two front ends sharing the exact same
engine modules and WGSL compute shaders — no second code path, no environment branching:

- 🌐 **Browser viewer** — Vite + WebGPU, deployed to GitHub Pages at
  [pyr3.app](https://pyr3.app). Open any Electric Sheep / flam3 `.flame` file (unsupported
  variations are flagged in an import report), browse the corpus by share-link, and render
  from a fast preview up to 4K. The top bar shows the version, the flame's variation set, and
  prev/next navigation.
- 💻 **Headless CLI** — Node + the `webgpu` npm package. `npm run render flame.flam3 out.png`
  renders the same flame to a PNG using the same modules and shaders as the browser.

## Run it locally

```sh
npm install
npm run dev                 # browser viewer at http://localhost:5173/
npm test                    # unit suite (~2s)
```

## Render from the command line

```sh
# render at the flame's native dimensions
npm run render fixtures/electricsheep.247.19679.flam3 out.png

# fast preview (1024px long edge, capped quality) — matches the viewer's quick mode
npm run render -- --preset quick fixtures/electricsheep.247.19679.flam3 preview.png

# full 4K showcase render (3840px long edge)
npm run render -- --preset 4k fixtures/electricsheep.247.19679.flam3 hero-4k.png
```

### Build a standalone binary (optional)

To skip the `npm run render --` dance and the tsx startup cost, build a
self-contained executable. This matches the **flam3 convention** (ship
source, user builds locally):

```sh
npm run build:cli render    # → ./build/pyr3-render (~155 MB, one-time)
```

The first build downloads an official Node 26 runtime to `~/.cache/pyr3/`
if the host Node doesn't ship the SEA fuse sentinel (notably Homebrew's
Node, which strips it). Subsequent builds reuse the cached runtime.

Same commands, shorter form:

```sh
./build/pyr3-render fixtures/electricsheep.247.19679.flam3 out.png
./build/pyr3-render --preset quick fixtures/electricsheep.247.19679.flam3 preview.png
./build/pyr3-render --preset 4k    fixtures/electricsheep.247.19679.flam3 hero-4k.png
```

Or put it on `$PATH`:

```sh
ln -s "$PWD/build/pyr3-render" ~/.local/bin/pyr3-render
pyr3-render fixtures/electricsheep.247.19679.flam3 out.png   # works from anywhere
```

The binary bundles the Dawn-node WebGPU binding as a SEA asset and extracts
it to `~/.cache/pyr3/dawn-<sha>.node` on first launch (~150ms one-time;
subsequent runs hit the cache). Upgrade with `git pull && npm run build:cli
render`. Animation shipped in v1.6.0: render frames headlessly with
`npm run animate` (tsx) or the bundled `pyr3 serve` backend + `/api/animate`
route — the headless companion to the browser's `/v1/animate` editor. The
editor's timeline mode (build a sequence of key flames, then 📤 Export sequence)
renders the whole timeline to a PNG frame sequence through the same backend (#227).

**Platform status (as of v1.7):**

```text
darwin-arm64    verified end-to-end
darwin-x64      code-paths shared with arm64; untested live
linux-x64       code-reviewed clean; untested live (see issue #126)
linux-arm64     code-reviewed clean; untested live (see issue #126)
win32-x64       not implemented (Mach-O / ELF only)
```

See [CLAUDE.md](CLAUDE.md#quick-commands) for the full command list (parity rigs, typecheck,
benchmarks).

## Parity & the contract

pyr3 renders are **"similar but not the same" as flam3-C** — lineage-respectful, but pyr3
exercises independent judgment where flam3's C-era constraints don't apply. **v1.0 shipped
when both the browser and CLI independently rendered fixtures within R-tolerance of flam3-C
golden PNGs.** Both gates pass on the curated 26-fixture corpus:

```sh
npm run test:parity         # BE: each render gated against its flam3-C golden (~90s, needs Dawn WebGPU)
npm run test:parity-fe-be   # FE↔BE: headless-WebGPU Playwright rig, browser vs CLI
```

Each fixture in `fixtures/flam3-goldens/<id>/` carries `golden.png` (flam3-C output), the
source `.flame`, and a `meta.json` with the calibrated tier contract: `expectedR` (measured R
vs flam3-C), `thresholdR` (`= expectedR + 1.0`), and `tier`. **22 of 26 fixtures** sit in the
**tier-1** healthy band (R < 5). The 4 **tier-2** fixtures (R ≥ 5) have **non-jitter,
per-fixture residuals** — each tracked individually rather than as a class. The widest
remaining fixture, `electricsheep.244.82986`, renders at R ≈ 8.9. The historical
chaos-game spatial-diffuseness story was retired in
[#43](https://github.com/MattAltermatt/pyr3/issues/43) (2026-06-02), which replaced the
static walker-jitter amplitude with a scale-relative proportional factor; this dropped
`248.23554` from R ≈ 11 to R ≈ 6.4 without per-fixture tuning. The remaining tier-2
residuals were unchanged by the rework, which is the empirical proof their divergence is
upstream of the chaos-game perturbation.

## Lineage

pyr3 is an independent TypeScript + WebGPU reimplementation in the **flam3** lineage — the
fractal-flame algorithm of Scott Draves & Erik Reckase. It reads the upstream
[flam3](https://github.com/scottdraves/flam3) C reference renderer (GPL-3.0-or-later) for
algorithmic clarity; flam3-C is its parity ground truth. See [NOTICE.md](NOTICE.md) for
third-party attribution.

## Docs & planning

Open work and ship history live on GitHub (since the 2026-05-30 pivot):

- [**Issues**](https://github.com/MattAltermatt/pyr3/issues) — the task registry, labelled by
  type (`feat` · `bug` · `parity` · `chore` · `infra` · `docs` · `test` · `cli` · `perf`)
- [**Milestones**](https://github.com/MattAltermatt/pyr3/milestones) — themed arcs; the
  `v1.0` → `v1.7` line shipped (latest `v1.7.0`, the More Variations Marathon — 33 novel
  variations across 11 families, growing the catalog to 310). Active themed work groups around
  **Apophysis and JWildfire** (gradient editor #115), **More variations** (larger novel families),
  **Binary distribution** (cross-platform verify #126), **Animation** (follow-ons), and
  **Mobile rework** (#66)
- [**Releases**](https://github.com/MattAltermatt/pyr3/releases) — ship notes, v1.0 onward
- [HISTORY.md](HISTORY.md) — frozen pre-1.0 ship log (v0.0 → v0.36)

In-repo docs: [VISION.md](VISION.md) (what pyr3 is and isn't) ·
[CLAUDE.md](CLAUDE.md) (agent + contributor notes) ·
[`docs/corpus-share-url.md`](docs/corpus-share-url.md) (the share-link + chunk-delivery design).

## License

GPL-3.0-or-later — see [LICENSE](LICENSE) for the verbatim FSF text.
