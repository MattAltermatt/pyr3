// #70: load-sequencing primitives extracted from createApp() in main.ts.
// Owns four pieces of state that protect the viewer's file/corpus/dev-hook
// load surfaces against re-entrancy and out-of-order completion:
//
//   - loadInFlight: synchronous guard against re-entrant loadFromFile calls
//   - loadHookQueue: serializes __pyr3LoadFlame test-hook calls
//   - corpusQueue: serializes corpus pill / arrow / pushState navigations
//   - navLocked: synchronous lock between dispatch and load-settled, so a
//     burst of pill clicks can't stack navigations behind the in-flight
//     load (loadInFlight only flips after the chunk fetch resolves).
//
// The module knows nothing about main.ts's other state — callers pass in
// the actual loadFromFile implementation, the device handle (for GPU drain),
// and the per-call `isRenderInFlight` predicate (which gates navigation
// during a standalone quality-ladder render).

export interface LoadSequencerDeps {
  device: GPUDevice;
  loadFromFile: (file: File) => Promise<void>;
}

export interface LoadSequencer {
  /** Re-entrant-guarded file load. Drains GPU queue before releasing the lock. */
  loadFile(file: File): Promise<void>;
  /** Dev-hook for FE↔BE parity rigs — serialized across calls, waits out unrelated loads. */
  enqueueHook(text: string, label?: string): Promise<void>;
  /** Serialize a corpus-load callback through the corpus chain. */
  enqueueCorpus(load: () => Promise<void>): Promise<void>;
  /** Synchronous nav lock — drop the call if a nav or render is already in flight. */
  tryNavigateCorpus(load: () => Promise<void>, isRenderInFlight: () => boolean): void;
  /** Observable: is a file/corpus load currently mid-flight? */
  inFlight(): boolean;
}

export function createLoadSequencer({ device, loadFromFile }: LoadSequencerDeps): LoadSequencer {
  let loadInFlight = false;
  let loadHookQueue: Promise<void> = Promise.resolve();
  let corpusQueue: Promise<void> = Promise.resolve();
  let navLocked = false;

  const loadFile = async (file: File): Promise<void> => {
    if (loadInFlight) {
      // Same warn the pre-extract main.ts emitted — keeps the console-trail
      // observable for parity with old behavior.
      console.warn(`pyr3: load already in flight; ignoring ${file.name}`);
      return;
    }
    loadInFlight = true;
    try {
      await loadFromFile(file);
      // Drain GPU before clearing the lock — otherwise the next load's
      // renderer.resize() can destroyPipelines() while previous commands
      // still reference those buffers (Phase 2 verify, 2026-05-26).
      await device.queue.onSubmittedWorkDone();
    } finally {
      loadInFlight = false;
    }
  };

  const enqueueHook = (text: string, label = 'test.flame'): Promise<void> => {
    const next = loadHookQueue.then(async () => {
      // If a non-hook caller (welcome flame, file picker) is still in
      // flight, wait it out — loadFile would otherwise drop this call.
      while (loadInFlight) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await loadFile(new File([text], label, { type: 'text/xml' }));
    });
    loadHookQueue = next.catch(() => {});
    return next;
  };

  const enqueueCorpus = (load: () => Promise<void>): Promise<void> => {
    const next = corpusQueue.then(load);
    corpusQueue = next.catch(() => {});
    return next;
  };

  const tryNavigateCorpus = (load: () => Promise<void>, isRenderInFlight: () => boolean): void => {
    if (navLocked || isRenderInFlight()) return;
    navLocked = true;
    void enqueueCorpus(load).finally(() => { navLocked = false; });
  };

  return {
    loadFile,
    enqueueHook,
    enqueueCorpus,
    tryNavigateCorpus,
    inFlight: () => loadInFlight,
  };
}
