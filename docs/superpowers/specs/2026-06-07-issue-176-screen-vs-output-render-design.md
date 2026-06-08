# #176 — Split screen render vs output render design spec

**Status:** locked 2026-06-07 via brainstorm. Implementation pending.
**Issue:** https://github.com/MattAltermatt/pyr3/issues/176
**Branch:** `feature/issue-176-screen-vs-output-render`
**Follow-up issues filed alongside:** #177 (saved render presets), #178 (pyr3 doc-refresh
live-page audit), #179 (reframe "fork it" badge → offline/CLI CTA).

---

## 1. Scope and naming

Today pyr3's editor and viewer both conflate "what shows on screen as you tune" with
"what gets exported when you save." A single render concept — driven by `genome.size`,
`genome.quality`, `genome.oversample` — sets both the live preview canvas AND the
Save Render output. Picking "4K" in the Size dropdown makes the **live editor**
re-iterate at 4K, which is exactly the conflation the issue calls out.

This spec splits them into two configs:

- **Preview render** — fast, responsive, what the user is iterating against.
- **Output render** — full quality / dims, runs only on explicit `💾 Save Render`.

Both configs are surfaced on a single **shared bar** (one DOM component, mounted in
both the viewer at `/v1` and the editor at `/v1/edit`), with the left half driving
preview and the right half driving render.

### Naming

Inside the codebase:

- `PreviewRenderConfig` — the workstation-pref-shaped config (tier + quality).
- `OutputRenderConfig` — the existing fields on `Genome` (`size`, `quality`,
  `oversample`, `filterRadius`). Not a new type; the spec talks about it as a
  concept but the fields stay where they are on `Genome`.
- `src/render-mode-bar.ts` — the new shared bar component.
- `src/render-mode-config.ts` — new module for `PreviewRenderConfig` + tier table +
  localStorage layer.

User-facing labels:

- Bar side labels: **PREVIEW** (cool-tinted) and **RENDER** (warm-tinted).
- Preview perf tiers: **Fast** / **Balanced** / **Sharp** (no pixel jargon in the UI).
- Render output: same Size dropdown labels as today (HD / 2K / 4K / square / iPhone /
  iPad / etc) — only the LOCATION of the dropdown changes; preset list is identical.

---

## 2. Architecture & data flow

### The two-config model

```text
┌─ PreviewRenderConfig (workstation pref)─┐    ┌─ OutputRenderConfig (on genome)──────┐
│  tier:    'fast' | 'balanced' | 'sharp' │    │  size:        { w, h }                │
│  quality: number  (10–50)               │    │  quality:     number  (1–500)         │
└─────────────────────────────────────────┘    │  oversample:  number  (from genome)   │
        ↑                                      │  filterRadius: number (from genome)   │
        localStorage:                          └───────────────────────────────────────┘
        'pyr3-preview-config'                          ↑
                                                       genome.size / genome.quality /
                                                       genome.oversample / genome.filterRadius
                                                       (today's location, unchanged)
```

### Aspect ratio rule

Render side is authoritative for aspect ratio. Preview tier picks **scale only**.

```text
preview_canvas_dims = aspectFitFromRender(tier, genome.size)
  Let long_edge = max(genome.size.width, genome.size.height)
  Let cap       = PREVIEW_TIER_LONGEST_EDGE[tier]   // 512 / 1024 / 1536

  if long_edge <= cap:
    preview = genome.size       // render is already smaller than tier cap; no scale
  else:
    scale   = cap / long_edge
    preview = { w: round(genome.size.width × scale),
                h: round(genome.size.height × scale) }
```

The preview canvas always WYSIWYG-composes the same crop the Save Render will
produce. Aspect mismatches are impossible by construction.

### Data flow

```text
PREVIEW SIDE                                       RENDER SIDE
──────────────────────────                         ─────────────────────────────
user clicks tier or preview quality                user picks size dropdown or types W×H
   ↓                                                 ↓
update PreviewRenderConfig (localStorage)          mutate genome.size (rebuilds GPU buffers
   ↓                                                 only at next render-PNG, NOT live)
resize canvas to preview dims, fresh seed          update aspect → preview canvas reshapes
   ↓                                                 ↓
lane scheduler iterates until density target,      user clicks render quality button or
then idles (NEW: halt-on-target check)             text input
                                                     ↓
                                                   mutate genome.quality (only used at
                                                   Save Render time)
                                                     ↓
                                                   user clicks 💾 Save Render
                                                     ↓
                                                   modal opens, rAF yield, fullRender at
                                                   genome.size × oversample, cancel-checked
                                                   between dispatches, PNG + metadata,
                                                   download, post-save toast
```

### The core seam change

**Live preview no longer reads `genome.size` directly.** That's the load-bearing
behavior change. `genome.size` becomes "what gets rendered when you click Save,"
nothing more. The editor canvas resolves its dims through
`computePreviewDims(tier, genome.size)` instead of reading `genome.size` itself.

### Shared component

`mountRenderModeBar({ host, getConfig, setConfig, onSaveRender }) → handle` is
mounted in both:

- `src/main.ts` (viewer) — below the existing 44px chrome, above the
  render-progress bar.
- `src/edit-mount.ts` (editor) — below the existing open/reroll bar, above the canvas.

The host wires per-surface getters/setters so the bar doesn't reach into shared
state directly. The bar is purely additive in the viewer (no prior viewer feature
removed; viewer gains 💾 Save Render).

### Editor's Render section panel after the move

```text
Before:                          After:
  Render section                   Render section
  ├─ Size dropdown        ─MOVED   ├─ Oversample dropdown (unchanged)
  ├─ Width × Height       ─MOVED   └─ Spatial filter radius + shape (unchanged)
  ├─ Quality scrubby      ─MOVED
  ├─ Oversample dropdown  ─KEEP
  └─ Spatial filter       ─KEEP
```

Render section header gains a small subtitle:

> *Output quality — see size & render quality on the bar above.*

---

## 3. Data shape & persistence

### New types

```ts
// src/render-mode-config.ts (NEW)

export type PreviewTier = 'fast' | 'balanced' | 'sharp';

export interface PreviewRenderConfig {
  tier: PreviewTier;       // workstation perf preference
  quality: number;          // iter density target, clamp [10, 50]
}

export const DEFAULT_PREVIEW_CONFIG: PreviewRenderConfig = {
  tier: 'balanced',
  quality: 25,
};

export const PREVIEW_TIER_LONGEST_EDGE: Record<PreviewTier, number> = {
  fast: 512,
  balanced: 1024,
  sharp: 1536,
};

export function computePreviewDims(
  tier: PreviewTier,
  renderSize: { width: number; height: number },
): { width: number; height: number };

export function loadPreviewConfig(): PreviewRenderConfig;   // localStorage read + fallback
export function savePreviewConfig(cfg: PreviewRenderConfig): void;  // localStorage write
```

### Persistence — `PreviewRenderConfig`

```text
localStorage key:   'pyr3-preview-config'
JSON shape:         { tier: 'balanced', quality: 25, _v: 1 }
Read:               loadPreviewConfig() — falls back to DEFAULT_PREVIEW_CONFIG on
                    missing / malformed JSON / _v mismatch
Write:              savePreviewConfig(cfg) — every change writes through (sub-ms,
                    no debounce needed)
Scope:              per-browser, per-origin
```

### `OutputRenderConfig` — already on the genome

```text
genome.size          → no schema change
genome.quality       → no schema change. Clamp widens [1, 500] (was effectively
                       [1, 200ish] via the scrubby's range).
genome.oversample    → no schema change
genome.filterRadius  → no schema change

Round-trips:
  .pyr3.json (genomeToJson) writes all four — already does today.
  .flame XML import — already reads size + quality + oversample today.
```

### Empty / invalid state handling

- localStorage missing `'pyr3-preview-config'` → `DEFAULT_PREVIEW_CONFIG`. Bar shows
  Balanced + Q25 (no quality button highlighted, since 25 doesn't snap to a button).
- localStorage malformed JSON → silently fall back to defaults, `console.warn`.
- `_v` older than current → migrate case-by-case; v1 needs no migration.
- `genome.size = 0` or unset on load → bar shows "Custom" with W = H = 1024.
- `genome.quality = 0` or unset → `DEFAULT_QUALITY` (25).

### URL-param overrides (light touch, session-only, NOT persisted)

```text
?preview=fast|balanced|sharp   — overrides tier for this session
?previewQ=25                   — overrides preview quality for this session
?quick=1                       — back-compat: maps to ?preview=fast&previewQ=10
```

`?quick=1` re-purposing: today the flag affects viewer render dims (the conflated
fast-everything knob). After the split, the genome's render config is untouched —
`?quick=1` just sets preview tier + preview quality to the lowest values for fast
load on embed/share links. Behaviorally similar to today's intent; no broken URLs.

---

## 4. UI surface

### Full bar layout (mounted in both viewer and editor)

```text
┌─ 44px existing top bar ──────────────────────────────────────────────────────┐
│  pyr3   /v1   /v1/edit   /v1/variations  ...                       👤 ⚙     │
├─ 48px NEW render-mode bar ───────────────────────────────────────────────────┤
│                                                                              │
│  PREVIEW│ ●Fast Balanced Sharp │ Q 10 20 30 40 50  ║  RENDER│ 📐4K▾  [3840]× │
│  [2160] │ Q 50 75 100 150 200  │ [   ] │ 💾 Save Render                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                  ║
                          vertical separator (1px, slightly brighter than tints)
```

### Widget specs

```text
PREVIEW SIDE (left, cool-tinted band)
  Side label    "PREVIEW"  uppercase, small
  Tier pill     3-button radio: Fast | Balanced | Sharp  (default Balanced)
                Each ~64px wide; rounded, selected = filled bg + bright text
  Quality       5 segmented buttons: 10 20 30 40 50  (default 25 →
                no button highlighted; honest off-ladder state)
                No text input on preview side.

RENDER SIDE (right, warm-tinted band)
  Side label    "RENDER"  uppercase, small
  Size dropdown 📐 [preset-name] ▾  — opens existing SIZE_PRESETS menu from
                load-intent.ts (HD / 2K / 4K / square / iPhone / iPad / etc).
                Picking preset auto-fills W and H below.
  Width         plain <input type="number"> ~70px (no scrubby)
  ×             label
  Height        plain <input type="number"> ~70px (no scrubby)
                Typing into W or H switches dropdown label to "Custom"
                (today's behavior preserved).
  Quality       5 segmented buttons: 50 75 100 150 200  (default 100)
  Text input    ~60px <input type="number">, accepts [1, 500], no scrubby
                Past 500 → toast: "Higher quality renders run faster
                offline via the pyr3 CLI binary. Capped at 500 here."
                Value clamps to 500.
  Save button   💾 Save Render  — bright orange, ~140px wide
                Disabled when no genome loaded or render in progress

LAYOUT
  Bar height           48px (deliberately taller than the 44px top bar)
  Bar position         Sticky below the open/reroll chrome
  Min bar width        ~1170px before wrap. Below that: render-side W × H
                       inputs collapse first (hidden behind a … menu);
                       below ~900px: tier pill collapses to dropdown.
                       Desktop priority surface; mobile (#13 milestone)
                       will revisit narrow handling.
```

### Toast / message specs

```text
Post-save toast        "💾 Saved {filename}.pyr3.png to Downloads"   3s, bottom-center
Quality > 500 message  "Higher quality renders faster offline via    5s, bottom-center
                       the pyr3 CLI binary. Capped at 500 here."
Render-in-progress     Modal — separate from toast layer
```

### Render progress modal

```text
┌────────────────────────────────────┐
│  Rendering — 4K · Q 100             │
│  ████████████░░░░░░░░░░  42 %       │
│                       [ ✕ Cancel ]  │
└────────────────────────────────────┘
```

- Modal opens **BEFORE** render dispatch starts (await one `rAF` after modal mount
  to guarantee first paint lands before GPU saturates).
- `%` computed from dispatched-iters / target-iters (cheap, already tracked).
- Cancel sets an `AbortSignal` flag checked between dispatch loops; render bails
  cleanly, no half-baked PNG written.
- Edits stay blocked (today's behavior — render mutates GPU buffers; concurrent
  edit would corrupt).

### Preview default of 25 vs 10/20/30/40/50 buttons

Default value (25) intentionally doesn't snap to a button. UX: no quality button
highlighted on first load (off-ladder state, matching the editor's existing bar
convention where `.on` highlight clears when value is off-ladder). User's first
click on a quality button snaps to that value and persists.

---

## 5. Migration & back-compat

### Existing `.pyr3.json` files

```text
Today: { ..., size: { width: 3840, height: 2160 }, quality: 100, oversample: 2, ... }
After: same shape, same fields. genome.size now binds ONLY to bar's render-side
       dropdown (not to live preview dims). On load:
         → bar shows "4K" preset + W=3840 / H=2160 inputs
         → preview canvas reshapes to 16:9 at preview-tier longest edge
         → Save Render uses these values
No file migration. Existing saves load with identical behavior.
```

### Existing `.flame` XML files (Apophysis / JWildfire)

Same — size and quality read from XML the same way (flame-import.ts unchanged).
New behavior: live preview ignores them during editing; Save Render honors them.

### Existing `?quick=1` URLs (shared earlier)

Today caps render dims to 1024 long-edge + q≤16 + oversample=1. After the split,
re-purposed within the new model: `?quick=1` → `?preview=fast&previewQ=10`. Genome's
render config untouched.

### Existing editor users (Render section panel)

After deploy: Size dropdown + W × H inputs + Quality scrubby visibly gone from the
panel (moved to bar). Panel shows the subtitle "Output quality — see size & render
quality on the bar above" so the redirect is in-place. No setting loss; user's
previous picks survive (they're on the genome).

### Existing viewer users

After deploy: new 48px row appears below the open/reroll chrome with PREVIEW
(defaults: Balanced / Q25) and RENDER (genome.size / quality from whatever flame is
loaded) + 💾 Save Render. No prior viewer feature removed.

### localStorage cold-start

First page load after deploy: no `pyr3-preview-config` key exists →
`DEFAULT_PREVIEW_CONFIG`. Bar renders Balanced highlighted, no quality button
highlighted. User's first tier-button interaction persists.

### Deep-link catalog handoff (#119)

`initialGenome` handoff in `edit-mount.ts:184–192` carries size/quality from
catalog defaults → still lands on `genome.size` / `genome.quality` → render bar
picks up. Preview side uses workstation-persisted tier/quality. No catalog-handoff
code change needed.

### PNG text chunk (#123)

PNG metadata embeds `genomeToJson(genome)` — includes size/quality/oversample. No
format change. PNG round-trip via future PNG-import reader will populate
`genome.size` + render bar correctly.

### Behavioral changes worth flagging in PR / changelog

```text
1. Picking "4K" in the editor no longer resizes the editor canvas. The editor
   preview stays at preview-tier dims; Save Render is what produces 4K.
   THE HEADLINE CHANGE — flag as a feature, not a regression.

2. Past 200 quality, the button group is empty; type into the text input.
   Mitigation: text input is visually obvious, placeholder = "max 500".

3. Live preview now has its own quality target — users may notice it idle
   sooner ("the iterating stopped before I was happy"). Crank preview Q to 50
   if you want longer convergence. Tooltip on the Q widget can mention this.
```

---

## 6. Testing

### New test files

```text
src/render-mode-config.test.ts
  - DEFAULT_PREVIEW_CONFIG values
  - computePreviewDims: aspect from render, capped by tier (landscape, portrait,
    square render aspects all tested)
  - loadPreviewConfig: missing key → defaults; malformed JSON → defaults;
    _v mismatch → defaults; well-formed → returns
  - savePreviewConfig round-trip

src/render-mode-bar.test.ts
  - Mount returns handle with expected DOM
  - Tier pill: click changes config + writes localStorage + fires onChange
  - Preview quality buttons: click sets quality, highlights button
  - Render quality buttons: click mutates genome.quality
  - Render quality text input: typing 250 stores 250; typing 600 shows toast +
    clamps to 500; typing -5 clamps to 1
  - Size dropdown: pick preset auto-fills W / H, label updates
  - Typing W or H switches dropdown label to "Custom"
  - Save Render disabled when no genome / render in progress
  - Aspect change → preview canvas resize callback fires
```

### Modified test files

```text
src/edit-render.test.ts            — lane scheduler halt-on-target check
                                     fullRender accepts AbortSignal + onProgress
                                     callback; bails cleanly when aborted
src/edit-section-render.test.ts    — Size / Quality / W × H widgets removed from
                                     panel; subtitle present
src/edit-mount.test.ts             — bar mount inside editor, callbacks wired
src/main.test.ts (or new)          — bar mount in viewer; Save Render flow
```

### Chrome eyeball verify (verify gate, not unit tests)

```text
- Bar mounts in both surfaces, identical layout
- Picking 4K in render does NOT resize editor canvas
- Preview canvas reshapes to render aspect on size change
- Save Render modal opens BEFORE GPU saturates (rAF yield)
- Cancel button bails render mid-flight, no half-baked PNG
- Post-save toast appears with correct filename
- Quality > 500 toast points to CLI
- localStorage persistence: tier survives page reload
- ?quick=1 maps to Fast + Q10
- Bar appears in viewer (not just editor)
- 💾 Save Render works in viewer with same modal + cancel + toast
```

---

## 7. Out of scope / follow-up issues

### Filed alongside this spec

- **#177 — Saved render presets** (size M). Bar gains a preset menu for named output
  configs ("Web Hero", "Print 4K"). Seeded from BE CLI `--preset` family. Depends
  on #176 shipping first.
- **#178 — pyr3 doc-refresh live-page audit** (size S). Project-level skill that
  extends `doc-refresh` to `WebFetch` + grep public URLs for stale signals.
- **#179 — Reframe "fork it" badge** (size S/M). CTA exposing the offline binary
  + CLI workflow that the quality-cap-500 message points to.

### Deferred (NOT filed; mentioned for future-you's awareness)

```text
- Background render while editing                       — needs genome snapshotting
- File System Access API "Save As…"                     — Chrome-only quirk
- Auto-detect GPU class for preview tier                — WebGPU adapter info
                                                          inconsistent across browsers
- Save View / camera-aware render in viewer             — separate button if asked
- 8K preset                                             — oversample × storage-buffer
                                                          guards needed first
- Mobile narrow-screen handling                         — milestone #13 owns this
- Render preview at output-config separate thumbnail    — Q4-A solved this for free
- "Save As…" right-click on Save Render button          — Mac right-click awkward
                                                          (per CLAUDE.md feedback)
```

---

## 8. Items to track during implementation

```text
- Lane scheduler (edit-render.ts) gains halt-on-target check
- Viewer (main.ts) gains a lane scheduler — today it has none; new module or
  refactor extracts shared scheduler from edit-render.ts
- fullRender accepts AbortSignal + onProgress callback
- Preview canvas dim resolver: deferred to next rAF after tier/render change
  (avoid mid-iter resize race)
- localStorage write debounce: not needed (sub-ms write), but watch for storage
  quota under noisy edits — capped at 1 write per tier change, fine
- Modal opens BEFORE render dispatch (rAF yield between mount and first dispatch)
- Render section panel subtitle gets translated through whatever i18n pattern
  the panel already uses (likely none; plain string)
- The 48px bar height needs CSS coordination — the editor's existing top-bar
  + open/reroll chrome stack heights are known; bar lands beneath the chrome
- Bar's "min-width" responsive collapse rules are spec'd but mobile rework
  (#13) owns the actual implementation; v1 ships desktop-priority

Aspect-fit edge cases worth a regression test:
  - Portrait render (1290×2796) → preview at tier cap on the LONG edge (2796 capped)
  - Square render (1080×1080) → preview is square at tier cap
  - Render smaller than tier cap → preview = render exactly (no upscale)
  - Custom dims with odd aspect (e.g., 3000×500) → preview maintains aspect
```
