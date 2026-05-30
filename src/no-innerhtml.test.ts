// PYR3-065: enforce the load-bearing no-innerHTML XSS invariant as a test,
// not just a convention/comment. The viewer ships to a public domain and
// consumes arbitrary user-supplied `.flame` files whose `name` etc. flow into
// the DOM — all DOM text must go through `textContent` / createElement, never
// an HTML-string sink. This scans the shipped source for the dangerous sinks.
//
// (No ESLint config exists in the repo; this build-source grep test is the
// lighter equivalent of an `no-restricted-properties` rule.)

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// Match real usage (assignment to the property, or the method call), NOT the
// many prose mentions of "no-innerHTML" in comments.
const FORBIDDEN = [
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /\.insertAdjacentHTML\s*\(/,
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    // Shipped TS source only; skip tests (this file references the tokens in
    // its own regexes) and non-TS assets.
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('no-innerHTML XSS invariant', () => {
  it('no src/*.ts file assigns innerHTML/outerHTML or calls insertAdjacentHTML', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const re of FORBIDDEN) {
          if (re.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders, `forbidden HTML sink(s):\n${offenders.join('\n')}`).toEqual([]);
  });
});
