# Issue #172 & #181 Design: HSL Adjustments & Color Curves Lag

## #172: HSL Adjustments UI & Shader

**Purpose:** Add post-tonemap adjustments in HSV space via a dedicated editor panel. 
*Note: Color Curves stays exactly as it is (it already handles Composite, R, G, B, and Luma curves). This section handles Hue and Saturation which are conceptually sliders, not curves.*

### Architecture
- **Genome field:** `hslAdjust?: { hue: number; sat: number; light: number }`
  - Hue: `-180` to `180` (degrees)
  - Saturation: `0` to `200` (percent, `100` = identity)
  - Lightness: `-100` to `100` (percent add, `0` = identity)
- **Shader Pipeline (`visualize.wgsl`):**
  - Add uniform slot for `hslAdjust` to `VizUniforms`.
  - In the shader epilogue (after Color Curves), if `hslAdjust` is present, convert RGB to HSV.
  - Apply `hue` (wrap around 0..1 or 0..360), apply `sat` multiplier, and add `light` to value. Clamp appropriately, convert back to RGB.
- **Editor UI (`src/edit-section-hsl.ts`):**
  - A new collapsible editor section matching the style of other editor sections.
  - Includes a "Reset all" header action.
  - Contains three `scrubbyInput` sliders mimicking standard photo-editing tools.

## #181: Color Curves Drag Lag

**Diagnosis:** 
The lag when dragging Color Curves occurs because `FAST` lane edits are queued on the `LaneScheduler` with a 16ms debounce. A continuous slider drag fires `mousemove` rapidly, repeatedly resetting the debounce timer. The render is starved until the user stops dragging. Once dragging stops, the fast-lane edit flushes, presenting the histogram. Because the canvas was waiting to settle, it then triggers a high-quality remake.

**Fix Approach: Bypass Scheduler for FAST Lane**
Instead of debouncing `FAST` lane edits during continuous interaction, we will route them through the `requestLiveRender` loop, which already self-throttles to requestAnimationFrame (60fps).

1. **Update `requestLiveRender(lane: Lane)`:**
   - Add a `lane` argument.
   - Maintain a `liveRequestedLane` state that coalesces pending lanes (e.g., if a `fast` edit and a `slow` edit happen simultaneously, merge to `slow`).
   - If `lane === 'fast'`, use `state.genome` directly (no `liveAdjustedGenome` scaling needed).
   - Call `editRenderer.applyLane(lane, ...)`.
2. **Update `onPathChange` routing:**
   - Change `pathLane` routing in `edit-mount.ts` so that `FAST` lane edits also call `requestLiveRender('fast')` and `scheduleSettle()`, completely bypassing the debounce scheduler for interactive edits.
   - The `LaneScheduler` might no longer be needed for `onChange`, as all lanes now flow through the live loop. We can deprecate or keep it only for other async batching if necessary.

## Success Criteria
- Editor has an HSL panel that works alongside Color Curves.
- Dragging any curve point or HSL slider produces immediate 60fps canvas updates with no "starvation lag".
- The parity tests stay green (byte-identical render when sliders are untouched).
