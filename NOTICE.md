# pyr3 — third-party attribution

pyr3 is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE) for the verbatim FSF
text. This file enumerates third-party content that ships in the repo alongside the pyr3
source, with per-item license and attribution.

The pyr3 *source code* is independent reimplementation; we read flam3 C as a reference but do
not vendor or copy it. Algorithmic credit: Draves & Reckase, *The Fractal Flame Algorithm*
(2003).

## Upstream reference: flam3

The fractal-flame algorithm itself is the work of Scott Draves & Erik Reckase. pyr3 inherits
GPL-3.0-or-later from the upstream
[flam3](https://github.com/scottdraves/flam3) C reference renderer (also GPL-3.0-or-later).
pyr3 is an *independent reimplementation* — we read the C source for algorithmic clarity but
the TypeScript and WGSL in this repo is original code.

## TS + WGSL basis: pyr3-peek

The Phase 0 source-tree copy (TS engine, 5 WGSL compute shaders, Vitest harness, CLI
bootstrap) comes from
[MattAltermatt/pyr3-peek](https://github.com/MattAltermatt/pyr3-peek) (GPL-3.0-or-later, same
author). pyr3-peek was itself derived from an earlier sibling repo; see its NOTICE.md.
Fresh history; pyr3-peek is not a git remote of this one.

## GPU shader / parser / variation ports: pyr3-kotlin

Phase 1 ports load-bearing GPU shader fixes, parser edge-cases, and variation-arm corrections
from [MattAltermatt/pyr3](https://github.com/MattAltermatt/pyr3) (the Kotlin/JVM predecessor,
GPL-3.0-or-later, same author). Each ported commit cites the source kotlin ref in its body
trailer (`Port: pyr3-kotlin <ref>`).

## Reference fixtures (Electric Sheep `.flame` genomes)

Fixture flames used for Phase 2 parity verification will be drawn from the Electric Sheep
distributed-rendering corpus ([electricsheep.org](https://electricsheep.org), Draves et al.,
2004–). Electric Sheep submissions carry one of two Creative Commons licenses (CC-BY 2.0 or
CC-BY-NC 2.0) depending on the contributor; per-fixture attribution will be captured in
`fixtures/flam3-goldens/README.md` when that directory lands in Phase 2.

## Third-party npm dependencies

Enumerated in `package.json` at Phase 0 landing. Notable load-bearing ones:

- **[`webgpu`](https://www.npmjs.com/package/webgpu)** (BSD-3-Clause) — Google Dawn team's
  Node.js bindings for WebGPU. Provides the CLI consumer's `navigator.gpu` shim.
- **[`vite`](https://vitejs.dev)** (MIT) — frontend build tool + dev server.
- **[`vitest`](https://vitest.dev)** (MIT) — test runner.
- **[`tsx`](https://www.npmjs.com/package/tsx)** (MIT) — TypeScript execution for Node.
- **[`pngjs`](https://www.npmjs.com/package/pngjs)** (MIT) — PNG encoding for the CLI output
  path.
- **[`happy-dom`](https://www.npmjs.com/package/happy-dom)** (MIT) — `DOMParser` shim for
  parsing `.flame` XML in the Node CLI.
- **[`@webgpu/types`](https://www.npmjs.com/package/@webgpu/types)** (BSD-3-Clause) —
  TypeScript type definitions for the WebGPU spec.
