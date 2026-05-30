#!/usr/bin/env -S node --experimental-strip-types
// pyr3-trace — PYR3-029 Phase 5b bilateral RNG-aligned trace.
//
// Runs the chaos pass with `trace_mode=1` for walker 0, dumping (pick, pa,
// pv_pre, pv, isBad, color) for the first 1000 post-fuse iters. Emits a
// schema that mirrors flam3's `-rngtrace` stderr format so direct line-diff
// works. Companion to flam3-render-32bit-isaac-rngtrace + isaac_seed_hex.
//
// To bilaterally align:
//   1. node bin/pyr3-trace.ts <fixture.flame>           # prints pyr3 trace
//      → captures ALSO the post-init randrsl hex from walker 0 ISAAC state
//   2. env isaac_seed_hex=<hex> .../flam3-...-rngtrace < <fixture.flame> 2> flam3.log
//   3. diff the two traces line-by-line; first divergent line localizes the bug.
//
// Usage:
//   npx tsx bin/pyr3-trace.ts <input.flame>

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

import { sniffKind } from '../src/loader';
import { parseFlame } from '../src/flame-import';
import { genomeFromJson } from '../src/serialize';
import { createChaosPass } from '../src/chaos';
import { type Genome } from '../src/genome';
import { ISAAC_STATE_U32 } from '../src/isaac';

const FUSE = 200;
const TRACE_ENTRIES = 1000;
const TRACE_FLOATS_PER_ENTRY = 16;

const win = new Window();
(globalThis as { DOMParser: unknown }).DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('usage: npx tsx bin/pyr3-trace.ts <input.flame> [--seed=N]');
    process.exit(1);
  }
  let seedOverride: number | null = null;
  let flamePath: string | null = null;
  for (const a of args) {
    if (a.startsWith('--seed=')) seedOverride = Number(a.slice('--seed='.length));
    else flamePath = a;
  }
  if (!flamePath) {
    console.error('missing input .flame path');
    process.exit(1);
  }
  const inputPath = resolve(flamePath);

  const text = readFileSync(inputPath, 'utf8');
  const kind = sniffKind(inputPath, text);
  const genome: Genome =
    kind === 'flame' ? parseFlame(text).genome : genomeFromJson(JSON.parse(text));

  const width = genome.size?.width ?? 1024;
  const height = genome.size?.height ?? 1024;
  const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));

  console.error(`[pyr3-trace] genome="${genome.name}" ${width}×${height}`);

  const navigator = { gpu: create([]) };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('pyr3-trace: no GPU adapter');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });

  // Single walker, 1200 iters (fuse + 1000 post-fuse for the trace window).
  const chaos = createChaosPass(device, {
    width: width * oversample,
    height: height * oversample,
    walkers: 1,
    itersPerWalker: TRACE_ENTRIES,
    fuse: FUSE,
    oversample, // PYR3-062: was omitted (→ undefined splat scale); match renderer
  });

  const seed = seedOverride ?? 0xDEADBEEF;
  chaos.setPalette(genome.palette);
  chaos.reset();
  chaos.dispatch(genome, seed, {
    walkers: 1,
    itersPerWalker: TRACE_ENTRIES,
    traceMode: true,
  });

  // Read back trace buffer.
  const traceBytes = TRACE_ENTRIES * TRACE_FLOATS_PER_ENTRY * 4;
  const readBuf = device.createBuffer({
    label: 'pyr3-trace.readback',
    size: traceBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3-trace.encoder' });
  encoder.copyBufferToBuffer(chaos.traceBuffer, 0, readBuf, 0, traceBytes);
  device.queue.submit([encoder.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const f32 = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();

  // Also dump walker 0's POST-init ISAAC state for isaac_seed_hex bilateral
  // alignment. Read back from chaos.traceBuffer's sibling — we need to read
  // the isaac_states buffer's first 16 randrsl entries (after packIsaacStates).
  // Reach into chaos pass internals — packIsaacStates produces a known layout.
  // Format: u32 randcnt + 3 u32 (randa/randb/randc) + 16 u32 randmem + 16 u32 randrsl
  // = 36 u32 = 144 bytes per walker. We want randrsl[0..16] which is bytes 80..144.
  //
  // Re-derive POST-init via packIsaacStates(walkers=1, seed) — bit-identical to
  // what was uploaded. Saves us a GPU readback.
  void ISAAC_STATE_U32; // reserved for multi-walker dumps later
  // flam3 isaac_seed_hex protocol (flam3.c:2594-2606): the hex provides the
  // randrsl SEED that flam3 then runs through irandinit() to derive mm[] and
  // produce its first isaac() round. So pyr3 must emit the PRE-irandinit
  // randrsl values (the PCG32-generated seed bytes BEFORE the mix), not the
  // post-irandinit randrsl values. Replicates packIsaacStates' PCG32 init
  // path verbatim for walker 0.
  //
  // Also: each 8-hex chunk parsed via strtoul is interpreted as a big-endian
  // u32 (e.g., "12345678" → 0x12345678), so emit big-endian per-u32 hex.
  // Bug history: prior versions of this CLI dumped LE bytes (mismatched
  // strtoul), and post-irandinit randrsl (caused flam3 to run irandinit on
  // already-mixed state). Both bugs found 2026-05-28 in PYR3-029 Phase 5b.
  const RANDSIZ = 16;
  let pcg = (seed ^ (((0 * 2654435761) + 1) >>> 0)) >>> 0;
  for (let k = 0; k < 4; k++) {
    pcg = ((Math.imul(pcg, 747796405) + 2891336453) >>> 0);
  }
  const preInitRandrsl = new Uint32Array(RANDSIZ);
  for (let i = 0; i < RANDSIZ; i++) {
    const s2 = pcg;
    pcg = ((Math.imul(pcg, 747796405) + 2891336453) >>> 0);
    const shift = ((s2 >>> 28) + 4) >>> 0;
    const word = ((Math.imul(((s2 >>> shift) ^ s2) >>> 0, 277803737)) >>> 0);
    preInitRandrsl[i] = ((word >>> 22) ^ word) >>> 0;
  }
  const randrslHex = Array.from(preInitRandrsl, (v) => v.toString(16).padStart(8, '0')).join('');

  console.error(`[pyr3-trace] post-init randrsl hex (pass via isaac_seed_hex to flam3-rngtrace):`);
  console.error(`  ${randrslHex}`);
  console.error('');

  for (let i = 0; i < TRACE_ENTRIES; i++) {
    const base = i * TRACE_FLOATS_PER_ENTRY;
    // In-bounds by construction (buffer sized to TRACE_ENTRIES × TRACE_FLOATS_
    // PER_ENTRY); `?? 0` satisfies noUncheckedIndexedAccess and matches the
    // break-on-zero sentinel logic below.
    const iter = f32[base] ?? 0;
    const pick = f32[base + 1] ?? 0;
    const pax = f32[base + 2] ?? 0;
    const pay = f32[base + 3] ?? 0;
    const pvx_pre = f32[base + 4] ?? 0;
    const pvy_pre = f32[base + 5] ?? 0;
    const pvx = f32[base + 6] ?? 0;
    const pvy = f32[base + 7] ?? 0;
    const isBad = f32[base + 8] ?? 0;
    if (iter === 0 && pick === 0 && pax === 0 && pay === 0 && i > 0) break;
    // Flam3 -rngtrace format (chaos.wgsl Phase 5b schema mirrors this byte-for-byte):
    //   [iter=N walker=0 pick=X pax=f pay=f pvx_pre=f pvy_pre=f pvx=f pvy=f isBad=0|1 draw=?]
    process.stdout.write(
      `[iter=${i} walker=0 pick=${pick.toFixed(0)} pax=${pax.toPrecision(17)} pay=${pay.toPrecision(17)} pvx_pre=${pvx_pre.toPrecision(17)} pvy_pre=${pvy_pre.toPrecision(17)} pvx=${pvx.toPrecision(17)} pvy=${pvy.toPrecision(17)} isBad=${isBad.toFixed(0)}]\n`,
    );
  }

  chaos.destroy();
  delete (globalThis as { navigator?: unknown }).navigator;
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('pyr3-trace: failed —', err);
  process.exit(1);
});
