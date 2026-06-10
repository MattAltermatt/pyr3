// Integration test: spawn `tsx bin/pyr3-serve.ts --port 0 --no-open`,
// wait for the listening line on stdout, hit /api/capabilities + render
// a tiny fixture via /api/render, assert the SSE stream produces a PNG.
//
// Gated behind VITEST_INCLUDE_SERVE=1 because it requires Dawn-node
// (slow boot, GPU access). Run via `npm run test:serve`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath, join as joinPath } from 'node:path';
import { DOMParser } from 'linkedom';

import { parseFlame } from '../../src/flame-import';
import { genomeToJson } from '../../src/serialize';

(globalThis as { DOMParser: unknown }).DOMParser = DOMParser;

const ENABLED = process.env['VITEST_INCLUDE_SERVE'] === '1';
const describeIf = ENABLED ? describe : describe.skip;

const REPO_ROOT = resolvePath(import.meta.dirname ?? __dirname, '..', '..');

interface BootedServer {
  child: ChildProcess;
  url: string;
}

async function bootServer(): Promise<BootedServer> {
  // Use port 0 → OS picks a free one; the server prints its bound URL on stdout.
  const child = spawn(
    'node',
    [
      '--import',
      'tsx/esm',
      '--import',
      `${REPO_ROOT}/bin/wgsl-loader-register.mjs`,
      `${REPO_ROOT}/bin/pyr3-serve.ts`,
      '--port',
      '0',
      '--no-open',
    ],
    { cwd: REPO_ROOT, env: { ...process.env, PYR3_NO_OPEN: '1' } },
  );

  return new Promise<BootedServer>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('pyr3 serve did not boot within 30s'));
    }, 30_000);
    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const m = stdoutBuf.match(/listening on (http:\/\/localhost:\d+)/);
      if (m) {
        clearTimeout(timeout);
        resolve({ child, url: m[1]! });
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[pyr3-serve stderr] ${chunk.toString('utf8')}`);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`pyr3 serve exited early with code ${code ?? '?'}`));
    });
  });
}

describeIf('pyr3 serve — integration', () => {
  let server: BootedServer;

  beforeAll(async () => {
    server = await bootServer();
  }, 60_000);

  afterAll(() => {
    server?.child.kill('SIGINT');
  });

  it('GET /api/capabilities returns a dawn-node backend descriptor', async () => {
    const res = await fetch(`${server.url}/api/capabilities`);
    expect(res.status).toBe(200);
    const cap = (await res.json()) as { backend: string; max_quality: number | null };
    expect(cap.backend).toBe('dawn-node');
    expect(cap.max_quality).toBeNull();
  });

  it('POST /api/render streams progress + a PNG via SSE', async () => {
    // Use a tiny fixture so the test stays under a few seconds. 245.00381
    // is a known-cheap parity fixture; scope dims down further so this
    // round-trips quickly even on slower hardware.
    const fixturePath = resolvePath(
      REPO_ROOT,
      'fixtures',
      'flam3-goldens',
      '244.00016',
      '244.00016.flam3',
    );
    const xml = readFileSync(fixturePath, 'utf8');
    const { genome } = parseFlame(xml);
    const genomeJson = genomeToJson(genome);

    const res = await fetch(`${server.url}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genome: genomeJson,
        dim: { width: 128, height: 128 },
        quality: 5,
        oversample: 1,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let progressEvents = 0;
    let png: Uint8Array | null = null;
    const start = Date.now();
    while (Date.now() - start < 60_000 && !png) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const data = dataLines.join('\n');
        if (event === 'progress') progressEvents++;
        if (event === 'done') {
          const d = JSON.parse(data) as { png_base64: string };
          png = Buffer.from(d.png_base64, 'base64');
        }
        if (event === 'error') throw new Error(`render reported error: ${data}`);
      }
    }
    expect(png).not.toBeNull();
    expect(progressEvents).toBeGreaterThanOrEqual(1);
    // PNG magic bytes.
    expect(png![0]).toBe(0x89);
    expect(png![1]).toBe(0x50);
    expect(png![2]).toBe(0x4e);
    expect(png![3]).toBe(0x47);
  }, 90_000);

  it('POST /api/animate writes N PNGs to disk + streams SSE progress', async () => {
    // 247.29388 has 2 keyframes (the smallest committed multi-keyframe
    // fixture). Render 2 frames at tiny dims/quality so wall-clock stays
    // sane on slower hardware.
    const fixturePath = resolvePath(
      REPO_ROOT,
      'fixtures',
      'flam3-goldens',
      '247.29388',
      '247.29388.flam3',
    );
    const xml = readFileSync(fixturePath, 'utf8');
    const outDir = mkdtempSync(joinPath(tmpdir(), 'pyr3-animate-test-'));

    try {
      const res = await fetch(`${server.url}/api/animate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flame_xml: xml,
          out_dir: outDir,
          begin: 0,
          end: 1,
          dtime: 1,
          // Crank ss WAY down to keep frame render time tiny.
          ss: 0.05,
          qs: 0.1,
        }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toBeTruthy();

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let progressEvents = 0;
      let done = false;
      let writtenFromDone: string[] = [];
      const start = Date.now();
      while (Date.now() - start < 120_000 && !done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = 'message';
          const dataLines: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          const data = dataLines.join('\n');
          if (event === 'progress') progressEvents++;
          if (event === 'done') {
            const d = JSON.parse(data) as { written: string[] };
            writtenFromDone = d.written;
            done = true;
          }
          if (event === 'error') throw new Error(`animate reported error: ${data}`);
        }
      }

      expect(done).toBe(true);
      expect(progressEvents).toBeGreaterThanOrEqual(2);
      expect(writtenFromDone).toHaveLength(2);
      const onDisk = readdirSync(outDir).filter((f) => f.endsWith('.png')).sort();
      expect(onDisk).toEqual(['00000.png', '00001.png']);
      // PNG magic on the first file.
      const firstBytes = readFileSync(joinPath(outDir, '00000.png'));
      expect(firstBytes[0]).toBe(0x89);
      expect(firstBytes[1]).toBe(0x50);
      expect(firstBytes[2]).toBe(0x4e);
      expect(firstBytes[3]).toBe(0x47);
    } finally {
      if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
    }
  }, 150_000);
});
