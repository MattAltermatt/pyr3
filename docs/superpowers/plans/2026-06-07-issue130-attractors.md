# Single-Step Strange Attractors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 3 novel single-step strange-attractor variations (standard_map, de_jong, ikeda) for Issue #130.

**Architecture:** Pure WGSL mathematical warps utilizing `safe_sin` and `safe_cos` to handle large arguments.

**Tech Stack:** TypeScript, WGSL, Vitest.

---

### Task 1: Add to Variation Registry

**Files:**
- Modify: `src/variations.ts`
- Modify: `src/serialize.ts`

- [ ] **Step 1: Update `V` enum**
Add `standard_map: 230`, `de_jong: 231`, `ikeda: 232` to `src/variations.ts`.

- [ ] **Step 2: Update parameters mapping**
Add parameter names to `VARIATION_PARAMS` and defaults to `VARIATION_DEFAULTS` in `src/serialize.ts`:
- `standard_map`: `['k']`, default `[1.0]`
- `de_jong`: `['a', 'b', 'c', 'd']`, default `[-2.24, 0.43, -0.65, -2.43]`
- `ikeda`: `['u']`, default `[0.9]`

### Task 2: Implement WGSL Warps

**Files:**
- Modify: `src/shaders/chaos.wgsl`

- [ ] **Step 1: Add mathematical functions**
Add `var_standard_map`, `var_de_jong`, `var_ikeda`.

- [ ] **Step 2: Hook up in switch statement**
Add `case 230u` to `case 232u` in `evaluate_variation`.

### Task 3: Catalog and UI Integration

**Files:**
- Modify: `src/variation-catalog-data.ts`
- Modify: `src/edit-variation-picker.ts`

- [ ] **Step 1: Update Catalog**
Add JS warpFn equivalents, formulas, blurbs, and params to `CATALOG_DATA`. Update `sourceForIdx` to return 'novel'.

- [ ] **Step 2: Update Picker UI**
Add these variations to the "Misc / exotic" category (or let them fall back to it).

### Task 4: GPU Tests

**Files:**
- Create: `src/issue130-attractors.gpu.test.ts`

- [ ] **Step 1: Write GPU Tests**
Test output finiteness for all 3 warps.

- [ ] **Step 2: Run tests**
Run `npm run test -- src/issue130-attractors.gpu.test.ts` to verify.
