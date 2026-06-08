# HSL Adjustments and Curves Lag Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HSL Adjustments panel and fix continuous-drag rendering lag for Color Curves (fast-lane edits).

**Architecture:** 
1. **WGSL & Genome:** Extend `Genome` and `VizUniforms` with `hslAdjust`. Update visualize WGSLs to perform HSV shifts on the post-tonemap color.
2. **Lag Fix:** Modify `requestLiveRender` in `edit-mount.ts` to support `FAST` lane execution and bypass the debounce scheduler.
3. **UI:** Create `edit-section-hsl.ts` and wire it up to the `edit-ui` layout and `edit-state.ts` lanes.

**Tech Stack:** TypeScript, WebGPU, WGSL

---

### Task 1: Genome and Serialize

**Files:**
- Modify: `src/genome.ts`
- Modify: `src/serialize.ts`
- Modify: `src/serialize.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// in src/serialize.test.ts
import { serializeGenome, parseGenome } from './serialize';
import { type Genome } from './genome';

describe('hslAdjust serialization', () => {
  it('roundtrips valid hslAdjust', () => {
    const genome: Genome = {
      palette: [], // Need valid mock palette
      paletteMode: 'indexed',
      xforms: [],
      hslAdjust: { hue: -45, sat: 150, light: 25 },
    };
    const json = serializeGenome(genome);
    const parsed = parseGenome(JSON.parse(json));
    expect(parsed.hslAdjust).toEqual({ hue: -45, sat: 150, light: 25 });
  });

  it('omits hslAdjust when identity (0, 100, 0)', () => {
    const genome: Genome = {
      palette: [],
      paletteMode: 'indexed',
      xforms: [],
      hslAdjust: { hue: 0, sat: 100, light: 0 },
    };
    const json = serializeGenome(genome);
    expect(JSON.parse(json).hslAdjust).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- serialize`
Expected: FAIL with "hslAdjust not serialized" or similar.

- [ ] **Step 3: Write minimal implementation**

```typescript
// in src/genome.ts
export interface Genome {
  // ... existing fields ...
  hslAdjust?: { hue: number; sat: number; light: number };
}

// in src/serialize.ts
export function serializeGenome(g: Genome): Record<string, unknown> {
  // ...
  if (g.hslAdjust && (g.hslAdjust.hue !== 0 || g.hslAdjust.sat !== 100 || g.hslAdjust.light !== 0)) {
    out.hslAdjust = { ...g.hslAdjust };
  }
  // ...
}

export function parseGenome(root: any): Genome {
  // ...
  if (root.hslAdjust) {
    base.hslAdjust = {
      hue: Number(root.hslAdjust.hue) || 0,
      sat: Number(root.hslAdjust.sat) ?? 100,
      light: Number(root.hslAdjust.light) || 0,
    };
  }
  // ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- serialize`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/genome.ts src/serialize.ts src/serialize.test.ts
git commit -m "feat: add hslAdjust to genome and serialize"
```

### Task 2: WGSL Visualize Pass

**Files:**
- Modify: `src/visualize.ts`
- Modify: `src/shaders/visualize_f32.wgsl`
- Modify: `src/shaders/visualize_u32.wgsl`

- [ ] **Step 1: Write implementation**

Update `VizUniforms` struct in both `src/shaders/visualize_f32.wgsl` and `src/shaders/visualize_u32.wgsl`:
```wgsl
  curvesActive: u32,
  hslActive: u32,
  hslHue: f32,    // in degrees (-180 to 180)
  hslSat: f32,    // multiplier (0.0 to 2.0)
  hslLight: f32,  // addend (-1.0 to 1.0)
  _pad7: u32,
  _pad8: u32,
  _pad9: u32,
```

In `src/shaders/visualize_f32.wgsl` and `src/shaders/visualize_u32.wgsl` inside `fs()` after color curves, add:
```wgsl
  if (u.hslActive != 0) {
    var hsv = rgb2hsv(out);
    hsv.x = hsv.x + u.hslHue;
    if (hsv.x < 0.0) { hsv.x += 360.0; }
    if (hsv.x >= 360.0) { hsv.x -= 360.0; }
    hsv.y = clamp(hsv.y * u.hslSat, 0.0, 1.0);
    hsv.z = clamp(hsv.z + u.hslLight, 0.0, 1.0);
    out = hsv2rgb(hsv);
  }
```

Update `src/visualize.ts`:
Change `UNIFORMS_BYTES` to 96.
Update `draw()` to take `hslAdjust?: { hue: number, sat: number, light: number }`.
Write to the uniforms buffer (offsets 68, 72, 76, 80).
```typescript
    const u32 = new Uint32Array(24); // 96 bytes / 4
    const f32 = new Float32Array(u32.buffer);
    // ... setup ...
    u32[16] = channelCurves ? 1 : 0;
    if (hslAdjust) {
      u32[17] = 1;
      f32[18] = hslAdjust.hue;
      f32[19] = hslAdjust.sat / 100.0;
      f32[20] = hslAdjust.light / 100.0;
    } else {
      u32[17] = 0;
    }
```

- [ ] **Step 2: Run compiler checks**

Run: `npm run tsc`
Expected: Passes (adjusting types if needed)

- [ ] **Step 3: Commit**

```bash
git add src/visualize.ts src/shaders/visualize_f32.wgsl src/shaders/visualize_u32.wgsl
git commit -m "feat: implement hslAdjust in visualize pass"
```

### Task 3: Edit Renderer Plumbing

**Files:**
- Modify: `src/renderer.ts`
- Modify: `src/edit-render.ts`

- [ ] **Step 1: Update renderer interfaces**

```typescript
// in src/renderer.ts
export interface PresentArgs {
  genome: Genome;
  outputView: GPUTextureView;
  totalSamples: number;
}
// inside present():
vizPass.draw(..., genome.channelCurves, genome.hslAdjust);
```

- [ ] **Step 2: Run compiler checks**

Run: `npm run tsc`
Expected: Passes

- [ ] **Step 3: Commit**

```bash
git add src/renderer.ts src/edit-render.ts
git commit -m "refactor: plumb hslAdjust through edit renderer"
```

### Task 4: Fix Color Curves Lag (Bypass Scheduler)

**Files:**
- Modify: `src/edit-mount.ts`

- [ ] **Step 1: Update requestLiveRender**

```typescript
// in src/edit-mount.ts
  let liveLane: Lane = 'fast';
  async function requestLiveRender(lane: Lane = 'slow'): Promise<void> {
    if (lane === 'rebuild' || liveLane === 'rebuild') liveLane = 'rebuild';
    else if (lane === 'slow' || liveLane === 'slow') liveLane = 'slow';

    if (liveInFlight) {
      liveDirty = true;
      return;
    }
    liveInFlight = true;
    do {
      liveDirty = false;
      const currentLane = liveLane;
      liveLane = 'fast'; // reset for next request
      
      inflightTicket++;
      const myTicket = inflightTicket;
      if (currentLane === 'slow' || currentLane === 'rebuild') {
        ensureLiveDims();
      }
      const view = ctx.getCurrentTexture().createView();
      const w = canvas.width;
      const h = canvas.height;
      const genome = (currentLane === 'slow' || currentLane === 'rebuild') ? liveAdjustedGenome() : state.genome;
      editRenderer.applyLane(currentLane === 'rebuild' ? 'slow' : currentLane, genome, state.seed, view, w, h, { targetSpp: previewCfg.quality });
      opts.onStateChange?.(state);
      await opts.device.queue.onSubmittedWorkDone();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    } while (liveDirty);
    liveInFlight = false;
  }
```

- [ ] **Step 2: Update onPathChange**

```typescript
// in onPathChange inside edit-mount.ts
    const lane = pathLane(path);
    if (lane === 'slow' || lane === 'rebuild' || lane === 'fast') {
      void requestLiveRender(lane);
      scheduleSettle();
    } else {
      // Keep for unforeseen lanes, though effectively everything goes through live loop now.
      scheduler.schedule({ lane, path });
    }
```

- [ ] **Step 3: Run checks**

Run: `npm run tsc`

- [ ] **Step 4: Commit**

```bash
git add src/edit-mount.ts
git commit -m "fix(#181): route FAST lane edits through requestLiveRender for instant feedback"
```

### Task 5: Editor Section UI

**Files:**
- Create: `src/edit-section-hsl.ts`
- Modify: `src/edit-state.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Implement Section**

Create `src/edit-section-hsl.ts` returning a `SectionMount`.
```typescript
import { type SectionMount } from './edit-ui';
import { scrubbyInput } from './edit-scrubby-input';
import { buildRow } from './edit-primitives';

export const hslSection: SectionMount = {
  key: 'hsl',
  title: '🎚 HSL ADJUSTMENTS',
  build(host, state, onChange) {
    // Scaffold UI with 3 scrubbyInputs for hue, sat, light.
    // Read from state.genome.hslAdjust or defaults (0, 100, 0).
    // Write back to state.genome.hslAdjust and call onChange('hslAdjust.*').
  }
};
```

- [ ] **Step 2: Hook up state & lane**

```typescript
// in src/edit-state.ts
export type SectionKey = /* ... */ | 'hsl';

// in createEditState()
sectionCollapse: {
  // ...
  hsl: true,
}

// in pathLane()
  if (path === 'hslAdjust' || path.startsWith('hslAdjust.')) return 'fast';
```

```typescript
// in src/main.ts
import { hslSection } from './edit-section-hsl';
// add to EDITOR_SECTIONS array
```

- [ ] **Step 3: Run checks**

Run: `npm run tsc`

- [ ] **Step 4: Commit**

```bash
git add src/edit-section-hsl.ts src/edit-state.ts src/main.ts
git commit -m "feat: add HSL Adjustments editor section"
```
