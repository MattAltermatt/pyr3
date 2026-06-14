// FE SSE client for POST /api/animate. Mirrors render-save.ts:
// saveRenderViaBackend's event-loop shape — POST a body, walk the SSE
// stream, surface progress events as a callback, bridge an AbortSignal
// into a /api/cancel/:id POST. Resolves with the server's `written` list
// on completion or `'cancelled'` if the host aborted mid-flight. P7 of
// the Animation milestone (#212).

import { type EasingCurve } from './easing';

export interface ExportAnimateParams {
  /** Raw `.flam3` XML (animation path). Exactly one of flameXml | timelineJson. */
  flameXml?: string;
  /** Inclusive frame range. Defaults derive from animation time on the server. */
  begin?: number;
  end?: number;
  dtime?: number;
  qs?: number;
  ss?: number;
  /** Per-segment easing curves (#224); sent as `segment_easing`. */
  segmentEasing?: (EasingCurve | undefined)[];
  /** Serialized .pyr3.timeline.json (timeline path, #227). */
  timelineJson?: string;
  /** Frames per second (timeline path). */
  fps?: number;
  /** Absolute quality override applied to every clip (timeline path). */
  quality?: number;
  prefix?: string;
  /** Absolute path or path relative to `pyr3 serve`'s cwd. Required. */
  outDir: string;
  /** #274 — absolute output dimensions (long-edge rescale on the server). Both
   *  must be set to take effect; sent as `out_width` / `out_height`. */
  outWidth?: number;
  outHeight?: number;
  /** #275 — skip frames whose PNG already exists (resume a partial export). */
  resume?: boolean;
  walkerJitter?: number;
  seed?: number;
}

export interface ExportAnimateProgress {
  /** 1-indexed frame number in the rendered sequence. */
  frame: number;
  /** Total frames being rendered. */
  total: number;
  /** [0, 1]. */
  percent: number;
  /** Absolute path of the most recently written PNG. */
  written: string;
  /** Wall-clock seconds since the POST landed. */
  elapsedSeconds: number;
  /** Naive ETA (elapsed / percent - elapsed). 0 before the first event. */
  etaSeconds: number;
}

export type ExportAnimateOutcome =
  | { status: 'completed'; written: string[] }
  | { status: 'cancelled'; written: string[] };

export interface ExportAnimateOpts {
  params: ExportAnimateParams;
  onOpen?(info: { jobId: string; frames: number; outDir: string }): void;
  onProgress(info: ExportAnimateProgress): void;
  abortSignal: AbortSignal;
  /** Optional fetch override (test seam). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface OpenEvent {
  jobId: string;
  frames: number;
  out_dir: string;
}

interface BackendProgressEvent {
  frame: number;
  total: number;
  percent: number;
  written: string;
}

interface DoneEvent {
  written: string[];
}

interface CancelledEvent {
  jobId?: string;
  written?: string[];
}

interface ErrorEvent {
  message?: string;
}

/** POST /api/animate and consume the SSE stream. Resolves with the final
 *  outcome; throws on transport errors or server-side `error` events. */
export async function exportAnimate(opts: ExportAnimateOpts): Promise<ExportAnimateOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const elapsedStart = performance.now();
  const p = opts.params;
  // Exactly one of timelineJson | flameXml is set (caller guarantees). The
  // timeline body carries fps + absolute quality; the animation body carries
  // the begin/end/dtime/qs frame controls.
  // #274/#275 — output dims (both required) + resume apply to BOTH paths.
  const dimsAndResume = {
    ...(p.outWidth !== undefined && p.outHeight !== undefined
      ? { out_width: p.outWidth, out_height: p.outHeight }
      : {}),
    ...(p.resume !== undefined ? { resume: p.resume } : {}),
  };
  const body = p.timelineJson !== undefined
    ? {
        timeline_json: p.timelineJson,
        out_dir: p.outDir,
        ...(p.fps !== undefined ? { fps: p.fps } : {}),
        ...(p.quality !== undefined ? { quality: p.quality } : {}),
        ...(p.prefix !== undefined ? { prefix: p.prefix } : {}),
        ...(p.walkerJitter !== undefined ? { walker_jitter: p.walkerJitter } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        ...dimsAndResume,
      }
    : {
        flame_xml: p.flameXml,
        out_dir: p.outDir,
        ...(p.begin !== undefined ? { begin: p.begin } : {}),
        ...(p.end !== undefined ? { end: p.end } : {}),
        ...(p.dtime !== undefined ? { dtime: p.dtime } : {}),
        ...(p.qs !== undefined ? { qs: p.qs } : {}),
        ...(p.ss !== undefined ? { ss: p.ss } : {}),
        ...(p.prefix !== undefined ? { prefix: p.prefix } : {}),
        ...(p.walkerJitter !== undefined ? { walker_jitter: p.walkerJitter } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        ...(p.segmentEasing ? { segment_easing: p.segmentEasing } : {}),
        ...dimsAndResume,
      };

  let jobId: string | null = null;
  const cancelByJobId = () => {
    if (!jobId) return;
    void fetchImpl(`/api/cancel/${jobId}`, { method: 'POST' }).catch(() => {});
  };
  const onAbort = () => cancelByJobId();
  opts.abortSignal.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetchImpl('/api/animate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.abortSignal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`pyr3 serve animate failed: ${res.status} ${text}`);
    }
    jobId = res.headers.get('X-Job-ID');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let outcome: ExportAnimateOutcome | null = null;

    while (outcome === null) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');

        if (event === 'open') {
          try {
            const o = JSON.parse(dataStr) as OpenEvent;
            opts.onOpen?.({ jobId: o.jobId, frames: o.frames, outDir: o.out_dir });
          } catch { /* ignore malformed open event */ }
        } else if (event === 'progress') {
          try {
            const p = JSON.parse(dataStr) as BackendProgressEvent;
            const elapsedSeconds = (performance.now() - elapsedStart) / 1000;
            opts.onProgress({
              frame: p.frame,
              total: p.total,
              percent: p.percent,
              written: p.written,
              elapsedSeconds,
              etaSeconds: estimateEta(p.percent, elapsedSeconds),
            });
          } catch { /* ignore malformed progress event */ }
        } else if (event === 'done') {
          const d = JSON.parse(dataStr) as DoneEvent;
          outcome = { status: 'completed', written: d.written ?? [] };
        } else if (event === 'cancelled') {
          const c = JSON.parse(dataStr) as CancelledEvent;
          outcome = { status: 'cancelled', written: c.written ?? [] };
        } else if (event === 'error') {
          const e = JSON.parse(dataStr) as ErrorEvent;
          throw new Error(`pyr3 serve animate failed: ${e.message ?? 'unknown error'}`);
        }
      }
    }

    return outcome ?? { status: 'cancelled', written: [] };
  } catch (err) {
    if (opts.abortSignal.aborted) return { status: 'cancelled', written: [] };
    throw err;
  } finally {
    opts.abortSignal.removeEventListener('abort', onAbort);
  }
}

function estimateEta(percent: number, elapsedSeconds: number): number {
  if (percent <= 0) return 0;
  const total = elapsedSeconds / Math.max(0.001, percent);
  return Math.max(0, total - elapsedSeconds);
}
