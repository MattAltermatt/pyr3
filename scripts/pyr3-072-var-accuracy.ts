// #72 — measure Dawn-f32 accuracy of the REAL WGSL variations vs CPU f64.
// If Dawn's disc/spherical differ from f64 by >> f32 epsilon (~1e-7), that
// supports the transcendental-inaccuracy hypothesis. If ~1e-7, it's refuted
// (fround already captures f32-level error and didn't collapse coverage).

import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { extractWgslFn } from '../src/shaders/extract';

Object.assign(globalThis, globals);
const gpu = create([]);
const adapter = await gpu.requestAdapter();
const device = await adapter!.requestDevice();

const SRC = readFileSync(new URL('../src/shaders/chaos.wgsl', import.meta.url), 'utf8');
const PI = 3.14159265358979323846;
const EPS = 1e-10;
const DISC = extractWgslFn(SRC, 'var_disc');
const SPHERICAL = extractWgslFn(SRC, 'var_spherical');
const WAVES = extractWgslFn(SRC, 'var_waves');
const TAU = 2 * PI;

// Build a set of test inputs: a fine fan of points across magnitudes + angles,
// incl. near-origin (spherical singularity) and the unit band (disc).
const inputs: [number, number][] = [];
for (let i = 0; i < 4096; i++) {
  const ang = (i / 4096) * 2 * Math.PI;
  const mag = Math.pow(10, -6 + 6 * (i / 4096)); // 1e-6 .. 1e0
  inputs.push([mag * Math.cos(ang), mag * Math.sin(ang)]);
}
const N = inputs.length;
const inFlat = new Float32Array(N * 2);
inputs.forEach(([x, y], i) => { inFlat[i * 2] = x; inFlat[i * 2 + 1] = y; });

const code = `
const PI: f32 = ${PI};
const EPS: f32 = ${EPS};
const TAU: f32 = ${TAU};
${DISC}
${SPHERICAL}
${WAVES}
@group(0) @binding(0) var<storage, read> inp: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> outDisc: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> outSph: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> outWav: array<vec2f>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= ${N}u) { return; }
  outDisc[i] = var_disc(inp[i], 1.0);
  outSph[i] = var_spherical(inp[i], 1.0);
  // xform6 waves: a0=(2.11373,0,0), a1=(0,2.11373,0) → wy = y + 2.11*sin(x/1e-10)
  outWav[i] = var_waves(inp[i], 0.5, vec4f(2.11373, 0.0, 0.0, 0.0), vec4f(0.0, 2.11373, 0.0, 1.0));
}`;

function mkBuf(usage: number, data?: Float32Array, size?: number): GPUBuffer {
  const b = device.createBuffer({ size: size ?? data!.byteLength, usage });
  if (data) device.queue.writeBuffer(b, 0, data);
  return b;
}
const inBuf = mkBuf(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, inFlat);
const discBuf = mkBuf(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, undefined, N * 2 * 4);
const sphBuf = mkBuf(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, undefined, N * 2 * 4);
const wavBuf = mkBuf(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, undefined, N * 2 * 4);

const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
const bg = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
  { binding: 0, resource: { buffer: inBuf } }, { binding: 1, resource: { buffer: discBuf } }, { binding: 2, resource: { buffer: sphBuf } }, { binding: 3, resource: { buffer: wavBuf } },
] });
const enc = device.createCommandEncoder();
const pass = enc.beginComputePass();
pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(N / 64)); pass.end();
const rbD = mkBuf(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, undefined, N * 2 * 4);
const rbS = mkBuf(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, undefined, N * 2 * 4);
const rbW = mkBuf(GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ, undefined, N * 2 * 4);
enc.copyBufferToBuffer(discBuf, 0, rbD, 0, N * 2 * 4);
enc.copyBufferToBuffer(sphBuf, 0, rbS, 0, N * 2 * 4);
enc.copyBufferToBuffer(wavBuf, 0, rbW, 0, N * 2 * 4);
device.queue.submit([enc.finish()]);
await rbD.mapAsync(GPUMapMode.READ); await rbS.mapAsync(GPUMapMode.READ); await rbW.mapAsync(GPUMapMode.READ);
const gD = new Float32Array(rbD.getMappedRange().slice(0));
const gS = new Float32Array(rbS.getMappedRange().slice(0));
const gW = new Float32Array(rbW.getMappedRange().slice(0));

// CPU f64 reference.
function discF64(x: number, y: number): [number, number] {
  const phi = Math.atan2(x, y); const r = Math.sqrt(x * x + y * y);
  const a = phi / Math.PI; return [a * Math.sin(Math.PI * r), a * Math.cos(Math.PI * r)];
}
function sphF64(x: number, y: number): [number, number] {
  const r2 = x * x + y * y + EPS; return [x / r2, y / r2];
}

let maxRelD = 0, maxRelS = 0;
const distinctG = new Set<string>(), distinctC = new Set<string>();
const q = (v: number) => Math.round(v * 1e5); // quantize to 1e-5 bucket for distinct-count
for (let i = 0; i < N; i++) {
  const [cx, cy] = discF64(inputs[i][0], inputs[i][1]);
  const gx = gD[i * 2], gy = gD[i * 2 + 1];
  const den = Math.max(Math.hypot(cx, cy), 1e-9);
  maxRelD = Math.max(maxRelD, Math.hypot(gx - cx, gy - cy) / den);
  distinctG.add(`${q(gx)},${q(gy)}`); distinctC.add(`${q(cx)},${q(cy)}`);
  const [sx, sy] = sphF64(inputs[i][0], inputs[i][1]);
  const gsx = gS[i * 2], gsy = gS[i * 2 + 1];
  const dens = Math.max(Math.hypot(sx, sy), 1e-9);
  maxRelS = Math.max(maxRelS, Math.hypot(gsx - sx, gsy - sy) / dens);
}
// waves (xform6): wy = y + 2.11373*sin(x/1e-10) = y + 2.11*sin(x*1e10).
// The sin argument x*1e10 destroys phase in f32. Compare GPU vs CPU f64 output
// y-spread + distinct count — this is the one variation fround couldn't capture
// (Math.sin computes the huge arg in f64).
function wavesF64(x: number, y: number): [number, number] {
  // a0=(2.11373,0,0): b=0,c=0 → wx=x. a1=(0,2.11373,0): e=2.11373,f=0.
  const wy = y + 2.11373 * Math.sin(x / (0 + EPS));
  return [0.5 * x, 0.5 * wy];
}
let gwMin = 1e9, gwMax = -1e9, cwMin = 1e9, cwMax = -1e9;
const gwDistinct = new Set<number>(), cwDistinct = new Set<number>();
let maxRelW = 0;
for (let i = 0; i < N; i++) {
  const gwy = gW[i * 2 + 1]; gwMin = Math.min(gwMin, gwy); gwMax = Math.max(gwMax, gwy); gwDistinct.add(Math.round(gwy * 1e4));
  const [, cwy] = wavesF64(inputs[i][0], inputs[i][1]); cwMin = Math.min(cwMin, cwy); cwMax = Math.max(cwMax, cwy); cwDistinct.add(Math.round(cwy * 1e4));
}

console.log(`[#72 var-accuracy] ${N} inputs, mag 1e-6..1e0`);
console.log(`  disc      max rel err (GPU f32 vs CPU f64) = ${maxRelD.toExponential(3)}`);
console.log(`  spherical max rel err (GPU f32 vs CPU f64) = ${maxRelS.toExponential(3)}`);
console.log(`  disc distinct outputs @1e-5: GPU=${distinctG.size}  CPU=${distinctC.size}`);
console.log('');
console.log(`  WAVES (sin of x*1e10 — phase-critical):`);
console.log(`    GPU wy range = [${gwMin.toFixed(4)}, ${gwMax.toFixed(4)}]  distinct@1e-4 = ${gwDistinct.size}`);
console.log(`    CPU wy range = [${cwMin.toFixed(4)}, ${cwMax.toFixed(4)}]  distinct@1e-4 = ${cwDistinct.size}`);
console.log(`\n  f32 eps ≈ 1.2e-7. disc/spherical ~1e-7 → fine. waves: compare ranges/distinct (GPU vs CPU).`);
delete (globalThis as { navigator?: unknown }).navigator;
process.exit(0);
