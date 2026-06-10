// Layer 1 of the variation test harness.
//
// Each fixture file under tests/fixtures/variations/ is the ground truth
// emitted by an instrumented flam3 build (see tests/flam3-harness/).
// Tests assert that pyr3's TS reference impls produce output within ε
// of flam3's per-input.
//
// To regenerate fixtures: `npm run fixtures:variations` (see docs/HARNESS.md).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ts_var_arch,
  ts_var_bent,
  ts_var_bipolar,
  ts_var_blade,
  ts_var_blob,
  ts_var_blur,
  ts_var_bubble,
  ts_var_cosine,
  ts_var_cpow,
  ts_var_cross,
  ts_var_curl,
  ts_var_curve,
  ts_var_cylinder,
  ts_var_diamond,
  ts_var_disc,
  ts_var_disc2,
  ts_var_ex,
  ts_var_exponential,
  ts_var_eyefish,
  ts_var_fan,
  ts_var_fan2,
  ts_var_fisheye,
  ts_var_gaussian_blur,
  ts_var_handkerchief,
  ts_var_heart,
  ts_var_horseshoe,
  ts_var_hyperbolic,
  ts_var_julia,
  ts_var_julian,
  ts_var_juliascope,
  ts_var_linear,
  ts_var_ngon,
  ts_var_noise,
  ts_var_pdj,
  ts_var_perspective,
  ts_var_polar,
  ts_var_popcorn,
  ts_var_power,
  ts_var_radial_blur,
  ts_var_rays,
  ts_var_rectangles,
  ts_var_rings,
  ts_var_rings2,
  ts_var_secant2,
  ts_var_sinusoidal,
  ts_var_spherical,
  ts_var_spiral,
  ts_var_square,
  ts_var_swirl,
  ts_var_tangent,
  ts_var_twintrian,
  ts_var_waves,
  ts_var_wedge,
  // Batch E — transcendentals
  ts_var_exp,
  ts_var_log,
  ts_var_sin,
  ts_var_cos,
  ts_var_tan,
  ts_var_sec,
  ts_var_csc,
  ts_var_cot,
  ts_var_sinh,
  ts_var_cosh,
  ts_var_tanh,
  ts_var_sech,
  ts_var_csch,
  ts_var_coth,
  // Batch F
  ts_var_butterfly,
  ts_var_edisc,
  ts_var_elliptic,
  ts_var_foci,
  ts_var_loonie,
  ts_var_polar2,
  ts_var_scry,
  // Batch G
  ts_var_bent2,
  ts_var_cell,
  ts_var_escher,
  ts_var_modulus,
  ts_var_split,
  ts_var_splits,
  ts_var_stripes,
  ts_var_whorl,
  ts_var_flux,
  // Batch H
  ts_var_popcorn2,
  ts_var_lazysusan,
  ts_var_waves2,
  ts_var_oscope,
  ts_var_separation,
  ts_var_auger,
  ts_var_wedge_sph,
  // Batch I
  ts_var_super_shape,
  ts_var_flower,
  ts_var_conic,
  ts_var_parabola,
  ts_var_pie,
  ts_var_boarders,
  ts_var_wedge_julia,
  // Batch J
  ts_var_pre_blur,
  // Batch K
  ts_var_mobius,
  V,
  catalogAnchorSlug,
  type VarInput,
  type VarOutput,
} from './variations';

interface FixtureRow {
  tx: number;
  ty: number;
  weight: number;
  params: Record<string, number>;
  expected_x: number;
  expected_y: number;
}

interface FixtureFile {
  variation: string;
  fixtures: FixtureRow[];
}

function loadFixture(name: string): FixtureFile {
  const path = join(__dirname, '..', 'tests', 'fixtures', 'variations', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureFile;
}

function close(actual: number, expected: number, absEps: number, relEps: number): boolean {
  if (Number.isNaN(actual) || Number.isNaN(expected)) return actual === expected;
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return actual === expected;
  const diff = Math.abs(actual - expected);
  const scale = Math.max(Math.abs(actual), Math.abs(expected), 1.0);
  return diff <= Math.max(absEps, relEps * scale);
}

// Defaults for f64-vs-f64 comparison (pyr3 TS impl vs flam3 fixture).
// In practice the binding constraint is absEps for all output magnitudes
// up to ~1e6 (where relEps * scale begins to exceed absEps). For all
// PR 1 variations, outputs are O(1) → effective tolerance is absEps.
// The relEps term exists for future variations that produce large
// magnitude outputs; today it is informational rather than load-bearing.
const DEFAULT_ABS = 1e-6;
const DEFAULT_REL = 1e-12;

const TOLERANCES: Record<string, { abs: number; rel: number }> = {
  // spiral — at very small r (~0.008) flam3's separate biased/unbiased `r`
  // produces slightly different output than pyr3's single-biased-r collapse
  // (documented modernization on `ts_var_spiral`). Absolute diff up to ~1e-6
  // on outputs of magnitude ~90 (relative diff ~1e-8). Surfaced when Batch B
  // fixture regen produced a sample row at r≈0.008. Bump absEps; the relEps
  // path catches actual math drift.
  spiral: { abs: 2e-6, rel: 1e-12 },
  // power — same single-biased-r collapse as spiral; documented on ts_var_power.
  // Tiny-r fixture rows (r≲0.02) yield abs diff ~2e-6 at output magnitude ~58.
  power: { abs: 3e-6, rel: 1e-12 },
};

// Standard runner: deterministic variations.
function runDeterministic(
  fn: (i: VarInput) => VarOutput,
  name: string,
  fixture: FixtureFile,
  tol: { abs: number; rel: number },
): void {
  fixture.fixtures.forEach((row, idx) => {
    it(`${name} row ${idx} (tx=${row.tx.toFixed(4)}, ty=${row.ty.toFixed(4)})`, () => {
      const out = fn({ tx: row.tx, ty: row.ty, weight: row.weight, params: row.params });
      const xOk = close(out.x, row.expected_x, tol.abs, tol.rel);
      const yOk = close(out.y, row.expected_y, tol.abs, tol.rel);
      if (!xOk || !yOk) {
        throw new Error(
          `${name}[${idx}] mismatch:\n` +
            `  input:    tx=${row.tx} ty=${row.ty} weight=${row.weight}\n` +
            `  expected: (${row.expected_x}, ${row.expected_y})\n` +
            `  actual:   (${out.x}, ${out.y})\n` +
            `  diff:     (${(out.x - row.expected_x).toExponential(3)}, ${(out.y - row.expected_y).toExponential(3)})`,
        );
      }
    });
  });
}

// Julia consumes RNG; flam3's `rand01() < 0.5` selects either `theta + 0`
// or `theta + π`. The fixture doesn't record which branch flam3 took, so
// the test tries both and accepts whichever matches within ε.
//
// Discriminating power: catches bugs in the (cos, sin) shape, the
// `phi * 0.5` factor, atan2 arg order, and `r = sqrt(hypot)`. Does NOT
// catch a *branch-inversion* bug (TS swapping which RNG bit means +π) —
// but branch inversion is not an observable runtime bug for julia
// because the two branches are exact negations and the renderer's
// per-iter RNG produces the same statistical output either way.
//
// PR 2 caveat: variations like `julian` / `juliascope` use
// `n = floor(rand01 * power)` with NON-symmetric branches — those WILL
// require fixture-recorded random values (see docs/HARNESS.md §
// "Adding a new variation"). At that point the fixture format gains a
// `rand_branch` field and the patch instruments per-RNG-variation case
// to record it. Worth doing once for all RNG-using variations rather
// than per-PR.
function runJulia(
  fn: (i: VarInput) => VarOutput,
  fixture: FixtureFile,
  tol: { abs: number; rel: number },
): void {
  fixture.fixtures.forEach((row, idx) => {
    it(`julia row ${idx} (tx=${row.tx.toFixed(4)}, ty=${row.ty.toFixed(4)})`, () => {
      const tries: VarOutput[] = [];
      for (const randBranch of [0, 1]) {
        const out = fn({
          tx: row.tx,
          ty: row.ty,
          weight: row.weight,
          params: row.params,
          randBranch,
        });
        tries.push(out);
        if (
          close(out.x, row.expected_x, tol.abs, tol.rel) &&
          close(out.y, row.expected_y, tol.abs, tol.rel)
        ) {
          return; // match — pass
        }
      }
      // Neither branch matched.
      const t0 = tries[0]!;
      const t1 = tries[1]!;
      throw new Error(
        `julia[${idx}] mismatch (neither branch matched):\n` +
          `  input:     tx=${row.tx} ty=${row.ty} weight=${row.weight}\n` +
          `  expected:  (${row.expected_x}, ${row.expected_y})\n` +
          `  branch=0:  (${t0.x}, ${t0.y})\n` +
          `  branch=1:  (${t1.x}, ${t1.y})`,
      );
    });
  });
}

const tol = (name: string) => TOLERANCES[name] ?? { abs: DEFAULT_ABS, rel: DEFAULT_REL };

describe('variation: linear', () => {
  const fix = loadFixture('linear');
  it('fixture file matches variation name', () => expect(fix.variation).toBe('linear'));
  it('has at least 10 fixture rows', () => expect(fix.fixtures.length).toBeGreaterThanOrEqual(10));
  runDeterministic(ts_var_linear, 'linear', fix, tol('linear'));
});

describe('variation: polar', () => {
  const fix = loadFixture('polar');
  it('fixture file matches variation name', () => expect(fix.variation).toBe('polar'));
  it('has at least 10 fixture rows', () => expect(fix.fixtures.length).toBeGreaterThanOrEqual(10));
  runDeterministic(ts_var_polar, 'polar', fix, tol('polar'));
});

describe('variation: disc', () => {
  const fix = loadFixture('disc');
  it('fixture file matches variation name', () => expect(fix.variation).toBe('disc'));
  it('has at least 10 fixture rows', () => expect(fix.fixtures.length).toBeGreaterThanOrEqual(10));
  runDeterministic(ts_var_disc, 'disc', fix, tol('disc'));
});

describe('variation: spiral', () => {
  const fix = loadFixture('spiral');
  it('fixture file matches variation name', () => expect(fix.variation).toBe('spiral'));
  it('has at least 10 fixture rows', () => expect(fix.fixtures.length).toBeGreaterThanOrEqual(10));
  runDeterministic(ts_var_spiral, 'spiral', fix, tol('spiral'));
});

describe('variation: julia', () => {
  const fix = loadFixture('julia');
  it('fixture file matches variation name', () => expect(fix.variation).toBe('julia'));
  it('has at least 10 fixture rows', () => expect(fix.fixtures.length).toBeGreaterThanOrEqual(10));
  runJulia(ts_var_julia, fix, tol('julia'));
});

// =====================================================================
// Phase 9-test-harness PR 2 — coverage for the remaining 16 variations.
//
// Naming convention: tests are grouped by RNG/parameter requirements:
//   - "deterministic-parameterless": majority (sinusoidal, spherical, …)
//   - "deterministic + injected affine": waves, popcorn (read xform.coefs)
//   - "RNG-using": julian (multi-branch — try all and accept any match)
// =====================================================================

// Multi-branch runner for parametric RNG variations like julian. Tries
// every value of n ∈ [0, |power|-1] and accepts whichever matches within ε.
// This works because flam3's `n = floor(rand01 * |power|)` produces a
// uniform integer in that range; the test doesn't know which n flam3
// chose for a given row, so we brute-force all branches.
function runMultiBranchRng(
  fn: (i: VarInput) => VarOutput,
  name: string,
  fixture: FixtureFile,
  branches: number,
  injectedParams: Record<string, number>,
  tol: { abs: number; rel: number },
): void {
  fixture.fixtures.forEach((row, idx) => {
    it(`${name} row ${idx} (tx=${row.tx.toFixed(4)}, ty=${row.ty.toFixed(4)})`, () => {
      const tries: VarOutput[] = [];
      for (let n = 0; n < branches; n++) {
        const out = fn({
          tx: row.tx,
          ty: row.ty,
          weight: row.weight,
          params: { ...injectedParams, ...row.params },
          randBranch: n,
        });
        tries.push(out);
        if (
          close(out.x, row.expected_x, tol.abs, tol.rel) &&
          close(out.y, row.expected_y, tol.abs, tol.rel)
        ) {
          return;
        }
      }
      throw new Error(
        `${name}[${idx}] mismatch (no branch in [0, ${branches}) matched):\n` +
          `  input:    tx=${row.tx} ty=${row.ty} weight=${row.weight}\n` +
          `  expected: (${row.expected_x}, ${row.expected_y})\n` +
          `  tries:    ${tries.map((t, n) => `n=${n}: (${t.x}, ${t.y})`).join('\n            ')}`,
      );
    });
  });
}

// Affine-injecting deterministic runner. waves/popcorn read b/c/e/f from
// the parent xform's affine (in pyr3's row-major order — see parseCoefs
// in flame-import.ts:55-64). The dump patch doesn't record them, so we
// hardcode the pyr3-mapped values from the input flame here.
//
// Input flame coefs="0.7 0.3 -0.4 0.5 0.1 0.2" maps to:
//   pyr3 (a, b, c, d, e, f) = (0.7, -0.4, 0.1, 0.3, 0.5, 0.2)
// (pyr3.b = flam3.c[1][0] = coefs[2]; pyr3.c = flam3.c[2][0] = coefs[4]; etc.)
// The WGSL kernel reads these as `a0.y, a0.z, a1.y, a1.z` from the packed
// xform — so we inject pyr3 b/c/e/f = -0.4, 0.1, 0.5, 0.2 below.
function runWithAffine(
  fn: (i: VarInput) => VarOutput,
  name: string,
  fixture: FixtureFile,
  affine: Record<string, number>,
  tol: { abs: number; rel: number },
): void {
  fixture.fixtures.forEach((row, idx) => {
    it(`${name} row ${idx} (tx=${row.tx.toFixed(4)}, ty=${row.ty.toFixed(4)})`, () => {
      const out = fn({
        tx: row.tx,
        ty: row.ty,
        weight: row.weight,
        params: { ...affine, ...row.params },
      });
      const xOk = close(out.x, row.expected_x, tol.abs, tol.rel);
      const yOk = close(out.y, row.expected_y, tol.abs, tol.rel);
      if (!xOk || !yOk) {
        throw new Error(
          `${name}[${idx}] mismatch:\n` +
            `  input:    tx=${row.tx} ty=${row.ty} weight=${row.weight}\n` +
            `  affine:   ${JSON.stringify(affine)}\n` +
            `  expected: (${row.expected_x}, ${row.expected_y})\n` +
            `  actual:   (${out.x}, ${out.y})\n` +
            `  diff:     (${(out.x - row.expected_x).toExponential(3)}, ${(out.y - row.expected_y).toExponential(3)})`,
        );
      }
    });
  });
}

// Standard fixture-shape sanity assertions.
function fixtureShapeChecks(name: string, fix: FixtureFile): void {
  it('fixture file matches variation name', () => expect(fix.variation).toBe(name));
  it('has at least 10 fixture rows', () => expect(fix.fixtures.length).toBeGreaterThanOrEqual(10));
}

describe('variation: sinusoidal', () => {
  const fix = loadFixture('sinusoidal');
  fixtureShapeChecks('sinusoidal', fix);
  runDeterministic(ts_var_sinusoidal, 'sinusoidal', fix, tol('sinusoidal'));
});

describe('variation: spherical', () => {
  const fix = loadFixture('spherical');
  fixtureShapeChecks('spherical', fix);
  runDeterministic(ts_var_spherical, 'spherical', fix, tol('spherical'));
});

describe('variation: swirl', () => {
  const fix = loadFixture('swirl');
  fixtureShapeChecks('swirl', fix);
  runDeterministic(ts_var_swirl, 'swirl', fix, tol('swirl'));
});

describe('variation: horseshoe', () => {
  const fix = loadFixture('horseshoe');
  fixtureShapeChecks('horseshoe', fix);
  runDeterministic(ts_var_horseshoe, 'horseshoe', fix, tol('horseshoe'));
});

describe('variation: handkerchief', () => {
  const fix = loadFixture('handkerchief');
  fixtureShapeChecks('handkerchief', fix);
  runDeterministic(ts_var_handkerchief, 'handkerchief', fix, tol('handkerchief'));
});

describe('variation: heart', () => {
  const fix = loadFixture('heart');
  fixtureShapeChecks('heart', fix);
  runDeterministic(ts_var_heart, 'heart', fix, tol('heart'));
});

describe('variation: hyperbolic', () => {
  const fix = loadFixture('hyperbolic');
  fixtureShapeChecks('hyperbolic', fix);
  runDeterministic(ts_var_hyperbolic, 'hyperbolic', fix, tol('hyperbolic'));
});

describe('variation: diamond', () => {
  const fix = loadFixture('diamond');
  fixtureShapeChecks('diamond', fix);
  runDeterministic(ts_var_diamond, 'diamond', fix, tol('diamond'));
});

describe('variation: ex', () => {
  const fix = loadFixture('ex');
  fixtureShapeChecks('ex', fix);
  runDeterministic(ts_var_ex, 'ex', fix, tol('ex'));
});

// julian — parametric (julian_power=3, julian_dist=1 from input-flames/julian.flam3)
// + RNG branch n ∈ {0, 1, 2}.
describe('variation: julian', () => {
  const fix = loadFixture('julian');
  fixtureShapeChecks('julian', fix);
  runMultiBranchRng(
    ts_var_julian,
    'julian',
    fix,
    3,
    { julian_power: 3, julian_dist: 1 },
    tol('julian'),
  );
});

describe('variation: bent', () => {
  const fix = loadFixture('bent');
  fixtureShapeChecks('bent', fix);
  runDeterministic(ts_var_bent, 'bent', fix, tol('bent'));
});

// waves — reads pyr3 b/c/e/f from xform affine (= flam3 c[1][0], c[2][0],
// c[1][1], c[2][1] = coefs string positions 2, 4, 3, 5).
describe('variation: waves', () => {
  const fix = loadFixture('waves');
  fixtureShapeChecks('waves', fix);
  runWithAffine(ts_var_waves, 'waves', fix, { b: -0.4, c: 0.1, e: 0.5, f: 0.2 }, tol('waves'));
});

describe('variation: fisheye', () => {
  const fix = loadFixture('fisheye');
  fixtureShapeChecks('fisheye', fix);
  runDeterministic(ts_var_fisheye, 'fisheye', fix, tol('fisheye'));
});

// popcorn — reads pyr3 c, f from xform affine (= flam3 c[2][0], c[2][1]
// = coefs string positions 4, 5).
describe('variation: popcorn', () => {
  const fix = loadFixture('popcorn');
  fixtureShapeChecks('popcorn', fix);
  runWithAffine(ts_var_popcorn, 'popcorn', fix, { c: 0.1, f: 0.2 }, tol('popcorn'));
});

describe('variation: eyefish', () => {
  const fix = loadFixture('eyefish');
  fixtureShapeChecks('eyefish', fix);
  runDeterministic(ts_var_eyefish, 'eyefish', fix, tol('eyefish'));
});

describe('variation: bubble', () => {
  const fix = loadFixture('bubble');
  fixtureShapeChecks('bubble', fix);
  runDeterministic(ts_var_bubble, 'bubble', fix, tol('bubble'));
});

describe('variation: cylinder', () => {
  const fix = loadFixture('cylinder');
  fixtureShapeChecks('cylinder', fix);
  runDeterministic(ts_var_cylinder, 'cylinder', fix, tol('cylinder'));
});

// disc2 — parametric (disc2_rot, disc2_twist). Input flame at
// tests/flam3-harness/input-flames/disc2.flam3 sets rot=2 twist=1; inject
// the same values here. Reuses the `runWithAffine` runner since it has the
// same shape (deterministic + extra injected params per row).
describe('variation: disc2', () => {
  const fix = loadFixture('disc2');
  fixtureShapeChecks('disc2', fix);
  runWithAffine(
    ts_var_disc2,
    'disc2',
    fix,
    { disc2_rot: 2, disc2_twist: 1 },
    tol('disc2'),
  );
});

// pdj — parametric, four params (pdj_a/b/c/d). First variation to consume the
// Phase 9b extended seam (params 2..3 in addition to 0..1). Input flame at
// tests/flam3-harness/input-flames/pdj.flam3 sets a=1.5 b=-2.0 c=2.5 d=-1.5;
// inject the same values here. Pure / deterministic / no rng, so reuses
// runWithAffine like disc2.
describe('variation: pdj', () => {
  const fix = loadFixture('pdj');
  fixtureShapeChecks('pdj', fix);
  runWithAffine(
    ts_var_pdj,
    'pdj',
    fix,
    { pdj_a: 1.5, pdj_b: -2.0, pdj_c: 2.5, pdj_d: -1.5 },
    tol('pdj'),
  );
});

// =====================================================================
// Phase 9b Batch A — pure 0-param kernels.
// =====================================================================

describe('variation: exponential', () => {
  const fix = loadFixture('exponential');
  fixtureShapeChecks('exponential', fix);
  runDeterministic(ts_var_exponential, 'exponential', fix, tol('exponential'));
});

describe('variation: power', () => {
  const fix = loadFixture('power');
  fixtureShapeChecks('power', fix);
  runDeterministic(ts_var_power, 'power', fix, tol('power'));
});

describe('variation: cosine', () => {
  const fix = loadFixture('cosine');
  fixtureShapeChecks('cosine', fix);
  runDeterministic(ts_var_cosine, 'cosine', fix, tol('cosine'));
});

describe('variation: tangent', () => {
  const fix = loadFixture('tangent');
  fixtureShapeChecks('tangent', fix);
  runDeterministic(ts_var_tangent, 'tangent', fix, tol('tangent'));
});

describe('variation: secant2', () => {
  const fix = loadFixture('secant2');
  fixtureShapeChecks('secant2', fix);
  runDeterministic(ts_var_secant2, 'secant2', fix, tol('secant2'));
});

describe('variation: cross', () => {
  const fix = loadFixture('cross');
  fixtureShapeChecks('cross', fix);
  runDeterministic(ts_var_cross, 'cross', fix, tol('cross'));
});

// =====================================================================
// Phase 9b Batch B — 1-2 param kernels. rings/fan read affine c/f
// (same coefs="0.7 0.3 -0.4 0.5 0.1 0.2" → pyr3 c=0.1, f=0.2). Others
// inject the per-kernel flam3 attributes set in their input flames.
// =====================================================================

// rings — reads affine c (= pyr3 c = flam3 c[2][0] = coefs[4] = 0.1)
describe('variation: rings', () => {
  const fix = loadFixture('rings');
  fixtureShapeChecks('rings', fix);
  runWithAffine(ts_var_rings, 'rings', fix, { c: 0.1 }, tol('rings'));
});

// fan — reads affine c, f
describe('variation: fan', () => {
  const fix = loadFixture('fan');
  fixtureShapeChecks('fan', fix);
  runWithAffine(ts_var_fan, 'fan', fix, { c: 0.1, f: 0.2 }, tol('fan'));
});

// rings2 — 1 param (rings2_val=0.7 from input-flames/rings2.flam3)
describe('variation: rings2', () => {
  const fix = loadFixture('rings2');
  fixtureShapeChecks('rings2', fix);
  runWithAffine(ts_var_rings2, 'rings2', fix, { rings2_val: 0.7 }, tol('rings2'));
});

// fan2 — 2 params (fan2_x=0.5, fan2_y=0.3)
describe('variation: fan2', () => {
  const fix = loadFixture('fan2');
  fixtureShapeChecks('fan2', fix);
  runWithAffine(ts_var_fan2, 'fan2', fix, { fan2_x: 0.5, fan2_y: 0.3 }, tol('fan2'));
});

// perspective — 2 params (perspective_angle=0.5, perspective_dist=2.0)
describe('variation: perspective', () => {
  const fix = loadFixture('perspective');
  fixtureShapeChecks('perspective', fix);
  runWithAffine(
    ts_var_perspective,
    'perspective',
    fix,
    { perspective_angle: 0.5, perspective_dist: 2.0 },
    tol('perspective'),
  );
});

// bipolar — 1 param (bipolar_shift=0.3)
describe('variation: bipolar', () => {
  const fix = loadFixture('bipolar');
  fixtureShapeChecks('bipolar', fix);
  runWithAffine(ts_var_bipolar, 'bipolar', fix, { bipolar_shift: 0.3 }, tol('bipolar'));
});

// curl — 2 params (curl_c1=0.6, curl_c2=0.4)
describe('variation: curl', () => {
  const fix = loadFixture('curl');
  fixtureShapeChecks('curl', fix);
  runWithAffine(ts_var_curl, 'curl', fix, { curl_c1: 0.6, curl_c2: 0.4 }, tol('curl'));
});

// rectangles — 2 params (rectangles_x=0.4, rectangles_y=0.3)
describe('variation: rectangles', () => {
  const fix = loadFixture('rectangles');
  fixtureShapeChecks('rectangles', fix);
  runWithAffine(
    ts_var_rectangles,
    'rectangles',
    fix,
    { rectangles_x: 0.4, rectangles_y: 0.3 },
    tol('rectangles'),
  );
});

// =====================================================================
// Phase 9b Batch C — 3-4 param kernels (vars_extra). cpow uses RNG via
// runMultiBranchRng (same shape as julian — branches = |cpow_power|).
// =====================================================================

// blob — 3 params (low=0.3, high=1.2, waves=6)
describe('variation: blob', () => {
  const fix = loadFixture('blob');
  fixtureShapeChecks('blob', fix);
  runWithAffine(
    ts_var_blob,
    'blob',
    fix,
    { blob_low: 0.3, blob_high: 1.2, blob_waves: 6 },
    tol('blob'),
  );
});

// ngon — 4 params (sides=5, power=3, circle=1, corners=2)
describe('variation: ngon', () => {
  const fix = loadFixture('ngon');
  fixtureShapeChecks('ngon', fix);
  runWithAffine(
    ts_var_ngon,
    'ngon',
    fix,
    { ngon_sides: 5, ngon_power: 3, ngon_circle: 1, ngon_corners: 2 },
    tol('ngon'),
  );
});

// wedge — 4 params (angle=0.6, hole=0.2, count=3, swirl=0.4)
describe('variation: wedge', () => {
  const fix = loadFixture('wedge');
  fixtureShapeChecks('wedge', fix);
  runWithAffine(
    ts_var_wedge,
    'wedge',
    fix,
    { wedge_angle: 0.6, wedge_hole: 0.2, wedge_count: 3, wedge_swirl: 0.4 },
    tol('wedge'),
  );
});

// cpow — 3 params (r=1, i=0.5, power=3) + RNG branch n ∈ {0, 1, 2}.
describe('variation: cpow', () => {
  const fix = loadFixture('cpow');
  fixtureShapeChecks('cpow', fix);
  runMultiBranchRng(
    ts_var_cpow,
    'cpow',
    fix,
    3,
    { cpow_r: 1, cpow_i: 0.5, cpow_power: 3 },
    tol('cpow'),
  );
});

// curve — 4 params (xamp=0.6, yamp=0.4, xlength=0.8, ylength=1.2)
describe('variation: curve', () => {
  const fix = loadFixture('curve');
  fixtureShapeChecks('curve', fix);
  runWithAffine(
    ts_var_curve,
    'curve',
    fix,
    { curve_xamp: 0.6, curve_yamp: 0.4, curve_xlength: 0.8, curve_ylength: 1.2 },
    tol('curve'),
  );
});

// =====================================================================
// Phase 9b Batch D — RNG-using kernels.
//
// juliascope (V=48) uses a discrete RNG branch (n = floor(|power| * rand)),
// same shape as julian — fully testable via runMultiBranchRng.
//
// The other 9 kernels (noise/blur/gaussian_blur/arch/radial_blur/square/
// rays/blade/twintrian) use CONTINUOUS rand values that the current flam3
// dump patch does NOT capture. Their per-row outputs depend on the specific
// rand01() values flam3 consumed, which we don't have. Per-row TS-vs-flam3
// parity is therefore skipped — they're smoke-tested only (impl exists +
// returns finite output when fed placeholder rand values). The proper
// rand-capture infra is BACKLOGGED (Phase 9b RNG test infra). The kernel
// math correctness is gated by the flam3-correctness-verifier reviewer +
// Chrome render eyeball — both sufficient for shipping these per pyr3's
// "feature-coverage parity, not pixel parity" v1.0 framing.
// =====================================================================

// juliascope — full multi-branch test like julian. Input flame at
// tests/flam3-harness/input-flames/juliascope.flam3 sets power=3, dist=1.
describe('variation: juliascope', () => {
  const fix = loadFixture('juliascope');
  fixtureShapeChecks('juliascope', fix);
  runMultiBranchRng(
    ts_var_juliascope,
    'juliascope',
    fix,
    3,
    { juliascope_power: 3, juliascope_dist: 1 },
    tol('juliascope'),
  );
});

// Smoke runner for continuous-RNG kernels — calls the TS impl with the
// fixture row's input + placeholder rand values, asserts the output is
// finite. Catches API breaks + obviously-NaN-producing kernel bugs without
// requiring per-row parity. Wires into the regular test framework so
// adding rand-capture later just swaps this runner for the parity-asserting
// one.
function runSmoke(
  fn: (i: VarInput) => VarOutput,
  name: string,
  fixture: FixtureFile,
  injectedParams: Record<string, number>,
  randValueCount: number,
): void {
  // Inject placeholder rand values [0.25, 0.5, 0.75, 0.5, ...].
  const placeholderRands = Array.from({ length: randValueCount }, (_, k) =>
    [0.25, 0.5, 0.75, 0.5, 0.3][k] ?? 0.5,
  );
  fixture.fixtures.slice(0, 5).forEach((row, idx) => {
    it(`${name} smoke row ${idx}`, () => {
      const out = fn({
        tx: row.tx,
        ty: row.ty,
        weight: row.weight,
        params: { ...injectedParams, ...row.params },
        randValues: placeholderRands,
      });
      if (!Number.isFinite(out.x) || !Number.isFinite(out.y)) {
        throw new Error(
          `${name} smoke[${idx}] produced non-finite output with placeholder rands:\n` +
            `  input: tx=${row.tx} ty=${row.ty} weight=${row.weight}\n` +
            `  output: (${out.x}, ${out.y})`,
        );
      }
    });
  });
}

describe('variation: noise (smoke)', () => {
  const fix = loadFixture('noise');
  fixtureShapeChecks('noise', fix);
  runSmoke(ts_var_noise, 'noise', fix, {}, 2);
});

describe('variation: blur (smoke)', () => {
  const fix = loadFixture('blur');
  fixtureShapeChecks('blur', fix);
  runSmoke(ts_var_blur, 'blur', fix, {}, 2);
});

describe('variation: gaussian_blur (smoke)', () => {
  const fix = loadFixture('gaussian_blur');
  fixtureShapeChecks('gaussian_blur', fix);
  runSmoke(ts_var_gaussian_blur, 'gaussian_blur', fix, {}, 5);
});

describe('variation: arch (smoke)', () => {
  const fix = loadFixture('arch');
  fixtureShapeChecks('arch', fix);
  runSmoke(ts_var_arch, 'arch', fix, {}, 1);
});

// radial_blur — 1 param (angle=0.5)
describe('variation: radial_blur (smoke)', () => {
  const fix = loadFixture('radial_blur');
  fixtureShapeChecks('radial_blur', fix);
  runSmoke(ts_var_radial_blur, 'radial_blur', fix, { radial_blur_angle: 0.5 }, 4);
});

describe('variation: square (smoke)', () => {
  const fix = loadFixture('square');
  fixtureShapeChecks('square', fix);
  runSmoke(ts_var_square, 'square', fix, {}, 2);
});

describe('variation: rays (smoke)', () => {
  const fix = loadFixture('rays');
  fixtureShapeChecks('rays', fix);
  runSmoke(ts_var_rays, 'rays', fix, {}, 1);
});

describe('variation: blade (smoke)', () => {
  const fix = loadFixture('blade');
  fixtureShapeChecks('blade', fix);
  runSmoke(ts_var_blade, 'blade', fix, {}, 1);
});

describe('variation: twintrian (smoke)', () => {
  const fix = loadFixture('twintrian');
  fixtureShapeChecks('twintrian', fix);
  runSmoke(ts_var_twintrian, 'twintrian', fix, {}, 1);
});

// =====================================================================
// Phase 9b Batch E — 14 transcendental kernels (flam3 var82..95). All
// 0-param, no RNG, no affine. Full deterministic parity via runDeterministic.
// =====================================================================

describe('variation: exp', () => {
  const fix = loadFixture('exp');
  fixtureShapeChecks('exp', fix);
  runDeterministic(ts_var_exp, 'exp', fix, tol('exp'));
});

describe('variation: log', () => {
  const fix = loadFixture('log');
  fixtureShapeChecks('log', fix);
  runDeterministic(ts_var_log, 'log', fix, tol('log'));
});

describe('variation: sin', () => {
  const fix = loadFixture('sin');
  fixtureShapeChecks('sin', fix);
  runDeterministic(ts_var_sin, 'sin', fix, tol('sin'));
});

describe('variation: cos', () => {
  const fix = loadFixture('cos');
  fixtureShapeChecks('cos', fix);
  runDeterministic(ts_var_cos, 'cos', fix, tol('cos'));
});

describe('variation: tan', () => {
  const fix = loadFixture('tan');
  fixtureShapeChecks('tan', fix);
  runDeterministic(ts_var_tan, 'tan', fix, tol('tan'));
});

describe('variation: sec', () => {
  const fix = loadFixture('sec');
  fixtureShapeChecks('sec', fix);
  runDeterministic(ts_var_sec, 'sec', fix, tol('sec'));
});

describe('variation: csc', () => {
  const fix = loadFixture('csc');
  fixtureShapeChecks('csc', fix);
  runDeterministic(ts_var_csc, 'csc', fix, tol('csc'));
});

describe('variation: cot', () => {
  const fix = loadFixture('cot');
  fixtureShapeChecks('cot', fix);
  runDeterministic(ts_var_cot, 'cot', fix, tol('cot'));
});

describe('variation: sinh', () => {
  const fix = loadFixture('sinh');
  fixtureShapeChecks('sinh', fix);
  runDeterministic(ts_var_sinh, 'sinh', fix, tol('sinh'));
});

describe('variation: cosh', () => {
  const fix = loadFixture('cosh');
  fixtureShapeChecks('cosh', fix);
  runDeterministic(ts_var_cosh, 'cosh', fix, tol('cosh'));
});

describe('variation: tanh', () => {
  const fix = loadFixture('tanh');
  fixtureShapeChecks('tanh', fix);
  runDeterministic(ts_var_tanh, 'tanh', fix, tol('tanh'));
});

describe('variation: sech', () => {
  const fix = loadFixture('sech');
  fixtureShapeChecks('sech', fix);
  runDeterministic(ts_var_sech, 'sech', fix, tol('sech'));
});

describe('variation: csch', () => {
  const fix = loadFixture('csch');
  fixtureShapeChecks('csch', fix);
  runDeterministic(ts_var_csch, 'csch', fix, tol('csch'));
});

describe('variation: coth', () => {
  const fix = loadFixture('coth');
  fixtureShapeChecks('coth', fix);
  runDeterministic(ts_var_coth, 'coth', fix, tol('coth'));
});


// =====================================================================
// Phase 9b Batch F — 0-param non-RNG kernels (flam3 var57/61/62/64/66/70/72).
// =====================================================================

describe('variation: butterfly', () => {
  const fix = loadFixture('butterfly');
  fixtureShapeChecks('butterfly', fix);
  runDeterministic(ts_var_butterfly, 'butterfly', fix, tol('butterfly'));
});

describe('variation: edisc', () => {
  const fix = loadFixture('edisc');
  fixtureShapeChecks('edisc', fix);
  runDeterministic(ts_var_edisc, 'edisc', fix, tol('edisc'));
});

describe('variation: elliptic', () => {
  const fix = loadFixture('elliptic');
  fixtureShapeChecks('elliptic', fix);
  runDeterministic(ts_var_elliptic, 'elliptic', fix, tol('elliptic'));
});

describe('variation: foci', () => {
  const fix = loadFixture('foci');
  fixtureShapeChecks('foci', fix);
  runDeterministic(ts_var_foci, 'foci', fix, tol('foci'));
});

describe('variation: loonie', () => {
  const fix = loadFixture('loonie');
  fixtureShapeChecks('loonie', fix);
  runDeterministic(ts_var_loonie, 'loonie', fix, tol('loonie'));
});

describe('variation: polar2', () => {
  const fix = loadFixture('polar2');
  fixtureShapeChecks('polar2', fix);
  runDeterministic(ts_var_polar2, 'polar2', fix, tol('polar2'));
});

describe('variation: scry', () => {
  const fix = loadFixture('scry');
  fixtureShapeChecks('scry', fix);
  runDeterministic(ts_var_scry, 'scry', fix, tol('scry'));
});

// =====================================================================
// Phase 9b Batch G — 1-2 param non-RNG kernels.
// =====================================================================

describe('variation: bent2', () => {
  const fix = loadFixture('bent2');
  fixtureShapeChecks('bent2', fix);
  runWithAffine(ts_var_bent2, 'bent2', fix, { bent2_x: 0.6, bent2_y: 0.4 }, tol('bent2'));
});

describe('variation: cell', () => {
  const fix = loadFixture('cell');
  fixtureShapeChecks('cell', fix);
  runWithAffine(ts_var_cell, 'cell', fix, { cell_size: 0.5 }, tol('cell'));
});

describe('variation: escher', () => {
  const fix = loadFixture('escher');
  fixtureShapeChecks('escher', fix);
  runWithAffine(ts_var_escher, 'escher', fix, { escher_beta: 0.7 }, tol('escher'));
});

describe('variation: modulus', () => {
  const fix = loadFixture('modulus');
  fixtureShapeChecks('modulus', fix);
  runWithAffine(ts_var_modulus, 'modulus', fix, { modulus_x: 0.5, modulus_y: 0.5 }, tol('modulus'));
});

describe('variation: split', () => {
  const fix = loadFixture('split');
  fixtureShapeChecks('split', fix);
  runWithAffine(ts_var_split, 'split', fix, { split_xsize: 0.4, split_ysize: 0.3 }, tol('split'));
});

describe('variation: splits', () => {
  const fix = loadFixture('splits');
  fixtureShapeChecks('splits', fix);
  runWithAffine(ts_var_splits, 'splits', fix, { splits_x: 0.5, splits_y: 0.3 }, tol('splits'));
});

describe('variation: stripes', () => {
  const fix = loadFixture('stripes');
  fixtureShapeChecks('stripes', fix);
  runWithAffine(ts_var_stripes, 'stripes', fix, { stripes_space: 0.4, stripes_warp: 0.3 }, tol('stripes'));
});

describe('variation: whorl', () => {
  const fix = loadFixture('whorl');
  fixtureShapeChecks('whorl', fix);
  runWithAffine(ts_var_whorl, 'whorl', fix, { whorl_inside: 0.3, whorl_outside: 0.4 }, tol('whorl'));
});

describe('variation: flux', () => {
  const fix = loadFixture('flux');
  fixtureShapeChecks('flux', fix);
  runWithAffine(ts_var_flux, 'flux', fix, { flux_spread: 0.5 }, tol('flux'));
});


// =====================================================================
// Phase 9b Batch H — 3-4-param non-RNG kernels.
// =====================================================================

describe('variation: popcorn2', () => {
  const fix = loadFixture('popcorn2');
  fixtureShapeChecks('popcorn2', fix);
  runWithAffine(ts_var_popcorn2, 'popcorn2', fix, { popcorn2_x: 0.4, popcorn2_y: 0.3, popcorn2_c: 2.0 }, tol('popcorn2'));
});

describe('variation: lazysusan', () => {
  const fix = loadFixture('lazysusan');
  fixtureShapeChecks('lazysusan', fix);
  runWithAffine(ts_var_lazysusan, 'lazysusan', fix, { lazysusan_x: 0.0, lazysusan_y: 0.0, lazysusan_spin: 1.0, lazysusan_twist: 0.5, lazysusan_space: 0.3 }, tol('lazysusan'));
});

describe('variation: waves2', () => {
  const fix = loadFixture('waves2');
  fixtureShapeChecks('waves2', fix);
  runWithAffine(ts_var_waves2, 'waves2', fix, { waves2_scalex: 0.4, waves2_freqx: 2.0, waves2_scaley: 0.3, waves2_freqy: 2.5 }, tol('waves2'));
});

describe('variation: oscilloscope', () => {
  const fix = loadFixture('oscilloscope');
  fixtureShapeChecks('oscilloscope', fix);
  runWithAffine(ts_var_oscope, 'oscilloscope', fix, { oscope_frequency: 2.0, oscope_amplitude: 0.5, oscope_damping: 0.2, oscope_separation: 0.1 }, tol('oscilloscope'));
});

describe('variation: separation', () => {
  const fix = loadFixture('separation');
  fixtureShapeChecks('separation', fix);
  runWithAffine(ts_var_separation, 'separation', fix, { separation_x: 0.3, separation_xinside: 0.5, separation_y: 0.2, separation_yinside: 0.4 }, tol('separation'));
});

describe('variation: auger', () => {
  const fix = loadFixture('auger');
  fixtureShapeChecks('auger', fix);
  runWithAffine(ts_var_auger, 'auger', fix, { auger_freq: 2.0, auger_weight: 0.6, auger_scale: 0.4, auger_sym: 0.3 }, tol('auger'));
});

describe('variation: wedge_sph', () => {
  const fix = loadFixture('wedge_sph');
  fixtureShapeChecks('wedge_sph', fix);
  runWithAffine(ts_var_wedge_sph, 'wedge_sph', fix, { wedge_sph_angle: 0.5, wedge_sph_hole: 0.2, wedge_sph_count: 3, wedge_sph_swirl: 0.4 }, tol('wedge_sph'));
});


// =====================================================================
// Phase 9b Batch I — RNG-using 3-4 param kernels. Smoke-tested except
// wedge_julia (discrete-branch via runMultiBranchRng).
// =====================================================================

describe('variation: super_shape (smoke)', () => {
  const fix = loadFixture('super_shape');
  fixtureShapeChecks('super_shape', fix);
  runSmoke(
    ts_var_super_shape,
    'super_shape',
    fix,
    { super_shape_rnd: 0.5, super_shape_m: 6, super_shape_n1: 2, super_shape_n2: 2, super_shape_n3: 2, super_shape_holes: 0 },
    1,
  );
});

describe('variation: flower (smoke)', () => {
  const fix = loadFixture('flower');
  fixtureShapeChecks('flower', fix);
  runSmoke(ts_var_flower, 'flower', fix, { flower_petals: 6, flower_holes: 0.3 }, 1);
});

describe('variation: conic (smoke)', () => {
  const fix = loadFixture('conic');
  fixtureShapeChecks('conic', fix);
  runSmoke(ts_var_conic, 'conic', fix, { conic_eccentricity: 0.7, conic_holes: 0.2 }, 1);
});

describe('variation: parabola (smoke)', () => {
  const fix = loadFixture('parabola');
  fixtureShapeChecks('parabola', fix);
  runSmoke(ts_var_parabola, 'parabola', fix, { parabola_height: 0.5, parabola_width: 0.5 }, 2);
});

describe('variation: pie (smoke)', () => {
  const fix = loadFixture('pie');
  fixtureShapeChecks('pie', fix);
  runSmoke(ts_var_pie, 'pie', fix, { pie_slices: 6, pie_rotation: 0.5, pie_thickness: 0.5 }, 3);
});

describe('variation: boarders (smoke)', () => {
  const fix = loadFixture('boarders');
  fixtureShapeChecks('boarders', fix);
  runSmoke(ts_var_boarders, 'boarders', fix, {}, 1);
});

// wedge_julia is discrete-branch (julian-shape) — full parity via runMultiBranchRng.
describe('variation: wedge_julia', () => {
  const fix = loadFixture('wedge_julia');
  fixtureShapeChecks('wedge_julia', fix);
  runMultiBranchRng(
    ts_var_wedge_julia,
    'wedge_julia',
    fix,
    3,
    { wedge_julia_angle: 0.5, wedge_julia_count: 3, wedge_julia_power: 3, wedge_julia_dist: 1 },
    tol('wedge_julia'),
  );
});


// =====================================================================
// Phase 9b Batch J — pre_blur (var67). Structural pre-variation that
// mutates input position (tx, ty) BEFORE the main variation chain runs.
// Smoke-tested (continuous RNG infra still BACKLOGGED).
// =====================================================================

describe('variation: pre_blur (smoke)', () => {
  const fix = loadFixture('pre_blur');
  fixtureShapeChecks('pre_blur', fix);
  runSmoke(ts_var_pre_blur, 'pre_blur', fix, {}, 5);
});


// =====================================================================
// Phase 9b Batch K — mobius (var98). 8 params — first kernel to consume
// the vars_extra2 slot (param6/param7) after the 6 → 8 seam extension.
// No RNG; pure complex Möbius transform.
// =====================================================================

describe('variation: mobius', () => {
  const fix = loadFixture('mobius');
  fixtureShapeChecks('mobius', fix);
  runWithAffine(
    ts_var_mobius,
    'mobius',
    fix,
    {
      mobius_re_a: 1.0, mobius_im_a: 0.3,
      mobius_re_b: 0.2, mobius_im_b: -0.1,
      mobius_re_c: 0.4, mobius_im_c: 0.2,
      mobius_re_d: 1.0, mobius_im_d: -0.2,
    },
    tol('mobius'),
  );
});

// #215 — catalog anchor slug uses the display-label namespace, not the raw
// registry index, so copied deep-links match what the page calls the variation.
describe('catalogAnchorSlug', () => {
  it('keeps flam3 variations on the v-namespace (unchanged)', () => {
    expect(catalogAnchorSlug(V.julian, 'julian')).toBe('v14-julian');
    expect(catalogAnchorSlug(0, 'linear')).toBe('v0-linear');
  });

  it('uses jwfNN for JWildfire ports (idx 99..219)', () => {
    // juliaq is registry idx 109 → display JWF10.
    expect(catalogAnchorSlug(V.juliaq, 'juliaq')).toBe('jwf10-juliaq');
  });

  it('uses pNN for Pyre originals (idx ≥ 220)', () => {
    // schwarzschild_lensing is registry idx 263 → display P43.
    expect(catalogAnchorSlug(V.schwarzschild_lensing, 'schwarzschild_lensing'))
      .toBe('p43-schwarzschild_lensing');
  });
});
