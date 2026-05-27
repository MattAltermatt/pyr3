import { readFileSync, writeFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { create, globals } from 'webgpu';
import { PNG } from 'pngjs';

const win = new Window();
globalThis.DOMParser = win.DOMParser;
Object.assign(globalThis, globals);

const { parseFlame } = await import('../src/flame-import.ts');
const { createRenderer, DEFAULT_FILTER_RADIUS } = await import('../src/renderer.ts');

const [, , inputPath, outPath, mode] = process.argv;
if (!inputPath || !outPath) {
  console.error('usage: node scripts/render-modified.mjs <in.flam3> <out.png> [mode]');
  console.error('  modes: no-xaos, half-brightness, no-rotate, plain');
  process.exit(1);
}

const text = readFileSync(inputPath, 'utf8');
const { genome } = parseFlame(text);

if (mode === 'no-xaos') {
  for (const x of genome.xforms) delete x.xaos;
  console.log('[mode] stripped xaos from all xforms');
} else if (mode === 'half-brightness') {
  if (!genome.tonemap) genome.tonemap = { gamma: 4, vibrancy: 1, highlightPower: 1, brightness: 10, gammaThreshold: 0.01 };
  else genome.tonemap.brightness /= 2;
  console.log('[mode] halved brightness to', genome.tonemap.brightness);
} else if (mode === 'no-rotate') {
  delete genome.rotate;
  console.log('[mode] stripped rotation');
}

const width = genome.size?.width ?? 1024;
const height = genome.size?.height ?? 1024;
const oversample = Math.max(1, Math.floor(genome.oversample ?? 1));
const filterRadius = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

const navigator = { gpu: create([]) };
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('no adapter');
const limits = adapter.limits;
const device = await adapter.requestDevice({
  requiredLimits: {
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxBufferSize: limits.maxBufferSize,
  },
});

const format = 'rgba8unorm';
const renderer = createRenderer(device, format, { width, height, oversample, filterRadius });
const texture = device.createTexture({
  size: { width, height }, format,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});

renderer.render({ genome, outputView: texture.createView() });

const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
const readBuf = device.createBuffer({
  size: bytesPerRow * height,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const enc = device.createCommandEncoder();
enc.copyTextureToBuffer({ texture }, { buffer: readBuf, bytesPerRow, rowsPerImage: height }, { width, height });
device.queue.submit([enc.finish()]);

await readBuf.mapAsync(GPUMapMode.READ);
const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
readBuf.unmap();

const tight = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
  tight.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
}

const png = new PNG({ width, height });
png.data = Buffer.from(tight.buffer, tight.byteOffset, tight.byteLength);
writeFileSync(outPath, PNG.sync.write(png));
console.log(`[render] wrote ${outPath}`);
delete globalThis.navigator;
process.exit(0);
