# #111 — Screensaver build-up video recording (Record mode)

**Status:** spec locked 2026-06-05 via brainstorming Q1–Q5.
**Branch:** `feature/issue-111-record` (to be created).
**Predecessor:** #109 (screensaver build-up + ramp curve), #104 (flame-name templates).

## Summary

Add a third **Record** mode to the screensaver landing card alongside
`Slideshow` and `Build-up`. Record renders one ESF flame's build-up while
piping the WebGPU canvas through `canvas.captureStream(30)` →
`MediaRecorder` (VP9), saves the result as a `.webm` blob at settle, and
returns to the landing card. One Start press → one clip.

This is *not* a side-button on the existing Build-up mode. It is a
dedicated mode with its own landing-card surface (mode tab + ladders +
flame picker + Start button) and its own in-session UI (simplified pill
+ status panel with `● rec` indicator).

## Locked design (Q1–Q5 results)

### Q1 — Mode tab, not button (pivoted from initial proposal)

Mode picker bumps from 2-button to 3-button:

```text
[ Slideshow ]  [ Build-up ]  [ Record ]
```

`screensaver-ui.ts`'s `.pyr3-screensaver-mode-row` grid changes from
`grid-template-columns: 1fr 1fr` to `1fr 1fr 1fr`. New
`recordBtn` parallels `buildUpBtn` / `slideshowBtn`.

### Q2 — Single-shot recording (A)

One Start press → next picked flame builds + records → `.webm` downloads
→ landing card returns. User presses Start again for another. No queued
sequence; no batch downloads.

### Q3 — Picker: thumbnail + Random (B)

Record tab shows:

- **Live-rendered thumbnail** (~300×300 WebGPU canvas) of the currently
  picked flame.
- **`nick · gen/id` label** beneath the thumbnail.
- **Random button** — re-rolls a (gen, id) from the ESF corpus queue,
  re-renders the thumbnail.

No gen-dropdown, no id-input, no nick-search. Those belong in a separate
**reusable flame picker** issue (Vault, gallery-jump, viewer-pin also
need it). Filed at end of this session as a follow-up.

Thumbnail render quality target: ~50 samples/px, single oversample, no
DE, single present — fast enough that re-rolling feels instant
(<300ms wall on hero dims scaled to 300×300).

### Q4/Q5 mid — Filename ladder

```text
1.  ESF flame (corpus ref has gen+id)      → `electricsheep.<gen>.<id>.pyr3.webm`
2.  genome.name is a #104 template         → `<resolved-template>.pyr3.webm`
3.  genome.name is a plain string          → `<name>.pyr3.webm`
4.  genome.nick set, no name               → `<nick>.pyr3.webm`
5.  fallback                               → `pyr3-<YYYYMMDD-HHMM>.pyr3.webm`
```

Case 1 fires for every v1 Record clip (Random rolls from ESF corpus).
Cases 2–5 ladder against future entry paths (Vault, dropped local
`.flam3`, recorded-from-editor).

`.pyr3` infix is the load-bearing convention: signals "pyr3 render of a
flame" and groups all pyr3-generated artifacts together in `~/Downloads/`
by sort, distinct from raw video files. Leaves room for `.pyr3.png` and
`.pyr3.mp4` later.

Filename derivation lives in `src/screensaver-record-filename.ts`
(`deriveRecordingFilename(genome, ref?: SheepRef, now: Date)`). Reuses
`flame-name-template.ts:resolveTemplate` for case 2.

### Q5 — Recording session UX + end triggers

**Ladders shown on Record tab** (build-up minus rest):

- `Build-up time` (10s–5m) — controls clip length.
- `Quality` (10–500 samples/px) — controls how dense the settle is.
- `Ramp` (Linear / Gentle / Medium / Heavy) — controls how the chaos
  game lands over time. Visible in playback.
- **No Rest period** — the build-up loop reaches settle, recorder stops,
  download fires. No hold-on-screen state for Record.

**Pill controls during Record** (simplified from Build-up's pill):

```text
[ ⛶ Fullscreen ]  [ ⏹ Stop & save ]
```

No Pause, no Prev/Next. Pause + still-running recorder would produce
held frames in the .webm; skip mid-record would splice two flames into
one clip. Both break the "one flame, one clip" model.

**Status panel** (top-left, existing surface):

```text
Recording <nick or gen/id>
● 0:23 / 1:00 · samples 5.4M / 12.3M · ~3.4 MB
```

Size estimate accumulates `e.data.size` from `recorder.ondataavailable`;
running total updates every status tick.

**End triggers**:

| Path | Behavior |
|------|----------|
| Settle present fires (auto) | `recorder.stop()` → blob downloads → landing card returns |
| `⏹ Stop & save` (manual) | `recorder.stop()` → blob downloads (partial) → landing card returns |
| Esc / browser-back / tab-close | Cancel mode, no download (abort intent) |

Manual `⏹` saves on purpose — explicit click = "I want what I have."
Navigation-away discards because no save intent was expressed.

**Browser compat fallback**:

At module load, check
`MediaRecorder.isTypeSupported('video/webm;codecs=vp9')`. If false → the
Record mode-tab button is **disabled, not hidden** (per the
`disabled-over-hidden` UI rule — keeps the 3-button picker layout stable
for unsupported browsers). Tooltip on the disabled button:

> "Recording requires a Chromium-based browser"

## Out of scope (deferred, separate issues if pursued)

- GIF / MP4 / PNG-sequence export (one format ships; others slot in if
  asked).
- Slideshow-mode recording (crossfades don't have the build-up's visual
  story).
- Audio (screensaver is silent).
- Reusable flame picker (gen dropdown + id input + nick search) — filed
  as a follow-up issue this session.
- Per-recording filename template input (the flame already carries one
  via #104).
- "Record every flame in a session" queue mode (Q2 chose single-shot).
- WebGPU buffer-readback fallback for non-Chromium browsers (the
  disabled-tab fallback handles them; readback path is a separate
  ~L issue if demand surfaces).
- Multi-take comparison UI (record + auto-rerender same flame at
  different ramps for A/B).

## Architecture

### Module split

```text
src/
  screensaver-record.ts          NEW    — MediaRecorder lifecycle, blob → download
  screensaver-record-filename.ts NEW    — filename ladder (Q4)
  screensaver-record.test.ts     NEW    — filename ladder + recorder state machine
  screensaver-record-filename.test.ts NEW

  screensaver-ui.ts              EDIT   — add 3rd mode tab, Record ladders + picker host
  screensaver-mount.ts           EDIT   — runRecordSession() mode handle parallel
                                          to runBuildUpSession; simplified pill +
                                          recording-aware status panel
  screensaver-prefs.ts           EDIT   — add `mode: 'record'` to discriminated union;
                                          `recordTimeSec`, `recordQ`, `recordRamp`
                                          (mirror buildUp* fields minus rest)
  screensaver-pacing.ts          (none — ramp helpers reused as-is)
```

### Data shape

`ScreensaverPrefs` discriminated union extends from `{ mode: 'slideshow'
| 'build-up' }` to add `'record'`:

```ts
interface RecordModePrefs {
  mode: 'record';
  recordTimeSec: number;   // mirrors buildUpSec; CLAMPS unchanged
  recordQ: number;         // mirrors buildUpQ
  recordRamp: number;      // mirrors buildUpRamp
}
```

Prefs version bumps from 3 → 4. Migration: if `mode === 'record'` not
recognized in v3 prefs, default to `'build-up'`.

### Build-up loop reuse

`screensaver-mount.ts`'s build-up loop is the substrate for Record. The
Record mode handle:

1. Sets up canvas + renderer identically to Build-up.
2. Calls `loadGenomeByRef(pickedRef)` for the user-selected flame (NOT
   queue-pulled — the picker locked it before Start).
3. Runs the same iterate/present loop, parameterized on
   `recordTimeSec/recordQ/recordRamp` (read from prefs at Start).
4. **Hooks at frame 0**: start recorder. **Hook at settle**: stop
   recorder.

The build-up loop's exit conditions (`samplesAccumulated >=
targetTotalSamples` || `elapsed >= buildUpSec`) are unchanged. Record
adds a `onSettle` callback into the same loop rather than copying it.

### MediaRecorder lifecycle (`src/screensaver-record.ts`)

```ts
interface RecorderHandle {
  start(): void;                       // arms recorder at frame 0
  stop(save: boolean): Promise<void>;  // settle (save=true) or abort (save=false)
  elapsedMs(): number;
  bytesAccumulated(): number;
}

function createRecorder(canvas: HTMLCanvasElement, filename: string): RecorderHandle;
```

Internally:

- `stream = canvas.captureStream(30)`
- `recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })`
- `chunks: Blob[]`; `bytes: number = 0`
- `ondataavailable`: push chunk, increment `bytes`
- `stop(save)`: await `recorder.onstop`; if `save`, build `Blob(chunks)`
  + trigger anchor-download with the precomputed filename.

### Thumbnail rendering on the picker

`mountScreensaverLanding(host, opts)` extends to take the WebGPU
device/format so the Record tab's thumbnail canvas can render live.

Picker lifecycle:

1. On Record tab activation: pick a random `(gen, id)` from the ESF
   index; render thumbnail at ~300×300, ~50 samples/px, no oversample,
   no DE.
2. On Random click: pick new `(gen, id)`, re-render thumbnail.
3. On Start click: write prefs, hand the picked `SheepRef` + the Record
   ladders to `mountScreensaverPage` (so the canvas knows which flame
   to load — bypasses the queue for Record).

Thumbnail uses a separate `Renderer` instance scoped to the picker
canvas; teardown when leaving the Record tab.

## Tests

- `screensaver-record-filename.test.ts` — covers all 5 cases in the
  ladder; includes `.pyr3.webm` suffix invariant; uses pinned-clock for
  date formatting.
- `screensaver-record.test.ts` — state-machine tests around
  `start/stop(save)/stop(abort)`; mocks MediaRecorder; verifies
  `bytesAccumulated` accumulates `e.data.size`; verifies download anchor
  click on `save=true` only.
- `screensaver-prefs.test.ts` — extends with v3→v4 migration test;
  `mode: 'record'` round-trip; clamps on `recordTimeSec/recordQ`.
- `screensaver-ui.test.ts` — Record mode-tab present; 3rd column in
  mode row; Record ladders show/hide on tab switch; thumbnail container
  mounts.

No Playwright/headless test for the full record cycle — `MediaRecorder`
isn't reliably supported in headless Chromium and the cycle is verified
in Chrome manually per the project's verify-in-Chrome rule. The
disabled-tab fallback path IS testable in unit tests by mocking
`MediaRecorder.isTypeSupported`.

## Verification

- Open `http://localhost:5173/v1/screensaver` in Chrome.
- Confirm 3-tab mode picker; select Record; thumbnail renders ~300ms.
- Click Random a few times; thumbnail re-rolls; nick/gen-id label
  updates.
- Set Build-up time = 30s, Quality = 100, Ramp = Medium.
- Click Start; canvas mounts; status panel shows `Recording <…> · ● 0:14
  / 0:30 · samples X.YM / Z.ZM · ~N.NN MB`.
- Wait for settle; .webm downloads as
  `electricsheep.<gen>.<id>.pyr3.webm`; landing card returns.
- Open the .webm in QuickTime → black background, flame builds, settle
  visible at end. Heavy ramp visibly heavy on playback.
- Repeat with Heavy ramp at 60s; confirm clip length matches.
- Manual stop path: Start a 5-min build-up, hit `⏹ Stop & save` at 1:00,
  confirm a 1-minute clip lands.
- Abort path: Start, hit Esc, confirm nothing downloads.
- File size sanity: 60s @ hero dims should be <15MB per issue acceptance.

## Done-when

- Click Record on Record tab + Random + Start → next ~60s downloads as
  `electricsheep.<gen>.<id>.pyr3.webm`.
- Clip plays back at expected fps with the configured ramp visibly
  reflected.
- File size <15MB for a 60s hero-dim build-up clip.
- Unit tests (filename ladder + recorder state machine + prefs
  migration + UI rendering) green.
- Tested in Chrome at the verify URL; manual save path + abort path
  both behave per spec.
- `screensaver-ui.ts` mode row is visibly stable across all three
  modes (no width jump, no chrome flicker).
