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

/** #280 — SEED evolve time (s) for the FIRST joined section, used only when
 *  there is no prior section to inherit from. Long by default so a fresh
 *  sequence reads at movie cadence rather than a 2 s cut. Tunable, not balance. */
export const DEFAULT_EVOLVE = 20.0;
/** #280 — SEED hold (s) for the very first flame; inherited forward thereafter
 *  (every later add copies the previous flame's hold). */
export const DEFAULT_HOLD = 0.1;
/** #280 — SEED linger for the first joined section ("soft"); inherited after. */
export const DEFAULT_LINGER: Linger = 'gentle';

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

/** #280 — settings a newly-joined section/flame inherits from the existing tail.
 *  Adding a flame turns the current terminal into a section and creates a fresh
 *  terminal; both copy the tail's values so authoring keeps its cadence:
 *   • evolve + linger come from the PREVIOUS section (the last section before the
 *     terminal), or the seed defaults when none exists yet (first join);
 *   • the new flame's hold copies the current terminal flame's hold.
 *  `clips` must be non-empty. */
function inheritedJoin(clips: Clip[]): { evolve: number; easing: EasingCurve | undefined; hold: number } {
  const term = clips[clips.length - 1]!;                 // the flame we join FROM
  const termHold = Math.max(0, term.duration - term.transitionDuration);
  const prevSection = clips.length >= 2 ? clips[clips.length - 2]! : undefined;
  return {
    evolve: prevSection ? prevSection.transitionDuration : DEFAULT_EVOLVE,
    easing: prevSection ? prevSection.easing : lingerToEasing(DEFAULT_LINGER),
    hold: termHold,
  };
}

/** Turn `clips`' terminal node into an evolving section carrying `evolve`/`easing`,
 *  preserving its own hold. Returns a new array (input untouched). */
function joinTerminal(clips: Clip[], evolve: number, easing: EasingCurve | undefined): Clip[] {
  const last = clips.length - 1;
  return clips.map((c, i) => {
    if (i !== last) return c;
    const pause = Math.max(0, c.duration - c.transitionDuration);
    const { easing: _drop, ...rest } = c;
    const updated: Clip = { ...rest, transitionDuration: evolve, duration: pause + evolve };
    if (easing) updated.easing = easing;
    return updated;
  });
}

/** Append a key flame as a new terminal node. The prior terminal node (if any)
 *  becomes an evolving section; #280 — the new section inherits the previous
 *  section's evolve + linger and the new flame copies the prior flame's hold,
 *  falling back to the seed defaults when there's nothing to inherit. */
export function appendFlame(tl: Timeline, genome: Genome, source?: FlameSource): Timeline {
  const flame = source ? { genome, source } : { genome };
  if (tl.clips.length === 0) {
    return { ...tl, clips: [{ flame, duration: DEFAULT_HOLD, transitionDuration: 0 }] };
  }
  const j = inheritedJoin(tl.clips);
  const clips = joinTerminal(tl.clips, j.evolve, j.easing);
  clips.push({ flame, duration: j.hold, transitionDuration: 0 });
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
 *  internal timing. #280 — a non-empty base is bridged into the import with the
 *  inherited evolve + linger from the existing tail's section (or the seed
 *  DEFAULT_EVOLVE/DEFAULT_LINGER when there's no prior section), so the prior
 *  flame morphs into (rather than hard-cuts to) the imported sequence.
 *  animationToTimeline terminates the sequence with a 0-duration marker clip;
 *  we give that final node a real hold so the last flame is visible/scrubbable. */
export function appendAnimationAll(tl: Timeline, anim: Animation): Timeline {
  const sub = animationToTimeline(anim);
  let joined: Clip[];
  if (tl.clips.length === 0) {
    joined = sub.clips;
  } else {
    // #280 — the bridge into the imported sequence inherits evolve + linger from
    // the existing tail (the imported clips keep their own internal timing).
    const j = inheritedJoin(tl.clips);
    joined = [...joinTerminal(tl.clips, j.evolve, j.easing), ...sub.clips];
  }
  const clips = [...joined];
  const li = clips.length - 1;
  const lc = clips[li]!;
  const pause = Math.max(0, lc.duration - lc.transitionDuration);
  clips[li] = { ...lc, transitionDuration: 0, duration: Math.max(pause, DEFAULT_HOLD) };
  return { ...tl, clips };
}
