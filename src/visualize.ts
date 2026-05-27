// Tone-map / visualize render pass — full-screen triangle reads either the
// u32 raw histogram (DE off) OR the f32 filtered buffer (DE on), applying
// the flam3 tone-map chain (log-density + alpha + vibrancy/highpow + per-
// channel-gamma composite). Pipeline + bind group selected per-frame
// via the `useDE` flag on draw().

import shaderU32 from './shaders/visualize_u32.wgsl?raw';
import shaderF32 from './shaders/visualize_f32.wgsl?raw';
import { type Tonemap } from './tonemap';

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
  ): void;
  /** Phase 9-size: release owned GPU buffers. */
  destroy(): void;
}

// 16 × u32/f32 — see visualize_*.wgsl `struct VizUniforms`. Phase 9-supersample-real
// repurposes _pad0 / _pad1 as `oversample` / `fwidth` so the shader can do
// Gaussian-weighted super-res → output collapse. Phase 9-bg-palmode adds
// `background: vec4f` at byte offset 48 (vec4 for 16-byte alignment; .w unused).
const UNIFORMS_BYTES = 64;

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

  const moduleU32 = device.createShaderModule({ label: 'pyr3.viz.u32', code: shaderU32 });
  const pipelineU32 = device.createRenderPipeline({
    label: 'pyr3.viz.pipeline.u32',
    layout: 'auto',
    vertex: { module: moduleU32, entryPoint: 'vs' },
    fragment: { module: moduleU32, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroupU32 = device.createBindGroup({
    label: 'pyr3.viz.bindgroup.u32',
    layout: pipelineU32.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: histogramU32 } },
      { binding: 2, resource: { buffer: kernelBuf } },
    ],
  });

  const moduleF32 = device.createShaderModule({ label: 'pyr3.viz.f32', code: shaderF32 });
  const pipelineF32 = device.createRenderPipeline({
    label: 'pyr3.viz.pipeline.f32',
    layout: 'auto',
    vertex: { module: moduleF32, entryPoint: 'vs' },
    fragment: { module: moduleF32, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroupF32 = device.createBindGroup({
    label: 'pyr3.viz.bindgroup.f32',
    layout: pipelineF32.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: filteredF32 } },
      { binding: 2, resource: { buffer: kernelBuf } },
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
    ): void {
      const u = new ArrayBuffer(UNIFORMS_BYTES);
      const u32 = new Uint32Array(u);
      const f32 = new Float32Array(u);
      u32[0] = width;
      u32[1] = height;
      // Phase 9-supersample-real: _pad0 slot now carries oversample so the
      // fragment shader knows how many super-pixels to N²-collapse per output
      // pixel. Slot is u32 in WGSL; we write via the u32 view. _pad1.._pad3
      // remain reserved (kept zero by the ArrayBuffer init below).
      u32[8] = oversample;
      u32[9] = fwidth;
      f32[2] = k1;
      f32[3] = k2;
      f32[4] = tonemap.gamma;
      f32[5] = tonemap.vibrancy;
      f32[6] = tonemap.highlightPower;
      f32[7] = tonemap.gammaThreshold;
      // _pad2 / _pad3 left zero
      // Phase 9-bg-palmode: pack background as vec4f at byte 48 (slots 12-14;
      // slot 15 left zero — .w unused).
      f32[12] = background[0];
      f32[13] = background[1];
      f32[14] = background[2];
      device.queue.writeBuffer(uniforms, 0, u);

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
    },
  };
}
