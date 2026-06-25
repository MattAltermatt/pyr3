import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listFlameIds, partitionByExisting, progressLine, outName } from './flames-render';

function tmp() { return mkdtempSync(join(tmpdir(), 'render-')); }

describe('flames-render helpers', () => {
  it('outName uses .png for png8/png16 and .exr for exr formats', () => {
    expect(outName(42, 'png16')).toBe('00042.png');
    expect(outName(42, 'png8')).toBe('00042.png');
    expect(outName(42, 'exr')).toBe('00042.exr');
    expect(outName(42, 'exr-linear')).toBe('00042.exr');
  });

  it('partitionByExisting respects the format extension (exr → .exr)', () => {
    const renders = tmp();
    writeFileSync(join(renders, '00002.exr'), 'fake');
    const { done, todo } = partitionByExisting([2, 7], renders, 'exr');
    expect(done).toEqual([2]);
    expect(todo).toEqual([7]);
  });

  it('listFlameIds returns numeric ids from <id>.pyr3.json, sorted, ignoring others', () => {
    const dir = tmp();
    writeFileSync(join(dir, '00007.pyr3.json'), '{}');
    writeFileSync(join(dir, '00002.pyr3.json'), '{}');
    writeFileSync(join(dir, '00010.pyr3.json'), '{}');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'foo.json'), 'x'); // not <id>.pyr3.json
    expect(listFlameIds(dir)).toEqual([2, 7, 10]);
  });

  it('partitionByExisting splits ids by whether renders/<id>.png exists', () => {
    const renders = tmp();
    writeFileSync(join(renders, '00002.png'), 'fake');
    const { done, todo } = partitionByExisting([2, 7, 10], renders);
    expect(done).toEqual([2]);
    expect(todo).toEqual([7, 10]);
  });

  it('progressLine reports index/total, remaining, this-render time and ETA', () => {
    // 3rd of 10, avg 120s/render → 7 remaining → ETA 14m0s
    const line = progressLine({ index: 2, total: 10, id: 42, lastSeconds: 118, avgSeconds: 120 });
    expect(line).toContain('[3/10]');
    expect(line).toContain('00042');
    expect(line).toContain('7 remaining');
    expect(line).toMatch(/est\. time remaining/i);
  });
});
