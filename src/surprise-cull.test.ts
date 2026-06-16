import { describe, expect, it } from 'vitest';
import { classifyThumbnail } from './surprise-cull';

const W = 32, H = 32;
function img(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fill(x, y); const i = (y * W + x) * 4;
    a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255;
  }
  return a;
}

describe('classifyThumbnail', () => {
  it('rejects all-black as "black"', () => {
    expect(classifyThumbnail(img(() => [0, 0, 0]), W, H)).toMatchObject({ ok: false, reason: 'black' });
  });
  it('rejects a single bright dot as "dot"', () => {
    const a = img(() => [0, 0, 0]); const c = ((H / 2) * W + W / 2) * 4;
    a[c] = 255; a[c + 1] = 255; a[c + 2] = 255;
    expect(classifyThumbnail(a, W, H)).toMatchObject({ ok: false, reason: 'dot' });
  });
  it('rejects a smooth featureless blob as "blob"', () => {
    const a = img((x, y) => {
      const dx = (x - W / 2) / W, dy = (y - H / 2) / H;
      const v = Math.max(0, 1 - 6 * (dx * dx + dy * dy)) * 200;
      return [v, v * 0.6, v * 0.9];
    });
    expect(classifyThumbnail(a, W, H)).toMatchObject({ ok: false, reason: 'blob' });
  });
  it('rejects high-frequency noise as "noise"', () => {
    let s = 99; const rnd = () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
    expect(classifyThumbnail(img(() => [rnd() * 255, rnd() * 255, rnd() * 255]), W, H))
      .toMatchObject({ ok: false, reason: 'noise' });
  });
  it('rejects a dull uniform field as "flat"', () => {
    // fills the frame at near-constant luminance with only faint grain
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const a = img(() => { const v = 80 + rnd() * 8; return [v, v * 0.7, v * 0.5]; });
    expect(classifyThumbnail(a, W, H)).toMatchObject({ ok: false, reason: 'flat' });
  });
  it('accepts a structured image (spread + edges)', () => {
    const a = img((x, y) => (x + y) % 5 < 2 ? [240, 120, 40] : [10, 10, 30]);
    expect(classifyThumbnail(a, W, H)).toMatchObject({ ok: true });
  });
});
