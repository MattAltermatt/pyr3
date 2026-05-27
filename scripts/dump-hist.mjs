#!/usr/bin/env node
// Dump pyr3's chaos histogram for a given .flame and report total counts
// vs expected. Used to investigate the 2× brightness discrepancy.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';

const win = new Window();
globalThis.DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

const { sniffKind } = await import('../src/loader.ts');
const { parseFlame } = await import('../src/flame-import.ts');
const { genomeFromJson } = await import('../src/serialize.ts');
const { createRenderer, DEFAULT_FILTER_RADIUS } = await import('../src/renderer.ts');
const chaosMod = await import('../src/chaos.ts');

const inputPath = resolve(process.argv[2]);
const text = readFileSync(inputPath, 'utf8');
const kind = sniffKind(inputPath, text);
let genome;
if (kind === 'flame') {
  genome = parseFlame(text).genome;
} else {
  genome = genomeFromJson(JSON.parse(text));
}

const width = genome.size?.width ?? 1024;
const height = genome.size?.height ?? 1024;
const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

const navigator = { gpu: create([]) };
const adapter = await navigator.gpu.requestAdapter();
const limits = adapter.limits;
const device = await adapter.requestDevice({
  requiredLimits: {
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxBufferSize: limits.maxBufferSize,
  },
});

const format = 'rgba8unorm';
const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });

const tex = device.createTexture({
  size: { width, height }, format,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});

renderer.render({ genome, outputView: tex.createView() });

// Read back histogram (need to access it via the renderer's internal pipelines)
// Inject a hook: render again but copy hist before viz draw.
// For simplicity, expose pipelines.chaos.histogram via direct chaos pass.
// Workaround: redo dispatch manually via chaos pass directly.
const chaosCfg = { width: width * oversample, height: height * oversample, walkers: 1024, itersPerWalker: 4096, fuse: 200 };
const chaos = chaosMod.createChaosPass(device, chaosCfg);
chaos.setPalette(genome.palette);
chaos.reset();

const targetSamples = (genome.quality ?? 16) * width * height;
const TARGET_WALKERS = 1024;
let dispatchWalkers = TARGET_WALKERS;
let dispatchIters = Math.ceil(targetSamples / dispatchWalkers);
if (dispatchIters < 4096) { dispatchIters = 4096; dispatchWalkers = Math.ceil(targetSamples / dispatchIters); }
if (dispatchIters > 1048576) { dispatchIters = 1048576; dispatchWalkers = Math.ceil(targetSamples / dispatchIters); }

chaos.dispatch(genome, 0xC0FFEE, { walkers: dispatchWalkers, itersPerWalker: dispatchIters });

const histSize = width * height * oversample * oversample * 4 * 4;
const dbgBuf = device.createBuffer({
  size: histSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const enc = device.createCommandEncoder();
enc.copyBufferToBuffer(chaos.histogram, 0, dbgBuf, 0, histSize);
device.queue.submit([enc.finish()]);

await dbgBuf.mapAsync(GPUMapMode.READ);
const data = new Uint32Array(dbgBuf.getMappedRange());

let sumR = 0, sumG = 0, sumB = 0, sumCount = 0;
let nonzero = 0;
let maxCount = 0;
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] > 0) nonzero++;
  sumR += data[i];
  sumG += data[i + 1];
  sumB += data[i + 2];
  sumCount += data[i + 3];
  if (data[i + 3] > maxCount) maxCount = data[i + 3];
}

const actualSamples = dispatchWalkers * dispatchIters;
const expectedCount = actualSamples * 255;
console.log(`flame: ${genome.name}`);
console.log(`size: ${width}x${height}, oversample: ${oversample}`);
console.log(`actualSamples (walker hits): ${actualSamples.toLocaleString()}`);
console.log(`expectedCount (×255): ${expectedCount.toLocaleString()}`);
console.log(`sumCount: ${sumCount.toLocaleString()}`);
console.log(`ratio (sumCount/expected): ${(sumCount/expectedCount).toFixed(4)}`);
console.log(`maxCount per pixel: ${maxCount.toLocaleString()}`);
console.log(`mean count over nonzero pixels: ${(sumCount/nonzero).toLocaleString()}`);
console.log(`nonzero pixels: ${nonzero.toLocaleString()} / ${(data.length/4).toLocaleString()}`);
console.log(`sumR: ${sumR.toLocaleString()} sumG: ${sumG.toLocaleString()} sumB: ${sumB.toLocaleString()}`);

dbgBuf.unmap();
delete globalThis.navigator;
process.exit(0);
