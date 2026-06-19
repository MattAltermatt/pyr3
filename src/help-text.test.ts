// @vitest-environment happy-dom

// pyr3 — help-text registry guards (#343/#348).
//
// The registry is the single source of truth for every visible `?`
// info-icon's copy. These tests enforce the field-completeness contract
// (every registered key carries real copy) and the unknown-key guard.

import { describe, it, expect } from 'vitest';
import { HELP, HELP_SKIP_ALLOWLIST, infoIcon } from './help-text';

describe('help-text registry', () => {
  it('every HELP entry has a non-empty title and body', () => {
    for (const [key, opts] of Object.entries(HELP)) {
      expect(opts.title.trim(), `${key}.title`).not.toBe('');
      expect(opts.body.trim(), `${key}.body`).not.toBe('');
    }
  });

  it('HELP keys and the skip-allowlist are disjoint', () => {
    const helpKeys = new Set(Object.keys(HELP));
    for (const skip of HELP_SKIP_ALLOWLIST) {
      expect(helpKeys.has(skip), `${skip} is both registered and skipped`).toBe(false);
    }
  });

  it('infoIcon throws on an unknown key (typo guard)', () => {
    expect(() => infoIcon('__bogus__')).toThrow(/unknown key/);
  });

  it('infoIcon returns a pyr3-info-icon element for a known key', () => {
    const el = infoIcon('render.quality');
    expect(el.classList.contains('pyr3-info-icon')).toBe(true);
    expect(el.textContent).toBe('?');
  });
});
