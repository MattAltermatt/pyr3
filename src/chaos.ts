// Chaos compute pass — dispatch a wave of walkers, each scattering hits
// into a 4-channel u32 atomic histogram (R, G, B, count). Each hit
// samples the palette at the iterated color coord and atomically accumulates.

import shaderCode from './shaders/chaos.wgsl?raw';
import {
  type Genome,
  MAX_XFORMS,
  packXforms,
  packXformDistrib,
  totalWeight,
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
  /** Phase 9-size: release owned GPU buffers. Caller is responsible for not
   *  using the pass after destroy(). */
  destroy(): void;
}

const WORKGROUP_SIZE = 64;
const UNIFORMS_BYTES = 64;

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

    reset(): void {
      const zero = new Uint8Array(histogramBytes);
      device.queue.writeBuffer(histogram, 0, zero);
      device.queue.writeBuffer(
        traceBuffer,
        0,
        new Uint8Array(TRACE_ENTRIES * TRACE_FLOATS_PER_ENTRY * 4),
      );
    },

    destroy(): void {
      histogram.destroy();
      uniforms.destroy();
      xforms.destroy();
      paletteBuffer.destroy();
      isaacBuffer.destroy();
      traceBuffer.destroy();
      xformDistribBuffer.destroy();
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
      u32[7] = g.xforms.length;
      f32[8] = totalWeight(g);
      u32[9] = seed >>> 0;
      i32[10] = g.finalxform ? g.xforms.length : -1;
      f32[11] = ((g.rotate ?? 0) * Math.PI) / 180.0; // rotation_rad — Phase 9-rotate
      // Phase 9-bg-palmode: 0 = step (flam3 default), 1 = linear. Default
      // applied at this consumer boundary so the genome stays a faithful
      // echo of source XML. Slots 13-15 stay zero.
      u32[12] = (g.paletteMode ?? 'step') === 'linear' ? 1 : 0;
      // PYR3-029 Phase 5b trace gate. Default 0 = no trace emission.
      u32[13] = opts?.traceMode ? 1 : 0;
      // #11 (PYR3-057): exact walker count (NOT the rounded-up thread count) so
      // chaos_main bails the padding threads of the final workgroup.
      u32[14] = walkers;
      // #65 Tier 1: walker jitter amplitude — runtime parameter.
      // `??` lets call sites omit it and pick up the shipped default.
      f32[15] = opts?.walkerJitter ?? DEFAULT_WALKER_JITTER;
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
