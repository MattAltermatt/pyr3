#!/usr/bin/env node
// scripts/smoke-serve-sea.mjs — smoke test for the SEA `pyr3-serve` binary.
//
// Runs ./build/pyr3-serve --port 0 --no-open, parses the listening port
// out of stdout, asserts /api/capabilities responds with backend=dawn-node
// and the static catch-all returns 200 for index.html, then SIGINTs the
// child. Non-zero exit on any check fail.
//
// Usage:
//   npm run smoke:serve
//
// Pairs with `npm run build:cli:serve` (#201 Task 9 acceptance criterion).

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const BIN_PATH = resolve(REPO_ROOT, 'build', 'pyr3-serve');

if (!existsSync(BIN_PATH)) {
  console.error(`smoke-serve-sea: binary not found at ${BIN_PATH}.`);
  console.error('Run `npm run build:cli:serve` first.');
  process.exit(1);
}

const sizeMB = statSync(BIN_PATH).size / 1024 / 1024;
console.log(`[smoke-serve] binary: ${BIN_PATH} (${sizeMB.toFixed(1)} MB)`);
if (sizeMB > 200) {
  console.warn(`[smoke-serve] WARNING: binary exceeds 200 MB acceptance ceiling (${sizeMB.toFixed(1)} MB)`);
}

const child = spawn(BIN_PATH, ['--port', '0', '--no-open'], {
  cwd: REPO_ROOT,
  env: { ...process.env, PYR3_NO_OPEN: '1' },
});

let stdoutBuf = '';
let port = 0;
let failed = false;

const portPromise = new Promise((resolveP, rejectP) => {
  const timer = setTimeout(() => rejectP(new Error('binary did not bind within 30s')), 30_000);
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    stdoutBuf += text;
    process.stdout.write(`[pyr3-serve] ${text}`);
    const m = stdoutBuf.match(/listening on http:\/\/localhost:(\d+)/);
    if (m) {
      port = Number(m[1]);
      clearTimeout(timer);
      resolveP(port);
    }
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[pyr3-serve err] ${chunk.toString('utf8')}`);
  });
});

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    failed = true;
  }
}

try {
  await portPromise;
  const base = `http://localhost:${port}`;

  await check('GET /api/capabilities → 200 + backend=dawn-node', async () => {
    const res = await fetch(`${base}/api/capabilities`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const cap = await res.json();
    if (cap.backend !== 'dawn-node') throw new Error(`backend was ${cap.backend}`);
    if (cap.max_quality !== null) throw new Error(`max_quality was ${cap.max_quality}, expected null`);
  });

  await check('GET / → 200 (viewer index.html from SEA assets)', async () => {
    const res = await fetch(`${base}/`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const html = await res.text();
    if (!html.includes('<html')) throw new Error('response did not look like HTML');
  });

  await check('POST /api/cancel/missing-id → 200 + cancelled=false', async () => {
    const res = await fetch(`${base}/api/cancel/not-a-real-id`, { method: 'POST' });
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    const body = await res.json();
    if (body.cancelled !== false) throw new Error(`cancelled was ${body.cancelled}`);
  });
} catch (err) {
  console.error(`[smoke-serve] FATAL: ${err.message}`);
  failed = true;
} finally {
  child.kill('SIGINT');
  await new Promise((r) => child.on('exit', r));
}

if (failed) {
  console.error('[smoke-serve] FAIL');
  process.exit(1);
}
console.log('[smoke-serve] OK');
