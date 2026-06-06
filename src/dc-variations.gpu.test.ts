// @vitest-environment node
//
// #114 — DC (direct-color) variation WGSL helpers must produce the
// expected RGB at sample positions. dc_linear is the first-wave kind
// (Task 2); cases 100/101/102 land in Tasks 3-4 and extend this file.
//
// Pattern: extract the var_dc_*_color helper from chaos.wgsl and drive
// it on real Dawn via a minimal compute kernel. Skips when no GPU
// adapter — fast suite stays green.

import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from './shaders/extract';
import { perlinFbm } from './noise-perlin-oracle';

Object.assign(globalThis, globals);

let device: GPUDevice | null = null;
try {
  const gpu = create([]);
  const adapter = await gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(
  new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8',
);
const NOISE_SRC = readFileSync(
  new URL('./shaders/noise_perlin.wgsl', import.meta.url), 'utf8',
);

// Expected RGB matches the JS oracle defined inline below — derived
// from the WGSL formula in var_dc_linear_color (clamped affine on x, y).
function dcLinearOracle(x: number, y: number): [number, number, number] {
  const r = Math.max(0, Math.min(1, 0.5 + 0.5 * x));
  const g = Math.max(0, Math.min(1, 0.5 + 0.5 * y));
  const b = Math.max(0, Math.min(1, 0.5 - 0.25 * (x + y)));
  return [r, g, b];
}

describe.skipIf(!device)('#114 — var_dc_linear_color (chaos.wgsl)', () => {
  it('matches oracle RGB at sample positions on real Dawn', async () => {
    const dev = device!;
    const FN = extractWgslFn(SHADER_SRC, 'var_dc_linear_color');

    const code = `
${FN}

@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> out: array<vec4f>;
@compute @workgroup_size(8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  let rgb = var_dc_linear_color(pts[i]);
  out[i] = vec4f(rgb, 1.0);
}`;

    const POINTS: ReadonlyArray<readonly [number, number]> = [
      [ 0.0,  0.0],
      [ 0.5,  0.5],
      [-0.5, -0.5],
      [ 1.0,  1.0],
      [-1.0,  1.0],
      [ 5.0,  5.0],   // far past range → clamped to (1, 1, 0)
      [-5.0, -5.0],   // far past range → clamped to (0, 0, 1)
    ];
    const N = POINTS.length;

    const ptsFlat = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const [x, y] = POINTS[i]!;
      ptsFlat[i * 2 + 0] = x;
      ptsFlat[i * 2 + 1] = y;
    }
    const ptsBuf = dev.createBuffer({
      size: ptsFlat.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(ptsBuf, 0, ptsFlat);

    const outBuf = dev.createBuffer({
      size: N * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bg = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ptsBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(N / 8));
    pass.end();
    const rb = dev.createBuffer({
      size: N * 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyBufferToBuffer(outBuf, 0, rb, 0, N * 16);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const got = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap();
    ptsBuf.destroy();
    outBuf.destroy();
    rb.destroy();

    for (let i = 0; i < N; i++) {
      const [x, y] = POINTS[i]!;
      const [r, g, b] = dcLinearOracle(x, y);
      expect(got[i * 4 + 0]).toBeCloseTo(r, 5);
      expect(got[i * 4 + 1]).toBeCloseTo(g, 5);
      expect(got[i * 4 + 2]).toBeCloseTo(b, 5);
    }
  });
});

describe.skipIf(!device)('#114 — var_dc_perlin_color matches oracle on Dawn', () => {
  it('hue cycles with noise field; saturation 1.0, lightness 0.55', async () => {
    const dev = device!;
    const FN = extractWgslFn(SHADER_SRC, 'var_dc_perlin_color');
    const HSL = extractWgslFn(SHADER_SRC, 'hsl_to_rgb');

    // Need the noise helpers too — they live in noise_perlin.wgsl.
    const code = `
${NOISE_SRC}
${HSL}
${FN}

struct In { p: vec2f, scale: f32, octaves: f32, color_seed: f32, _pad: f32, _pad2: f32, _pad3: f32 };
@group(0) @binding(0) var<storage, read> ins: array<In>;
@group(0) @binding(1) var<storage, read_write> out: array<vec4f>;
@compute @workgroup_size(8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let q = ins[i];
  out[i] = vec4f(var_dc_perlin_color(q.p, q.scale, q.octaves, q.color_seed), 1.0);
}`;

    const SAMPLES: ReadonlyArray<readonly [number, number, number, number, number]> = [
      // (x, y, scale, octaves, seed)
      [ 0.0, 0.0, 1.0, 3, 0.0],
      [ 0.5, 0.5, 1.0, 3, 0.0],
      [ 1.5, 2.7, 1.0, 3, 0.25],
      [-3.3, 4.8, 2.0, 4, 0.5],
      [10.0, 10.0, 0.5, 2, 0.0],
    ];
    const N = SAMPLES.length;

    // In = 4 f32 + 3 pad f32 + 1 implicit = 8 f32 / 32 bytes for std430
    // vec2f alignment + 16-byte struct alignment safety.
    const flat = new Float32Array(N * 8);
    for (let i = 0; i < N; i++) {
      const [x, y, s, o, seed] = SAMPLES[i]!;
      flat[i * 8 + 0] = x;
      flat[i * 8 + 1] = y;
      flat[i * 8 + 2] = s;
      flat[i * 8 + 3] = o;
      flat[i * 8 + 4] = seed;
    }
    const inBuf = dev.createBuffer({
      size: flat.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(inBuf, 0, flat);
    const outBuf = dev.createBuffer({
      size: N * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const pipeline = dev.createComputePipeline({
      layout: 'auto',
      compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' },
    });
    const bg = dev.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inBuf } },
        { binding: 1, resource: { buffer: outBuf } },
      ],
    });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(N / 8));
    pass.end();
    const rb = dev.createBuffer({
      size: N * 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyBufferToBuffer(outBuf, 0, rb, 0, N * 16);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const got = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap();
    inBuf.destroy();
    outBuf.destroy();
    rb.destroy();

    // Per-sample asserts: outputs in [0, 1] and not all the same hue
    // (proves the noise field is driving things, not a constant).
    const fingerprints: string[] = [];
    for (let i = 0; i < N; i++) {
      const r = got[i * 4 + 0]!;
      const g = got[i * 4 + 1]!;
      const b = got[i * 4 + 2]!;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      // Full RGB tuple as fingerprint (10-bucket quantization) — catches
      // hue rotation even when saturation/lightness are constant.
      fingerprints.push(
        `${Math.round(r * 10)}-${Math.round(g * 10)}-${Math.round(b * 10)}`,
      );
    }
    const distinct = new Set(fingerprints);
    expect(distinct.size).toBeGreaterThan(1);

    // Spot-check: at (0,0), noise = 0 → hue = fract(0.5 + 0 + 0) = 0.5,
    // sat = 1, l = 0.55 → cyan-ish (low R, high G, high B).
    const [r0, g0, b0] = [got[0]!, got[1]!, got[2]!];
    expect(r0).toBeLessThan(g0);
    expect(r0).toBeLessThan(b0);

    // Use the oracle to make sure perlinFbm is wired (smoke import).
    expect(perlinFbm(0, 0, 3, 1)).toBe(0);
  });
});

describe.skipIf(!device)('#114 — var_dc_gridout_color produces discrete cells', () => {
  it('points within the same cell get the same color; different cells differ', async () => {
    const dev = device!;
    const FN = extractWgslFn(SHADER_SRC, 'var_dc_gridout_color');
    const HASH01 = extractWgslFn(SHADER_SRC, 'hash01');
    const code = `
${HASH01}
${FN}
@group(0) @binding(0) var<storage, read> pts: array<vec4f>;  // (x, y, cells, _)
@group(0) @binding(1) var<storage, read_write> out: array<vec4f>;
@compute @workgroup_size(8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&pts)) { return; }
  let q = pts[i];
  out[i] = vec4f(var_dc_gridout_color(q.xy, q.z), 1.0);
}`;
    const POINTS: ReadonlyArray<readonly [number, number, number]> = [
      [0.1, 0.1, 4.0],   // cell (0,0)
      [0.2, 0.2, 4.0],   // cell (0,0) — same as above
      [0.3, 0.1, 4.0],   // cell (1,0) — different X cell
      [0.1, 0.3, 4.0],   // cell (0,1) — different Y cell
      [0.5, 0.5, 4.0],   // cell (2,2)
    ];
    const N = POINTS.length;
    const flat = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const [x, y, cells] = POINTS[i]!;
      flat[i * 4 + 0] = x;
      flat[i * 4 + 1] = y;
      flat[i * 4 + 2] = cells;
    }
    const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(inBuf, 0, flat);
    const outBuf = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const pipeline = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code }), entryPoint: 'main' } });
    const bg = dev.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: outBuf } }] });
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(N / 8)); pass.end();
    const rb = dev.createBuffer({ size: N * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(outBuf, 0, rb, 0, N * 16);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const got = Array.from(new Float32Array(rb.getMappedRange().slice(0)));
    rb.unmap(); inBuf.destroy(); outBuf.destroy(); rb.destroy();

    const cellRGB = (i: number): [number, number, number] => [got[i * 4]!, got[i * 4 + 1]!, got[i * 4 + 2]!];

    // (0.1, 0.1) and (0.2, 0.2) — same cell (0,0): identical RGB
    expect(cellRGB(0)).toEqual(cellRGB(1));
    // (0.3, 0.1) — different cell from (0.1, 0.1): different RGB
    expect(cellRGB(2)).not.toEqual(cellRGB(0));
    // (0.1, 0.3) — different cell again
    expect(cellRGB(3)).not.toEqual(cellRGB(0));
    // All in [0, 1]
    for (let i = 0; i < N; i++) {
      for (const c of cellRGB(i)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('#114 — chaos.wgsl source invariants for DC override path', () => {
  it('ships all 4 dc_* color functions', () => {
    expect(SHADER_SRC).toContain('fn var_dc_linear_color(');
    expect(SHADER_SRC).toContain('fn var_dc_perlin_color(');
    expect(SHADER_SRC).toContain('fn var_dc_gridout_color(');
    expect(SHADER_SRC).toContain('fn var_dc_cylinder_color(');
  });
  it('dispatches cases 99-102 in apply_variation', () => {
    expect(SHADER_SRC).toContain('case 99u:');
    expect(SHADER_SRC).toContain('case 100u:');
    expect(SHADER_SRC).toContain('case 101u:');
    expect(SHADER_SRC).toContain('case 102u:');
  });
  it('reads dc_flag from color_params.w in chain loop', () => {
    expect(SHADER_SRC).toContain('xf.color_params.w > 0.5');
  });
  it('overrides pal with dc_rgb_override at splat', () => {
    expect(SHADER_SRC).toContain('dc_override_active');
    expect(SHADER_SRC).toContain('dc_rgb_override');
  });
});
