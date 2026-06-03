import { describe, expect, it, vi } from 'vitest';
import {
  pathLane,
  createLaneScheduler,
  createEditState,
  type Clock,
} from './edit-state';
import { generateRandomGenome } from './edit-seed';

describe('pathLane', () => {
  it('maps render-dim / oversample / filter to rebuild', () => {
    expect(pathLane('size.width')).toBe('rebuild');
    expect(pathLane('size.height')).toBe('rebuild');
    expect(pathLane('oversample')).toBe('rebuild');
    expect(pathLane('spatialFilter.radius')).toBe('rebuild');
  });

  it('maps xforms / final / viewport / symmetry to slow', () => {
    expect(pathLane('xforms.0.weight')).toBe('slow');
    expect(pathLane('xforms.2.variations.0.weight')).toBe('slow');
    expect(pathLane('xforms.1.post.a')).toBe('slow');
    expect(pathLane('xforms.0.xaos.1')).toBe('slow');
    expect(pathLane('finalxform.opacity')).toBe('slow');
    expect(pathLane('scale')).toBe('slow');
    expect(pathLane('cx')).toBe('slow');
    expect(pathLane('cy')).toBe('slow');
    expect(pathLane('rotate')).toBe('slow');
    expect(pathLane('symmetry.n')).toBe('slow');
  });

  it('maps palette (swap/hue/mode) to slow — chaos.wgsl bakes palette RGB into the histogram', () => {
    expect(pathLane('palette')).toBe('slow');
    expect(pathLane('palette.hue')).toBe('slow');
    expect(pathLane('palette.mode')).toBe('slow');
  });

  it('maps tonemap / density / background / meta to fast (present-only)', () => {
    expect(pathLane('tonemap.brightness')).toBe('fast');
    expect(pathLane('tonemap.gamma')).toBe('fast');
    expect(pathLane('tonemap.vibrancy')).toBe('fast');
    expect(pathLane('tonemap.highlightPower')).toBe('fast');
    expect(pathLane('tonemap.gammaThreshold')).toBe('fast');
    expect(pathLane('density.maxRad')).toBe('fast');
    expect(pathLane('density.minRad')).toBe('fast');
    expect(pathLane('density.curve')).toBe('fast');
    expect(pathLane('background')).toBe('fast');
    expect(pathLane('name')).toBe('fast');
    expect(pathLane('nick')).toBe('fast');
  });

  it('unknown path defaults to fast (cheapest safe option)', () => {
    expect(pathLane('somethingUnknown')).toBe('fast');
    expect(pathLane('nested.unknown.field')).toBe('fast');
  });
});

interface ManualClock extends Clock {
  advance(ms: number): void;
}

function fakeClock(): ManualClock {
  interface Timer {
    id: number;
    fn: () => void;
    due: number;
  }
  const timers: Timer[] = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const t: Timer = { id: nextId++, fn, due: now + ms };
      timers.push(t);
      return t.id;
    },
    clearTimeout(id) {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx >= 0) timers.splice(idx, 1);
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((t) => t.due <= now).sort((a, b) => a.due - b.due);
      for (const t of due) {
        const i = timers.indexOf(t);
        if (i >= 0) timers.splice(i, 1);
        t.fn();
      }
    },
  };
}

describe('createLaneScheduler', () => {
  it('coalesces multiple edits in the same lane within the debounce window', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.schedule({ lane: 'fast', path: 'tonemap.gamma' });
    clock.advance(15);
    expect(onFire).not.toHaveBeenCalled();
    clock.advance(2); // total 17 — past the 16ms fast debounce
    expect(onFire).toHaveBeenCalledTimes(1);
    const [lane, paths] = onFire.mock.calls[0]!;
    expect(lane).toBe('fast');
    expect(paths).toEqual(expect.arrayContaining(['palette.hue', 'tonemap.gamma']));
  });

  it('runs the three lanes on independent timers', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.schedule({ lane: 'slow', path: 'xforms.0.weight' });
    s.schedule({ lane: 'rebuild', path: 'size.width' });

    clock.advance(20);
    expect(onFire).toHaveBeenCalledWith('fast', ['palette.hue']);
    expect(onFire).toHaveBeenCalledTimes(1);

    clock.advance(100); // total 120 — past slow's 100ms
    expect(onFire).toHaveBeenCalledWith('slow', ['xforms.0.weight']);
    expect(onFire).toHaveBeenCalledTimes(2);

    clock.advance(100); // total 220 — past rebuild's 200ms
    expect(onFire).toHaveBeenCalledWith('rebuild', ['size.width']);
    expect(onFire).toHaveBeenCalledTimes(3);
  });

  it('flush(lane) fires pending paths for that lane immediately', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'rebuild', path: 'size.width' });
    s.schedule({ lane: 'rebuild', path: 'size.height' });
    s.flush('rebuild');
    expect(onFire).toHaveBeenCalledTimes(1);
    const [lane, paths] = onFire.mock.calls[0]!;
    expect(lane).toBe('rebuild');
    expect(paths).toEqual(expect.arrayContaining(['size.width', 'size.height']));
  });

  it('flush() with no arg fires every lane', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'a' });
    s.schedule({ lane: 'slow', path: 'b' });
    s.schedule({ lane: 'rebuild', path: 'c' });
    s.flush();
    expect(onFire).toHaveBeenCalledTimes(3);
  });

  it('cancel() drops pending and clears timers', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.cancel();
    clock.advance(100);
    expect(onFire).not.toHaveBeenCalled();
  });

  it('re-scheduling the same path within window does not duplicate the fire', () => {
    const clock = fakeClock();
    const onFire = vi.fn();
    const s = createLaneScheduler(onFire, { clock });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    s.schedule({ lane: 'fast', path: 'palette.hue' });
    clock.advance(20);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith('fast', ['palette.hue']);
  });
});

describe('createEditState', () => {
  it('starts with all 7 sections expanded (collapse = false)', () => {
    const st = createEditState(generateRandomGenome(() => 0.5), 1);
    expect(st.sectionCollapse.palette).toBe(false);
    expect(st.sectionCollapse.viewport).toBe(false);
    expect(st.sectionCollapse.xforms).toBe(false);
    expect(st.sectionCollapse.final).toBe(false);
    expect(st.sectionCollapse.global).toBe(false);
    expect(st.sectionCollapse.density).toBe(false);
    expect(st.sectionCollapse.render).toBe(false);
  });

  it('records the seed and a default preview size', () => {
    const g = generateRandomGenome(() => 0.5);
    const st = createEditState(g, 12345);
    expect(st.seed).toBe(12345);
    expect(st.preview.width).toBeGreaterThan(0);
    expect(st.preview.height).toBeGreaterThan(0);
    expect(st.genome).toBe(g);
  });
});
