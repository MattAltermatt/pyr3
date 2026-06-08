# Issue 134: Cartographic map-projection warps

## Overview
Implement five confirmed-novel variation families based on classical global map projections. Each variation treats the input coordinate `(x, y)` as `(longitude, latitude)` and applies the corresponding cartographic projection.

These variations are stateless, zero-parameter mappings that are well-suited for pyr3's WebGPU architecture.

## Architecture & Scope

We will implement the following 5 variations:
1. **mercator (V225):** Conformal cylindrical projection. Vertical coordinate is clamped to `[-1.5, 1.5]` to avoid infinities near the poles.
2. **lambert (V226):** Lambert azimuthal equal-area projection. Maps the sphere to a disk while perfectly preserving area.
3. **mollweide (V227):** Elliptical equal-area projection. Uses a few Newton iterations to approximate the auxiliary angle.
4. **hammer (V228):** Hammer/Aitoff projection. A modified azimuthal projection to reduce outer meridian distortion.
5. **stereographic (V229):** Stereographic azimuthal projection. Conformal, creating a swirly effect.

## Technical Details
- **WGSL:** Functions `var_mercator`, `var_lambert`, `var_mollweide`, `var_hammer`, and `var_stereographic` added to `src/shaders/chaos.wgsl`. Hooked into the dispatcher `switch` statement for `V225`..`V229`.
- **TypeScript Definitions:** Keys added to `V` enum in `src/variations.ts`.
- **Catalog:** Mathematical formulas, blurbs, and JavaScript equivalents of the warps added to `CATALOG_DATA` in `src/variation-catalog-data.ts`.
- **Picker UI:** Added a new 'Map projections' category to `CATEGORY_MAP` in `src/edit-variation-picker.ts`.
- **Tests:** A new GPU test suite in `src/issue134-cartographic.gpu.test.ts` to verify the mathematical outputs on the GPU.

## Error Handling & Stability
- All trigonometric calls routed through `safe_sin`, `safe_cos`, and `safe_tan` to guard against Dawn f32 trig cliffs.
- Denominators are guarded with `+ 1e-6` and `clamp()` to prevent division by zero or `NaN` collapse during the chaos game.
