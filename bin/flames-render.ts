// Pass 4: high-quality reference renders of the curated flame library.
//
// Reads ~/pyr3-flames/json/<id>.pyr3.json, writes ~/pyr3-flames/renders/<id>.png at
// 4K (long-edge 3840), quality 2000 by default. RESUMABLE: skips ids whose render
// already exists, so the run can be stopped (Ctrl-C) and re-run to continue. Each
// render goes to a `.tmp` file and is atomically renamed only on success, so an
// interrupted render never leaves a corrupt `<id>.png` that resume would skip.
//
// Progress per render: [current/total] id · N remaining · this <t> · est. time remaining <t>.
//
//   --root DIR        flames root (default ~/pyr3-flames); reads DIR/json, writes DIR/renders
//   --long-edge N     output long edge in px (default 3840)
//   --quality N       samples per pixel (default 2000)
//   --oversample N    supersampling factor (default 2 — internal N× then downsample → spatial AA)
//   --format F        png16 (default — 16-bit master) | png8 | exr | exr-linear
//   --limit N         render at most N flames this run (testing)
import { readdirSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pad5, pngName, jsonName, idFromJsonName } from './native-bake/flames-fs';
import { formatEstTime } from '../src/animate-estimate';

export const RENDER_FORMATS = ['png16', 'png8', 'exr', 'exr-linear'] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

/** Output filename for a render in a given format (exr formats use the `.exr` ext). */
export function outName(id: number, format: RenderFormat): string {
  return format === 'exr' || format === 'exr-linear' ? `${pad5(id)}.exr` : pngName(id);
}

/** Sorted flame ids present as `<id>.pyr3.json` in the json dir. */
export function listFlameIds(jsonDir: string): number[] {
  const ids: number[] = [];
  for (const f of readdirSync(jsonDir)) {
    const id = idFromJsonName(f);
    if (id !== null) ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}

/** Split ids into those already rendered (renders/<out> exists) and those still to do. */
export function partitionByExisting(ids: number[], rendersDir: string, format: RenderFormat = 'png16'): { done: number[]; todo: number[] } {
  const done: number[] = [];
  const todo: number[] = [];
  for (const id of ids) (existsSync(join(rendersDir, outName(id, format))) ? done : todo).push(id);
  return { done, todo };
}

/** A single progress line. `index` is 0-based within the todo list. */
export function progressLine(o: { index: number; total: number; id: number; lastSeconds: number; avgSeconds: number; format?: RenderFormat }): string {
  const remaining = o.total - (o.index + 1);
  const eta = formatEstTime(o.avgSeconds * remaining);
  return `[${o.index + 1}/${o.total}] ${outName(o.id, o.format ?? 'png16')} · ${remaining} remaining · this ${formatEstTime(o.lastSeconds)} · est. time remaining ${eta}`;
}

function renderOne(jsonPath: string, outPath: string, longEdge: number, quality: number, format: RenderFormat, oversample: number): void {
  const tmp = `${outPath}.tmp`;
  if (existsSync(tmp)) unlinkSync(tmp); // clear any leftover from a prior interrupted run
  try {
    execFileSync(
      'node',
      ['--import', 'tsx/esm', '--import', './bin/wgsl-loader-register.mjs', 'bin/pyr3-render.ts',
        '--long-edge', String(longEdge), '--quality', String(quality), '--oversample', String(oversample),
        '--format', format, jsonPath, tmp],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    renameSync(tmp, outPath); // atomic: only a complete render becomes the final file
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
}

function main(): void {
  const argv = process.argv;
  const val = (flag: string, def: string): string => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1]! : def; };
  const root = val('--root', join(homedir(), 'pyr3-flames'));
  const longEdge = Number(val('--long-edge', '3840'));
  const quality = Number(val('--quality', '2000'));
  const format = val('--format', 'png16') as RenderFormat;
  if (!RENDER_FORMATS.includes(format)) {
    console.error(`--format must be one of: ${RENDER_FORMATS.join(', ')}`);
    process.exit(1);
  }
  const oversample = Math.max(1, Number(val('--oversample', '2')));
  const limit = argv.indexOf('--limit') >= 0 ? Number(val('--limit', '0')) : Infinity;
  const jsonDir = join(root, 'json');
  const rendersDir = join(root, 'renders');
  mkdirSync(rendersDir, { recursive: true });

  const ids = listFlameIds(jsonDir);
  const { done, todo: allTodo } = partitionByExisting(ids, rendersDir, format);
  const todo = allTodo.slice(0, limit);
  console.log(
    `flames-render — ${longEdge}px q${quality} ${format} oversample${oversample} → ${rendersDir}\n` +
    `  ${ids.length} flames · ${done.length} already rendered · ${todo.length} to render this run` +
    (limit !== Infinity ? ` (--limit ${limit})` : ''),
  );
  if (todo.length === 0) { console.log('  nothing to do.'); return; }

  const times: number[] = [];
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < todo.length; i++) {
    const id = todo[i]!;
    const jsonPath = join(jsonDir, jsonName(id));
    const outPath = join(rendersDir, outName(id, format));
    const t0 = Date.now();
    try {
      renderOne(jsonPath, outPath, longEdge, quality, format, oversample);
    } catch (e: unknown) {
      const sig = (e as { signal?: string }).signal;
      if (sig === 'SIGINT' || sig === 'SIGTERM') {
        console.log(`\nstopped at ${outName(id, format)} — ${okCount} rendered this run, ${todo.length - i} left. Re-run to resume.`);
        process.exit(0);
      }
      failCount++;
      const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n').pop() ?? String(e);
      console.warn(`  FAILED ${outName(id, format)}: ${stderr}`);
      continue;
    }
    const secs = (Date.now() - t0) / 1000;
    times.push(secs);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    okCount++;
    console.log(progressLine({ index: i, total: todo.length, id, lastSeconds: secs, avgSeconds: avg, format }));
  }
  console.log(`\ndone — ${okCount} rendered, ${failCount} failed, ${done.length} pre-existing skipped.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
