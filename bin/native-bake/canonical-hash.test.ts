import { describe, it, expect } from 'vitest';
import { canonicalFlameHash } from './canonical-hash';
import type { Pyr3JsonV1 } from '../../src/serialize';

// A pyr3-JSON flame (Pyr3JsonV1) — the shape a pyr3 PNG embeds + genomeToJson emits.
function base(): Pyr3JsonV1 {
  return {
    version: 1,
    name: 'a',
    nick: 'pyr3',
    viewport: { scale: 100, cx: 0, cy: 0 },
    palette: { name: 'p', stops: [{ t: 0, r: 0, g: 0, b: 0 }] },
    xforms: [
      {
        weight: 1,
        color: 0,
        affine: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        variations: [{ name: 'linear', weight: 1 }],
      },
    ],
    symmetry: { kind: 'rotational', n: 1 },
    tonemap: { gamma: 4, vibrancy: 1, highlightPower: 1, brightness: 4, gammaThreshold: 0.01 },
    quality: 200,
    size: { width: 3840, height: 2160 },
  } as unknown as Pyr3JsonV1;
}

describe('canonicalFlameHash', () => {
  it('ignores name / nick / size / quality', () => {
    const g1 = base();
    const g2 = base();
    g2.name = 'different';
    g2.nick = 'x';
    g2.size = { width: 1024, height: 576 };
    g2.quality = 16;
    expect(canonicalFlameHash(g2)).toBe(canonicalFlameHash(g1));
  });

  it('changes when an xform changes', () => {
    const g1 = base();
    const g2 = base();
    g2.xforms[0]!.weight = 0.5;
    expect(canonicalFlameHash(g2)).not.toBe(canonicalFlameHash(g1));
  });

  it('changes when the palette changes', () => {
    const g1 = base();
    const g2 = base();
    g2.palette.stops[0]!.r = 0.9;
    expect(canonicalFlameHash(g2)).not.toBe(canonicalFlameHash(g1));
  });

  it('is order-stable for object keys', () => {
    const g1 = base();
    expect(canonicalFlameHash(g1)).toBe(canonicalFlameHash(JSON.parse(JSON.stringify(g1))));
  });
});
