# pyr3 FE v1.0 polish — design spec

**Date:** 2026-05-28
**Status:** locked (brainstormed via visual companion, 2026-05-28)
**Branch:** `feature/fe-v1-polish`
**Backlog:** closes the FE slice of `[PYR3-031]` (FE cleanup) + the FE-facing
slice of `[PYR3-032]` (predecessor-repo purge); spins out `[PYR3-037]` (About
page brainstorm).

## 1. Goal & scope

Pre-public-ship polish of the browser viewer. Three intertwined streams, all
FE-facing only:

1. **Visual/UX redesign** of the top bar — collapse the current three-tier bar
   into a single slim row ("flame as hero"), restyle render progress, add a
   first-paint loading cue.
2. **Cleanup** (`[PYR3-031]`) — remove dead/vestigial FE code surfaced by the
   redesign (Share button + outbound share UI, unused `setLoading`/status pulse,
   `.pyr3-bar-btn-accent` CSS).
3. **FE-facing purge** (`[PYR3-032]` slice) — rebrand the three `help/*.html`
   pages from "pyr3-peek" → "pyr3"; reword one FE source comment.

### Explicitly OUT of scope (deferred, do not touch this session)

- The **functional** `[PYR3-032]` purge: `fixtures/showcase-v1.0/_manifest.json`
  source paths, `fixtures/kotlin-goldens/` + `kotlin-4k-refs/` renames, agent
  defs, engine `Port: pyr3-kotlin` provenance comments
  (`src/compare.ts`, `src/serialize.ts`, `src/shaders/chaos.wgsl`). These touch
  the v1.0 ship gate and belong to a dedicated full-`[PYR3-032]` session.
- The **About page content/design** — `[PYR3-037]`. This session only rebrands
  it (pyr3-peek → pyr3); the "what should it say & look like" redesign is its
  own brainstorm.
- **Share-link** outbound feature — being redesigned in a separate session.
  Remove the bar button now; keep the inbound `?flame=` decode path intact so
  existing links don't break.
- Engine `PYR3-029` comments in `chaos.wgsl`/`chaos.ts`/`genome.ts` — these are
  load-bearing documentation of the flam3-canonical pick table + trace gate, NOT
  stale. Leave untouched.

### Hard constraints (from CLAUDE.md / v1 spec)

- Chrome is the only verify target (`chrome-devtools-mcp`); never the built-in
  preview.
- Engine modules contain **zero environment branching** — this work is
  FE-host-only (`src/main.ts`, `src/ui-bar.ts`, `index.html`, `help/*.html`); it
  must not touch the shared engine seam.
- DOM construction stays `createElement` + `textContent` (no `innerHTML`) — flame
  names / nicks come from untrusted `.flame` XML.
- Must NOT regress `[PYR3-026]`: `npm run test:parity-fe-be` stays 25/25 green at
  v0.19 thresholds. The capture/load dev hooks (`__pyr3CapturePixels`,
  `__pyr3LoadFlame`, gated on `import.meta.env.DEV`) are load-bearing for that
  rig — keep them.

## 2. The redesigned bar — single slim row

Replaces the current three-tier bar (tier1 identity+chips, tier2 meta+actions,
tier3 progress) with **one** row of three flex zones, plus an optional progress
detail row that drops in only during render.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔥 pyr3 · about · Electric Sheep 247.19679 · by spotiform                      │
│                          📂 Open                                               │
│                    WebGPU ✓   🐙 fork it↗      🐙 more flames↗                  │
│                               pyr3 on github   electric sheep fold             │
└──────────────────────────────────────────────────────────────────────────────┘
```

(All three zones share one row, vertically centered; the diagram stacks them only
for legibility.)

### Left zone (identity, left-stuck) — flex:1, justify start

- **🔥 pyr3** wordmark → links to **home** (the github.io landing / site root
  `/`). Clicking from the viewer reloads to the welcome flame ("logo = home").
  This replaces today's wordmark → `/help/about.html`.
- **· about** — quiet grey text link (`#777`, hover `#aaa`), positioned
  **between the wordmark and the flame name**. → `/help/about.html`.
- **flame name** — `result.genome.name || 'Untitled'`, in `--text` weight 600.
- **by {nick}** — rendered only when `genome.nick` is present; omitted entirely
  otherwise. Muted (`--text-muted`).
- Name + "by nick" remain `user-select: text` (copyable); the rest of the bar
  stays `user-select: none`.

### Center zone — flex:0, justify center

- **📂 Open** button (unchanged behavior: opens the `.flame`/`.flam3` file
  picker via `openFilePicker`). Styled as today's `.pyr3-bar-btn`.
- During render this zone is unaffected (progress lives in the drop-down row,
  §3) — but the Open button is disabled while a load is in flight (existing
  `setBusy`).

### Right zone — flex:1, justify end

- **WebGPU ✓** pill (green, full pill per the calibrated look): `available` →
  green `✓` variant linking `/help/webgpu.html#what-is-webgpu`; unavailable →
  red `✗ why?` variant linking `#why-not-working`. (Same data as today's chip,
  restyled to the prominent centered-pill look.)
- **🐙 fork it ↗** — two-line octocat CTA. Top line: GitHub octocat (real
  octocat SVG, `fill: currentColor` = accent orange) + "fork it" + ↗. Sub-line
  (grey, 9px): "pyr3 on github". → `https://github.com/MattAltermatt/pyr3`.
- **🐙 more flames ↗** — same two-line octocat CTA. Top: octocat + "more flames"
  + ↗. Sub-line: "electric sheep fold". →
  `https://github.com/MattAltermatt/electric-sheep-fold`.
- Both external links: `target="_blank"`, `rel="noopener noreferrer"`.
- The octocat is the canonical GitHub mark SVG (16×16 viewBox), inlined.

### Removed from the bar

- The two old marketing CTA chips (`buildCtaChip` — "WANT TO MAKE ONE?" /
  "WANT MORE SHEEP?") — replaced by the octocat CTAs above.
- The **🔗 Share link** button + `onShareLink` wiring + `shareCurrentFlame()`.
  Keep `url-codec` + the inbound `?flame=` decode (`resolveLoadIntent` /
  `decodeFlame`) so existing share URLs still load. `encodeFlame` becomes unused
  → remove it (and drop the now-dead `lastLoadedText` plumbing if nothing else
  reads it).
- The tier1/tier2 separation — one row now.

## 3. Render progress — drop-down detail row (option B)

A second row that mounts **only during render**, below the main bar row
(restyled `buildTier3` / `showProgress` path; the mount/unmount lifecycle is
unchanged):

- "Rendering" label (accent).
- Fat progress bar with accent-gradient fill (existing `.pyr3-tier3-*` styling).
- Percent.
- ETA + samples: "~Ns left · N.NM samples".
- **"Why so long? ↗"** link → `/help/ifs-and-render-cost.html` (kept).
- **✕ Cancel** button → `runHandle.cancel()`.

On completion the row removes (existing `hideProgress`). No layout shift in the
idle state; the shift only happens while a render is actively running.

## 4. Canvas zone — no change (verify only)

Decision: **clean letterbox** (current). The flame fills as much of the viewport
as possible, aspect preserved, never stretched — already achieved by
`#pyr3-canvas { width:100%; height:100%; object-fit:contain }` with
`canvas.width/height` set to the genome dims in `main.ts`. **No code change**;
just confirm it survives the cleanup pass during Chrome verify.

## 5. First-paint loading cue — "dreaming…"

On a cold load, the canvas is black for ~1s while the welcome flame is fetched,
parsed, and first-rendered. Add a small, centered, dim italic cue in the canvas
zone that reassures the engine fired up:

- Text: **"dreaming…"** (a *Do Androids Dream of Electric Sheep?* wink).
- Style: muted grey-warm (`~#7a6a55`), small (~13px), italic, letter-spaced;
  centered in `#pyr3-canvas-zone`.
- Shown from boot until the **first** render completes (first present), then
  removed/faded. Not shown for subsequent loads (there's already a flame on
  screen + the progress row covers re-renders).
- This is NOT an overlay on a rendered flame (the v1 spec forbids that) — there
  is no flame yet at first paint. It lives in the letterbox zone and is gone
  before the first flame appears.

## 6. Error & import feedback (small wins)

- **Load failure** (`loadFromFile` catch): currently `console.error` only. Add a
  user-facing toast via the existing `showToast`: e.g. "Couldn't load that
  .flame — see console." Keep the `console.error` too.
- **Dropped/unsupported variations on import** (`applyLoadResult` already
  computes `dropCount`/`ignoredCount` and `console.log`s them): OPTIONAL nicety —
  a subtle toast when `dropCount > 0` ("Loaded · N unsupported variations
  skipped"). Low priority; include only if cheap.

## 7. FE-facing purge (`[PYR3-032]` slice)

- **`help/about.html`**, **`help/ifs-and-render-cost.html`**,
  **`help/webgpu.html`**: replace every "pyr3-peek" with "pyr3" — `<title>`,
  `<h1>`, body copy, and "← Back to pyr3-peek" back-links. Review surrounding
  copy so renamed sentences still read correctly (e.g. "pyr3-peek is
  intentionally narrow" → "pyr3 is intentionally narrow"). Content/design
  redesign is explicitly deferred to `[PYR3-037]` — this is rename + read-through
  only.
- **`src/main.ts`** (~line 204): reword the "// pyr3-peek couldn't crack."
  comment to drop the predecessor reference (describe the over-zoom symptom
  without naming pyr3-peek).

## 8. Docs (ship dependencies)

- **README `## Status`** block is stale (says v0.18, names PYR3-029 + 248.22289
  R=44.96 as the v1.0 blocker — both since resolved). Refresh to v0.22 + this
  polish pass: three ship gates green, the PYR3-034 variation-drop fix, current
  outliers (PYR3-029's 02226 / 245.06687). Update before FF-merge.
- **CHANGELOG** entry for the polish version when shipping.
- **BACKLOG**: `[PYR3-031]` → mark FE slice done; `[PYR3-032]` → note FE-facing
  slice done, functional slice still open; `[PYR3-037]` filed (done).

## 9. Verification

- `npm run typecheck` + `npm test` green before commit.
- `npm run test:parity-fe-be` stays **25/25** (no PYR3-026 regression).
- **Chrome verify** (`chrome-devtools-mcp`, never the built-in preview): boot the
  viewer, watch console for warnings, drive through 3–5 fixtures including the
  welcome flame (`electricsheep.247.19679`). Confirm:
  - bar renders in one row, all three zones, no overflow at narrow widths;
  - wordmark → home, about → about page, WebGPU pill → webgpu help, both octocats
    → correct repos (new tab);
  - "by nick" appears/omits correctly across fixtures (one with a nick, one
    without);
  - first-paint "dreaming…" cue shows on cold load and clears on first paint;
  - render progress drop-down row appears mid-render with working Cancel +
    "Why so long?" link;
  - load-error toast fires on a deliberately malformed `.flame`.
- User-verify (eyeball) before FF-merge per CLAUDE.md.

## 10. Files touched

- `src/ui-bar.ts` — bulk of the work: single-row three-zone rebuild, octocat
  CTAs, restyled progress row, remove Share + vestigial `setLoading`/status/
  `.pyr3-bar-btn-accent`.
- `src/main.ts` — wordmark→home + about link wiring; drop `onShareLink` /
  `shareCurrentFlame` / `encodeFlame`; add load-error toast; add first-paint cue
  mount/clear; reword line-204 comment.
- `index.html` — first-paint cue styling hook in `#pyr3-canvas-zone` (if not done
  purely in JS); minor CSS housekeeping.
- `help/about.html`, `help/ifs-and-render-cost.html`, `help/webgpu.html` —
  rebrand.
- `README.md` — Status refresh.
- `CHANGELOG.md`, `BACKLOG.md`, `ROADMAP.md` — ship-doc sync.
