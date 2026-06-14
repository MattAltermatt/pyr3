import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { frameOutPath, shouldSkipFrame, writeFrameAtomic } from './resume-skip';

describe('resume skip helpers (#275)', () => {
  it('frameOutPath zero-pads to ≥5 and applies the prefix', () => {
    expect(frameOutPath('/out', 'mov_', 42, 5)).toBe(join('/out', 'mov_00042.png'));
    // widens past 5 when the caller asks
    expect(frameOutPath('/out', '', 7, 6)).toBe(join('/out', '000007.png'));
  });

  it('shouldSkipFrame is true only when resume on AND the final file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyr3-resume-'));
    try {
      const p = frameOutPath(dir, '', 0, 5);
      expect(shouldSkipFrame(p, true)).toBe(false); // not yet written
      writeFileSync(p, 'x');
      expect(shouldSkipFrame(p, true)).toBe(true);  // exists + resume
      expect(shouldSkipFrame(p, false)).toBe(false); // resume off ⇒ never skip
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeFrameAtomic writes via a temp file then renames (no stray .tmp left)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyr3-resume-'));
    try {
      const p = frameOutPath(dir, 'f', 3, 5);
      writeFrameAtomic(p, new Uint8Array([1, 2, 3]));
      expect(existsSync(p)).toBe(true);
      expect(existsSync(`${p}.tmp`)).toBe(false);
      expect([...readFileSync(p)]).toEqual([1, 2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
