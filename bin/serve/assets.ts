// Static asset serving for `pyr3 serve`. Production: viewer files are
// bundled as SEA assets under the `viewer/<path>` key. Dev: setting
// PYR3_SERVE_FROM_DIST=1 reads from the on-disk `dist/` directory so
// `npm run serve` works straight after `npm run build` without an SEA
// rebuild.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize, sep } from 'node:path';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';

declare const require: NodeJS.Require | undefined;
const builtinRequire: NodeJS.Require =
  typeof require !== 'undefined' ? require : createRequire(import.meta.url);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';
}

// Heavy corpus artifacts (chunks ≈57 MB, showcase ≈250 MB, variation-thumbs)
// are deliberately NOT bundled into the SEA binary. On a local miss we fall
// back to the hosted copy on pyr3.app via a 302 redirect — gh-pages sends
// `access-control-allow-origin: *`, so the browser's cross-origin re-fetch of
// `.flam3chunk` bytes is CORS-permitted. #202
const PROXY_PREFIXES = ['chunks/', 'showcase/', 'variation-thumbs/'] as const;
const PROXY_ORIGIN = process.env['PYR3_PROXY_ORIGIN'] ?? 'https://pyr3.app';

/**
 * If `assetPath` falls under a proxied corpus prefix, return the upstream
 * pyr3.app URL to 302 to (query string preserved); else null. `assetPath` is
 * the leading-slash-stripped request path; `rawUrl` is the original req.url
 * (carries the query string).
 */
export function proxyTargetFor(
  assetPath: string,
  rawUrl: string,
  origin: string = PROXY_ORIGIN,
): string | null {
  if (!PROXY_PREFIXES.some((p) => assetPath.startsWith(p))) return null;
  const qIdx = rawUrl.indexOf('?');
  const query = qIdx >= 0 ? rawUrl.slice(qIdx) : '';
  return `${origin}/${assetPath}${query}`;
}

export interface AssetSource {
  read(path: string): Uint8Array | null;
}

class SeaAssetSource implements AssetSource {
  private sea: { getAsset?: (key: string) => ArrayBuffer };
  constructor(sea: { getAsset?: (key: string) => ArrayBuffer }) {
    this.sea = sea;
  }
  read(path: string): Uint8Array | null {
    const key = `viewer/${path}`;
    try {
      const buf = this.sea.getAsset?.(key);
      if (!buf) return null;
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }
}

export class FsAssetSource implements AssetSource {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  read(path: string): Uint8Array | null {
    const full = normalize(join(this.root, path));
    // Path-traversal guard. The trailing-sep check is load-bearing (#258):
    // a bare `startsWith(this.root)` would let a sibling like `/abs/dist-x`
    // pass for root `/abs/dist`. Allow `full === root` (a request for the
    // root dir itself) but otherwise require the separator boundary.
    if (full !== this.root && !full.startsWith(this.root + sep)) return null;
    if (!existsSync(full)) return null;
    if (!statSync(full).isFile()) return null;
    return new Uint8Array(readFileSync(full));
  }
}

function resolveAssetSource(): AssetSource | null {
  // SEA mode — assets bundled into the binary.
  let sea: { isSea?: () => boolean; getAsset?: (k: string) => ArrayBuffer } | undefined;
  try {
    sea = builtinRequire('node:sea');
  } catch {
    // not SEA
  }
  if (sea?.isSea?.()) {
    return new SeaAssetSource(sea);
  }
  // Dev fallback: PYR3_SERVE_FROM_DIST=1 → ./dist/.
  if (process.env['PYR3_SERVE_FROM_DIST'] === '1') {
    const distRoot = resolve(process.cwd(), 'dist');
    if (existsSync(distRoot)) return new FsAssetSource(distRoot);
  }
  return null;
}

const source = resolveAssetSource();

export function hasAssetSource(): boolean {
  return source !== null;
}

// Sentinel so callers can pass `null` to test the no-source 503 path while a
// no-arg call still resolves to the module-scope `source`.
const SOURCE_DEFAULT = Symbol('use-module-source');

export function makeAssetHandler(
  injected: AssetSource | null | typeof SOURCE_DEFAULT = SOURCE_DEFAULT,
) {
  const src = injected === SOURCE_DEFAULT ? source : injected;
  return function handleAsset(req: IncomingMessage, res: ServerResponse): void {
    if (!src) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(
        'pyr3 serve: no viewer assets bundled. Run `npm run build` and set PYR3_SERVE_FROM_DIST=1, '
          + 'or build the SEA binary via `npm run build:cli serve`.\n',
      );
      return;
    }
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';
    // SPA fallback: serve index.html for / and any non-file path
    // (Vite multi-page entries are `/v1/*` paths with explicit .html files;
    // a bare path with no extension falls back to index).
    let assetPath = pathname.replace(/^\/+/, '');
    if (assetPath === '' || assetPath.endsWith('/')) {
      assetPath = `${assetPath}index.html`;
    }
    let bytes = src.read(assetPath);
    let mimePath = assetPath;
    if (!bytes && !extname(assetPath)) {
      // SPA fallback — clean URLs like /v1/gen/247/id/19679 resolve to
      // index.html and must carry text/html, not octet-stream.
      bytes = src.read('index.html');
      mimePath = 'index.html';
    }
    if (!bytes) {
      // Corpus artifacts (chunks/showcase/variation-thumbs) aren't bundled —
      // fall back to the hosted copy on pyr3.app via a 302. #202
      const target = proxyTargetFor(assetPath, url);
      if (target) {
        res.statusCode = 302;
        res.setHeader('Location', target);
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return;
      }
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`Not Found: ${pathname}`);
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeFor(mimePath));
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  };
}
