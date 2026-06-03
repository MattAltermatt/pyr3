// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { attachXformViz, type RawAffine } from './edit-xform-viz';

function makeCanvas(width = 120, height = 120): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

describe('attachXformViz', () => {
  it('returns a handle with draw() and destroy()', () => {
    const canvas = makeCanvas();
    const handle = attachXformViz(canvas, () => ({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }));
    expect(typeof handle.draw).toBe('function');
    expect(typeof handle.destroy).toBe('function');
    handle.destroy();
  });

  it('draw() calls the affine getter', () => {
    const canvas = makeCanvas();
    const getAffine = vi.fn((): RawAffine => ({ a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }));
    const handle = attachXformViz(canvas, getAffine);
    handle.draw();
    expect(getAffine).toHaveBeenCalled();
    handle.destroy();
  });

  it('does not throw on a degenerate (zero-determinant) affine', () => {
    const canvas = makeCanvas();
    const handle = attachXformViz(canvas, () => ({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }));
    expect(() => handle.draw()).not.toThrow();
    handle.destroy();
  });
});
