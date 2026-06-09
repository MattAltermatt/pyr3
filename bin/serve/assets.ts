// Static asset serving for `pyr3 serve`. Production: viewer files are
// bundled as SEA assets under the `viewer/<path>` key. Dev: setting
// PYR3_SERVE_FROM_DIST=1 reads from the on-disk `dist/` directory so
// `npm run serve` works straight after `npm run build` without an SEA
// rebuild.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize } from 'node:path';
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

interface AssetSource {
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

class FsAssetSource implements AssetSource {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  read(path: string): Uint8Array | null {
    const full = normalize(join(this.root, path));
    if (!full.startsWith(this.root)) return null; // path traversal guard
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

export function makeAssetHandler() {
  return function handleAsset(req: IncomingMessage, res: ServerResponse): void {
    if (!source) {
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
    let bytes = source.read(assetPath);
    if (!bytes && !extname(assetPath)) {
      bytes = source.read('index.html');
    }
    if (!bytes) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`Not Found: ${pathname}`);
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeFor(assetPath));
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  };
}
