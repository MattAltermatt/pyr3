// src/screensaver-record.ts

export interface RecorderHandle {
  start(): void;
  stop(save: boolean): Promise<void>;
  elapsedMs(): number;
  bytesAccumulated(): number;
}

export interface RecorderOpts {
  canvas: HTMLCanvasElement;
  filename: string;
  fps?: number;
  mimeType?: string;
  /** VP9 target bitrate. Default 2 Mbps — keeps a 60s hero-dim clip under
   *  the spec's 15 MB acceptance ceiling while staying visually clean. */
  videoBitsPerSecond?: number;
  /** Test hook — overrides anchor-click download. */
  download?: (blob: Blob, filename: string) => void;
  /** Test hook — overrides performance.now. */
  now?: () => number;
}

const DEFAULT_MIME = 'video/webm;codecs=vp9';
const DEFAULT_FPS  = 30;
const DEFAULT_BITRATE = 2_000_000;
const TIMESLICE_MS = 1000;

function defaultDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after a tick so the click handler has time to read the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isRecordingSupported(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  return MediaRecorder.isTypeSupported(DEFAULT_MIME);
}

export function createRecorder(opts: RecorderOpts): RecorderHandle {
  const fps = opts.fps ?? DEFAULT_FPS;
  const mimeType = opts.mimeType ?? DEFAULT_MIME;
  const download = opts.download ?? defaultDownload;
  const now = opts.now ?? (() => performance.now());

  const stream = opts.canvas.captureStream(fps);
  const videoBitsPerSecond = opts.videoBitsPerSecond ?? DEFAULT_BITRATE;
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });

  const chunks: Blob[] = [];
  let bytes = 0;
  let startTime = 0;
  let started = false;

  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      bytes += e.data.size;
    }
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      startTime = now();
      recorder.start(TIMESLICE_MS);
    },
    stop(save: boolean): Promise<void> {
      return new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') {
          if (save && chunks.length > 0) {
            download(new Blob(chunks, { type: mimeType }), opts.filename);
          }
          resolve();
          return;
        }
        recorder.onstop = () => {
          if (save && chunks.length > 0) {
            download(new Blob(chunks, { type: mimeType }), opts.filename);
          }
          resolve();
        };
        recorder.stop();
      });
    },
    elapsedMs(): number {
      if (!started) return 0;
      return now() - startTime;
    },
    bytesAccumulated(): number {
      return bytes;
    },
  };
}
