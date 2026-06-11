// Tiny node:http router shim. No Express/Fastify — the surface is 3 API
// routes + a static catch-all and the SEA binary stays lean. Routes
// register a (method, pathPattern) tuple and a handler that gets the
// node:http req/res plus parsed path params.

import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

/** Per-request gate run before a matched route's handler (never the static
 *  fallback). Returns null to allow, or a reason string to reject 403. Used to
 *  enforce same-origin on the /api surface (#230). */
export type RouteGuard = (req: IncomingMessage) => string | null;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

/** Translates `/api/cancel/:id` → /^\/api\/cancel\/([^/]+)$/ + ['id']. */
function compile(pathPattern: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = pathPattern.replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
  const src = escaped.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name: string) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${src}$`), paramNames };
}

export class Router {
  private routes: Route[] = [];
  private fallback: RouteHandler | null = null;
  private guard: RouteGuard | null = null;

  add(method: string, pathPattern: string, handler: RouteHandler): void {
    const { pattern, paramNames } = compile(pathPattern);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  setFallback(handler: RouteHandler): void {
    this.fallback = handler;
  }

  /** Install a guard run before every matched route handler. The static
   *  fallback is exempt (assets are same-origin GETs; the SPA must load). */
  setGuard(guard: RouteGuard): void {
    this.guard = guard;
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      if (this.guard) {
        const reason = this.guard(req);
        if (reason !== null) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ error: `forbidden: ${reason}` }));
          return;
        }
      }
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? '');
      });
      await route.handler(req, res, params);
      return;
    }
    if (this.fallback) {
      await this.fallback(req, res, {});
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  }
}
