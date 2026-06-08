# Issue 140: Area-preserving / toral chaos maps

## Overview
Implement 4 stateless, area-preserving chaotic maps. These are classic dynamical systems that exhibit strong mixing properties, distinct from dissipative strange attractors. They will be implemented centered around 0 via `fract(p + 0.5) - 0.5` mapping.

## Architecture & Scope
We will implement the following 4 variations:

1. **arnold_cat (V237):**
   - Arnold's cat map: `[x', y'] = [[2,1],[1,1]] * [x, y] mod 1`.
   - Params: None.

2. **bakers_map (V238):**
   - Stretch by 2 in x, fold in y.
   - Params: None.

3. **tent_map (V239):**
   - `x' = 1 - |1 - 2x|`, applied per-axis.
   - Params: None.

4. **logistic_map (V240):**
   - `x' = r * x * (1 - x)`, applied per-axis.
   - Params: `r` (default 3.9).

## Technical Details
- **WGSL:** Functions added to `src/shaders/chaos.wgsl`. Hooked into the dispatcher `switch` statement for `V237`..`V240`.
- **TypeScript:** Keys added to `V` enum in `src/variations.ts` and `VARIATION_PARAMS` in `src/serialize.ts`.
- **Catalog:** Mathematical formulas, blurbs, and JavaScript equivalents of the warps added to `CATALOG_DATA` in `src/variation-catalog-data.ts`.
- **UI:** Will be grouped into the fallback "Misc / exotic" category.
- **Tests:** A new GPU test suite in `src/issue140-toral.gpu.test.ts`.
