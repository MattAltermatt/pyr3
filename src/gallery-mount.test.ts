// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampGalleryPage,
  coalesce,
  mountGallery,
  pageOfSheep,
  pageForSheep,
  randomSheep,
  type SheepRef,
} from './gallery-mount';
import type { GensManifest } from './corpus-bounds';
import type { Genome } from './genome';
import type { QualityTier } from './presets';
import type { OrchestratorOpts, RunHandle } from './render-orchestrator';
import type { Renderer } from './renderer';

// Synthetic 2-gen corpus:
//   gen 100: [10, 20, 30, 40, 50]   (5 sheep)
//   gen 101: [11, 22, 33]           (3 sheep)
// → canonical order (8 total):
//   0:(100,10) 1:(100,20) 2:(100,30) 3:(100,40) 4:(100,50)
//   5:(101,11) 6:(101,22) 7:(101,33)
const MANIFEST: GensManifest = {
  schema: 1,
  build_date: '2026-05-31',
  chunk_size: 256,
  gens: [
    { gen: 100, count: 5, min_id: 10, max_id: 50 },
    { gen: 101, count: 3, min_id: 11, max_id: 33 },
  ],
};
const AVAIL: Record<number, number[]> = {
  100: [10, 20, 30, 40, 50],
  101: [11, 22, 33],
};
const loadAvail = async (g: number): Promise<number[]> => AVAIL[g] ?? [];
const loadManifest = async (): Promise<GensManifest | null> => MANIFEST;

describe('pageOfSheep — page math + cross-gen walk', () => {
  it('page 1 returns the first perPage sheep', async () => {
    expect(await pageOfSheep(1, 3, loadAvail, loadManifest)).toEqual([
      { gen: 100, id: 10 },
      { gen: 100, id: 20 },
      { gen: 100, id: 30 },
    ]);
  });

  it('page 2 crosses a gen boundary mid-page', async () => {
    expect(await pageOfSheep(2, 3, loadAvail, loadManifest)).toEqual([
      { gen: 100, id: 40 },
      { gen: 100, id: 50 },
      { gen: 101, id: 11 },
    ]);
  });

  it('trailing page returns fewer than perPage when corpus runs out', async () => {
    expect(await pageOfSheep(3, 3, loadAvail, loadManifest)).toEqual([
      { gen: 101, id: 22 },
      { gen: 101, id: 33 },
    ]);
  });

  it('page past the corpus tail returns []', async () => {
    expect(await pageOfSheep(4, 3, loadAvail, loadManifest)).toEqual([]);
  });

  it('page < 1 returns []', async () => {
    expect(await pageOfSheep(0, 3, loadAvail, loadManifest)).toEqual([]);
  });

  it('returns [] when the manifest is unavailable', async () => {
    expect(await pageOfSheep(1, 3, loadAvail, async () => null)).toEqual([]);
  });

  it('skips empty gens transparently', async () => {
    const manifestWithGap: GensManifest = {
      ...MANIFEST,
      gens: [
        { gen: 99, count: 0, min_id: 0, max_id: 0 },
        ...MANIFEST.gens,
      ],
    };
    const avail: Record<number, number[]> = { ...AVAIL, 99: [] };
    expect(
      await pageOfSheep(1, 3, async (g) => avail[g] ?? [], async () => manifestWithGap),
    ).toEqual([
      { gen: 100, id: 10 },
      { gen: 100, id: 20 },
      { gen: 100, id: 30 },
    ]);
  });

  it('default perPage is GALLERY_PAGE_SIZE (9) — bigger corpus collects 9', async () => {
    // 9 gens × 1 id each = 9 sheep on page 1 at the default perPage.
    const bigManifest: GensManifest = {
      schema: 1,
      build_date: '2026-05-31',
      chunk_size: 256,
      gens: Array.from({ length: 9 }, (_, i) => ({
        gen: 200 + i,
        count: 1,
        min_id: i,
        max_id: i,
      })),
    };
    const bigAvail = async (g: number): Promise<number[]> => [g - 200];
    const refs = await pageOfSheep(1, undefined, bigAvail, async () => bigManifest);
    expect(refs).toHaveLength(9);
    expect(refs[0]).toEqual({ gen: 200, id: 0 });
    expect(refs[8]).toEqual({ gen: 208, id: 8 });
  });
});

describe('pageForSheep — contextual page lookup', () => {
  it.each([
    [100, 10, 1], // index 0
    [100, 30, 1], // index 2
    [100, 40, 2], // index 3 → page 2 at perPage=3
    [101, 11, 2], // index 5 → page 2
    [101, 22, 3], // index 6 → page 3
    [101, 33, 3], // index 7 → page 3
  ])('(%i, %i) lives on page %i (perPage=3)', async (gen, id, expected) => {
    expect(await pageForSheep(gen, id, 3, loadAvail, loadManifest)).toBe(expected);
  });

  it('agrees with pageOfSheep — every returned ref maps back to the same page', async () => {
    for (const page of [1, 2, 3]) {
      const refs = await pageOfSheep(page, 3, loadAvail, loadManifest);
      for (const ref of refs) {
        expect(await pageForSheep(ref.gen, ref.id, 3, loadAvail, loadManifest)).toBe(page);
      }
    }
  });

  it('unknown gen degrades to page 1', async () => {
    expect(await pageForSheep(999, 1, 3, loadAvail, loadManifest)).toBe(1);
  });

  it('known gen but unknown id degrades to page 1', async () => {
    expect(await pageForSheep(100, 99, 3, loadAvail, loadManifest)).toBe(1);
  });

  it('returns 1 when the manifest is unavailable', async () => {
    expect(await pageForSheep(100, 10, 3, loadAvail, async () => null)).toBe(1);
  });
});

// ── mountGallery — wave-fill orchestrator + DOM grid ────────────────────
//
// Tests cover: cell DOM construction, wave-fill ordering, trailing partial
// page handling, setPage cancellation, missing-cell fallback, destroy.
// Tests run under happy-dom (annotation at file top) so `document` is
// available. Renderer + startRender are stubbed — no real WebGPU is touched.

// 12-sheep single-gen corpus so page 1 fills exactly (9 refs) and page 2
// is a 3-ref trailing partial.
const ORCH_MANIFEST: GensManifest = {
  schema: 1,
  build_date: '2026-05-31',
  chunk_size: 256,
  gens: [{ gen: 100, count: 12, min_id: 1, max_id: 12 }],
};
const ORCH_AVAIL: Record<number, number[]> = {
  100: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
const orchLoadAvail = async (g: number): Promise<number[]> => ORCH_AVAIL[g] ?? [];
const orchLoadManifest = async (): Promise<GensManifest | null> => ORCH_MANIFEST;

const DRAFT_TIER: QualityTier = {
  name: 'Draft',
  longEdge: 512,
  spp: 8,
  oversample: 1,
  mode: 'cap',
};

function stubRenderer(): Renderer {
  return {
    width: 512,
    height: 512,
    oversample: 1,
    filterRadius: 1,
    resize: () => {},
  } as unknown as Renderer;
}

function stubGenome(): Genome {
  // applyPreset only reads .size / .quality / .oversample / .scale; all
  // optional. Empty object is enough — the orchestrator never inspects
  // the genome itself, only passes it to startRender (also stubbed).
  return {} as unknown as Genome;
}

// Settle the microtask queue so the orchestrator's await chain finishes.
// Each cell uses ~2-3 microtask ticks (fetchGenome → startRender → resolve);
// 60 flushes safely covers 9 cells.
async function flushMicrotasks(n = 60): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

interface OrchHandleEntry {
  seedBase: number;
  resolve: (v: 'completed' | 'cancelled') => void;
  resolved: boolean;
  cancelled: boolean;
}

function makeOrchHarness(opts: { autoResolve?: boolean } = {}) {
  const seeds: number[] = [];
  const handles: OrchHandleEntry[] = [];
  let autoResolveMode = opts.autoResolve ?? true;

  const startRender = (renderOpts: OrchestratorOpts): RunHandle => {
    seeds.push(renderOpts.seedBase);
    let resolveFn!: (v: 'completed' | 'cancelled') => void;
    const promise = new Promise<'completed' | 'cancelled'>((r) => {
      resolveFn = r;
    });
    const entry: OrchHandleEntry = {
      seedBase: renderOpts.seedBase,
      resolved: false,
      cancelled: false,
      resolve(v) {
        if (entry.resolved) return;
        entry.resolved = true;
        if (v === 'cancelled') entry.cancelled = true;
        resolveFn(v);
      },
    };
    handles.push(entry);
    if (autoResolveMode) {
      queueMicrotask(() => entry.resolve('completed'));
    }
    return {
      promise,
      cancel: () => entry.resolve('cancelled'),
    };
  };

  return {
    startRender,
    seeds,
    handles,
    setAutoResolve(v: boolean) {
      autoResolveMode = v;
    },
  };
}

describe('mountGallery — DOM grid', () => {
  it('mounts 9 cell anchors in the container', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    expect(container.querySelectorAll('.pyr3-gallery-cell')).toHaveLength(9);
    expect(container.querySelectorAll('.pyr3-gallery-cell canvas')).toHaveLength(9);
    handle.destroy();
  });

  it('attaches corpus hrefs + gen/id labels to cells after refs resolve', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    await flushMicrotasks();

    const cells = container.querySelectorAll<HTMLAnchorElement>('.pyr3-gallery-cell');
    // Page 1 of the 12-sheep corpus: sheep id 1-9.
    expect(cells[0]!.getAttribute('href')).toMatch(/v1\/gen\/100\/id\/1$/);
    expect(cells[0]!.querySelector('.pyr3-gallery-cell-label')!.textContent).toBe('100/00001');
    expect(cells[8]!.getAttribute('href')).toMatch(/v1\/gen\/100\/id\/9$/);
    expect(cells[8]!.querySelector('.pyr3-gallery-cell-label')!.textContent).toBe('100/00009');

    handle.destroy();
  });

  it('destroy() empties the container', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    expect(container.children.length).toBeGreaterThan(0);
    handle.destroy();
    expect(container.children.length).toBe(0);
  });
});

describe('mountGallery — wave-fill orchestration', () => {
  it('paints cells in corpus order top-left → bottom-right', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchCalls: SheepRef[] = [];
    const fetchGenome = async (gen: number, id: number): Promise<Genome | null> => {
      fetchCalls.push({ gen, id });
      return stubGenome();
    };

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    await flushMicrotasks();

    expect(fetchCalls).toEqual([
      { gen: 100, id: 1 },
      { gen: 100, id: 2 },
      { gen: 100, id: 3 },
      { gen: 100, id: 4 },
      { gen: 100, id: 5 },
      { gen: 100, id: 6 },
      { gen: 100, id: 7 },
      { gen: 100, id: 8 },
      { gen: 100, id: 9 },
    ]);
    expect(harness.seeds).toHaveLength(9);

    handle.destroy();
  });

  it('trailing partial page renders only the available refs', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchCalls: SheepRef[] = [];
    const fetchGenome = async (gen: number, id: number): Promise<Genome | null> => {
      fetchCalls.push({ gen, id });
      return stubGenome();
    };

    const handle = await mountGallery(2, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    await flushMicrotasks();

    // Page 2 of a 12-sheep corpus → sheep 10, 11, 12 (3 refs).
    expect(fetchCalls).toEqual([
      { gen: 100, id: 10 },
      { gen: 100, id: 11 },
      { gen: 100, id: 12 },
    ]);
    expect(harness.seeds).toHaveLength(3);

    // The remaining 6 cells should be in the .empty class state.
    const emptyCells = container.querySelectorAll('.pyr3-gallery-cell.empty');
    expect(emptyCells).toHaveLength(6);

    handle.destroy();
  });

  it('cell fetchGenome failure shows missing label, wave continues', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchGenome = async (_gen: number, id: number): Promise<Genome | null> => {
      if (id === 4) return null; // simulate a 404 on the 4th cell
      return stubGenome();
    };

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    await flushMicrotasks();

    // 8 successful renders (cells 1-3 and 5-9), 1 missing (cell 4).
    expect(harness.seeds).toHaveLength(8);

    const missingCell = container.querySelectorAll('.pyr3-gallery-cell.missing');
    expect(missingCell).toHaveLength(1);
    expect(missingCell[0]!.querySelector('.pyr3-gallery-cell-label')!.textContent)
      .toBe('100/00004 (missing)');

    handle.destroy();
  });

  it('cells expose loading… overlay until each render lands; clear on completion', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness({ autoResolve: false });
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    // Page-switch clear runs synchronously at the top of runWave — all 9
    // cells should be in .loading immediately, before the first render fires.
    await flushMicrotasks(2);
    let loadingCells = container.querySelectorAll('.pyr3-gallery-cell.loading');
    expect(loadingCells.length).toBe(9);
    expect(container.querySelector('.pyr3-gallery-cell-loading')!.textContent).toBe('loading…');

    // Resolve the first cell's render — only it should clear .loading.
    harness.handles[0]!.resolve('completed');
    await flushMicrotasks(5);
    loadingCells = container.querySelectorAll('.pyr3-gallery-cell.loading');
    expect(loadingCells.length).toBe(8);

    // Drain the rest.
    harness.setAutoResolve(true);
    for (const h of harness.handles.slice(1)) h.resolve('completed');
    await flushMicrotasks(30);
    loadingCells = container.querySelectorAll('.pyr3-gallery-cell.loading');
    expect(loadingCells.length).toBe(0);

    handle.destroy();
  });

  it('setPage clears all cells back to loading immediately, before the new pageOfSheep resolves', async () => {
    const container = document.createElement('div');
    // autoResolve=false so the page-1 wave settles to "loading + renders
    // in-flight, never completing" — every cell stays in .loading until
    // we explicitly resolve. Same for page 2 once setPage fires.
    const harness = makeOrchHarness({ autoResolve: false });
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    // Let page-1's wave reach a steady state — refs attached, first cell
    // rendering but never resolving. All 9 cells should be in .loading.
    await flushMicrotasks();
    expect(container.querySelectorAll('.pyr3-gallery-cell.loading').length).toBe(9);

    // Resolve the cells that have already started rendering so they leave
    // .loading. Page 1 should now have at least the first cell rendered
    // (out of loading) — confirms the clearLoading wire-up.
    harness.handles[0]!.resolve('completed');
    await flushMicrotasks(5);
    expect(container.querySelectorAll('.pyr3-gallery-cell.loading').length).toBe(8);

    // Trigger page 2 — the page-switch clear should immediately re-add
    // .loading to every cell (including the one that had finished
    // rendering), BEFORE the new wave's first render starts.
    const pending = handle.setPage(2);
    await flushMicrotasks(3);
    expect(container.querySelectorAll('.pyr3-gallery-cell.loading').length).toBe(9);

    // Drain page 2.
    harness.setAutoResolve(true);
    await pending;
    await flushMicrotasks(30);
    expect(container.querySelectorAll('.pyr3-gallery-cell.loading').length).toBe(0);

    handle.destroy();
  });

  it('missing-genome cells exit the loading state (no overlay on a dead cell)', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchGenome = async (_gen: number, id: number): Promise<Genome | null> => {
      if (id === 4) return null;
      return stubGenome();
    };

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    await flushMicrotasks();
    expect(container.querySelectorAll('.pyr3-gallery-cell.missing').length).toBe(1);
    expect(container.querySelectorAll('.pyr3-gallery-cell.missing.loading').length).toBe(0);

    handle.destroy();
  });

  it('setPage(N) cancels current wave and restarts on the new page', async () => {
    const container = document.createElement('div');
    // autoResolve=false so we can observe the cancellation deterministically.
    const harness = makeOrchHarness({ autoResolve: false });
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: orchLoadAvail,
      loadManifest: orchLoadManifest,
    });

    // Let the first cell's render begin.
    await flushMicrotasks(5);
    expect(harness.seeds.length).toBeGreaterThanOrEqual(1);
    const seedsBeforeFlip = harness.seeds.length;

    // Re-enable autoResolve so the page-2 wave can complete.
    harness.setAutoResolve(true);

    // Flip to page 2 — cancels the in-flight render, awaits prior wave, restarts.
    await handle.setPage(2);
    await flushMicrotasks();

    // The first wave's in-flight handle should have been cancelled.
    expect(harness.handles[seedsBeforeFlip - 1]!.cancelled).toBe(true);

    // Page-2 sheep are ids 10/11/12 → seedBase = (100*100003 + id).
    const expectedSeed10 = (100 * 100003 + 10) >>> 0;
    expect(harness.seeds).toContain(expectedSeed10);

    handle.destroy();
  });
});

describe('randomSheep — uniform corpus picker', () => {
  it('returns null when the manifest is unavailable', async () => {
    expect(await randomSheep(Math.random, loadAvail, async () => null)).toBeNull();
  });

  it('returns a SheepRef from the 8-sheep synthetic corpus', async () => {
    // randFn=0 → target index 0 → (100, 10)
    expect(await randomSheep(() => 0, loadAvail, loadManifest))
      .toEqual({ gen: 100, id: 10 });
  });

  it('locates the last sheep when randFn approaches 1 (target=total-1)', async () => {
    // 8 total sheep; randFn just under 1 → target = floor(0.999*8) = 7 → (101, 33)
    expect(await randomSheep(() => 0.999, loadAvail, loadManifest))
      .toEqual({ gen: 101, id: 33 });
  });

  it('crosses gen boundaries — target index 5 → first sheep of gen 101', async () => {
    // index 0-4 = gen 100 (5 sheep); index 5 = gen 101's first id (11)
    // randFn = 5.5/8 = 0.6875 → floor(0.6875*8) = 5
    expect(await randomSheep(() => 5.5 / 8, loadAvail, loadManifest))
      .toEqual({ gen: 101, id: 11 });
  });

  it('returns null on empty manifest (sum of counts = 0)', async () => {
    const emptyManifest = { ...MANIFEST, gens: [] };
    expect(await randomSheep(Math.random, loadAvail, async () => emptyManifest))
      .toBeNull();
  });

  it('every random draw lands on a (gen, id) that actually exists in avail', async () => {
    // Sample many draws; each should resolve to a real sheep, never a phantom.
    for (let i = 0; i < 50; i++) {
      const ref = await randomSheep(Math.random, loadAvail, loadManifest);
      expect(ref).not.toBeNull();
      const ids = AVAIL[ref!.gen] ?? [];
      expect(ids).toContain(ref!.id);
    }
  });
});

describe('clampGalleryPage — URL out-of-range clamp', () => {
  it('clamps below 1 to 1', () => {
    expect(clampGalleryPage(0, 10)).toBe(1);
    expect(clampGalleryPage(-5, 10)).toBe(1);
  });

  it('clamps above totalPages to totalPages', () => {
    expect(clampGalleryPage(27, 10)).toBe(10);
    expect(clampGalleryPage(11, 10)).toBe(10);
  });

  it('passes valid pages through unchanged', () => {
    expect(clampGalleryPage(1, 10)).toBe(1);
    expect(clampGalleryPage(5, 10)).toBe(5);
    expect(clampGalleryPage(10, 10)).toBe(10);
  });

  it('floors fractional inputs', () => {
    expect(clampGalleryPage(3.7, 10)).toBe(3);
  });

  it('totalPages 0 (manifest unavailable) → request passes through with floor of 1', () => {
    expect(clampGalleryPage(27, 0)).toBe(27);
    expect(clampGalleryPage(0, 0)).toBe(1);
  });
});

describe('coalesce — rapid-fire debounce', () => {
  // Helper: wait `ms` real wall time so the setTimeout inside coalesce fires.
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('fires once with the final args when calls arrive faster than delayMs', async () => {
    const calls: number[] = [];
    const debounced = coalesce((n: number) => calls.push(n), 30);
    debounced(1);
    debounced(2);
    debounced(3);
    expect(calls).toEqual([]); // none fired yet
    await sleep(50);
    expect(calls).toEqual([3]); // only the last one
  });

  it('fires separately when calls are spaced beyond delayMs', async () => {
    const calls: number[] = [];
    const debounced = coalesce((n: number) => calls.push(n), 20);
    debounced(1);
    await sleep(40);
    debounced(2);
    await sleep(40);
    expect(calls).toEqual([1, 2]);
  });

  it('each new call inside the window resets the timer (final call always wins)', async () => {
    const calls: number[] = [];
    const debounced = coalesce((n: number) => calls.push(n), 30);
    debounced(1);
    await sleep(20);
    debounced(2);
    await sleep(20);
    debounced(3); // window keeps resetting — still nothing fired
    expect(calls).toEqual([]);
    await sleep(50);
    expect(calls).toEqual([3]);
  });
});

// ── #49 Task A5: pageOfSheepFiltered + totalPagesFiltered ──────────────

import {
  pageOfSheepFiltered,
  totalPagesFiltered,
  _resetMasterListCache,
} from './gallery-mount';
import { DEFAULT_FILTER_SPEC, type FilterSpec } from './gallery-filter';
import type { FeatureIndex } from './feature-index-client';
import type { FeatureRecord } from './feature-index';

function makeStubIndex(records: FeatureRecord[]): FeatureIndex {
  return {
    schemaVersion: 1,
    corpusTag: 'test',
    recordCount: records.length,
    has: (g, i) => records.some((r) => r.gen === g && r.id === i),
    get: (g, i) => records.find((r) => r.gen === g && r.id === i) ?? null,
    filter: (p) => records.filter(p).map((r) => ({ gen: r.gen, id: r.id })),
    forEachRecord: (visitor) => {
      for (const r of records) {
        if (visitor(r) === false) return;
      }
    },
  };
}

function recF(
  gen: number,
  id: number,
  xforms: number,
  coverage = 0.5,
  entropy = 0.5,
  colorVar = 0.5,
  meanLum = 0.5,
  variations: number[] = [14],
): FeatureRecord {
  return { gen, id, xforms, coverage, entropy, colorVar, meanLum, variations };
}

describe('pageOfSheepFiltered', () => {
  beforeEach(() => {
    _resetMasterListCache();
  });

  const idx = makeStubIndex(
    Array.from({ length: 25 }, (_, i) => recF(165, i, 3, (25 - i) / 25)),
  );

  it('default filter (time/desc) returns 9 refs in REVERSE (gen,id) order', async () => {
    // Default sortDir is 'desc' — time-desc reverses the index's natural
    // (gen↑, id↑) walk so the discovery surface lands newest-first by
    // default (Twitter/Instagram-style "what's new in the corpus").
    const out = await pageOfSheepFiltered(1, 9, DEFAULT_FILTER_SPEC, { index: idx });
    expect(out.length).toBe(9);
    expect(out[0]).toEqual({ gen: 165, id: 24 });  // last index, first in desc walk
    expect(out[8]).toEqual({ gen: 165, id: 16 });
  });

  it('time/asc returns refs in canonical (gen↑, id↑) order', async () => {
    const out = await pageOfSheepFiltered(
      1, 9,
      { ...DEFAULT_FILTER_SPEC, sortDir: 'asc' },
      { index: idx },
    );
    expect(out[0]).toEqual({ gen: 165, id: 0 });
    expect(out[8]).toEqual({ gen: 165, id: 8 });
  });

  it('page 3 returns the trailing 7 refs (25 - 18 = 7)', async () => {
    const out = await pageOfSheepFiltered(3, 9, DEFAULT_FILTER_SPEC, { index: idx });
    expect(out.length).toBe(7);
  });

  it('sort=interest reorders by interestScore descending', async () => {
    // Coverage decreases with id; interestScore is dominated by coverage in
    // the defaults — so id 0 (cov 1.0) should sort first.
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, sort: 'interest' };
    const out = await pageOfSheepFiltered(1, 9, spec, { index: idx });
    expect(out[0]).toEqual({ gen: 165, id: 0 });
  });

  it('sort=coverage orders descending by coverage, tie-break (gen,id) asc', async () => {
    const stub = makeStubIndex([
      recF(165, 0, 3, 0.2, 0.5, 0.5, 0.5),
      recF(165, 1, 3, 0.9, 0.5, 0.5, 0.5),
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5),
      recF(166, 0, 3, 0.9, 0.5, 0.5, 0.5), // tied with 165/1
    ]);
    const out = await pageOfSheepFiltered(
      1, 9,
      { ...DEFAULT_FILTER_SPEC, sort: 'coverage' },
      { index: stub },
    );
    expect(out).toEqual([
      { gen: 165, id: 1 }, // cov 0.9, lower gen wins tie
      { gen: 166, id: 0 }, // cov 0.9
      { gen: 165, id: 2 }, // cov 0.5
      { gen: 165, id: 0 }, // cov 0.2
    ]);
  });

  it('sort=entropy orders descending by entropy', async () => {
    const stub = makeStubIndex([
      recF(165, 0, 3, 0.5, 0.2, 0.5, 0.5),
      recF(165, 1, 3, 0.5, 0.9, 0.5, 0.5),
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5),
    ]);
    const out = await pageOfSheepFiltered(
      1, 9,
      { ...DEFAULT_FILTER_SPEC, sort: 'entropy' },
      { index: stub },
    );
    expect(out.map((r) => r.id)).toEqual([1, 2, 0]);
  });

  it('sort=colorVar orders descending by colorVar', async () => {
    const stub = makeStubIndex([
      recF(165, 0, 3, 0.5, 0.5, 0.2, 0.5),
      recF(165, 1, 3, 0.5, 0.5, 0.9, 0.5),
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5),
    ]);
    const out = await pageOfSheepFiltered(
      1, 9,
      { ...DEFAULT_FILTER_SPEC, sort: 'colorVar' },
      { index: stub },
    );
    expect(out.map((r) => r.id)).toEqual([1, 2, 0]);
  });

  it('sort=meanLum orders descending by meanLum', async () => {
    const stub = makeStubIndex([
      recF(165, 0, 3, 0.5, 0.5, 0.5, 0.2),
      recF(165, 1, 3, 0.5, 0.5, 0.5, 0.9),
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5),
    ]);
    const out = await pageOfSheepFiltered(
      1, 9,
      { ...DEFAULT_FILTER_SPEC, sort: 'meanLum' },
      { index: stub },
    );
    expect(out.map((r) => r.id)).toEqual([1, 2, 0]);
  });

  it('vars filter narrows the result set', async () => {
    const mixed = makeStubIndex([
      recF(165, 0, 3, 0.5, 0.5, 0.5, 0.5, [14]),    // julia
      recF(165, 1, 3, 0.5, 0.5, 0.5, 0.5, [0]),     // linear
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5, [14, 0]), // julia + linear
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [14] };
    const out = await pageOfSheepFiltered(1, 9, spec, { index: mixed });
    // Default sortDir='desc' → reverse natural order. Two passing records
    // (165/0 + 165/2) walked in reverse = 165/2 first.
    expect(out).toEqual([{ gen: 165, id: 2 }, { gen: 165, id: 0 }]);
  });

  it('xform range narrows the result set', async () => {
    const mixed = makeStubIndex([
      recF(165, 0, 2),
      recF(165, 1, 3),
      recF(165, 2, 4),
      recF(165, 3, 5),
    ]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, xformMin: 3, xformMax: 4 };
    const out = await pageOfSheepFiltered(1, 9, spec, { index: mixed });
    // Default sortDir='desc' → reverse-walk; passing records 165/1 + 165/2
    // → 165/2 first.
    expect(out).toEqual([{ gen: 165, id: 2 }, { gen: 165, id: 1 }]);
  });
});

describe('totalPagesFiltered', () => {
  beforeEach(() => {
    _resetMasterListCache();
  });

  it('25 records / 9 per page = 3 pages', () => {
    const idx = makeStubIndex(
      Array.from({ length: 25 }, (_, i) => recF(165, i, 3)),
    );
    expect(totalPagesFiltered(DEFAULT_FILTER_SPEC, 9, { index: idx })).toBe(3);
  });

  it('empty result set → 0 pages', () => {
    const idx = makeStubIndex([recF(165, 0, 3, 0.5, 0.5, 0.5, 0.5, [14])]);
    const spec: FilterSpec = { ...DEFAULT_FILTER_SPEC, vars: [0] }; // linear absent
    expect(totalPagesFiltered(spec, 9, { index: idx })).toBe(0);
  });
});

// ── #49 Task A6: mountGallery filtered path wiring ─────────────────────
//
// Verify that when an `index` + `initialFilter` are passed, runWave resolves
// refs via the master-list (pageOfSheepFiltered) instead of pageOfSheep —
// and that setPage(page, nextFilter) rebuilds the master list when the
// filter changes. A regression case asserts the existing pageOfSheep path
// still runs when neither hook is provided.

describe('mountGallery — filtered path', () => {
  beforeEach(() => {
    _resetMasterListCache();
  });

  // Throws if pageOfSheep's loadAvail is ever called — proves the filtered
  // path skipped the unfiltered walk.
  const throwingLoadAvail = async (_g: number): Promise<number[]> => {
    throw new Error('loadAvail must not be called on the filtered path');
  };
  const throwingLoadManifest = async (): Promise<null> => {
    throw new Error('loadManifest must not be called on the filtered path');
  };

  it('uses pageOfSheepFiltered when index + initialFilter are provided', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchCalls: SheepRef[] = [];
    const fetchGenome = async (gen: number, id: number): Promise<Genome | null> => {
      fetchCalls.push({ gen, id });
      return stubGenome();
    };
    // Stub index: 9 records, ids 0..8, gen 165 — page 1 (perPage 9) covers all.
    const idx = makeStubIndex(
      Array.from({ length: 9 }, (_, i) => recF(165, i, 3)),
    );

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      // throwingLoadAvail/Manifest must never be called on the filtered path.
      loadAvail: throwingLoadAvail,
      loadManifest: throwingLoadManifest,
      index: idx,
      initialFilter: DEFAULT_FILTER_SPEC,
    });

    await flushMicrotasks();

    // Default sortDir='desc' on time = reverse-chronological walk: ids
    // appear 8 → 0 instead of 0 → 8.
    expect(fetchCalls).toEqual(
      Array.from({ length: 9 }, (_, i) => ({ gen: 165, id: 8 - i })),
    );

    handle.destroy();
  });

  it('setPage(page, nextFilter) rebuilds the master list when the filter differs', async () => {
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const fetchCalls: SheepRef[] = [];
    const fetchGenome = async (gen: number, id: number): Promise<Genome | null> => {
      fetchCalls.push({ gen, id });
      return stubGenome();
    };
    // Mixed index: half have variation 14 (julia), half have variation 0 (linear).
    const idx = makeStubIndex([
      recF(165, 0, 3, 0.5, 0.5, 0.5, 0.5, [14]),
      recF(165, 1, 3, 0.5, 0.5, 0.5, 0.5, [14]),
      recF(165, 2, 3, 0.5, 0.5, 0.5, 0.5, [0]),
      recF(165, 3, 3, 0.5, 0.5, 0.5, 0.5, [0]),
    ]);

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: throwingLoadAvail,
      loadManifest: throwingLoadManifest,
      index: idx,
      initialFilter: DEFAULT_FILTER_SPEC, // no vars filter → all 4 records
    });

    await flushMicrotasks();
    const initialCount = fetchCalls.length;
    expect(initialCount).toBe(4);

    // Switch to a vars=[14] filter — master list rebuilds to 2 records.
    fetchCalls.length = 0;
    await handle.setPage(1, { ...DEFAULT_FILTER_SPEC, vars: [14] });
    await flushMicrotasks();

    // Default sortDir='desc' on time → reverse walk; vars=[14] passes
    // records 165/0 + 165/1 → fetched 165/1 first.
    expect(fetchCalls).toEqual([
      { gen: 165, id: 1 },
      { gen: 165, id: 0 },
    ]);

    handle.destroy();
  });

  it('falls back to pageOfSheep when index/initialFilter are not provided', async () => {
    // Regression guard: omitting the filtered hooks must keep the legacy
    // pageOfSheep walk active — proven by orchLoadAvail being called.
    const container = document.createElement('div');
    const harness = makeOrchHarness();
    const availCalls: number[] = [];
    const recordingLoadAvail = async (g: number): Promise<number[]> => {
      availCalls.push(g);
      return ORCH_AVAIL[g] ?? [];
    };
    const fetchGenome = async (): Promise<Genome | null> => stubGenome();

    const handle = await mountGallery(1, {
      renderer: stubRenderer(),
      device: null as unknown as GPUDevice,
      format: 'bgra8unorm',
      container,
      fetchGenome,
      draftTier: DRAFT_TIER,
      startRender: harness.startRender,
      loadAvail: recordingLoadAvail,
      loadManifest: orchLoadManifest,
      // No `index`, no `initialFilter` — legacy path.
    });

    await flushMicrotasks();
    expect(availCalls.length).toBeGreaterThan(0); // legacy path was used
    expect(harness.seeds.length).toBe(9);

    handle.destroy();
  });
});
