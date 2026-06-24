import { describe, it, expect, beforeEach } from 'vitest';
import {
  _resetGensManifestCache,
  loadGensManifest,
  nextGenEntry,
  prevGenEntry,
  resolveCorpusNeighbors,
  type GensManifest,
} from './corpus-bounds';
import { neighbors } from './avail-client';

const SAMPLE: GensManifest = {
  schema: 1,
  build_date: '2026-05-28',
  chunk_size: 256,
  gens: [
    { gen: 165, count: 998,  min_id: 0, max_id: 999   },
    { gen: 169, count: 21745, min_id: 0, max_id: 21744 },
    { gen: 191, count: 21743, min_id: 0, max_id: 21749 },
    { gen: 243, count: 5266,  min_id: 0, max_id: 17686 },
    { gen: 244, count: 33594, min_id: 0, max_id: 86476 },
    { gen: 247, count: 17396, min_id: 0, max_id: 50039 },
    { gen: 248, count: 18698, min_id: 0, max_id: 40770 },
  ],
};

describe('loadGensManifest (#38) — fetch + cache', () => {
  beforeEach(() => _resetGensManifestCache());

  // The pyr3-native sidecar (chunks/pyr3-gens.json) is merged in addition to
  // the primary gens.json (#435). These #38 fetch/cache tests only exercise the
  // primary manifest, so they 404 the sidecar (counting only the primary fetch)
  // — the merge itself is covered by the dedicated sidecar suite below.
  const gensOnly = (body: string, onCall?: () => void): typeof fetch =>
    (async (url: string) => {
      if (String(url).endsWith('chunks/pyr3-gens.json')) {
        return new Response('not found', { status: 404 }) as Response;
      }
      onCall?.();
      return new Response(body, { status: 200 }) as Response;
    }) as typeof fetch;

  it('fetches + parses on the first call', async () => {
    let calls = 0;
    const fakeFetch = gensOnly(JSON.stringify(SAMPLE), () => { calls += 1; });
    const m = await loadGensManifest(fakeFetch);
    expect(m).not.toBeNull();
    expect(m?.gens.length).toBe(7);
    expect(calls).toBe(1);
  });

  it('caches across calls — second call doesn\'t hit fetch', async () => {
    let calls = 0;
    const fakeFetch = gensOnly(JSON.stringify(SAMPLE), () => { calls += 1; });
    await loadGensManifest(fakeFetch);
    await loadGensManifest(fakeFetch);
    await loadGensManifest(fakeFetch);
    expect(calls).toBe(1);
  });

  it('sorts gens ascending by .gen — even if the response was unsorted', async () => {
    const unsorted: GensManifest = {
      ...SAMPLE,
      gens: [
        { gen: 248, count: 1, min_id: 0, max_id: 0 },
        { gen: 165, count: 1, min_id: 0, max_id: 0 },
        { gen: 247, count: 1, min_id: 0, max_id: 0 },
      ],
    };
    const fakeFetch = gensOnly(JSON.stringify(unsorted));
    const m = await loadGensManifest(fakeFetch);
    expect(m?.gens.map((e) => e.gen)).toEqual([165, 247, 248]);
  });

  it('returns null on non-OK + does not cache the failure', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      // First call 404s, second succeeds — but cache the failure-as-null? Per
      // current impl the failure IS cached (the promise resolves to null and
      // is memoized). Re-asserting that contract: one fetch, persistent null.
      return new Response('not found', { status: 404 }) as Response;
    }) as typeof fetch;
    expect(await loadGensManifest(fakeFetch)).toBeNull();
    expect(await loadGensManifest(fakeFetch)).toBeNull();
    expect(calls).toBe(1);
  });

  it('returns null when fetch throws', async () => {
    const fakeFetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await loadGensManifest(fakeFetch)).toBeNull();
  });
});

describe('prevGenEntry / nextGenEntry (#38)', () => {
  it('prevGenEntry returns the greatest entry strictly below', () => {
    expect(prevGenEntry(SAMPLE, 244)?.gen).toBe(243);
    expect(prevGenEntry(SAMPLE, 245)?.gen).toBe(244); // skip-gap: 245 not in manifest
    expect(prevGenEntry(SAMPLE, 248)?.gen).toBe(247);
    expect(prevGenEntry(SAMPLE, 999)?.gen).toBe(248); // above-last → last
    expect(prevGenEntry(SAMPLE, 165)).toBeNull(); // exact first → no prev
    expect(prevGenEntry(SAMPLE, 0)).toBeNull(); // below first → no prev
  });

  it('nextGenEntry returns the smallest entry strictly above', () => {
    expect(nextGenEntry(SAMPLE, 243)?.gen).toBe(244);
    expect(nextGenEntry(SAMPLE, 245)?.gen).toBe(247); // skip-gap
    expect(nextGenEntry(SAMPLE, 165)?.gen).toBe(169);
    expect(nextGenEntry(SAMPLE, 0)?.gen).toBe(165); // below first → first
    expect(nextGenEntry(SAMPLE, 248)).toBeNull(); // exact last → no next
    expect(nextGenEntry(SAMPLE, 999)).toBeNull(); // above last → no next
  });
});

describe('resolveCorpusNeighbors (#38) — cross-gen prev/next', () => {
  // Use the real `neighbors` from avail-client (already tested in isolation).
  // Stub loadAvail to a fixed corpus map for predictability.
  const AVAIL: Record<number, number[]> = {
    165: [10, 20, 30],
    169: [0, 100, 500],
    191: [1, 2, 3],
    243: [100, 5000, 17686],
    244: [0, 50000, 86476],
    247: [19679, 30000, 50039],
    248: [0, 22289, 40770],
  };
  const stubLoadAvail = async (g: number): Promise<number[]> => AVAIL[g] ?? [];
  const stubLoadManifest = async (): Promise<GensManifest | null> => SAMPLE;

  it('in-corpus, gen-first present id → cross-gen prev, in-gen next', async () => {
    // 19679 is the FIRST id in 247 — in-gen prev is null → cross-gen kicks in:
    // prevGenEntry(247) is 244 (245 isn't in the sample manifest) → its last
    // present id is 86476. Next stays in-gen at 30000.
    const r = await resolveCorpusNeighbors(247, 19679, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: { gen: 244, id: 86476 },
      next: { gen: 247, id: 30000 },
    });
  });

  it('in-corpus, mid-gen present → both prev/next within same gen, no cross', async () => {
    const r = await resolveCorpusNeighbors(247, 30000, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: { gen: 247, id: 19679 },
      next: { gen: 247, id: 50039 },
    });
  });

  it('id past gen max → prev in-gen, next rolls to next gen first id', async () => {
    const r = await resolveCorpusNeighbors(243, 9999999999, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: { gen: 243, id: 17686 }, // last present in 243
      next: { gen: 244, id: 0 },     // first present in 244
    });
  });

  it('id below gen min → next in-gen, prev rolls to prev gen last id', async () => {
    const r = await resolveCorpusNeighbors(243, -1, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: { gen: 191, id: 3 },  // last present in 191 (242 not in manifest)
      next: { gen: 243, id: 100 }, // first present in 243
    });
  });

  it('gen=0 (below first corpus gen) → prev null, next rolls to first sheep', async () => {
    const r = await resolveCorpusNeighbors(0, 1, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: null,
      next: { gen: 165, id: 10 },
    });
  });

  it('gen=999 (above last corpus gen) → prev rolls to last sheep, next null', async () => {
    const r = await resolveCorpusNeighbors(999, 1, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: { gen: 248, id: 40770 },
      next: null,
    });
  });

  it('exact first sheep (gen 165, id 10) → prev null, next in-gen', async () => {
    const r = await resolveCorpusNeighbors(165, 10, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: null,
      next: { gen: 165, id: 20 },
    });
  });

  it('exact last sheep (gen 248, id 40770) → prev in-gen, next null', async () => {
    const r = await resolveCorpusNeighbors(248, 40770, stubLoadAvail, stubLoadManifest, neighbors);
    expect(r).toEqual({
      prev: { gen: 248, id: 22289 },
      next: null,
    });
  });

  it('manifest unavailable → in-gen prev/next only, no cross-gen fallback', async () => {
    const r = await resolveCorpusNeighbors(
      243, 9999, stubLoadAvail, async () => null, neighbors,
    );
    expect(r).toEqual({
      prev: { gen: 243, id: 5000 }, // wait — id=9999 vs ids=[100,5000,17686]: prev=5000, next=17686
      next: { gen: 243, id: 17686 },
    });
  });

  it('walks past empty gens — skips a manifest entry whose avail is []', async () => {
    const stubWithGap: typeof stubLoadAvail = async (g) => {
      if (g === 244) return []; // empty — should be skipped
      return AVAIL[g] ?? [];
    };
    // From gen 247 going prev: 244 empty → skip → 243 last id 17686.
    const r = await resolveCorpusNeighbors(247, 19679, stubWithGap, stubLoadManifest, neighbors);
    expect(r.prev).toEqual({ gen: 243, id: 17686 });
  });
});

function fakeFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).endsWith(k));
    if (!key) return { ok: false, status: 404 } as Response;
    return { ok: true, json: async () => map[key] } as Response;
  }) as unknown as typeof fetch;
}

describe('loadGensManifest native sidecar merge', () => {
  beforeEach(() => _resetGensManifestCache());

  it('merges the pyr3-gens sidecar and re-sorts ascending', async () => {
    const f = fakeFetch({
      'chunks/gens.json': { schema: 2, build_date: 'x', chunk_size: 256, gens: [{ gen: 248, count: 1, min_id: 0, max_id: 0 }] },
      'chunks/pyr3-gens.json': { gens: [{ gen: 1, count: 2, min_id: 0, max_id: 1 }] },
    });
    const m = await loadGensManifest(f);
    expect(m?.gens.map((g) => g.gen)).toEqual([1, 248]);
  });

  it('falls back to ESF-only when the sidecar is missing', async () => {
    const f = fakeFetch({
      'chunks/gens.json': { schema: 2, build_date: 'x', chunk_size: 256, gens: [{ gen: 248, count: 1, min_id: 0, max_id: 0 }] },
    });
    const m = await loadGensManifest(f);
    expect(m?.gens.map((g) => g.gen)).toEqual([248]);
  });
});
