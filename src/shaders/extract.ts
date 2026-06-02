// Pull a named `fn name(...) { ... }` block verbatim from a WGSL source string,
// using brace-balance to handle nested `{` / `}` (the chaos.wgsl helpers do
// contain them, so the prior ad-hoc regex pattern in chaos-saturate.gpu.test.ts
// was unsafe in general). Returns the function source from the `fn` keyword
// through the matching closing `}` inclusive.
//
// The brace-balancer skips `//` line comments and `/* */` block comments so a
// `}` inside a comment doesn't decrement depth prematurely. WGSL strings would
// be a third concern but the language has no string literals in function bodies.

export function extractWgslFn(source: string, fnName: string): string {
  const pattern = new RegExp(`\\bfn\\s+${fnName}\\s*\\(`);
  const startMatch = pattern.exec(source);
  if (!startMatch) {
    throw new Error(`extractWgslFn: function "${fnName}" not found in source`);
  }
  const fnStart = startMatch.index;
  const braceOpen = source.indexOf('{', fnStart);
  if (braceOpen === -1) {
    throw new Error(`extractWgslFn: function "${fnName}" has no body`);
  }
  let depth = 1;
  let i = braceOpen + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      // Line comment — skip to end of line.
      const nl = source.indexOf('\n', i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      // Block comment — skip to closing `*/`.
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) {
    throw new Error(`extractWgslFn: unbalanced braces in "${fnName}"`);
  }
  return source.slice(fnStart, i);
}
