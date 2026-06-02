import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractWgslFn } from './extract';

describe('extractWgslFn', () => {
  it('extracts a single-line function body', () => {
    const src = 'fn foo() -> u32 { return 1u; }';
    expect(extractWgslFn(src, 'foo')).toBe('fn foo() -> u32 { return 1u; }');
  });

  it('extracts a multi-line function with nested braces', () => {
    const src = [
      'fn foo(a: u32) -> u32 {',
      '  if (a > 0u) {',
      '    return 1u;',
      '  } else {',
      '    return 2u;',
      '  }',
      '}',
    ].join('\n');
    expect(extractWgslFn(src, 'foo')).toBe(src);
  });

  it('ignores other functions in the source', () => {
    const src = 'fn bar() { return 0u; }\nfn foo() { return 1u; }\nfn baz() { return 2u; }';
    expect(extractWgslFn(src, 'foo')).toBe('fn foo() { return 1u; }');
  });

  it('throws when the function is not present', () => {
    expect(() => extractWgslFn('fn bar() {}', 'foo')).toThrow(/foo/);
  });

  it('ignores `}` inside line comments', () => {
    const src = [
      'fn foo() -> u32 {',
      '  // closing brace } in comment must not decrement depth',
      '  return 1u;',
      '}',
    ].join('\n');
    expect(extractWgslFn(src, 'foo')).toBe(src);
  });

  it('ignores `}` inside block comments', () => {
    const src = [
      'fn foo() -> u32 {',
      '  /* closing brace } in block comment',
      '     spans multiple lines and contains } too */',
      '  return 1u;',
      '}',
    ].join('\n');
    expect(extractWgslFn(src, 'foo')).toBe(src);
  });

  it('extracts atomic_add_sat verbatim from the real chaos.wgsl', () => {
    const wgsl = readFileSync(new URL('./chaos.wgsl', import.meta.url), 'utf8');
    const fn = extractWgslFn(wgsl, 'atomic_add_sat');
    expect(fn.startsWith('fn atomic_add_sat')).toBe(true);
    expect(fn).toContain('atomicCompareExchangeWeak');
    expect(fn.endsWith('}')).toBe(true);
  });
});
