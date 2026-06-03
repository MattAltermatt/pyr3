// WebGPU device + canvas init helper. Used by every phase from Phase 0 on.

export interface PyrDevice {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  adapter: GPUAdapter;
}

export interface PyrGpu {
  device: GPUDevice;
  format: GPUTextureFormat;
  adapter: GPUAdapter;
}

/** Acquire device + adapter + preferred canvas format WITHOUT binding to a
 *  specific canvas. Useful when the caller owns canvases dynamically (the
 *  /v1/edit editor creates its own canvas inside its mounted panel). The
 *  device-lost handler attaches to the global #pyr3-error overlay, same as
 *  initDevice. */
export async function acquireGpu(): Promise<PyrGpu> {
  if (!navigator.gpu) {
    throw new Error(
      'pyr3: WebGPU not available in this browser.\n' +
        'Use a current Chrome / Edge / Chromium build with WebGPU enabled.',
    );
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('pyr3: requestAdapter() returned null — no GPU adapter available.');
  }
  // Phase 9-supersample-real: at supersample=4 on 800×592, the chaos histogram
  // is 121 MB (3200×2368 × 4 × 4 bytes) — larger than WebGPU's default 128 MiB
  // maxStorageBufferBindingSize. Request the adapter's reported max for both
  // storage-buffer-binding-size and total-buffer-size; falls back gracefully
  // when the adapter reports the default.
  const limits = adapter.limits;
  const requiredLimits: Record<string, number> = {
    maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
    maxBufferSize: limits.maxBufferSize,
  };
  const device = await adapter.requestDevice({ requiredLimits });
  // PYR3-069: surface device loss instead of a silent blank canvas — the only
  // failure net for a no-CPU-fallback renderer (GPU validation error, OOM,
  // TDR). `reason === 'destroyed'` is the intentional teardown path
  // (device.destroy()), so it's ignored.
  void device.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    const detail = `pyr3: WebGPU device lost (${info.reason || 'unknown'}): ${info.message}`;
    console.error(detail);
    const el = document.getElementById('pyr3-error');
    if (el) {
      el.textContent = `${detail}\nReload the page to retry.`;
      el.classList.add('visible');
    }
  });
  const format = navigator.gpu.getPreferredCanvasFormat();
  return { device, format, adapter };
}

export async function initDevice(canvasId: string): Promise<PyrDevice> {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`pyr3: #${canvasId} is not a <canvas>`);
  }
  const { device, format, adapter } = await acquireGpu();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('pyr3: getContext("webgpu") returned null');
  context.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format, canvas, adapter };
}

export function showError(message: string): never {
  const el = document.getElementById('pyr3-error');
  if (el) {
    el.textContent = message;
    el.classList.add('visible');
  }
  throw new Error(message);
}
