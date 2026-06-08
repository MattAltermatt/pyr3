# Cartographic Map-Projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 novel map projection variations (mercator, lambert, mollweide, hammer, stereographic) for Issue #134.

**Architecture:** Pure WGSL mathematical warps integrated into the variation registry, catalog, and picker UI, including GPU verification tests.

**Tech Stack:** TypeScript, WGSL, Vitest.

---

### Task 1: Add Map Projections to the Variation Registry

**Files:**
- Modify: `src/variations.ts`

- [ ] **Step 1: Add to `V` enum**
Update `V` in `src/variations.ts` to include indices 225-229.

- [ ] **Step 2: Commit**

### Task 2: Implement WGSL Warps

**Files:**
- Modify: `src/shaders/chaos.wgsl`

- [ ] **Step 1: Add mathematical functions**
Add `var_mercator`, `var_lambert`, `var_mollweide`, `var_hammer`, and `var_stereographic`.

- [ ] **Step 2: Hook up in switch statement**
Add `case 225u` to `case 229u` in `evaluate_variation`.

- [ ] **Step 3: Commit**

### Task 3: Catalog and UI Integration

**Files:**
- Modify: `src/variation-catalog-data.ts`
- Modify: `src/edit-variation-picker.ts`

- [ ] **Step 1: Update Catalog**
Add JS warpFn equivalents and formulas for the new variations. Update `sourceForIdx` to return 'novel'.

- [ ] **Step 2: Update Picker UI**
Add 'Map projections' category to `CATEGORY_MAP`.

- [ ] **Step 3: Commit**

### Task 4: GPU Tests

**Files:**
- Create: `src/issue134-cartographic.gpu.test.ts`

- [ ] **Step 1: Write GPU Tests**
Test output finiteness for all 5 warps.

- [ ] **Step 2: Run tests**
Run `npm run test -- src/issue134-cartographic.gpu.test.ts` to verify.

- [ ] **Step 3: Commit**
