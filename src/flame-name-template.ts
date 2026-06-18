// Flame name template resolver (#104).
//
// Lets a flame name be authored as a template — e.g. `{palette}-{date}-{index}`
// — that resolves at save time to `south-sea-bather-20260603-0001`. The
// genome's `name` field stores the LITERAL template so re-opening the file
// preserves editability; only the filename uses the resolved form.
//
// Escape rules: `{{` and `}}` produce literal `{` / `}` (Python f-string,
// Handlebars, every common template syntax convention). Unknown placeholders
// stay literal in the output — safer than silently dropping.

import type { Genome } from './genome';
import { distinctVariationNames } from './genome';

export interface TemplateContext {
  genome: Genome;
  /** Editor's current ISAAC seed — surfaced via `{seed}` as 8-char hex.
   *  pyr3 genomes don't carry their own chaos seed, so the editor's session
   *  seed is the closest "identifies this render" value we have. */
  seed: number;
  /** Used by `{date}`, `{time}`, `{datetime}`. Caller supplies so tests can
   *  pin the clock. Production code passes `new Date()` at save time. */
  now: Date;
  /** Pre-resolved counter for `{index}` — the caller supplies the value.
   *  Padded to 4 digits when 1..9999, natural width past 9999. */
  index: number;
  /** Pre-resolved random 4-char lowercase hex for `{random}`. Caller
   *  generates once per resolve so preview + save match if needed. */
  random: string;
}

const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g;

/** Tokenize and return any placeholder name present. Excludes `{{` / `}}`
 *  escapes by stripping them first. */
export function extractPlaceholders(name: string): string[] {
  const stripped = name.replace(/\{\{/g, '\0').replace(/\}\}/g, '\0');
  const found: string[] = [];
  let m: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((m = PLACEHOLDER_RE.exec(stripped)) !== null) {
    found.push(m[1]!);
  }
  return found;
}

/** Quick check — does the input contain any unescaped `{placeholder}`? */
export function hasTemplate(name: string): boolean {
  return extractPlaceholders(name).length > 0;
}

function pad4(n: number): string {
  if (n >= 10000) return String(n);
  return String(n).padStart(4, '0');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function resolvePlaceholder(name: string, c: TemplateContext): string | null {
  const g = c.genome;
  switch (name) {
    case 'date':        return yyyymmdd(c.now);
    case 'time':        return hhmm(c.now);
    case 'datetime':    return `${yyyymmdd(c.now)}-${hhmm(c.now)}`;
    case 'nick':        return g.nick ?? '';
    case 'seed':        return (c.seed >>> 0).toString(16).padStart(8, '0');
    case 'xforms':      return String(g.xforms.length);
    case 'vars':        return distinctVariationNames(g).join('.');
    case 'palette':     return g.palette.name;
    case 'palette-idx': return ''; // pyr3 genomes don't track library index
    case 'width':       return g.size?.width  !== undefined ? String(g.size.width)  : '';
    case 'height':      return g.size?.height !== undefined ? String(g.size.height) : '';
    case 'quality':
    case 'spp':         return g.quality !== undefined ? String(g.quality) : '';
    case 'random':      return c.random;
    case 'index':       return pad4(c.index);
    default:            return null; // unknown — keep literal
  }
}

/** Resolve a template string against a context. Escapes (`{{` / `}}`) are
 *  honored; unknown placeholders stay literal in the output (so a typo
 *  like `{palete}` survives instead of vanishing). */
export function resolveTemplate(name: string, c: TemplateContext): string {
  // Two-pass approach: replace escapes with NUL sentinels, do placeholder
  // substitution, then restore. Avoids the "is this { part of an escape?"
  // lookbehind dance.
  const ESC_OPEN  = '\x01';
  const ESC_CLOSE = '\x02';
  const withSentinels = name.replace(/\{\{/g, ESC_OPEN).replace(/\}\}/g, ESC_CLOSE);
  const substituted = withSentinels.replace(PLACEHOLDER_RE, (match, key: string) => {
    const v = resolvePlaceholder(key, c);
    return v === null ? match : v;
  });
  return substituted.replace(new RegExp(ESC_OPEN, 'g'), '{').replace(new RegExp(ESC_CLOSE, 'g'), '}');
}
