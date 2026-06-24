import { describe, it, expect } from 'vitest';
import { redirectLegacyPath } from './route-redirects';

describe('redirectLegacyPath (#264)', () => {
  // #449 — legacy /v1/* repointed straight at the flat routes (/browse, /gallery).
  it('/v1 → /browse', () => expect(redirectLegacyPath('/v1', '')).toBe('/browse'));
  it('/v1/viewer → /browse', () => expect(redirectLegacyPath('/v1/viewer', '')).toBe('/browse'));
  it('/v1/gen/247/id/19679 → /browse/gen/247/id/19679', () =>
    expect(redirectLegacyPath('/v1/gen/247/id/19679', '')).toBe('/browse/gen/247/id/19679'));
  it('/v1/gallery → /gallery', () => expect(redirectLegacyPath('/v1/gallery', '')).toBe('/gallery'));
  it('/v1/gallery/p/3 → /gallery/p/3', () =>
    expect(redirectLegacyPath('/v1/gallery/p/3', '')).toBe('/gallery/p/3'));
  it('preserves gallery query', () =>
    expect(redirectLegacyPath('/v1/gallery', '?sort=interest')).toBe('/gallery?sort=interest'));

  // #449 — old /esf/* flat URLs redirect to /browse + /gallery.
  it('/esf → /browse', () => expect(redirectLegacyPath('/esf', '')).toBe('/browse'));
  it('/esf/gen/247/id/19679 → /browse/gen/247/id/19679', () =>
    expect(redirectLegacyPath('/esf/gen/247/id/19679', '')).toBe('/browse/gen/247/id/19679'));
  it('/esf/gen/pyr3/id/118 → /browse/gen/pyr3/id/118', () =>
    expect(redirectLegacyPath('/esf/gen/pyr3/id/118', '')).toBe('/browse/gen/pyr3/id/118'));
  it('/esf/gallery → /gallery', () => expect(redirectLegacyPath('/esf/gallery', '')).toBe('/gallery'));
  it('/esf/gallery/p/3 → /gallery/p/3', () =>
    expect(redirectLegacyPath('/esf/gallery/p/3', '')).toBe('/gallery/p/3'));
  it('/esf/gallery preserves query', () =>
    expect(redirectLegacyPath('/esf/gallery', '?sort=interest')).toBe('/gallery?sort=interest'));
  it('canonical /browse + /gallery → null (no redirect)', () => {
    expect(redirectLegacyPath('/browse', '')).toBeNull();
    expect(redirectLegacyPath('/gallery', '')).toBeNull();
  });
  it('/v1/edit → /editor', () => expect(redirectLegacyPath('/v1/edit', '')).toBe('/editor'));
  it('/v1/edit?gen=1&id=2 → /editor?gen=1&id=2', () =>
    expect(redirectLegacyPath('/v1/edit', '?gen=1&id=2')).toBe('/editor?gen=1&id=2'));
  // #372 — /gradient retired; both the flat route and the legacy /v1 form land in /editor.
  it('/gradient → /editor', () => expect(redirectLegacyPath('/gradient', '')).toBe('/editor'));
  it('/v1/gradient → /editor', () => expect(redirectLegacyPath('/v1/gradient', '')).toBe('/editor'));
  it('/gradient preserves search + hash', () =>
    expect(redirectLegacyPath('/gradient', '?gen=1', '#x')).toBe('/editor?gen=1#x'));
  it('/v1/animate → /animate', () => expect(redirectLegacyPath('/v1/animate', '')).toBe('/animate'));
  it('/v1/screensaver → /screensaver', () => expect(redirectLegacyPath('/v1/screensaver', '')).toBe('/screensaver'));
  it('/v1/variations → /variations', () => expect(redirectLegacyPath('/v1/variations', '')).toBe('/variations'));
  it('/v1/surprise → /creator', () => expect(redirectLegacyPath('/v1/surprise', '')).toBe('/creator'));
  // Creator page route renamed /surprise → /creator; old flat path redirects.
  it('/surprise → /creator', () => expect(redirectLegacyPath('/surprise', '')).toBe('/creator'));
  it('/surprise preserves search + hash', () =>
    expect(redirectLegacyPath('/surprise', '?x=1', '#y')).toBe('/creator?x=1#y'));
  it('canonical /creator → null', () => expect(redirectLegacyPath('/creator', '')).toBeNull());
  it('already-new path → null', () => expect(redirectLegacyPath('/editor', '')).toBeNull());
  it('/about (unchanged) → null', () => expect(redirectLegacyPath('/about', '')).toBeNull());

  // #347 — poppy no-hyphen alias for the interactive guide page.
  it('/howitworks → /how-it-works', () => expect(redirectLegacyPath('/howitworks', '', '')).toBe('/how-it-works'));
  it('/howitworks preserves search + hash', () =>
    expect(redirectLegacyPath('/howitworks', '?x=1', '#chaos-game')).toBe('/how-it-works?x=1#chaos-game'));
  it('canonical /how-it-works → null', () => expect(redirectLegacyPath('/how-it-works', '', '')).toBeNull());
  it('bare / → null', () => expect(redirectLegacyPath('/', '')).toBeNull());

  // #299 — the deep-link hash must survive the rewrite (variation catalog anchor).
  it('preserves the hash anchor', () =>
    expect(redirectLegacyPath('/v1/variations', '', '#julia')).toBe('/variations#julia'));
  it('preserves search AND hash together', () =>
    expect(redirectLegacyPath('/v1/edit', '?gen=1', '#x')).toBe('/editor?gen=1#x'));
  it('empty hash appends nothing', () =>
    expect(redirectLegacyPath('/v1/variations', '')).toBe('/variations'));
});
