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
  CLAMPS,
  type ScreensaverPrefs,
} from './screensaver-prefs';
import { COLORS } from './ui-tokens';

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
  grid-template-columns: 1fr 1fr;
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

.pyr3-screensaver-ladder-row {
  display: grid;
  grid-template-columns: 110px 1fr 60px;
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
  const ladderRows: Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }> =
    {} as Record<LadderField, { input: HTMLInputElement; buttons: HTMLButtonElement[] }>;

  function buildLadder(field: LadderField, label: string): HTMLElement {
    const row = el('div', 'pyr3-screensaver-ladder-row');
    row.dataset.screensaverLadder = field;

    const labelEl = el('label', 'pyr3-screensaver-ladder-label');
    labelEl.textContent = label;
    row.append(labelEl);

    const presets = el('div', 'pyr3-screensaver-ladder-presets');
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
      presets.append(b);
      buttons.push(b);
    }
    row.append(presets);

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
  play.textContent = '▶ Start screensaver';
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
