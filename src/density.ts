// pyr3 — density estimation (Phase 6).
//
// Adaptive Gaussian gather between the chaos histogram and the visualize
// fragment shader. The CPU side defines the genome-level params and the
// radius-from-count helper used by tests; the GPU side (createDensityPass +
// the WGSL shader) is added in Task 4.

export interface Density {
  maxRad: number; // [0, 30] — outer cap on filter radius (px)
  minRad: number; // [0, maxRad] — inner cap (high-count pixels never tighter)
  curve: number; // [0.1, 2.0] — falloff exponent in r = maxRad / pow(count+1, curve)
}

export const DEFAULT_DENSITY: Density = {
  maxRad: 9.0,
  minRad: 0.0,
  curve: 0.4,
};

export const MAX_RAD_CAP = 30;
export const MIN_CURVE = 0.1;
export const MAX_CURVE = 2.0;

// Built-in density presets — surfaced as clickable rows in the HUD overlay.
// Tuning rationale: minRad=0 keeps bright lines knife-sharp across all four;
// each preset varies maxRad + curve to land on a different aesthetic point.
export interface DensityPreset {
  name: string;
  density: Density;
}

export const DENSITY_PRESETS: DensityPreset[] = [
  { name: 'classic', density: { maxRad: 9, minRad: 0, curve: 0.4 } },
  { name: 'crisp', density: { maxRad: 4, minRad: 0, curve: 0.6 } },
  { name: 'dreamy', density: { maxRad: 18, minRad: 0, curve: 0.3 } },
  { name: 'detail', density: { maxRad: 2, minRad: 0, curve: 1.0 } },
];

// Adaptive radius from local count. High-count pixels get a tight kernel
// (preserves detail); low-count pixels get a wide kernel (smooths noise).
// Clamped to [minRad, maxRad].
export function radiusFor(count: number, d: Density): number {
  const raw = d.maxRad / Math.pow(count + 1, d.curve);
  return Math.min(d.maxRad, Math.max(d.minRad, raw));
}

// ---- GPU compute pass ----

import shaderCode from './shaders/density.wgsl?raw';

export interface DensityConfig {
  width: number;
  height: number;
}

export interface DensityPass {
  filtered: GPUBuffer;
  dispatch(density: Density, k1: number, k2: number, oversample: number): void;
  destroy(): void;
}

const UNIFORMS_BYTES = 32;
const WORKGROUP_X = 8;
const WORKGROUP_Y = 8;
// Cap on the per-bucket adaptive radius (in super-pixels). Sized to fit the
// largest comp_max_radius pyr3 will see: max_rad=30 (MAX_RAD_CAP from
// density.ts) × oversample=8 + 1 = 241. Round up to 256 for power-of-two.
const MAX_RAD_LUT = 256;

/**
 * Build the per-radius kernel-sum normalization LUT used by the DE shader.
 * For each integer radius r in [0, MAX_RAD_LUT], compute the sum of the
 * Gaussian kernel `exp(-d² / 2σ²)` (with σ = r/3) over the disc of radius r
 * — this is the per-bucket normalization factor that ensures each bucket
 * scatters exactly 1.0 worth of weight across its kernel area, matching
 * flam3's `flam3_create_de_filters` precomputed kernel-sum behavior.
 */
export function buildKernelNormLut(): Float32Array {
  const lut = new Float32Array(MAX_RAD_LUT + 1);
  for (let r = 0; r <= MAX_RAD_LUT; r++) {
    if (r === 0) {
      lut[r] = 1.0; // single tap at d=0 → exp(0) = 1
      continue;
    }
    const sigma = r / 3.0;
    const inv2s2 = 1.0 / (2.0 * sigma * sigma);
    const r2 = r * r;
    let sum = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        sum += Math.exp(-d2 * inv2s2);
      }
    }
    lut[r] = sum;
  }
  return lut;
}

export function createDensityPass(
  device: GPUDevice,
  config: DensityConfig,
  histogram: GPUBuffer,
): DensityPass {
  const filteredBytes = config.width * config.height * 4 * 4;
  const filtered = device.createBuffer({
    label: 'pyr3.density.filtered',
    size: filteredBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const uniforms = device.createBuffer({
    label: 'pyr3.density.uniforms',
    size: UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const lut = buildKernelNormLut();
  const lutBuf = device.createBuffer({
    label: 'pyr3.density.kernel_norm',
    size: lut.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(lutBuf, 0, lut.buffer, lut.byteOffset, lut.byteLength);

  const module = device.createShaderModule({ label: 'pyr3.density', code: shaderCode });
  const pipeline = device.createComputePipeline({
    label: 'pyr3.density.pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'density_main' },
  });

  const bindGroup = device.createBindGroup({
    label: 'pyr3.density.bindgroup',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: histogram } },
      { binding: 2, resource: { buffer: filtered } },
      { binding: 3, resource: { buffer: lutBuf } },
    ],
  });

  return {
    filtered,
    dispatch(d: Density, k1: number, k2: number, oversample: number): void {
      const u = new ArrayBuffer(UNIFORMS_BYTES);
      const u32 = new Uint32Array(u);
      const f32 = new Float32Array(u);
      u32[0] = config.width;
      u32[1] = config.height;
      // Scale OUTPUT-pixel radii to super-pixel radii per flam3 filt.c:297
      // (`comp_max_radius = max_rad × supersample + 1`). Without this,
      // sparse-hit pixels would spread over a 4× tighter region at oversample=4,
      // failing to dilute properly and leaking brightness into gap regions.
      f32[2] = d.maxRad * oversample + 1;
      f32[3] = d.minRad * oversample + 1;
      f32[4] = d.curve;
      f32[5] = k1;
      f32[6] = k2;
      // u32[7] is _pad
      device.queue.writeBuffer(uniforms, 0, u);

      const encoder = device.createCommandEncoder({ label: 'pyr3.density.encoder' });
      const pass = encoder.beginComputePass({ label: 'pyr3.density.pass' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(config.width / WORKGROUP_X),
        Math.ceil(config.height / WORKGROUP_Y),
      );
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy(): void {
      filtered.destroy();
      uniforms.destroy();
      lutBuf.destroy();
    },
  };
}
