# Parity fixtures — Electric Sheep `.flame` genomes

The 25 fixtures in this directory are the v1.0 BE-vs-flam3-C parity corpus (see
[`CLAUDE.md`](../../CLAUDE.md) → "Determinism & R tolerance contract"). Each
`<id>/` holds the source `<id>.flam3`, the flam3-C `golden.png`, the calibrated
`meta.json` tier contract, and pyr3 render/diff PNGs (gitignored).

## Attribution & license

The source genomes are drawn from the **Electric Sheep** distributed-rendering
corpus ([electricsheep.org](https://electricsheep.org), Draves et al., 2004–).
Electric Sheep submissions are licensed under one of two Creative Commons
licenses depending on the contributor:

- **CC-BY 2.0** — attribution required.
- **CC-BY-NC 2.0** — attribution required **and non-commercial use only**. These
  constrain how a derived product (e.g. `pyr3.app`) may be monetized.

> ⚠️ **Per-genome license is not yet confirmed.** The `.flame` sources carry a
> contributor `nick` but not the CC variant. The table below records the
> contributor extracted from each source; the exact CC-BY vs CC-BY-NC license
> per genome must be confirmed against electricsheep.org before any commercial
> use of the corpus. Treat any unconfirmed genome as **CC-BY-NC** (the stricter
> license) until verified.

| Fixture id | Contributor (`nick`) | Source / homepage |
|---|---|---|
| 244.00016 | _(unattributed in source)_ | — |
| 244.00617 | phoenix0 | phoenix0.110mb.com |
| 244.42746 | freakiebeat | www.freakiebeat.com |
| 244.57686 | WilliamPilgrim | — |
| 244.82270 | cqfd93 | sylvie.gallet.free.fr |
| 244.82986 | brood | electricsheep.org |
| 247.29388 | cqfd93 | sylvie.gallet.free.fr |
| 248.04487 | sparky | — |
| 248.11268 | sparky | — |
| 248.23554 | fractalapple | — |
| coverage.243.04616 | brood | electricsheep.org |
| coverage.245.00381 | brood | electricsheep.org |
| coverage.245.06687 | _(unattributed in source)_ | — |
| coverage.247.20817 | _(unattributed in source)_ | — |
| coverage.247.28068 | brood | electricsheep.org |
| coverage.247.31007 | _(unattributed in source)_ | — |
| coverage.248.02226 | _(unattributed in source)_ | — |
| coverage.248.11405 | sparky | — |
| coverage.248.19873 | _(unattributed in source)_ | — |
| coverage.248.24236 | fractalapple | — |
| coverage.248.25196 | sparky | — |
| coverage.248.33248 | brood | electricsheep.org |
| electricsheep.244.59334 | brood | electricsheep.org |
| electricsheep.245.07670 | brood | electricsheep.org |
| electricsheep.247.08620 | BrothaLewis | — |

Contributor `nick` values were extracted from the `nick="…"` attribute of each
source `.flame`; `_(unattributed in source)_` means the source carried no `nick`.

See [`../../NOTICE.md`](../../NOTICE.md) for the repo-wide third-party attribution.
