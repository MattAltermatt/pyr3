import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GHPAGES_DEFAULT,
  fetchCapability,
  getCapability,
  _resetCapabilityForTest,
} from './capability';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetCapabilityForTest();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetCapabilityForTest();
});

describe('fetchCapability', () => {
  it('returns the gh-pages default when /api/capabilities is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    const cap = await fetchCapability();
    expect(cap).toEqual(GHPAGES_DEFAULT);
    expect(cap.backend).toBe('webgpu-browser');
    expect(cap.max_quality).toBe(200);
  });

  it('returns the gh-pages default on a non-2xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.reject(new Error('should not be called')),
    }) as never;
    const cap = await fetchCapability();
    expect(cap).toEqual(GHPAGES_DEFAULT);
  });

  it('returns the parsed backend descriptor when the endpoint is healthy', async () => {
    const payload = {
      backend: 'dawn-node',
      pyr3_version: '1.5.0',
      dawn_version: 'abc123',
      max_quality: null,
      can_write_files: true,
      can_render_animation: true,
      gpu_adapter: 'Apple M1 Max',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    }) as never;
    const cap = await fetchCapability();
    expect(cap).toEqual(payload);
    expect(cap.backend).toBe('dawn-node');
    expect(cap.max_quality).toBeNull();
  });

  it('memoizes — second call does not refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...GHPAGES_DEFAULT, gpu_adapter: 'test' }),
    });
    globalThis.fetch = fetchMock as never;
    await fetchCapability();
    await fetchCapability();
    await fetchCapability();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getCapability', () => {
  it('returns the gh-pages default before any fetch resolves', () => {
    expect(getCapability()).toEqual(GHPAGES_DEFAULT);
  });

  it('returns the cached value after a successful fetch', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...GHPAGES_DEFAULT, max_quality: null, backend: 'dawn-node' }),
    }) as never;
    await fetchCapability();
    expect(getCapability().backend).toBe('dawn-node');
    expect(getCapability().max_quality).toBeNull();
  });
});
