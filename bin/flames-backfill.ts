// Pass 2: fill json/ with any live gallery flame that has no incoming source, by
// decoding the committed gen-1000 chunks. Each chunk stores the canonical pyr3-JSON
// string per id, so a backfilled file is written verbatim (no genomeToJson).
//
// DRIFT GUARD: a chunk entry whose content does NOT hash to its claimed id means the
// stored form diverged from the ledger identity — throw loudly rather than write a
// misnamed file (see the design spec's identity rule).
//
//   --root DIR  flames root (default ~/pyr3-flames); writes DIR/json.
//   --apply     perform the writes (default dry-run).
import { readdirSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { jsonName } from './native-bake/flames-fs';
import { canonicalFlameHash } from './native-bake/canonical-hash';
import { emptyLedger, type Ledger } from './native-bake/ledger';
import type { Pyr3JsonV1 } from '../src/serialize';

export interface BackfillPlan { writes: { id: number; json: string }[]; }

export function planBackfill(chunkDir: string, jsonDir: string, ledger: Ledger): BackfillPlan {
  const writes: { id: number; json: string }[] = [];
  for (const f of readdirSync(chunkDir)) {
    if (!f.endsWith('.flam3chunk')) continue;
    const obj = JSON.parse(brotliDecompressSync(readFileSync(join(chunkDir, f))).toString()) as Record<string, string>;
    for (const [idStr, jsonStr] of Object.entries(obj)) {
      // Chunks carry a non-flame `_v: 'pyr3-natives'` format sentinel (stamped by
      // pyr3-bake-natives). Only numeric keys are flame ids.
      if (!/^\d+$/.test(idStr)) continue;
      const id = Number(idStr);
      if (existsSync(join(jsonDir, jsonName(id)))) continue;
      const h = canonicalFlameHash(JSON.parse(jsonStr) as Pyr3JsonV1);
      if (ledger.entries[h]?.id !== id) {
        throw new Error(
          `hash/id drift: chunk id ${id} content hashes to ${h.slice(0, 12)}… ` +
            `(ledger id ${ledger.entries[h]?.id ?? 'none'}). Refusing to write a misnamed json/ file.`,
        );
      }
      writes.push({ id, json: jsonStr });
    }
  }
  writes.sort((a, b) => a.id - b.id);
  return { writes };
}

function loadLedger(): Ledger {
  const p = join(process.cwd(), 'flames/pyr3-natives/ledger.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Ledger) : emptyLedger();
}

function main(): void {
  const argv = process.argv;
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1]! : join(homedir(), 'pyr3-flames');
  const apply = argv.includes('--apply');
  const chunkDir = join(process.cwd(), 'public/chunks/1000');
  const jsonDir = join(root, 'json');
  const plan = planBackfill(chunkDir, jsonDir, loadLedger());
  console.log(`backfill — ${apply ? 'APPLY' : 'DRY-RUN'} — ${plan.writes.length} missing json/ file(s)`);
  for (const w of plan.writes) console.log(`  write json/${jsonName(w.id)}`);
  if (!apply) { console.log('  (dry-run — pass --apply to perform)'); return; }
  mkdirSync(jsonDir, { recursive: true });
  for (const w of plan.writes) writeFileSync(join(jsonDir, jsonName(w.id)), w.json);
  console.log('  done.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
