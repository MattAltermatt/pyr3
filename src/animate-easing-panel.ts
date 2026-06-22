// Minimal per-segment easing UI for /animate (#224). PURE DOM builder,
// no innerHTML (per src/no-innerhtml.test.ts) — SVG built with createElementNS.
// One row per keyframe gap: a preset <select> + a curve-shape thumbnail.
// The rich timeline curve-editor (draggable handles, per-channel) is #227.

import { type Animation } from './animation';
import { type EasingCurve, type EasingPreset, evalEasing } from './easing';

const PRESETS: EasingPreset[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];
const PRESET_LABEL: Record<EasingPreset, string> = {
  linear: 'Linear', easeIn: 'Ease in', easeOut: 'Ease out',
  easeInOut: 'Ease in-out', hold: 'Hold',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const THUMB_W = 60;
const THUMB_H = 40;

export interface EasingPanelOpts {
  animation: Animation;
  /** Called when a row's preset changes. Index i = keyframes[i]→[i+1]. */
  onChange: (segmentIndex: number, curve: EasingCurve) => void;
}

/** SVG path `d` sampling evalEasing across [0,1]; y inverted (0 at bottom). */
function thumbPathD(curve: EasingCurve): string {
  const N = 24;
  let d = '';
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = evalEasing(curve, t);
    const px = t * THUMB_W;
    const py = THUMB_H - y * THUMB_H;
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)} `;
  }
  return d.trim();
}

export function buildEasingPanel(opts: EasingPanelOpts): HTMLElement {
  const { animation, onChange } = opts;
  const root = document.createElement('div');
  root.className = 'pyr3-easing-panel';
  Object.assign(root.style, { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' });

  const header = document.createElement('div');
  header.textContent = 'Easing';
  Object.assign(header.style, { opacity: '0.7', fontWeight: '600' });
  root.appendChild(header);

  const segmentCount = Math.max(0, animation.keyframes.length - 1);
  for (let i = 0; i < segmentCount; i++) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

    const label = document.createElement('span');
    label.textContent = `KF${i + 1} → KF${i + 2}`;
    Object.assign(label.style, { minWidth: '84px', opacity: '0.8' });

    const select = document.createElement('select');
    for (const p of PRESETS) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = PRESET_LABEL[p];
      select.appendChild(opt);
    }
    const current = animation.segmentEasing?.[i];
    select.value = current && current.kind === 'preset' ? current.name : 'linear';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(THUMB_W));
    svg.setAttribute('height', String(THUMB_H));
    Object.assign(svg.style, { border: '1px solid rgba(255,255,255,0.15)', borderRadius: '3px', color: '#7ad' });
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('d', thumbPathD(current ?? { kind: 'preset', name: 'linear' }));
    svg.appendChild(path);

    select.addEventListener('change', () => {
      const curve: EasingCurve = { kind: 'preset', name: select.value as EasingPreset };
      path.setAttribute('d', thumbPathD(curve));
      onChange(i, curve);
    });

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(svg);
    root.appendChild(row);
  }
  return root;
}
