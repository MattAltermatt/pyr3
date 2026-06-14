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
  it('/v1/gradient → /gradient', () => expect(redirectLegacyPath('/v1/gradient', '')).toBe('/gradient'));
  it('/v1/animate → /animate', () => expect(redirectLegacyPath('/v1/animate', '')).toBe('/animate'));
  it('/v1/screensaver → /screensaver', () => expect(redirectLegacyPath('/v1/screensaver', '')).toBe('/screensaver'));
  it('/v1/variations → /variations', () => expect(redirectLegacyPath('/v1/variations', '')).toBe('/variations'));
  it('already-new path → null', () => expect(redirectLegacyPath('/editor', '')).toBeNull());
  it('/about (unchanged) → null', () => expect(redirectLegacyPath('/about', '')).toBeNull());
  it('bare / → null', () => expect(redirectLegacyPath('/', '')).toBeNull());
});
