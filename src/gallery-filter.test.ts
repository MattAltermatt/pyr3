import { describe, it, expect, vi } from 'vitest';
import {
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
      vars: [],
      xformMin: 1,
      xformMax: null,
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
    const a: FilterSpec = { sort: 'interest', vars: [3, 14], xformMin: 2, xformMax: 8 };
    const b: FilterSpec = { sort: 'interest', vars: [3, 14], xformMin: 2, xformMax: 8 };
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

  it('unknown sort value silently falls back to default', () => {
    expect(parse('sort=garbage').sort).toBe('time');
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
});

describe('encodeFilterSpec', () => {
  it('default spec → empty params', () => {
    expect(encodeFilterSpec(DEFAULT_FILTER_SPEC).toString()).toBe('');
  });

  it('non-default sort emitted', () => {
    const p = encodeFilterSpec({ ...DEFAULT_FILTER_SPEC, sort: 'interest' });
    expect(p.get('sort')).toBe('interest');
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
});

describe('FilterSpec round-trip', () => {
  it('parse(encode(spec)) === spec for various specs', () => {
    const specs: FilterSpec[] = [
      DEFAULT_FILTER_SPEC,
      { sort: 'interest', vars: [V.julia], xformMin: 1, xformMax: null },
      { sort: 'time', vars: [V.linear, V.julia, V.spherical].sort((a, b) => a - b), xformMin: 3, xformMax: 7 },
      { sort: 'interest', vars: [], xformMin: 2, xformMax: null },
      { sort: 'interest', vars: [], xformMin: 1, xformMax: 8 },
    ];
    for (const s of specs) {
      const round = parseFilterSpec(encodeFilterSpec(s));
      expect(filterSpecEquals(round, s)).toBe(true);
    }
  });
});
