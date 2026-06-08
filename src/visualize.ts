// Tone-map / visualize render pass — full-screen triangle reads either the
// u32 raw histogram (DE off) OR the f32 filtered buffer (DE on), applying
// the flam3 tone-map chain (log-density + alpha + vibrancy/highpow + per-
// channel-gamma composite). Pipeline + bind group selected per-frame
// via the `useDE` flag on draw().

import shaderU32 from './shaders/visualize_u32.wgsl?raw';
import shaderF32 from './shaders/visualize_f32.wgsl?raw';
import { type Tonemap } from './tonemap';
import { type ChannelCurves } from './genome';
import { activeMask, bakeCurves } from './channel-curves';

export interface VisualizePass {
  /**
   * Run the tone-map pass into the supplied texture view. Caller decides what
   * the view points at — browser callers typically pass
   * `context.getCurrentTexture().createView()`; CLI callers pass an offscreen
   * texture's view.
   */
  draw(
    tonemap: Tonemap,
    k1: number,
    k2: number,
    useDE: boolean,
    outputView: GPUTextureView,
    background: [number, number, number],
    channelCurves?: ChannelCurves,
    hslAdjust?: { hue: number; sat: number; light: number },
  ): void;
  /** Phase 9-size: release owned GPU buffers. */
  destroy(): void;
}

// 20 × u32/f32 — see visualize_*.wgsl `struct VizUniforms`. Phase 9-supersample-real
// repurposes _pad0 / _pad1 as `oversample` / `fwidth` for Gaussian-weighted
// super-res → output collapse. Phase 9-bg-palmode adds `background: vec4f` at
// byte offset 48. Issue #116 (Color Curves) adds `curvesActive: u32` + 3 pad
// u32 at byte offset 64 (16 bytes; total now 80; 16-byte aligned).
// Issue #172 (HSL Adjust) adds `hslActive: u32` + `hslHue: f32` + `hslSat: f32`
// + `hslLight: f32` + 3 pad u32 at byte offset 68 (total now 96; 16-byte aligned).
const UNIFORMS_BYTES = 96;

// Issue #116 — color-curves LUT. 5 channels × 256 f32 = 5 KB. Initialized
// to identity (i/255 ramp, 5x); only re-uploaded when `bakeCurves` produces
// a non-null LUT. When `curvesActive == 0` the shader skips reading it,
// so identity-LUT payload is just a safe default for the WebGPU buffer.
const CURVES_BYTES = 5 * 256 * 4;

/**
 * Build the visualize pass. Reads from EITHER `histogramU32` (when
 * `useDE=false`) OR `filteredF32` (when `useDE=true`); both at
 * SUPER-RESOLUTION (`width × oversample` × `height × oversample`).
 * Fragment shader applies per-super-pixel log-density tone-map and
 * Gaussian-weighted collapse to output resolution in one step (matches
 * flam3 filt.c semantics — combined Gaussian filter + supersample collapse).
 */
export function createVisualizePass(
  device: GPUDevice,
  format: GPUTextureFormat,
  histogramU32: GPUBuffer,
  filteredF32: GPUBuffer,
  width: number,
  height: number,
  oversample: number,
  kernel1d: Float32Array,
): VisualizePass {
  const uniforms = device.createBuffer({
    label: 'pyr3.viz.uniforms',
    size: UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const fwidth = kernel1d.length;
  const kernelBuf = device.createBuffer({
    label: 'pyr3.viz.kernel',
    size: Math.max(16, kernel1d.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(kernelBuf, 0, kernel1d.buffer, kernel1d.byteOffset, kernel1d.byteLength);

  // Issue #116 — color-curves LUT buffer. Seeded with identity so it's valid
  // even before any non-identity grade is applied. Shader only reads it when
  // `curvesActive != 0`, so the payload doesn't matter at curvesActive == 0.
  const curvesBuf = device.createBuffer({
    label: 'pyr3.viz.curves',
    size: CURVES_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  {
    const identityLut = new Float32Array(5 * 256);
    for (let ch = 0; ch < 5; ch++) {
      for (let i = 0; i < 256; i++) identityLut[ch * 256 + i] = i / 255;
    }
    device.queue.writeBuffer(
      curvesBuf,
      0,
      identityLut.buffer,
      identityLut.byteOffset,
      identityLut.byteLength,
    );
  }

  const bindGroupLayout = device.createBindGroupLayout({
    label: 'pyr3.viz.bindgroup.layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: 'pyr3.viz.pipeline.layout',
    bindGroupLayouts: [bindGroupLayout],
  });

  const moduleU32 = device.createShaderModule({ label: 'pyr3.viz.u32', code: shaderU32 });
  const pipelineU32 = device.createRenderPipeline({
    label: 'pyr3.viz.pipeline.u32',
    layout: pipelineLayout,
    vertex: { module: moduleU32, entryPoint: 'vs' },
    fragment: { module: moduleU32, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroupU32 = device.createBindGroup({
    label: 'pyr3.viz.bindgroup.u32',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: histogramU32 } },
      { binding: 2, resource: { buffer: kernelBuf } },
      { binding: 3, resource: { buffer: curvesBuf } },
    ],
  });

  const moduleF32 = device.createShaderModule({ label: 'pyr3.viz.f32', code: shaderF32 });
  const pipelineF32 = device.createRenderPipeline({
    label: 'pyr3.viz.pipeline.f32',
    layout: pipelineLayout,
    vertex: { module: moduleF32, entryPoint: 'vs' },
    fragment: { module: moduleF32, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroupF32 = device.createBindGroup({
    label: 'pyr3.viz.bindgroup.f32',
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: filteredF32 } },
      { binding: 2, resource: { buffer: kernelBuf } },
      { binding: 3, resource: { buffer: curvesBuf } },
    ],
  });

  return {
    draw(
      tonemap: Tonemap,
      k1: number,
      k2: number,
      useDE: boolean,
      outputView: GPUTextureView,
      background: [number, number, number],
      channelCurves?: ChannelCurves,
      hslAdjust?: { hue: number; sat: number; light: number },
    ): void {
      const mask = channelCurves ? activeMask(channelCurves) : 0;
      if (channelCurves && mask !== 0) {
        const lut = bakeCurves(channelCurves);
        if (lut) {
          device.queue.writeBuffer(curvesBuf, 0, lut.buffer, lut.byteOffset, lut.byteLength);
        }
      }

      const u32 = new Uint32Array(UNIFORMS_BYTES / 4);
      const f32 = new Float32Array(u32.buffer);
      u32[0] = width;
      u32[1] = height;
      u32[8] = oversample;
      u32[9] = fwidth;
      f32[2] = k1;
      f32[3] = k2;
      f32[4] = tonemap.gamma;
      f32[5] = tonemap.vibrancy;
      f32[6] = tonemap.highlightPower;
      f32[7] = tonemap.gammaThreshold;
      f32[12] = background[0];
      f32[13] = background[1];
      f32[14] = background[2];
      u32[16] = mask;
      if (hslAdjust) {
        u32[17] = 1;
        f32[18] = hslAdjust.hue;
        f32[19] = hslAdjust.sat / 100.0;
        f32[20] = hslAdjust.light / 100.0;
      } else {
        u32[17] = 0;
      }
      device.queue.writeBuffer(uniforms, 0, u32.buffer);

      const encoder = device.createCommandEncoder({ label: 'pyr3.viz.encoder' });
      const pass = encoder.beginRenderPass({
        label: 'pyr3.viz.pass',
        colorAttachments: [
          {
            view: outputView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(useDE ? pipelineF32 : pipelineU32);
      pass.setBindGroup(0, useDE ? bindGroupF32 : bindGroupU32);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy(): void {
      uniforms.destroy();
      kernelBuf.destroy();
      curvesBuf.destroy();
    },
  };
}
