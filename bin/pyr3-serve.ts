#!/usr/bin/env -S node --experimental-strip-types
// pyr3 serve — local capability host for the viewer (#201 P0 of #17).
//
// Boots a node:http server on 127.0.0.1:5174 (auto-bumps if taken),
// hosts the built viewer assets (SEA-bundled in production / from
// ./dist in dev), and exposes five API routes:
//
//   GET  /api/capabilities  — viewer handshake; returns Capability JSON
//   POST /api/render        — render genome → PNG, SSE progress + bytes
//   POST /api/animate       — SSE-streamed render (keyframe .flam3 or timeline)
//   POST /api/pick-dir      — directory picker
//   POST /api/cancel/:id    — abort an in-flight render
//
// Usage:
//   pyr3 serve [--port N] [--no-open]
//   PYR3_SERVE_FROM_DIST=1 npm run serve   (dev, no SEA build)

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

import { installWebGPUHost, acquireDawnDevice } from './host';
import { Router } from './serve/router';
import { makeCapabilitiesRoute } from './serve/route-capabilities';
import { makeRenderRoute } from './serve/route-render';
import { makeAnimateRoute } from './serve/route-animate';
import { handlePickDir } from './serve/route-pick-dir';
import { handleCancel } from './serve/route-cancel';
import { makeAssetHandler, hasAssetSource } from './serve/assets';
import { checkSameOrigin } from './serve/request-guard';

installWebGPUHost();

interface CliArgs {
  port: number;
  open: boolean;
}

function parseArgs(rawArgs: string[]): CliArgs {
  let port = 5174;
  let open = true;
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]!;
    if (a === '--port') {
      const v = rawArgs[++i];
      const n = v === undefined ? NaN : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 65535) {
        console.error('--port requires a valid port number (0-65535)');
        process.exit(1);
      }
      port = Math.floor(n);
    } else if (a === '--no-open') {
      open = false;
    } else if (a === '--help' || a === '-h') {
      console.log('usage: pyr3 serve [--port N] [--no-open]');
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(1);
    }
  }
  if (process.env['CI'] || process.env['PYR3_NO_OPEN']) {
    open = false;
  }
  return { port, open };
}

function openBrowser(url: string): void {
  // execFile (no shell) — URL is server-built, but skipping the shell
  // removes shell-metachar risk entirely.
  const p = platform();
  const cmd = p === 'darwin' ? 'open' : p === 'win32' ? 'cmd' : 'xdg-open';
  const args = p === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(cmd, args, (err) => {
    if (err) console.warn(`[pyr3-serve] could not auto-open browser: ${err.message}`);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Acquire the GPU device up-front so the first /api/render request
  // doesn't pay the ~1-2s adapter cold-start cost.
  const device = await acquireDawnDevice('pyr3-serve');

  if (!hasAssetSource()) {
    console.warn(
      '[pyr3-serve] WARNING: no viewer asset source detected. API routes will respond but '
        + 'static asset requests will 503 until you `npm run build` + set PYR3_SERVE_FROM_DIST=1, '
        + 'or build the SEA binary via `npm run build:cli serve`.',
    );
  }

  const router = new Router();
  // #230 — same-origin gate on every /api route (matched routes only; the
  // static-asset fallback is exempt). Closes DNS-rebinding / CSRF-via-fetch
  // against /api/render, /api/animate (arbitrary out_dir write), /api/pick-dir.
  router.setGuard((req) => {
    const verdict = checkSameOrigin(req.headers);
    return verdict.ok ? null : verdict.reason;
  });
  router.add('GET', '/api/capabilities', makeCapabilitiesRoute({}));
  router.add('POST', '/api/render', makeRenderRoute(() => device));
  router.add('POST', '/api/animate', makeAnimateRoute(() => device));
  router.add('POST', '/api/pick-dir', handlePickDir);
  router.add('POST', '/api/cancel/:id', handleCancel);
  router.setFallback(makeAssetHandler());

  const server = createServer((req, res) => {
    void router.dispatch(req, res).catch((err) => {
      console.error('[pyr3-serve] route error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: (err as Error).message }));
      } else {
        res.end();
      }
    });
  });

  const port = await listenWithAutoBump(server, args.port);
  // #318 — advertise the literal bind address. The server binds IPv4-only
  // 127.0.0.1 (below); on hosts where `localhost` resolves to ::1 first, an
  // advertised `http://localhost` URL can fail to connect.
  const url = `http://127.0.0.1:${port}`;
  console.log(`[pyr3-serve] listening on ${url}`);
  if (args.open) openBrowser(url);

  const shutdown = (sig: string) => {
    console.log(`[pyr3-serve] ${sig} — shutting down`);
    server.close(() => process.exit(0));
    // Hard-exit after 2s if connections are stuck.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function listenWithAutoBump(server: import('node:http').Server, startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = startPort;
    const maxAttempts = 32;
    const tries: number[] = [];

    function tryListen(port: number): void {
      tries.push(port);
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && tries.length < maxAttempts && port !== 0) {
          attempt += 1;
          tryListen(attempt);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        const addr = server.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(boundPort);
      });
    }
    tryListen(attempt);
  });
}

main().catch((err: unknown) => {
  console.error('[pyr3-serve] failed —', err);
  process.exit(1);
});
