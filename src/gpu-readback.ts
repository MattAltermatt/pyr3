// Shared GPU readback + display-referred encode helpers (#392).
//
// The 256-aligned copyTextureToBuffer → mapAsync → per-row unpad sequence, plus
// the two correctness-critical display→output transforms (EXR linear-light,
// png16 quantize), used to be copy-pasted verbatim across SIX sites (bin/serve
// render-png + render-animation-png, bin/pyr3-{render,animate,bake-features},
// src/render-save). That's exactly the FE/BE drift the "single engine, two
// consumers" seam exists to prevent — and it had already diverged: the #388
// NaN→0 guard lived only in pyr3-render's EXR path (missing from render-save's
// browser path), and the #389 readback leak guard lived only in render-save.
// One home keeps the sRGB / half-float / alignment math consistent everywhere.
//
// SEAM: engine module — zero environment branching. Only touches the GPUDevice/
// GPUTexture it is handed (WebGPU globals stamped on globalThis by every host).

import { halfToFloat } from './half-float';
import { srgbToLinear } from './srgb';

/** Strip 256-aligned row padding from a freshly-mapped GPU buffer copy into a
 *  tight (unpadded) byte buffer. Pure CPU; pulled out so the frame-pipelined
 *  caller (render-animation-png) — which submits its own copy + mapAsync to
 *  overlap GPU/CPU work — can reuse the unpad without giving up its pipeline. */
export function stripRowPadding(
  padded: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array {
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const tight = new Uint8Array(width * height * bytesPerPixel);
  for (let y = 0; y < height; y++) {
    tight.set(
      padded.subarray(y * bytesPerRow, y * bytesPerRow + unpaddedBytesPerRow),
      y * unpaddedBytesPerRow,
    );
  }
  return tight;
}

/** Copy a GPU texture into a tight (unpadded) host byte buffer. `bytesPerPixel`
 *  = 4 for rgba8unorm, 8 for rgba16float. #389 — destroys the MAP_READ scratch
 *  on EVERY exit (a mapAsync rejection otherwise leaks ~128 MB at 4K). */
export async function readTextureTight(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  bytesPerPixel: number,
): Promise<Uint8Array> {
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const readBuf = device.createBuffer({
    label: 'pyr3.gpu-readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pyr3.gpu-readback.encoder' });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuf, bytesPerRow, rowsPerImage: height },
    { width, height },
  );
  device.queue.submit([encoder.finish()]);
  try {
    await readBuf.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();
    return stripRowPadding(padded, width, height, bytesPerPixel);
  } finally {
    readBuf.destroy();
  }
}

/** Transform a tight rgba16float buffer into a Float32Array of LINEAR-light
 *  display pixels for EXR encoding: srgbToLinear(clamp(halfToFloat)) on RGB,
 *  clamped coverage on alpha (#334 — so EXR viewers reproduce the editor look).
 *
 *  #388 — coerce non-finite to 0. `Math.max(0, Math.min(1, NaN))` is NaN, which
 *  an EXR Float32Array writes verbatim → black/magenta holes in many viewers.
 *  The png16 path self-heals (NaN→Uint16 coerces to 0), so the guard is
 *  EXR-specific and lives here only. */
export function displayHalfToLinearExr(
  tight: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const halfView = new Uint16Array(tight.buffer, tight.byteOffset, width * height * 4);
  const rgba = new Float32Array(width * height * 4);
  const cl = (f: number) => (Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    rgba[o] = srgbToLinear(cl(halfToFloat(halfView[o]!)));
    rgba[o + 1] = srgbToLinear(cl(halfToFloat(halfView[o + 1]!)));
    rgba[o + 2] = srgbToLinear(cl(halfToFloat(halfView[o + 2]!)));
    rgba[o + 3] = cl(halfToFloat(halfView[o + 3]!)); // alpha = coverage (not sRGB-curved)
  }
  return rgba;
}

/** Quantize a tight rgba16float buffer into a Uint16Array for png16 encoding:
 *  half-float → clamp [0,1] → 16-bit sample. NaN self-heals (→0 on coercion). */
export function displayHalfToPng16(
  tight: Uint8Array,
  width: number,
  height: number,
): Uint16Array {
  const halfView = new Uint16Array(tight.buffer, tight.byteOffset, width * height * 4);
  const rgba16 = new Uint16Array(width * height * 4);
  for (let i = 0; i < rgba16.length; i++) {
    const f = halfToFloat(halfView[i]!);
    rgba16[i] = Math.round(Math.max(0, Math.min(1, f)) * 65535);
  }
  return rgba16;
}
