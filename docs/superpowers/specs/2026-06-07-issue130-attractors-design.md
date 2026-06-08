# Issue 130: Single-step strange-attractor variations

## Overview
Implement single-step strange-attractor maps as pyr3 variations. A single step of a famous chaotic map is stateless, fitting perfectly into the per-walker kernel and folding the map's signature texture (KAM tori, chaotic seas, filaments) into the fractal flame.

## Architecture & Scope
We will implement the following 3 variations (Clifford and Henon are already present in pyr3):

1. **standard_map (V230):** Chirikov-Taylor map.
   - `x' = x + K * sin(y)`
   - `y' = y + x'`
   - Params: `k` (controls transition from regular to chaotic).

2. **de_jong (V231):** Peter de Jong attractor.
   - `x' = sin(a*y) - cos(b*x)`
   - `y' = sin(c*x) - cos(d*y)`
   - Params: `a, b, c, d`.

3. **ikeda (V232):** Ikeda laser dynamics map.
   - `t  = 0.4 - 6 / (1 + x^2 + y^2)`
   - `x' = 1 + u*(x*cos(t) - y*sin(t))`
   - `y' = u*(x*sin(t) + y*cos(t))`
   - Params: `u`.

## Technical Details
- **WGSL:** Functions added to `src/shaders/chaos.wgsl`. All `sin`/`cos` calls must use `safe_sin` and `safe_cos` because large arguments can push past the Dawn f32 trig cliff.
- **TypeScript:** Add to `V` enum in `src/variations.ts` and `VARIATION_PARAMS`/`VARIATION_DEFAULTS` in `src/serialize.ts`.
- **Catalog:** Update `src/variation-catalog-data.ts`.
- **UI:** Add to "Misc / exotic" category in `src/edit-variation-picker.ts`.
- **Tests:** Add GPU verification in `src/issue130-attractors.gpu.test.ts`.
