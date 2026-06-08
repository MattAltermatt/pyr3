# #116 — Color Curves design spec

**Status:** locked 2026-06-07 via brainstorm. Implementation pending.
**Issue:** https://github.com/MattAltermatt/pyr3/issues/116
**Branch:** `feature/issue-116-color-curves`

---

## 1. Scope and naming

Post-tonemap color-grading curves for the `/v1/edit` viewer. Five
independently-editable curves (Composite, R, G, B, Luma) on the genome,
applied per-pixel after the current tonemap math and before the canvas
write. Identity by default — `genome.channelCurves === undefined` produces
byte-identical output to the current renderer (parity rig invariant).

**The feature is renamed from the issue's "channel modifiers" to
"Color Curves"** for two reasons:

1. **The issue's framing was wrong.** A dueling-agent research pass into
   JWildfire's actual source (`org.jwildfire.create.tina.render.*`) found
   that JWildfire's "ChannelMixer" is an entirely different feature — a
   9-cell R/G/B-only matrix mixer in pre-gamma linear-light RGB,
   BEFORE the tonemap. JWildfire's L/Sat/Hue curves live inside the
   gradient editor (palette pre-bake), not as a post-tonemap creative
   grade. The "post-tonemap RGB / L / Sat / Hue curves" the #116 issue
   describes is a pyr3 invention, not a JWF port. We're building the
   Photoshop / Capture-One / Lightroom convention, not the JWF one.
2. **"Color Curves" is the modern photo-tool name** for what we're
   shipping; every reference user (Photoshop, Lightroom, Capture One,
   Affinity, GIMP) calls their version "Curves" or "Tone Curve."

The GitHub issue title and body will be updated; the issue number `#116`
stays.

### Sibling tickets to file alongside the spec

```text
sibling A — "HSL Adjustments — Hue rotate / Sat % / Light % sliders"
            Three-slider panel for global HSL nudges. Separate from
            curves because no modern photo tool ships Hue/Sat as
            curves. Originally listed in #116 (Sat / Hue tabs); moved
            out because their UX is sliders, not curves, in every tool
            surveyed.

sibling B — "Color Curves v1.1: targeted adjustment + named-preset
             library"
            Click-on-image-to-place-curve-point + save/load named curve
            sets. Real expectations but each is a meaningful stretch;
            defer to after v1 ships and we see real usage.

sibling C — "Scopes panel — RGB parade / waveform / vectorscope"
            Bigger feature; lives next to the curves panel but is its
            own surface. Real 2026 expectation, but distinct enough that
            cramming into #116 would balloon scope unhelpfully.
```

### Editor placement

New top-level section in `/v1/edit` sidebar between Palette and Render
(natural cognitive order: color source → palette → curves → render).

---

## 2. Data model

### TypeScript surface (in `src/genome.ts`)

```ts
export type CurvePoint = { x: number; y: number };  // both in [0, 1]

export type ChannelCurves = {
  composite: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
  luma: CurvePoint[];
};

// On Genome:
//   channelCurves?: ChannelCurves;   // undefined ≡ identity
```

### Per-curve invariants

Validated in `src/channel-curves.ts:validate`:
- `2 ≤ points.length ≤ 8`
- `x` strictly increasing
- All `x ∈ [0, 1]`, all `y ∈ [0, 1]`
- Endpoints not pin-anchored — the bake clamps to nearest endpoint Y past
  the edges (matches JWildfire's `Envelope.evaluate` and the photo-editor
  convention)

### Identity convention

A channel curve is "identity" iff `points === [{x:0,y:0}, {x:1,y:1}]`
(exactly two points at the corners). The `bakeCurves(c: ChannelCurves)`
function returns `null` when all 5 channels are identity, and the upload
path skips the buffer write + sets `curvesActive = 0`.

When the user opens the Color Curves editor section and there are no
serialized curves on the genome, the section spawns an in-memory identity
default but does NOT write to the genome until the user actually drags a
control point. This preserves the "channelCurves serialized" ↔ "user
intentionally graded this flame" semantic.

---

## 3. CPU bake (`src/channel-curves.ts`)

Pure module, zero environment branches — engine-seam-clean.

### Public surface

```ts
export function bakeCurves(c: ChannelCurves): Float32Array | null;
  // Returns 5×256 packed f32 LUT (~5KB) or null if all 5 channels
  // are identity.

export function bakeOne(points: CurvePoint[]): Float32Array;
  // 256-entry LUT for a single channel.

export function validate(points: CurvePoint[]): void;
  // Throws on invariant violation. Pure precondition check.

export function isIdentity(points: CurvePoint[]): boolean;

export function activeMask(c: ChannelCurves | undefined): number;
  // Returns the bit-field for VizUniforms.curvesActive.
  //   bit0=composite, bit1=R, bit2=G, bit3=B, bit4=luma
  //   undefined input → 0.
```

### Interpolation

**Catmull-Rom (B = 0.5 cardinal tension, endpoint duplication).**
Matches JWildfire's `SplineInterpolation` math and the "Smooth" mode
every photo editor surveyed ships:

```ts
function evalSpline(u: number, xa: number, xb: number, xc: number, xd: number): number {
  const B = 0.5;
  let c = u*u*u * (-B*xa + (2-B)*xb + (B-2)*xc + B*xd);
  c += u*u    * (2*B*xa + (B-3)*xb + (3-2*B)*xc - B*xd);
  c += u      * (-B*xa + B*xc);
  return c + xb;
}
```

For `i = 0` the spline uses `points[0]` as the phantom `xa`; for the last
segment it duplicates `points[n-1]` as the phantom `xd`. Below 3 points,
fall back to linear.

### Edge clamp

For `x < points[0].x`: return `points[0].y`.
For `x > points[n-1].x`: return `points[n-1].y`.
Matches JWildfire's `Envelope.evaluate` and Photoshop/Capture One
convention.

### LUT sampling

Each channel's `bakeOne` samples the Catmull-Rom curve at 256 evenly-
spaced x values (`x = i/255` for `i ∈ 0..255`). Per-pixel WGSL lookup
then does linear interpolation between adjacent LUT entries — the
Catmull-Rom smoothness is already baked into the dense LUT samples, so
GPU-side linear is visually indistinguishable from GPU-side spline eval
at half the ALU cost.

---

## 4. GPU integration

### Uniforms struct

`VizUniforms` grows from 64 → 80 bytes (16-byte aligned via the
trailing `_pad4/_pad5/_pad6`):

```wgsl
struct VizUniforms {
  width: u32, height: u32,
  k1: f32, k2: f32,
  gamma: f32, vibrancy: f32, highpow: f32, linrange: f32,
  oversample: u32, fwidth: u32,
  _pad2: u32, _pad3: u32,
  background: vec4f,
  // NEW (color-curves):
  curvesActive: u32,        // bit-field per channel; 0 = no curves
  _pad4: u32, _pad5: u32, _pad6: u32,
};
```

`UNIFORMS_BYTES` in `src/visualize.ts` goes 64 → 80.

### New binding

In both `visualize_u32.wgsl` and `visualize_f32.wgsl`:

```wgsl
@group(0) @binding(3) var<storage, read> curves: array<f32>;  // 5 × 256

fn lut(ch: u32, x: f32) -> f32 {
  let idx = clamp(x, 0.0, 1.0) * 255.0;
  let i0 = u32(floor(idx));
  let i1 = min(i0 + 1u, 255u);
  return mix(curves[ch * 256u + i0], curves[ch * 256u + i1], idx - f32(i0));
}
```

### Explicit pipeline layout (critical)

`src/visualize.ts` switches from `layout: 'auto'` to
`device.createPipelineLayout({ bindGroupLayouts: [...] })` for BOTH
pipelines (u32 and f32). Closes the `layout:'auto'` auto-strip trap that
silently turns unused bindings into all-zero output
([[reference-wgsl-extract-and-test-layout]]). This is architecturally
correct independent of the curves feature; partially clears the deferred
work from #171.

### Shader epilogue

The current ending of both `visualize_u32.wgsl` and `visualize_f32.wgsl`:

```wgsl
let final_rgb = clamp(composed / 256.0, vec3f(0.0), vec3f(1.0));
return vec4f(final_rgb, 1.0);
```

becomes:

```wgsl
var rgb = clamp(composed / 256.0, vec3f(0.0), vec3f(1.0));
if (u.curvesActive != 0u) {
  // Composite first (Photoshop convention — same curve applied to R, G, B
  // before per-channel curves)
  if ((u.curvesActive & 1u) != 0u) {
    rgb = vec3f(lut(0u, rgb.r), lut(0u, rgb.g), lut(0u, rgb.b));
  }
  // Per-channel R / G / B
  if ((u.curvesActive & 2u) != 0u) { rgb.r = lut(1u, rgb.r); }
  if ((u.curvesActive & 4u) != 0u) { rgb.g = lut(2u, rgb.g); }
  if ((u.curvesActive & 8u) != 0u) { rgb.b = lut(3u, rgb.b); }
  // Luma — BT.709, scale-preserving (target_Y / input_Y; preserves
  // hue + saturation, unlike a composite curve which shifts both)
  if ((u.curvesActive & 16u) != 0u) {
    let y_in = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
    let y_out = lut(4u, y_in);
    let scale = select(1.0, y_out / y_in, y_in > 1e-6);  // zero-guard
    rgb = clamp(rgb * scale, vec3f(0.0), vec3f(1.0));
  }
}
return vec4f(rgb, 1.0);
```

The `y_in > 1e-6` zero-guard fixes JWildfire's known divide-by-zero bug
in their `BrightnessColorFunc`. We do NOT need to be bug-compatible.

### Identity-fast-path semantics

`curvesActive == 0u` → the entire curves block is skipped — output is
exactly `clamp(composed/256.0, …)`, byte-identical to current renderer.
The branch is architecturally permanent and load-bearing for the parity
rig; document in WGSL comment.

### Re-bake/re-upload trigger

`src/edit-state.ts:pathLane` gains a prefix-match for `'channelCurves'`
→ `'fast'`. The fast lane already coalesces to next-frame in the
present pass. `editRenderer.applyLane('fast')` invokes `visualize.draw()`
which checks a dirty-curves flag, calls `bakeCurves(g.channelCurves)`,
writes the 5KB buffer, and updates `curvesActive`. Per-frame drag at
60 Hz fits comfortably under one-frame budget.

---

## 5. Editor UI (`src/edit-section-curves.ts`)

### Layout

```text
┌─ Color Curves ──────────────────────────[ ⟲ Reset all ]─┐
│                                                          │
│  ┌─ Channel ─────────────────────────────────────────┐   │
│  │ ( ● Composite )  R   G   B   Luma                 │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─ Presets ──────────────────────────────────────────┐  │
│  │ Identity · Soft S · Med S · Strong S · Inverse     │  │
│  │ Lift Shadows · Crush Shadows · Lift Hi · Crush Hi  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ Curve canvas (square, 240×240) ───────────────────┐  │
│  │ [grid w/ snap markers · histogram fill · spline]   │  │
│  │ [identity diagonal · 4-8 control points]           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│   Selected point:  in [ 128 ]  out [ 142 ]   [ − Delete] │
│                                                          │
│   [ Reset channel ]  [ ⟂ Snap 1/8 x+y]  [ 👁 hold = before]│
└──────────────────────────────────────────────────────────┘
```

### Gestures

- **Click empty canvas area** → add new control point at clicked
  position; auto-select
- **Drag point** → move; x constrained between adjacent points'
  x-values (no crossover)
- **Click existing point** → select; numeric readout binds
- **Drag selected point off-canvas** → delete (Photoshop convention;
  "off-canvas" = drag the cursor more than 20px outside the 240×240
  curve canvas box, then release)
- **Backspace / Delete** (while a point is selected) → delete
- **Explicit `−` button** next to numeric readout → delete selected
  point — **the primary, discoverable affordance**
- **Arrow keys** (while a point is selected) → nudge selected point
  by 1/256 step; Shift+arrow = 10/256
- **NO right-click for any primary action.** Right-click context menu
  on Mac is awkward; per project memory
  [[feedback-no-right-click-on-mac]]

### Before/after toggle

The `👁` button captures pointer-down/pointer-up:
- Press-and-hold → `state.colorCurvesPreviewOff = true` for the duration
  of the press, which forces the visualize shader's `curvesActive = 0`
  for that frame
- Click (down + up within 300ms) → toggles the boolean for one full
  render cycle (refreshes on next mouse move out of the button)

### Live histogram overlay

After each settled render (hook into the existing render-settle / done
callback that signals the `'slow'` lane has finished), the editor:
1. Calls `device.queue.copyTextureToBuffer` on the canvas texture into
   a staging buffer
2. `mapAsync('read')` to CPU
3. Samples 5000 pixels at strided positions (deterministic, not random
   — for visual stability frame-to-frame)
4. Bins into 256 buckets per channel (4 channels: R, G, B, Y-via-BT.709)
5. Normalizes each bucket to `[0, 1]` against max-bucket value
6. Renders as a soft-fill polyline behind the curve spline in the
   active channel's canvas

The histogram is cached and only refreshes on render-settle, not per
curve-drag (which would create flicker as the histogram trails the
in-progress edit).

For the Composite tab: render R, G, B histograms faintly overlaid with
30% opacity each.

### Preset buttons

Each preset is a hardcoded 4-point control-point array:

```ts
const PRESETS = {
  identity:        [{x:0,y:0},   {x:1,y:1}],
  'soft-s':        [{x:0,y:0},   {x:0.25,y:0.20}, {x:0.75,y:0.80}, {x:1,y:1}],
  'medium-s':      [{x:0,y:0},   {x:0.25,y:0.15}, {x:0.75,y:0.85}, {x:1,y:1}],
  'strong-s':      [{x:0,y:0},   {x:0.25,y:0.08}, {x:0.75,y:0.92}, {x:1,y:1}],
  inverse:         [{x:0,y:1},   {x:1,y:0}],
  'lift-shadows':  [{x:0,y:0.15},{x:0.5,y:0.55},  {x:1,y:1}],
  'crush-shadows': [{x:0,y:0},   {x:0.25,y:0.05}, {x:1,y:1}],
  'lift-hi':       [{x:0,y:0},   {x:0.5,y:0.55},  {x:1,y:1}],
  'crush-hi':      [{x:0,y:0},   {x:0.75,y:0.85}, {x:1,y:0.85}],
};
```

Clicking a preset replaces the current channel's curve and creates one
undo/redo history entry.

### State plumbing

All edits route through the existing `onPathChange` funnel
([[reference-edit-onpathchange-funnel]]):
- `onPathChange('channelCurves.<channel>.points[<idx>]')` for point edits
- `onPathChange('channelCurves.<channel>')` for preset/reset replacements

Undo/redo, persist-to-localstorage, and lane scheduling are inherited.

New UI-only state (never serialized):
- `state.selectedCurvePoint?: { channel: keyof ChannelCurves; pointIdx: number }`
- `state.colorCurvesPreviewOff?: boolean`
- `state.colorCurvesSnapToGrid?: boolean`   (applies to BOTH x and y at 1/8 divisions)
- `state.activeColorCurveChannel?: keyof ChannelCurves`  (default 'composite')

---

## 6. Persistence

### JSON

`channelCurves` round-trips as a plain JSON object. The serializer in
`src/genome-json.ts` omits the field when all 5 channels are identity
(small file size, clean "I never touched this" path).

```json
{
  "name": "...",
  "channelCurves": {
    "composite": [{"x":0,"y":0},{"x":0.5,"y":0.6},{"x":1,"y":1}],
    "r":         [{"x":0,"y":0},{"x":1,"y":1}],
    "g":         [{"x":0,"y":0},{"x":1,"y":1}],
    "b":         [{"x":0,"y":0},{"x":1,"y":1}],
    "luma":      [{"x":0,"y":0},{"x":1,"y":1}]
  }
}
```

### PNG metadata

Inherits automatically — the `pyr3` tEXt chunk
([[reference-pyr3-png-metadata-format]]) is built from `genomeToJson(g)`,
which roundtrips the new field with zero extra work.

### Importer (`src/flame-import.ts`)

No changes for v1. JWildfire `.flame` XML carries no equivalent
post-tonemap curves field (their ChannelMixer is a different feature).
Imported `.flame` files arrive with `channelCurves` undefined; user
can grade in pyr3 and save as `.pyr3.json` to preserve.

### BE CLI (`bin/pyr3-render.ts`)

No CLI changes required. The engine seam means `createRenderer()`
consumes the new field transparently. Verified end-to-end in the
acceptance test below.

---

## 7. Parity invariants

**The non-negotiable seam:**

```
genome.channelCurves === undefined
   → activeMask returns 0
   → curvesActive uniform = 0
   → shader branches off
   → output is byte-identical to current visualize output
```

26-fixture BE parity rig stays green (none of the fixtures define
`channelCurves`). Two new dedicated unit tests guard the seam from the
TS side independently of the parity rig:

- `src/visualize.identity.test.ts` — renders a small fixture twice
  (once with `channelCurves` undefined, once with all-identity curves
  explicitly set); asserts CRC-equal canvas readback after the curve
  bake is bypassed
- `src/visualize.curves-active.test.ts` — renders with a known
  non-identity curve and asserts the output DOES differ from the
  identity render; catches "I forgot to wire the upload" failure mode

---

## 8. Testing

### Unit tests (added)

```text
src/channel-curves.test.ts
   - bakeOne identity (linear y=x) produces y=x LUT to ±1/512
   - Catmull-Rom matches reference values at 4-point S-curve
   - Edge clamp returns endpoint Y past edges
   - Validate rejects: x not monotonic, x out of [0,1], <2 or >8 points
   - isIdentity returns true only for [(0,0),(1,1)]
   - activeMask bitfield correct for each combination

src/visualize.identity.test.ts
   - undefined ≡ identity (byte-identical CRC)

src/visualize.curves-active.test.ts
   - non-identity curve changes pixel output

src/edit-section-curves.test.ts
   - Section mounts with all 5 channel tabs visible
   - Click empty canvas adds a point + selects it
   - Drag point moves it; cannot cross adjacent x
   - Backspace deletes selected; "−" button deletes; off-canvas drag deletes
   - Arrow keys nudge by 1/256, shift = 10/256
   - Each preset button installs the expected control-point array
   - Reset channel restores identity for that channel only
   - Reset all restores all 5 channels
   - 👁 button toggles preview-off
   - Histogram refreshes on render-settle event
   - All edits funnel through onPathChange

src/visualize.gpu.test.ts (additions)
   - New explicit pipeline layout doesn't strip the curves binding
   - LUT lookup matches CPU bake at 4 sentinel sample points
```

### Existing tests must stay green

- `npm test` — full unit suite (currently 5969 tests)
- `npm run typecheck` — full project
- `npm run typecheck:engine` — engine no-DOM seam (catches accidental
  DOM imports in `channel-curves.ts`)
- `npm run test:parity` — 26-fixture BE parity rig
- `npm run test:fe-be-smoke` — 3-fixture FE↔BE smoke

### Chrome verify (manual gate before FF-merge)

Build a 3-column gallery at `.remember/verify/116-color-curves.html`
(per [[reference-pyr3-catalog-scaffold-tripwires]] guidance for
eyeball-verify HTML pages): 5+ fixtures rendered (a) without curves,
(b) with an aggressive Soft-S composite + lifted shadows, (c) showing
the editor section in active state with histogram overlay visible.

### BE CLI round-trip (manual gate)

Render a `.pyr3.json` carrying non-identity curves via
`npm run render <in.pyr3.json> <out.png>`. Output PNG should match
the FE render of the same genome at the same dims (visually equivalent,
not byte-identical per cross-machine determinism contract).

---

## 9. Acceptance criteria

The PR is shippable when ALL of:

1. All new unit tests pass; existing 5969 unit tests stay green
2. `npm run typecheck` + `npm run typecheck:engine` clean
3. 26-fixture BE parity rig (`npm run test:parity`) stays green
4. Chrome-verify gallery rendered + user sign-off
5. BE CLI honors curves: explicit round-trip test of a non-identity
   `.pyr3.json`
6. `src/visualize.ts` no longer uses `layout: 'auto'` (explicit
   layout in both pipelines)
7. Editor `/v1/edit` shows the new Color Curves section between
   Palette and Render with all UX features from §5
8. Genome JSON round-trip preserves curves (load saved → save → diff)

---

## 10. Out of scope (filed as sibling tickets)

- Sat / Hue post-tonemap curves (→ "HSL Adjustments" sibling)
- Targeted adjustment / click-on-image-to-place-point (→ v1.1 sibling)
- Save/load named curve sets to disk (→ v1.1 sibling)
- Scopes panel (RGB parade, waveform, vectorscope) (→ separate ticket)
- JWildfire-faithful 9-cell channel mixer in pre-gamma linear-light
  (different feature; not currently planned)
- OKLab / CIELAB color spaces (HSV/BT.709 is sufficient for v1)
- Freehand draw mode (Photoshop's "Pencil" — rarely used, GIMP-only;
  not a 2026 expectation)
- User-controllable Bezier handles on control points (Photoshop has
  refused for years; signal it's not worth the UX cost)

---

## Appendix A — research provenance

Three parallel research agents informed this spec:

1. **JWildfire ground-truth agent** read the
   `org.jwildfire.create.tina.render.*` and
   `org.jwildfire.envelope.*` source. Surfaced the misnomer above and
   detailed JWF's actual channel-mixer semantics (R/G/B-only matrix,
   pre-gamma linear-light, 1.6×-largest-gap dense pre-sampled LUT,
   binary-search lookup per pixel). Confirmed Catmull-Rom B=0.5 with
   endpoint duplication is the right spline.

2. **Modern grading-tool practitioner agent** surveyed DaVinci Resolve,
   Photoshop, Lightroom, Capture One, Affinity Photo, and GIMP via
   their docs. Confirmed:
   - Strong convergence on Composite + R + G + B + (optional) Luma as
     the channel set, with a channel dropdown over one canvas
   - Hue-vs-X curves are a Resolve-only feature, not in any photo
     editor's curves tool
   - 2026 table-stakes features: live histogram overlay, preset row,
     numeric readout, reset-all/reset-channel, before/after toggle,
     snap-to-grid
   - Bezier handles on control points = Photoshop has refused for
     years = not worth the UX cost
   - Mac UX caveat: right-click is unreliable; tools converge on
     drag-off-canvas + hotkey + (less consistently) right-click for
     delete

3. **pyr3 engineering agent** read the visualize shaders, genome
   surface, and editor lane scheduler. Produced the concrete
   architecture in §3–§5: single 5×256 f32 LUT, runtime
   uniform bit-field, explicit pipeline layout, RGB-then-Luma order,
   `'fast'` lane re-bake.
