import { describe, it, expect } from 'vitest';
import { COLORS } from './ui-tokens';

describe('ui-tokens', () => {
  it('exposes the flame gradient stops matching the favicon', () => {
    expect(COLORS.flame.top).toBe('#ffbe3e');
    expect(COLORS.flame.mid).toBe('#e87c1a');
    expect(COLORS.flame.bot).toBe('#bf2408');
  });

  it('exposes background tiers used across surfaces', () => {
    expect(COLORS.bg.page).toBe('#0a0a0c');
    expect(COLORS.bg.bar).toBe('#0e0e10');
    expect(COLORS.bg.info).toBe('#131316');
    expect(COLORS.bg.action).toBe('#15110d');
    expect(COLORS.bg.panel).toBe('#141417');
    expect(COLORS.bg.input).toBe('#0a0a0c');
  });

  it('exposes text tiers and named accents', () => {
    expect(COLORS.text.primary).toBe('#d8d8de');
    expect(COLORS.text.muted).toBe('#8a8a92');
    expect(COLORS.text.dim).toBe('#5a5a60');
    expect(COLORS.border).toBe('#26262c');
    expect(COLORS.webgpu).toBe('#6cd16c');
    expect(COLORS.danger).toBe('#e85a4a');
  });
});
