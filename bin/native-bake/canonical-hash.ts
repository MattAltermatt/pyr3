// bin/native-bake/canonical-hash.ts
// Content hash for dedup (#435). Hashes the pyr3-JSON form (Pyr3JsonV1 — what
// genomeToJson emits and what a pyr3 PNG embeds), NOT the in-memory Genome:
// the JSON carries version/viewport/etc., and the bake already has it parsed
// from the PNG. Covers the flame's visual DEFINITION only — a denylist strips
// metadata + render-output settings so the same flame re-saved at a different
// size/quality, or renamed, collapses to one ledger entry. Denylist (not an
// allowlist) so any future flame-defining field is auto-included.
import { createHash } from 'node:crypto';
import type { Pyr3JsonV1 } from '../../src/serialize';

/** JSON keys that are NOT part of the flame's visual identity. */
const IGNORED_KEYS = ['name', 'nick', 'size', 'quality', 'oversample', 'time'] as const;

/** The identity-bearing subset of a pyr3-JSON flame (metadata stripped). */
export function hashedSubset(json: Pyr3JsonV1): Record<string, unknown> {
  const out: Record<string, unknown> = { ...json };
  for (const k of IGNORED_KEYS) delete out[k];
  return out;
}

/** Deterministic JSON.stringify with recursively sorted object keys. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

export function canonicalFlameHash(json: Pyr3JsonV1): string {
  return createHash('sha256').update(stableStringify(hashedSubset(json))).digest('hex');
}
