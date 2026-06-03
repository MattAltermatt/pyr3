// #65 Tier 1 — walker-jitter URL parameter + session resolution.
//
// The walker-jitter knob is a chaos-kernel parameter (DEFAULT_WALKER_JITTER
// in chaos.ts — a dimensionless proportional factor since #43). It's a
// runtime knob accessible from the viewer via `?jitter=<amp>` and the BE
// CLI via `--jitter <amp>`. This module owns the URL-parsing seam so
// chaos.ts stays DOM-free and tests can pin the parser independently of
// main.ts.

import { DEFAULT_WALKER_JITTER } from './chaos';

export { DEFAULT_WALKER_JITTER };

/**
 * Parse `?jitter=<amp>` from a URL search string. Returns the parsed value
 * when the param is present AND parses as a finite non-negative number;
 * returns null otherwise (no param, malformed value, negative value, NaN,
 * etc.) so the caller can fall back to DEFAULT_WALKER_JITTER.
 *
 * Since #43 the value is a SCALE-RELATIVE proportional factor, not an
 * absolute amplitude; see chaos.ts DEFAULT_WALKER_JITTER for the
 * semantics. The check is intentionally permissive on format — accepts
 * standard JS number literals (`1e-7`, `0`, `5e-9`) because the intended
 * use is ad-hoc CLI / URL debugging, not user-facing input.
 */
export function parseJitterFromSearch(search: string): number | null {
  const params = new URLSearchParams(search);
  const raw = params.get('jitter');
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Resolve the walker jitter for this session: `?jitter=` if present + valid,
 * otherwise DEFAULT_WALKER_JITTER.
 */
export function resolveWalkerJitter(search: string): number {
  return parseJitterFromSearch(search) ?? DEFAULT_WALKER_JITTER;
}
