import { type EasingCurve } from '../src/easing';

/** Parse an optional `--easing <json>` flag (a JSON EasingCurve[]). Returns
 *  undefined when the flag is absent. Throws on malformed JSON. */
export function parseEasingFlag(args: string[]): (EasingCurve | undefined)[] | undefined {
  const i = args.indexOf('--easing');
  if (i === -1) return undefined;
  const raw = args[i + 1];
  // A missing value, or a flag-lookalike next token (`--easing --verbose`), is a
  // missing argument — surface that rather than a misleading JSON.parse error.
  if (raw === undefined || raw.startsWith('--')) {
    throw new Error('--easing requires a JSON argument');
  }
  return JSON.parse(raw) as (EasingCurve | undefined)[];
}

/** #274 — parse `width` / `height` env into an absolute output size. BOTH must
 *  be present and finite > 0; otherwise undefined (no override). Distinct from
 *  the `ss` multiplier — these are absolute target dims. */
export function parseOutputSizeEnv(
  env: Record<string, string | undefined>,
): { width: number; height: number } | undefined {
  if (env['width'] === undefined || env['height'] === undefined) return undefined;
  const width = Number(env['width']);
  const height = Number(env['height']);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/** #275 — `resume=1` / `resume=true` (case-insensitive) ⇒ skip existing frames.
 *  Default off — scripted CLI runs conventionally expect deterministic overwrite. */
export function parseResumeEnv(env: Record<string, string | undefined>): boolean {
  const v = env['resume'];
  return v === '1' || v?.toLowerCase() === 'true';
}

/** #294 — `nsteps=N` overrides ntemporal_samples (motion-blur sub-frames per
 *  frame). Default is **1**, NOT the imported value: this CLI is the companion
 *  to the /animate 📤 export, and ESF/timeline genomes carry ntemporal_samples
 *  up to 1000. Inheriting that sub-renders each frame up to 1000× (minutes-to-
 *  hours/frame). The /api/animate server route defaults nsteps=1 for the same
 *  reason; this mirrors it. An explicit `nsteps=N` opts back into motion blur. */
export function parseNstepsEnv(env: Record<string, string | undefined>): number {
  const v = env['nsteps'];
  if (v === undefined) return 1;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 1;
}
