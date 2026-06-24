// What pyr3 should load when the page boots. Driven by the flat path grammar
// (#264): flat routes are canonical — /viewer, /editor, /animate, /screensaver,
// /variations, /creator, /esf/... — with corpus leaves under
// /esf/gen/{gen}/id/{id} (gen, id are non-negative integers). The legacy
// ?flame=<encoded> share-link codec was removed in v0.32 (see PYR3-020).
//
// /v1/* is a LEGACY boot-redirect fallback only (src/route-redirects.ts maps old
// /v1/* URLs onto the flat surfaces); new URLs use the flat grammar.
//
// Absent a recognized path → default (main.ts resolves to the hardcoded welcome
// flame). Malformed paths never throw — they fall through to default.

import {
  encodeFilterSpec,
  parseFilterSpec,
  type FilterSpec,
} from './gallery-filter';
import { parseCatalogEntry, type CatalogEntry } from './variation-catalog-link';
import { formatGenLabel, parseGenSegment } from './native-gen';

// The ESF corpus viewer's landing sheep. #339 moved the bare-root hero to a
// pyr3-native flame (see WELCOME_FLAME_URL in main.ts); `/esf` still lands here
// because the corpus browser needs a real sheep with ‹ › neighbours to walk.
// `loadHeroFallback` replaceStates to this corpus leaf (a real, shareable,
// nav-wired URL) while painting the bundled fixture for an instant, chunk-free
// first paint. corpusUrl(HERO_*) MUST round-trip back through parseLoadIntent to
// `{kind:'corpus', …}` (guarded in load-intent.test.ts) so a refresh / popstate
// of the forwarded URL resolves to the same sheep.
export const HERO_GEN = 247;
export const HERO_ID = 19679;

export type LoadIntent =
  | { kind: 'corpus'; gen: number; id: number }
  | { kind: 'gen-list' }
  | { kind: 'gen-browse'; gen: number }
  | { kind: 'gallery'; page: number; filter: FilterSpec }
  | { kind: 'edit' }
  | { kind: 'catalog-entry'; entry: CatalogEntry }
  | { kind: 'variations' }
  | { kind: 'surprise' }
  | { kind: 'viewer' }
  | { kind: 'animate' }
  | { kind: 'screensaver' }
  | { kind: 'esf' }
  | { kind: 'custom-reserved' }
  | { kind: 'default' };

/** Single source of truth for the gallery grid size (3×3). Used by URL math,
 *  the corpus walker that resolves a page's 9 sheep, and any future caller. */
export const GALLERY_PAGE_SIZE = 9;

/**
 * Categorized canvas-size presets surfaced by the viewer/editor `📐 Size ▾`
 * dropdown (#103 Phase 3 Task 3.2). Each item carries an explicit width+
 * height pair. The viewer's render-quality dispatch only consumes the long
 * edge today (genome aspect drives the short edge via applyPreset); the
 * explicit w/h pair is kept for the label and any future explicit-dims
 * dispatch path. "⚙ Custom size & quality → open in Editor" footer link
 * defers explicit-aspect picks to the editor surface.
 */
export const SIZE_PRESETS = [
  { group: 'Common', items: [
    { label: 'HD',                  w: 1920, h: 1080 },
    { label: '2K',                  w: 2560, h: 1440 },
    { label: '4K',                  w: 3840, h: 2160 },
    { label: 'square',              w: 1080, h: 1080 },
  ]},
  { group: 'Phone portrait', items: [
    { label: 'iPhone 15 Pro',       w: 1290, h: 2796 },
    { label: 'iPhone 14 Pro Max',   w: 1284, h: 2778 },
    { label: 'FHD portrait',        w: 1080, h: 1920 },
    { label: 'Pixel 8 Pro',         w: 1440, h: 3120 },
  ]},
  { group: 'Tablet', items: [
    { label: 'iPad Pro 11"',        w: 1668, h: 2388 },
    { label: 'iPad Pro 12.9"',      w: 2048, h: 2732 },
  ]},
] as const;

/** Render-quality presets surfaced by the viewer/editor `QUALITY 10·25·50·75·
 *  100` numeric button group (#103 Phase 3 Task 3.2). Values are SPP (samples
 *  per pixel) — dispatched as `kind: 'custom'` requests through the existing
 *  onRenderQuality API; the current size's long edge is preserved on each
 *  pick. */
export const QUALITY_PRESETS = [10, 25, 50, 75, 100] as const;

/** #176 — preview-side overrides parsed from URL search params. Session-only
 *  (NOT persisted to localStorage); callers apply on mount + ignore on later
 *  navigations.
 *
 *  Recognised params:
 *    ?preview=fast|balanced|sharp   — sets tier
 *    ?previewQ=N                    — sets quality (clamped [10,50])
 *    ?quick=1                       — back-compat: maps to { tier: 'fast', quality: 10 }
 *
 *  When ?quick=1 is combined with ?preview / ?previewQ, the explicit params
 *  win (so a future share URL can quote ?quick=1 + ?preview=sharp without
 *  the legacy mapping clobbering the explicit tier). */
export interface PreviewOverride {
  tier?: 'fast' | 'balanced' | 'sharp';
  quality?: number;
}

const PREVIEW_VALID_TIERS: ReadonlyArray<'fast' | 'balanced' | 'sharp'> = ['fast', 'balanced', 'sharp'];

/** Parse PreviewOverride from a URL search string (e.g. "?preview=fast&previewQ=30").
 *  Returns undefined when no recognised param is present. */
export function parsePreviewOverride(searchString: string): PreviewOverride | undefined {
  const params = new URLSearchParams(searchString);
  let override: PreviewOverride | undefined;

  // ?quick=1 first — explicit params below override its values.
  if (params.get('quick') === '1') {
    override = { tier: 'fast', quality: 10 };
  }

  const previewParam = params.get('preview');
  if (previewParam && PREVIEW_VALID_TIERS.includes(previewParam as PreviewOverride['tier'] & string)) {
    override = { ...(override ?? {}), tier: previewParam as PreviewOverride['tier'] };
  }

  const previewQParam = params.get('previewQ');
  if (previewQParam) {
    const q = parseInt(previewQParam, 10);
    if (Number.isFinite(q)) {
      override = { ...(override ?? {}), quality: Math.max(10, Math.min(50, q)) };
    }
  }

  return override;
}

/** Settle-delay ladder (ms) for the editor bar's SETTLE button group.
 *  Quiet time after the user's last edit before the full-quality render
 *  fires — higher = the live (small-canvas) preview stays visible longer;
 *  lower = the settled high-quality render arrives sooner. Default 200
 *  matches the panel scrubby's default. Panel can override with any
 *  value 0..5000; bar shows no highlight on off-ladder values. */
export const SETTLE_PRESETS = [200, 500, 1000, 2000] as const;

/** Returns true iff the segment is a string of one-or-more decimal digits. */
function isNonNegInt(segment: string): boolean {
  return /^\d+$/.test(segment);
}

export function parseLoadIntent(input: string): LoadIntent | null {
  // Accept either a bare pathname ("/v1/gallery") or path+search
  // ("/v1/gallery?sort=interest"); a synthetic base lets new URL() parse both.
  // Malformed input that URL can't even tokenize → null (callers treat as default).
  let pathname: string;
  let search: string;
  try {
    const u = new URL(input, 'http://_');
    pathname = u.pathname;
    search = u.search;
  } catch {
    return null;
  }

  // Strip the Vite base prefix so the /v1 grammar matches on a project-Pages
  // site (pathname is "/pyr3/v1/..." there) as well as an apex domain
  // (base "/", pathname "/v1/..."). import.meta.env.BASE_URL always ends "/".
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

  // ── Flat route grammar (#264) ────────────────────────────────────────────
  // Tool-identity routes with no /v1 prefix. ESF corpus features live under an
  // /esf namespace (a genuine gen→id resource path); every other surface is a
  // single flat segment. Legacy /v1/* URLs are redirected to these at boot by
  // route-redirects.ts, but parse still tolerates /v1/* below for direct callers.
  const head = parts[0];
  if (head === 'viewer' && parts.length === 1) return { kind: 'viewer' };
  if (head === 'editor' && parts.length === 1) {
    // #119 catalog → editor deep-link (same query codec as the legacy /v1/edit).
    const entry = parseCatalogEntry(new URLSearchParams(search));
    if (entry) return { kind: 'catalog-entry', entry };
    return { kind: 'edit' };
  }
  if (head === 'animate' && parts.length === 1) return { kind: 'animate' };
  if (head === 'screensaver' && parts.length === 1) return { kind: 'screensaver' };
  if (head === 'variations' && parts.length === 1) return { kind: 'variations' };
  // Creator page: public route renamed /surprise → /creator (the internal
  // intent kind stays 'surprise'). /surprise is redirected to /creator at boot.
  if (head === 'creator' && parts.length === 1) return { kind: 'surprise' };
  // #449 — flat routes: the corpus player lives at /browse (bare) + the corpus
  // leaf at /browse/gen/{gen}/id/{id}; the grid at /gallery (+ /gallery/p/N).
  // Old /esf/* URLs are rewritten to these at boot by route-redirects.ts.
  if (head === 'browse') {
    if (parts.length === 1) return { kind: 'esf' };
    if (
      parts[1] === 'gen' &&
      parts.length === 5 &&
      parts[3] === 'id' &&
      isNonNegInt(parts[4]!)
    ) {
      // gen segment is numeric for ESF, or "pyr3" for the native gen (#435).
      const gen = parseGenSegment(parts[2]!);
      if (gen !== null) return { kind: 'corpus', gen, id: Number(parts[4]) };
    }
    // Malformed /browse/... — fall through to default.
  }
  if (head === 'gallery') {
    const filter = parseFilterSpec(new URLSearchParams(search));
    if (parts.length === 1) return { kind: 'gallery', page: 1, filter };
    if (
      parts.length === 3 &&
      parts[1] === 'p' &&
      isNonNegInt(parts[2]!) &&
      Number(parts[2]) >= 1
    ) {
      return { kind: 'gallery', page: Number(parts[2]), filter };
    }
    // Malformed /gallery/... — fall through to default.
  }

  // Only handle /v1/... paths (legacy — redirected at boot, kept for direct parse)
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
    } else if (sub === 'edit') {
      // /v1/edit — single-flame editor page (spec 2026-06-03-flame-editor-v1-design.md)
      if (parts.length === 2) {
        // #119 — catalog → editor deep-link. The catalog's "Open in editor"
        // link encodes the live variation state in the query; the editor's
        // cold-start (in mountEditPage) consumes it to rebuild a matching
        // sierpinski + variation genome. Malformed query falls through to
        // the bare edit intent.
        const entry = parseCatalogEntry(new URLSearchParams(search));
        if (entry) return { kind: 'catalog-entry', entry };
        return { kind: 'edit' };
      }
      // Malformed (/v1/edit/anything) — fall through to default
    } else if (sub === 'viewer') {
      // /v1/viewer — generic viewer surface for a locally-loaded (non-corpus)
      // flame (#203). Cold start rehydrates the genome from the `pyr3-last-flame`
      // store (src/last-flame-store.ts); absent that, falls back to the hero
      // sheep. Bare /v1/viewer only; deeper paths fall through to default.
      if (parts.length === 2) {
        return { kind: 'viewer' };
      }
      // Malformed (/v1/viewer/anything) — fall through to default
    } else if (sub === 'variations') {
      // #119 — variation catalog page. Bare /v1/variations only; deeper
      // paths fall through to default. Deep-link to a specific variation
      // is handled by hash (#v14-julian), not by the path grammar.
      if (parts.length === 2) {
        return { kind: 'variations' };
      }
    } else if (sub === 'gallery') {
      const filter = parseFilterSpec(new URLSearchParams(search));
      // /v1/gallery → page 1 (canonical default — no /p/1 suffix)
      if (parts.length === 2) {
        return { kind: 'gallery', page: 1, filter };
      }
      // /v1/gallery/p/{page} — 1-indexed; /p/0 and non-numeric fall through
      if (
        parts.length === 4 &&
        parts[2] === 'p' &&
        isNonNegInt(parts[3]!) &&
        Number(parts[3]) >= 1
      ) {
        return { kind: 'gallery', page: Number(parts[3]), filter };
      }
      // Malformed — fall through
    }
    // Any other /v1/... or bare /v1 — fall through to default.
  }

  return { kind: 'default' };
}

/**
 * Canonical base-aware corpus share URL for a sheep. Single source of truth for
 * the flat `/browse/gen/{gen}/id/{id}` route shape (#449, parsed by
 * parseLoadIntent above) — used by both the pushState navigation and the
 * action-bar nav pills so they can never drift from the parser.
 */
export function corpusUrl(gen: number, id: number): string {
  // gen segment is "pyr3" for the native gen, numeric for ESF (#435).
  return `${import.meta.env.BASE_URL}browse/gen/${formatGenLabel(gen)}/id/${id}`;
}

/**
 * Canonical base-aware flat `/viewer` URL (#203, flattened in #264). The viewer
 * routes here when a local (non-corpus) flame is loaded; on refresh the surface
 * rehydrates the genome from the `pyr3-last-flame` store. Round-trips through
 * parseLoadIntent to `{kind:'viewer'}` (guarded in load-intent.test.ts).
 */
export function viewerUrl(): string {
  return `${import.meta.env.BASE_URL}viewer`;
}

/**
 * Canonical base-aware gallery share URL. Page 1 produces the bare
 * `/gallery` URL (#449, no `/p/1` suffix); page ≥ 2 includes `/p/N`. Single
 * source of truth for the gallery route shape — round-trips through
 * parseLoadIntent (guarded in load-intent.test.ts). Mirrors corpusUrl's
 * relationship with the corpus route.
 */
export function galleryUrl(page: number, filter?: FilterSpec): string {
  const base =
    page <= 1
      ? `${import.meta.env.BASE_URL}gallery`
      : `${import.meta.env.BASE_URL}gallery/p/${page}`;
  if (!filter) return base;
  const qs = encodeFilterSpec(filter).toString();
  return qs.length === 0 ? base : `${base}?${qs}`;
}

/**
 * Which 1-indexed gallery page contains the sheep at `corpusIndex` (0-based
 * position in the cross-gen canonical walk). The caller (gallery-mount /
 * main.ts) computes `corpusIndex` via the corpus-bounds walker — this helper
 * stays free of corpus-fetch concerns so it can live in load-intent alongside
 * the URL grammar it serves.
 */
export function pageForCorpusIndex(corpusIndex: number, perPage = GALLERY_PAGE_SIZE): number {
  return Math.floor(corpusIndex / perPage) + 1;
}

/**
 * Tab-navigation URL helpers (2026-06-04 visual-overhaul § tab navigation
 * contract). When the viewer's currentFlame context is present, clicking the
 * Editor or Gallery tab transfers context: editorUrlForFlame embeds the
 * corpusId as query params so the editor preloads it; galleryUrlForFlame
 * resolves the page that contains the flame so the gallery centers on it.
 *
 * These helpers are intentionally framework-agnostic (`/editor` / `/gallery`
 * are the locked flat surface paths, #449) — they do NOT touch
 * import.meta.env.BASE_URL because the consumers (main.ts handleTabClick)
 * navigate via window.location.href which is base-aware on its own.
 */
export function editorUrlForFlame(corpusId?: { gen: number; id: number }): string {
  if (!corpusId) return '/editor';
  return `/editor?gen=${corpusId.gen}&id=${corpusId.id}`;
}

export function galleryUrlForFlame(
  _corpusId: { gen: number; id: number },
  flameCorpusIndex: number,
): string {
  const page = pageForCorpusIndex(flameCorpusIndex);
  return `/gallery/p/${page}`;
}
