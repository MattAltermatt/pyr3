import { describe, it, expect } from 'vitest';
import {
  createTimeline, appendFlame, appendAnimationAll, setEvolve, setPause, setLinger, setPermutation, removeNode,
  swapClipFlames, insertFlame, replaceClipFlame,
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
  it('#288 — leaves the input timeline untouched (re-terminalize is non-mutating)', () => {
    const base = appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA); // 3 nodes
    // Deep-freeze the input: any in-place write in removeNode's pipeline (incl.
    // terminalize's old `clips[i] = …`) would throw under ESM strict mode.
    base.clips.forEach((c) => Object.freeze(c));
    Object.freeze(base.clips);
    Object.freeze(base);
    const snapshot = JSON.stringify(base);
    expect(() => removeNode(base, 1)).not.toThrow();
    expect(JSON.stringify(base)).toBe(snapshot); // original is byte-for-byte intact
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

describe('swapClipFlames', () => {
  // Build A→B→C: section evolves 12/8s, distinct flames.
  const build3 = () => {
    let tl = appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA);
    tl = setEvolve(tl, 0, 12);
    tl = setEvolve(tl, 1, 8);
    tl = setLinger(tl, 0, 'strong');
    return tl;
  };

  it('swaps flame content but leaves per-slot timing in place', () => {
    const tl = swapClipFlames(build3(), 0, 1);
    // flames swapped...
    expect(tl.clips[0]!.flame.genome).toBe(gB);
    expect(tl.clips[1]!.flame.genome).toBe(gA);
    // ...but slot-0 keeps its evolve 12 + strong linger, slot-1 keeps evolve 8.
    expect(tl.clips[0]!.transitionDuration).toBe(12);
    expect(tl.clips[0]!.easing).toEqual(lingerToEasing('strong'));
    expect(tl.clips[1]!.transitionDuration).toBe(8);
    // terminal invariant held.
    expect(tl.clips[2]!.transitionDuration).toBe(0);
  });

  it('resets permutation only on clips whose outgoing morph touches a swapped slot', () => {
    let tl = build3();
    tl = setPermutation(tl, 0, [1, 0]); // slot 0 → slot 1 pairing
    tl = setPermutation(tl, 1, [1, 0]); // slot 1 → slot 2 pairing
    tl = swapClipFlames(tl, 0, 1);
    // touched set for swap(0,1) = {-1,0,1} ∩ valid = {0,1}: both cleared.
    expect(tl.clips[0]!.permutation).toBeUndefined();
    expect(tl.clips[1]!.permutation).toBeUndefined();
  });

  it('non-adjacent swap leaves an untouched middle permutation intact', () => {
    // A→B→C→D, swap 0 and 3. touched = {-1,0,2,3} ∩ valid = {0,2,3}; slot 1 untouched.
    let tl = appendFlame(appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA), gB);
    tl = setPermutation(tl, 1, [1, 0]);
    tl = swapClipFlames(tl, 0, 3);
    expect(tl.clips[0]!.flame.genome).toBe(gB); // was D's genome (gB)
    expect(tl.clips[3]!.flame.genome).toBe(gA); // was A's genome (gA)
    expect(tl.clips[1]!.permutation).toEqual([1, 0]); // untouched
  });

  it('is a no-op on i === j or out-of-range indices', () => {
    const tl = build3();
    expect(swapClipFlames(tl, 1, 1)).toBe(tl);
    expect(swapClipFlames(tl, -1, 0)).toBe(tl);
    expect(swapClipFlames(tl, 0, 99)).toBe(tl);
  });
});

describe('insertFlame', () => {
  // A→B→C with section 0 = 12s/strong, section 1 = 8s/gentle, flame holds via setPause.
  const build3 = () => {
    let tl = appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA);
    tl = setEvolve(tl, 0, 12);
    tl = setLinger(tl, 0, 'strong');
    tl = setPause(tl, 0, 0.5); // flame-0 hold
    tl = setEvolve(tl, 1, 8);
    return tl;
  };

  it('interior insert inherits the split section cadence and grows the timeline', () => {
    // insert X between slot 0 (A) and slot 1 (B): index 1. split section = clips[0].
    const tl = insertFlame(build3(), 1, gB);
    expect(tl.clips).toHaveLength(4);
    expect(tl.clips[1]!.flame.genome).toBe(gB); // X landed at index 1
    // X inherits the split section's evolve (12) + linger (strong)...
    expect(tl.clips[1]!.transitionDuration).toBe(12);
    expect(tl.clips[1]!.easing).toEqual(lingerToEasing('strong'));
    // ...and X's hold = the preceding flame's pause (0.5) ⇒ duration = 0.5 + 12.
    expect(tl.clips[1]!.duration).toBe(0.5 + 12);
    // slot 0 (A) is unchanged — it now morphs into X with the SAME 12/strong.
    expect(tl.clips[0]!.transitionDuration).toBe(12);
    expect(tl.clips[0]!.easing).toEqual(lingerToEasing('strong'));
    // old B (now slot 2) keeps its 8s outgoing evolve; terminal still 0.
    expect(tl.clips[2]!.transitionDuration).toBe(8);
    expect(tl.clips[3]!.transitionDuration).toBe(0);
  });

  it("clears the preceding clip's stale permutation on interior insert", () => {
    let tl = build3();
    tl = setPermutation(tl, 0, [1, 0]); // A → B pairing, now stale (A → X)
    tl = setPermutation(tl, 1, [1, 0]); // B → C pairing, still valid
    tl = insertFlame(tl, 1, gB);
    expect(tl.clips[0]!.permutation).toBeUndefined();      // cleared
    expect(tl.clips[2]!.permutation).toEqual([1, 0]);      // old slot-1, shifted, intact
  });

  it('prepend (index 0) inherits the right neighbour cadence as the new first flame', () => {
    const tl = insertFlame(build3(), 0, gB);
    expect(tl.clips).toHaveLength(4);
    expect(tl.clips[0]!.flame.genome).toBe(gB);            // X is the new first
    expect(tl.clips[0]!.transitionDuration).toBe(12);      // old-first's outgoing evolve
    expect(tl.clips[0]!.easing).toEqual(lingerToEasing('strong'));
    expect(tl.clips[1]!.flame.genome).toBe(gA);            // old first, unchanged
  });

  it('index ≥ length behaves exactly like appendFlame', () => {
    const base = build3();
    expect(insertFlame(base, 99, gB)).toEqual(appendFlame(base, gB));
  });

  it('insert into an empty timeline → a single terminal clip', () => {
    const tl = insertFlame(createTimeline(), 0, gA);
    expect(tl.clips).toHaveLength(1);
    expect(tl.clips[0]!.transitionDuration).toBe(0);
    expect(tl.clips[0]!.duration).toBe(DEFAULT_HOLD);
  });

  it('prepend into a 1-clip timeline seeds DEFAULT_EVOLVE (no section-less clip)', () => {
    const one = appendFlame(createTimeline(), gA); // single terminal clip (td 0)
    const tl = insertFlame(one, 0, gB);
    expect(tl.clips).toHaveLength(2);
    expect(tl.clips[0]!.flame.genome).toBe(gB);
    expect(tl.clips[0]!.transitionDuration).toBe(DEFAULT_EVOLVE); // real section, not 0
    expect(tl.clips[1]!.transitionDuration).toBe(0); // terminal preserved
  });
});

describe('replaceClipFlame', () => {
  // A→B→C with section 0 = 12s/strong, flame-0 hold 0.5, section 1 = 8s.
  const build3 = () => {
    let tl = appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA);
    tl = setEvolve(tl, 0, 12);
    tl = setLinger(tl, 0, 'strong');
    tl = setPause(tl, 0, 0.5);
    tl = setEvolve(tl, 1, 8);
    return tl;
  };

  it('swaps in a new flame at the slot but keeps all per-slot cadence', () => {
    const tl = replaceClipFlame(build3(), 1, gA);
    expect(tl.clips).toHaveLength(3); // no growth — in-place
    expect(tl.clips[1]!.flame.genome).toBe(gA); // slot-1 flame replaced (was gB)
    // slot 0 keeps 12s/strong/0.5-hold; slot 1 keeps 8s; terminal stays 0.
    expect(tl.clips[0]!.transitionDuration).toBe(12);
    expect(tl.clips[0]!.easing).toEqual(lingerToEasing('strong'));
    expect(tl.clips[0]!.duration).toBe(0.5 + 12);
    expect(tl.clips[1]!.transitionDuration).toBe(8);
    expect(tl.clips[2]!.transitionDuration).toBe(0);
  });

  it('resets permutation on the touched pairs {i-1, i} only', () => {
    let tl = build3();
    tl = setPermutation(tl, 0, [1, 0]); // slot 0 → slot 1 (into the replaced flame)
    tl = setPermutation(tl, 1, [1, 0]); // slot 1 → slot 2 (out of the replaced flame)
    tl = replaceClipFlame(tl, 1, gA);
    expect(tl.clips[0]!.permutation).toBeUndefined(); // i-1 cleared
    expect(tl.clips[1]!.permutation).toBeUndefined(); // i cleared
  });

  it('leaves an unrelated permutation intact', () => {
    let tl = appendFlame(appendFlame(appendFlame(appendFlame(createTimeline(), gA), gB), gA), gB);
    tl = setPermutation(tl, 2, [1, 0]); // slot 2 → slot 3, untouched by replacing slot 0
    tl = replaceClipFlame(tl, 0, gB);
    expect(tl.clips[2]!.permutation).toEqual([1, 0]);
  });

  it('replacing the terminal flame preserves transitionDuration 0', () => {
    const tl = replaceClipFlame(build3(), 2, gB);
    expect(tl.clips[2]!.flame.genome).toBe(gB);
    expect(tl.clips[2]!.transitionDuration).toBe(0);
  });

  it('is a no-op on an out-of-range index', () => {
    const tl = build3();
    expect(replaceClipFlame(tl, -1, gB)).toBe(tl);
    expect(replaceClipFlame(tl, 99, gB)).toBe(tl);
  });
});
