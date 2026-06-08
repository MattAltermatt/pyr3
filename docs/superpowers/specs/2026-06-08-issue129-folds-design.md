# Issue 129: Fold-family variations

## Overview
Implement 4 stateless fold variations commonly found in demoscene/raymarching shaders, bringing the Mandelbox and Kaleidoscopic IFS aesthetic to pyr3's 2D fractal flames. Per the issue guidance, we will ship the geometric folds as position warps first and defer DC fold-count coloring to a separate slice.

## Architecture & Scope
We will implement the following 4 variations:

1. **box_fold (V233):**
   - Applies per-component reflection if coordinate exceeds `limit`.
   - Params: `limit` (default 1.0).

2. **sphere_fold (V234):**
   - Radial inversion shell. If radius is less than `rmin`, it scales up uniformly by `rmax^2/rmin^2`. If between `rmin` and `rmax`, it scales by `rmax^2/r^2`.
   - Params: `rmin, rmax` (default 0.5, 1.0).

3. **mandelbox_step (V235):**
   - Combines a box fold (limit=1.0), sphere fold, and an affine step `p * scale + c`.
   - Params: `scale, rmin, rmax, cx, cy` (default `2.0, 0.5, 1.0, 0.0, 0.0`).

4. **kifs_fold (V236):**
   - Folds all space into a wedge of angle `2pi / n` using polar reflection, then restores to cartesian.
   - Params: `n, offset` (default 3.0, 0.0).

## Technical Details
- **WGSL:** Functions added to `src/shaders/chaos.wgsl`. Hooked into the dispatcher `switch` statement for `V233`..`V236`.
- **TypeScript:** Keys added to `V` enum in `src/variations.ts` and `VARIATION_PARAMS` in `src/serialize.ts`.
- **Catalog:** Mathematical formulas, blurbs, and JavaScript equivalents of the warps added to `CATALOG_DATA` in `src/variation-catalog-data.ts`.
- **UI:** Folds will fall back to "Misc / exotic" category, or a new "Folds & IFS" category if desired. We will add a "Folds & IFS" category in `edit-variation-picker.ts`.
- **Tests:** A new GPU test suite in `src/issue129-folds.gpu.test.ts`.
