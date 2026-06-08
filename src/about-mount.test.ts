// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import { mountAbout } from './about-mount';

describe('mountAbout', () => {
  it('renders title, tagline, version chip, and sections', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountAbout(root, { version: '1.4.0', buildDate: '2026-06-04', gpuInfo: 'Dawn' });

    expect(root.querySelector('h1')?.textContent).toBe('pyr3');
    expect(root.textContent).toContain('1.4.0');
    expect(root.textContent).toContain('2026-06-04');
    expect(root.textContent).toContain('Dawn');
    expect(root.querySelector('section[data-sec="lineage"]')).toBeTruthy();
    expect(root.querySelector('section[data-sec="credits"]')).toBeTruthy();
    expect(root.querySelector('section[data-sec="links"]')).toBeTruthy();
  });

  it('omits build info gracefully when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>';
    mountAbout(document.getElementById('root')!, { version: '1.4.0' });
    expect(document.body.textContent).toContain('1.4.0');
  });

  it('renders offlineCli section detailing CLI download and build options', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root')!;
    mountAbout(root, { version: '1.4.0' });

    const offlineSec = root.querySelector('section[data-sec="offlineCli"]');
    expect(offlineSec).toBeTruthy();
    expect(offlineSec!.textContent).toContain('git clone https://github.com/MattAltermatt/pyr3.git');
    expect(offlineSec!.textContent).toContain('CLI README');
    expect(offlineSec!.textContent).toContain('npm run build:cli render');
  });
});
