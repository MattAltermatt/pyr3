// Single source of truth for pyr3's UI color tokens.
// Mirrors the favicon SVG linear gradient (see index.html); used by ui-bar.ts,
// edit-primitives.ts, gallery-mount.ts, palette-picker.ts, about-mount.ts.
export const COLORS = {
  flame: {
    top: '#ffbe3e',
    mid: '#e87c1a',
    bot: '#bf2408',
  },
  bg: {
    page:   '#0a0a0c',
    bar:    '#0e0e10',
    info:   '#131316',
    action: '#15110d',
    panel:  '#141417',
  },
  border: '#26262c',
  text: {
    primary: '#d8d8de',
    muted:   '#8a8a92',
    dim:     '#5a5a60',
  },
  webgpu: '#6cd16c',
  danger:  '#e85a4a',
} as const;

export type ColorTokens = typeof COLORS;
