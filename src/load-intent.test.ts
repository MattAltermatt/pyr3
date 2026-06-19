import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  corpusUrl,
  editorUrlForFlame,
  GALLERY_PAGE_SIZE,
  galleryUrl,
  galleryUrlForFlame,
  HERO_GEN,
  HERO_ID,
  pageForCorpusIndex,
  parseLoadIntent,
  parsePreviewOverride,
  viewerUrl,
} from './load-intent';
import { DEFAULT_FILTER_SPEC } from './gallery-filter';
import { V } from './variations';

// Shorthand: p(pathname) → parseLoadIntent
const p = (pathname: string) => parseLoadIntent(pathname);

// ── flat route grammar (#264) ────────────────────────────────────────────

describe('parseLoadIntent — flat routes (#264)', () => {
  it('/viewer → basic viewer', () => {
    expect(p('/viewer')).toEqual({ kind: 'viewer' });
  });
  it('/editor → edit', () => {
    expect(p('/editor')).toEqual({ kind: 'edit' });
  });
  it('/gradient → gradient', () => {
    expect(p('/gradient')).toEqual({ kind: 'gradient' });
  });
  it('/animate → animate', () => {
    expect(p('/animate')).toEqual({ kind: 'animate' });
  });
  it('/screensaver → screensaver', () => {
    expect(p('/screensaver')).toEqual({ kind: 'screensaver' });
  });
  it('/variations → variations', () => {
    expect(p('/variations')).toEqual({ kind: 'variations' });
  });
  it('/esf → esf viewer (bare)', () => {
    expect(p('/esf')).toEqual({ kind: 'esf' });
  });
  it('/esf/gen/247/id/19679 → esf corpus leaf', () => {
    expect(p('/esf/gen/247/id/19679')).toEqual({ kind: 'corpus', gen: 247, id: 19679 });
  });
  it('/esf/gallery → gallery page 1', () => {
    const r = p('/esf/gallery');
    expect(r?.kind).toBe('gallery');
    expect((r as { page: number }).page).toBe(1);
  });
  it('/esf/gallery/p/3 → gallery page 3', () => {
    expect((p('/esf/gallery/p/3') as { page: number }).page).toBe(3);
  });
  it('/esf/gallery?sort=interest preserves filter parse', () => {
    const r = p('/esf/gallery?sort=interest');
    expect(r?.kind).toBe('gallery');
  });
});

// ── /v1 path grammar ─────────────────────────────────────────────────────

describe('parseLoadIntent – /v1 path grammar', () => {
  it('corpus leaf', () => {
    expect(p('/v1/gen/247/id/12345')).toEqual({ kind: 'corpus', gen: 247, id: 12345 });
  });

  it('gen list', () => {
    expect(p('/v1/gen')).toEqual({ kind: 'gen-list' });
  });

  it('gen list trailing slash', () => {
    expect(p('/v1/gen/')).toEqual({ kind: 'gen-list' });
  });

  it('gen browse', () => {
    expect(p('/v1/gen/247')).toEqual({ kind: 'gen-browse', gen: 247 });
  });

  it('custom reserved', () => {
    expect(p('/v1/flame/abc')).toEqual({ kind: 'custom-reserved' });
  });

  it('custom reserved – deeper path', () => {
    expect(p('/v1/flame/a/b/c')).toEqual({ kind: 'custom-reserved' });
  });

  it('root → default', () => {
    expect(p('/')).toEqual({ kind: 'default' });
  });

  it('garbage gen/id → default', () => {
    expect(p('/v1/gen/abc/id/x')).toEqual({ kind: 'default' });
  });

  it('non-v1 path → default', () => {
    expect(p('/about.html')).toEqual({ kind: 'default' });
  });

  it('unrecognized /v1 path → default', () => {
    expect(p('/v1/unknown/path')).toEqual({ kind: 'default' });
  });

  it('gen 0 is valid (non-negative integer)', () => {
    expect(p('/v1/gen/0')).toEqual({ kind: 'gen-browse', gen: 0 });
  });

  it('id 0 is valid', () => {
    expect(p('/v1/gen/248/id/0')).toEqual({ kind: 'corpus', gen: 248, id: 0 });
  });

  it('negative gen falls through to default', () => {
    expect(p('/v1/gen/-1')).toEqual({ kind: 'default' });
  });

  it('float gen falls through to default', () => {
    expect(p('/v1/gen/1.5')).toEqual({ kind: 'default' });
  });

  it('extra segments after gen/id → default', () => {
    expect(p('/v1/gen/247/id/12345/extra')).toEqual({ kind: 'default' });
  });

  it('/v1 itself (no subpath) → default', () => {
    expect(p('/v1')).toEqual({ kind: 'default' });
  });

  it('/v1/ (trailing slash only) → default', () => {
    expect(p('/v1/')).toEqual({ kind: 'default' });
  });
});

// ── Base-prefix stripping (project-Pages /pyr3/ deploy) ──────────────────
// On the live project-Pages site the pathname is "/pyr3/v1/...". parseLoadIntent
// strips import.meta.env.BASE_URL before matching. (In the default test env
// BASE_URL is "/", so the regular cases above already cover the apex base.)

describe('parseLoadIntent – under a non-root base (/pyr3/)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('strips the /pyr3 base prefix before matching /v1', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    expect(p('/pyr3/v1/gen/247/id/12345')).toEqual({ kind: 'corpus', gen: 247, id: 12345 });
    expect(p('/pyr3/v1/gen')).toEqual({ kind: 'gen-list' });
    expect(p('/pyr3/v1/gen/247')).toEqual({ kind: 'gen-browse', gen: 247 });
  });

  it('maps the base root (with and without trailing slash) to default', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    expect(p('/pyr3/')).toEqual({ kind: 'default' });
    expect(p('/pyr3')).toEqual({ kind: 'default' });
  });
});

// ── hero-forward round-trip ──────────────────────────────────────────────
// #339: bare root now lands on the pyr3-native hero (/viewer, no forward). The
// `/esf` corpus entry still forwards to corpusUrl(HERO_GEN, HERO_ID) via
// replaceState. That URL MUST parse back as the hero corpus leaf so a refresh /
// popstate of the forwarded address resolves to the same sheep (not a 'default'
// loop or a malformed fall-through). Guards both the apex and project-Pages base.

describe('hero-forward target round-trips through the parser', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('apex base: corpusUrl(HERO) parses back to the hero corpus leaf', () => {
    const url = corpusUrl(HERO_GEN, HERO_ID); // BASE_URL '/' in the default env
    expect(p(url)).toEqual({ kind: 'corpus', gen: HERO_GEN, id: HERO_ID });
  });

  it('project-Pages base: corpusUrl(HERO) parses back to the hero corpus leaf', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    const url = corpusUrl(HERO_GEN, HERO_ID); // '/pyr3/v1/gen/247/id/19679'
    expect(p(url)).toEqual({ kind: 'corpus', gen: HERO_GEN, id: HERO_ID });
  });
});

// ── /v1/gallery grammar ──────────────────────────────────────────────────
// Gallery URLs: `/v1/gallery` (page 1 canonical) and `/v1/gallery/p/N` for
// N ≥ 2. Page 1 has no `/p/1` suffix on the canonical share URL. Malformed
// variants (page 0, non-numeric, junk segments) fall through to default —
// the parser never throws.

describe('parseLoadIntent – /v1/gallery grammar', () => {
  it('parses /v1/gallery as page 1', () => {
    expect(p('/v1/gallery')).toEqual({ kind: 'gallery', page: 1, filter: DEFAULT_FILTER_SPEC });
  });

  it('parses /v1/gallery/ (trailing slash) as page 1', () => {
    expect(p('/v1/gallery/')).toEqual({ kind: 'gallery', page: 1, filter: DEFAULT_FILTER_SPEC });
  });

  it('parses /v1/gallery/p/27 as page 27', () => {
    expect(p('/v1/gallery/p/27')).toEqual({ kind: 'gallery', page: 27, filter: DEFAULT_FILTER_SPEC });
  });

  it('parses /v1/gallery/p/1 as page 1 (non-canonical but accepted)', () => {
    expect(p('/v1/gallery/p/1')).toEqual({ kind: 'gallery', page: 1, filter: DEFAULT_FILTER_SPEC });
  });

  it('rejects /v1/gallery/p/0 (1-indexed) as default', () => {
    expect(p('/v1/gallery/p/0')).toEqual({ kind: 'default' });
  });

  it('rejects /v1/gallery/p/abc as default', () => {
    expect(p('/v1/gallery/p/abc')).toEqual({ kind: 'default' });
  });

  it('rejects /v1/gallery/junk/p/3 as default', () => {
    expect(p('/v1/gallery/junk/p/3')).toEqual({ kind: 'default' });
  });

  it('rejects /v1/gallery/p (no number) as default', () => {
    expect(p('/v1/gallery/p')).toEqual({ kind: 'default' });
  });
});

// ── galleryUrl + pageForCorpusIndex ──────────────────────────────────────

describe('galleryUrl', () => {
  it('page 1 produces the bare /esf/gallery URL', () => {
    expect(galleryUrl(1)).toMatch(/esf\/gallery$/);
  });

  it('page 0 and negatives also collapse to the bare URL (clamped)', () => {
    expect(galleryUrl(0)).toMatch(/esf\/gallery$/);
    expect(galleryUrl(-5)).toMatch(/esf\/gallery$/);
  });

  it('page ≥ 2 includes the /p/N suffix', () => {
    expect(galleryUrl(2)).toMatch(/esf\/gallery\/p\/2$/);
    expect(galleryUrl(27)).toMatch(/esf\/gallery\/p\/27$/);
    expect(galleryUrl(5778)).toMatch(/esf\/gallery\/p\/5778$/);
  });

  it('round-trips through parseLoadIntent for typical pages', () => {
    for (const page of [1, 2, 27, 5778]) {
      const url = galleryUrl(page);
      const pathname = new URL(url, 'http://x/').pathname;
      expect(parseLoadIntent(pathname)).toEqual({
        kind: 'gallery',
        page,
        filter: DEFAULT_FILTER_SPEC,
      });
    }
  });

  it('honors a non-root base prefix', () => {
    vi.stubEnv('BASE_URL', '/pyr3/');
    expect(galleryUrl(1)).toMatch(/\/pyr3\/esf\/gallery$/);
    expect(galleryUrl(27)).toMatch(/\/pyr3\/esf\/gallery\/p\/27$/);
    vi.unstubAllEnvs();
  });
});

describe('pageForCorpusIndex', () => {
  it.each([
    [0, 1],
    [8, 1],
    [9, 2],
    [17, 2],
    [18, 3],
    [243, 28],
  ])('index %i → page %i (default perPage=9)', (idx, expected) => {
    expect(pageForCorpusIndex(idx)).toBe(expected);
  });

  it('honors a custom perPage', () => {
    expect(pageForCorpusIndex(0, 3)).toBe(1);
    expect(pageForCorpusIndex(2, 3)).toBe(1);
    expect(pageForCorpusIndex(3, 3)).toBe(2);
    expect(pageForCorpusIndex(8, 3)).toBe(3);
  });

  it('GALLERY_PAGE_SIZE constant is 9 (3×3 grid)', () => {
    expect(GALLERY_PAGE_SIZE).toBe(9);
  });
});

// ── gallery filter URL handling (#49 Task A4) ────────────────────────────

describe('parseLoadIntent — gallery filter', () => {
  it('/v1/gallery → page 1, default filter', () => {
    const i = parseLoadIntent('/v1/gallery');
    expect(i).toEqual({ kind: 'gallery', page: 1, filter: DEFAULT_FILTER_SPEC });
  });

  it('/v1/gallery/p/3 → page 3, default filter', () => {
    const i = parseLoadIntent('/v1/gallery/p/3');
    expect(i).toEqual({ kind: 'gallery', page: 3, filter: DEFAULT_FILTER_SPEC });
  });

  it('/v1/gallery?sort=interest → page 1, interest sort', () => {
    const i = parseLoadIntent('/v1/gallery?sort=interest');
    expect(i?.kind).toBe('gallery');
    if (i?.kind === 'gallery') {
      expect(i.page).toBe(1);
      expect(i.filter.sort).toBe('interest');
    }
  });

  it('/v1/gallery/p/3?vars=julia → page 3, julia filter', () => {
    const i = parseLoadIntent('/v1/gallery/p/3?vars=julia');
    expect(i?.kind).toBe('gallery');
    if (i?.kind === 'gallery') {
      expect(i.page).toBe(3);
      expect(i.filter.vars).toEqual([V.julia]);
    }
  });
});

// ── /v1/edit grammar ─────────────────────────────────────────────────────
// Single-flame editor route — bare /v1/edit only; anything deeper falls
// through to default per the spec's "v1 single-page" scope.

describe('parseLoadIntent – /v1/edit grammar', () => {
  it('parses /v1/edit', () => {
    expect(p('/v1/edit')).toEqual({ kind: 'edit' });
  });

  it('parses /v1/edit/ (trailing slash)', () => {
    expect(p('/v1/edit/')).toEqual({ kind: 'edit' });
  });

  it('/v1/edit/anything → default (deeper paths not yet defined)', () => {
    expect(p('/v1/edit/foo')).toEqual({ kind: 'default' });
    expect(p('/v1/edit/sub/path')).toEqual({ kind: 'default' });
  });

  // #119 — catalog → editor deep-link
  it('/v1/edit?from=catalog&v=14&w=0.8&p=5,0.7 → catalog-entry intent', () => {
    expect(p('/v1/edit?from=catalog&v=14&w=0.8&p=5,0.7')).toEqual({
      kind: 'catalog-entry',
      entry: { idx: 14, weight: 0.8, params: [5, 0.7] },
    });
  });

  it('/v1/edit?from=catalog&v=0&w=1 → catalog-entry with no params', () => {
    expect(p('/v1/edit?from=catalog&v=0&w=1')).toEqual({
      kind: 'catalog-entry',
      entry: { idx: 0, weight: 1, params: [] },
    });
  });

  it('/v1/edit?from=other (foreign query) → bare edit intent', () => {
    expect(p('/v1/edit?from=other&v=14')).toEqual({ kind: 'edit' });
  });

  it('/v1/edit?from=catalog with malformed v → bare edit intent', () => {
    expect(p('/v1/edit?from=catalog&v=abc')).toEqual({ kind: 'edit' });
  });
});

// #119
describe('parseLoadIntent – /v1/variations grammar', () => {
  it('parses /v1/variations', () => {
    expect(p('/v1/variations')).toEqual({ kind: 'variations' });
  });

  it('parses /v1/variations/ (trailing slash)', () => {
    expect(p('/v1/variations/')).toEqual({ kind: 'variations' });
  });

  it('/v1/variations/anything → default', () => {
    expect(p('/v1/variations/foo')).toEqual({ kind: 'default' });
  });
});

describe('parseLoadIntent – /v1/viewer grammar (#203)', () => {
  it('parses /v1/viewer', () => {
    expect(p('/v1/viewer')).toEqual({ kind: 'viewer' });
  });

  it('parses /v1/viewer/ (trailing slash)', () => {
    expect(p('/v1/viewer/')).toEqual({ kind: 'viewer' });
  });

  it('/v1/viewer/anything → default', () => {
    expect(p('/v1/viewer/foo')).toEqual({ kind: 'default' });
  });
});

describe('viewerUrl — round-trips through the parser (#203)', () => {
  it('apex base: viewerUrl() parses back to {kind:"viewer"}', () => {
    const url = viewerUrl(); // BASE_URL '/' in the default env → '/viewer'
    expect(url).toMatch(/\/viewer$/);
    expect(parseLoadIntent(url)).toEqual({ kind: 'viewer' });
  });
});

describe('galleryUrl — filter round-trip', () => {
  it('default filter → bare /esf/gallery', () => {
    expect(galleryUrl(1)).toMatch(/esf\/gallery$/);
  });

  it('default filter, page 3 → /esf/gallery/p/3 (no querystring)', () => {
    expect(galleryUrl(3, DEFAULT_FILTER_SPEC)).toMatch(/esf\/gallery\/p\/3$/);
  });

  it('non-default filter on page 1 emits /esf/gallery?...', () => {
    const url = galleryUrl(1, { ...DEFAULT_FILTER_SPEC, sort: 'interest' });
    expect(url).toMatch(/esf\/gallery\?sort=interest$/);
  });

  it('non-default filter on page 3 emits /esf/gallery/p/3?...', () => {
    const url = galleryUrl(3, { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [V.julia] });
    expect(url).toMatch(/esf\/gallery\/p\/3\?sort=interest&vars=julia$/);
  });
});

describe('tab-navigation URL helpers', () => {
  it('editorUrlForFlame returns /editor?gen=&id= when corpusId present', () => {
    expect(editorUrlForFlame({ gen: 198, id: 7372 })).toBe('/editor?gen=198&id=7372');
  });

  it('editorUrlForFlame returns bare /editor when no corpusId', () => {
    expect(editorUrlForFlame(undefined)).toBe('/editor');
  });

  it('galleryUrlForFlame returns /esf/gallery/p/N where N contains the corpusId', () => {
    // assuming page size 9; flame at corpus-list index 124 → page 14
    expect(galleryUrlForFlame({ gen: 198, id: 7372 }, 124)).toBe('/esf/gallery/p/14');
  });
});

// ── #176 — parsePreviewOverride ────────────────────────────────────────────
describe('parsePreviewOverride', () => {
  it('returns undefined when no recognised param', () => {
    expect(parsePreviewOverride('')).toBeUndefined();
    expect(parsePreviewOverride('?foo=bar')).toBeUndefined();
  });
  it('?preview=fast → { tier: fast }', () => {
    expect(parsePreviewOverride('?preview=fast')).toEqual({ tier: 'fast' });
  });
  it('?preview=balanced → { tier: balanced }', () => {
    expect(parsePreviewOverride('?preview=balanced')).toEqual({ tier: 'balanced' });
  });
  it('?preview=sharp → { tier: sharp }', () => {
    expect(parsePreviewOverride('?preview=sharp')).toEqual({ tier: 'sharp' });
  });
  it('?preview=garbage → ignored (undefined)', () => {
    expect(parsePreviewOverride('?preview=turbo')).toBeUndefined();
  });
  it('?previewQ=30 → { quality: 30 }', () => {
    expect(parsePreviewOverride('?previewQ=30')).toEqual({ quality: 30 });
  });
  it('?previewQ=999 clamps to 50', () => {
    expect(parsePreviewOverride('?previewQ=999')).toEqual({ quality: 50 });
  });
  it('?previewQ=5 clamps to 10', () => {
    expect(parsePreviewOverride('?previewQ=5')).toEqual({ quality: 10 });
  });
  it('?previewQ=NaN → ignored', () => {
    expect(parsePreviewOverride('?previewQ=foo')).toBeUndefined();
  });
  it('?preview=sharp&previewQ=50 → both set', () => {
    expect(parsePreviewOverride('?preview=sharp&previewQ=50')).toEqual({ tier: 'sharp', quality: 50 });
  });
  it('?quick=1 → { tier: fast, quality: 10 }', () => {
    expect(parsePreviewOverride('?quick=1')).toEqual({ tier: 'fast', quality: 10 });
  });
  it('?quick=1 + ?preview=sharp → explicit preview wins', () => {
    expect(parsePreviewOverride('?quick=1&preview=sharp')).toEqual({ tier: 'sharp', quality: 10 });
  });
  it('?quick=1 + ?previewQ=40 → explicit quality wins', () => {
    expect(parsePreviewOverride('?quick=1&previewQ=40')).toEqual({ tier: 'fast', quality: 40 });
  });
  it('?quick=0 → ignored', () => {
    expect(parsePreviewOverride('?quick=0')).toBeUndefined();
  });
});

describe('URL builders emit flat routes (#264)', () => {
  it('corpusUrl → /esf/gen/.. and round-trips', () => {
    const u = corpusUrl(247, 19679);
    expect(u.endsWith('/esf/gen/247/id/19679')).toBe(true);
    expect(parseLoadIntent(u)).toEqual({ kind: 'corpus', gen: 247, id: 19679 });
  });
  it('viewerUrl → /viewer and round-trips', () => {
    expect(viewerUrl().endsWith('/viewer')).toBe(true);
    expect(parseLoadIntent(viewerUrl())).toEqual({ kind: 'viewer' });
  });
  it('galleryUrl(1) → /esf/gallery', () => {
    expect(galleryUrl(1).endsWith('/esf/gallery')).toBe(true);
  });
  it('galleryUrl(3) → /esf/gallery/p/3', () => {
    expect(galleryUrl(3).endsWith('/esf/gallery/p/3')).toBe(true);
  });
  it('editorUrlForFlame embeds gen/id at /editor', () => {
    expect(editorUrlForFlame({ gen: 1, id: 2 })).toBe('/editor?gen=1&id=2');
    expect(editorUrlForFlame()).toBe('/editor');
  });
});
