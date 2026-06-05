// Mount the /v1/screensaver page body. Wires the landing card, the canvas
// host (Phase 3 populates with the real WebGPU canvas + mode loops), and the
// permanent bottom controls strip.
//
// Structural analogue of edit-mount.ts: this module owns the page-level state
// machine. The bar lives in #pyr3-bar and is mounted by main.ts via
// mountScreensaverBar — this module renders only the body content into the
// container it's handed.
//
// Engine modules (chaos / density / visualize_*) untouched. See:
// docs/superpowers/specs/2026-06-05-screensaver-design.md.

import { mountScreensaverLanding } from './screensaver-ui';
import type { ScreensaverPrefs } from './screensaver-prefs';

export interface MountScreensaverOpts {
  /** Container the page renders into. Cleared on mount. */
  root: HTMLElement;
}

export interface ScreensaverPageHandle {
  /** Returns to the landing state (hides pill + canvas, re-shows card). */
  stop(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function buildControlsStrip(): HTMLElement {
  const strip = el('div', 'pyr3-screensaver-strip');
  strip.textContent =
    'Space pause · ← → skip · F fullscreen · Esc exit FS · S settings';
  Object.assign(strip.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '0',
    padding: '6px 18px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    opacity: '0.6',
    pointerEvents: 'none',
    textAlign: 'center',
  });
  return strip;
}

function buildNowPlayingPill(opts: { onStop: () => void }): HTMLElement {
  const pill = el('div', 'pyr3-screensaver-pill');
  Object.assign(pill.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    padding: '6px 10px',
    display: 'flex',
    gap: '8px',
  });
  const stop = el('button', 'pyr3-screensaver-pill-stop');
  stop.textContent = '⏸';
  stop.addEventListener('click', opts.onStop);
  pill.append(stop);
  return pill;
}

export function mountScreensaverPage(
  opts: MountScreensaverOpts,
): ScreensaverPageHandle {
  const { root } = opts;
  root.replaceChildren();

  // Phase 3 wires the WebGPU canvas into this host. Skeleton leaves it empty.
  const canvasHost = el('div', 'pyr3-screensaver-canvas-host');
  Object.assign(canvasHost.style, {
    position: 'absolute',
    inset: '0',
  });
  root.append(canvasHost);

  const landing = mountScreensaverLanding(root, {
    onPlay: (prefs: ScreensaverPrefs) => {
      landing.card.classList.add('hidden');
      const pill = buildNowPlayingPill({ onStop: stopPlayback });
      root.append(pill);
      // Phase 3 — Tasks 7/8/9 attach the real render loop + queue + keyboard
      // here. Skeleton accepts the prefs and parks.
      void prefs;
    },
  });

  // Center the landing card and give it a backdrop class hook so CSS in later
  // phases can style it (`.hidden` toggles display).
  Object.assign(landing.card.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  });
  injectHiddenRuleOnce();

  function stopPlayback(): void {
    root.querySelector('.pyr3-screensaver-pill')?.remove();
    landing.card.classList.remove('hidden');
    landing.refresh();
  }

  const strip = buildControlsStrip();
  root.append(strip);

  return { stop: stopPlayback };
}

let hiddenRuleInjected = false;
function injectHiddenRuleOnce(): void {
  if (hiddenRuleInjected) return;
  hiddenRuleInjected = true;
  const style = document.createElement('style');
  style.textContent = '.pyr3-screensaver-card.hidden { display: none; }';
  document.head.append(style);
}
