// src/screensaver-record.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRecorder, isRecordingSupported } from './screensaver-record';

class MockMediaRecorder {
  static lastInstance: MockMediaRecorder | null = null;
  static isTypeSupported = vi.fn().mockReturnValue(true);
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: 'inactive' | 'recording' = 'inactive';

  constructor(_stream: MediaStream, _opts: unknown) {
    MockMediaRecorder.lastInstance = this;
  }
  start(_timesliceMs?: number): void { this.state = 'recording'; }
  stop(): void {
    this.state = 'inactive';
    // Defer onstop until next microtask so awaiter pattern matches real
    // MediaRecorder behavior (onstop fires async after stop() returns).
    queueMicrotask(() => this.onstop?.());
  }
  emitChunk(size: number): void {
    this.ondataavailable?.({ data: { size } as Blob });
  }
}

let mockTime = 0;
const now = () => mockTime;

beforeEach(() => {
  mockTime = 0;
  MockMediaRecorder.lastInstance = null;
  (globalThis as Record<string, unknown>).MediaRecorder = MockMediaRecorder;
});

function fakeCanvas(): HTMLCanvasElement {
  const c = {
    captureStream: vi.fn().mockReturnValue({} as MediaStream),
  } as unknown as HTMLCanvasElement;
  return c;
}

describe('createRecorder', () => {
  it('start() invokes recorder.start with 1s timeslice', () => {
    const r = createRecorder({ canvas: fakeCanvas(), filename: 'x.pyr3.webm', now });
    r.start();
    expect(MockMediaRecorder.lastInstance?.state).toBe('recording');
  });

  it('bytesAccumulated() sums ondataavailable chunks', () => {
    const r = createRecorder({ canvas: fakeCanvas(), filename: 'x.pyr3.webm', now });
    r.start();
    MockMediaRecorder.lastInstance!.emitChunk(1000);
    MockMediaRecorder.lastInstance!.emitChunk(2500);
    expect(r.bytesAccumulated()).toBe(3500);
  });

  it('elapsedMs() returns 0 before start, then now() - startTime', () => {
    const r = createRecorder({ canvas: fakeCanvas(), filename: 'x.pyr3.webm', now });
    expect(r.elapsedMs()).toBe(0);
    mockTime = 1000;
    r.start();
    mockTime = 4500;
    expect(r.elapsedMs()).toBe(3500);
  });

  it('stop(true) invokes download callback with blob + filename', async () => {
    const download = vi.fn();
    const r = createRecorder({
      canvas: fakeCanvas(),
      filename: 'awesome.pyr3.webm',
      now,
      download,
    });
    r.start();
    MockMediaRecorder.lastInstance!.emitChunk(123);
    await r.stop(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]![1]).toBe('awesome.pyr3.webm');
    expect(download.mock.calls[0]![0]).toBeInstanceOf(Blob);
  });

  it('stop(false) does NOT invoke download callback', async () => {
    const download = vi.fn();
    const r = createRecorder({
      canvas: fakeCanvas(),
      filename: 'x.pyr3.webm',
      now,
      download,
    });
    r.start();
    MockMediaRecorder.lastInstance!.emitChunk(999);
    await r.stop(false);
    expect(download).not.toHaveBeenCalled();
  });

  it('isRecordingSupported() reflects MediaRecorder.isTypeSupported', () => {
    MockMediaRecorder.isTypeSupported.mockReturnValueOnce(true);
    expect(isRecordingSupported()).toBe(true);
    MockMediaRecorder.isTypeSupported.mockReturnValueOnce(false);
    expect(isRecordingSupported()).toBe(false);
  });

  it('isRecordingSupported() returns false when MediaRecorder is undefined', () => {
    delete (globalThis as Record<string, unknown>).MediaRecorder;
    expect(isRecordingSupported()).toBe(false);
  });
});
