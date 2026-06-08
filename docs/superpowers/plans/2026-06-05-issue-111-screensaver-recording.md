# #111 Screensaver Recording (Record mode) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a third **Record** mode on `/v1/screensaver` that renders one ESF flame's build-up while capturing the WebGPU canvas to a `.webm` (VP9) video, saved on settle.

**Architecture:** Reuse the existing build-up loop substrate; wrap it with a `MediaRecorder` lifecycle hooked at frame 0 (start) and settle (stop + download). New tab on the landing card includes a flame picker (thumbnail + Random) so the user sees what they're recording before pressing Start. Filename ladder routes ESF flames to the `electricsheep.<gen>.<id>.pyr3.webm` convention; other paths fall back through #104's template engine.

**Tech Stack:** TypeScript + WebGPU + Vite; `MediaRecorder` (browser native, VP9); Vitest; `chrome-devtools-mcp` for verify.

**Spec:** `docs/superpowers/specs/2026-06-05-issue-111-screensaver-recording-design.md` (locked Q1–Q5).

**Branch:** `feature/issue-111-record` (created in Task 0).

---

## Execution Handoff (proposed task split)

Per global CLAUDE.md "first foundational task(s) of each logic phase INLINE, then hand replicable tasks to subagents":

| Task | Title | Mode | Why |
|------|-------|------|-----|
| 0 | Branch + GH-issue start | Inline | One-shot bash; lead pace |
| 1 | Filename ladder module | **Subagent** | Pure logic, TDD, idiomatic; great subagent fit |
| 2 | Recorder state machine | **Subagent** | Pure logic + MediaRecorder mock; idiomatic subagent fit |
| 3 | Prefs v3→v4 migration | **Subagent** | Pure logic; mirrors existing v2→v3 from #109 |
| 4 | UI — 3rd mode tab + Record ladders | Inline | DOM idioms, layout tweaks — lead-paced |
| 5 | Picker — thumbnail + Random | Inline | WebGPU device threading + new renderer instance; subagent permission gap on dev-server work |
| 6 | Mount — runRecordSession() lifecycle | Inline | Complex state machine + canvas wiring; lead-paced |
| 7 | Chrome verify + acceptance | Inline | chrome-devtools-mcp, lead-only |
| 8 | Code review | **Subagent** | Fresh-eyes adversarial pass; canonical subagent fit |
| 9 | Docs + follow-up issue + FF-merge gate | Inline | `gh` + manual ship gate |

User picks subagent-driven (executes the table above) or full-inline (lead runs all 10).

---

## File Structure

**New files:**
- `src/screensaver-record-filename.ts` — Pure filename derivation ladder. Takes `{genome, ref?, now}`; returns `.pyr3.webm` filename per spec Q4 ladder.
- `src/screensaver-record-filename.test.ts` — Cases 1–5 of the ladder, including `.pyr3.webm` suffix invariant, pinned-clock dates.
- `src/screensaver-record.ts` — `createRecorder(canvas, filename) → RecorderHandle` with start/stop(save)/elapsedMs/bytesAccumulated. Wraps `canvas.captureStream(30)` + `MediaRecorder`.
- `src/screensaver-record.test.ts` — State machine tests with `MediaRecorder` mock; save vs abort semantics; bytes accumulation.

**Modified files:**
- `src/screensaver-prefs.ts` — Add `'record'` to `ScreensaverMode` union; add `recordTimeSec/recordQ/recordRamp` fields with defaults + clamps; bump `PREFS_VERSION` 3 → 4.
- `src/screensaver-prefs.test.ts` — Add v3→v4 migration test, mode-round-trip test, clamps tests.
- `src/screensaver-ui.ts` — Mode picker grid 2-col → 3-col; new `recordBtn`; Record ladders (`recordTimeSec/recordQ/recordRamp` — mirroring `buildUpSec/Q/Ramp`); picker host div (thumbnail container + nick/gen-id label + Random button); thread `device/format` from caller; `onPlay` signature extends to optionally pass `pickedRef`. Disabled-Record-tab fallback when `MediaRecorder.isTypeSupported('video/webm;codecs=vp9')` is false.
- `src/screensaver-ui.test.ts` — Mode-row has 3 buttons; Record ladders show/hide on mode switch; thumbnail container mounts; disabled-fallback test.
- `src/screensaver-mount.ts` — New `runRecordSession(args)` mode handle parallel to `runBuildUpSession`; simplified pill (`⛶` + `⏹` only); `onPlay` callback accepts optional `pickedRef`; status panel format for recording (`Recording <name>\n● 0:23 / 1:00 · samples … · ~3.4 MB`).
- `src/main.ts` — Plumb `device, format` from main → `mountScreensaverLanding`; extend `onPlay` call to dispatch on `prefs.mode === 'record'` → `runRecordSession`.

**Touched but not edited:**
- `src/screensaver-pacing.ts` — `cumulativeSamplesAt` + `rampLabel` reused as-is.
- `src/flame-name-template.ts` — `resolveTemplate` reused for Q4 case 2.
- `src/feature-index-client.ts` — `loadFeatureIndex` reused; `SheepRef` shape reused.

---

## Task 0: Pre-flight — branch + issue-start

**Files:**
- None (git/gh ops only)

- [ ] **Step 1: Confirm tree clean on main**

Run: `git status --short && git rev-parse --abbrev-ref HEAD`
Expected: no output (clean) + `main`.

- [ ] **Step 2: Create feature branch**

Run: `git checkout -b feature/issue-111-record`
Expected: `Switched to a new branch 'feature/issue-111-record'`.

- [ ] **Step 3: Assign + start the issue**

Run: `gh issue edit 111 --add-assignee MattAltermatt && gh issue comment 111 --body "Starting on feature/issue-111-record."`
Expected: comment posted; assignee set.

- [ ] **Step 4: No commit yet** — branch is empty relative to main until Task 1 lands.

---

## Task 1: Filename ladder module — `screensaver-record-filename.ts`

**Files:**
- Create: `src/screensaver-record-filename.ts`
- Test: `src/screensaver-record-filename.test.ts`

**Spec reference:** Q4 of the spec — 5-case ladder, uniform `.pyr3.webm` suffix.

**Interface to implement:**

```ts
import type { Genome } from './genome';
import type { SheepRef } from './gallery-mount';

export interface RecordingFilenameContext {
  genome: Genome;
  ref?: SheepRef;     // Set for ESF flames (Random-pulled from corpus).
  now: Date;          // Caller supplies so tests pin the clock.
}

export function deriveRecordingFilename(ctx: RecordingFilenameContext): string;
```

**Algorithm:**

```text
1.  ctx.ref       ≠ undefined    → `electricsheep.<gen>.<id>.pyr3.webm`
2.  hasTemplate(genome.name)     → `<resolveTemplate(genome.name, …)>.pyr3.webm`
                                    where the TemplateContext uses {genome, seed=0, now, index=1, random='0000'}
                                    (recording doesn't carry a real seed; pass deterministic stubs so
                                    {seed}/{random}/{index} resolve to stable values — keeps the
                                    filename deterministic per-genome)
3.  genome.name (plain, non-empty) → `<sanitize(genome.name)>.pyr3.webm`
4.  genome.nick (non-empty)      → `<sanitize(genome.nick)>.pyr3.webm`
5.  fallback                     → `pyr3-<YYYYMMDD-HHMM>.pyr3.webm`
```

`sanitize(s)` is a defensive pass that replaces any filesystem-unfriendly run (`[ /:\\<>"|?*]+`) with a single `-`, trims leading/trailing `-`, falls through to fallback if the result is empty.

- [ ] **Step 1: Write the failing test file**

```ts
// src/screensaver-record-filename.test.ts
import { describe, it, expect } from 'vitest';
import { deriveRecordingFilename } from './screensaver-record-filename';
import type { Genome } from './genome';
import type { SheepRef } from './gallery-mount';

const PIN = new Date(2026, 5, 5, 16, 24); // June 5 2026 16:24 — local time
function blankGenome(over: Partial<Genome> = {}): Genome {
  return {
    xforms: [],
    palette: { name: 'default', entries: [] },
    name: '',
    nick: '',
    ...over,
  } as Genome;
}

describe('deriveRecordingFilename', () => {
  it('case 1: ESF flame with corpus ref → electricsheep.<gen>.<id>.pyr3.webm', () => {
    const ref: SheepRef = { gen: 247, id: 19679 };
    const out = deriveRecordingFilename({ genome: blankGenome(), ref, now: PIN });
    expect(out).toBe('electricsheep.247.19679.pyr3.webm');
  });

  it('case 2: name is a template → resolved + .pyr3.webm', () => {
    const g = blankGenome({
      name: '{palette}-{date}',
      palette: { name: 'south-sea-bather', entries: [] },
    } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('south-sea-bather-20260605.pyr3.webm');
  });

  it('case 3: plain name (non-empty), no template → name.pyr3.webm', () => {
    const g = blankGenome({ name: 'My Cool Flame' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('My-Cool-Flame.pyr3.webm');
  });

  it('case 4: only nick set → nick.pyr3.webm', () => {
    const g = blankGenome({ nick: 'sheep_walker' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('sheep_walker.pyr3.webm');
  });

  it('case 5: nothing set → pyr3-<YYYYMMDD-HHMM>.pyr3.webm', () => {
    const out = deriveRecordingFilename({ genome: blankGenome(), now: PIN });
    expect(out).toBe('pyr3-20260605-1624.pyr3.webm');
  });

  it('case 1 takes precedence over name/nick when ref is provided', () => {
    const g = blankGenome({ name: 'override', nick: 'override-nick' } as Partial<Genome>);
    const ref: SheepRef = { gen: 248, id: 23554 };
    const out = deriveRecordingFilename({ genome: g, ref, now: PIN });
    expect(out).toBe('electricsheep.248.23554.pyr3.webm');
  });

  it('sanitizes path-unsafe characters', () => {
    const g = blankGenome({ name: 'evil/name:with*bad?chars' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('evil-name-with-bad-chars.pyr3.webm');
  });

  it('falls through to fallback when sanitized name is empty', () => {
    const g = blankGenome({ name: '???' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('pyr3-20260605-1624.pyr3.webm');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run src/screensaver-record-filename.test.ts`
Expected: 8 FAIL with "Cannot find module './screensaver-record-filename'".

- [ ] **Step 3: Implement the module**

```ts
// src/screensaver-record-filename.ts
import type { Genome } from './genome';
import type { SheepRef } from './gallery-mount';
import { hasTemplate, resolveTemplate, type TemplateContext } from './flame-name-template';

export interface RecordingFilenameContext {
  genome: Genome;
  ref?: SheepRef;
  now: Date;
}

const SUFFIX = '.pyr3.webm';
const UNSAFE = /[ /\\:<>"|?*]+/g;

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function stampMinutes(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function sanitize(s: string): string {
  return s.replace(UNSAFE, '-').replace(/^-+|-+$/g, '');
}

function fallback(now: Date): string {
  return `pyr3-${stampMinutes(now)}${SUFFIX}`;
}

export function deriveRecordingFilename(ctx: RecordingFilenameContext): string {
  // Case 1: ESF corpus flame.
  if (ctx.ref) {
    return `electricsheep.${ctx.ref.gen}.${ctx.ref.id}${SUFFIX}`;
  }

  const name = ctx.genome.name?.trim() ?? '';
  const nick = ctx.genome.nick?.trim() ?? '';

  // Case 2: template name.
  if (name && hasTemplate(name)) {
    const templateCtx: TemplateContext = {
      genome: ctx.genome,
      seed: 0,
      now: ctx.now,
      index: 1,
      random: '0000',
    };
    const resolved = sanitize(resolveTemplate(name, templateCtx));
    if (resolved) return `${resolved}${SUFFIX}`;
    return fallback(ctx.now);
  }

  // Case 3: plain name.
  if (name) {
    const clean = sanitize(name);
    if (clean) return `${clean}${SUFFIX}`;
    return fallback(ctx.now);
  }

  // Case 4: nick only.
  if (nick) {
    const clean = sanitize(nick);
    if (clean) return `${clean}${SUFFIX}`;
    return fallback(ctx.now);
  }

  // Case 5: fallback.
  return fallback(ctx.now);
}
```

- [ ] **Step 4: Run the test, expect green**

Run: `npx vitest run src/screensaver-record-filename.test.ts`
Expected: 8 PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/screensaver-record-filename.ts src/screensaver-record-filename.test.ts
git commit -m "feat(#111): filename ladder for screensaver recordings"
```

---

## Task 2: Recorder state machine — `screensaver-record.ts`

**Files:**
- Create: `src/screensaver-record.ts`
- Test: `src/screensaver-record.test.ts`

**Spec reference:** Q5 of the spec — `start`/`stop(save)`/`stop(abort)` lifecycle, byte accumulation, download anchor on `save=true`.

**Interface to implement:**

```ts
export interface RecorderHandle {
  start(): void;                          // Calls recorder.start()
  stop(save: boolean): Promise<void>;     // Awaits recorder.onstop; downloads on save=true
  elapsedMs(): number;                    // performance.now() delta since start; 0 before start
  bytesAccumulated(): number;             // sum of e.data.size across ondataavailable
}

export interface RecorderOpts {
  canvas: HTMLCanvasElement;
  filename: string;
  fps?: number;                            // default 30
  mimeType?: string;                       // default 'video/webm;codecs=vp9'
  /** Test hook: anchor click side-effect. Production passes undefined → default
   *  builds an anchor + clicks it. Tests supply a spy so download-on-save vs
   *  no-download-on-abort is observable without DOM mutation. */
  download?: (blob: Blob, filename: string) => void;
  /** Test hook: now() — defaults to performance.now. */
  now?: () => number;
}

export function createRecorder(opts: RecorderOpts): RecorderHandle;

/** Module-level capability probe; returns true if VP9 webm is supported in
 *  the current browser. Used by screensaver-ui to disable the Record tab on
 *  unsupported browsers. */
export function isRecordingSupported(): boolean;
```

**Behavior:**

- `start()` — calls `recorder.start(1000)` (1s timeslice so `ondataavailable` fires periodically and `bytesAccumulated()` updates during recording). Sets `startTime = now()`.
- `stop(save: true)` — calls `recorder.stop()`, awaits `onstop`, builds `new Blob(chunks, { type: mimeType })`, invokes `download(blob, filename)`.
- `stop(save: false)` — calls `recorder.stop()`, awaits `onstop`, discards chunks (no download call).
- `elapsedMs()` — 0 before start; after start returns `now() - startTime`.
- `bytesAccumulated()` — sum of `e.data.size` chunks seen so far.
- `isRecordingSupported()` — `typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')`.

- [ ] **Step 1: Write the failing test file**

```ts
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
    expect(download.mock.calls[0][1]).toBe('awesome.pyr3.webm');
    expect(download.mock.calls[0][0]).toBeInstanceOf(Blob);
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
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run src/screensaver-record.test.ts`
Expected: 7 FAIL with "Cannot find module './screensaver-record'".

- [ ] **Step 3: Implement the module**

```ts
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
  /** Test hook — overrides anchor-click download. */
  download?: (blob: Blob, filename: string) => void;
  /** Test hook — overrides performance.now. */
  now?: () => number;
}

const DEFAULT_MIME = 'video/webm;codecs=vp9';
const DEFAULT_FPS  = 30;
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
  const recorder = new MediaRecorder(stream, { mimeType });

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
```

- [ ] **Step 4: Run the test, expect green**

Run: `npx vitest run src/screensaver-record.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/screensaver-record.ts src/screensaver-record.test.ts
git commit -m "feat(#111): MediaRecorder lifecycle (start/stop/save/abort + byte accum)"
```

---

## Task 3: Prefs v3→v4 migration — extend `ScreensaverPrefs`

**Files:**
- Modify: `src/screensaver-prefs.ts`
- Modify: `src/screensaver-prefs.test.ts`

**Spec reference:** Spec data-shape section — add `'record'` mode + `recordTimeSec/recordQ/recordRamp` fields; bump version 3 → 4.

- [ ] **Step 1: Read existing prefs test file shape**

Run: `cat src/screensaver-prefs.test.ts | head -50`
Expected: shows existing test scaffolding (imports, helper for clearing localStorage).

- [ ] **Step 2: Write the failing migration tests**

Append to `src/screensaver-prefs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  _clearScreensaverPrefs,
  PREFS_KEY,
  PREFS_VERSION,
  DEFAULTS,
} from './screensaver-prefs';

describe('ScreensaverPrefs v3→v4 migration', () => {
  beforeEach(() => _clearScreensaverPrefs());

  it('PREFS_VERSION bumped to 4', () => {
    expect(PREFS_VERSION).toBe(4);
  });

  it('DEFAULTS includes record fields', () => {
    expect(DEFAULTS.recordTimeSec).toBe(30);  // 30s — short default fits "I just want a quick clip"
    expect(DEFAULTS.recordQ).toBe(200);       // Match buildUpQ — same perceptual target
    expect(DEFAULTS.recordRamp).toBe(3);      // Medium — same as buildUp default
  });

  it('mode union accepts "record"', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record' });
    const out = readScreensaverPrefs();
    expect(out.mode).toBe('record');
  });

  it('v3 payload (no record fields, version=3) falls back to DEFAULTS', () => {
    const v3 = { version: 3, mode: 'build-up', buildUpSec: 120, restSec: 30, holdSec: 15,
                 buildUpQ: 300, slideshowQ: 100, buildUpRamp: 5 };
    localStorage.setItem(PREFS_KEY, JSON.stringify(v3));
    const out = readScreensaverPrefs();
    // version mismatch → full DEFAULTS reset (matches existing v2→v3 policy)
    expect(out).toEqual(DEFAULTS);
  });

  it('clamps recordTimeSec to [5, 3600]', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordTimeSec: 999999 });
    expect(readScreensaverPrefs().recordTimeSec).toBe(3600);
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordTimeSec: 0 });
    expect(readScreensaverPrefs().recordTimeSec).toBe(5);
  });

  it('clamps recordQ to [10, 500]', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordQ: 9999 });
    expect(readScreensaverPrefs().recordQ).toBe(500);
  });

  it('clamps recordRamp to [1, 10]', () => {
    writeScreensaverPrefs({ ...DEFAULTS, mode: 'record', recordRamp: 999 });
    expect(readScreensaverPrefs().recordRamp).toBe(10);
  });
});
```

- [ ] **Step 3: Run failing tests**

Run: `npx vitest run src/screensaver-prefs.test.ts`
Expected: New tests FAIL (PREFS_VERSION still 3, no record fields).

- [ ] **Step 4: Implement the migration**

Edit `src/screensaver-prefs.ts`:

```ts
// (1) Extend the mode union:
export type ScreensaverMode = 'slideshow' | 'build-up' | 'record';

// (2) Extend the prefs interface (append after buildUpRamp):
export interface ScreensaverPrefs {
  mode: ScreensaverMode;
  buildUpSec: number;
  restSec: number;
  holdSec: number;
  buildUpQ: number;
  slideshowQ: number;
  buildUpRamp: number;
  // Record mode (#111). Mirrors buildUpSec/Q/Ramp — same units, same clamps.
  // Default 30s/200/Medium=3 matches the "quick clip" framing.
  recordTimeSec: number;
  recordQ: number;
  recordRamp: number;
}

// (3) Bump version comment + value:
// v4 (2026-06-05): added Record mode + recordTimeSec/recordQ/recordRamp.
// v3 prefs (and earlier) fall back to DEFAULTS.
export const PREFS_VERSION = 4;

// (4) Extend DEFAULTS:
export const DEFAULTS: ScreensaverPrefs = {
  mode: 'build-up',
  buildUpSec: 60,
  restSec: 0,
  holdSec: 15,
  buildUpQ:   200,
  slideshowQ: 100,
  buildUpRamp: 3.0,
  recordTimeSec: 30,
  recordQ:       200,
  recordRamp:    3.0,
};

// (5) Extend CLAMPS:
export const CLAMPS = {
  buildUpSec: { min: 5,  max: 3600 },
  restSec:    { min: 0,  max: 600  },
  holdSec:    { min: 1,  max: 600  },
  buildUpQ:   { min: 10, max: 500  },
  slideshowQ: { min: 10, max: 500  },
  buildUpRamp:{ min: 1,  max: 10   },
  recordTimeSec: { min: 5,  max: 3600 },
  recordQ:       { min: 10, max: 500  },
  recordRamp:    { min: 1,  max: 10   },
} as const;

// (6) Extend isMode:
function isMode(v: unknown): v is ScreensaverMode {
  return v === 'slideshow' || v === 'build-up' || v === 'record';
}

// (7) Extend applyClamps (add the 3 record fields, mirroring buildUp* clauses):
function applyClamps(p: ScreensaverPrefs): ScreensaverPrefs {
  return {
    mode: p.mode,
    buildUpSec: clamp(p.buildUpSec, CLAMPS.buildUpSec.min, CLAMPS.buildUpSec.max),
    restSec:    clamp(p.restSec,    CLAMPS.restSec.min,    CLAMPS.restSec.max),
    holdSec:    clamp(p.holdSec,    CLAMPS.holdSec.min,    CLAMPS.holdSec.max),
    buildUpQ:   clamp(p.buildUpQ,   CLAMPS.buildUpQ.min,   CLAMPS.buildUpQ.max),
    slideshowQ: clamp(p.slideshowQ, CLAMPS.slideshowQ.min, CLAMPS.slideshowQ.max),
    buildUpRamp: clamp(p.buildUpRamp, CLAMPS.buildUpRamp.min, CLAMPS.buildUpRamp.max),
    recordTimeSec: clamp(p.recordTimeSec, CLAMPS.recordTimeSec.min, CLAMPS.recordTimeSec.max),
    recordQ:       clamp(p.recordQ,       CLAMPS.recordQ.min,       CLAMPS.recordQ.max),
    recordRamp:    clamp(p.recordRamp,    CLAMPS.recordRamp.min,    CLAMPS.recordRamp.max),
  };
}

// (8) Extend readScreensaverPrefs payload parse (in the applyClamps({...}) call):
return applyClamps({
  mode: p.mode,
  buildUpSec: typeof p.buildUpSec === 'number' ? p.buildUpSec : DEFAULTS.buildUpSec,
  restSec:    typeof p.restSec    === 'number' ? p.restSec    : DEFAULTS.restSec,
  holdSec:    typeof p.holdSec    === 'number' ? p.holdSec    : DEFAULTS.holdSec,
  buildUpQ:   typeof p.buildUpQ   === 'number' ? p.buildUpQ   : DEFAULTS.buildUpQ,
  slideshowQ: typeof p.slideshowQ === 'number' ? p.slideshowQ : DEFAULTS.slideshowQ,
  buildUpRamp: typeof p.buildUpRamp === 'number' ? p.buildUpRamp : DEFAULTS.buildUpRamp,
  recordTimeSec: typeof p.recordTimeSec === 'number' ? p.recordTimeSec : DEFAULTS.recordTimeSec,
  recordQ:       typeof p.recordQ       === 'number' ? p.recordQ       : DEFAULTS.recordQ,
  recordRamp:    typeof p.recordRamp    === 'number' ? p.recordRamp    : DEFAULTS.recordRamp,
});
```

- [ ] **Step 5: Run tests, expect green**

Run: `npx vitest run src/screensaver-prefs.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: exit 0 for both; full suite green (no regression on existing prefs callers).

- [ ] **Step 7: Commit**

```bash
git add src/screensaver-prefs.ts src/screensaver-prefs.test.ts
git commit -m "feat(#111): prefs v4 — record mode + recordTimeSec/Q/Ramp"
```

---

## Task 4: UI — 3rd mode tab + Record ladders + picker host

**Files:**
- Modify: `src/screensaver-ui.ts`
- Modify: `src/screensaver-ui.test.ts`

**Spec reference:** Q1 + Q3 + Q5 of the spec. This task lands the static-DOM portion (3-tab picker, Record ladders, picker container, disabled fallback). Thumbnail live-rendering is Task 5; this task leaves a `<canvas>` placeholder + `Random` button as scaffolding.

**Inline lead** — touches DOM idioms and existing style sheets. Lead drives.

**Key signature extension** — `mountScreensaverLanding` adds optional `device/format/isRecordingSupported` so the picker (Task 5) can render thumbnails and the Record-tab disabled fallback works:

```ts
export interface ScreensaverLandingOpts {
  onPlay: (prefs: ScreensaverPrefs, pickedRef?: SheepRef) => void;
  device?: GPUDevice;
  format?: GPUTextureFormat;
  isRecordingSupported?: () => boolean;  // injectable for tests; default checks MediaRecorder
}
```

- [ ] **Step 1: Update `mountScreensaverLanding` signature + import**

Add at top of `src/screensaver-ui.ts`:

```ts
import type { SheepRef } from './gallery-mount';
import { isRecordingSupported } from './screensaver-record';
```

Update interface (replace existing `ScreensaverLandingOpts`):

```ts
export interface ScreensaverLandingOpts {
  onPlay: (prefs: ScreensaverPrefs, pickedRef?: SheepRef) => void;
  device?: GPUDevice;
  format?: GPUTextureFormat;
  /** Test hook — defaults to import from screensaver-record. */
  isRecordingSupported?: () => boolean;
}
```

- [ ] **Step 2: Add `recordTimeSec/recordQ/recordRamp` to LADDERS + LADDER_META**

Extend the existing `LADDERS` const:

```ts
const LADDERS = {
  buildUpSec: [30, 60, 300, 600],
  restSec:    [0,  30, 60, 120],
  holdSec:    [5,  15, 30, 60],
  buildUpQ:   [50, 100, 200, 500],
  slideshowQ: [50, 100, 200, 500],
  buildUpRamp:[1,  2,  3,  5],
  recordTimeSec: [10, 30, 60, 300],     // 10s / 30s / 1m / 5m — clip-length presets
  recordQ:       [50, 100, 200, 500],
  recordRamp:    [1,  2,  3,  5],
} as const;
```

Extend `LADDER_META` (add 3 entries after `buildUpRamp`):

```ts
recordTimeSec: {
  label: 'Build-up time',
  hint:  'How long the recorded clip is — the chaos game draws over this duration.',
  mode:  'record' as const,
  fmt:   fmtSec,
  parse: parseSecondsInput,
},
recordQ: {
  label: 'Quality',
  hint:  'Samples per pixel to reach by settle. Higher = denser, smoother flame. 10–500.',
  mode:  'record' as const,
  fmt:   fmtPlain,
  parse: parseNumericInput,
},
recordRamp: {
  label: 'Ramp',
  hint:  'Shape of how samples land over time during the recorded clip.',
  mode:  'record' as const,
  fmt:   rampLabel,
  parse: parseNumericInput,
},
```

Extend the `LadderMeta.mode` type:

```ts
interface LadderMeta {
  label: string;
  hint: string;
  mode: 'build-up' | 'slideshow' | 'record';
  fmt: (n: number) => string;
  parse: (raw: string) => number | null;
}
```

- [ ] **Step 3: Bump mode-row grid to 3 columns + add Record button**

In the stylesheet block:

```css
.pyr3-screensaver-mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;   /* was: 1fr 1fr */
  gap: 8px;
}
.pyr3-screensaver-mode-btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.pyr3-screensaver-mode-btn[disabled]:hover {
  color: ${COLORS.text.muted};
  border-color: ${COLORS.border};
}
```

Inside `mountScreensaverLanding`, after `buildUpBtn` creation:

```ts
const recordBtn = el('button', 'pyr3-screensaver-mode-btn');
recordBtn.dataset.screensaverMode = 'record';
recordBtn.textContent = 'Record';

const checkSupport = opts.isRecordingSupported ?? isRecordingSupported;
const recordingOk = checkSupport();
if (!recordingOk) {
  recordBtn.disabled = true;
  recordBtn.title = 'Recording requires a Chromium-based browser';
}

modeRow.append(slideshowBtn, buildUpBtn, recordBtn);
```

Update `refreshModeButtons` to handle the new button:

```ts
function refreshModeButtons(): void {
  slideshowBtn.classList.toggle('on', prefs.mode === 'slideshow');
  buildUpBtn.classList.toggle('on', prefs.mode === 'build-up');
  recordBtn.classList.toggle('on', prefs.mode === 'record');
  for (const field of Object.keys(LADDER_META) as LadderField[]) {
    const block = ladderBlocks[field];
    if (!block) continue;
    block.classList.toggle('hidden', LADDER_META[field].mode !== prefs.mode);
  }
  // Picker container: visible only in record mode.
  pickerContainer.classList.toggle('hidden', prefs.mode !== 'record');
}
```

Wire the Record-mode click handler (mirrors the others):

```ts
recordBtn.addEventListener('click', () => {
  if (recordBtn.disabled) return;
  prefs = { ...prefs, mode: 'record' };
  refreshModeButtons();
});
```

- [ ] **Step 4: Add picker container scaffolding (no live thumbnail yet — Task 5 wires that)**

After ladder-block creation in the existing card-build flow, before the play button, insert:

```ts
const pickerContainer = el('div', 'pyr3-screensaver-picker');
pickerContainer.dataset.screensaverPicker = '';
const thumbCanvas = el('canvas', 'pyr3-screensaver-thumb');
thumbCanvas.width = 300;
thumbCanvas.height = 300;
const thumbLabel = el('div', 'pyr3-screensaver-thumb-label');
thumbLabel.textContent = '(select Record to load)';
const randomBtn = el('button', 'pyr3-screensaver-random');
randomBtn.textContent = '🎲 Random';
randomBtn.title = 'Pick a different flame to record';
randomBtn.dataset.screensaverRandom = '';
pickerContainer.append(thumbCanvas, thumbLabel, randomBtn);
card.append(pickerContainer);
```

Add picker styles inside the existing stylesheet block:

```css
.pyr3-screensaver-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 8px;
}
.pyr3-screensaver-picker.hidden { display: none; }
.pyr3-screensaver-thumb {
  width: 300px;
  height: 300px;
  background: #000;
  border-radius: 4px;
  display: block;
}
.pyr3-screensaver-thumb-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: ${COLORS.text.muted};
  text-align: center;
  min-height: 16px;
}
.pyr3-screensaver-random {
  padding: 6px 14px;
  background: ${COLORS.bg.panel};
  border: 1px solid ${COLORS.border};
  border-radius: 4px;
  color: ${COLORS.text.primary};
  font-size: 13px;
  cursor: pointer;
}
.pyr3-screensaver-random:hover {
  border-color: ${COLORS.flame.mid};
}
```

- [ ] **Step 5: Append all record ladders to card in the right order**

After existing `card.append(buildLadder('slideshowQ'));`:

```ts
card.append(buildLadder('recordTimeSec'));
card.append(buildLadder('recordQ'));
card.append(buildLadder('recordRamp'));
```

`refreshModeButtons()` already hides/shows ladders by mode, so this is enough.

- [ ] **Step 6: Expose `pickedRef` to `onPlay` (placeholder for Task 5)**

In Task 4, `pickedRef` is always `undefined` (the picker scaffolding doesn't yet pick a real ref). Task 5 wires this. Update the play handler:

```ts
let pickedRef: SheepRef | undefined = undefined;

play.addEventListener('click', () => {
  writeScreensaverPrefs(prefs);
  opts.onPlay(prefs, pickedRef);
});
```

- [ ] **Step 7: Write tests for the UI changes**

Append to `src/screensaver-ui.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mountScreensaverLanding } from './screensaver-ui';
import { _clearScreensaverPrefs } from './screensaver-prefs';

describe('screensaver-ui — Record mode tab', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _clearScreensaverPrefs();
  });

  it('renders 3 mode buttons (Slideshow, Build-up, Record)', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    const btns = host.querySelectorAll('[data-screensaver-mode]');
    expect(btns.length).toBe(3);
    expect((btns[0] as HTMLElement).dataset.screensaverMode).toBe('slideshow');
    expect((btns[1] as HTMLElement).dataset.screensaverMode).toBe('build-up');
    expect((btns[2] as HTMLElement).dataset.screensaverMode).toBe('record');
  });

  it('disables Record button when recording is not supported', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => false });
    const recordBtn = host.querySelector<HTMLButtonElement>('[data-screensaver-mode="record"]');
    expect(recordBtn?.disabled).toBe(true);
    expect(recordBtn?.title).toMatch(/Chromium/);
  });

  it('shows picker container only when mode = record', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    const picker = host.querySelector('.pyr3-screensaver-picker');
    expect(picker?.classList.contains('hidden')).toBe(true);
    (host.querySelector('[data-screensaver-mode="record"]') as HTMLButtonElement).click();
    expect(picker?.classList.contains('hidden')).toBe(false);
  });

  it('shows record ladders (Build-up time, Quality, Ramp) only in record mode', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    (host.querySelector('[data-screensaver-mode="record"]') as HTMLButtonElement).click();
    const visibleLadders = Array.from(
      host.querySelectorAll<HTMLElement>('[data-screensaver-ladder-block]')
    ).filter((el) => !el.classList.contains('hidden'));
    const fields = visibleLadders.map((el) => el.dataset.screensaverLadderBlock);
    expect(fields).toEqual(['recordTimeSec', 'recordQ', 'recordRamp']);
  });

  it('does NOT show rest period in record mode', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountScreensaverLanding(host, { onPlay: () => {}, isRecordingSupported: () => true });
    (host.querySelector('[data-screensaver-mode="record"]') as HTMLButtonElement).click();
    const restBlock = host.querySelector<HTMLElement>('[data-screensaver-ladder-block="restSec"]');
    expect(restBlock?.classList.contains('hidden')).toBe(true);
  });
});
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run src/screensaver-ui.test.ts`
Expected: green.

- [ ] **Step 9: Run full unit suite**

Run: `npm test`
Expected: green; no regressions in unrelated tests.

- [ ] **Step 10: Commit**

```bash
git add src/screensaver-ui.ts src/screensaver-ui.test.ts
git commit -m "feat(#111): screensaver-ui — Record mode tab + ladders + picker host"
```

---

## Task 5: Picker — thumbnail rendering + Random button wiring

**Files:**
- Modify: `src/screensaver-ui.ts` (picker logic; thumbnail render call)
- Modify: `src/main.ts` (thread `device, format` through `mountScreensaverLanding`)
- Optional: small extraction `src/screensaver-thumb.ts` if the render logic justifies it

**Inline lead.** Needs WebGPU device threading from main.ts; subagent permission gap for dev-server work.

**Approach:** When Record tab activates (or Random clicks), pick a random `SheepRef` from the corpus index, load + parse genome, run a fast render at 300×300 onto the picker canvas, and update the label. Failures (load error, render error) re-roll silently up to 3 times before falling back to "Couldn't load — try again" label.

- [ ] **Step 1: Thread device/format through main.ts → mountScreensaverLanding**

Find `mountScreensaverLanding(` call in `src/main.ts` (likely in the `/v1/screensaver` route handler) and add `device, format, isRecordingSupported`:

```ts
mountScreensaverLanding(host, {
  onPlay: (prefs, pickedRef) => { /* will be extended in Task 6 */ },
  device,
  format,
  isRecordingSupported,
});
```

The `device, format` come from the same place the build-up mode currently uses them (route setup).

- [ ] **Step 2: Add the picker render function inside `mountScreensaverLanding`**

After picker scaffolding (Task 4 Step 4), add:

```ts
import { loadFeatureIndex } from './feature-index-client';
import { fetchFlameXml, parseFlame } from './flame-import';
import { createRenderer, type Renderer } from './renderer';
import type { Genome } from './genome';

const THUMB_DIM = 300;
const THUMB_Q   = 50;          // samples/px — fast preview density
const THUMB_OVS = 1;
const THUMB_FILTER = 1.0;

let thumbRenderer: Renderer | null = null;
let pickedGenome: Genome | null = null;

async function ensureRendererForThumb(): Promise<Renderer | null> {
  if (!opts.device || !opts.format) return null;
  if (thumbRenderer) return thumbRenderer;
  // Configure the canvas context once.
  const ctx = thumbCanvas.getContext('webgpu');
  if (!ctx) return null;
  ctx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });
  thumbRenderer = createRenderer(opts.device, opts.format, {
    width: THUMB_DIM,
    height: THUMB_DIM,
    oversample: THUMB_OVS,
    filterRadius: THUMB_FILTER,
  });
  return thumbRenderer;
}

async function pickAndRenderRandom(): Promise<void> {
  if (!opts.device || !opts.format) return;
  thumbLabel.textContent = 'Loading…';
  const renderer = await ensureRendererForThumb();
  if (!renderer) {
    thumbLabel.textContent = '(thumbnail unavailable)';
    return;
  }
  const index = await loadFeatureIndex();
  if (index.length === 0) {
    thumbLabel.textContent = '(corpus unavailable)';
    return;
  }

  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    const ref = index[Math.floor(Math.random() * index.length)]!;
    try {
      const xml = await fetchFlameXml(ref.gen, ref.id);
      const { genome } = parseFlame(xml);
      // Render the thumbnail: q=50 samples/px, single present (no settle/rest).
      renderer.resize({
        width: THUMB_DIM,
        height: THUMB_DIM,
        oversample: THUMB_OVS,
        filterRadius: THUMB_FILTER,
      });
      renderer.reset(genome);
      const target = THUMB_Q * THUMB_DIM * THUMB_DIM;
      const walkers = 4096;
      const iters   = Math.max(64, Math.ceil(target / walkers));
      renderer.iterate({ genome, seed: (Math.random() * 0xffffffff) >>> 0, walkers, itersPerWalker: iters });
      const ctx = thumbCanvas.getContext('webgpu')!;
      renderer.present({
        genome,
        outputView: ctx.getCurrentTexture().createView(),
        totalSamples: walkers * iters,
        forceDeOff: false,
      });
      pickedRef    = ref;
      pickedGenome = genome;
      thumbLabel.textContent = `${genome.nick || '(unnamed)'} · ${ref.gen}/${ref.id}`;
      return;
    } catch {
      // Try a different flame.
    }
  }
  thumbLabel.textContent = '(couldn\'t load — try again)';
}

randomBtn.addEventListener('click', () => { void pickAndRenderRandom(); });
```

- [ ] **Step 3: Auto-pick on first Record tab activation**

In the `recordBtn.addEventListener('click', …)` handler (Task 4 Step 3), add a guard that triggers `pickAndRenderRandom()` if no flame has been picked yet:

```ts
recordBtn.addEventListener('click', () => {
  if (recordBtn.disabled) return;
  prefs = { ...prefs, mode: 'record' };
  refreshModeButtons();
  if (!pickedRef) {
    void pickAndRenderRandom();
  }
});
```

- [ ] **Step 4: Disable Start in Record mode until a flame is picked**

After `play` button creation, add a refresh helper called from `pickAndRenderRandom` success branch + `refreshModeButtons`:

```ts
function refreshPlayability(): void {
  if (prefs.mode === 'record') {
    play.disabled = !pickedRef;
    play.textContent = pickedRef ? '▶ Start recording' : '(pick a flame)';
  } else {
    play.disabled = false;
    play.textContent = '▶ Start screensaver';
  }
}
// Call after every refreshModeButtons() AND inside pickAndRenderRandom success.
```

Make sure the button's CSS still works with disabled state — add:

```css
.pyr3-screensaver-play[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(0.4);
}
```

- [ ] **Step 5: Clean up thumbRenderer on `refresh()` / unmount**

Extend the returned `ScreensaverLandingHandle.refresh` to NOT teardown the renderer (refresh is for re-reading prefs only). No teardown call needed — page unmount happens at route change in main.ts.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Live verify in Chrome (lead, chrome-devtools-mcp)**

Start dev server:

```bash
npm run dev   # (background — leave running for Tasks 6–7)
```

Open `http://localhost:5173/v1/screensaver`. Click Record. Expect:
- Picker container appears.
- After ~300-500ms, a flame thumbnail renders.
- Label shows `<nick> · <gen>/<id>`.
- Random button re-rolls + re-renders.
- Start button reads "▶ Start recording" and is active.

Click Build-up: picker container hides, ladders swap back. Click Record again: thumbnail persists (no re-render unless Random clicked).

- [ ] **Step 8: Commit**

```bash
git add src/screensaver-ui.ts src/main.ts
git commit -m "feat(#111): picker — live thumbnail + Random + auto-pick on Record tab"
```

---

## Task 6: Mount — `runRecordSession()` lifecycle in `screensaver-mount.ts`

**Files:**
- Modify: `src/screensaver-mount.ts`

**Spec reference:** Q5 of the spec — full recording session UX (simplified pill, recording-aware status panel, settle-vs-manual-vs-abort end triggers).

**Inline lead.** Complex state machine + canvas wiring.

**Approach:** Add `runRecordSession(args)` alongside `runBuildUpSession` / `runSlideshowSession`. Copy + adapt the build-up loop (NOT extract a shared inner function — see commentary in the spec; the modes will diverge further over time and extraction adds parameter-noise faster than it deduplicates code). The Record session loads ONE specific flame (the `pickedRef`), wraps the build-up loop with a `MediaRecorder` lifecycle, and exits on settle/manual-stop/abort.

- [ ] **Step 1: Add imports + signature for runRecordSession**

Add at top of `src/screensaver-mount.ts`:

```ts
import type { SheepRef } from './gallery-mount';
import { createRecorder, type RecorderHandle } from './screensaver-record';
import { deriveRecordingFilename } from './screensaver-record-filename';
```

- [ ] **Step 2: Build a record-mode pill helper**

Add alongside `buildNowPlayingPill`:

```ts
interface RecordPillCallbacks {
  onFullscreen: () => void;
  onStop: () => void;   // Stop & save — explicit click intent
}

interface RecordPillHandle {
  el: HTMLElement;
}

function buildRecordPill(cb: RecordPillCallbacks): RecordPillHandle {
  const pill = el('div', 'pyr3-screensaver-pill');
  Object.assign(pill.style, {
    position: 'absolute',
    top: '60px',
    right: '16px',
    padding: '6px',
    display: 'flex',
    gap: '4px',
    background: COLORS.bg.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    zIndex: '11',
  });
  function btn(label: string, fn: () => void, title: string): HTMLButtonElement {
    const b = el('button', 'pyr3-screensaver-pill-btn');
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      padding: '6px 10px',
      background: COLORS.bg.input,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '4px',
      color: COLORS.text.primary,
      cursor: 'pointer',
      fontSize: '14px',
      minWidth: '32px',
    });
    b.addEventListener('click', fn);
    return b;
  }
  pill.append(
    btn('⛶', cb.onFullscreen, 'Toggle fullscreen (F)'),
    btn('⏹', cb.onStop, 'Stop & save (S)'),
  );
  return { el: pill };
}
```

- [ ] **Step 3: Implement `runRecordSession`**

Pattern matches `runBuildUpSession` but loads ONE flame (the pickedRef) and wires the recorder:

```ts
interface RecordSessionArgs {
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasHost: HTMLElement;
  prefs: ScreensaverPrefs;
  status: StatusPanel;
  pickedRef: SheepRef;
  onDone: () => void;   // Called when settle/save/abort completes — landing card returns
}

function runRecordSession(args: RecordSessionArgs): ModeHandle {
  const { device, format, canvasHost, prefs, status, pickedRef, onDone } = args;
  const state = createModeState();
  const isCancelled = () => state.cancelled;

  let recorder: RecorderHandle | null = null;
  let saveOnEnd = false;     // settle → true; manual ⏹ → true; abort/cancel → false

  void (async () => {
    const canvas = makeRenderCanvas(canvasHost);
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('webgpu');
    if (!ctx) { onDone(); return; }
    ctx.configure({ device, format, alphaMode: 'opaque' });

    const renderer: Renderer = createRenderer(device, format, {
      width: W, height: H, oversample: 1, filterRadius: DEFAULT_FILTER_RADIUS,
    });

    let genome: Genome;
    try {
      status.setText(`Loading flame ${pickedRef.gen}/${pickedRef.id}…`);
      genome = await loadGenomeByRef(pickedRef);
    } catch {
      status.setText('Failed to load flame.');
      onDone();
      return;
    }
    if (isCancelled()) { onDone(); return; }

    const overs = Math.min(SCREENSAVER_MAX_OS, genome.oversample ?? 1);
    const filt  = genome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;
    renderer.resize({ width: W, height: H, oversample: overs, filterRadius: filt });
    renderer.reset(genome);

    const filename = deriveRecordingFilename({
      genome,
      ref: pickedRef,
      now: new Date(),
    });
    recorder = createRecorder({ canvas, filename });
    recorder.start();
    saveOnEnd = false;  // becomes true on natural settle or manual ⏹

    const startedAt = performance.now();
    let samplesAccumulated = 0;
    canvas.style.transition = '';
    canvas.style.opacity = '1';

    const totalPixels = W * H;
    const targetTotalSamples = prefs.recordQ * totalPixels;
    const FRAME_INTERVAL_MS  = 1000 / BUILD_UP_TARGET_FPS;

    while (!isCancelled()) {
      const frameStart = performance.now();
      const frameElapsedSec = (frameStart - startedAt) / 1000;
      const cumTarget = cumulativeSamplesAt(
        frameElapsedSec, prefs.recordTimeSec, targetTotalSamples, prefs.recordRamp,
      );
      const neededThisFrame   = Math.max(0, cumTarget - samplesAccumulated);
      const splatItersPerWalker = Math.max(1, Math.ceil(neededThisFrame / BUILD_UP_WALKERS));
      const totalItersPerWalker = BUILD_UP_FUSE + splatItersPerWalker;

      const seed = (Math.random() * 0xffffffff) >>> 0;
      renderer.iterate({ genome, seed, walkers: BUILD_UP_WALKERS, itersPerWalker: totalItersPerWalker });
      samplesAccumulated += BUILD_UP_WALKERS * splatItersPerWalker;

      renderer.present({
        genome,
        outputView:   ctx.getCurrentTexture().createView(),
        totalSamples: Math.max(1, samplesAccumulated),
        forceDeOff:   true,
      });

      const elapsedMs = recorder.elapsedMs();
      const elapsedSec = elapsedMs / 1000;
      const pct  = Math.min(100, Math.round(100 * samplesAccumulated / targetTotalSamples));
      const mb   = (recorder.bytesAccumulated() / (1024 * 1024)).toFixed(2);
      const mmss = (s: number): string => {
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60).toString().padStart(2, '0');
        return `${m}:${r}`;
      };
      status.setText(
        `Recording ${genome.nick || `${pickedRef.gen}/${pickedRef.id}`}\n` +
        `● ${mmss(elapsedSec)} / ${mmss(prefs.recordTimeSec)} · ` +
        `samples ${(samplesAccumulated / 1e6).toFixed(1)}M / ${(targetTotalSamples / 1e6).toFixed(1)}M · ${pct}% · ` +
        `~${mb} MB`,
      );

      if (samplesAccumulated >= targetTotalSamples) { saveOnEnd = true; break; }
      if (elapsedSec >= prefs.recordTimeSec)        { saveOnEnd = true; break; }

      const frameElapsed = performance.now() - frameStart;
      const sleepFor     = Math.max(1, FRAME_INTERVAL_MS - frameElapsed);
      await new Promise<void>((r) => setTimeout(r, sleepFor));
    }
    if (isCancelled() && !state.manualStopAndSave) {
      // Esc / browser-back / tab-close path — abort + no download.
      await recorder.stop(false);
      onDone();
      return;
    }

    // Settle: density ON, tone-normalize to actual accumulated samples.
    renderer.present({
      genome,
      outputView:   ctx.getCurrentTexture().createView(),
      totalSamples: Math.max(1, samplesAccumulated),
      forceDeOff:   false,
    });

    status.setText('Saving recording…');
    await recorder.stop(saveOnEnd || state.manualStopAndSave);
    onDone();
  })();

  return {
    cancel() { state.cancelled = true; },
    controls: {
      togglePause() { /* no-op in record mode */ },
      isPaused() { return false; },
      skip(_dir) { /* no-op in record mode */ },
    },
  };
}
```

Notice: `state.manualStopAndSave` is a new flag on `createModeState()` — add it now:

```ts
function createModeState(): ModeState {
  return {
    cancelled: false,
    paused: false,
    skipDir: 0,
    pauseAccumMs: 0,
    pausedAt: 0,
    manualStopAndSave: false,   // ⏹ pressed during recording — save & exit
  };
}

interface ModeState {
  cancelled: boolean;
  paused: boolean;
  skipDir: number;
  pauseAccumMs: number;
  pausedAt: number;
  manualStopAndSave: boolean;
}
```

- [ ] **Step 4: Wire `runRecordSession` into `mountScreensaverPage`**

Edit `mountScreensaverPage` (near line 801 in current `screensaver-mount.ts`). After current mode dispatch (slideshow/buildUp), add:

```ts
let activeHandle: ModeHandle | null = null;
let pillHandle: PillHandle | RecordPillHandle | null = null;

function startSession(prefs: ScreensaverPrefs, pickedRef?: SheepRef): void {
  if (prefs.mode === 'record') {
    if (!pickedRef) {
      console.warn('Record mode requires pickedRef');
      return;
    }
    const status = buildStatusPanel();
    canvasHost.append(status.el);
    activeHandle = runRecordSession({
      device, format, canvasHost, prefs, status, pickedRef,
      onDone: () => {
        activeHandle?.cancel();
        canvasHost.replaceChildren();
        landing.show();
      },
    });
    const pill = buildRecordPill({
      onFullscreen: () => void toggleFullscreen(root),
      onStop:       () => {
        if (!activeHandle) return;
        // Manual stop with save intent: set the flag, then cancel so the loop exits.
        (activeHandle as unknown as { _state?: ModeState })._state;
        // Cleaner: expose via a controls.requestStopAndSave() hook on ModeHandle.
        activeHandle.controls.requestStopAndSave?.();
        activeHandle.cancel();
      },
    });
    pillHandle = pill;
    canvasHost.append(pill.el);
  } else if (prefs.mode === 'build-up') {
    // existing build-up dispatch
  } else {
    // existing slideshow dispatch
  }
}
```

And extend the `ModeHandle.controls` interface:

```ts
interface ModeControls {
  togglePause(): void;
  isPaused(): boolean;
  skip(dir: number): void;
  requestStopAndSave?(): void;
}
```

In `runRecordSession`, add:

```ts
return {
  cancel() { state.cancelled = true; },
  controls: {
    togglePause() {},
    isPaused() { return false; },
    skip(_dir) {},
    requestStopAndSave() { state.manualStopAndSave = true; },
  },
};
```

- [ ] **Step 5: Connect landing.onPlay to startSession with the pickedRef**

In the `mountScreensaverPage` setup:

```ts
const landing = mountScreensaverLanding(landingHost, {
  device, format,
  onPlay: (prefs, pickedRef) => {
    landing.hide();
    startSession(prefs, pickedRef);
  },
});
```

(Adjust landing.show/hide if the existing handle uses `card.hidden` style toggles — they do. Reuse the same hide/show.)

- [ ] **Step 6: Wire S keyboard binding for Stop in Record mode**

The existing keyboard handler binds `S` for Stop in build-up; that already calls cancel. In Record mode, `S` should also call `requestStopAndSave` first then `cancel`. Find the existing `keydown` handler and add a branch:

```ts
case 's': case 'S': {
  if (!activeHandle) return;
  // In record mode, S means Stop & save (matches the ⏹ pill button).
  activeHandle.controls.requestStopAndSave?.();
  activeHandle.cancel();
  break;
}
```

(If the existing build-up handler already calls cancel on S, this only adds the requestStopAndSave call; build-up's no-op `requestStopAndSave` is harmless.)

- [ ] **Step 7: Typecheck + unit tests**

Run: `npm run typecheck && npm test`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/screensaver-mount.ts
git commit -m "feat(#111): runRecordSession — MediaRecorder lifecycle + simplified pill"
```

---

## Task 7: Chrome verify + acceptance

**Files:** None (live verify only).

**Inline lead** — chrome-devtools-mcp.

**Verify in Chrome at `http://localhost:5173/v1/screensaver`.**

- [ ] **Step 1: Confirm dev server is running**

If not still up from Task 5:

```bash
npm run dev
```

- [ ] **Step 2: Mode picker layout**

Open the URL. Confirm: 3 mode buttons in a row, no width jump compared to old 2-button layout, Build-up is `.on` by default.

- [ ] **Step 3: Record tab activation**

Click Record. Confirm:
- Build-up tab loses `.on`, Record tab gains `.on`.
- Picker container appears with 300×300 thumbnail canvas + label + Random button.
- Thumbnail renders within ~500ms.
- Label shows `<nick> · <gen>/<id>`.
- Ladders shown: Build-up time, Quality, Ramp (NOT Rest period).
- Start button reads "▶ Start recording".

- [ ] **Step 4: Random re-roll**

Click Random ~3 times. Confirm each click re-renders the thumbnail and updates the label.

- [ ] **Step 5: Recording — auto-stop at settle**

Set Build-up time = 30s, Quality = 100, Ramp = Medium. Click Start.

Confirm:
- Landing card hides; canvas mounts.
- Status panel top-left shows `Recording <name>\n● 0:05 / 0:30 · samples X.YM / Z.ZM · ~N.NN MB`.
- Recording pill top-right: `⛶ ⏹` only (no prev/pause/next).
- Wait ~30s for settle. At settle: status flips to "Saving recording…", a `.webm` downloads.
- Landing card returns.

- [ ] **Step 6: Open the downloaded file**

```bash
open ~/Downloads/electricsheep.*.pyr3.webm | head -1
```

(Or open via Finder.) Confirm:
- Filename matches `electricsheep.<gen>.<id>.pyr3.webm`.
- Plays in QuickTime / Chrome / VLC.
- Shows the build-up arc (black → sparse dots → settle).
- Heavy ramp visibly heavy on playback if you re-record with `Ramp = Heavy`.
- Duration ≈ 30s.
- File size < 15MB (issue acceptance).

- [ ] **Step 7: Recording — manual ⏹ saves partial**

Set Build-up time = 5m (300s). Click Start. Let it run ~1 minute. Click ⏹.

Confirm:
- A `.webm` downloads (~1 min, NOT 5 min).
- Landing card returns.

- [ ] **Step 8: Recording — Esc aborts (no download)**

Click Random (new flame). Click Start. Let it run ~10s. Press Esc.

Confirm:
- NO `.webm` downloads.
- Landing card returns.

- [ ] **Step 9: Browser-compat fallback**

(Skip on Chrome since VP9 is supported — verify via test only. Manual repro on a non-Chromium browser is optional.)

- [ ] **Step 10: Stop the dev server**

Kill the background `npm run dev` process.

- [ ] **Step 11: Acceptance checklist**

Update issue with the checklist:

```bash
gh issue comment 111 --body "$(cat <<'EOF'
## Manual verify checklist (Chrome)

- [x] 3-tab mode picker visible, no width jump
- [x] Record tab activates picker; thumbnail renders <500ms
- [x] Random re-rolls thumbnail
- [x] Ladders = Build-up time / Quality / Ramp (no Rest)
- [x] Start → canvas mounts, status panel shows `Recording <name> · ● MM:SS / MM:SS · samples · ~N MB`
- [x] Pill = ⛶ ⏹ only
- [x] Auto-stop at settle → .webm downloads as `electricsheep.<gen>.<id>.pyr3.webm`
- [x] File plays back; build-up arc visible; settle frame visible
- [x] File <15MB for 30s clip
- [x] Manual ⏹ saves partial; Esc aborts
EOF
)"
```

- [ ] **Step 12: No commit** — Task 7 is verify only; no code changed.

---

## Task 8: Code review (subagent)

**Files:** None (review-only).

**Subagent fit** — fresh-eyes adversarial pass, no implementation bias.

- [ ] **Step 1: Dispatch the review agent**

Use `superpowers:requesting-code-review` or `feature-dev:code-reviewer` with this brief:

> Review the diff on `feature/issue-111-record` vs `main`. Spec at `docs/superpowers/specs/2026-06-05-issue-111-screensaver-recording-design.md`. Watch for: (1) leaks of WebGPU renderer instances when the user leaves the Record tab without recording; (2) the recorder state machine — is `stop(true)` racy with the underlying `MediaRecorder.onstop`? Mocks make this hard to catch; (3) the picker's `pickedRef` mutability — does Start's pickedRef snapshot match what the renderer loads? (4) Mode-row layout — does the 3-col grid degrade on narrow viewports? (5) Filename ladder sanitize — any path-traversal risk via `name = '../etc/passwd'`? (6) Prefs migration — does the v3 → v4 fallback actually work end-to-end for users with stored v3 prefs? Surface only high-confidence findings; tier as 🚨 must-fix / ⚠️ should-fix / 🪶 nice-to-have.

- [ ] **Step 2: Triage findings**

Apply 🚨 must-fix as direct edits (lead pace). Apply ⚠️ should-fix unless rationale rebuts (per `superpowers:receiving-code-review`'s "agreement is not capitulation" — push back when wrong). Defer 🪶 nice-to-have to follow-up issues if material.

- [ ] **Step 3: Commit any fixes from review**

```bash
git add -p   # stage scoped fixes
git commit -m "fix(#111): apply review findings"
```

---

## Task 9: Docs + follow-up issue + FF-merge gate

**Files:**
- Modify: README.md (if Record warrants a mention in the screensaver section)
- Modify: CLAUDE.md (if a load-bearing pattern emerged — usually no)
- No HISTORY.md edit (that's frozen pre-v1.0)

- [ ] **Step 1: Audit README for screensaver mentions**

Run: `grep -n "screensaver\|build-up" README.md | head -20`

If the screensaver section mentions Slideshow + Build-up but not Record, add a one-line bullet for Record. Otherwise skip.

- [ ] **Step 2: Squash feature-branch commits before FF-merge**

Per global CLAUDE.md: squash by default when safe. Branch is not pushed yet (private), commits are tightly coupled, safe to squash:

```bash
git reset --soft main
git commit -m "feat(#111): screensaver Record mode — capture build-up to .webm

3rd tab on /v1/screensaver alongside Slideshow + Build-up. Picker shows
a live-rendered thumbnail + Random button; click Start to record one
flame's build-up as VP9 webm. Filename ladder routes ESF flames to
electricsheep.<gen>.<id>.pyr3.webm; non-ESF flames fall through #104's
template engine. Settle auto-stops; ⏹ saves partial; Esc aborts.

Tests cover the filename ladder, recorder state machine, and prefs v4
migration. Chrome-verified.

Closes #111."
```

- [ ] **Step 3: Run full test suite + typecheck + build**

```bash
npm run typecheck && npm test && npm run build
```

All green; `dist/` builds clean.

- [ ] **Step 4: File follow-up issue — reusable flame picker**

Per the new-issue-discipline (the picker UI deferred from Q3):

```bash
gh issue create --title "Reusable flame picker (gen dropdown + id input + nick search)" \
  --body "$(cat <<'EOF'
**Filed 2026-06-05 — deferred from #111.**

#111 (Record mode) shipped with picker = thumbnail + Random only. A
fuller flame picker (gen dropdown + id input + nick search + filter)
has utility across the app and deserves its own slot:

- **Record mode** (#111) — let the user pick a specific flame, not just
  Random.
- **Future Vault** (#107) — flame library browse + pin.
- **Gallery jump** — jump to a specific gen/id without scrolling.
- **Viewer pin** — pin a specific flame as the welcome / hero override.

**Suggested shape:**
- Gen dropdown lists all available gens from the corpus manifest.
- ID input accepts free text; validates against the picked gen's avail.
- Optional nick search box for substring match across loaded index.
- Same thumbnail render call as #111 reuses for preview.

**Out of scope:** Multi-select; tag filters; full search index.
EOF
)" --label feat --label size/M
```

Note the issue number returned for the comment below.

- [ ] **Step 5: Comment on #111 with verify gate handoff**

```bash
gh issue comment 111 --body "Ready for user-verify before FF-merge. Branch: feature/issue-111-record. Chrome verify checklist above is green; tests + typecheck + build all green; squashed to one commit."
```

- [ ] **Step 6: STOP — hand off to user for verify**

Per global CLAUDE.md "User-verify before FF-merge": surface the verify URL and the issue, wait for explicit go before merging.

```
http://localhost:5173/v1/screensaver
```

User confirms → continue. User asks for tweaks → loop.

- [ ] **Step 7: FF-merge after explicit approval**

```bash
git checkout main
git merge --ff-only feature/issue-111-record
git push origin main
```

- [ ] **Step 8: Verify live deploy**

Wait ~1 minute for GH-pages deploy. Open https://pyr3.app/v1/screensaver in Chrome. Confirm 3-tab picker + Record flow works in production. Console clean.

- [ ] **Step 9: Close #111**

```bash
gh issue close 111 --comment "Shipped 2026-06-05 (commit $(git rev-parse --short HEAD)). Verified live at pyr3.app."
```

- [ ] **Step 10: Post-ship branch cleanup**

Per global "Post-ship branch cleanup is standing-authorized at session-end":

```bash
git branch -D feature/issue-111-record
git push origin --delete feature/issue-111-record 2>/dev/null || true
```

(The remote-delete line is no-op if the branch was never pushed; safe.)

---

## Self-Review

**Spec coverage check:**
- Q1 (3-tab mode picker): Task 4 Step 3 ✓
- Q2 (single-shot): Task 6 `runRecordSession` exits after one flame ✓
- Q3 (thumbnail + Random picker): Task 4 Steps 4–5 (scaffolding) + Task 5 (live render) ✓
- Q4 (filename ladder, .pyr3.webm): Task 1 ✓
- Q5 (recording UX, end triggers, browser-compat fallback): Task 2 (state machine) + Task 4 Step 3 (disabled tab) + Task 6 (lifecycle) + Task 7 (Chrome verify) ✓
- Out-of-scope items in spec: not implemented, follow-up issue filed in Task 9 Step 4 ✓

**Placeholder scan:** Every step has actual code or concrete commands; no "TODO", "fill in later", or "similar to Task N" references.

**Type consistency:**
- `RecorderHandle.start/stop/elapsedMs/bytesAccumulated`: defined in Task 2, consumed in Task 6 ✓
- `deriveRecordingFilename({genome, ref, now})`: defined in Task 1, consumed in Task 6 ✓
- `ScreensaverLandingOpts.onPlay(prefs, pickedRef?)`: extended in Task 4, consumed in Task 6 ✓
- `ModeControls.requestStopAndSave?`: added in Task 6 Step 4, wired in Task 6 Steps 4 + 6 ✓
- `state.manualStopAndSave`: added in Task 6 Step 3, used in same task ✓

**Plan complete.**
