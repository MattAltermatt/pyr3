# 🔥 pyr3 — fractal flame renderer for the web and CLI

**pyr3** (pronounced "pyre") is a TypeScript + WebGPU fractal-flame renderer in the
[flam3](https://github.com/scottdraves/flam3) lineage. **One engine, two consumers:**

- 🌐 **Browser viewer** — Vite + WebGPU + GitHub Pages. Drop a `.flame` file or visit a
  share-link URL; the flame renders in the canvas.
- 💻 **Headless CLI** — Node + `webgpu` npm + `tsx`. `npm run render flame.xml out.png`
  renders the same flame to a PNG using the same TS modules and the same WGSL compute
  shaders.

## Status

🚧 **v0.0 — project genesis.** No working code yet. See [ROADMAP.md](ROADMAP.md) for the
path to v1.0.

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
# (not working yet — Phase 0 begins next session, see ROADMAP.md)
npm install
npm test
npm run dev    # browser viewer at http://localhost:5173/
npm run render fixtures/welcome.flame out.png    # CLI
```

## Docs

- [VISION.md](VISION.md) — what pyr3 is and isn't
- [ROADMAP.md](ROADMAP.md) — phase plan + shipped table
- [BACKLOG.md](BACKLOG.md) — open task registry (`[PYR3-NNN]` IDs)
- [CHANGELOG.md](CHANGELOG.md) — ship history
- [CLAUDE.md](CLAUDE.md) — project notes for the Claude Code agent
- [`docs/superpowers/specs/2026-05-27-pyr3-design.md`](docs/superpowers/specs/2026-05-27-pyr3-design.md) — v1.0 design spec

## License

GPL-3.0-or-later — see [LICENSE](LICENSE) for the verbatim FSF text.
