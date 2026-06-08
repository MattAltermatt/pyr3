# Screensaver mode — `/v1/screensaver` (issue #109)

**Status:** locked 2026-06-05 · milestone: Visual Overhaul (#9) · GitHub issue: [#109](https://github.com/MattAltermatt/pyr3/issues/109)
**Revisions:** 2026-06-05 (initial), 2026-06-05 build-up rewrite (§4.2) — literal pixel-landing replaces the photo-develop trick that locked the GPU. 2026-06-05 adjustable quality (§4.2.1, §7) — `buildUpQ` and `slideshowQ` are now user-tunable via the landing card (Quality ladder per mode, 10..500).

A `/v1/screensaver` route that turns the pyr3 engine into a lean-back fractal-flame
display. Two modes (true slideshow vs slow build-up), random shuffle through the ESF
corpus, configurable timing, fullscreen-on-demand. Manual entry only in v1 — no
auto-idle-launch, no vault source, no Cast.

## 1. Goal

Watch flames. Either as a polished crossfading slideshow at full quality, or as
slow-build meditations where the chaos game visibly converges. Set the rendering
pace, click Play, optionally hit Fullscreen, lean back.

## 2. Architecture

Five new modules + one routing branch in `main.ts` + one new top-bar variant:

```text
src/
  screensaver-mount.ts      canvas + scheduler wiring; mode state machine; queue runner
  screensaver-ui.ts         landing settings card (mode picker + 3 knob ladders + Play)
  screensaver-queue.ts      random shuffle over ESF corpus index; session-history buffer
  screensaver-prefs.ts      localStorage persistence (mode + timing values)
  screensaver-prefetch.ts   owns the prefetch render of "next flame" during current display
src/ui-bar.ts               +mountScreensaverBar() variant (brand + About + Gallery + …)
src/main.ts                 +1 routing branch: /v1/screensaver → mountScreensaverPage()
```

`screensaver-mount.ts` is the structural analogue of `edit-mount.ts`: owns the
WebGPU canvas, reuses `createRenderer()` and `createLaneScheduler()`, drives the
queue + transitions. Engine modules (`chaos`/`density`/`visualize_*`) untouched —
single-engine-two-consumers seam preserved.

## 3. Landing page (`/v1/screensaver`)

```text
┌─────────────────────────────────────────────────────────┐
│  pyr3 · About · Gallery · Edit · Screensaver           │ ← standard top bar
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌── settings card ──────────────────────────────┐    │
│   │  Mode:   ( ) Slideshow   (●) Build-up         │    │
│   │                                                │    │
│   │  Build-up time:   [30s] [60s] [5min] [10min]  │    │
│   │                    ladder + text input         │    │
│   │                                                │    │
│   │  Rest period:     [10s] [30s] [60s] [2m]      │    │
│   │                    ladder + text input         │    │
│   │                                                │    │
│   │  Slideshow hold:  [5s] [15s] [30s] [60s]      │    │
│   │                    ladder + text input         │    │
│   │                                                │    │
│   │              [   ▶ Play   ]                   │    │
│   └───────────────────────────────────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Space pause · ← → skip · F fullscreen · Esc exit FS   │ ← always visible
│  · S settings                                           │
└─────────────────────────────────────────────────────────┘
```

Settings card sits centered above an empty preview area. On **Play**, the card
collapses to a tiny "▶ Now playing — [⏸] [⛶ Fullscreen]" pill anchored top-right
under the bar, the canvas takes the rest of the viewport, and a controls strip
(see §3.1) renders at the bottom.

Reopen the card via the "S" key or a "settings" link in the pill.

### 3.1 Controls strip (permanent)

Always-visible cheat sheet pinned to the bottom of the viewport across every
state — landing, windowed-running, **and fullscreen**. Slim (~28px tall), dim
mono font (~60% opacity), read-only. The strip is the keyboard-driven user's
reference and the always-on safety net for "how do I get out of this thing?"

Content:

```text
Space pause · ← → skip · F fullscreen · Esc exit FS · S settings
```

## 4. Modes

### 4.1 Slideshow

Each flame renders to full quality in the background while the previous flame
holds on screen. When the hold timer (`slideshowHold`) fires, crossfade ~1.5s
into the prefetched next flame.

- Lane: `rebuild` once per flame to high q (existing slow-lane behavior).
- Prefetch window: starts as soon as the current flame is fully displayed; if it
  doesn't finish before `slideshowHold` elapses, the current flame holds longer
  until prefetch settles (no half-rendered cutaways).

### 4.2 Build-up

Progressively renders one flame so q=50 is reached at exactly `buildUpSec`. The
user watches samples *physically land on screen* — sparse scatter early, denser
as `buildUpSec` progresses, then a final density-estimate "settle" smooths the
result into a viewer-quality image. After settle, hold full-quality for
`restSec`, then fade-to-black ~2s before the next flame.

The visual contract: the chaos game is *visibly converging* (the §1 goal). The
shape physically takes form. Sparse dots → dense regions → smooth flame.

#### Pacing

A constant-rate scheduler in `screensaver-mount.ts` emits per-frame chaos
dispatches at ~30fps. Each frame splats a slice of the total `q=50 × width ×
height` budget so the histogram fills steadily over `buildUpSec`:

```text
samplesPerFrame = (50 × W × H) / (buildUpSec × 30)
```

#### Per-frame dispatch

A fresh ISAAC seed every frame guarantees the splat pattern moves around the
attractor each tick — re-using the same seed would re-render the identical
scatter and just brighten the same cells. The 200-iter fuse cost is paid per
dispatch — accepted as a perf concession for not needing walker-position
persistence across dispatches (no engine change):

```ts
iterate({
  seed:    fresh per frame,                          // see chaos.ts:259
  walkers: 1024,
  iters:   200 + Math.ceil(samplesPerFrame / 1024),  // fuse + splat iters
})
```

The `iterate()` API already accepts arbitrary `walkers`/`iters` overrides; no
`computeDispatch()` floor applies on this path.

#### Per-frame present — the visual key

During build-up, tone-normalize against the **accumulated** sample count (not a
fixed end-of-build target) and skip density estimation. Each new sample lands as
a bright dot; the image goes from "sparse bright dots" → "dense bright" →
ready-to-settle:

```ts
present({
  totalSamples: samplesAccumulated,   // adaptive — makes new dots bright
  forceDeOff:   true,                  // raw dots, no Gaussian smoothing
})
```

`samplesAccumulated` tracks **post-fuse splatted samples** (`walkers × (iters −
fuse)`), not the raw `walkers × iters` total — only post-fuse iters scatter
into the histogram. Getting this wrong would over-normalize early and make
the build-up dim instead of bright.

The contrast vs the prior photo-develop trick (fixed `totalSamples = q=50 × W ×
H`) is deliberate: photo-develop locked the shape in within ~1 second and only
exposure ramped; literal-landing genuinely shows the chaos game converging.

#### Settle

When `samplesAccumulated ≥ q=50 × W × H` (or `buildUpSec` elapses, whichever
first), do one final present with density on and tone-normalized to the actual
sample count:

```ts
present({
  genome,
  outputView,
  totalSamples: samplesAccumulated,
  forceDeOff:   false,                 // density estimation → smooth
})
```

Crossfade the tone curve over 500ms to soften the dotty→smooth transition. The
reveal moment — dots melt into a coherent flame — is the visual payoff of
build-up.

#### Oversample cap

Build-up renders at `oversample = min(genome.oversample, 2)` — the same cap
the slideshow path already applies in `renderFlameToQuality`. The hero genome's
native oversample of 4 would quadruple the histogram cell count (8.3M → 33M),
pinning the GPU on every present pass. Cap applies to BOTH modes for parity.

#### Adaptive cadence

Target 30fps. If a frame's GPU work measures over ~25ms wall-clock (approaching
the 33ms budget @ 30fps), thin to 20fps for that flame. For very short
build-ups (<10s), per-frame iter count grows linearly and may push the adaptive
backoff; for very long build-ups (>30min), per-frame iter count shrinks to the
fuse floor (200) and natural dispatch rate drops to ~1Hz — fine, samples still
visibly land at the new cadence.

### 4.2.1 Build-up tuning knobs

User-tunable via the landing card (Quality ladder, mode-conditional):

```text
prefs.buildUpQ           50      final quality target (DEFAULTS.buildUpQ; range 10..500)
```

Locked in `screensaver-mount.ts` (not user-exposed):

```text
BUILD_UP_TARGET_FPS      30      build-up dispatch cadence
BUILD_UP_WALKERS         1024    walker pool per dispatch
BUILD_UP_FUSE            200     per-dispatch walker warm-up (paid every frame)
SCREENSAVER_MAX_OS         2     oversample cap (applies to build-up AND slideshow)
SETTLE_CROSSFADE_MS      500     dotty→smooth tone transition at settle (deferred — hard cut for v1)
ADAPTIVE_BACKOFF_MS       25     drop to 20fps when a frame exceeds this wall-clock (deferred — fixed cadence for v1)
```

### 4.2.2 Cost model (hero @ 1080p, oversample=2, buildUpSec=30)

```text
histogram cells:     3840 × 2160       = 8.3M       (was 33M w/o cap fix)
target samples:      50 × 2,073,600    = 103.7M
frames @ 30fps:      900
samples per frame:   ~115k             (≈ 112 splat iters/walker + 200 fuse)
chaos iters/frame:   ~319k             (~3ms GPU on consumer hardware)
visualize/frame:     2M pixels         (~1ms GPU)
total per-frame:     ~4-5ms            (well under 33ms budget @ 30fps)
```

Compared to the photo-develop loop this replaces (4.2M iters @ every 500ms tick
plus density-pass on a 33M-cell histogram, ~99% GPU sustained):
literal-landing uses ~13% of the GPU time per second. The lockup goes away
because the GPU genuinely has headroom, not because work is paced more
politely.

## 5. Queue + navigation

`screensaver-queue.ts` exports a `ScreensaverQueue`:

```text
next():    advance, returns next genome ref; appends to history
prev():    pop from history (up to 50 back); revert visual state
peek():    look at next without advancing (for prefetch)
shuffle(): re-randomize when reaching corpus end (effectively never with 52k)
```

Backing source: the existing corpus index wired for `/v1/gen/N/id/N` deep links.
Random pick uses a session-scoped RNG seeded at mount time (deterministic per
session for unit-testability).

Skip controls:

- `←` / `→` arrow keys
- Tiny prev/next buttons inside the "now playing" pill (visible on cursor-active)
- Spacebar = pause/resume
  - Build-up: freeze sample-pacing scheduler (per-frame loop pauses; samples already in histogram remain on screen)
  - Slideshow: freeze hold timer; prefetch may continue

## 6. Transitions

Two transition behaviors, picked by mode:

```text
slideshow → crossfade 1.5s, ease-in-out, alpha blend old↔new
build-up  → outgoing alpha→0 over 2s (fade-to-black),
            held black 200ms,
            new flame starts iterating from empty histogram
```

Implementation:

- Slideshow uses a second `<canvas>` layer on top; the layer that holds the
  prefetched-next animates `opacity` 0→1 via CSS transition while the underlying
  layer holds `opacity` 1→0 over the same window. Swap layer roles after.
- Build-up animates the single canvas's CSS opacity → 0 over 2s, then resets the
  renderer histogram, then animates opacity back to 1 as the new flame begins
  iterating.

User-initiated skip (←/→) during a transition: cancel the in-flight transition
(snap to its end state), then start the new flame's transition from scratch.
Hitting skip rapidly never queues — each press resolves immediately against
the latest known queue position.

## 7. Settings + persistence

`screensaver-prefs.ts` reads/writes one localStorage key:

```text
key:  pyr3.screensaver.prefs
shape:
  {
    "mode":       "slideshow" | "build-up",
    "buildUpSec": 300,
    "restSec":    30,
    "holdSec":    15,
    "buildUpQ":   50,
    "slideshowQ": 100,
    "version":    2
  }
```

Loaded on landing-page mount; written on every settings change (debounced 200ms).
Missing → defaults: `build-up`, 300s, 30s, 15s, q=50, q=100. Version bump =
clear + use defaults (v1 stored prefs were retired with the quality-knob ship
2026-06-05).

Ladder + freeform input ranges:

```text
control          presets                       default   min    max     mode
---------------  ----------------------------  --------  -----  ------  ---------
Build-up time    30s · 60s · 5min · 10min      300s      5s     3600s   build-up
Rest period      10s · 30s · 60s · 2m          30s       0s     600s    build-up
Quality          50 · 100 · 200 · 500          50        10     500     build-up
Slideshow hold   5s · 15s · 30s · 60s          15s       1s     600s    slideshow
Quality          50 · 100 · 200 · 500          100       10     500     slideshow
```

Freeform input is a typed numeric field next to the ladder, accepting values in
seconds (or `Nm` shorthand → seconds). Out-of-range entries clamp to min/max
and visually highlight the clamp.

## 8. Keyboard + controls

The cheat-sheet renders as a permanent strip at the bottom of `/v1/screensaver`
in every state (see §3.1). Bindings:

```text
Space            pause / resume
← / →            prev / next flame
F                toggle fullscreen
Esc              exit fullscreen (keeps playing); from windowed = no-op
S                show settings card (stop + return to landing view)
```

Cursor activity within 2s of motion → show the "now playing" pill with click
versions of the same controls. Cursor idle 2s → pill auto-hides. The bottom
strip never auto-hides.

## 9. Fullscreen

Standard `element.requestFullscreen()` on the canvas's outer wrapper (so the
controls strip stays anchored to the bottom edge). Esc / `fullscreenchange` event
returns to windowed without stopping playback. Rendering loop, queue position,
and history survive the transition.

## 10. Out of scope (deferred to follow-up issues)

- Vault as source (waits on #107).
- Idle auto-launch from viewer/gallery after N minutes.
- Cast / Chromecast / external-display routing.
- User-curated playlists.
- Audio.
- Per-genome favorites / tags filter (waits on vault).
- Custom transitions (zoom, dissolve, etc.).
- Mode-mixing within a session.

## 11. Testing

- `screensaver-queue.test.ts` — shuffle determinism with seeded RNG;
  prev/next/history semantics; history cap at 50; peek doesn't advance.
- `screensaver-prefs.test.ts` — localStorage load/save; version migration;
  default fallback; debounce; clamp behavior; `Nm`-shorthand parser.
- `screensaver-mount.test.ts` — build-up pacing scheduler (samplesPerFrame
  computation from buildUpSec; fuse-aware splat accounting); mode-transition
  state machine; pause behavior; queue-driven advance. Uses the in-memory
  canvas + renderer-stub pattern from `edit-mount.test.ts`.
- `screensaver-ui.test.ts` — ladder + freeform input two-way sync (analogous to
  the `bar/panel ladder` pattern documented for Size/Quality/SETTLE).
- Chrome verify (golden path):
  1. Land on `/v1/screensaver` → settings card + controls strip visible;
     defaults loaded.
  2. Click Play → build-up render begins; settings card collapses to pill.
  3. Press F → fullscreen; controls strip still pinned to bottom edge.
  4. Press → → fade-to-black, next flame begins from empty.
  5. Press Space → render pauses; Space → resumes.
  6. Press Esc → windowed; rendering continues; pill + strip both visible.
  7. Press S → returns to landing settings card; playback stops.
  8. Reload → settings persisted.

## 12. Acceptance / done-when

- `/v1/screensaver` renders the landing page with the standard top bar +
  settings card + permanent controls strip.
- Mode + 3 timing values persist across sessions.
- Both modes work end-to-end with their respective transitions.
- Skip (←/→) works in both directions; spacebar pauses; S returns to landing.
- Fullscreen via F or button; Esc returns to windowed without stopping playback.
- Permanent controls strip visible in landing, windowed-running, and fullscreen.
- Unit suite + Chrome verify both green.
