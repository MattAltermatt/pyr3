import { type EasingCurve } from '../src/easing';

/** Parse an optional `--easing <json>` flag (a JSON EasingCurve[]). Returns
 *  undefined when the flag is absent. Throws on malformed JSON. */
export function parseEasingFlag(args: string[]): (EasingCurve | undefined)[] | undefined {
  const i = args.indexOf('--easing');
  if (i === -1) return undefined;
  const raw = args[i + 1];
  // A missing value, or a flag-lookalike next token (`--easing --verbose`), is a
  // missing argument — surface that rather than a misleading JSON.parse error.
  if (raw === undefined || raw.startsWith('--')) {
    throw new Error('--easing requires a JSON argument');
  }
  return JSON.parse(raw) as (EasingCurve | undefined)[];
}
