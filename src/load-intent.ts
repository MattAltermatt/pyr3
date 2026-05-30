// What pyr3 should load when the page boots. Driven entirely by the /v1 path
// grammar; the legacy ?flame=<encoded> share-link codec was removed in v0.32
// (superseded by /v1/gen/{gen}/id/{id}; see PYR3-020).
//
// /v1 path grammar:
//   /v1/gen/{gen}/id/{id}  → corpus leaf (gen, id are non-negative integers)
//   /v1/gen                → gen list
//   /v1/gen/{gen}          → gen browse
//   /v1/flame/...          → custom-reserved (future use)
//
// Absent a recognized /v1 path → default (main.ts resolves to the hardcoded
// welcome flame). Malformed /v1 paths never throw — they fall through to default.

// The canonical "welcome" hero sheep. Bare root (`/`, the `default` intent)
// forwards to this corpus leaf so the landing page is a real, shareable,
// nav-wired corpus URL (PYR3-053-adjacent root-forward) — while still painting
// the bundled fixture for an instant, chunk-free first paint. corpusUrl(HERO_*)
// MUST round-trip back through parseLoadIntent to `{kind:'corpus', …}` (guarded
// in load-intent.test.ts) so a refresh / popstate of the forwarded URL resolves
// to the same sheep.
export const HERO_GEN = 247;
export const HERO_ID = 19679;

export type LoadIntent =
  | { kind: 'corpus'; gen: number; id: number }
  | { kind: 'gen-list' }
  | { kind: 'gen-browse'; gen: number }
  | { kind: 'custom-reserved' }
  | { kind: 'default' };

/** Returns true iff the segment is a string of one-or-more decimal digits. */
function isNonNegInt(segment: string): boolean {
  return /^\d+$/.test(segment);
}

export function parseLoadIntent(loc: { pathname: string }): LoadIntent {
  // Strip the Vite base prefix so the /v1 grammar matches on a project-Pages
  // site (pathname is "/pyr3/v1/..." there) as well as an apex domain
  // (base "/", pathname "/v1/..."). import.meta.env.BASE_URL always ends "/".
  let pathname = loc.pathname;
  const base = import.meta.env.BASE_URL;
  if (base && base !== '/') {
    const prefix = base.replace(/\/$/, ''); // "/pyr3"
    if (pathname === prefix) pathname = '/';
    else if (pathname.startsWith(prefix + '/')) pathname = pathname.slice(prefix.length);
  }

  // Strip a single leading and trailing slash, then split.
  // e.g. "/v1/gen/247/id/12345" → ["v1", "gen", "247", "id", "12345"]
  // e.g. "/v1/gen/" → ["v1", "gen"]  (trailing empty segment removed)
  const stripped = pathname.replace(/^\//, '').replace(/\/$/, '');
  const parts = stripped.length === 0 ? [] : stripped.split('/');

  // Only handle /v1/... paths
  if (parts[0] === 'v1') {
    const sub = parts[1]; // may be undefined

    if (sub === 'gen') {
      // /v1/gen
      if (parts.length === 2) {
        return { kind: 'gen-list' };
      }
      // /v1/gen/{gen}
      if (parts.length === 3 && isNonNegInt(parts[2]!)) {
        return { kind: 'gen-browse', gen: Number(parts[2]) };
      }
      // /v1/gen/{gen}/id/{id}
      if (
        parts.length === 5 &&
        isNonNegInt(parts[2]!) &&
        parts[3] === 'id' &&
        isNonNegInt(parts[4]!)
      ) {
        return { kind: 'corpus', gen: Number(parts[2]), id: Number(parts[4]) };
      }
      // Malformed — fall through
    } else if (sub === 'flame') {
      // /v1/flame/... (any remainder)
      if (parts.length >= 3) {
        return { kind: 'custom-reserved' };
      }
      // /v1/flame with nothing after — fall through
    }
    // Any other /v1/... or bare /v1 — fall through to default.
  }

  return { kind: 'default' };
}

/**
 * Canonical base-aware corpus share URL for a sheep. Single source of truth for
 * the `/v1/gen/{gen}/id/{id}` route shape (parsed by parseLoadIntent above) —
 * used by both the pushState navigation and the action-bar nav pills so they
 * can never drift from the parser.
 */
export function corpusUrl(gen: number, id: number): string {
  return `${import.meta.env.BASE_URL}v1/gen/${gen}/id/${id}`;
}
