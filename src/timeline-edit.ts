// #227d — pure section-vocabulary editing over the Clip[] timeline model
// (src/timeline.ts). Engine-seam clean: no DOM, no GPU (typecheck:engine).
//
// Section model ↔ Clip mapping (see the #227d design spec):
//   node i flame   = clips[i].flame
//   evolve i       = clips[i].transitionDuration            (i < N-1)
//   pause i        = clips[i].duration − clips[i].transitionDuration
//   linger i       = clips[i].easing                        (#224 EasingCurve)
//   ⇒ clips[i].duration = pause_i + evolve_i ; terminal clip has transitionDuration 0.

import { type Genome } from './genome';
import { type EasingCurve } from './easing';
import { type Animation, FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Timeline, type Clip, type FlameSource, animationToTimeline } from './timeline';

/** Default evolve time (s) given to a freshly-joined section. UX default for a
 *  new feature — tunable, not existing balance. */
export const DEFAULT_EVOLVE = 2.0;
/** Default hold (s) on the terminal node so a lone/last flame has visible range. */
export const DEFAULT_FINAL_HOLD = 2.0;

export type Linger = 'none' | 'gentle' | 'strong' | 'custom';

/** Friendly linger façade over the #224 easing curves. `none`/`custom` ⇒ no
 *  stored curve from the MVP control (custom authoring is deferred). */
export function lingerToEasing(linger: Linger): EasingCurve | undefined {
  switch (linger) {
    case 'gentle': return { kind: 'preset', name: 'easeInOut' };
    case 'strong': return { kind: 'cubicBezier', x1: 0.85, y1: 0, x2: 0.15, y2: 1 };
    default: return undefined; // 'none' and 'custom'
  }
}

/** Classify a stored easing curve back to a linger pill for the editor. */
export function easingToLinger(curve: EasingCurve | undefined): Linger {
  if (!curve) return 'none';
  if (curve.kind === 'preset') {
    if (curve.name === 'linear') return 'none';
    if (curve.name === 'easeInOut') return 'gentle';
    return 'custom'; // easeIn / easeOut / hold — authored elsewhere, show as custom
  }
  // cubicBezier: the 'strong' handle is our canonical strong curve.
  if (curve.x1 === 0.85 && curve.y1 === 0 && curve.x2 === 0.15 && curve.y2 === 1) return 'strong';
  return 'custom';
}

/** An empty timeline carrying the flam3 cross-keyframe interp defaults. */
export function createTimeline(): Timeline {
  return {
    clips: [],
    interpolation: FLAM3_ANIMATION_DEFAULTS.interpolation,
    interpolation_type: FLAM3_ANIMATION_DEFAULTS.interpolation_type,
    palette_interpolation: FLAM3_ANIMATION_DEFAULTS.palette_interpolation,
    hsv_rgb_palette_blend: FLAM3_ANIMATION_DEFAULTS.hsv_rgb_palette_blend,
    ntemporal_samples: FLAM3_ANIMATION_DEFAULTS.ntemporal_samples,
    temporal_filter_type: FLAM3_ANIMATION_DEFAULTS.temporal_filter_type,
    temporal_filter_width: FLAM3_ANIMATION_DEFAULTS.temporal_filter_width,
    temporal_filter_exp: FLAM3_ANIMATION_DEFAULTS.temporal_filter_exp,
  };
}

/** Append a key flame as a new terminal node. The prior terminal node (if any)
 *  becomes an evolving node (pause 0, evolve DEFAULT_EVOLVE). */
export function appendFlame(tl: Timeline, genome: Genome, source?: FlameSource): Timeline {
  const flame = source ? { genome, source } : { genome };
  const newClip: Clip = { flame, duration: DEFAULT_FINAL_HOLD, transitionDuration: 0 };
  if (tl.clips.length === 0) return { ...tl, clips: [newClip] };
  const last = tl.clips.length - 1;
  const clips = tl.clips.map((c, i) =>
    i === last ? { ...c, duration: DEFAULT_EVOLVE, transitionDuration: DEFAULT_EVOLVE } : c,
  );
  clips.push(newClip);
  return { ...tl, clips };
}

/** Re-terminalize: force the last clip to a pure hold (transitionDuration 0),
 *  keeping its current pause as the final hold. No-op on an empty list. */
function terminalize(clips: Clip[]): Clip[] {
  if (clips.length === 0) return clips;
  const i = clips.length - 1;
  const c = clips[i]!;
  const pause = Math.max(0, c.duration - c.transitionDuration);
  clips[i] = { ...c, transitionDuration: 0, duration: pause };
  return clips;
}

/** Set section `i`'s evolve time (s), preserving node `i`'s pause. */
export function setEvolve(tl: Timeline, i: number, seconds: number): Timeline {
  const evolve = Math.max(0, seconds);
  const clips = tl.clips.map((c, idx) => {
    if (idx !== i) return c;
    const pause = Math.max(0, c.duration - c.transitionDuration);
    return { ...c, transitionDuration: evolve, duration: pause + evolve };
  });
  return { ...tl, clips };
}

/** Set node `i`'s pause (s), preserving its evolve (transitionDuration). */
export function setPause(tl: Timeline, i: number, seconds: number): Timeline {
  const pause = Math.max(0, seconds);
  const clips = tl.clips.map((c, idx) =>
    idx === i ? { ...c, duration: pause + c.transitionDuration } : c,
  );
  return { ...tl, clips };
}

/** Set section `i`'s linger (writes or clears `clip.easing`). */
export function setLinger(tl: Timeline, i: number, linger: Linger): Timeline {
  const easing = lingerToEasing(linger);
  const clips = tl.clips.map((c, idx) => {
    if (idx !== i) return c;
    if (easing) return { ...c, easing };
    const { easing: _drop, ...rest } = c;
    return rest;
  });
  return { ...tl, clips };
}

/** Set section `i`'s xform-correspondence permutation (#282). `undefined` (or an
 *  identity perm normalized upstream) clears the field ⇒ positional-by-index. The
 *  permutation itself is consumed by interpolate.ts:103 (#225). */
export function setPermutation(tl: Timeline, i: number, perm: number[] | undefined): Timeline {
  const clips = tl.clips.map((c, idx) => {
    if (idx !== i) return c;
    if (perm) return { ...c, permutation: perm };
    const { permutation: _drop, ...rest } = c;
    return rest;
  });
  return { ...tl, clips };
}

/** Remove key flame `i`. Re-terminalizes; removing the last node ⇒ empty. */
export function removeNode(tl: Timeline, i: number): Timeline {
  const clips = terminalize(tl.clips.filter((_, idx) => idx !== i));
  return { ...tl, clips };
}

/** Append all keyframes of an imported Animation as clips, preserving their
 *  internal timing. A non-empty base is joined with a DEFAULT_EVOLVE so the
 *  prior flame morphs into (rather than hard-cuts to) the imported sequence.
 *  animationToTimeline terminates the sequence with a 0-duration marker clip;
 *  we give that final node a real hold so the last flame is visible/scrubbable. */
export function appendAnimationAll(tl: Timeline, anim: Animation): Timeline {
  const sub = animationToTimeline(anim);
  const joined = tl.clips.length === 0
    ? sub.clips
    : [
        ...tl.clips.map((c, idx) =>
          idx === tl.clips.length - 1
            ? { ...c, duration: DEFAULT_EVOLVE, transitionDuration: DEFAULT_EVOLVE }
            : c,
        ),
        ...sub.clips,
      ];
  const clips = [...joined];
  const li = clips.length - 1;
  const lc = clips[li]!;
  const pause = Math.max(0, lc.duration - lc.transitionDuration);
  clips[li] = { ...lc, transitionDuration: 0, duration: Math.max(pause, DEFAULT_FINAL_HOLD) };
  return { ...tl, clips };
}
