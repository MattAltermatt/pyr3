// src/surprise-queue.ts
//
// Serial render+classify queue for the Surprise Wall. One render in flight at a
// time (single shared WebGPU device — no parallelism). The actual GPU render is
// injected as `renderThumb` so this whole module is unit-testable with a stub.

import { type Genome } from './genome';
import { type CullVerdict } from './surprise-cull';

export interface ThumbResult { rgba: Uint8ClampedArray; w: number; h: number; verdict: CullVerdict }
export interface ReadyTile { genome: Genome; rgba: Uint8ClampedArray; w: number; h: number }

export interface SurpriseQueueOpts {
  renderThumb: (genome: Genome) => Promise<ThumbResult>;
  onReady: (tile: ReadyTile) => void;
  onCulled: (genome: Genome, verdict: CullVerdict) => void;
  /** Fired just before a genome's render starts — lets the UI mark which tile is
   *  currently rendering. (#surprise-v2) */
  onRenderStart?: (genome: Genome) => void;
  /** Optional pause (ms) AFTER each render to give the GPU/system relief so a long
   *  wall fill doesn't peg the machine. Default 0 (back-to-back). (#surprise-v2) */
  reliefMs?: number;
}

export interface SurpriseQueue {
  /** Enqueue genomes and resolve when the whole batch has drained. */
  enqueueAndDrain(genomes: Genome[]): Promise<void>;
  /** Append more genomes to the running queue (e.g. cull replacements). */
  enqueue(genomes: Genome[]): void;
  /** Drop everything not yet started. */
  clear(): void;
}

export function createSurpriseQueue(opts: SurpriseQueueOpts): SurpriseQueue {
  const pending: Genome[] = [];
  let draining = false;
  // Monotonic batch epoch — bumped by clear(). A render that began under an
  // older epoch belongs to a discarded batch, so its result is dropped after
  // the await rather than reported. Without this, a render in flight when the
  // caller swaps batches (🎲 Surprise more) resolves and consumes the NEW
  // batch's slot-mapping entry, painting stale pixels/label into the wrong
  // slot — the thumbnail, ⭐-kept genome, and ↗-opened genome then disagree. (#295)
  let epoch = 0;
  let drainedResolvers: Array<() => void> = [];

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    while (pending.length) {
      const genome = pending.shift()!;
      const startEpoch = epoch;
      opts.onRenderStart?.(genome);
      let res: ThumbResult | null = null;
      try {
        res = await opts.renderThumb(genome);
      } catch {
        res = null;
      }
      // GPU/system relief between renders so a long wall fill stays responsive
      // and doesn't peg the machine. (#surprise-v2)
      if (opts.reliefMs && opts.reliefMs > 0) {
        await new Promise<void>((r) => setTimeout(r, opts.reliefMs));
      }
      // Batch was cleared mid-render — discard so its slot mapping survives
      // intact for the new batch. (#295)
      if (epoch !== startEpoch) continue;
      if (!res) {
        opts.onCulled(genome, { ok: false, reason: 'black', stats: { meanLuma: 0, occupiedFraction: 0, edgeEnergy: 0, contrast: 0 } });
        continue;
      }
      if (res.verdict.ok) opts.onReady({ genome, rgba: res.rgba, w: res.w, h: res.h });
      else opts.onCulled(genome, res.verdict);
    }
    draining = false;
    const r = drainedResolvers; drainedResolvers = [];
    r.forEach((fn) => fn());
  }

  return {
    enqueue(genomes) { pending.push(...genomes); void drain(); },
    clear() { pending.length = 0; epoch++; },
    enqueueAndDrain(genomes) {
      pending.push(...genomes);
      const done = new Promise<void>((resolve) => drainedResolvers.push(resolve));
      void drain();
      return done;
    },
  };
}
