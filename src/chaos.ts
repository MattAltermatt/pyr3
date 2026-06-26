// Chaos compute pass — dispatch a wave of walkers, each scattering hits
// into a 4-channel u32 atomic histogram (R, G, B, count). Each hit
// samples the palette at the iterated color coord and atomically accumulates.

import chaosCore from './shaders/chaos.wgsl?raw';
import noisePerlinSrc from './shaders/noise_perlin.wgsl?raw';
// #114 — prepend the standalone Perlin noise WGSL so var_dc_perlin can
// call perlin_fbm. Keeping noise_perlin.wgsl as a separate file gives us
// isolated unit tests (noise-perlin.gpu.test.ts) without needing the
// full chaos kernel scaffolding.
const shaderCode = `${noisePerlinSrc}\n${chaosCore}`;
import {
  type Genome,
  MAX_XFORMS,
  packXforms,
  finalXformSlot,
  packXformDistrib,
  XFORM_BYTES,
  XFORM_DISTRIB_BYTES,
  XFORM_DISTRIB_FALLBACK_OFFSET,
} from './genome';
import { type Palette, packPalette, PALETTE_BYTES } from './palette';
import { expandGenomeForGPU } from './symmetry';
import { ISAAC_STATE_U32, packIsaacStates } from './isaac';

// Per-walker ISAAC state (matches `IsaacState` in `chaos.wgsl`):
//   u32 randcnt + u32 randa + u32 randb + u32 randc + u32[16] randmem + u32[16] randrsl
// = 36 u32 = 144 bytes per walker. WGSL struct alignment: u32-fields are
// 4-aligned, array<u32, 16> is also 4-aligned, struct total = 144 bytes (mul of 16).
const ISAAC_STATE_BYTES = ISAAC_STATE_U32 * 4;

export interface ChaosConfig {
  width: number;
  height: number;
  walkers: number;
  itersPerWalker: number;
  fuse: number;
  /** Supersample factor — the AUTHORITY for the splat scale (PYR3-008). The
   *  super-canvas dims (width/height above) are already built with it, so the
   *  chaos pass reads oversample from here, NOT from `genome.oversample`. The
   *  genome value is a vestigial parallel input that let v0.2's camera-zoom bug
   *  creep in when host setup forgot to keep the two in sync. */
  oversample: number;
}

export interface DispatchOpts {
  /** Override walker count (Phase 9-cal-B; defaults to config.walkers). */
  walkers?: number;
  /** Override iters-per-walker (Phase 9-cal-B; defaults to config.itersPerWalker). */
  itersPerWalker?: number;
  /** PYR3-029 Phase 5b — enable per-iter trace emission for walker 0, first
   *  1000 post-fuse iters. Caller reads `pass.traceBuffer` to retrieve. */
  traceMode?: boolean;
  /** #65 Tier 1 — per-iter walker trajectory jitter factor. Default
   *  DEFAULT_WALKER_JITTER (a scale-relative proportional factor since #43);
   *  0 disables jitter (f32-collapse cliff returns). See chaos.wgsl
   *  `walker_jitter` for the full rationale. */
  walkerJitter?: number;
  /** #459/#460/#465 — color mode. 'palette' (default) = normal palette/DC color;
   *  'flow' = per-iteration displacement (velocity); 'trap-distance' = distance
   *  to a trap shape; 'phase' = complex-domain coloring (arg(z)→hue, log|z|→rings). */
  colorMode?: 'palette' | 'flow' | 'trap-distance' | 'phase';
  /** #459 — flow-map blend in [0,1]; default 1.0. 0 = palette, 1 = pure flow.
   *  Only consulted when colorMode === 'flow'. */
  flowStrength?: number;
  /** #459 — flow-map magnitude log-saturation factor; default DEFAULT_FLOW_SCALE. */
  flowScale?: number;
  /** #460 — trap-distance params; consulted when colorMode === 'trap-distance'. */
  trap?: import('./trap-config').TrapConfig;
  /** #465 — Phase/Polar blend in [0,1]; default 1.0. 0 = palette, 1 = pure phase.
   *  Only consulted when colorMode === 'phase'. */
  phaseStrength?: number;
  /** #465 — Phase/Polar log-modulus ring frequency; default 1.0. 0 = pure phase
   *  field (no rings). Only consulted when colorMode === 'phase'. */
  phaseFreq?: number;
}

/** Default walker-jitter proportional factor.
 *
 *  #43 Tier 4 (2026-06-02): the jitter mechanism is now SCALE-RELATIVE
 *  (chaos.wgsl uses `local_mag * u.walker_jitter` per iter, not the bare
 *  amplitude). So this constant is a DIMENSIONLESS multiplier, not an
 *  absolute amplitude. The empirical sweet spot at `1e-7` sits at f32 epsilon
 *  (`2^-23 ≈ 1.19e-7`) — anchored to a physical constant of the float
 *  format itself rather than a per-genome tunable.
 *
 *  Historical (replaced by scale-relative; absolute amplitudes for git-blame):
 *    pre-#6:        1e-6  abs   (R 24 on 248.23554)
 *    PYR3-N/v0.35:  1e-8  abs
 *    #6 7110721:    1e-10 abs   (R 11.4)
 *
 *  Any caller can override via DispatchOpts.walkerJitter (or the propagated
 *  IterateRequest/RenderRequest.walkerJitter); the BE `--jitter` flag and
 *  the DEV-gated `?jitter=` URL param both route through that path.
 */
export const DEFAULT_WALKER_JITTER = 1e-7;

export interface ChaosPass {
  config: ChaosConfig;
  histogram: GPUBuffer;
  /** PYR3-029 Phase 5b — per-iter trace storage, 1000 entries × 16 f32. */
  traceBuffer: GPUBuffer;
  setPalette(palette: Palette): void;
  reset(): void;
  dispatch(genome: Genome, seed: number, opts?: DispatchOpts): void;
  /** #269 Phase 2 — enable/disable per-pixel color-index capture (off by
   *  default). When on, subsequent dispatches accumulate idx_sum; reset()
   *  zeros it. */
  setCaptureIndex(on: boolean): void;
  /** #269 Phase 2 — read back idx_sum + the histogram count channel for every
   *  super-pixel. Caller downsamples to output dims (see color-index-map.ts).
   *  Call after the render's iteration completes. */
  readIndexAndCount(): Promise<{ idxSum: Uint32Array; count: Uint32Array; width: number; height: number }>;
  /** #334 — read back the full raw RGBA accumulation histogram (R, G, B, count
   *  u32 per super-pixel) for linear-HDR EXR export. The caller collapses
   *  oversample blocks to output dims (see export-linear.ts). Call after the
   *  render's iteration completes. */
  readHistogramRgba(): Promise<{ rgba: Uint32Array; superW: number; superH: number }>;
  /** Phase 9-size: release owned GPU buffers. Caller is responsible for not
   *  using the pass after destroy(). */
  destroy(): void;
}

const WORKGROUP_SIZE = 64;
// 31 scalar slots × 4 bytes = 124 bytes of named fields (slots 0..30; slot 14 =
// captureIndex #269; slots 15-17 = color_mode/flow_strength/flow_scale #459;
// slots 18-27 = trap_kind/trap_mode/trap_cx/trap_cy/trap_radius/trap_nx/trap_ny/
// trap_falloff/trap_freq/trap_strength #460; slots 28-29 = phase_strength/
// phase_freq #465; slot 30 = xform_blend #456). WGSL rounds the uniform struct up
// to a 16-byte multiple → 128 bytes (slot 31 is unwritten tail padding);
// UNIFORMS_BYTES matches.
// `Uniforms` is all 4-byte scalars, so its derived minBindingSize is 112; the
// 112-byte buffer satisfies it exactly. Keep the buffer at 112 to match the
// struct's named-field span.
const UNIFORMS_BYTES = 128;

/** #459 — default flow-map magnitude log-saturation factor (used when
 *  colorMode === 'flow' and no flowScale override is supplied). */
export const DEFAULT_FLOW_SCALE = 2.0;

// 4 channels (R, G, B, count) of u32 per pixel.
export const HIST_CHANNELS = 4;

export function createChaosPass(device: GPUDevice, config: ChaosConfig): ChaosPass {
  const histogramBytes = config.width * config.height * HIST_CHANNELS * 4;
  const histogram = device.createBuffer({
    label: 'pyr3.chaos.histogram',
    size: histogramBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  const uniforms = device.createBuffer({
    label: 'pyr3.chaos.uniforms',
    size: UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // #269 Phase 2 — per-super-pixel color-index accumulator. One u32 per pixel
  // (stride 1, NOT HIST_CHANNELS). COPY_SRC for readback. Always allocated;
  // written by the kernel only when captureIndex is on (the gradient page).
  const idxSumBytes = config.width * config.height * 4;
  const idxSum = device.createBuffer({
    label: 'pyr3.chaos.idx_sum',
    size: idxSumBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  // #269 Phase 2 — capture gate, toggled via setCaptureIndex(); off for every
  // non-gradient consumer so the histogram output stays byte-identical.
  let captureIndex = false;

  const xforms = device.createBuffer({
    label: 'pyr3.chaos.xforms',
    size: (MAX_XFORMS + 1) * XFORM_BYTES, // +1 reserved slot for finalxform
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const paletteBuffer = device.createBuffer({
    label: 'pyr3.chaos.palette',
    size: PALETTE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // ISAAC state buffer: one ISAAC stream per walker, sized for the configured
  // walker pool. Re-uploaded on every dispatch with fresh seeds. 36 u32 per
  // walker × MAX_WALKERS budget — at 1024 walkers × 144 bytes = 144 KB.
  // #11 (PYR3-057): a dispatch can request more walkers than `config.walkers`
  // (per-frame `opts.walkers`); the buffer lazily grows in `dispatch()` so the
  // ISAAC writeBuffer never overruns it (which WebGPU would reject → silent
  // blank). `let` + capacity tracking lets us rebuild it and the bind group.
  let isaacCapacity = config.walkers;
  let isaacBuffer = device.createBuffer({
    label: 'pyr3.chaos.isaac',
    size: isaacCapacity * ISAAC_STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // PYR3-029 Phase 5b — per-iter trace buffer for the bilateral RNG-aligned
  // diff probe. Walker 0 writes 16 f32 per iter for the first 1000 post-fuse
  // iters when uniforms.trace_mode == 1. Always bound (chaos_main references
  // it unconditionally) but zero-sized writes when trace_mode == 0 — perf
  // impact on normal renders is one extra branch per iter (negligible vs the
  // 1500-line variation chain).
  const TRACE_ENTRIES = 1000;
  const TRACE_FLOATS_PER_ENTRY = 16;
  const traceBuffer = device.createBuffer({
    label: 'pyr3.chaos.trace',
    size: TRACE_ENTRIES * TRACE_FLOATS_PER_ENTRY * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

  // PYR3-029 Phase 5c: flam3-canonical xform-pick distribution table.
  // (MAX_XFORMS + 1) rows × 16384 entries × u32 ≈ 8.5 MB worst case. Sized
  // for arbitrary prev_xform indices; the host only ever populates the
  // rows the current genome uses (see packXformDistrib + dispatch below).
  const xformDistribBuffer = device.createBuffer({
    label: 'pyr3.chaos.xform_distrib',
    size: XFORM_DISTRIB_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const module = device.createShaderModule({ label: 'pyr3.chaos', code: shaderCode });
  const pipeline = device.createComputePipeline({
    label: 'pyr3.chaos.pipeline',
    layout: 'auto',
    compute: { module, entryPoint: 'chaos_main' },
  });

  // Rebuilt whenever the ISAAC buffer grows (#11) — it references isaacBuffer.
  function buildBindGroup(): GPUBindGroup {
    return device.createBindGroup({
      label: 'pyr3.chaos.bindgroup',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniforms } },
        { binding: 1, resource: { buffer: xforms } },
        { binding: 2, resource: { buffer: histogram } },
        { binding: 3, resource: { buffer: paletteBuffer } },
        // Phase 5c: binding 4 (xaos_buffer) retired — xaos now baked into
        // xform_distrib host-side.
        { binding: 5, resource: { buffer: isaacBuffer } },
        { binding: 6, resource: { buffer: traceBuffer } },
        { binding: 7, resource: { buffer: xformDistribBuffer } },
        { binding: 8, resource: { buffer: idxSum } }, // #269 Phase 2
      ],
    });
  }
  let bindGroup = buildBindGroup();

  return {
    config,
    histogram,
    traceBuffer,

    setPalette(p: Palette): void {
      device.queue.writeBuffer(paletteBuffer, 0, packPalette(p));
    },

    setCaptureIndex(on: boolean): void {
      captureIndex = on;
    },

    async readIndexAndCount(): Promise<{ idxSum: Uint32Array; count: Uint32Array; width: number; height: number }> {
      const w = config.width;
      const h = config.height;
      const idxStaging = device.createBuffer({
        label: 'pyr3.chaos.idx_sum.read',
        size: idxSumBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const histStaging = device.createBuffer({
        label: 'pyr3.chaos.hist.read',
        size: histogramBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = device.createCommandEncoder({ label: 'pyr3.chaos.idxread' });
      enc.copyBufferToBuffer(idxSum, 0, idxStaging, 0, idxSumBytes);
      enc.copyBufferToBuffer(histogram, 0, histStaging, 0, histogramBytes);
      device.queue.submit([enc.finish()]);
      await idxStaging.mapAsync(GPUMapMode.READ);
      await histStaging.mapAsync(GPUMapMode.READ);
      const idxArr = new Uint32Array(idxStaging.getMappedRange().slice(0));
      const histArr = new Uint32Array(histStaging.getMappedRange().slice(0));
      idxStaging.unmap();
      histStaging.unmap();
      idxStaging.destroy();
      histStaging.destroy();
      // Extract the count channel (channel 3 of HIST_CHANNELS) per pixel.
      const count = new Uint32Array(w * h);
      for (let i = 0; i < w * h; i++) count[i] = histArr[i * HIST_CHANNELS + 3]!;
      return { idxSum: idxArr, count, width: w, height: h };
    },

    async readHistogramRgba(): Promise<{ rgba: Uint32Array; superW: number; superH: number }> {
      const histStaging = device.createBuffer({
        label: 'pyr3.chaos.histRgba.read',
        size: histogramBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const enc = device.createCommandEncoder({ label: 'pyr3.chaos.histRgbaRead' });
      enc.copyBufferToBuffer(histogram, 0, histStaging, 0, histogramBytes);
      device.queue.submit([enc.finish()]);
      await histStaging.mapAsync(GPUMapMode.READ);
      const rgba = new Uint32Array(histStaging.getMappedRange().slice(0));
      histStaging.unmap();
      histStaging.destroy();
      return { rgba, superW: config.width, superH: config.height };
    },

    reset(): void {
      const zero = new Uint8Array(histogramBytes);
      device.queue.writeBuffer(histogram, 0, zero);
      device.queue.writeBuffer(
        traceBuffer,
        0,
        new Uint8Array(TRACE_ENTRIES * TRACE_FLOATS_PER_ENTRY * 4),
      );
      // #269 Phase 2 — zero idx_sum in lockstep with the histogram so a
      // capturing render accumulates from a clean buffer.
      device.queue.writeBuffer(idxSum, 0, new Uint8Array(idxSumBytes));
    },

    destroy(): void {
      histogram.destroy();
      uniforms.destroy();
      xforms.destroy();
      paletteBuffer.destroy();
      isaacBuffer.destroy();
      traceBuffer.destroy();
      xformDistribBuffer.destroy();
      idxSum.destroy(); // #269 Phase 2
    },

    dispatch(genome: Genome, seed: number, opts?: DispatchOpts): void {
      // Phase 5c: pre-pack expansion of symmetry into rotation/reflection xforms.
      // Returns same reference when no symmetry; otherwise a non-mutating clone.
      const g = expandGenomeForGPU(genome);
      device.queue.writeBuffer(xforms, 0, packXforms(g));
      // #83: pack ONLY the populated rows (numStd + 1 fallback) and write
      // them at their final offsets. The unread gap rows in the GPU buffer
      // are untouched between dispatches — saves ~95% of the writeBuffer
      // traffic on typical genomes. (xaos is baked in host-side as of #78,
      // so no separate xaosBuffer write here.)
      const distrib = packXformDistrib(g); // Phase 5c
      device.queue.writeBuffer(xformDistribBuffer, 0, distrib.prefix.buffer as ArrayBuffer);
      device.queue.writeBuffer(
        xformDistribBuffer,
        XFORM_DISTRIB_FALLBACK_OFFSET,
        distrib.fallback.buffer as ArrayBuffer,
      );

      // Phase 9-cal-B: dispatch walker count + iters-per-walker can be
      // overridden per-frame to scale with Genome.quality. Defaults match
      // the pass-creation config (16 spp on 1024² = 16M total samples).
      const walkers = opts?.walkers ?? config.walkers;
      const itersPerWalker = opts?.itersPerWalker ?? config.itersPerWalker;

      // #11 (PYR3-057): grow the ISAAC buffer if this dispatch needs more
      // streams than it currently holds, so the writeBuffer below never
      // overruns it. Round capacity up to a workgroup multiple to match the
      // dispatch's rounded thread count. Rebuild the bind group to point at the
      // new buffer.
      if (walkers > isaacCapacity) {
        isaacBuffer.destroy();
        isaacCapacity = Math.ceil(walkers / WORKGROUP_SIZE) * WORKGROUP_SIZE;
        isaacBuffer = device.createBuffer({
          label: 'pyr3.chaos.isaac',
          size: isaacCapacity * ISAAC_STATE_BYTES,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        bindGroup = buildBindGroup();
      }

      // Re-seed ISAAC streams from `seed`. Each walker gets its own independent
      // stream; flam3 does this per-thread (rect.c:858-865) by filling randrsl
      // with values from a global RNG and then calling irandinit. We mirror by
      // bootstrapping each walker's randrsl from a small PCG32 stream seeded
      // from `seed XOR walker_id_hash`, then running irandinit to scramble mm.
      const isaacBytes = packIsaacStates(walkers, seed);
      device.queue.writeBuffer(isaacBuffer, 0, isaacBytes);

      const u = new ArrayBuffer(UNIFORMS_BYTES);
      const u32 = new Uint32Array(u);
      const f32 = new Float32Array(u);
      const i32 = new Int32Array(u);
      u32[0] = config.width;
      u32[1] = config.height;
      u32[2] = itersPerWalker;
      u32[3] = config.fuse;
      // Phase 9-supersample-real: when chaos runs at super-resolution, the
      // splat scale must be multiplied by oversample so the IFS structure
      // fills the full super-canvas (matches flam3 rect.c — its `ppux/ppuy`
      // are the super-pixel pitch). Output → super-pixel ratio.
      // PYR3-008: oversample comes from the pipeline config (the authority),
      // NOT g.oversample — the genome value is vestigial and could drift out of
      // sync with the actual super-canvas the pass was built for.
      const oversample = Math.max(1, Math.floor(config.oversample));
      f32[4] = g.scale * oversample;
      f32[5] = g.cx;
      f32[6] = g.cy;
      // #254: num_xforms (old slot 7) + xform_total_weight (old slot 8) dropped —
      // the Phase 5c xform_distrib table subsumed both and the kernel read
      // neither, so every dispatch wrote two dead slots. Downstream slots shifted
      // down by 2; the WGSL Uniforms struct mirrors this new numbering.
      u32[7] = seed >>> 0;
      i32[8] = finalXformSlot(g); // -1 when no final OR final is inactive (#438)
      f32[9] = ((g.rotate ?? 0) * Math.PI) / 180.0; // rotation_rad — Phase 9-rotate
      // Phase 9-bg-palmode: 0 = step (flam3 default), 1 = linear. Default
      // applied at this consumer boundary so the genome stays a faithful
      // echo of source XML.
      u32[10] = (g.paletteMode ?? 'step') === 'linear' ? 1 : 0;
      // PYR3-029 Phase 5b trace gate. Default 0 = no trace emission.
      u32[11] = opts?.traceMode ? 1 : 0;
      // #11 (PYR3-057): exact walker count (NOT the rounded-up thread count) so
      // chaos_main bails the padding threads of the final workgroup.
      u32[12] = walkers;
      // #65 Tier 1: walker jitter amplitude — runtime parameter.
      // `??` lets call sites omit it and pick up the shipped default.
      f32[13] = opts?.walkerJitter ?? DEFAULT_WALKER_JITTER;
      // #269 Phase 2 — capture gate (slot 14). Off for every non-gradient
      // consumer → idx_sum untouched → histogram output byte-identical.
      u32[14] = captureIndex ? 1 : 0;
      // #459/#460/#465 — color mode (slot 15). 0 = palette (default) → splat block
      // skips every override → histogram output byte-identical. 1 = flow, 2 = trap,
      // 3 = phase.
      u32[15] =
        opts?.colorMode === 'flow' ? 1 :
        opts?.colorMode === 'trap-distance' ? 2 :
        opts?.colorMode === 'phase' ? 3 : 0;
      f32[16] = opts?.flowStrength ?? 1.0;
      f32[17] = opts?.flowScale ?? DEFAULT_FLOW_SCALE;
      // #460 — trap-distance params (slots 18-27). Defaults match
      // DEFAULT_TRAP_CONFIG so an undefined trap under color_mode 2 still renders
      // sanely; color_mode 0/1 ignores these (shader skips the trap branch). The
      // line normal is precomputed here (-sinθ, cosθ) so the kernel does no trig.
      const trap = opts?.trap;
      const trapAngleRad = ((trap?.angle ?? 0) * Math.PI) / 180;
      u32[18] = trap?.kind === 'circle' ? 1 : trap?.kind === 'line' ? 2 : 0; // trap_kind
      u32[19] = trap?.mode === 'rings' ? 1 : 0;                              // trap_mode
      f32[20] = trap?.cx ?? 0;                                               // trap_cx
      f32[21] = trap?.cy ?? 0;                                               // trap_cy
      f32[22] = trap?.radius ?? 0.5;                                         // trap_radius
      f32[23] = -Math.sin(trapAngleRad);                                     // trap_nx = -sinθ
      f32[24] = Math.cos(trapAngleRad);                                      // trap_ny =  cosθ
      f32[25] = trap?.falloff ?? 2.0;                                        // trap_falloff
      f32[26] = trap?.freq ?? 4.0;                                           // trap_freq
      f32[27] = trap?.strength ?? 1.0;                                       // trap_strength
      // #465 — Phase/Polar params (slots 28-29). color_mode 0/1/2 ignores these
      // (shader skips the phase branch). phaseFreq default 1.0; 0 = pure phase field.
      f32[28] = opts?.phaseStrength ?? 1.0;                                  // phase_strength
      f32[29] = opts?.phaseFreq ?? 1.0;                                      // phase_freq
      // #456 — interpolated xform fields (slot 30). Read off the GENOME (not
      // DispatchOpts): this is a genome field like genome.rotate, so it rides the
      // genome through every consumer. 0 / undefined = off → shader skips the blend
      // branch → byte-identical. Clamp to [0,1] (the uniform has no schema check).
      f32[30] = Math.min(1, Math.max(0, genome.xformBlend ?? 0));            // xform_blend
      device.queue.writeBuffer(uniforms, 0, u);

      const encoder = device.createCommandEncoder({ label: 'pyr3.chaos.encoder' });
      const pass = encoder.beginComputePass({ label: 'pyr3.chaos.pass' });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      const workgroups = Math.ceil(walkers / WORKGROUP_SIZE);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}
