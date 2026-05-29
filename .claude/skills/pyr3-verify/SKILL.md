---
name: pyr3-verify
description: Build a .remember/verify/<slug>.html eyeball-verify page comparing flam3-C golden vs pyr3 render vs diff for one or more fixtures. Use before claiming parity work is done, before any FF-merge to main on the render path, or whenever the user asks for visual parity confirmation. The HTML is the deliverable — never hand a list of `open <path>` commands.
---

# pyr3-verify

Generates a self-contained HTML page in `.remember/verify/` showing a 3-column comparison (golden / pyr3-render / diff) for one or more fixtures, with R-tolerance pills and per-region metrics. The user gets ONE `open <abs-path>` line, not a list.

## When to use

- After any change to `src/chaos.ts`, `src/shaders/chaos.wgsl`, `src/variations.ts`, `src/serialize.ts`, `src/tonemap.ts`, or any module that touches the render path.
- Before FF-merging any render-path branch into `main`.
- When a parity test fails and a visual is needed to reason about it.
- When the user explicitly asks for a verify page.

## Inputs

- `<fixture-glob>`: a fixture name like `coverage.248.02226`, a basename like `electricsheep.247.19679`, or a glob like `coverage.*`.
- `<purpose-slug>`: short kebab-case slug for the HTML file. e.g. `phase-2-parity-verify`, `pyr3-017-investigation`, `v0.12-arms-audit`.
- `[--engine fe|be|both]` (default: `be`).

## Workflow

1. Resolve the fixture list (glob-expand against `fixtures/flam3-goldens/`).
2. For each fixture:
   - **`--engine be` or `both`:** run `npm run render -- --fixture <name> --out fixtures/flam3-goldens/<name>/pyr3-render.png` (verify the exact `bin/pyr3-render.ts` flag names against the current CLI).
   - **`--engine fe` or `both`:** boot `npm run dev` in background if not already running (check listening port — Vite may bump 5173 → 5174), then drive chrome-devtools-mcp to navigate `http://localhost:5173/?fixture=<name>`, screenshot, save to `fixtures/flam3-goldens/<name>/pyr3-fe-render.png`. Reuse the existing `scripts/fe-parity.ts` flow when applicable.
   - Compute R using the same code path as `src/compare.ts`.
   - Generate the diff PNG via `scripts/diff-pngs.mjs` or `src/diff-image.ts`.
3. Build `.remember/verify/<purpose-slug>.html` with the canonical layout:
   - Dark theme (`background: #111; color: #eee`).
   - One row per fixture: header with fixture name + R pill, then a 3-column CSS grid `golden | pyr3-render | diff`, with monospace labels under each image.
   - All `<img src>` MUST be absolute `file:///<abs-repo-path>/...` URLs so the page works when opened directly.
   - R pill colour: green if R < fixture threshold, yellow if 1–2× threshold, red if >2×. Per-channel and per-region pills below the row.
4. Surface ONE line to the user:
   ```
   open <abs-repo-path>/.remember/verify/<purpose-slug>.html
   ```

## Conventions (do not deviate)

- `pyr3/CLAUDE.md` lines 99–116 is the authoritative spec for the HTML shape — read it before deviating.
- `.remember/verify/` is in `.gitignore` — pages are personal/transient.
- NEVER hand a list of `open` commands. The single HTML page is the contract.
- Per-fixture R thresholds are calibrated in `src/parity.test.ts`.
- For FE renders, use chrome-devtools-mcp (the global rule forbids the built-in preview).
