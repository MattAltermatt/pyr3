// pyr3 — shared help-text registry + info-icon helper (#343/#348).
//
// Single source of truth for every visible `?` info-icon's copy. Both the
// viewer bar (ui-bar.ts / render-mode-bar.ts) and the editor sections look
// up their help here, so the preview-vs-render concept and every per-field
// explainer live in exactly one place — auditable for coverage + tone and
// guarded by src/help-text.test.ts.
//
// Interaction is click-to-toggle (reuses buildInfoIcon's anchored popover);
// the underlying control keeps its native `.title` hover as a free bonus.

import { type InfoIconOpts, buildInfoIcon, buildSectionHelpIcon } from './edit-tooltip';

export type HelpKey = string;

// The registry. Keys are dotted `<surface/section>.<field>`. Copy migrated
// from the controls' existing `.title` / inline-tooltip strings (verbatim,
// lightly tone-tightened); new copy added only where a control isn't
// self-evident.
export const HELP: Record<HelpKey, InfoIconOpts> = {
  // ── shared concepts ──────────────────────────────────────────────────
  'concept.preview-vs-render': {
    title: 'Preview vs Render',
    body:
      'The live canvas is a fast, low-quality preview you interact with. '
      + 'Save Render produces the full-quality image you download.',
  },

  // ── XForm-lens ───────────────────────────────────────────────────────
  'xform.xaos': {
    title: 'Xaos (transition weights)',
    body:
      'After this xform fires, each row sets how likely each XForm is picked '
      + 'as the NEXT one. Pick a word — never / less / normal / more — or set '
      + 'the exact weight beside it. Without xaos the next xform depends only '
      + 'on each xform’s weight; xaos makes it depend on which xform fired last.',
    hint: 'never = 0 (can never directly follow this xform) · normal = 1 '
      + '(neutral, the default) · more > 1 (favored). Lets you shape the flow '
      + '/ sequencing of the fractal, beyond what weights alone can do.',
  },

  'xform.affine': {
    title: 'Affine (O / X / Y)',
    body:
      'The transform shown on the canvas as a triangle. Drag O to move it '
      + '(position x/y). The X and Y arms are the transform’s two axes — drag a '
      + 'tip to scale along that axis; hold Shift to free-move a tip and add '
      + 'shear. The green ⟳ ring rotates the whole thing about O.',
    hint: 'The fields are an X-anchored breakdown: editing the X axis also shifts '
      + 'scale y and rotation (they’re measured relative to X), while editing Y '
      + 'only touches scale y / shear. Rotation always pivots about O, so '
      + 'position x/y stays put.',
  },

  // ── render controls (viewer bar + editor RENDER section) ─────────────
  'render.quality': {
    title: 'Quality (samples per pixel)',
    body:
      'How many chaos-game samples land in each pixel. '
      + 'Higher = smoother and less grainy, but slower to render.',
    hint: 'Leave low for interactive work; raise it for the final Save Render.',
  },
  'preview.tier': {
    title: 'Preview tier',
    body:
      'Speed-vs-clarity preset for the live preview. Fast favors a quick, '
      + 'rougher frame while you edit; Sharp spends more to look closer to the '
      + 'final render; Balanced sits between.',
    hint: 'Only affects the on-screen preview, never the Save Render output.',
  },
  'preview.quality': {
    title: 'Preview quality (spp)',
    body:
      'Samples per pixel for the live preview — higher is smoother but takes '
      + 'longer to settle after each edit.',
    hint: 'This is the preview only; the RENDER side sets the export quality.',
  },
  'render.size': {
    title: 'Canvas size',
    body:
      'Output resolution of the render. Larger needs proportionally more '
      + 'samples to stay smooth, so it renders slower.',
  },
  'render.settle': {
    title: 'Settle delay',
    body:
      'Quiet time (ms) after your last edit before the full-quality render '
      + 'fires. Higher keeps the fast live preview visible longer; lower '
      + 'brings the settled high-quality render sooner.',
  },
  'render.format': {
    title: 'Output format',
    body:
      '8/16-bit PNG is the display image — what you see on screen. '
      + 'EXR stores linear-HDR scene values you can regrade in post.',
  },
  'render.transparent': {
    title: 'Transparent background',
    body: 'Export with a transparent background. PNG only — no effect on EXR.',
  },
  'render.oversample': {
    title: 'Oversample',
    body:
      'Render at a larger size internally, then shrink to the final size. '
      + 'Higher = smoother edges, but slower and uses more memory. 1× = exact '
      + 'size; 2× / 4× = render that much wider + taller internally.',
  },
  'render.filterRadius': {
    title: 'Filter radius',
    body:
      'How much to soften the flame. Bigger = softer, more glowy; smaller = '
      + 'sharper, crisper lines.',
    hint: '0.5 is a balanced default.',
  },
  'render.filterShape': {
    title: 'Filter shape',
    body:
      'The shape of the softening blur. Gaussian is a soft, round glow (best '
      + 'default). Other shapes (box, triangle, lanczos…) give slightly '
      + 'different feels — mostly visible only at large filter radius.',
  },

  // ── DENSITY EMITTER section ──────────────────────────────────────────
  'density.tonemapPresets': {
    title: 'Tonemap presets',
    body:
      'Apply four tonemap values at once (gamma · gammaThreshold · vibrancy '
      + '· brightness). The header chip shows the current preset; * means '
      + 'you have manually nudged it.',
  },
  'density.deToggle': {
    title: 'Density estimation',
    body:
      'Turn the adaptive-blur density estimator on or off. Off renders the '
      + 'raw point cloud — sharp and granular (equivalent to maxRad 0). On '
      + 'restores the previous blur kernel.',
    hint: 'flam3 and most imported flames assume DE on.',
  },
  'density.maxRad': {
    title: 'Max radius',
    body:
      'Maximum blur radius around each scatter point. '
      + 'Higher = softer, glowier image. Lower = sharper, more granular.',
    hint: 'At 0, density estimation is off (raw point cloud).',
  },
  'density.minRad': {
    title: 'Min radius',
    body:
      'Minimum blur radius — the floor for dense areas. '
      + 'Dense regions use this; sparse regions blur up to maxRad.',
    hint: 'Keep at or below maxRad.',
  },
  'density.curve': {
    title: 'Curve',
    body:
      'How density maps to blur radius. < 1 = aggressive (sparse areas reach '
      + 'maxRad quickly). > 1 = gentle (only the sparsest areas get close to '
      + 'maxRad).',
    hint: 'Default 0.4 works for most flames.',
  },

  // ── GLOBAL section ───────────────────────────────────────────────────
  'global.brightness': {
    title: 'Brightness',
    body:
      'Overall brightness of the whole flame. Higher = brighter, lower = '
      + 'darker. Affects every pixel equally — different from per-xform color.',
  },
  'global.gamma': {
    title: 'Gamma',
    body:
      'Mid-tone curve. Lower (<1) lifts midtones (brighter, washed). '
      + 'Higher (>1) crushes midtones (darker, punchier).',
  },
  'global.highlightPower': {
    title: 'Highlight power',
    body:
      'Compresses the brightest highlights. Higher = stronger compression, '
      + 'more detail in bright cores. Lower = highlights blow out to white '
      + 'earlier.',
  },
  'global.gammaThreshold': {
    title: 'Gamma threshold',
    body:
      'Below this density level, gamma is applied differently to avoid noise. '
      + 'Higher = more low-density pixels get the special treatment.',
    hint: 'Leave at default unless you see noisy near-black regions.',
  },
  'global.vibrancy': {
    title: 'Vibrancy',
    body:
      'Color saturation lift. 0 = grayscale, 1 = full original palette '
      + 'colors. Mid values desaturate the palette without losing structure.',
  },
  'global.background': {
    title: 'Background',
    body:
      'Background color of the canvas. Shown in unhit pixels and bleeds '
      + 'through translucent flame regions.',
  },
  'global.symmetry': {
    title: 'Symmetry',
    body:
      'Add rotational or dihedral symmetry to the chaos game. N = number of '
      + 'rotational copies (6 = hexagonal, 2 = mirror). Dihedral adds an '
      + 'extra mirror axis on top of the rotation.',
  },
  'global.xformBlend': {
    title: 'Xform blend',
    body:
      'Soft morph between xforms (#456). 0 = off (the normal discrete IFS). '
      + 'Higher values make more iterations blend two xforms’ outputs, smearing '
      + 'the attractor into a continuum of in-between shapes.',
  },

  // ── XFORMS section (per-xform color params) ──────────────────────────
  'xform.color': {
    title: 'Color',
    body:
      'Where this xform pulls toward on the palette gradient '
      + '(0 = left edge, 1 = right edge).',
  },
  'xform.colorSpeed': {
    title: 'Color speed',
    body:
      'How fast each visit tugs the running color toward this xform’s target. '
      + '0 = ignore, 1 = snap immediately.',
  },
  'xform.opacity': {
    title: 'Opacity',
    body: 'Visibility of this xform’s deposits. 0 = ghostly, 1 = full.',
  },

  // ── VIEWPORT section ─────────────────────────────────────────────────
  'viewport.scale': {
    title: 'Scale',
    body:
      'Zoom level of the camera over the flame. Higher = more zoomed in '
      + '(the flame fills more of the frame).',
  },
  'viewport.cx': {
    title: 'Center X',
    body: 'Horizontal center of the camera, in flame coordinates. Pans left/right.',
  },
  'viewport.cy': {
    title: 'Center Y',
    body: 'Vertical center of the camera, in flame coordinates. Pans up/down.',
  },
  'viewport.rotate': {
    title: 'Rotate',
    body: 'Rotate the whole camera view, in degrees. 0 = upright.',
  },
  'viewport.fit': {
    title: 'Fit',
    body:
      'Auto-set center + scale so the entire flame fits inside the render '
      + 'area. A one-click way to recover framing after edits.',
  },

  // ── CURVES section ───────────────────────────────────────────────────
  'curves.channels': {
    title: 'Curve channels',
    body:
      'Each tab grades a different channel: master (all RGB together), then R '
      + '/ G / B individually, then value (luminance). Drag points to reshape '
      + 'the tone curve for that channel.',
  },

  // ── PALETTE section — ramp generator (#358) ──────────────────────────
  'palette.generate': {
    title: 'Generate ramp',
    body:
      'Builds a fresh palette procedurally instead of picking one from the '
      + 'library. Colors are computed in a perceptual space (OkLCh), so a '
      + 'rainbow stays evenly bright across hues instead of pulsing — which '
      + 'reads as cleaner color in the render. Every change applies live and is '
      + 'fully undo-able (Cmd/Ctrl+Z), like any other control.',
    hint:
      'Rainbow — sweeps the hue wheel. Shades — one hue ramped dark→light. '
      + 'Chroma = how vivid · Lightness = how bright · Loops ≥2 = a multi-loop '
      + '(“double rainbow”) · Reverse flips the sweep direction · 🎲 picks a '
      + 'fresh start hue (Seed makes it repeatable).',
  },
};

// Controls deliberately left without a `?` icon because they are
// self-evident. Keeping them named here keeps "no help" an auditable
// decision rather than an accidental gap. (Populated as sections are wired.)
export const HELP_SKIP_ALLOWLIST: readonly HelpKey[] = [
  'viewer.open',
  'viewer.reroll',
  'viewer.saveFlame',
  'viewer.undo',
  'viewer.redo',
];

// Look up a registry entry and build its `?` info icon. Throws on an unknown
// key so a typo fails loudly in dev rather than silently rendering nothing.
export function infoIcon(key: HelpKey): HTMLElement {
  const opts = HELP[key];
  if (!opts) throw new Error(`help-text: unknown key "${key}"`);
  const el = buildInfoIcon(opts);
  // Stamp the registry key onto the element so tests (and any future
  // key-driven lookups) can locate a specific control's `?` via
  // `[data-help-key="<key>"]` (Q4 targeted help icons).
  el.dataset['helpKey'] = key;
  return el;
}

// One consolidated `?` for the whole RENDER row — a single wider popover
// covering size / quality / format / transparent, sourced from the same
// registry entries (so the copy stays single-source). Replaces the per-
// control `?` icons on the render side (#367).
// Fold a registry entry into a section (label + body, with the hint merged
// into the body since the section popover has no separate hint slot).
function pickSection(key: HelpKey): { label: string; body: string } {
  const o = HELP[key];
  if (!o) throw new Error(`help-text: unknown key "${key}"`);
  return { label: o.title, body: o.hint ? `${o.body} ${o.hint}` : o.body };
}

export function renderSectionHelpIcon(): HTMLElement {
  return buildSectionHelpIcon({
    title: 'Render output',
    sections: [
      pickSection('render.size'),
      pickSection('render.quality'),
      pickSection('render.format'),
      pickSection('render.transparent'),
    ],
  });
}

// One consolidated `?` for the whole PREVIEW row — mirrors the RENDER
// section icon: a single wider popover covering the preview-vs-render
// concept, the preview tier, and the preview quality (#367).
export function previewSectionHelpIcon(): HTMLElement {
  return buildSectionHelpIcon({
    title: 'Live preview',
    sections: [
      pickSection('concept.preview-vs-render'),
      pickSection('preview.tier'),
      pickSection('preview.quality'),
    ],
  });
}
