// #275 — resume / skip-existing export helpers, shared by the /api/animate route
// and the headless CLI (bin/pyr3-animate.ts). Skip is keyed purely on the final
// filename existing; the temp-rename write makes "file exists" ⟺ "frame complete"
// so a frame half-written when a prior export crashed is never trusted on resume.
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** `<dir>/<prefix><frame:pad>.png`. Pad is ≥5 (ffmpeg %05d convention), widened
 *  by the caller to fit the largest frame label. */
export function frameOutPath(dir: string, prefix: string, frame: number, pad: number): string {
  return resolve(dir, `${prefix}${String(frame).padStart(Math.max(5, pad), '0')}.png`);
}

/** Skip iff resume is on AND the final file already exists on disk. */
export function shouldSkipFrame(finalPath: string, resume: boolean): boolean {
  return resume && existsSync(finalPath);
}

/** Crash-safe write: bytes → `<final>.tmp` → atomic rename to `<final>`. So a
 *  frame file exists only once fully written — resume never trusts a partial. */
export function writeFrameAtomic(finalPath: string, bytes: Uint8Array): void {
  const tmp = `${finalPath}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, finalPath);
}
