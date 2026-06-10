#!/usr/bin/env node
// #223 — `npm test` wrapper that keeps the suite both green AND honest in the
// face of Dawn-node's flaky forked-worker teardown crash.
//
// Background: each `*.gpu.test.ts` creates a module-scope Dawn instance with no
// disposal API; under load the forked vitest worker occasionally CRASHES during
// process exit, AFTER that file's tests have all passed. vitest.config.ts's
// `onUnhandledError` filter (src/dawn-teardown-filter.ts) already stops that
// benign crash from flipping the exit code to 1. But a crashed worker can also
// drop its (passing) file's results from the run, leaving a misleading
// "164 passed (165)" with 7 uncounted tests. This wrapper closes that gap:
//
//   1. Run vitest normally (output streamed live, also captured).
//   2. A NON-ZERO exit means a GENUINE failure — the filter neutralizes only the
//      Dawn teardown signature, so anything left is a real test/assertion failure
//      or a non-Dawn unhandled error. Propagate it. No retry.
//   3. A ZERO exit with one or more files flagged by the pool teardown line
//      ("Timeout terminating … worker for test files <path>") means those files'
//      results may be incomplete. Re-run JUST those files once, in a fresh
//      worker, so their tests actually execute and report — recovering the count
//      and catching any real failure the crash could have skipped. Propagate the
//      retry's exit code.
//
// Net invariant: every test passes ⇒ exit 0 with all files counted; any real
// failure ⇒ non-zero — regardless of how the Dawn worker teardown races.
//
// Passes through CLI args (e.g. a file path or `-t pattern`) and inherits env
// (so VITEST_INCLUDE_* gating from test:all etc. still applies).

import { spawn } from 'node:child_process';

const passthroughArgs = process.argv.slice(2);

/** Run `vitest run [files…|passthrough]`, tee-ing output to the console while
 *  capturing it for crash detection. Resolves { code, out }. */
function runVitest(files) {
  return new Promise((resolve) => {
    const args = ['vitest', 'run', ...(files ?? passthroughArgs)];
    const child = spawn('npx', args, { env: process.env });
    let out = '';
    const tee = (src, dst) => src.on('data', (chunk) => { out += chunk.toString(); dst.write(chunk); });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('error', (err) => { process.stderr.write(`[run-tests] failed to spawn vitest: ${err}\n`); resolve({ code: 1, out }); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

/** Extract test-file paths flagged by vitest's pool teardown-timeout line — the
 *  reliable signal that a forked worker crashed/hung instead of exiting clean. */
function detectCrashedFiles(output) {
  const re = /Timeout terminating \w+ worker for test files (.+?\.ts)\b/g;
  const files = new Set();
  for (const m of output.matchAll(re)) files.add(m[1]);
  return [...files];
}

const first = await runVitest(null);

// Genuine failure (real assertions / non-Dawn errors are NOT swallowed by the
// onUnhandledError filter) → propagate immediately.
if (first.code !== 0) process.exit(first.code);

const crashed = detectCrashedFiles(first.out);
if (crashed.length === 0) process.exit(0);

process.stdout.write(
  `\n[run-tests] #223: Dawn-node forked-worker teardown crashed on ${crashed.length} file(s); ` +
  `re-running to confirm their results:\n  ${crashed.join('\n  ')}\n`,
);

const retry = await runVitest(crashed);
// The retry runs through the same filter, so a non-zero exit here is a real
// failure; a zero exit (even if it crashes again at teardown) means the tests
// passed. Either way, propagate.
process.exit(retry.code);
