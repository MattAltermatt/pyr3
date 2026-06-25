// Pass 1 (match-only) + Pass 3 step 1 (--add-new): incoming/ → json/<id>.pyr3.json.
//
// IDENTITY RULE: writes the RAW parsed pyr3-JSON (w.json), never genomeToJson — so a
// json/<id>.pyr3.json file always re-hashes to its own gallery id. See the design spec.
//
// Modes:
//   (default)   match-only — only file flames already in the ledger; leave the rest.
//   --add-new   mint a new id (ledgerAppend) for any flame not yet in the ledger.
//   (default)   dry-run — print the plan, mutate nothing.
//   --apply     perform the writes + delete consumed incoming sources (+ save ledger).
//   --root DIR  flames root (default ~/pyr3-flames); reads DIR/incoming, writes DIR/json.
import { readdirSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadIncomingGenomeJson, jsonName } from './native-bake/flames-fs';
import { canonicalFlameHash } from './native-bake/canonical-hash';
import { emptyLedger, ledgerHas, ledgerAppend, type Ledger } from './native-bake/ledger';

export interface PlanWrite { id: number; hash: string; sources: string[]; json: string; }
export interface IngestPlan { writes: PlanWrite[]; left: string[]; newIds: number[]; }

const LEDGER_PATH = join(process.cwd(), 'flames/pyr3-natives/ledger.json');

/** Pure: compute the writes/deletes + the (possibly appended) ledger. No fs writes. */
export function planIngest(incomingDir: string, ledger: Ledger, addNew: boolean): { plan: IngestPlan; ledger: Ledger } {
  const byHash = new Map<string, { sources: string[]; json: string }>();
  const left: string[] = [];
  for (const f of readdirSync(incomingDir)) {
    const lower = f.toLowerCase();
    if (!lower.endsWith('.png') && !lower.endsWith('.json')) continue;
    const parsed = loadIncomingGenomeJson(join(incomingDir, f));
    if (!parsed) { console.warn(`skip (not a pyr3 flame): ${f}`); continue; }
    const hash = canonicalFlameHash(parsed);
    if (!ledgerHas(ledger, hash) && !addNew) { left.push(f); continue; }
    const rec = byHash.get(hash);
    if (rec) rec.sources.push(f);
    else byHash.set(hash, { sources: [f], json: JSON.stringify(parsed) });
  }
  const writes: PlanWrite[] = [];
  const newIds: number[] = [];
  let next = ledger;
  for (const [hash, rec] of byHash) {
    if (!ledgerHas(next, hash)) { next = ledgerAppend(next, hash); newIds.push(next.entries[hash]!.id); }
    writes.push({ id: next.entries[hash]!.id, hash, sources: rec.sources.sort(), json: rec.json });
  }
  writes.sort((a, b) => a.id - b.id);
  newIds.sort((a, b) => a - b);
  return { plan: { writes, left: left.sort(), newIds }, ledger: next };
}

/** Write json/<id>.pyr3.json for each planned flame, then delete its consumed sources. */
export function applyIngest(plan: IngestPlan, incomingDir: string, jsonDir: string): void {
  mkdirSync(jsonDir, { recursive: true });
  for (const w of plan.writes) {
    writeFileSync(join(jsonDir, jsonName(w.id)), w.json);
    for (const s of w.sources) { const p = join(incomingDir, s); if (existsSync(p)) unlinkSync(p); }
  }
}

function loadLedger(): Ledger {
  return existsSync(LEDGER_PATH) ? (JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger) : emptyLedger();
}

function main(): void {
  const argv = process.argv;
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1]! : join(homedir(), 'pyr3-flames');
  const addNew = argv.includes('--add-new');
  const apply = argv.includes('--apply');
  const incomingDir = join(root, 'incoming');
  const jsonDir = join(root, 'json');
  const { plan, ledger } = planIngest(incomingDir, loadLedger(), addNew);
  console.log(`ingest ${addNew ? '(add-new)' : '(match-only)'} — ${apply ? 'APPLY' : 'DRY-RUN'} — root ${root}`);
  for (const w of plan.writes) {
    console.log(`  write json/${jsonName(w.id)}  <- ${w.sources.join(', ')}${plan.newIds.includes(w.id) ? '  [NEW]' : ''}`);
  }
  console.log(`  ${plan.writes.length} write(s), ${plan.newIds.length} new id(s), ${plan.left.length} left in incoming/`);
  if (!apply) { console.log('  (dry-run — pass --apply to perform)'); return; }
  applyIngest(plan, incomingDir, jsonDir);
  if (plan.newIds.length) {
    mkdirSync(join(process.cwd(), 'flames/pyr3-natives'), { recursive: true });
    writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
    console.log(`  ledger updated -> nextId ${ledger.nextId}`);
  }
  console.log('  done.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
