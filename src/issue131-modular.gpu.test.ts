// @vitest-environment node
//
// #131 — Modular / number-theory variations (V266–V270). GPU tests follow the
// #133 conformal pattern: extractWgslFn assembles a dependency-ordered prelude
// of helper fns, a @workgroup_size(1) compute shader evaluates the target
// expression per input, and we assert known mathematical identities
// (θ₃→1 as q→0, λ(i)=½, j(i)=1728, ℘ even) plus a JS-oracle parity check for
// the θ₃ q-series recurrence. No ts_var_* export needed.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';

Object.assign(globalThis, globals);

let _gpu: ReturnType<typeof create> | null = null;
let device: GPUDevice | null = null;
try {
  _gpu = create([]);
  const adapter = await _gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);

// Dependency-ordered (WGSL requires declaration-before-use). consts that are
// module-scope in chaos.wgsl (PI/TAU/SIN_SAFE_MAX) don't extract — stamp them.
const BASE_FNS = [
  'hash01', 'safe_sin', 'safe_cos',
  'complex_mul', 'complex_sqr', 'complex_div', 'complex_recip',
  'complex_log', 'complex_exp', 'complex_pow', 'complex_pow_int',
  'to_upper_half_plane', 'modular_nome', 'theta2', 'theta3', 'theta4',
];
const CONSTS = `const PI = 3.14159265358979323846;
const TAU = 6.28318530717958647692;
const SIN_SAFE_MAX: f32 = 1.0e6;
`;
function prelude(extra: string[] = []): string {
  const fns = [...BASE_FNS, ...extra].map((n) => extractWgslFn(SHADER_SRC, n)).join('\n');
  return `${CONSTS}${fns}\n`;
}

// Dispatch `expr(r)` (a vec2f-valued WGSL expression in scope of `r: vec4f`)
// over the inputs. ONE GPU dispatch per call regardless of input count — keep
// the call count low (Dawn+vitest ~47 dispatch/worker cap).
async function dispatch(
  preludeSrc: string,
  expr: string,
  inputs: ReadonlyArray<readonly [number, number, number, number]>,
): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  inputs.forEach((v, i) => { flat.set(Array.from(v), i * 4); });
  const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const code = `${preludeSrc}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = ${expr};
}`;
  const mod = dev.createShaderModule({ code });
  const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }],
  });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N); pass.end();
  const rb = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyBufferToBuffer(outBuf, 0, rb, 0, N * 8);
  dev.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(rb.getMappedRange().slice(0));
  rb.unmap(); inBuf.destroy(); outBuf.destroy(); rb.destroy();
  return out;
}

// JS oracle: θ₃ with the same 8-term recurrence (complex arithmetic).
type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
function jsTheta3(q: C): C {
  const q2 = cmul(q, q);
  let qn2 = q;
  let odd = cmul(q2, q);
  let sum: C = [q[0], q[1]];
  for (let n = 2; n <= 8; n++) {
    qn2 = cmul(qn2, odd);
    sum = [sum[0] + qn2[0], sum[1] + qn2[1]];
    odd = cmul(odd, q2);
  }
  return [1 + 2 * sum[0], 2 * sum[1]];
}
function jsNome(taux: number, tauy: number): C {
  const e = Math.exp(-Math.PI * tauy);
  return [e * Math.cos(Math.PI * taux), e * Math.sin(Math.PI * taux)];
}

describe.skipIf(!device)('#131 substrate — Jacobi θ q-series', () => {
  it('θ₃(q) matches the JS oracle across the upper half-plane', async () => {
    const P = prelude();
    const taus: Array<[number, number]> = [[0.2, 0.5], [-0.4, 0.3], [0.7, 0.15], [0.0, 1.0]];
    const inputs = taus.map((t) => {
      const q = jsNome(t[0], t[1]);
      return [q[0], q[1], 0, 0] as const;
    });
    const out = await dispatch(P, 'theta3(r.xy)', inputs);
    taus.forEach((t, i) => {
      const exp = jsTheta3(jsNome(t[0], t[1]));
      expect(out[i * 2]!).toBeCloseTo(exp[0], 4);
      expect(out[i * 2 + 1]!).toBeCloseTo(exp[1], 4);
    });
  });

  it('θ₃(q) → 1 as q → 0 (large Im τ)', async () => {
    const P = prelude();
    const q = jsNome(0.0, 5.0); // |q| = e^(−5π) ≈ 1.6e−7
    const out = await dispatch(P, 'theta3(r.xy)', [[q[0], q[1], 0, 0]]);
    expect(out[0]!).toBeCloseTo(1.0, 5);
    expect(out[1]!).toBeCloseTo(0.0, 5);
  });

  it('to_upper_half_plane lifts every point above the axis', async () => {
    const P = prelude();
    const out = await dispatch(P, 'to_upper_half_plane(r.xy, r.z)',
      [[0.5, -3.0, 0.15, 0], [0.0, 0.0, 0.02, 0], [1.0, 0.5, 0.5, 0]]);
    // f32 rounds the floors slightly (0.02 → 0.0199999996); allow f32 epsilon.
    expect(out[1]!).toBeGreaterThan(0.0064);
    expect(out[3]!).toBeGreaterThan(0.0199);
    expect(out[5]!).toBeGreaterThan(0.4999);
  });
});

describe.skipIf(!device)('#131 V266 jacobi_theta + V267 modular_lambda', () => {
  it('jacobi_theta → w·(1,0) for large im_floor (q → 0)', async () => {
    const P = prelude(['var_jacobi_theta']);
    // im_floor 5.0 → τ.y ≥ 5 → |q| ≈ 1.6e−7 → θ₃ ≈ 1.
    const out = await dispatch(P, 'var_jacobi_theta(r.xy, 1.0, r.z)', [[0.0, 0.0, 5.0, 0]]);
    expect(out[0]!).toBeCloseTo(1.0, 4);
    expect(out[1]!).toBeCloseTo(0.0, 4);
  });

  it('modular_lambda(i) = 1/2 (real, on the imaginary axis)', async () => {
    const P = prelude(['var_modular_lambda']);
    // im_floor 0.02, p=(0, 0.98) → τ = (0, 1.0) = i → λ(i) = 0.5.
    const out = await dispatch(P, 'var_modular_lambda(r.xy, 1.0, r.z)', [[0.0, 0.98, 0.02, 0]]);
    expect(out[0]!).toBeCloseTo(0.5, 3);
    expect(out[1]!).toBeCloseTo(0.0, 3);
  });

  it('modular_lambda is real and in (0,1) on the imaginary axis', async () => {
    const P = prelude(['var_modular_lambda']);
    const out = await dispatch(P, 'var_modular_lambda(r.xy, 1.0, r.z)',
      [[0.0, 0.5, 0.1, 0], [0.0, 1.5, 0.1, 0], [0.0, 2.5, 0.1, 0]]);
    for (let i = 0; i < 3; i++) {
      expect(out[i * 2]!).toBeGreaterThan(0);
      expect(out[i * 2]!).toBeLessThan(1);
      expect(Math.abs(out[i * 2 + 1]!)).toBeLessThan(1e-3);
    }
  });
});

describe.skipIf(!device)('#131 V268 klein_j', () => {
  it('j(i) = 1728 → compressed magnitude log(1729) on the real axis', async () => {
    const P = prelude(['var_klein_j']);
    // τ = (0,1.0) = i → j = 1728 (real). After log-compression:
    // dir = (1,0), out = log(1+1728) = log(1729) ≈ 7.4554.
    const out = await dispatch(P, 'var_klein_j(r.xy, 1.0, r.z)', [[0.0, 0.98, 0.02, 0]]);
    expect(out[0]!).toBeCloseTo(Math.log(1729), 2);
    expect(out[1]!).toBeCloseTo(0.0, 2);
  });

  it('stays finite everywhere (poles eps-floored + compressed)', async () => {
    const P = prelude(['var_klein_j']);
    const out = await dispatch(P, 'var_klein_j(r.xy, 1.0, r.z)',
      [[0.0, 0.0, 0.05, 0], [0.9, 0.1, 0.05, 0], [-0.5, 0.5, 0.3, 0], [0.3, -0.7, 0.1, 0]]);
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});

describe.skipIf(!device)('#131 V270 gauss_map', () => {
  it('matches frac(1/x) per axis with a known value', async () => {
    const P = prelude(['gauss_frac', 'var_gauss_map']);
    // 1/0.3 = 3.3333 → frac = 0.3333 ; 1/(−0.4) = −2.5 → frac = 0.5
    const out = await dispatch(P, 'var_gauss_map(r.xy, 1.0)', [[0.3, -0.4, 0, 0]]);
    expect(out[0]!).toBeCloseTo(1 / 0.3 - Math.floor(1 / 0.3), 4);
    expect(out[1]!).toBeCloseTo(0.5, 4);
  });

  it('output lands in [0,1) per axis and stays finite at the origin', async () => {
    const P = prelude(['gauss_frac', 'var_gauss_map']);
    const out = await dispatch(P, 'var_gauss_map(r.xy, 1.0)',
      [[0.0, 0.0, 0, 0], [1.7, -2.3, 0, 0], [0.001, 0.05, 0, 0]]);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
      expect(out[i]!).toBeGreaterThanOrEqual(0);
      expect(out[i]!).toBeLessThan(1);
    }
  });
});

describe.skipIf(!device)('#131 V269 weierstrass_p', () => {
  it('is even: ℘(−z) = ℘(z) (square lattice ω₁=1, ω₂=i)', async () => {
    const P = prelude(['var_weierstrass_p']);
    const out = await dispatch(
      P, 'var_weierstrass_p(r.xy, 1.0, 1.0, 0.0, 0.0, 1.0)',
      [[0.37, 0.21, 0, 0], [-0.37, -0.21, 0, 0]],
    );
    expect(out[0]!).toBeCloseTo(out[2]!, 4); // re(℘(z)) == re(℘(−z))
    expect(out[1]!).toBeCloseTo(out[3]!, 4);
  });

  it('stays finite off-lattice and near a pole (compressed)', async () => {
    const P = prelude(['var_weierstrass_p']);
    const out = await dispatch(
      P, 'var_weierstrass_p(r.xy, 1.0, 1.0, 0.0, 0.0, 1.0)',
      [[0.5, 0.5, 0, 0], [0.99, 0.01, 0, 0], [0.01, 0.01, 0, 0], [1.3, 0.7, 0, 0]],
    );
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i]!)).toBe(true);
  });
});
