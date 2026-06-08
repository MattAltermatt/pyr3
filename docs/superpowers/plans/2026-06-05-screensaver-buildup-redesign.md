# Screensaver build-up redesign — literal pixel-landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the build-up loop's photo-develop trick (locks GPU, shape pops in within 1s) with a literal-pixel-landing loop where the chaos game visibly converges over `buildUpSec`. Each frame splats a small fresh slice of samples and the image goes from sparse-bright-dots → dense-bright → smooth-on-settle.

**Architecture:** Single-file edit to `screensaver-mount.ts` plus a pure-math helper in `screensaver-pacing.ts`. NO engine changes: chaos kernel, renderer, density, visualize all untouched. The fix exploits APIs that already exist — `iterate()` accepts arbitrary `walkers`/`iters` (bypassing the `computeDispatch` floor); `present()` accepts `totalSamples` (we pass accumulated, not fixed-target) and `forceDeOff` (we disable density during build-up, enable at settle). Plus a one-line bug fix: apply `SCREENSAVER_MAX_OS` cap in the build-up resize() that was silently missing.

**Tech Stack:** TypeScript, WebGPU, Vitest (unit), Chrome DevTools MCP (verify).

**Spec reference:** `docs/superpowers/specs/2026-06-05-screensaver-design.md` §4.2.

---

## File Structure

```text
src/
  screensaver-pacing.ts        +samplesPerFrameForBuildUp helper (pure math)
  screensaver-pacing.test.ts   +describe block: per-frame sample math
  screensaver-mount.ts         rewrite startBuildUp() loop (~lines 582-784);
                                 new constants; apply SCREENSAVER_MAX_OS cap;
                                 swap import (qTarget → samplesPerFrameForBuildUp)
```

No new files. No engine-module edits. No shader edits.

---

## Task 1 — Add `samplesPerFrameForBuildUp` pacing helper

**Files:**
- Modify: `src/screensaver-pacing.ts`
- Test: `src/screensaver-pacing.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/screensaver-pacing.test.ts`:

```ts
import { qTarget, BUILD_UP_TARGET_Q, samplesPerFrameForBuildUp } from './screensaver-pacing';

// ... existing qTarget describe block stays ...

describe('samplesPerFrameForBuildUp', () => {
  it('computes per-frame samples for q=50 at hero dims, 30s, 30fps', () => {
    // 50 × 1920 × 1080 = 103,680,000 total; / (30 × 30 frames) = 115,200/frame
    expect(samplesPerFrameForBuildUp(50, 1920, 1080, 30, 30)).toBeCloseTo(115_200);
  });

  it('returns the total budget for buildUpSec=0 (immediate finish)', () => {
    // q=50 × 100×100 = 500_000 — all-in-one-frame.
    expect(samplesPerFrameForBuildUp(50, 100, 100, 0, 30)).toBe(500_000);
  });

  it('returns the total budget for fps=0 (degenerate)', () => {
    expect(samplesPerFrameForBuildUp(50, 100, 100, 30, 0)).toBe(500_000);
  });

  it('scales inversely with buildUpSec', () => {
    const a = samplesPerFrameForBuildUp(50, 1920, 1080, 30, 30);
    const b = samplesPerFrameForBuildUp(50, 1920, 1080, 60, 30);
    expect(a / b).toBeCloseTo(2);
  });

  it('scales inversely with fps', () => {
    const a = samplesPerFrameForBuildUp(50, 1920, 1080, 30, 30);
    const b = samplesPerFrameForBuildUp(50, 1920, 1080, 30, 60);
    expect(a / b).toBeCloseTo(2);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx vitest run src/screensaver-pacing.test.ts
```

Expected: 5 tests in the new describe fail with `samplesPerFrameForBuildUp is not a function`.

- [ ] **Step 3: Add the helper**

Append to `src/screensaver-pacing.ts`:

```ts
// Build-up sample-pacing: how many post-fuse splatted samples per frame to
// land q = BUILD_UP_TARGET_Q × width × height at exactly buildUpSec @ fps.
//
// The mount loop uses this to size each frame's chaos.iterate() dispatch
// (splat iters per walker = ceil(samplesPerFrame / walkers)). Degenerate
// inputs (buildUpSec=0 or fps=0) collapse to the total budget — the loop
// finishes in one frame.
export function samplesPerFrameForBuildUp(
  targetQ: number,
  width: number,
  height: number,
  buildUpSec: number,
  fps: number,
): number {
  const total = targetQ * width * height;
  if (buildUpSec <= 0 || fps <= 0) return total;
  return total / (buildUpSec * fps);
}
```

- [ ] **Step 4: Run the test, confirm pass**

```bash
npx vitest run src/screensaver-pacing.test.ts
```

Expected: all tests pass (existing 6 qTarget tests + 5 new samplesPerFrameForBuildUp tests).

- [ ] **Step 5: Commit**

```bash
git add src/screensaver-pacing.ts src/screensaver-pacing.test.ts
git commit -m "feat(#109): screensaver-pacing — samplesPerFrameForBuildUp helper"
```

---

## Task 2 — Rewrite `startBuildUp` loop for literal pixel-landing

**Files:**
- Modify: `src/screensaver-mount.ts` (replace `startBuildUp` function ~lines 582-784; update import line 16; add 3 new module-level constants near existing ones at ~line 52-58)

This is the load-bearing task. The replacement is mechanical — all logic decisions are locked in the spec — but the diff is large, so the steps below walk through it in two parts (constants/import first, then the function body).

- [ ] **Step 1: Update the import line**

Find at `src/screensaver-mount.ts:16`:

```ts
import { qTarget, BUILD_UP_TARGET_Q } from './screensaver-pacing';
```

Replace with:

```ts
import { BUILD_UP_TARGET_Q, samplesPerFrameForBuildUp } from './screensaver-pacing';
```

(`qTarget` is no longer used in mount; it stays exported from `screensaver-pacing.ts` and remains tested — its removal from this import is the only change there.)

- [ ] **Step 2: Add new module-level constants**

Find the existing constants block near `src/screensaver-mount.ts:52-58`:

```ts
const CANVAS_MAX_W = 1920;
const CANVAS_MAX_H = 1080;
const CANVAS_MIN_DIM = 256;
// Genomes typically set oversample 1-4. For real-time screensaver render
// we cap at 2 — going to 4 quadruples the histogram size and present cost
// for marginal visible-quality gain on a fullscreen canvas.
const SCREENSAVER_MAX_OS = 2;
```

Append, directly after `SCREENSAVER_MAX_OS`:

```ts

// Build-up loop tuning (spec §4.2.1). Fixed; not user-exposed.
// 30fps cadence with 1024 walkers × ~112 splat iters per walker per frame
// lands ~115k samples/frame at hero dims (1080p × OS=2), reaching q=50
// over 30s buildUpSec at ~13% sustained GPU. See spec §4.2.2 cost model.
const BUILD_UP_TARGET_FPS = 30;
const BUILD_UP_WALKERS    = 1024;
const BUILD_UP_FUSE       = 200;
```

- [ ] **Step 3: Replace the `startBuildUp` function body**

Find the entire `startBuildUp` function in `src/screensaver-mount.ts`. It currently starts at line 582:

```ts
function startBuildUp(args: {
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasHost: HTMLElement;
  prefs: ScreensaverPrefs;
  status: StatusPanel;
}): ModeHandle {
```

…and ends with the closing brace + `return` block at approximately line 784. Replace the entire function (from the `function startBuildUp(...)` line through its final closing `}`) with the version below.

```ts
function startBuildUp(args: {
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasHost: HTMLElement;
  prefs: ScreensaverPrefs;
  status: StatusPanel;
}): ModeHandle {
  const { device, format, canvasHost, prefs, status } = args;
  const state = createModeState();
  const isCancelled = () => state.cancelled;

  void (async () => {
    const canvas = makeRenderCanvas(canvasHost);
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return;
    ctx.configure({ device, format, alphaMode: 'opaque' });

    const renderer: Renderer = createRenderer(device, format, {
      width: W,
      height: H,
      oversample: 1,
      filterRadius: DEFAULT_FILTER_RADIUS,
    });

    status.setText('Loading corpus index…');
    const index = await loadFeatureIndex();
    if (isCancelled()) return;
    const allRefs = pickSourceRefs(index.filter(() => true));
    if (allRefs.length === 0) return;
    const queue = createScreensaverQueue(allRefs, Math.floor(performance.now()));
    let flameNum = 0;

    while (!isCancelled()) {
      const ref =
        state.skipDir === -1
          ? (queue.prev() ?? queue.next())
          : queue.next();
      state.skipDir = 0;
      if (!ref) break;
      flameNum++;
      let genome: Genome;
      try {
        status.setText(`Loading flame #${flameNum} (${ref.gen}/${ref.id})…`);
        genome = await loadGenomeByRef(ref);
      } catch {
        continue;
      }
      if (isCancelled()) return;

      // Apply screensaver oversample cap (parity with slideshow's
      // renderFlameToQuality at ~line 400). Without this, hero genome's
      // native OS=4 quadruples the histogram (8.3M → 33M cells) and pins
      // the GPU on every present pass — the original lockup.
      const overs = Math.min(SCREENSAVER_MAX_OS, genome.oversample ?? 1);
      const filt  = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
      renderer.resize({ width: W, height: H, oversample: overs, filterRadius: filt });
      renderer.reset(genome);

      const startedAt = performance.now();
      state.pauseAccumMs = 0;
      state.pausedAt = 0;
      let samplesAccumulated = 0;

      canvas.style.transition = '';
      canvas.style.opacity = '1';

      const totalPixels = W * H;
      const targetTotalSamples = BUILD_UP_TARGET_Q * totalPixels;

      // Pacing math: per spec §4.2 — distribute the q=50 sample budget
      // evenly across buildUpSec × fps frames. splatItersPerWalker is the
      // number of POST-FUSE iters each walker runs each frame; the chaos
      // kernel only splats post-fuse iters into the histogram.
      const samplesPerFrame = samplesPerFrameForBuildUp(
        BUILD_UP_TARGET_Q, W, H, prefs.buildUpSec, BUILD_UP_TARGET_FPS,
      );
      const splatItersPerWalker  = Math.max(1, Math.ceil(samplesPerFrame / BUILD_UP_WALKERS));
      const totalItersPerWalker  = BUILD_UP_FUSE + splatItersPerWalker;
      const FRAME_INTERVAL_MS    = 1000 / BUILD_UP_TARGET_FPS;

      while (!isCancelled()) {
        if (state.skipDir !== 0) break;
        if (state.paused) {
          if (state.pausedAt === 0) state.pausedAt = performance.now();
          await new Promise<void>((r) => setTimeout(r, 100));
          continue;
        }
        if (state.pausedAt !== 0) {
          state.pauseAccumMs += performance.now() - state.pausedAt;
          state.pausedAt = 0;
        }

        const frameStart = performance.now();

        // Fresh ISAAC seed every frame — same seed would re-render the
        // identical scatter pattern and just brighten the same cells
        // (chaos.ts:259-260 re-inits ISAAC from `seed` on every dispatch).
        const seed = (Math.random() * 0xffffffff) >>> 0;
        renderer.iterate({
          genome,
          seed,
          walkers:        BUILD_UP_WALKERS,
          itersPerWalker: totalItersPerWalker,
        });
        // Splatted samples = walkers × (iters - fuse). The first
        // BUILD_UP_FUSE iters per walker are warm-up; only post-fuse
        // iters scatter. Tracking the raw walkers × iters total would
        // over-normalize the tonemap by ~64% (200/(200+112)) and the
        // build-up would look incorrectly dim.
        samplesAccumulated += BUILD_UP_WALKERS * splatItersPerWalker;

        // Tone-normalize against ACCUMULATED samples (not the fixed-target
        // total used by the old photo-develop trick) AND skip density.
        // Each new sample lands bright; the image densifies frame by frame
        // rather than self-darkening. forceDeOff: true is required even
        // when genome.density is undefined (renderer.ts:203 useDE rule)
        // to make the intent explicit.
        renderer.present({
          genome,
          outputView:   ctx.getCurrentTexture().createView(),
          totalSamples: Math.max(1, samplesAccumulated),
          forceDeOff:   true,
        });

        const elapsed = (performance.now() - startedAt - state.pauseAccumMs) / 1000;
        const pct     = Math.min(100, Math.round(100 * samplesAccumulated / targetTotalSamples));
        status.setText(
          `Building flame #${flameNum} (${ref.gen}/${ref.id})\n` +
          `${elapsed.toFixed(1)}s / ${prefs.buildUpSec}s · ` +
          `samples ${(samplesAccumulated / 1e6).toFixed(1)}M / ${(targetTotalSamples / 1e6).toFixed(1)}M · ${pct}%` +
          (state.paused ? ' · PAUSED' : ''),
        );

        if (samplesAccumulated >= targetTotalSamples) break;
        if (elapsed >= prefs.buildUpSec) break;

        const frameElapsed = performance.now() - frameStart;
        const sleepFor     = Math.max(1, FRAME_INTERVAL_MS - frameElapsed);
        await new Promise<void>((r) => setTimeout(r, sleepFor));
      }
      if (isCancelled()) return;

      // Settle: density ON, tone-normalize to actual accumulated samples.
      // This is the dotty → smooth reveal — the chaos game's coherent
      // attractor emerges via the density pass + log tonemap.
      renderer.present({
        genome,
        outputView:   ctx.getCurrentTexture().createView(),
        totalSamples: Math.max(1, samplesAccumulated),
        forceDeOff:   false,
      });

      // Rest period — hold settled image at full quality. Skip signal
      // shortcircuits; pause extends.
      const restStart = performance.now();
      const restTick = window.setInterval(() => {
        const e = Math.min(prefs.restSec, (performance.now() - restStart) / 1000);
        status.setText(
          `Flame #${flameNum} (${ref.gen}/${ref.id}) settled\n` +
          `resting ${e.toFixed(0)}s / ${prefs.restSec}s` +
          (state.paused ? ' · PAUSED' : ''),
        );
      }, 500);
      const restReason = await sleepInteractive(prefs.restSec * 1000, state);
      window.clearInterval(restTick);
      if (restReason === 'cancelled') return;

      // Fade-to-black ~2s, then advance.
      status.setText(`Fading out flame #${flameNum}…`);
      canvas.style.transition = 'opacity 2s';
      canvas.style.opacity = '0';
      await sleepCancellable(2200, isCancelled);
    }
  })();

  return {
    cancel() {
      state.cancelled = true;
    },
    controls: {
      togglePause() {
        state.paused = !state.paused;
      },
      isPaused() {
        return state.paused;
      },
      skip(dir) {
        state.skipDir = dir;
      },
    },
  };
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean exit (no TS errors). Do NOT pipe through `tail` — memory `feedback-no-tail-for-passfail` says always check the full output and the exit code.

- [ ] **Step 5: Run the unit suite (smoke + pacing)**

```bash
npm test
```

Expected: all existing tests still pass, including the 5 new pacing tests from Task 1. The existing `screensaver-mount.test.ts` smoke tests (renders card, hides on Play, Stop returns to landing) all still work — they don't exercise the build-up loop's GPU path, only its mount/unmount/state surface, which this rewrite preserves.

- [ ] **Step 6: Commit**

```bash
git add src/screensaver-mount.ts
git commit -m "feat(#109): build-up — literal pixel-landing (sparse dots → smooth settle)"
```

---

## Task 3 — Code review (subagent, fresh context, no implementation bias)

**Files:** none (review-only)

- [ ] **Step 1: Dispatch the reviewer**

Use the Agent tool with `subagent_type: feature-dev:code-reviewer`. Prompt the subagent with:

```text
Review the diff applied in commits since main on branch feature/issue-109-screensaver
that touch:
  - src/screensaver-mount.ts (startBuildUp rewrite)
  - src/screensaver-pacing.ts (+samplesPerFrameForBuildUp)
  - src/screensaver-pacing.test.ts (+samplesPerFrameForBuildUp tests)

Spec the diff implements: docs/superpowers/specs/2026-06-05-screensaver-design.md §4.2.

Context the change replaces: a "photo-develop" tonemap trick that locked the GPU
at 98% and made the flame's shape pop in within ~1 second (only brightness
ramped). The new loop dispatches tiny chaos batches at 30fps with fresh seeds,
no density estimation, tone-normalized to accumulated samples — so samples
literally land on screen frame by frame, ending in a density-pass settle.

Focus the review on:
  1. CORRECTNESS — does samplesAccumulated correctly track post-fuse splatted
     samples (walkers × (iters - fuse))? Tone-normalization will be wrong if
     this drifts.
  2. STATE MACHINE — pause / skip / cancel / rest / fade-out edge cases.
     Specifically: does pause correctly accumulate state.pauseAccumMs across
     multiple pause cycles? Does skip mid-iteration land at the next flame?
  3. PERF — any per-frame allocations or buffer creations that escaped notice?
     (The whole point is to NOT lock the GPU.)
  4. REGRESSIONS — does anything about the rewrite break the slideshow path
     in the same file, or the landing-card / pill / strip / status panel
     wiring that screensaver-mount.test.ts depends on?

Report only HIGH-CONFIDENCE findings. Skip nitpicks. If you find a bug,
include the file:line and the proposed fix.
```

- [ ] **Step 2: Address any high-confidence findings**

If the reviewer surfaces a real bug, fix it in `src/screensaver-mount.ts` (or wherever applicable). Re-run `npm run typecheck && npm test`. Commit:

```bash
git add src/screensaver-mount.ts  # (or whatever the reviewer flagged)
git commit -m "fix(#109): <one-line description of the reviewer-surfaced bug>"
```

If the reviewer finds no high-confidence issues, skip to Task 4 with no extra commit.

---

## Task 4 — Chrome verify on hero genome (USER-DRIVEN)

**Files:** none (manual verification)

This is the load-bearing user gate. Per `feedback-explicit-ship-approval`, the user must explicitly approve before FF-merge to main. The lead's job here is to set up the verify environment cleanly and surface what to look at.

- [ ] **Step 1: Start the dev server in the background**

```bash
npm run dev
```

Run this in background (no `&` — use the Bash tool's `run_in_background: true`). Vite logs the listening port (usually `:5173`; bumps to `:5174` if 5173 is taken). Read the actual URL from stdout — don't hard-code 5173.

- [ ] **Step 2: Hand the user the verify URL**

Emit on its own line in chat (per `feedback-clickable-file-urls`, plain http URLs are also click-targets in the user's terminal):

```text
http://localhost:5173/v1/screensaver?hero=true
```

(`?hero=true` locks the queue to the canonical hero flame `electricsheep.247.19679` so visual comparison against the viewer is deterministic.)

- [ ] **Step 3: Surface the verify checklist in the same message**

Per `feedback-qa-checklist-after-ship`, hand the user a fenced checkbox list of what to look at:

```text
- [ ] Land on /v1/screensaver — settings card visible, defaults loaded
- [ ] Set "Build-up time" to 30s via the text input (default is 300s = too long for a verify)
- [ ] Click Play — canvas shows immediate scatter of bright dots, NOT a black screen
      with brightness ramping up. The shape should physically take form.
- [ ] Over the first ~5 seconds, dots should densify visibly — NOT just brighten
- [ ] Check Activity Monitor / GPU usage during build-up — should be under ~30%,
      not pinned at 98%
- [ ] Laptop cursor should stay responsive; no stalls
- [ ] At t=30s, observe the settle moment — the dotty image should snap to a smooth,
      coherent flame in one frame (this is the dotty → smooth reveal)
- [ ] After settle, observe the rest period status panel (30s default)
- [ ] After rest, fade-to-black ~2s, then the next flame begins
- [ ] Hit Space — build-up should pause; samples stop landing; resume continues
- [ ] Hit → — current flame fades, next flame begins building
- [ ] Hit F — fullscreen; the build-up animation continues; bottom strip + pill hide
- [ ] Hit Esc — exits fullscreen; build-up continues windowed
```

- [ ] **Step 4: Wait for the user's verdict**

Do NOT auto-merge or auto-push. The user replies with:
- **"approved"** / **"looks good"** / **"ship it"** — proceed to Task 5
- **"<specific issue>"** — diagnose, fix, re-verify (loop back to Step 1 of Task 2 or Task 3 depending on scope)

Per `feedback-explicit-ship-approval`, content-approval is NOT shipping-approval. Even if the user says "looks great", do not FF-merge without an explicit "merge to main".

---

## Task 5 — FF-merge to main (USER-AUTHORIZED ONLY)

**Files:** none (git ops)

Only execute after the user explicitly says "FF-merge" / "merge to main" / equivalent. Per `feedback-ship-approval-not-transitive`, prior approvals do not chain.

- [ ] **Step 1: Verify state before merge**

```bash
git status
git log main..HEAD --oneline
npm run typecheck
npm test
```

Expected: clean tree, commits ahead of main visible, typecheck clean, tests green.

- [ ] **Step 2: (Optional) Squash if user prefers a single shipping commit**

If the user prefers a squashed log (per global "Squash feature-branch commits before FF-merge when safe"), do:

```bash
git reset --soft main
git commit -m "feat(#109): screensaver build-up — literal pixel-landing"
```

Or leave the per-task commits intact if user prefers granular history. Ask if unclear.

- [ ] **Step 3: FF-merge**

```bash
git checkout main
git merge --ff-only feature/issue-109-screensaver
git push origin main
```

(`--ff-only` ensures no merge commit. Pushing main is the deploy trigger — pyr3.app auto-deploys via GitHub Actions per `project-deploy-mechanism`.)

- [ ] **Step 4: Validate the live deploy**

Per `feedback-verify-live-before-claiming-ship`: don't claim shipped until the live URL serves the new code.

```bash
gh run watch  # wait for deploy.yml to finish
```

Then open `https://pyr3.app/v1/screensaver?hero=true`, click Play, confirm the same literal pixel-landing behavior verified locally. ONLY then is this shipped.

- [ ] **Step 5: Session-end cleanup (user-standing-authorized per global CLAUDE.md)**

If on `main`, tree clean, AND `git reflog | grep "merge feature/issue-109-screensaver.*Fast-forward"` returns a match THIS session:

```bash
git branch -D feature/issue-109-screensaver
git push origin --delete feature/issue-109-screensaver
```

Otherwise leave the branch in place.

---

## Self-Review

**Spec coverage** — spec §4.2 sections checked against tasks:

```text
§4.2 main description           — Task 2 Step 3 (new loop)
§4.2 Pacing                     — Task 1 (samplesPerFrame helper); Task 2 (call site)
§4.2 Per-frame dispatch         — Task 2 Step 3 (iterate call with fresh seed + walkers/iters)
§4.2 Per-frame present          — Task 2 Step 3 (present with samplesAccumulated + forceDeOff)
§4.2 Settle                     — Task 2 Step 3 (final present with forceDeOff: false)
§4.2 Oversample cap             — Task 2 Step 3 (Math.min(SCREENSAVER_MAX_OS, ...))
§4.2 Adaptive cadence           — DEFERRED to follow-up (v1 ships fixed 30fps; see note below)
§4.2.1 Tuning knobs             — Task 2 Step 2 (constants added)
§4.2.2 Cost model               — verified by Task 4 (Chrome GPU observation)
§11 Testing update              — Task 1 (pacing math tests cover the new helper)
```

**Adaptive cadence deferral note** — spec §4.2 mentions thinning to 20fps when frame work exceeds 25ms wall-clock. The cost model predicts ~4-5ms per frame at hero dims, so 30fps has ~5× headroom. The simple impl ships fixed 30fps; adaptive backoff goes to backlog if the Chrome verify shows it needed. Recorded in the spec under "Adaptive cadence" — the impl note here is that v1 doesn't include the backoff branch.

**Placeholder scan** — no TBD / TODO / "appropriate" / "similar to" found. All code blocks present.

**Type consistency** — `samplesPerFrameForBuildUp(targetQ, width, height, buildUpSec, fps)` — same signature in helper, test, and call site. `BUILD_UP_TARGET_Q` / `BUILD_UP_TARGET_FPS` / `BUILD_UP_WALKERS` / `BUILD_UP_FUSE` consistent across constants block and `startBuildUp` body.

**Plan ready to execute.**
