// @vitest-environment node
//
// #72 — safe_sin / safe_cos guard against Dawn's f32 trig range cliff.
//
// Dawn's f32 `sin`/`cos` return exactly 0 for |arg| ≳ 1e7 (their range-reduction
// limit). Variations that feed trig a non-angle-bounded argument (waves with a
// degenerate coef → sin(p·1e10), swirl's sin(r²), disc's sin(π·r), …) therefore
// silently degenerate on the GPU — e.g. waves → the identity transform, which
// collapsed electricsheep.248.25703's attractor coverage 3× (R 14→2.2 once
// fixed). `safe_sin`/`safe_cos` use Dawn's trig below a safe threshold and a
// deterministic, bounded pseudo-spread above it.
//
// This validates the SHIPPED helpers extracted verbatim from chaos.wgsl on a
// live GPU (Dawn via the `webgpu` npm — same runtime as the BE CLI). Skips
// cleanly when no adapter is present, so the GPU-less fast suite stays green
// while still asserting the source-level invariant below.
import { afterAll, describe, expect, it } from 'vitest';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';
import { acquireTestGpu, CHAOS_WGSL } from './gpu-test-harness';

const { gpu: _gpu, device } = await acquireTestGpu();
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = CHAOS_WGSL;

describe('#72 — chaos.wgsl ships safe_sin/safe_cos (source invariant)', () => {
  it('var_waves routes trig through safe_sin (not raw sin)', () => {
    const waves = extractWgslFn(SHADER_SRC, 'var_waves');
    expect(waves).toContain('safe_sin(');
    expect(waves).not.toMatch(/[^_]\bsin\(/); // no un-wrapped sin( in waves
  });
  it('defines safe_sin and safe_cos', () => {
    expect(SHADER_SRC).toContain('fn safe_sin(');
    expect(SHADER_SRC).toContain('fn safe_cos(');
  });
});

describe('#235 — var_tancos / var_funnel route trig through safe_cos (source invariant)', () => {
  it('var_tancos uses safe_cos, not raw cos', () => {
    const tancos = extractWgslFn(SHADER_SRC, 'var_tancos');
    expect(tancos).toContain('safe_cos(');
    expect(tancos).not.toMatch(/[^_]\bcos\(/); // no un-wrapped cos( in tancos
  });
  it('var_funnel uses safe_cos, not raw cos', () => {
    const funnel = extractWgslFn(SHADER_SRC, 'var_funnel');
    expect(funnel).toContain('safe_cos(');
    expect(funnel).not.toMatch(/[^_]\bcos\(/); // no un-wrapped cos( in funnel
  });
});

describe('#262 — tanh of unbounded args routes through safe_tanh (source invariant)', () => {
  it('defines safe_tanh + TANH_SAFE_MAX', () => {
    expect(SHADER_SRC).toContain('fn safe_tanh(');
    expect(SHADER_SRC).toContain('const TANH_SAFE_MAX');
  });
  // Every variation that feeds tanh a non-bounded coord/radius must wrap it.
  for (const fn of ['var_funnel', 'var_tancos', 'var_tractrix', 'var_dc_cylinder_color']) {
    it(`${fn} uses safe_tanh, not raw tanh`, () => {
      const body = extractWgslFn(SHADER_SRC, fn);
      expect(body).toContain('safe_tanh(');
      expect(body).not.toMatch(/[^_]\btanh\(/); // no un-wrapped tanh( in the fn
    });
  }
});

describe('#262 audit — raw sin/cos of cliff-prone args routed through safe_* (source invariant)', () => {
  // The 4 variations the audit found feeding sin/cos a coord×coef or
  // atan2×power argument (the #235 cliff class the #72/#167 sweeps missed).
  // After the fix these have NO un-wrapped sin(/cos( at all.
  for (const fn of ['var_clifford_js', 'var_murl2', 'var_phoenix_julia', 'var_e_julia']) {
    it(`${fn} uses safe_sin/safe_cos, not raw sin/cos`, () => {
      const body = extractWgslFn(SHADER_SRC, fn);
      expect(body).toMatch(/safe_(sin|cos)\(/);
      expect(body).not.toMatch(/[^_]\bsin\(/); // no un-wrapped sin(
      expect(body).not.toMatch(/[^_]\bcos\(/); // no un-wrapped cos(
    });
  }
  // var_bsplit intentionally keeps raw sin_x/cos_x for its doHide guard, but
  // the orthogonal cos(p.y + sy) must be safe_cos (cliff there zeros a
  // surviving walker rather than hiding it).
  it('var_bsplit wraps the orthogonal Y-arg in safe_cos (doHide trig stays raw)', () => {
    const body = extractWgslFn(SHADER_SRC, 'var_bsplit');
    expect(body).toContain('safe_cos(p.y + sy)');
  });
});

describe('#306 M11 — forward scan: no NEW variation feeds raw trig a cliff-prone arg', () => {
  // The pre-#306 safe-trig invariants above check a HARDCODED variation list, so
  // a brand-new variation feeding raw sin/cos/tan/tanh a coord/radius/coef-scaled
  // value (the Dawn f32 cliff hazard) slips through. This scans EVERY `fn var_*`
  // and flags any raw trig outside the audited allowlist below.
  //
  // Allowlist = var_ functions that legitimately contain raw trig: the arg is a
  // freshly-atan2'd angle (already in [-π,π]), a bounded loop/constant angle
  // (TAU·k/n, π/sides, cos(45.0)), a deterministic GLSL spatial-hash where raw
  // sin IS the algorithm (var_circular family), or the var_bsplit doHide guard.
  // Audited exhaustively via pyr3-shader-reviewer for #306. Adding a NEW name
  // here demands the same per-function justification — otherwise wrap the trig
  // in safe_*.
  const RAW_TRIG_OK = new Set<string>([
    'var_circus', 'var_cardioid', 'var_chrysanthemum', 'var_bsplit',
    'var_circular', 'var_circular2', 'var_circleblur', 'var_hypertile', 'var_hypertile1',
    'var_hypertile2', 'var_idisc', 'var_kaleidoscope', 'var_lace_js', 'var_fourth',
    'var_cannabis_curve_wf', 'var_e_collide', 'var_e_mod', 'var_b_mod', 'var_waves4',
    'var_circlecrop', 'var_newton_color', 'var_billiard_sinai', 'var_billiard_polygon',
    'var_quasicrystal', 'var_penrose',
    // theta = 2π·rand01 ∈ [0,2π] — bounded blur angle, not coord-scaled.
    'var_crackle',
    // raw cos/sin(alpha) with alpha = atan2(p.y,p.x) ∈ [-π,π]; the d-scaled
    // theta branches already route through safe_*.
    'var_hole',
  ]);

  // raw trig = sin(/cos(/tan(/tanh( NOT prefixed by `safe_` and not part of
  // atan/asin/acos/sinh/cosh/complex_sin/etc. (lookbehind rejects a word-char
  // before the token; the optional safe_ group classifies the wrapped form).
  const RAW_TRIG = /(?<![A-Za-z0-9_])(safe_)?(sin|cos|tan|tanh)\(/g;
  const stripComments = (s: string): string => s.replace(/\/\/[^\n]*/g, '');
  function hasRawTrig(body: string): boolean {
    for (const m of stripComments(body).matchAll(RAW_TRIG)) {
      if (m[1] === undefined) return true; // no safe_ prefix → raw
    }
    return false;
  }

  const varFnNames = [...SHADER_SRC.matchAll(/\bfn (var_\w+)\s*\(/g)].map((m) => m[1]!);

  it('finds the full var_ catalog (sanity: the scan actually ran)', () => {
    expect(varFnNames.length).toBeGreaterThan(300);
  });

  it('every var_ fn with raw trig is on the audited allowlist', () => {
    const offenders = varFnNames.filter(
      (n) => !RAW_TRIG_OK.has(n) && hasRawTrig(extractWgslFn(SHADER_SRC, n)),
    );
    expect(
      offenders,
      `Un-allowlisted raw trig found in:\n  ${offenders.join('\n  ')}\n` +
        `Route the arg through safe_sin/safe_cos/safe_tan/safe_tanh (Dawn f32 trig ` +
        `cliffs to 0 for |arg|≳1e7 / tanh NaNs for |arg|≳1e3). If the arg is ` +
        `provably angle-bounded (freshly atan2'd, or TAU·k/n), add the fn to ` +
        `RAW_TRIG_OK with a one-line reason.`,
    ).toEqual([]);
  });

  it('the allowlist has no stale entries (each listed fn still uses raw trig)', () => {
    const stale = [...RAW_TRIG_OK].filter(
      (n) => varFnNames.includes(n) && !hasRawTrig(extractWgslFn(SHADER_SRC, n)),
    );
    expect(stale, `RAW_TRIG_OK entries that no longer use raw trig — remove them: ${stale.join(', ')}`).toEqual([]);
  });

  it('the allowlist names only real functions', () => {
    const missing = [...RAW_TRIG_OK].filter((n) => !varFnNames.includes(n));
    expect(missing, `RAW_TRIG_OK names that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});

describe.skipIf(!device)('#72 — safe_sin/safe_cos tame Dawn f32 trig cliff (real GPU)', () => {
  it('Dawn sin/cos cliff to 0 at 1e10, but safe_* stay bounded and non-zero', async () => {
    const dev = device!;
    const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
    const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
    const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
    // Args MUST come from a buffer (runtime values). A literal like `sin(1.0e10)`
    // is constant-folded by the WGSL compiler at full host precision (→ correct
    // result), which masks the runtime f32 trig cliff this test is about.
    const code = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TAU: f32 = 6.2831853071795864769;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(1)
fn main() {
  let big = a[0];   // 1e10 — past Dawn's range-reduction limit
  let small = a[1]; // 0.5  — well within range
  o[0] = sin(big);         // raw Dawn → expect 0 (the cliff)
  o[1] = safe_sin(big);    // fixed → non-zero, bounded
  o[2] = cos(big);         // raw Dawn → expect 0
  o[3] = safe_cos(big);    // fixed → non-zero, bounded
  o[4] = safe_sin(small);  // below threshold → must equal sin(small)
  o[5] = sin(small);
  o[6] = safe_cos(small);  // below threshold → must equal cos(small)
  o[7] = cos(small);
}`;
    const N = 8;
    const inBuf = dev.createBuffer({ size: 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(inBuf, 0, new Float32Array([1e10, 0.5]));
    const buf = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: await compileChecked(dev, code), entryPoint: 'main' } });
    const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: buf } }] });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
    const rb = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(buf, 0, rb, 0, N * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const o = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap(); buf.destroy(); rb.destroy();

    const [rawSinBig, safeSinBig, rawCosBig, safeCosBig, safeSinSmall, sinSmall, safeCosSmall, cosSmall] =
      o as [number, number, number, number, number, number, number, number];

    // Dawn's raw f32 trig cliffs to 0 for the huge argument (the documented bug).
    expect(rawSinBig).toBe(0);
    expect(rawCosBig).toBe(0);
    // safe_* recover a bounded, non-zero spread.
    expect(Math.abs(safeSinBig)).toBeGreaterThan(0);
    expect(Math.abs(safeSinBig)).toBeLessThanOrEqual(1);
    expect(Math.abs(safeCosBig)).toBeGreaterThan(0);
    expect(Math.abs(safeCosBig)).toBeLessThanOrEqual(1);
    // safe_sin/safe_cos of the SAME huge arg share one hashed angle → (sin,cos)
    // stays a consistent unit-circle pair.
    expect(safeSinBig * safeSinBig + safeCosBig * safeCosBig).toBeCloseTo(1, 4);
    // Below the threshold safe_* are exactly the native trig (faithful path).
    expect(safeSinSmall).toBe(sinSmall);
    expect(safeCosSmall).toBe(cosSmall);
  });
});

describe.skipIf(!device)('#235 — var_tancos/var_funnel survive far-field coords (real GPU)', () => {
  it('shipped (safe_cos) variations stay non-degenerate where raw cos would cliff', async () => {
    const dev = device!;
    const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
    const SAFE_SIN = extractWgslFn(SHADER_SRC, 'safe_sin');
    const SAFE_COS = extractWgslFn(SHADER_SRC, 'safe_cos');
    const SAFE_TANH = extractWgslFn(SHADER_SRC, 'safe_tanh');
    const TANCOS = extractWgslFn(SHADER_SRC, 'var_tancos');
    const FUNNEL = extractWgslFn(SHADER_SRC, 'var_funnel');
    // p comes from a buffer (runtime value) so the cos cliff is NOT constant-folded.
    const code = `
const SIN_SAFE_MAX: f32 = 1.0e6;
const TANH_SAFE_MAX: f32 = 20.0;
const TAU: f32 = 6.28318530717958647692;
const PI: f32 = 3.14159265358979323846;
${HASH01}
${SAFE_SIN}
${SAFE_COS}
${SAFE_TANH}
${TANCOS}
${FUNNEL}
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(1)
fn main() {
  let p = vec2f(a[0], a[1]);   // 1e8, 1e8 — r² ~2e16, far past the trig cliff
  // --- tancos: clean cos isolation (the y-channel is cos-only; x uses tanh) ---
  let tc = var_tancos(p, 1.0);
  o[0] = tc.y;                                        // safe path: non-zero
  let d1 = 1e-6 + p.x * p.x + p.y * p.y;
  o[1] = (1.0 / d1) * cos(d1) * 2.0 * p.y;            // raw tancos.y -> 0 (cliff)
  // --- funnel: isolate the secant path #235 actually changes. funnel's tanh(p)
  // NaNs the full output for |p|>~1e3 (Dawn exp-overflow), masking the cos fix
  // at the genome level, so we assert on the cos-derived secant directly. ---
  let cxSafe = safe_cos(p.x);
  o[2] = 1.0 / select(cxSafe, 1e-30, abs(cxSafe) < 1e-30);   // safe secant: bounded
  let cxRaw = cos(p.x);
  o[3] = 1.0 / select(cxRaw, 1e-30, abs(cxRaw) < 1e-30);     // raw secant: ->1e30/NaN
}`;
    const N = 4;
    const inBuf = dev.createBuffer({ size: 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(inBuf, 0, new Float32Array([1e8, 1e8]));
    const buf = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: await compileChecked(dev, code), entryPoint: 'main' } });
    const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: buf } }] });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
    const rb = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(buf, 0, rb, 0, N * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const o = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap(); buf.destroy(); rb.destroy(); inBuf.destroy();

    const [tancosY, rawTancosY, safeSecx, rawSecx] =
      o as [number, number, number, number];
    const degenerate = (v: number) => v === 0 || !Number.isFinite(v) || Math.abs(v) > 1e20;

    // tancos: raw cos(d1)->0 collapses the y-channel; safe_cos keeps it alive.
    expect(degenerate(rawTancosY)).toBe(true);       // raw -> 0
    expect(Number.isFinite(tancosY)).toBe(true);
    expect(tancosY).not.toBe(0);                     // safe_cos recovers the channel

    // funnel secant: raw cos cliff routes the secant to the 1e30 sentinel / NaN;
    // safe_cos keeps it a bounded, finite value (no spurious far-field reseed).
    expect(degenerate(rawSecx)).toBe(true);          // raw -> ±1e30 or NaN
    expect(Number.isFinite(safeSecx)).toBe(true);
    expect(Math.abs(safeSecx)).toBeLessThan(1e6);    // bounded — sentinel avoided
  });
});

describe.skipIf(!device)('#262 — safe_tanh tames Dawn f32 tanh NaN-overflow (real GPU)', () => {
  it('raw tanh NaNs at large args, but safe_tanh saturates to ±1 (and is exact below)', async () => {
    const dev = device!;
    const SAFE_TANH = extractWgslFn(SHADER_SRC, 'safe_tanh');
    // Args from a buffer (runtime) so the overflow is NOT constant-folded.
    const code = `
const TANH_SAFE_MAX: f32 = 20.0;
${SAFE_TANH}
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>;
@compute @workgroup_size(1)
fn main() {
  let big = a[0];   // 1e8 — past the e^x overflow point
  let small = a[1]; // 0.5 — well within range
  o[0] = tanh(big);        // raw Dawn -> NaN (the overflow bug)
  o[1] = safe_tanh(big);   // fixed -> +1 (true saturation limit)
  o[2] = safe_tanh(-big);  // fixed -> -1
  o[3] = safe_tanh(small); // below clamp -> exactly tanh(small)
  o[4] = tanh(small);
}`;
    const N = 5;
    const inBuf = dev.createBuffer({ size: 2 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(inBuf, 0, new Float32Array([1e8, 0.5]));
    const buf = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: await compileChecked(dev, code), entryPoint: 'main' } });
    const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: buf } }] });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(1); pass.end();
    const rb = dev.createBuffer({ size: N * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(buf, 0, rb, 0, N * 4);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const o = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap(); buf.destroy(); rb.destroy(); inBuf.destroy();

    const [rawBig, safeBig, safeNegBig, safeSmall, tanhSmall] =
      o as [number, number, number, number, number];

    // Dawn's raw f32 tanh overflows to NaN for the large arg (the documented bug).
    expect(Number.isNaN(rawBig)).toBe(true);
    // safe_tanh recovers the EXACT saturation limit (±1) — lossless, no hash-spread.
    expect(safeBig).toBe(1);
    expect(safeNegBig).toBe(-1);
    // Below the clamp threshold safe_tanh is exactly native tanh (faithful path).
    expect(safeSmall).toBe(tanhSmall);
  });
});
