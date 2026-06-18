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

  it('filename preview re-runs computePreview on input', () => {
    void openNamingDialog({
      kind: 'render', seed: { filename: '{name}' }, ext: 'png',
      template: '{name}', computePreview: (t) => t.replace('{name}', 'resolved'),
    });
    const preview = modal().querySelector('[data-role="filename-preview"]') as HTMLElement;
    expect(preview.textContent).toContain('resolved');
  });

  it('dialog is removed from the DOM after resolve', async () => {
    const p = openNamingDialog({ kind: 'flame', seed: {} });
    (modal().querySelector('[data-role="cancel"]') as HTMLElement).click();
    await p;
    expect(document.querySelector('.pyr3-naming-dialog')).toBeNull();
  });
});
