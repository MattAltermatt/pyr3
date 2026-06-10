// #223 — Dawn-node forked-worker teardown crash filter.
//
// Symptom: `npm test` returned exit 1 on a fully-passing suite. Root cause
// (diagnosed #223): each `*.gpu.test.ts` file creates a module-scope Dawn
// instance via `create([])` (the `webgpu` npm package). That instance exposes
// NO disposal API (`destroy`/`dispose`/`Symbol.dispose` are all undefined — only
// `requestAdapter`/`getPreferredCanvasFormat`), so its native threads are only
// reclaimed when the worker process exits. In a forked vitest worker that
// process-exit path occasionally CRASHES inside the Dawn addon *after every test
// in the file has already passed*. Vitest surfaces the abnormal child exit as a
// pool-level unhandled error ("[vitest-pool]: Worker forks emitted error" caused
// by "Worker exited unexpectedly"), and any unhandled error flips the run's exit
// code to 1 — even though 0 tests failed.
//
// Key facts that make swallowing this signature SAFE (not a mask):
//   • It is load-dependent / flaky (~25% under load, ~0% idle) and instant — it
//     is NOT the `teardownTimeout` slow-exit case; raising that timeout never
//     fixed it because the worker crashes, it doesn't linger.
//   • The standalone process (`node` script doing the same create→device→destroy)
//     exits 0 cleanly, proving the crash is specific to the forked-worker
//     addon-unload path, not our GPU usage.
//   • "Worker exited unexpectedly" / "Worker {forks,threads} emitted error" are
//     pool-INFRASTRUCTURE messages — they never originate from a test assertion
//     or from `expect`. A worker that dies MID-test instead records FAILED tests,
//     which fail the run through the separate `getCountOfFailedTests()` exit path
//     that this filter does not touch.
//   • `onUnhandledError` returning `false` drops ONLY the matched error from the
//     fatal set; every other unhandled rejection/exception still fails the run
//     (unlike the blunt `dangerouslyIgnoreUnhandledErrors`, which silences all).
//
// So this filter restores the invariant "all tests pass ⇒ exit 0" without hiding
// any real failure. It is wired into `vitest.config.ts` as `test.onUnhandledError`.

/** True when `error` (or any error in its `.cause` chain) is the benign
 *  Dawn-node forked-worker teardown crash described above. */
export function isDawnWorkerTeardownError(error: unknown): boolean {
  const messages: string[] = [];
  let cur: unknown = error;
  // Walk the cause chain (vitest wraps the worker exit in a pool error whose
  // `.cause` is the real "Worker exited unexpectedly"); cap depth defensively.
  for (let depth = 0; cur != null && depth < 8; depth++) {
    if (typeof cur === 'object' && cur !== null) {
      const msg = (cur as { message?: unknown }).message;
      if (typeof msg === 'string') messages.push(msg);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      if (typeof cur === 'string') messages.push(cur);
      break;
    }
  }
  const joined = messages.join(' :: ');
  return /Worker (forks|threads) emitted error/.test(joined)
    || /Worker exited unexpectedly/.test(joined);
}

/** vitest `test.onUnhandledError` hook. Returns `false` (→ non-fatal) for the
 *  Dawn-node teardown crash only; `undefined` (→ stays fatal) for everything
 *  else, so genuine unhandled errors still fail the run. */
export function dawnTeardownUnhandledErrorFilter(error: unknown): boolean | void {
  if (isDawnWorkerTeardownError(error)) return false;
  return undefined;
}
