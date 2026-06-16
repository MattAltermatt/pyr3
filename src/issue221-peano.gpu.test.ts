// @vitest-environment node
//
// #221 — peano (V309). Per-axis base-3 Peano reflected-ternary scramble:
// tri_encode → peano_scramble (MSB→LSB digit walk with an orientation-flip
// state mapping d→2−d, toggling on odd emitted digits) → tri_decode. Pure
// integer ops; the load-bearing properties are exact-identity match to a JS
// mirror of the digit recursion, and strict boundedness within [−extent,extent].
// No trig → prelude is just the base-3 codec + scramble helpers (pow3 first).
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
import { compileChecked } from './gpu-compile-guard';
import { extractWgslFn } from './shaders/extract';

Object.assign(globalThis, globals);

let _gpu: ReturnType<typeof create> | null = null;
let device: GPUDevice | null = null;
try {
  _gpu = create([]);
  const adapter = await _gpu.requestAdapter();
  device = adapter ? await adapter.requestDevice() : null;
} catch {
  device = null;
}
afterAll(() => { device?.destroy?.(); });

const SHADER_SRC = readFileSync(new URL('./shaders/chaos.wgsl', import.meta.url), 'utf8');
const POW3 = extractWgslFn(SHADER_SRC, 'pow3');
const TRI_ENC = extractWgslFn(SHADER_SRC, 'tri_encode');
const TRI_DEC = extractWgslFn(SHADER_SRC, 'tri_decode');
const SCRAMBLE = extractWgslFn(SHADER_SRC, 'peano_scramble');
const PRELUDE = `\n${POW3}\n${TRI_ENC}\n${TRI_DEC}\n${SCRAMBLE}\n`;

async function dispatchKernel(
  fnName: string, fnBody: string,
  inputs: ReadonlyArray<readonly [number, number]>, paramsCall: string,
): Promise<Float32Array> {
  const dev = device!;
  const N = inputs.length;
  const flat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { flat[i * 4] = inputs[i]![0]; flat[i * 4 + 1] = inputs[i]![1]; }
  const inBuf = dev.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  dev.queue.writeBuffer(inBuf, 0, flat);
  const outBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const code = `${PRELUDE}
${fnBody}
@group(0) @binding(0) var<storage, read> ins: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outs: array<vec2f>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&ins)) { return; }
  let r = ins[i];
  outs[i] = ${fnName}(r.xy, 1.0, ${paramsCall});
}`;
  const mod = await compileChecked(dev, code);
  const bgl = dev.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  const pl = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipeline = dev.createComputePipeline({ layout: pl, compute: { module: mod, entryPoint: 'main' } });
  const bg = dev.createBindGroup({ layout: bgl, entries: [
    { binding: 0, resource: { buffer: inBuf } },
    { binding: 1, resource: { buffer: outBuf } },
  ] });
  const enc = dev.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(N); pass.end();
  const readBuf = dev.createBuffer({ size: N * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc2 = dev.createCommandEncoder();
  enc2.copyBufferToBuffer(outBuf, 0, readBuf, 0, N * 8);
  dev.queue.submit([enc.finish(), enc2.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const res = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  inBuf.destroy(); outBuf.destroy(); readBuf.destroy();
  return res;
}

// JS mirror of the WGSL base-3 codec + Peano scramble chain.
function jsPeano(x: number, y: number, extent: number, trits: number): [number, number] {
  const pow3 = (n: number) => { let p = 1; for (let i = 0; i < n; i++) p *= 3; return p; };
  const cells = pow3(trits); const s = Math.max(extent, 1e-4);
  const enc = (c: number) => { const norm = (c+s)/(2*s); const folded = norm - Math.floor(norm); return Math.min((folded*cells) >>> 0, cells-1) >>> 0; };
  const dec = (i: number) => ((i+0.5)/cells)*2*s - s;
  const scr = (idx: number) => { let flip = false, out = 0; for (let k = trits-1; k >= 0; k--) { const place = pow3(k); const d = Math.floor(idx/place) % 3; const e = flip ? 2-d : d; out += e*place; if ((e & 1) === 1) flip = !flip; } return out; };
  return [dec(scr(enc(x))), dec(scr(enc(y)))];
}

describe('V309 peano', () => {
  it('matches the TS↔WGSL base-3 scramble oracle exactly', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_peano');
    const extent = 1.0, trits = 5;
    const pts = [[-0.8, 0.3], [0.0, 0.0], [0.55, -0.91], [0.99, 0.99], [-0.4, -0.6]] as const;
    const out = await dispatchKernel('var_peano', fnBody, pts, `${extent}, ${trits}`);
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = jsPeano(pts[i]![0], pts[i]![1], extent, trits);
      expect(out[i*2]!).toBeCloseTo(ex, 5);
      expect(out[i*2+1]!).toBeCloseTo(ey, 5);
    }
  });
  it('output stays strictly inside [−extent, extent] on both axes', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_peano');
    const extent = 1.35;
    const pts = [[5.0, -7.0], [0.01, 0.01], [-3.3, 2.2], [100.0, 100.0]] as const;
    const out = await dispatchKernel('var_peano', fnBody, pts, `${extent}, 6`);
    for (let i = 0; i < pts.length; i++) {
      expect(Math.abs(out[i*2]!)).toBeLessThanOrEqual(extent);
      expect(Math.abs(out[i*2+1]!)).toBeLessThanOrEqual(extent);
    }
  });
  it('reflected-ternary check: trits=2 reflects the odd-digit subtree', async () => {
    if (!device) return;
    const fnBody = extractWgslFn(SHADER_SRC, 'var_peano');
    // Sweep cell centers for trits=2 (9 cells) and confirm GPU == JS mirror,
    // exercising the orientation flip on every digit pattern.
    const extent = 1.0, trits = 2, cells = 9;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < cells; k++) { const cx = ((k + 0.5) / cells) * 2 - 1; pts.push([cx, 0]); }
    const out = await dispatchKernel('var_peano', fnBody, pts, `${extent}, ${trits}`);
    for (let k = 0; k < cells; k++) {
      const [ex] = jsPeano(pts[k]![0], 0, extent, trits);
      expect(out[k*2]!).toBeCloseTo(ex, 5);
    }
  });
});
