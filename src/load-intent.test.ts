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
} from './load-intent';
import { DEFAULT_FILTER_SPEC } from './gallery-filter';
import { V } from './variations';

// Shorthand: p(pathname) → parseLoadIntent
const p = (pathname: string) => parseLoadIntent(pathname);

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
// Bare root forwards to corpusUrl(HERO_GEN, HERO_ID) via replaceState. That URL
// MUST parse back as the hero corpus leaf so a refresh / popstate of the
// forwarded address resolves to the same sheep (not a 'default' loop or a
// malformed fall-through). Guards both the apex and project-Pages base.

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
  it('page 1 produces the bare /v1/gallery URL', () => {
    expect(galleryUrl(1)).toMatch(/v1\/gallery$/);
  });

  it('page 0 and negatives also collapse to the bare URL (clamped)', () => {
    expect(galleryUrl(0)).toMatch(/v1\/gallery$/);
    expect(galleryUrl(-5)).toMatch(/v1\/gallery$/);
  });

  it('page ≥ 2 includes the /p/N suffix', () => {
    expect(galleryUrl(2)).toMatch(/v1\/gallery\/p\/2$/);
    expect(galleryUrl(27)).toMatch(/v1\/gallery\/p\/27$/);
    expect(galleryUrl(5778)).toMatch(/v1\/gallery\/p\/5778$/);
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
    expect(galleryUrl(1)).toMatch(/\/pyr3\/v1\/gallery$/);
    expect(galleryUrl(27)).toMatch(/\/pyr3\/v1\/gallery\/p\/27$/);
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
});

describe('galleryUrl — filter round-trip', () => {
  it('default filter → bare /v1/gallery', () => {
    expect(galleryUrl(1)).toMatch(/v1\/gallery$/);
  });

  it('default filter, page 3 → /v1/gallery/p/3 (no querystring)', () => {
    expect(galleryUrl(3, DEFAULT_FILTER_SPEC)).toMatch(/v1\/gallery\/p\/3$/);
  });

  it('non-default filter on page 1 emits /v1/gallery?...', () => {
    const url = galleryUrl(1, { ...DEFAULT_FILTER_SPEC, sort: 'interest' });
    expect(url).toMatch(/v1\/gallery\?sort=interest$/);
  });

  it('non-default filter on page 3 emits /v1/gallery/p/3?...', () => {
    const url = galleryUrl(3, { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [V.julia] });
    expect(url).toMatch(/v1\/gallery\/p\/3\?sort=interest&vars=julia$/);
  });
});

describe('tab-navigation URL helpers', () => {
  it('editorUrlForFlame returns /v1/edit?gen=&id= when corpusId present', () => {
    expect(editorUrlForFlame({ gen: 198, id: 7372 })).toBe('/v1/edit?gen=198&id=7372');
  });

  it('editorUrlForFlame returns bare /v1/edit when no corpusId', () => {
    expect(editorUrlForFlame(undefined)).toBe('/v1/edit');
  });

  it('galleryUrlForFlame returns /showcase?page=N where N contains the corpusId', () => {
    // assuming page size 9; flame at corpus-list index 124 → page 14
    expect(galleryUrlForFlame({ gen: 198, id: 7372 }, 124)).toBe('/showcase?page=14');
  });
});
