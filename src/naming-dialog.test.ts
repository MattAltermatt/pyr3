// @vitest-environment happy-dom

import { describe, it, expect, afterEach } from 'vitest';
import { openNamingDialog } from './naming-dialog';

function modal(): HTMLElement {
  const m = document.querySelector('.pyr3-naming-dialog') as HTMLElement;
  if (!m) throw new Error('dialog not mounted');
  return m;
}
function field(role: string): HTMLInputElement | null {
  return document.querySelector(`.pyr3-naming-dialog [data-role="${role}"]`) as HTMLInputElement | null;
}

afterEach(() => { document.body.innerHTML = ''; });

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
