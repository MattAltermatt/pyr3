// #65 Tier 1 — walker-jitter URL parameter + session resolution.
//
// The walker-jitter amplitude is a chaos-kernel parameter (shipped default
// `1e-10`, the post-#6 value). It's now a runtime knob accessible from the
// viewer via `?jitter=<amp>` and the BE CLI via `--jitter <amp>`. This
// module owns the URL-parsing seam so chaos.ts stays DOM-free and tests can
// pin the parser independently of main.ts.

import { DEFAULT_WALKER_JITTER } from './chaos';

export { DEFAULT_WALKER_JITTER };

/**
 * Parse `?jitter=<amp>` from a URL search string. Returns the parsed
 * amplitude when the param is present AND parses as a finite non-negative
 * number; returns null otherwise (no param, malformed value, negative value,
 * NaN, etc.) so the caller can fall back to the shipped default.
 *
 * The check is intentionally permissive on format — accepts standard
 * JS number literals (`1e-10`, `0.0000000001`, `0`, `5e-20`) because the
 * intended use is ad-hoc CLI / URL debugging, not user-facing input.
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
 * otherwise the shipped DEFAULT_WALKER_JITTER (1e-10).
 */
export function resolveWalkerJitter(search: string): number {
  return parseJitterFromSearch(search) ?? DEFAULT_WALKER_JITTER;
}
