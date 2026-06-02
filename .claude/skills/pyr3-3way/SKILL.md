---
name: pyr3-3way
description: Build a custom 3-way parity investigation HTML for a single fixture — golden + FE + BE + 3 diffs in a 2x3 grid. Use when a fixture's R(FE,BE) / R(FE,g) / R(BE,g) values look surprising and you need to see the geometry of the divergence. Companion to #28 — the on-demand HTML the user pivoted to instead of a default 25-fixture sweep page.
---

# pyr3-3way

Build a one-off 3-way verify HTML at `.remember/verify/<fixture>-3way.html` for a SINGLE fixture. Issue #28 deliberately punted the always-on 25-fixture HTML in favor of this on-demand pattern (user, 2026-06-01: "if there are issues, it makes sense to build custom HTMLs for the issue").

**Input:** a fixture id, e.g. `/pyr3-3way coverage.245.06687`.

## Preconditions

The script reads pre-rendered PNGs — no GPU work happens here. Required artifacts in `fixtures/flam3-goldens/<fixture>/`:
- `golden.png` (always present)
- `pyr3-fe-be-fe.png` (FE @ quick-mode dims, from `parity-fe-be.test.ts`)
- `pyr3-fe-be-be.png` (BE @ quick-mode dims, same)
- `fe-be-diff.png` (already computed by the parity rig)

If the FE-BE pair is missing, prompt the user: `npm run test:fe-be-smoke` writes the smoke set (3 fixtures); `npm run test:parity-fe-be` writes all 25 (~13 min).

## Workflow

1. **Locate the fixture dir.** `fixtures/flam3-goldens/<fixture>/`. If it doesn't exist, list candidates: `ls fixtures/flam3-goldens/ | grep -i <fixture>`.
2. **Read the 3 source PNGs** (golden + FE-quick + BE-quick). Use `pngjs` (`PNG.sync.read`).
3. **Downscale golden to quick-mode dims** using `nearestDownscale` from `src/diff-image.ts` (already shared by `parity-fe-be.test.ts` per #28).
4. **Compute the 3 R values + write 2 missing diff PNGs** to `.remember/verify/`:
   - `<fixture>-fe-vs-g.png` — `renderDiffPng(FE, goldenQuick)` ×8
   - `<fixture>-be-vs-g.png` — `renderDiffPng(BE, goldenQuick)` ×8
   - Reuse the existing `fe-be-diff.png` from the fixture dir as-is.
5. **Build the HTML** at `.remember/verify/<fixture>-3way.html`:
   - Dark theme, mono labels (mirrors `pyr3-018-build-html.mjs`).
   - 2×3 grid per fixture:
     ```
     [ golden ]  [ FE@1024 ]  [ BE@1024 ]
     [ FE-vs-g] [ BE-vs-g  ]  [ FE-vs-BE ]
     ```
   - Header pills: `R(FE,BE)=X`, `R(FE,g)=Y`, `R(BE,g)=Z`, fixture dims.
   - Image src uses absolute `file:///` URLs (iTerm cmd-clickable per `feedback-clickable-file-urls`).
6. **Surface the URL** on its own line in chat:
   ```
   file:///<abs-repo-path>/.remember/verify/<fixture>-3way.html
   ```
   Do NOT hand `open <path>` (per project preference).

## Implementation hint

Smallest viable script lives at `scripts/build-3way-verify.mjs` (or `.ts` via tsx). The skill can either invoke that script (preferred — keeps the heavy lifting reusable) or inline the work via the Read tool + small Node one-liners.

Reuse what's already shared:
- `src/diff-image.ts` exports `nearestDownscale` + `renderDiffPng`.
- `src/compare.ts` exports `meanAbsDiffRgba` for the 3 R values.

## Common mistakes

- **Forgetting to downscale golden.** Golden is at native dims; FE/BE-quick are at 1024 long-edge. Diff against native = nonsense.
- **Re-rendering on the fly.** Don't — the FE/BE/golden PNGs are already on disk after the FE-BE rig + the goldens are immutable. Skip render entirely.
- **Writing the diffs back into `fixtures/flam3-goldens/<id>/`.** That dir is the canonical fixture surface; investigation artifacts belong in `.remember/verify/` (gitignored).
