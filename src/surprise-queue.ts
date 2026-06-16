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
  let drainedResolvers: Array<() => void> = [];

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    while (pending.length) {
      const genome = pending.shift()!;
      let res: ThumbResult;
      try {
        res = await opts.renderThumb(genome);
      } catch {
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
    clear() { pending.length = 0; },
    enqueueAndDrain(genomes) {
      pending.push(...genomes);
      const done = new Promise<void>((resolve) => drainedResolvers.push(resolve));
      void drain();
      return done;
    },
  };
}
