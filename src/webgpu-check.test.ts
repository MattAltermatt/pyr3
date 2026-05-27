import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkWebGPU } from './webgpu-check';

const realNavigator = globalThis.navigator;

function setNavigator(nav: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  });
}

describe('checkWebGPU', () => {
  afterEach(() => {
    setNavigator(realNavigator);
    vi.restoreAllMocks();
  });

  it('reports no-navigator-gpu when navigator lacks .gpu', async () => {
    setNavigator({});
    const status = await checkWebGPU();
    expect(status.available).toBe(false);
    if (!status.available) {
      expect(status.reason).toBe('no-navigator-gpu');
    }
  });

  it('reports no-adapter when requestAdapter() returns null', async () => {
    setNavigator({
      gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
    });
    const status = await checkWebGPU();
    expect(status.available).toBe(false);
    if (!status.available) {
      expect(status.reason).toBe('no-adapter');
    }
  });

  it('reports available with the adapter when requestAdapter() returns one', async () => {
    const fakeAdapter = { __id: 'fake-adapter' } as unknown as GPUAdapter;
    setNavigator({
      gpu: { requestAdapter: vi.fn().mockResolvedValue(fakeAdapter) },
    });
    const status = await checkWebGPU();
    expect(status.available).toBe(true);
    if (status.available) {
      expect(status.adapter).toBe(fakeAdapter);
    }
  });

  it('reports exception with the error message when requestAdapter() throws', async () => {
    setNavigator({
      gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('GPU went bang')) },
    });
    const status = await checkWebGPU();
    expect(status.available).toBe(false);
    if (!status.available) {
      expect(status.reason).toBe('exception');
      expect(status.detail).toBe('GPU went bang');
    }
  });
});
