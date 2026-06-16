import { describe, expect, it, vi } from 'vitest';
import { createSurpriseQueue, type ThumbResult } from './surprise-queue';
import { type Genome } from './genome';

const g = (tag: number) => ({ name: `g${tag}`, xforms: [], scale: 1, cx: 0, cy: 0,
  palette: { name: 'p', stops: [] } } as unknown as Genome);

function stubRender(): (genome: Genome) => Promise<ThumbResult> {
  return async (genome) => {
    const black = genome.name.endsWith('X');
    return { rgba: new Uint8ClampedArray(4), w: 1, h: 1,
      verdict: black ? { ok: false, reason: 'black', stats: { meanLuma: 0, occupiedFraction: 0, edgeEnergy: 0, contrast: 0 } }
                     : { ok: true, stats: { meanLuma: 50, occupiedFraction: 0.3, edgeEnergy: 0.1, contrast: 0.2 } } };
  };
}

describe('createSurpriseQueue', () => {
  it('emits onReady once per surviving genome, in order', async () => {
    const ready: string[] = [];
    const q = createSurpriseQueue({ renderThumb: stubRender(), onReady: (t) => ready.push(t.genome.name), onCulled: () => {} });
    await q.enqueueAndDrain([g(1), g(2), g(3)]);
    expect(ready).toEqual(['g1', 'g2', 'g3']);
  });
  it('routes degenerate genomes to onCulled, not onReady', async () => {
    const ready: string[] = []; const culled: string[] = [];
    const q = createSurpriseQueue({ renderThumb: stubRender(),
      onReady: (t) => ready.push(t.genome.name), onCulled: (genome) => culled.push((genome as Genome).name) });
    const bad = { ...g(9), name: 'g9X' } as Genome;
    await q.enqueueAndDrain([g(1), bad, g(2)]);
    expect(ready).toEqual(['g1', 'g2']);
    expect(culled).toEqual(['g9X']);
  });
  it('renders strictly one at a time (no overlap)', async () => {
    let inFlight = 0, maxConcurrent = 0;
    const slow = async (genome: Genome): Promise<ThumbResult> => {
      inFlight++; maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 1)); inFlight--;
      return { rgba: new Uint8ClampedArray(4), w: 1, h: 1, verdict: { ok: true, stats: { meanLuma: 50, occupiedFraction: 0.3, edgeEnergy: 0.1, contrast: 0.2 } } };
    };
    const q = createSurpriseQueue({ renderThumb: slow, onReady: () => {}, onCulled: () => {} });
    await q.enqueueAndDrain([g(1), g(2), g(3), g(4)]);
    expect(maxConcurrent).toBe(1);
  });
});
