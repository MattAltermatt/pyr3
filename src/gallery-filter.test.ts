import { describe, it, expect, vi } from 'vitest';
import {
  countActiveAxes,
  DEFAULT_FILTER_SPEC,
  encodeFilterSpec,
  filterSpecEquals,
  isDefaultFilterSpec,
  parseFilterSpec,
  type FilterSpec,
} from './gallery-filter';
import { V } from './variations';

describe('FilterSpec defaults', () => {
  it('default spec is the canonical no-filter state', () => {
    expect(DEFAULT_FILTER_SPEC).toEqual({
      sort: 'time',
      sortDir: 'desc',
      vars: [],
      xformMin: 1,
      xformMax: null,
      coverageMin: 0,
      coverageMax: null,
      entropyMin: 0,
      entropyMax: null,
      colorVarMin: 0,
      colorVarMax: null,
      meanLumMin: 0,
      meanLumMax: null,
    });
  });

  it('isDefaultFilterSpec returns true for the default', () => {
    expect(isDefaultFilterSpec(DEFAULT_FILTER_SPEC)).toBe(true);
  });

  it('isDefaultFilterSpec returns false when any axis differs', () => {
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: 'interest' })).toBe(false);
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, vars: [14] })).toBe(false);
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 2 })).toBe(false);
    expect(isDefaultFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMax: 8 })).toBe(false);
  });

  it('filterSpecEquals compares structurally (vars kept sorted asc by class invariant)', () => {
    const a: FilterSpec = { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [3, 14], xformMin: 2, xformMax: 8 };
    const b: FilterSpec = { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [3, 14], xformMin: 2, xformMax: 8 };
    expect(filterSpecEquals(a, b)).toBe(true);
    expect(filterSpecEquals(a, { ...a, sort: 'time' })).toBe(false);
    expect(filterSpecEquals(a, { ...a, vars: [3] })).toBe(false);
    expect(filterSpecEquals(a, { ...a, xformMin: 1 })).toBe(false);
    expect(filterSpecEquals(a, { ...a, xformMax: null })).toBe(false);
  });
});

describe('parseFilterSpec', () => {
  const parse = (qs: string): FilterSpec =>
    parseFilterSpec(new URLSearchParams(qs));

  it('empty querystring → DEFAULT_FILTER_SPEC', () => {
    expect(parse('')).toEqual(DEFAULT_FILTER_SPEC);
  });

  it('sort=interest is honored', () => {
    expect(parse('sort=interest').sort).toBe('interest');
  });

  it('all 5 non-default sort names are recognized', () => {
    expect(parse('sort=interest').sort).toBe('interest');
    expect(parse('sort=coverage').sort).toBe('coverage');
    expect(parse('sort=entropy').sort).toBe('entropy');
    expect(parse('sort=colorVar').sort).toBe('colorVar');
    expect(parse('sort=meanLum').sort).toBe('meanLum');
  });

  it('unknown sort value silently falls back to default', () => {
    expect(parse('sort=garbage').sort).toBe('time');
  });

  it('custom is NOT yet recognized (deferred to Phase E) — falls back to time', () => {
    expect(parse('sort=custom').sort).toBe('time');
  });

  it('vars=julia,linear → sorted variation indices', () => {
    const out = parse('vars=julia,linear');
    expect(out.vars).toEqual([V.linear, V.julia].sort((a, b) => a - b));
  });

  it('vars with unknown name silently drops it', () => {
    const out = parse('vars=julia,not_a_real_variation');
    expect(out.vars).toEqual([V.julia]);
  });

  it('vars with unknown name console.warns about the dropped tokens', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      parse('vars=bubbles,julia');  // 'bubbles' is plural typo of 'bubble'
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('bubbles');
      expect(warn.mock.calls[0]?.[0]).toContain('unknown variation');
    } finally {
      warn.mockRestore();
    }
  });

  it('vars with only valid names does NOT warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      parse('vars=julia,linear');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('vars deduplicates within the param', () => {
    const out = parse('vars=julia,julia,linear');
    expect(out.vars).toEqual([V.linear, V.julia].sort((a, b) => a - b));
  });

  it('xforms=2-8 sets both bounds', () => {
    const out = parse('xforms=2-8');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(8);
  });

  it('xforms=2-all sets min only, max=null', () => {
    const out = parse('xforms=2-all');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(null);
  });

  it('xforms=2- (empty max) also means open-ended', () => {
    const out = parse('xforms=2-');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(null);
  });

  it('xforms=garbage silently falls back to defaults', () => {
    const out = parse('xforms=hello');
    expect(out.xformMin).toBe(1);
    expect(out.xformMax).toBe(null);
  });

  it('xforms with max<min auto-swaps', () => {
    const out = parse('xforms=8-2');
    expect(out.xformMin).toBe(2);
    expect(out.xformMax).toBe(8);
  });

  it('xformMin clamps to ≥ 1', () => {
    const out = parse('xforms=0-5');
    expect(out.xformMin).toBe(1);
  });

  it('bare integer xforms=N means "at least N" (min=N, max=null)', () => {
    const out = parse('xforms=5');
    expect(out.xformMin).toBe(5);
    expect(out.xformMax).toBe(null);
  });

  it('bare integer xforms=6 round-trips with xforms=6- (both mean ≥6)', () => {
    const bare = parse('xforms=6');
    const dashed = parse('xforms=6-');
    expect(bare).toEqual(dashed);
  });

  it('exact-match stays expressible as xforms=N-N', () => {
    const out = parse('xforms=6-6');
    expect(out.xformMin).toBe(6);
    expect(out.xformMax).toBe(6);
  });

  it('bare integer xforms=0 falls back to defaults (clamp guards min at 1)', () => {
    const out = parse('xforms=0');
    expect(out.xformMin).toBe(1);
    expect(out.xformMax).toBe(null);
  });

  it('order=asc → sortDir asc', () => {
    expect(parse('order=asc').sortDir).toBe('asc');
  });
  it('order=desc → sortDir desc (default)', () => {
    expect(parse('order=desc').sortDir).toBe('desc');
  });
  it('omitted order → sortDir desc (default)', () => {
    expect(parse('').sortDir).toBe('desc');
  });
  it('unknown order value → sortDir desc (default)', () => {
    expect(parse('order=sideways').sortDir).toBe('desc');
  });

  it('coverage=0.5-0.9 sets both stat bounds', () => {
    const out = parse('coverage=0.5-0.9');
    expect(out.coverageMin).toBe(0.5);
    expect(out.coverageMax).toBe(0.9);
  });
  it('bare coverage=0.5 sets min only (≥0.5)', () => {
    const out = parse('coverage=0.5');
    expect(out.coverageMin).toBe(0.5);
    expect(out.coverageMax).toBe(null);
  });
  it('coverage=0.5-all = bare coverage=0.5', () => {
    expect(parse('coverage=0.5-all')).toEqual(parse('coverage=0.5'));
  });
  it('coverage out-of-range clamps to 0..1', () => {
    expect(parse('coverage=1.5-2.0').coverageMin).toBe(1);
    expect(parse('coverage=1.5-2.0').coverageMax).toBe(1);
    expect(parse('coverage=-0.5-0.3').coverageMin).toBe(0);
  });
  it('all 4 stat axes parse independently', () => {
    const out = parse('coverage=0.3-0.7&entropy=0.5&colorVar=0.2-0.6&meanLum=0.4');
    expect(out.coverageMin).toBe(0.3);
    expect(out.coverageMax).toBe(0.7);
    expect(out.entropyMin).toBe(0.5);
    expect(out.entropyMax).toBe(null);
    expect(out.colorVarMin).toBe(0.2);
    expect(out.colorVarMax).toBe(0.6);
    expect(out.meanLumMin).toBe(0.4);
    expect(out.meanLumMax).toBe(null);
  });
});

describe('encodeFilterSpec', () => {
  it('default spec → empty params', () => {
    expect(encodeFilterSpec(DEFAULT_FILTER_SPEC).toString()).toBe('');
  });

  it('non-default sort emitted', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: 'interest' });
    expect(p.get('sort')).toBe('interest');
  });

  it('each named sort preset emits its name', () => {
    for (const s of ['interest', 'coverage', 'entropy', 'colorVar', 'meanLum'] as const) {
      const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: s });
      expect(p.get('sort')).toBe(s);
    }
  });

  it('default sort=time is omitted', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: 'time' });
    expect(p.has('sort')).toBe(false);
  });

  it('vars emitted as comma-separated names, alphabetical', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, vars: [V.julia, V.linear].sort((a, b) => a - b) });
    expect(p.get('vars')).toBe('julia,linear');
  });

  it('xform range emits N-M when bounded', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: 8 });
    expect(p.get('xforms')).toBe('2-8');
  });

  it('xform range emits compact bare N when unbounded above', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: null });
    expect(p.get('xforms')).toBe('2');
  });

  it('xformMin=1 + xformMax=8 emits 1-8', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 1, xformMax: 8 });
    expect(p.get('xforms')).toBe('1-8');
  });

  it('exact-match xformMin=xformMax emits N-N (distinguishable from bare ≥N)', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, xformMin: 6, xformMax: 6 });
    expect(p.get('xforms')).toBe('6-6');
  });

  it('sortDir asc emits order=asc', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sortDir: 'asc' });
    expect(p.get('order')).toBe('asc');
  });

  it('sortDir desc (default) is omitted', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sortDir: 'desc' });
    expect(p.get('order')).toBe(null);
  });

  it('stat-range default (0..null) is omitted', () => {
    const p = encodeFilterSpec(DEFAULT_FILTER_SPEC);
    expect(p.get('coverage')).toBe(null);
    expect(p.get('entropy')).toBe(null);
    expect(p.get('colorVar')).toBe(null);
    expect(p.get('meanLum')).toBe(null);
  });

  it('non-default stat range emits N-M when bounded', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, coverageMin: 0.3, coverageMax: 0.7 });
    expect(p.get('coverage')).toBe('0.3-0.7');
  });

  it('non-default stat range emits compact bare N when unbounded above', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, entropyMin: 0.5, entropyMax: null });
    expect(p.get('entropy')).toBe('0.5');
  });

  it('all 4 stat ranges emit independently', () => {
    const p = encodeFilterSpec({
      ...DEFAULT_FILTER_SPEC,
      coverageMin: 0.3, coverageMax: 0.7,
      entropyMin: 0.5, entropyMax: null,
      colorVarMin: 0.2, colorVarMax: 0.6,
      meanLumMin: 0.4, meanLumMax: null,
    });
    expect(p.get('coverage')).toBe('0.3-0.7');
    expect(p.get('entropy')).toBe('0.5');
    expect(p.get('colorVar')).toBe('0.2-0.6');
    expect(p.get('meanLum')).toBe('0.4');
  });
});

describe('countActiveAxes', () => {
  it('default → 0', () => {
    expect(countActiveAxes(DEFAULT_FILTER_SPEC)).toBe(0);
  });
  it('sort changed → 1', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, sort: 'interest' })).toBe(1);
  });
  it('vars set → 1 regardless of count', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, vars: [13] })).toBe(1);
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, vars: [13, 0, 20] })).toBe(1);
  });
  it('xform min OR max changed → 1', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, xformMin: 2 })).toBe(1);
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, xformMax: 8 })).toBe(1);
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, xformMin: 2, xformMax: 8 })).toBe(1);
  });
  it('all three axes → 3', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [13], xformMin: 2, xformMax: 8 })).toBe(3);
  });
  it('sortDir asc on default sort → 1 (still part of the sort axis)', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, sortDir: 'asc' })).toBe(1);
  });
  it('sort and sortDir both non-default → still 1 axis (bundled)', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, sort: 'interest', sortDir: 'asc' })).toBe(1);
  });
  it('each non-default stat range counts as 1 axis', () => {
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, coverageMin: 0.3 })).toBe(1);
    expect(countActiveAxes({ ...DEFAULT_FILTER_SPEC, entropyMax: 0.7 })).toBe(1);
    expect(countActiveAxes({
      ...DEFAULT_FILTER_SPEC,
      coverageMin: 0.3, entropyMax: 0.7, colorVarMin: 0.5, meanLumMin: 0.2,
    })).toBe(4);
  });
});

describe('FilterSpec round-trip', () => {
  it('parse(encode(spec)) === spec for various specs', () => {
    const specs: FilterSpec[] = [
      DEFAULT_FILTER_SPEC,
      { ...DEFAULT_FILTER_SPEC, sort: 'interest', vars: [V.julia] },
      { ...DEFAULT_FILTER_SPEC, vars: [V.linear, V.julia, V.spherical].sort((a, b) => a - b), xformMin: 3, xformMax: 7 },
      { ...DEFAULT_FILTER_SPEC, sortDir: 'asc' },
      { ...DEFAULT_FILTER_SPEC, sort: 'interest', sortDir: 'asc', xformMin: 2 },
      { ...DEFAULT_FILTER_SPEC, sort: 'interest', xformMin: 1, xformMax: 8 },
      { ...DEFAULT_FILTER_SPEC, sort: 'coverage' },
      { ...DEFAULT_FILTER_SPEC, sort: 'entropy', sortDir: 'asc' },
      { ...DEFAULT_FILTER_SPEC, sort: 'colorVar' },
      { ...DEFAULT_FILTER_SPEC, sort: 'meanLum' },
      // Stat ranges round-trip via parse/encode.
      { ...DEFAULT_FILTER_SPEC, coverageMin: 0.3, coverageMax: 0.7 },
      { ...DEFAULT_FILTER_SPEC, entropyMin: 0.5 },
      { ...DEFAULT_FILTER_SPEC, colorVarMin: 0.2, colorVarMax: 0.6 },
      { ...DEFAULT_FILTER_SPEC, meanLumMin: 0.4 },
      // All four stat axes + sort + variations + xforms combined.
      {
        ...DEFAULT_FILTER_SPEC,
        sort: 'coverage', sortDir: 'asc',
        vars: [V.julia],
        xformMin: 3, xformMax: 8,
        coverageMin: 0.4, coverageMax: 0.9,
        entropyMin: 0.5,
        colorVarMin: 0.3, colorVarMax: 0.7,
        meanLumMin: 0.2,
      },
    ];
    for (const s of specs) {
      const round = parseFilterSpec(encodeFilterSpec(s));
      expect(filterSpecEquals(round, s)).toBe(true);
    }
  });
});
