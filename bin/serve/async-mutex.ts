// #231 — minimal async mutex (promise-chain serialization).
//
// /api/render shares a single module-level renderer + accumulation histogram
// + output texture (render-png.ts, warm-cached on purpose for perf). node:http
// processes requests concurrently and the chunk loop yields at every
// `onSubmittedWorkDone()`, so two overlapping POSTs would interleave and
// corrupt each other's render (use-after-destroy on resize, or two genomes
// accumulating into one histogram). Serializing render jobs through this mutex
// keeps the warm renderer while guaranteeing one render runs at a time.

export class AsyncMutex {
  // `tail` always resolves (never rejects) once the previous task settles, so
  // a failed task never wedges the queue for the next caller.
  private tail: Promise<void> = Promise.resolve();

  /** Run `task` once all previously-enqueued tasks have settled. Returns the
   *  task's own promise (its result/rejection is surfaced to THIS caller; the
   *  queue itself swallows the settle so order is preserved either way). */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
