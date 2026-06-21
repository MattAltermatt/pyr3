// Landing card for /screensaver (#355): a two-tile mode chooser
// (🖼️ Slideshow · 🎞️ Animation). Selecting a tile reveals that mode's
// settings (the shared affordance-vocab widgets), then Play hands prefs (and,
// for animation, the loaded timeline) back to the page host. Pre-play chrome
// adopts the editor's visual language — this is the #356 conformance.
import {
  readScreensaverPrefs,
  writeScreensaverPrefs,
  type ScreensaverPrefs,
  type ScreensaverMode,
} from './screensaver-prefs';
import { buildSlideshowSettings, buildAnimationSettings } from './screensaver-settings';
import { timelineFromText } from './screensaver-animation';
import type { Timeline } from './timeline';
import { COLORS } from './ui-tokens';

export interface ScreensaverLandingOpts {
  /** Play clicked — prefs are persisted first; `timeline` (+ its source
   *  filename) is set only for a successfully-loaded animation. */
  onPlay: (prefs: ScreensaverPrefs, timeline?: Timeline, timelineName?: string) => void;
}

export interface ScreensaverLandingHandle {
  card: HTMLElement;
  /** Re-render from current prefs (used when reopening via the ✕/Esc return). */
  refresh(): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

interface TileSpec {
  mode: ScreensaverMode;
  icon: string;
  title: string;
  blurb: string;
}

const TILES: TileSpec[] = [
  { mode: 'slideshow', icon: '🖼️', title: 'Slideshow', blurb: 'endless interesting flames from the corpus' },
  { mode: 'animation', icon: '🎞️', title: 'Animation', blurb: 'load a timeline, slowly morph it' },
];

export function mountScreensaverLanding(
  host: HTMLElement,
  opts: ScreensaverLandingOpts,
): ScreensaverLandingHandle {
  const prefs: ScreensaverPrefs = readScreensaverPrefs();

  // Animation timeline state (session-only — the file isn't persisted).
  let loadedTimeline: Timeline | null = null;
  let loadedName = 'Choose file…';

  const card = el('div', 'pyr3-screensaver-card');
  Object.assign(card.style, {
    width: 'min(560px, 92vw)',
    background: COLORS.bg.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 16px 50px rgba(0,0,0,0.55)',
  });

  const title = el('div');
  title.textContent = 'Screensaver';
  Object.assign(title.style, {
    fontSize: '22px', fontWeight: '600', padding: '20px 20px 4px', color: COLORS.text.primary,
  });
  const tagline = el('div');
  tagline.textContent = 'Pick a mode. Then sit back.';
  Object.assign(tagline.style, { color: COLORS.text.muted, fontSize: '13px', padding: '0 20px 16px' });
  card.append(title, tagline);

  // Two tiles.
  const tilesRow = el('div');
  Object.assign(tilesRow.style, { display: 'flex', gap: '14px', padding: '0 20px 16px' });
  const tileEls = new Map<ScreensaverMode, HTMLButtonElement>();

  // Hidden file input for the animation timeline picker.
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.flam3,.json,.xml';
  fileInput.style.display = 'none';
  card.append(fileInput);

  const errLine = el('div');
  Object.assign(errLine.style, { color: COLORS.danger, fontSize: '12px', padding: '0 16px', minHeight: '0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' });

  // Settings host (swapped per selected mode).
  const settingsHost = el('div');

  let chipLabelSetter: ((s: string) => void) | null = null;

  function pickFile(): void {
    errLine.textContent = '';
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const tl = timelineFromText(text);
      if (!tl) {
        errLine.textContent = 'Couldn’t read a timeline from that file (need a /animate timeline JSON or a multi-keyframe .flam3).';
        loadedTimeline = null;
        loadedName = 'Choose file…';
      } else {
        loadedTimeline = tl;
        loadedName = file.name;
      }
      chipLabelSetter?.(loadedName);
    });
  });

  function renderSettings(mode: ScreensaverMode): void {
    settingsHost.replaceChildren();
    chipLabelSetter = null;
    if (mode === 'slideshow') {
      settingsHost.append(buildSlideshowSettings(prefs.slideshow, (p) => { prefs.slideshow = p; }));
    } else {
      const body = buildAnimationSettings(
        prefs.animation,
        (p) => { prefs.animation = p; },
        pickFile,
        () => loadedName,
      );
      // Capture the file-chip label setter exposed by buildAnimationSettings.
      const chip = body.querySelector('.pyr3-screensaver-filechip') as (HTMLElement & { _setLabel?: (s: string) => void }) | null;
      chipLabelSetter = chip?._setLabel ?? null;
      settingsHost.append(body);
    }
  }

  function selectMode(mode: ScreensaverMode): void {
    prefs.mode = mode;
    for (const [m, tile] of tileEls) {
      const on = m === mode;
      tile.style.borderColor = on ? COLORS.flame.mid : COLORS.border;
      tile.style.boxShadow = on ? `0 0 0 1px ${COLORS.flame.mid}` : 'none';
    }
    errLine.textContent = '';
    renderSettings(mode);
  }

  for (const spec of TILES) {
    const tile = el('button');
    tile.type = 'button';
    Object.assign(tile.style, {
      flex: '1', border: `1px solid ${COLORS.border}`, borderRadius: '12px',
      background: COLORS.bg.input, padding: '16px', cursor: 'pointer', textAlign: 'left',
    });
    const icon = el('div');
    icon.textContent = spec.icon;
    icon.style.fontSize = '22px';
    const h = el('div');
    h.textContent = spec.title;
    Object.assign(h.style, { fontSize: '16px', color: COLORS.text.primary, margin: '6px 0 2px' });
    const blurb = el('div');
    blurb.textContent = spec.blurb;
    Object.assign(blurb.style, { fontSize: '12px', color: COLORS.text.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' });
    tile.append(icon, h, blurb);
    tile.addEventListener('click', () => selectMode(spec.mode));
    tileEls.set(spec.mode, tile);
    tilesRow.append(tile);
  }
  card.append(tilesRow, settingsHost, errLine);

  // Play.
  const foot = el('div');
  Object.assign(foot.style, { display: 'flex', justifyContent: 'center', padding: '16px' });
  const play = el('button');
  play.type = 'button';
  play.dataset.screensaverPlay = '';
  play.textContent = '▶ Play';
  Object.assign(play.style, {
    background: `linear-gradient(135deg, ${COLORS.flame.top}, ${COLORS.flame.mid} 55%, ${COLORS.flame.bot})`,
    color: '#1a0d03', border: 'none', borderRadius: '8px', padding: '10px 30px',
    fontSize: '14px', fontWeight: '700', cursor: 'pointer',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  });
  play.addEventListener('click', () => {
    if (prefs.mode === 'animation' && !loadedTimeline) {
      errLine.textContent = 'Load a timeline file first.';
      return;
    }
    writeScreensaverPrefs(prefs);
    if (prefs.mode === 'animation') {
      opts.onPlay(prefs, loadedTimeline ?? undefined, loadedName);
    } else {
      opts.onPlay(prefs);
    }
  });
  foot.append(play);
  card.append(foot);

  host.append(card);
  selectMode(prefs.mode);

  return {
    card,
    refresh() { selectMode(prefs.mode); },
    destroy() { /* no GPU resources held (the record-mode picker was removed) */ },
  };
}
