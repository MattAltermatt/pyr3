// WebGPU device + canvas init helper. Used by every phase from Phase 0 on.

export interface PyrDevice {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
  adapter: GPUAdapter;
}

export async function initDevice(canvasId: string): Promise<PyrDevice> {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`pyr3: #${canvasId} is not a <canvas>`);
  }
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
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('pyr3: getContext("webgpu") returned null');
  const format = navigator.gpu.getPreferredCanvasFormat();
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
