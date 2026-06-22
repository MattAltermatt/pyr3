// @vitest-environment happy-dom

import { describe, it, expect, afterEach } from 'vitest';
import {
  openNamingDialog,
  isPlaceholderName,
  formatSaveTimestamp,
  defaultFilenameBase,
} from './naming-dialog';

function modal(): HTMLElement {
  const m = document.querySelector('.pyr3-naming-dialog') as HTMLElement;
  if (!m) throw new Error('dialog not mounted');
  return m;
}
function field(role: string): HTMLInputElement | null {
  return document.querySelector(`.pyr3-naming-dialog [data-role="${role}"]`) as HTMLInputElement | null;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('isPlaceholderName', () => {
  it('is true for empty / whitespace / undefined / generated placeholders', () => {
    for (const n of ['', '   ', undefined, 'Untitled flame', 'untitled flame', 'Untitled', '  Untitled Flame  ']) {
      expect(isPlaceholderName(n)).toBe(true);
    }
  });
  it('is false for real, user/source names', () => {
    for (const n of ['ember', 'Spiral Galaxy', 'broccoli', 'Untitled Symphony']) {
      expect(isPlaceholderName(n)).toBe(false);
    }
  });
});

// #368 — save dialog falls back to a timestamped default filename when none entered.
describe('formatSaveTimestamp (#368)', () => {
  it('formats a Date as YYYYMMDD-HHMMSS, zero-padded, no colons', () => {
    // 2026-06-21 09:07:05 local
    expect(formatSaveTimestamp(new Date(2026, 5, 21, 9, 7, 5))).toBe('20260621-090705');
  });
  it('pads single-digit month/day/time parts', () => {
    expect(formatSaveTimestamp(new Date(2026, 0, 3, 0, 0, 0))).toBe('20260103-000000');
  });
});

describe('defaultFilenameBase (#368)', () => {
  const d = new Date(2026, 5, 21, 20, 1, 45); // → 20260621-200145
  it('uses the generic flame- prefix when nothing identifies the flame', () => {
    expect(defaultFilenameBase({}, d)).toBe('flame-20260621-200145');
    expect(defaultFilenameBase({ name: 'Untitled flame' }, d)).toBe('flame-20260621-200145');
  });
  it('incorporates the nick/source when present (dots preserved, fs-safe)', () => {
    expect(defaultFilenameBase({ nick: 'electricsheep.247.19679' }, d))
      .toBe('electricsheep.247.19679-20260621-200145');
  });
  it('falls back to a slug of a real flame name when there is no nick', () => {
    expect(defaultFilenameBase({ name: 'Crimson Bloom' }, d)).toBe('crimson-bloom-20260621-200145');
  });
  it('prefers nick over name', () => {
    expect(defaultFilenameBase({ name: 'Crimson Bloom', nick: 'mu' }, d)).toBe('mu-20260621-200145');
  });
});

describe('openNamingDialog — default filename fallback (#368)', () => {
  it('sets the computed default as the filename placeholder', () => {
    void openNamingDialog({ kind: 'render', seed: {}, ext: 'png' });
    expect(field('filename')!.placeholder).toMatch(/^flame-\d{8}-\d{6}$/);
  });

  it('Save with an empty filename resolves the placeholder default verbatim', async () => {
    const p = openNamingDialog({ kind: 'render', seed: {}, ext: 'png' });
    const fileI = field('filename')!;
    const expected = fileI.placeholder;
    expect(expected).toMatch(/^flame-\d{8}-\d{6}$/);
    (modal().querySelector('[data-role="save"]') as HTMLElement).click();
    await expect(p).resolves.toEqual({ name: '', nick: '', filename: expected });
  });

  it('placeholder reflects the nick of a real (non-fresh) flame', () => {
    // A real name keeps the identity fields populated (#362); the nick then
    // drives the default-filename prefix.
    void openNamingDialog({
      kind: 'render',
      seed: { name: 'Sheep 19679', nick: 'electricsheep.247.19679', filename: '' },
      ext: 'png',
    });
    expect(field('filename')!.placeholder).toMatch(/^electricsheep\.247\.19679-\d{8}-\d{6}$/);
  });

  it('a typed filename still wins over the default', async () => {
    const p = openNamingDialog({ kind: 'render', seed: {}, ext: 'png' });
    field('filename')!.value = 'my-render';
    (modal().querySelector('[data-role="save"]') as HTMLElement).click();
    await expect(p).resolves.toMatchObject({ filename: 'my-render' });
  });
});

describe('openNamingDialog', () => {
  it('render kind shows name + nick + filename, name label "flame name"', () => {
    void openNamingDialog({ kind: 'render', seed: {}, ext: 'png' });
    expect(field('name')).toBeTruthy();
    expect(field('nick')).toBeTruthy();
    expect(field('filename')).toBeTruthy();
    expect(modal().querySelector('[data-role="name-label"]')!.textContent).toBe('flame name');
  });

  it('palette-library kind shows only the (palette) name', () => {
    void openNamingDialog({ kind: 'palette-library', seed: {} });
    expect(field('name')).toBeTruthy();
    expect(field('nick')).toBeNull();
    expect(field('filename')).toBeNull();
    expect(modal().querySelector('[data-role="name-label"]')!.textContent).toBe('palette name');
  });

  it('palette-export shows palette name + filename, no nick', () => {
    void openNamingDialog({ kind: 'palette-export', seed: {}, ext: 'json' });
    expect(field('name')).toBeTruthy();
    expect(field('nick')).toBeNull();
    expect(field('filename')).toBeTruthy();
  });

  it('seeds field values', () => {
    void openNamingDialog({ kind: 'flame', seed: { name: 'ember', nick: 'mu', filename: 'ember-01' } });
    expect(field('name')!.value).toBe('ember');
    expect(field('nick')!.value).toBe('mu');
    expect(field('filename')!.value).toBe('ember-01');
  });

  // #362 — a fresh/unnamed flame (placeholder name) opens with a blank slate so
  // the user names it, instead of pre-filling the "Untitled flame" placeholder.
  it('clears name + filename for a placeholder-named (fresh) flame', () => {
    void openNamingDialog({ kind: 'flame', seed: { name: 'Untitled flame', filename: 'untitled-flame' } });
    expect(field('name')!.value).toBe('');
    expect(field('filename')!.value).toBe('');
  });

  it('treats bare "Untitled" as a placeholder too', () => {
    void openNamingDialog({ kind: 'flame', seed: { name: 'Untitled' } });
    expect(field('name')!.value).toBe('');
  });

  it('preserves a real flame name + filename', () => {
    void openNamingDialog({ kind: 'flame', seed: { name: 'Spiral Galaxy', filename: 'spiral' } });
    expect(field('name')!.value).toBe('Spiral Galaxy');
    expect(field('filename')!.value).toBe('spiral');
  });

  it('Save resolves the typed values', async () => {
    const p = openNamingDialog({ kind: 'flame', seed: {} });
    field('name')!.value = 'cliff'; field('nick')!.value = 'erik'; field('filename')!.value = 'cliff';
    (modal().querySelector('[data-role="save"]') as HTMLElement).click();
    await expect(p).resolves.toEqual({ name: 'cliff', nick: 'erik', filename: 'cliff' });
  });

  it('Cancel resolves null', async () => {
    const p = openNamingDialog({ kind: 'flame', seed: {} });
    (modal().querySelector('[data-role="cancel"]') as HTMLElement).click();
    await expect(p).resolves.toBeNull();
  });

  it('Escape resolves null', async () => {
    const p = openNamingDialog({ kind: 'flame', seed: {} });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(p).resolves.toBeNull();
  });

  it('filename auto-follows the flame name (slugified) until manually edited', () => {
    void openNamingDialog({ kind: 'flame', seed: { name: 'ember', filename: 'ember' } });
    const nameI = field('name')!;
    const fileI = field('filename')!;
    nameI.value = 'Crimson Bloom';
    nameI.dispatchEvent(new Event('input'));
    expect(fileI.value).toBe('crimson-bloom');
  });

  it('manual filename edit stops the auto-follow', () => {
    void openNamingDialog({ kind: 'flame', seed: { name: 'ember', filename: 'ember' } });
    const nameI = field('name')!;
    const fileI = field('filename')!;
    // User overrides the filename → it should stick.
    fileI.value = 'my-custom-name';
    fileI.dispatchEvent(new Event('input'));
    // Subsequent name edits must NOT clobber the override.
    nameI.value = 'Totally Different';
    nameI.dispatchEvent(new Event('input'));
    expect(fileI.value).toBe('my-custom-name');
  });

  it('no template/preview affordance is rendered', () => {
    void openNamingDialog({ kind: 'render', seed: { name: 'x', filename: 'x' }, ext: 'png' });
    expect(modal().querySelector('[data-role="filename-preview"]')).toBeNull();
  });

  it('dialog is removed from the DOM after resolve', async () => {
    const p = openNamingDialog({ kind: 'flame', seed: {} });
    (modal().querySelector('[data-role="cancel"]') as HTMLElement).click();
    await p;
    expect(document.querySelector('.pyr3-naming-dialog')).toBeNull();
  });
});
