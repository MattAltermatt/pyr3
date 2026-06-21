import { describe, it, expect } from 'vitest';
import { redirectLegacyPath } from './route-redirects';

describe('redirectLegacyPath (#264)', () => {
  it('/v1 → /esf', () => expect(redirectLegacyPath('/v1', '')).toBe('/esf'));
  it('/v1/viewer → /esf', () => expect(redirectLegacyPath('/v1/viewer', '')).toBe('/esf'));
  it('/v1/gen/247/id/19679 → /esf/gen/247/id/19679', () =>
    expect(redirectLegacyPath('/v1/gen/247/id/19679', '')).toBe('/esf/gen/247/id/19679'));
  it('/v1/gallery → /esf/gallery', () => expect(redirectLegacyPath('/v1/gallery', '')).toBe('/esf/gallery'));
  it('/v1/gallery/p/3 → /esf/gallery/p/3', () =>
    expect(redirectLegacyPath('/v1/gallery/p/3', '')).toBe('/esf/gallery/p/3'));
  it('preserves gallery query', () =>
    expect(redirectLegacyPath('/v1/gallery', '?sort=interest')).toBe('/esf/gallery?sort=interest'));
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
  it('/v1/surprise → /surprise', () => expect(redirectLegacyPath('/v1/surprise', '')).toBe('/surprise'));
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
