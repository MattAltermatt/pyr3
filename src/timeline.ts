// Timeline = an ordered list of clips, each referencing one inlined flame plus
// the transition INTO the next clip (#227, Shape 1). The existing Animation
// (keyframes[]) is a degenerate case — see animationToTimeline below. The
// interpolation kernel is REUSED per pair, never generalized (#227 comment).
//
// GPU-free / DOM-free: this is an engine-seam module (typecheck:engine clean).

import { type Genome } from './genome';
import { type EasingCurve } from './easing';
import {
  type Animation,
  type Interpolation,
  type InterpolationType,
  type PaletteInterpolation,
  type TemporalFilterType,
} from './animation';
import { interpolate } from './interpolate';

/** Where a clip's flame came from — display / relink metadata only. Rendering
 *  never depends on it; the genome is always inlined. */
export type FlameSource =
  | { kind: 'corpus'; gen: number; id: number }
  | { kind: 'upload'; filename: string }
  | { kind: 'json' };

export interface FlameRef {
  /** Always inlined — the doc renders standalone (headless + browser). */
  genome: Genome;
  source?: FlameSource;
}

export interface Clip {
  flame: FlameRef;
  /** Seconds this clip occupies on the track. */
  duration: number;
  /** Trailing seconds that cross-fade into the NEXT clip (0 on the last clip).
   *  Clamped to [0, duration] at read time. */
  transitionDuration: number;
  /** #224 transition curve — absent ⇒ linear. */
  easing?: EasingCurve;
  /** #225 xform correspondence — absent ⇒ positional-by-index. */
  permutation?: number[];
}

export interface Timeline {
  /** length ≥ 1; a single clip is a static flame. */
  clips: Clip[];
  interpolation: Interpolation;
  interpolation_type: InterpolationType;
  palette_interpolation: PaletteInterpolation;
  hsv_rgb_palette_blend: number;
  ntemporal_samples: number;
  temporal_filter_type: TemporalFilterType;
  temporal_filter_width: number;
  temporal_filter_exp: number;
}

/** Total play length = Σ clip.duration (negatives floored to 0). */
export function timelineDuration(tl: Timeline): number {
  let sum = 0;
  for (const c of tl.clips) sum += Math.max(0, c.duration);
  return sum;
}

/** An ephemeral, render-ready slice of a timeline at one instant. */
export interface TimelineSegment {
  /** A 2-keyframe Animation the existing interpolate()/renderAnimationFrame consume. */
  animation: Animation;
  /** Local time within `animation` (0 ⇒ first keyframe). */
  localTime: number;
}

/** Copy the cross-keyframe interp settings off a Timeline (no keyframes/seg fields). */
function timelineGlobals(
  tl: Timeline,
): Omit<Animation, 'keyframes' | 'segmentEasing' | 'segmentPermutation'> {
  return {
    interpolation: tl.interpolation,
    interpolation_type: tl.interpolation_type,
    palette_interpolation: tl.palette_interpolation,
    hsv_rgb_palette_blend: tl.hsv_rgb_palette_blend,
    ntemporal_samples: tl.ntemporal_samples,
    temporal_filter_type: tl.temporal_filter_type,
    temporal_filter_width: tl.temporal_filter_width,
    temporal_filter_exp: tl.temporal_filter_exp,
  };
}

/** Shallow-copy a genome with an explicit keyframe `time` (interpolate reads it). */
function genomeAtTime(g: Genome, time: number): Genome {
  return { ...g, time };
}

/** Locate the active clip at global time `t` and return the ephemeral 2-keyframe
 *  segment + local time that reproduces the right genome via interpolate().
 *  Holds and the terminal clip return a degenerate [flame, flame] pair (so
 *  interpolate's length>=2 precondition holds); transitions return
 *  [flame[i], flame[i+1]] carrying the clip's easing/permutation.
 *
 *  NOTE on `interpolation: 'smooth'`: each segment is only 2 keyframes, so the
 *  Catmull-Rom path in interpolate() (which needs a non-endpoint interior
 *  segment) never fires — a smooth timeline blends each clip pair LINEARLY. This
 *  is inherent to the per-pair reuse architecture (#227 forbids N-keyframe
 *  generalization). Cross-clip Catmull-Rom is tracked as a follow-up; see #227. */
export function timelineSegmentAt(tl: Timeline, t: number): TimelineSegment {
  const clips = tl.clips;
  if (clips.length < 1) {
    throw new Error('pyr3: timelineSegmentAt requires Timeline.clips.length >= 1');
  }

  const total = timelineDuration(tl);
  const clamped = Math.max(0, Math.min(t, total));

  // Locate the active clip: the first whose box contains `clamped`, else the last.
  let i = 0;
  let clipStart = 0;
  for (; i < clips.length - 1; i++) {
    const dur = Math.max(0, clips[i]!.duration);
    if (clamped < clipStart + dur) break;
    clipStart += dur;
  }
  const clip = clips[i]!;
  const dur = Math.max(0, clip.duration);
  const trans = Math.max(0, Math.min(clip.transitionDuration, dur));
  const holdDur = dur - trans;
  const tIntoClip = clamped - clipStart;

  const g = timelineGlobals(tl);
  const isLast = i === clips.length - 1;
  const inTransition = !isLast && trans > 0 && tIntoClip > holdDur;

  if (!inTransition) {
    // Hold or terminal — degenerate [flame, flame], returns flame[i] at any localTime.
    return {
      animation: {
        ...g,
        keyframes: [genomeAtTime(clip.flame.genome, 0), genomeAtTime(clip.flame.genome, 1)],
      },
      localTime: 0,
    };
  }

  const next = clips[i + 1]!;
  return {
    animation: {
      ...g,
      keyframes: [
        genomeAtTime(clip.flame.genome, 0),
        genomeAtTime(next.flame.genome, trans),
      ],
      segmentEasing: clip.easing ? [clip.easing] : undefined,
      segmentPermutation: clip.permutation ? [clip.permutation] : undefined,
    },
    localTime: tIntoClip - holdDur,
  };
}

/** Concrete Genome at global time `t` — the per-frame entry point.
 *  Reuses interpolate() on the ephemeral per-pair segment. */
export function timelineGenomeAt(tl: Timeline, t: number): Genome {
  const seg = timelineSegmentAt(tl, t);
  return interpolate(seg.animation, seg.localTime);
}

/** Convert an imported Animation (keyframes[]) to its degenerate Timeline:
 *  N keyframes → N clips, gap i → full-cross-fade clip (no hold), terminal clip
 *  is zero-duration. Carries segmentEasing/segmentPermutation per gap. The
 *  result renders byte-identical to the source Animation for `interpolation:
 *  'linear'` (see seam test). For `interpolation: 'smooth'` the per-pair segments
 *  degrade to linear (no cross-clip Catmull-Rom) — see timelineSegmentAt's note. */
export function animationToTimeline(anim: Animation): Timeline {
  const kfs = anim.keyframes;
  if (kfs.length < 1) {
    throw new Error('pyr3: animationToTimeline requires >= 1 keyframe');
  }
  const clips: Clip[] = kfs.map((cur, i) => {
    if (i === kfs.length - 1) {
      return { flame: { genome: cur }, duration: 0, transitionDuration: 0 };
    }
    const gap = (kfs[i + 1]!.time ?? 0) - (cur.time ?? 0);
    return {
      flame: { genome: cur },
      duration: gap,
      transitionDuration: gap,
      easing: anim.segmentEasing?.[i],
      permutation: anim.segmentPermutation?.[i],
    };
  });
  return {
    clips,
    interpolation: anim.interpolation,
    interpolation_type: anim.interpolation_type,
    palette_interpolation: anim.palette_interpolation,
    hsv_rgb_palette_blend: anim.hsv_rgb_palette_blend,
    ntemporal_samples: anim.ntemporal_samples,
    temporal_filter_type: anim.temporal_filter_type,
    temporal_filter_width: anim.temporal_filter_width,
    temporal_filter_exp: anim.temporal_filter_exp,
  };
}
