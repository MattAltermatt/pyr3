// Landing settings card for /v1/screensaver: mode picker, 3 ladder controls
// (build-up time, rest period, slideshow hold), and a Play button. Pattern
// mirrors the Size/Quality/SETTLE bar+panel ladder pattern documented in
// reference-bar-panel-ladder-pattern.md (auto-memory).
//
// Visual language matches the editor's section/ladder primitives — panel
// background, flame-gradient primary CTA, ladder buttons that highlight in
// flame.top on .on.

import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  parseSecondsInput,
  parseNumericInput,
  CLAMPS,
  type ScreensaverPrefs,
} from './screensaver-prefs';
import { rampLabel } from './screensaver-pacing';
import { COLORS } from './ui-tokens';
import type { SheepRef } from './gallery-mount';
import { isRecordingSupported } from './screensaver-record';
import { loadFeatureIndex } from './feature-index-client';
import { fetchFlameXml } from './chunk-fetch';
import { parseFlame } from './flame-import';
import { createRenderer, type Renderer, DEFAULT_FILTER_RADIUS } from './renderer';

export interface ScreensaverLandingOpts {
  onPlay: (prefs: ScreensaverPrefs, pickedRef?: SheepRef) => void;
  device?: GPUDevice;
  format?: GPUTextureFormat;
  /** Test hook — defaults to import from screensaver-record. */
  isRecordingSupported?: () => boolean;
}

export interface ScreensaverLandingHandle {
  /** Caller may hide/show the card when Play is clicked. */
  card: HTMLElement;
  /** Re-render values from current prefs (used when reopening via "S" key). */
  refresh(): void;
  /** Tear down WebGPU resources held by the picker thumbnail renderer
   *  (#111). Idempotent — safe to call multiple times or when no renderer
   *  was ever instantiated. */
  destroy(): void;
}

const LADDERS = {
  buildUpSec: [30, 60, 300, 600],
  restSec:    [0,  30, 60, 120],
  holdSec:    [5,  15, 30, 60],
  buildUpQ:   [50, 100, 200, 500],
  slideshowQ: [50, 100, 200, 500],
  buildUpRamp:[1,  2,  3,  5],
  recordTimeSec: [10, 30, 60, 300],
  recordQ:       [50, 100, 200, 500],
  recordRamp:    [1,  2,  3,  5],
} as const;

type LadderField = keyof typeof LADDERS;

interface LadderMeta {
  label: string;
  hint: string;
  /** Which mode this ladder belongs to. */
  mode: 'build-up' | 'slideshow' | 'record';
  /** Format a value for a preset-button label (e.g. 60 → "1m"). */
  fmt: (n: number) => string;
  /** Parse a freeform-input string back to a number; null on junk. */
  parse: (raw: string) => number | null;
}

function fmtSec(n: number): string {
  if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

function fmtPlain(n: number): string {
  return String(n);
}

const LADDER_META: Record<LadderField, LadderMeta> = {
  buildUpSec: {
    label: 'Build-up time',
    hint:  'How long the chaos game takes to draw the flame, from black to full quality.',
    mode:  'build-up',
    fmt:   fmtSec,
    parse: parseSecondsInput,
  },
  restSec: {
    label: 'Rest period',
    hint:  'After the flame finishes building, how long it stays on screen at full quality before fading to the next one.',
    mode:  'build-up',
    fmt:   fmtSec,
    parse: parseSecondsInput,
  },
  holdSec: {
    label: 'Slideshow hold',
    hint:  'How long each fully-rendered flame stays on screen before crossfading to the next.',
    mode:  'slideshow',
    fmt:   fmtSec,
    parse: parseSecondsInput,
  },
  buildUpQ: {
    label: 'Quality',
    hint:  'Samples per pixel to reach before settling. Higher = denser, smoother flame. 10–500.',
    mode:  'build-up',
    fmt:   fmtPlain,
    parse: parseNumericInput,
  },
  slideshowQ: {
    label: 'Quality',
    hint:  'Samples per pixel each flame renders to. Higher = denser, smoother flame. 10–500.',
    mode:  'slideshow',
    fmt:   fmtPlain,
    parse: parseNumericInput,
  },
  buildUpRamp: {
    label: 'Ramp',
    hint:  'Shape of how samples land over time. Linear lights bright cells early then polishes the tail; heavier curves keep building through the last third.',
    mode:  'build-up',
    fmt:   rampLabel,
    parse: parseNumericInput,
  },
  recordTimeSec: {
    label: 'Build-up time',
    hint:  'How long the recorded clip is — the chaos game draws over this duration.',
    mode:  'record',
    fmt:   fmtSec,
    parse: parseSecondsInput,
  },
  recordQ: {
    label: 'Quality',
    hint:  'Samples per pixel to reach by settle. Higher = denser, smoother flame. 10–500.',
    mode:  'record',
    fmt:   fmtPlain,
    parse: parseNumericInput,
  },
  recordRamp: {
    label: 'Ramp',
    hint:  'Shape of how samples land over time during the recorded clip.',
    mode:  'record',
    fmt:   rampLabel,
    parse: parseNumericInput,
  },
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.pyr3-screensaver-card {
  min-width: 420px;
  padding: 24px;
  background: ${COLORS.bg.panel};
  border: 1px solid ${COLORS.border};
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", sans-serif;
  color: ${COLORS.text.primary};
}
.pyr3-screensaver-card.hidden { display: none; }
.pyr3-screensaver-card-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${COLORS.text.muted};
  font-weight: 600;
  margin-bottom: 4px;
}

.pyr3-screensaver-mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}
.pyr3-screensaver-mode-btn {
  padding: 10px 14px;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 6px;
  color: ${COLORS.text.muted};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.pyr3-screensaver-mode-btn:hover {
  color: ${COLORS.text.primary};
  border-color: ${COLORS.flame.mid};
}
.pyr3-screensaver-mode-btn.on {
  background: ${COLORS.flame.mid};
  border-color: ${COLORS.flame.top};
  color: #1a0d04;
  font-weight: 700;
}
.pyr3-screensaver-mode-btn[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.pyr3-screensaver-mode-btn[disabled]:hover {
  color: ${COLORS.text.muted};
  border-color: ${COLORS.border};
}

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

.pyr3-screensaver-ladder-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pyr3-screensaver-ladder-block.hidden { display: none; }
.pyr3-screensaver-ladder-row {
  display: grid;
  grid-template-columns: 130px 1fr 60px;
  align-items: center;
  gap: 10px;
}
.pyr3-screensaver-ladder-label {
  font-size: 12px;
  color: ${COLORS.text.muted};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
}
.pyr3-screensaver-ladder-hint {
  font-size: 11px;
  color: ${COLORS.text.dim};
  padding-left: 140px;
  line-height: 1.4;
}
.pyr3-screensaver-ladder-row > .pyr3-screensaver-ladder-presets {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
}
.pyr3-screensaver-ladder-btn {
  padding: 6px 0;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 4px;
  color: ${COLORS.text.muted};
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.pyr3-screensaver-ladder-btn:hover {
  color: ${COLORS.text.primary};
  border-color: ${COLORS.flame.mid};
}
.pyr3-screensaver-ladder-btn.on {
  background: ${COLORS.flame.mid};
  border-color: ${COLORS.flame.top};
  color: #1a0d04;
  font-weight: 700;
}
.pyr3-screensaver-ladder-input {
  width: 100%;
  padding: 6px 8px;
  background: ${COLORS.bg.input};
  border: 1px solid ${COLORS.border};
  border-radius: 4px;
  color: ${COLORS.text.primary};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-align: center;
  box-sizing: border-box;
}
.pyr3-screensaver-ladder-input:focus {
  outline: none;
  border-color: ${COLORS.flame.top};
}

.pyr3-screensaver-play {
  margin-top: 8px;
  padding: 14px 28px;
  background: linear-gradient(180deg, ${COLORS.flame.top}, ${COLORS.flame.mid} 60%, ${COLORS.flame.bot});
  border: 1px solid ${COLORS.flame.mid};
  border-radius: 8px;
  color: #1a0d04;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-transform: uppercase;
  box-shadow: 0 4px 12px rgba(232, 124, 26, 0.3);
  transition: transform 0.08s, box-shadow 0.12s;
}
.pyr3-screensaver-play:hover {
  box-shadow: 0 6px 18px rgba(232, 124, 26, 0.45);
}
.pyr3-screensaver-play:active {
  transform: translateY(1px);
}
.pyr3-screensaver-play[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(0.4);
}
`;
  document.head.append(style);
}

export function mountScreensaverLanding(
  host: HTMLElement,
  opts: ScreensaverLandingOpts,
): ScreensaverLandingHandle {
  injectStyles();
  const card = el('div', 'pyr3-screensaver-card');
  let prefs = readScreensaverPrefs();

  const title = el('div', 'pyr3-screensaver-card-title');
  title.textContent = 'Screensaver';
  card.append(title);

  // Mode picker
  const modeRow = el('div', 'pyr3-screensaver-mode-row');
  const slideshowBtn = el('button', 'pyr3-screensaver-mode-btn');
  slideshowBtn.dataset.screensaverMode = 'slideshow';
  slideshowBtn.textContent = 'Slideshow';
  const buildUpBtn = el('button', 'pyr3-screensaver-mode-btn');
  buildUpBtn.dataset.screensaverMode = 'build-up';
  buildUpBtn.textContent = 'Build-up';
  const recordBtn = el('button', 'pyr3-screensaver-mode-btn');
  recordBtn.dataset.screensaverMode = 'record';
  recordBtn.textContent = 'Record';

  const checkSupport = opts.isRecordingSupported ?? isRecordingSupported;
  const recordingOk = checkSupport();
  if (!recordingOk) {
    recordBtn.disabled = true;
    recordBtn.title = 'Recording requires a Chromium-based browser';
    // If prefs were stored as 'record' but recording isn't available, fall
    // back to build-up so the user can still use the page.
    if (prefs.mode === 'record') prefs = { ...prefs, mode: 'build-up' };
  }

  modeRow.append(slideshowBtn, buildUpBtn, recordBtn);

  // Picked-flame state for Record mode. Set by the picker (Task 5); read at
  // Start time and handed to onPlay. Stays null in slideshow/build-up modes.
  let pickedRef: SheepRef | undefined = undefined;

  function refreshModeButtons(): void {
    slideshowBtn.classList.toggle('on', prefs.mode === 'slideshow');
    buildUpBtn.classList.toggle('on', prefs.mode === 'build-up');
    recordBtn.classList.toggle('on', prefs.mode === 'record');
    // Hide ladder blocks that don't belong to the current mode.
    for (const field of Object.keys(LADDER_META) as LadderField[]) {
      const block = ladderBlocks[field];
      if (!block) continue;
      block.classList.toggle('hidden', LADDER_META[field].mode !== prefs.mode);
    }
    // Picker container: visible only in record mode.
    pickerContainer.classList.toggle('hidden', prefs.mode !== 'record');
    refreshPlayability();
  }
  slideshowBtn.addEventListener('click', () => {
    prefs = { ...prefs, mode: 'slideshow' };
    refreshModeButtons();
  });
  buildUpBtn.addEventListener('click', () => {
    prefs = { ...prefs, mode: 'build-up' };
    refreshModeButtons();
  });
  recordBtn.addEventListener('click', () => {
    if (recordBtn.disabled) return;
    prefs = { ...prefs, mode: 'record' };
    refreshModeButtons();
    // Auto-pick a flame on first activation so the user sees a thumbnail
    // immediately instead of an empty canvas.
    if (!pickedRef && opts.device && opts.format) {
      void pickAndRenderRandom();
    }
  });

  // Ladder rows
  const ladderRows: Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }> =
    {} as Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }>;
  const ladderBlocks: Partial<Record<LadderField, HTMLElement>> = {};

  function buildLadder(field: LadderField): HTMLElement {
    const meta = LADDER_META[field];
    const block = el('div', 'pyr3-screensaver-ladder-block');
    block.dataset.screensaverLadderBlock = field;

    const row = el('div', 'pyr3-screensaver-ladder-row');
    row.dataset.screensaverLadder = field;

    const labelEl = el('label', 'pyr3-screensaver-ladder-label');
    labelEl.textContent = meta.label;
    row.append(labelEl);

    const presets = el('div', 'pyr3-screensaver-ladder-presets');
    const buttons: HTMLButtonElement[] = [];
    for (const v of LADDERS[field]) {
      const b = el('button', 'pyr3-screensaver-ladder-btn');
      b.dataset.value = String(v);
      b.textContent = meta.fmt(v);
      b.addEventListener('click', () => {
        prefs = { ...prefs, [field]: v };
        input.value = String(v);
        refreshLadder(field);
      });
      presets.append(b);
      buttons.push(b);
    }
    row.append(presets);

    const input = el('input', 'pyr3-screensaver-ladder-input');
    input.type = 'text';
    input.value = String(prefs[field]);
    input.addEventListener('change', () => {
      const parsed = meta.parse(input.value);
      if (parsed === null) {
        input.value = String(prefs[field]);
        return;
      }
      const { min, max } = CLAMPS[field];
      const clamped = Math.max(min, Math.min(max, parsed));
      prefs = { ...prefs, [field]: clamped };
      input.value = String(clamped);
      refreshLadder(field);
    });
    row.append(input);

    const hint = el('div', 'pyr3-screensaver-ladder-hint');
    hint.textContent = meta.hint;

    block.append(row, hint);

    ladderRows[field] = { input, buttons };
    ladderBlocks[field] = block;
    return block;
  }

  function refreshLadder(field: LadderField): void {
    const { input, buttons } = ladderRows[field];
    input.value = String(prefs[field]);
    for (const b of buttons) {
      b.classList.toggle('on', Number(b.dataset.value) === prefs[field]);
    }
  }

  // Picker container — visible only in Record mode. Live thumbnail rendering
  // is wired by Task 5 (#111); for now the canvas + label + Random button
  // mount as scaffolding so the mode-switch UX works.
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

  card.append(modeRow);
  card.append(buildLadder('buildUpSec'));
  card.append(buildLadder('restSec'));
  card.append(buildLadder('buildUpQ'));
  card.append(buildLadder('buildUpRamp'));
  card.append(buildLadder('holdSec'));
  card.append(buildLadder('slideshowQ'));
  card.append(buildLadder('recordTimeSec'));
  card.append(buildLadder('recordQ'));
  card.append(buildLadder('recordRamp'));
  card.append(pickerContainer);

  // Picker — live thumbnail renderer. Lazily initialised on first
  // pickAndRenderRandom call so the WebGPU canvas context stays unallocated
  // until the user actually enters Record mode. Re-rolls on Random click.
  const THUMB_DIM = 300;
  const THUMB_Q   = 50;
  const THUMB_OVS = 1;
  const THUMB_WALKERS = 4096;

  let thumbRenderer: Renderer | null = null;
  let thumbCtx: GPUCanvasContext | null = null;

  async function ensureThumbRenderer(): Promise<Renderer | null> {
    if (!opts.device || !opts.format) return null;
    if (thumbRenderer) return thumbRenderer;
    const ctx = thumbCanvas.getContext('webgpu');
    if (!ctx) return null;
    ctx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });
    thumbCtx = ctx;
    thumbRenderer = createRenderer(opts.device, opts.format, {
      width: THUMB_DIM,
      height: THUMB_DIM,
      oversample: THUMB_OVS,
      filterRadius: DEFAULT_FILTER_RADIUS,
    });
    return thumbRenderer;
  }

  async function pickAndRenderRandom(): Promise<void> {
    if (!opts.device || !opts.format) {
      thumbLabel.textContent = '(WebGPU unavailable)';
      return;
    }
    thumbLabel.textContent = 'Loading…';
    const renderer = await ensureThumbRenderer();
    if (!renderer || !thumbCtx) {
      thumbLabel.textContent = '(thumbnail unavailable)';
      return;
    }
    const index = await loadFeatureIndex();
    if (index.recordCount === 0) {
      thumbLabel.textContent = '(corpus unavailable)';
      return;
    }
    const allRefs = index.filter(() => true);
    if (allRefs.length === 0) {
      thumbLabel.textContent = '(corpus empty)';
      return;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = allRefs[Math.floor(Math.random() * allRefs.length)]!;
      try {
        const xml = await fetchFlameXml(ref.gen, ref.id);
        const { genome } = parseFlame(xml);
        const targetSamples = THUMB_Q * THUMB_DIM * THUMB_DIM;
        const iters = Math.max(64, Math.ceil(targetSamples / THUMB_WALKERS));
        renderer.reset(genome);
        renderer.iterate({
          genome,
          seed:           (Math.random() * 0xffffffff) >>> 0,
          walkers:        THUMB_WALKERS,
          itersPerWalker: iters,
        });
        renderer.present({
          genome,
          outputView:   thumbCtx.getCurrentTexture().createView(),
          totalSamples: THUMB_WALKERS * iters,
          forceDeOff:   false,
        });
        pickedRef = ref;
        thumbLabel.textContent = `${genome.nick || '(unnamed)'} · ${ref.gen}/${ref.id}`;
        refreshPlayability();
        return;
      } catch {
        // Try a different flame.
      }
    }
    thumbLabel.textContent = "(couldn't load — try again)";
  }

  randomBtn.addEventListener('click', () => { void pickAndRenderRandom(); });

  // Play button
  const play = el('button', 'pyr3-screensaver-play');
  play.dataset.screensaverPlay = '';
  play.textContent = '▶ Start screensaver';
  play.addEventListener('click', () => {
    if (play.disabled) return;
    writeScreensaverPrefs(prefs);
    opts.onPlay(prefs, pickedRef);
  });
  card.append(play);

  // Disable / re-label the Play button when Record mode is selected but no
  // flame has been picked yet. Task 5 will fire pickedRef-update via the
  // picker's Random + auto-pick paths.
  function refreshPlayability(): void {
    if (prefs.mode === 'record') {
      play.disabled = !pickedRef;
      play.textContent = pickedRef ? '▶ Start recording' : '(pick a flame)';
    } else {
      play.disabled = false;
      play.textContent = '▶ Start screensaver';
    }
  }

  host.append(card);

  refreshModeButtons();
  (Object.keys(LADDERS) as LadderField[]).forEach(refreshLadder);

  return {
    card,
    refresh() {
      prefs = readScreensaverPrefs();
      refreshModeButtons();
      (Object.keys(LADDERS) as LadderField[]).forEach(refreshLadder);
    },
    destroy() {
      if (thumbRenderer) {
        thumbRenderer.destroy();
        thumbRenderer = null;
        thumbCtx = null;
      }
    },
  };
}
