import { describe, it, expect } from 'vitest';
import {
  createTimeline, appendFlame, appendAnimationAll, setEvolve, setPause, setLinger, setPermutation, removeNode,
  lingerToEasing, easingToLinger,
  DEFAULT_EVOLVE, DEFAULT_HOLD, DEFAULT_LINGER, type Linger,
} from './timeline-edit';
import type { Genome } from './genome';
import type { Animation } from './animation';
import { animationToTimeline } from './timeline';

// Distinct genome stubs — mutations never read genome internals.
const gA = { quality: 1 } as unknown as Genome;
const gB = { quality: 2 } as unknown as Genome;

describe('createTimeline', () => {
  it('makes an empty timeline carrying the flam3 animation defaults', () => {
    const tl = createTimeline();
    expect(tl.clips).toHaveLength(0);
    expect(tl.interpolation).toBe('linear');
    expect(tl.temporal_filter_type).toBeDefined();
  });
});

describe('appendFlame', () => {
  it('first append → a single terminal clip holding the seed default', () => {
    const tl = appendFlame(createTimeline(), gA);
    expect(tl.clips).toHaveLength(1);
    expect(tl.clips[0]!.flame.genome).toBe(gA);
    expect(tl.clips[0]!.duration).toBe(DEFAULT_HOLD); // #280 seed hold
    expect(tl.clips[0]!.transitionDuration).toBe(0);
  });

  it('second append seeds the first section (no prior section to inherit)', () => {
    const tl = appendFlame(appendFlame(createTimeline(), gA), gB);
    expect(tl.clips).toHaveLength(2);
    // #280 — node 0 becomes a section with the SEED evolve + linger; its own
    // hold (the seed 0.1) is preserved, not flattened to 0.
    expect(tl.clips[0]!.transitionDuration).toBe(DEFAULT_EVOLVE);
    expect(tl.clips[0]!.duration).toBe(DEFAULT_HOLD + DEFAULT_EVOLVE);
    expect(tl.clips[0]!.easing).toEqual(lingerToEasing(DEFAULT_LINGER));
    // node 1 terminal, hold copied from the prior flame (the seed 0.1).
    expect(tl.clips[1]!.flame.genome).toBe(gB);
    expect(tl.clips[1]!.transitionDuration).toBe(0);
    expect(tl.clips[1]!.duration).toBe(DEFAULT_HOLD);
  });

  it('#280 — a later add inherits the previous section + previous flame hold', () => {
    // flame 1 → flame 2 with a hand-set evolve 12s, strong linger, pause 0.4.
    let tl = appendFlame(appendFlame(createTimeline(), gA), gB);
    tl = setEvolve(tl, 0, 12);
    tl = setLinger(tl, 0, 'strong');
    tl = setPause(tl, 1, 0.4); // flame 2's hold
    // add flame 3.
    tl = appendFlame(tl, gA);
    expect(tl.clips).toHaveLength(3);
    // new section (flame 2 → flame 3) copies the previous section's evolve+linger.
    expect(tl.clips[1]!.transitionDuration).toBe(12);
    expect(tl.clips[1]!.easing).toEqual(lingerToEasing('strong'));
    // flame 2 keeps its own 0.4 hold (duration = hold + evolve).
    expect(tl.clips[1]!.duration).toBe(0.4 + 12);
    // flame 3 terminal, hold copied from flame 2 (0.4).
    expect(tl.clips[2]!.transitionDuration).toBe(0);
    expect(tl.clips[2]!.duration).toBe(0.4);
    // section 0 (flame 1 → flame 2) is untouched by the add.
    expect(tl.clips[0]!.transitionDuration).toBe(12);
  });

  it('#280 — inherits linger "none" (no easing) when the prior section had none', () => {
    let tl = appendFlame(appendFlame(createTimeline(), gA), gB);
    tl = setLinger(tl, 0, 'none'); // clears easing
    tl = appendFlame(tl, gA);
    expect(tl.clips[1]!.easing).toBeUndefined();
  });

  it('does not mutate the input timeline', () => {
    const base = appendFlame(createTimeline(), gA);
    appendFlame(base, gB);
    expect(base.clips).toHaveLength(1);
    expect(base.clips[0]!.transitionDuration).toBe(0);
  });

  it('carries an optional FlameSource onto the clip', () => {
    const tl = appendFlame(createTimeline(), gA, { kind: 'upload', filename: 'x.flam3' });
    expect(tl.clips[0]!.flame.source).toEqual({ kind: 'upload', filename: 'x.flam3' });
  });
});

describe('linger ↔ easing', () => {
  const cases: Array<[Linger, ReturnType<typeof lingerToEasing>]> = [
    ['none', undefined],
    ['gentle', { kind: 'preset', name: 'easeInOut' }],
    ['strong', { kind: 'cubicBezier', x1: 0.85, y1: 0, x2: 0.15, y2: 1 }],
  ];
  it('maps linger → easing', () => {
    for (const [linger, easing] of cases) expect(lingerToEasing(linger)).toEqual(easing);
  });
  it('round-trips easing → linger', () => {
    expect(easingToLinger(undefined)).toBe('none');
    expect(easingToLinger({ kind: 'preset', name: 'linear' })).toBe('none');
    expect(easingToLinger({ kind: 'preset', name: 'easeInOut' })).toBe('gentle');
    expect(easingToLinger({ kind: 'cubicBezier', x1: 0.85, y1: 0, x2: 0.15, y2: 1 })).toBe('strong');
    // an unrecognized authored bezier surfaces as 'custom'.
    expect(easingToLinger({ kind: 'cubicBezier', x1: 0.2, y1: 0, x2: 0.7, y2: 1 })).toBe('custom');
  });
});

// Build a minimal 2-keyframe Animation for the import tests (borrow the global
// interp fields off an empty Timeline; animationToTimeline only reads keyframes
// + those globals).
function anim2(): Animation {
  return {
    ...createTimeline(),
    keyframes: [
      { ...(gA as object), time: 0 } as unknown as Genome,
      { ...(gB as object), time: 1.5 } as unknown as Genome,
    ],
  } as unknown as Animation;
}

describe('setEvolve', () => {
  it('sets a section evolve, preserving that node’s pause', () => {
    let tl = appendFlame(appendFlame(createTimeline(), gA), gB);
    tl = setPause(tl, 0, 0.5);          // node 0 pause 0.5 (duration 2.5 now)
    tl = setEvolve(tl, 0, 3.0);         // evolve 3 → duration = pause + evolve = 3.5
    expect(tl.clips[0]!.transitionDuration).toBe(3.0);
    expect(tl.clips[0]!.duration).toBe(3.5);
  });
});

describe('setPause', () => {
  it('sets a node pause, preserving its evolve', () => {
    let tl = appendFlame(appendFlame(createTimeline(), gA), gB); // clip0 evolve 2
    tl = setPause(tl, 0, 0.8);
    expect(tl.clips[0]!.transitionDuration).toBe(DEFAULT_EVOLVE); // unchanged
    expect(tl.clips[0]!.duration).toBe(0.8 + DEFAULT_EVOLVE);
  });
  it('sets the terminal node pause as a final hold', () => {
    let tl = appendFlame(appendFlame(createTimeline(), gA), gB);
    tl = setPause(tl, 1, 1.5);
    expect(tl.clips[1]!.transitionDuration).toBe(0);
    expect(tl.clips[1]!.duration).toBe(1.5);
  });
});

describe('setLinger', () => {
  it('writes/clears the clip easing', () => {
    let tl = appendFlame(appendFlame(createTimeline(), gA), gB);
    tl = setLinger(tl, 0, 'strong');
    expect(tl.clips[0]!.easing).toEqual({ kind: 'cubicBezier', x1: 0.85, y1: 0, x2: 0.15, y2: 1 });
    tl = setLinger(tl, 0, 'none');
    expect(tl.clips[0]!.easing).toBeUndefined();
  });
});

describe('removeNode', () => {
  it('removes a node and re-terminalizes the chain', () => {
    const base = appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA); // 3 nodes
    const tl = removeNode(base, 2);          // drop the terminal node
    expect(tl.clips).toHaveLength(2);
    expect(tl.clips[1]!.transitionDuration).toBe(0); // new terminal
  });
  it('removing the only node yields an empty timeline', () => {
    const tl = removeNode(appendFlame(createTimeline(), gA), 0);
    expect(tl.clips).toHaveLength(0);
  });
});

describe('appendAnimationAll', () => {
  it('appends an imported animation, joining with a default evolve', () => {
    const sub = animationToTimeline(anim2());        // 2 clips
    const base = appendFlame(createTimeline(), gA);  // 1 terminal node
    const tl = appendAnimationAll(base, anim2());
    expect(tl.clips).toHaveLength(1 + sub.clips.length);
    // the prior terminal now evolves into the imported sequence.
    expect(tl.clips[0]!.transitionDuration).toBe(DEFAULT_EVOLVE);
  });
  it('#280 — a multi-clip base bridges into the import with the prior section timing', () => {
    let base = appendFlame(appendFlame(createTimeline(), gA), gB); // clips [section0, terminal]
    base = setEvolve(base, 0, 8);
    base = setLinger(base, 0, 'strong');
    const tl = appendAnimationAll(base, anim2());
    // The former terminal (clip 1) becomes the bridge, inheriting section 0's timing.
    expect(tl.clips[1]!.transitionDuration).toBe(8);
    expect(tl.clips[1]!.easing).toEqual(lingerToEasing('strong'));
  });
  it('appending into an empty timeline is just the imported clips', () => {
    const tl = appendAnimationAll(createTimeline(), anim2());
    expect(tl.clips).toHaveLength(animationToTimeline(anim2()).clips.length);
  });
  it('gives the imported terminal node a real hold (not the 0-duration marker)', () => {
    // animationToTimeline always terminates with {duration:0, transitionDuration:0};
    // appendAnimationAll must replace that with a visible final hold.
    const tl = appendAnimationAll(appendFlame(createTimeline(), gA), anim2());
    const last = tl.clips[tl.clips.length - 1]!;
    expect(last.transitionDuration).toBe(0);
    expect(last.duration).toBe(DEFAULT_HOLD);
  });
});

describe('setPermutation', () => {
  // Two-clip timeline: section 0 is the evolve gA → gB.
  const twoClip = () => appendFlame(appendFlame(createTimeline(), gA), gB);

  it('writes a non-identity permutation onto the section clip only', () => {
    const out = setPermutation(twoClip(), 0, [1, 0, 2]);
    expect(out.clips[0]!.permutation).toEqual([1, 0, 2]);
    expect(out.clips[1]!.permutation).toBeUndefined();
  });

  it('clears the field when given undefined (reset to positional)', () => {
    const withPerm = setPermutation(twoClip(), 0, [1, 0]);
    const cleared = setPermutation(withPerm, 0, undefined);
    expect('permutation' in cleared.clips[0]!).toBe(false);
  });

  it('does not mutate the input timeline', () => {
    const base = twoClip();
    setPermutation(base, 0, [2, 1, 0]);
    expect(base.clips[0]!.permutation).toBeUndefined();
  });
});
