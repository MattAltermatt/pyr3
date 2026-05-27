# 🗃️ pyr3 Backlog

Authoritative registry of open tasks. Every open task carries a `[PYR3-NNN]` ID (required) and
best-effort flags (optional): `category · size · sigil · status · milestone`.

Forward-only — shipped work lives in [CHANGELOG.md](CHANGELOG.md). Strategic narrative +
current cycle lives in [ROADMAP.md](ROADMAP.md).

> **Next ID: PYR3-009** — increment when creating a new entry. Never reuse, even for
> shipped/removed tasks.

## [PYR3-008] gpu · S · 🪨 · queued · v1.x — Decouple chaos.ts oversample from genome

`chaos.ts:173` reads `g.oversample` from the genome to compute the WGSL
`scale` uniform (`g.scale × g.oversample`). The pipeline's *actual*
oversample is already known to the renderer (`pipelines.oversample`); the
genome value is a vestigial parallel input that allowed v0.2's camera-zoom
bug to creep in (host setup forgot to keep them in sync).

**Why:** Defensive — eliminate the divergence class entirely so future host
setup bugs of the same shape cannot recur. The pipeline oversample is the
authority; the chaos pass should accept it as a dispatch parameter, not
re-read from the genome.

**How to apply:** Change `chaos.ts:dispatch` signature to take `oversample`
as an explicit arg (or derive from pipeline state). Update both call sites
(`renderer.iterate` + any other). Add a regression test that varies
`genome.oversample` and asserts WGSL `scale` matches `pipelineOversample × g.scale`,
not `genomeOversample × g.scale`.

**Flag vocabularies:**
- **category:** feat · perf · bug · parity · docs · cli · gpu · cpu · infra
- **size:** XS · S · M · L · XL
- **sigil:** 🪨 load-bearing · 🎚️ tunable · 🎨 cosmetic · 🪶 trivial
- **status:** active · queued · investigation · parked · someday
- **milestone:** v1.x · v2.0 · post-v1 · ...

Order convention when flags present: `category · size · sigil · status · milestone — title`.

## [PYR3-001] feat · XL · 🪨 · someday · post-v1 — Visual flame editor

Mutator + vault + recents + undo + landing screen + session persistence — essentially
pyr3-rust's scope, in pure TS (no WASM). Framework choice (React / Svelte / Solid) is itself
a load-bearing decision worthy of dueling agents when pulled forward.

**Depends on:** v1.0 ship-gate pass.

**Why much-later:** the editor is large enough to consume the project. Locking the viewer +
share-link + ship-gate first keeps the v1.0 scope honest.

## [PYR3-002] feat · XL · 🪨 · someday · post-v1 — Markov-chain flame generation research

Algorithmic research: train a Markov chain on a corpus of "good" Electric Sheep flames, sample
new flames from the chain, evaluate visual quality. Possibly with variation-arm or
parameter-space embeddings. Open research, not a feature ship.

**Depends on:** editor ([PYR3-001]) so generated flames have somewhere to live + be tweaked.

## [PYR3-003] perf · M · 🎚️ · queued · v1.x — GPU perf characterization

Once v1.0 ships, characterize wall-clock per-fixture on FE (Chrome) and BE (Node). Identify
hot paths in WGSL. Decide whether perf work is worth the engineering cost.

## [PYR3-004] gpu · S · 🪨 · queued · v1.x — Expand variation set audit

pyr3-peek's README claims 99 variations; pyr3-kotlin shipped 98/99 with `gdoffs` as the gap.
Audit which 99 peek has, confirm completeness, port any missing arms from kotlin during the
Phase 1 audit-port pass.

## [PYR3-005] cli · S · 🪨 · queued · v1.x — Single-binary CLI distribution

Ship `pyr3` as a single self-contained executable (Node SEA / pkg / similar) so users don't
need `npm install` or `node` installed on their machine. v1.0 ships with `npm run render`
working; post-v1.0 wraps the same `bin/pyr3-render.ts` into a `pyr3` binary. The underneath
must not change — `Phase 0` proves this seam works.

## [PYR3-006] infra · S · 🎨 · queued · v1.x — GitHub Actions CI

Build, typecheck, test on push to any branch. Auto-deploy frontend to `gh-pages` on tag push.
Cache `node_modules` for fast turnaround.

## [PYR3-007] feat · XS · 🎨 · queued · v1.x — Showcase flame gallery on homepage

The browser entry-point shows a curated gallery of share-link buttons so visitors land on
something visual, not an empty viewer. Pulls from `fixtures/showcase/`.
