// Detects whether the current environment exposes WebGPU + can hand
// back an adapter. The result drives the tier 1 chip state + the
// canvas-zone fallback decision in main.ts.

export type WebGPUStatus =
  | { available: true; adapter: GPUAdapter }
  | { available: false; reason: WebGPUUnavailableReason; detail?: string };

export type WebGPUUnavailableReason = 'no-navigator-gpu' | 'no-adapter' | 'exception';

export async function checkWebGPU(): Promise<WebGPUStatus> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { available: false, reason: 'no-navigator-gpu' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: 'no-adapter' };
    return { available: true, adapter };
  } catch (err) {
    return {
      available: false,
      reason: 'exception',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
