// Landing settings card for /v1/screensaver: mode picker, 3 ladder controls
// (build-up time, rest period, slideshow hold), and a Play button. Pattern
// mirrors the Size/Quality/SETTLE bar+panel ladder pattern documented in
// reference-bar-panel-ladder-pattern.md (auto-memory).

import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  parseSecondsInput,
  CLAMPS,
  type ScreensaverPrefs,
} from './screensaver-prefs';

export interface ScreensaverLandingOpts {
  onPlay: (prefs: ScreensaverPrefs) => void;
}

export interface ScreensaverLandingHandle {
  /** Caller may hide/show the card when Play is clicked. */
  card: HTMLElement;
  /** Re-render values from current prefs (used when reopening via "S" key). */
  refresh(): void;
}

const LADDERS = {
  buildUpSec: [30, 60, 300, 600],
  restSec:    [10, 30, 60, 120],
  holdSec:    [5,  15, 30, 60],
} as const;

type LadderField = keyof typeof LADDERS;

function fmtSec(n: number): string {
  if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function mountScreensaverLanding(
  host: HTMLElement,
  opts: ScreensaverLandingOpts,
): ScreensaverLandingHandle {
  const card = el('div', 'pyr3-screensaver-card');
  let prefs = readScreensaverPrefs();

  // Mode picker
  const modeRow = el('div', 'pyr3-screensaver-mode-row');
  const slideshowBtn = el('button', 'pyr3-screensaver-mode-btn');
  slideshowBtn.dataset.screensaverMode = 'slideshow';
  slideshowBtn.textContent = 'Slideshow';
  const buildUpBtn = el('button', 'pyr3-screensaver-mode-btn');
  buildUpBtn.dataset.screensaverMode = 'build-up';
  buildUpBtn.textContent = 'Build-up';
  modeRow.append(slideshowBtn, buildUpBtn);

  function refreshModeButtons(): void {
    slideshowBtn.classList.toggle('on', prefs.mode === 'slideshow');
    buildUpBtn.classList.toggle('on', prefs.mode === 'build-up');
  }
  slideshowBtn.addEventListener('click', () => {
    prefs = { ...prefs, mode: 'slideshow' };
    refreshModeButtons();
  });
  buildUpBtn.addEventListener('click', () => {
    prefs = { ...prefs, mode: 'build-up' };
    refreshModeButtons();
  });

  // Ladder rows
  const ladderRows: Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }> = {} as Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }>;

  function buildLadder(field: LadderField, label: string): HTMLElement {
    const row = el('div', 'pyr3-screensaver-ladder-row');
    row.dataset.screensaverLadder = field;
    const labelEl = el('label', 'pyr3-screensaver-ladder-label');
    labelEl.textContent = label;
    row.append(labelEl);

    const buttons: HTMLButtonElement[] = [];
    for (const v of LADDERS[field]) {
      const b = el('button', 'pyr3-screensaver-ladder-btn');
      b.dataset.value = String(v);
      b.textContent = fmtSec(v);
      b.addEventListener('click', () => {
        prefs = { ...prefs, [field]: v };
        input.value = String(v);
        refreshLadder(field);
      });
      row.append(b);
      buttons.push(b);
    }

    const input = el('input', 'pyr3-screensaver-ladder-input');
    input.type = 'text';
    input.value = String(prefs[field]);
    input.addEventListener('change', () => {
      const parsed = parseSecondsInput(input.value);
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

    ladderRows[field] = { input, buttons };
    return row;
  }

  function refreshLadder(field: LadderField): void {
    const { input, buttons } = ladderRows[field];
    input.value = String(prefs[field]);
    for (const b of buttons) {
      b.classList.toggle('on', Number(b.dataset.value) === prefs[field]);
    }
  }

  card.append(modeRow);
  card.append(buildLadder('buildUpSec', 'Build-up time'));
  card.append(buildLadder('restSec',    'Rest period'));
  card.append(buildLadder('holdSec',    'Slideshow hold'));

  // Play button
  const play = el('button', 'pyr3-screensaver-play');
  play.dataset.screensaverPlay = '';
  play.textContent = '▶ Play';
  play.addEventListener('click', () => {
    writeScreensaverPrefs(prefs);
    opts.onPlay(prefs);
  });
  card.append(play);

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
  };
}
