// pyr3 — /editor XForm lens section (#350 / #335).
//
// Single-selection model (Phase 2.1, replaces the v1 card-stack): a dropdown
// selector + action bar pick ONE xform; its detail fills the pane below.
// The final xform folds in as a second always-present selector row (sentinel
// `state.selectedXformIndex === -1`) sharing the same detail pane — the
// standalone `finalSection` was retired here.
//
//   ┌ XForm lens ───────────────────────────────┐
//   │ xform   [ xform 1 · of 6   ▾ ]             │  ← regular selector
//   │ [⏻ │ ＋ 🗑 ⧉      ↑ ↓]                       │  ← regular action bar
//   │ final xform   [ ✨ final ]                  │  ← always-present final row
//   │ [⏻ │ 🗑]                                     │  ← final action bar
//   │ ─────────────────────────────────────────   │
//   │ Editing xform 1 · weight 0.99               │
//   │ weight […] · affine · variations · color    │  ← selection-driven detail
//   │ · xaos                                       │
//   └──────────────────────────────────────────────┘
//
// ALL structural ops route through `xform-ops.ts` (add/remove/duplicate/swap,
// with xaos column/row upkeep) then `onChange` — so history/persist/live-render
// fire and every op is one-⌘Z undoable. Pure-genome correctness lives in
// xform-ops.ts (unit-tested); this file is the DOM shell.

import { type SectionMount } from './edit-ui';
import {
  type EditState,
  type XformDetailGroup,
  snapshotForSolo,
  restoreFromSolo,
  persistXformDetailCollapse,
} from './edit-state';
import { type Xform } from './genome';
import { addXform, removeXform, duplicateXform, swapXforms, makeDefaultXform } from './xform-ops';
import { type Variation, V, VARIATION_NAMES, MAX_VARIATIONS_PER_XFORM, DC_VARIATION_SET } from './variations';
import { VARIATION_PARAMS, PARAM_KEYS, MAX_VARIATION_PARAMS } from './serialize';
import {
  decomposedToRaw,
  rawToDecomposed,
  type RawAffine,
  type DecomposedAffine,
} from './affine-decompose';
import { attachXformViz } from './edit-xform-viz';
import {
  applyQuickOp,
  QUICK_OPS_DEFS,
  type DecomposedAffine as QuickOpAffine,
} from './edit-xform-quickops';
import { openVariationPicker } from './edit-variation-picker';
import { wireVariationKindButton, applyVariationKind } from './edit-variation-kind';
import { scrubbyInput, type FieldKind, type ScrubbyHandle } from './edit-scrubby-input';
import {
  buildButton,
  buildToggle,
  buildRemoveButton,
  buildRow,
  buildSlider,
  buildNumberInput,
  buildExpander,
} from './edit-primitives';
import { infoIcon, type HelpKey } from './help-text';

/** Sentinel `selectedXformIndex` value meaning "the final xform is selected". */
const FINAL_SEL = -1;

// Per-variation param-slot keys, in stable index order. Names match the
// VARIATION_PARAMS schema; slot index = positional index into PARAM_KEYS.
// Variations missing from VARIATION_PARAMS are parameterless.
function paramNamesFor(variationIndex: number): readonly string[] {
  const kindName = VARIATION_NAMES[variationIndex];
  if (kindName === undefined) return [];
  return VARIATION_PARAMS[kindName] ?? [];
}

function makeIdentityPost(): NonNullable<Xform['post']> {
  return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
}

// Scrubby numeric cell that writes back via `commit(num)` on each scrub
// step or text-mode commit. `kind` picks the per-field sensitivity floor;
// `min`/`max` are optional clamps; `width` pins the cell width.
function makeNumberInput(
  initial: number,
  commit: (val: number) => void,
  opts: { kind?: FieldKind; minStep?: number; min?: number; max?: number; width?: string; format?: (v: number) => string } = {},
): ScrubbyHandle {
  const handle = scrubbyInput({
    value: initial,
    onInput: commit,
    kind: opts.kind,
    minStep: opts.minStep,
    min: opts.min,
    max: opts.max,
    format: opts.format,
  });
  if (opts.width !== undefined) handle.el.style.width = opts.width;
  return handle;
}

function makeLabeledField(labelText: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'pyr3-edit-field';
  const lbl = document.createElement('span');
  lbl.className = 'pyr3-edit-field-label';
  lbl.textContent = labelText;
  row.append(lbl, control);
  return row;
}

function makeSectionLabel(text: string): HTMLDivElement {
  const lbl = document.createElement('div');
  lbl.className = 'pyr3-edit-sublabel';
  lbl.textContent = text;
  return lbl;
}

function makeIconButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pyr3-edit-icon-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ── Selector action-bar primitives ──────────────────────────────────────────

/** A square icon button for the selector action bar (＋ 🗑 ⧉ ↑ ↓). */
function makeBarButton(
  glyph: string,
  title: string,
  onClick: () => void,
  opts: { disabled?: boolean } = {},
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pyr3-edit-bar-btn';
  b.textContent = glyph;
  b.title = title;
  if (opts.disabled) {
    b.disabled = true;
    b.setAttribute('aria-disabled', 'true');
  } else {
    b.addEventListener('click', onClick);
  }
  return b;
}

/** Power (⏻) button — green when active, grey when inactive. Plain click
 *  toggles; an optional shift-click handler drives solo. */
function makePowerButton(
  active: boolean,
  onToggle: () => void,
  onSolo?: () => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = active ? 'pyr3-edit-bar-btn pyr3-edit-power on' : 'pyr3-edit-bar-btn pyr3-edit-power';
  b.textContent = '⏻';
  b.title = onSolo
    ? 'Toggle active. Shift-click to solo (turn off all others).'
    : 'Toggle active.';
  b.addEventListener('click', (ev) => {
    const me = ev as MouseEvent;
    if (me.shiftKey && onSolo) {
      me.preventDefault();
      onSolo();
      return;
    }
    onToggle();
  });
  return b;
}

/** A thin vertical delimiter between button clusters in the action bar. */
function makeBarDiv(): HTMLSpanElement {
  const d = document.createElement('span');
  d.className = 'pyr3-edit-bardiv';
  return d;
}

// Build one variation row (active toggle + kind picker-trigger button + weight
// + 🗑️ + per-kind param inputs). `pathPrefix` is the genome path to this xform
// (e.g. `xforms.2` or `finalxform`); `soloKey` keys the variation-solo snapshot
// (xform index, or FINAL_SEL for the final). The param-row sub-container is
// rebuilt in place on kind change.
function buildVariationRow(
  state: EditState,
  xform: Xform,
  pathPrefix: string,
  soloKey: number,
  varIndex: number,
  onChange: (path: string) => void,
  removeSelf: () => void,
  rebuildDetail: () => void,
): HTMLDivElement {
  const v = xform.variations[varIndex]!;

  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-var-row';
  if (v.active === false) wrap.classList.add('pyr3-edit-var-inactive');

  const headerRow = document.createElement('div');
  headerRow.className = 'pyr3-edit-var-header';

  const activeToggle = buildToggle({
    value: v.active !== false,
    onChange: (next) => {
      v.active = next ? undefined : false;
      wrap.classList.toggle('pyr3-edit-var-inactive', v.active === false);
      onChange(`${pathPrefix}.variations.${varIndex}.active`);
    },
  });
  activeToggle.classList.add('pyr3-edit-var-active');
  activeToggle.title = 'Click to toggle. Shift-click to solo within this xform.';
  // Capture-phase shift-click → solo within this xform.
  activeToggle.addEventListener('click', (ev) => {
    const me = ev as MouseEvent;
    if (!me.shiftKey) return;
    me.preventDefault();
    me.stopImmediatePropagation();
    state.soloVariationSnapshot = state.soloVariationSnapshot ?? {};
    const existing = state.soloVariationSnapshot[soloKey];
    if (existing && existing.targetIndex === varIndex) {
      restoreFromSolo(xform.variations, existing);
      delete state.soloVariationSnapshot[soloKey];
    } else {
      if (existing) restoreFromSolo(xform.variations, existing);
      state.soloVariationSnapshot[soloKey] = snapshotForSolo(xform.variations, varIndex);
      for (let i = 0; i < xform.variations.length; i++) {
        if (i !== varIndex) xform.variations[i]!.active = false;
      }
    }
    onChange(`${pathPrefix}.variations.solo`);
    rebuildDetail();
  }, true);

  const kindBtn = document.createElement('button');
  kindBtn.type = 'button';
  kindBtn.className = 'pyr3-edit-var-kind-btn';
  kindBtn.textContent = VARIATION_NAMES[v.index] ?? `var${v.index}`;
  kindBtn.title = 'Click to pick a different variation kind.';
  wireVariationKindButton(kindBtn, v, `${pathPrefix}.variations.${varIndex}.index`, onChange);

  const weightInput = makeNumberInput(
    v.weight,
    (n) => {
      v.weight = n;
      onChange(`${pathPrefix}.variations.${varIndex}.weight`);
    },
    { kind: 'weight', width: '64px' },
  );
  weightInput.el.title = "Strength of this variation's contribution. The chain sums weighted contributions.";
  weightInput.el.classList.add('pyr3-edit-var-weight');

  const removeBtn = buildRemoveButton({
    title: 'Remove this variation from the chain.',
    onClick: () => removeSelf(),
  });

  headerRow.append(activeToggle, kindBtn, weightInput.el, removeBtn);

  // #114 — DC chip next to the kindBtn when this row is a DC variation.
  // Hover explains the override; click opens canonical docs in a new tab.
  if (DC_VARIATION_SET.has(v.index)) {
    const dcChip = document.createElement('span');
    dcChip.className = 'pyr3-edit-var-dc-chip';
    dcChip.textContent = 'DC ⓘ';
    dcChip.title = `This xform's color is computed from spatial position by ${VARIATION_NAMES[v.index] ?? 'a DC variation'} instead of the palette. Click to learn more.`;
    dcChip.style.cursor = 'help';
    dcChip.style.fontSize = '10px';
    dcChip.style.padding = '0 4px';
    dcChip.style.marginLeft = '4px';
    dcChip.style.borderRadius = '3px';
    dcChip.style.border = '1px solid currentColor';
    dcChip.style.opacity = '0.7';
    dcChip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.open('/help/direct-color-variations.html', '_blank', 'noopener,noreferrer');
    });
    headerRow.appendChild(dcChip);
  }

  wrap.appendChild(headerRow);

  // Param row — labels + inputs per VARIATION_PARAMS[kind]. Rebuilt on
  // kind change. Held in a dedicated child so we can replace just it.
  const paramRow = document.createElement('div');
  paramRow.className = 'pyr3-edit-var-params';
  wrap.appendChild(paramRow);

  const renderParams = (): void => {
    paramRow.replaceChildren();
    const names = paramNamesFor(v.index);
    // #385 — bound by the param-SLOT cap (MAX_VARIATION_PARAMS = 10), NOT the
    // variation-COUNT cap (MAX_VARIATIONS_PER_XFORM = 8). They coincided before
    // #120 grew the seam to 10 slots; using the wrong one hid params 9-10 for
    // 10-param variations (intersection/parallel) — the genome held them but the
    // user could never see/edit/reset them.
    for (let p = 0; p < names.length && p < MAX_VARIATION_PARAMS; p++) {
      const paramKey = PARAM_KEYS[p]!;
      const current = (v as unknown as Record<string, number | undefined>)[paramKey] ?? 0;
      const inp = makeNumberInput(
        current,
        (n) => {
          (v as unknown as Record<string, number>)[paramKey] = n;
          onChange(`${pathPrefix}.variations.${varIndex}.${paramKey}`);
        },
        { kind: 'generic', width: '56px' },
      );
      const field = makeLabeledField(`${names[p]!} `, inp.el);
      paramRow.appendChild(field);
    }
  };
  renderParams();

  return wrap;
}

// Tooltip strings — short, plain-English, < 80 chars.
const AFFINE_TOOLTIPS: Record<string, string> = {
  scaleX: 'How much this xform stretches the X dimension. <1 shrinks, >1 grows.',
  scaleY: 'How much this xform stretches the Y dimension.',
  rotation: 'CCW rotation in degrees, around the position point.',
  positionX: "Horizontal offset — where this xform 'lives' along the X axis.",
  positionY: 'Vertical offset.',
  shear: 'Skew along the X axis. 0 = no skew.',
  rawMatrix: 'Direct entry of the 2x2 affine matrix.',
};

type AffineLens = 'pre' | 'post';

// Builds the decomposed-affine UI (5 fields + viz + quick-ops + shear fold +
// raw fold) inside `parent`. Used by both pre- and post-affine. `pathPrefix`
// is the genome path to the owning xform (`xforms.2` or `finalxform`). The
// genome's authoritative a..f stays the source of truth — the decomposed view
// recomposes on every edit.
function buildDecomposedAffineBlock(
  parent: HTMLElement,
  xform: Xform,
  pathPrefix: string,
  onChange: (path: string) => void,
  lens: AffineLens,
): void {
  // Source-of-truth getter / setter against xform.{a..f} or xform.post.{a..f}.
  const getRaw = (): RawAffine => {
    if (lens === 'pre') return { a: xform.a, b: xform.b, c: xform.c, d: xform.d, e: xform.e, f: xform.f };
    if (!xform.post) return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    return { ...xform.post };
  };
  const setRaw = (r: RawAffine): void => {
    if (lens === 'pre') {
      xform.a = r.a; xform.b = r.b; xform.c = r.c;
      xform.d = r.d; xform.e = r.e; xform.f = r.f;
      return;
    }
    if (!xform.post) xform.post = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    xform.post.a = r.a; xform.post.b = r.b; xform.post.c = r.c;
    xform.post.d = r.d; xform.post.e = r.e; xform.post.f = r.f;
  };
  const pathBase = lens === 'pre' ? pathPrefix : `${pathPrefix}.post`;

  // Container — stacks the fields-and-viz row above the two fold-ups
  // (shear, raw matrix).
  const block = document.createElement('div');
  block.className = lens === 'pre' ? 'pyr3-edit-aff-block' : 'pyr3-edit-aff-block pyr3-edit-aff-post';
  parent.appendChild(block);

  // Top row: decomposed fields on left, mini viz on right.
  const topRow = document.createElement('div');
  topRow.className = 'pyr3-edit-aff-row';
  block.appendChild(topRow);

  const fieldsCol = document.createElement('div');
  fieldsCol.className = 'pyr3-edit-aff-fields';
  const vizCol = document.createElement('div');
  vizCol.className = 'pyr3-edit-aff-viz-col';
  const vizCanvas = document.createElement('canvas');
  vizCanvas.className = 'pyr3-edit-aff-viz';
  // Mini viz canvas. 88×88 intrinsic + 1px border ≈ 90px column; CSS keeps a
  // max-width: 100% so panel shrinkage doesn't overflow.
  vizCanvas.width = 88;
  vizCanvas.height = 88;
  vizCol.appendChild(vizCanvas);
  topRow.append(fieldsCol, vizCol);

  const viz = attachXformViz(vizCanvas, getRaw);

  const RAD = Math.PI / 180;
  const initial = rawToDecomposed(getRaw());

  // Cache the 5 decomposed-field scrubby handles so quick-ops + raw-matrix
  // edits can refresh displayed values without re-triggering onInput.
  const decomposedInputs: Partial<Record<keyof DecomposedAffine, ScrubbyHandle>> = {};

  function bindDecomposed(
    field: keyof DecomposedAffine,
    label: string,
    initialValue: number,
    unit?: string,
  ): ScrubbyHandle {
    const wrap = document.createElement('div');
    wrap.className = `pyr3-edit-field pyr3-edit-aff-${field}`;
    const lbl = document.createElement('label');
    lbl.className = 'pyr3-edit-field-label';
    lbl.textContent = label;
    // Display value: rotation stored as radians in DecomposedAffine, shown
    // as degrees; everything else 1:1.
    const displayInitial = field === 'rotation' ? initialValue / RAD : initialValue;
    const kind: FieldKind =
      field === 'rotation' ? 'rotation'
      : field === 'scaleX' || field === 'scaleY' ? 'scale'
      : 'position';
    const handle = scrubbyInput({
      value: displayInitial,
      kind,
      ariaLabel: label,
      onInput: (n) => {
        // #388 — drop non-finite input (match the density/render/global sections).
        // A NaN here defeats rawToDecomposed's singular guard (`NaN < eps` is
        // false) and would ship a NaN affine to the kernel and into saved JSON.
        if (!Number.isFinite(n)) return;
        const dec = rawToDecomposed(getRaw());
        const val = field === 'rotation' ? n * RAD : n;
        const next: DecomposedAffine = { ...dec, [field]: val };
        setRaw(decomposedToRaw(next));
        viz.draw();
        refreshRawInputs();
        onChange(`${pathBase}.${field}`);
      },
    });
    handle.el.title = AFFINE_TOOLTIPS[field] ?? '';
    wrap.append(lbl, handle.el);
    if (unit) {
      const u = document.createElement('span');
      u.className = 'pyr3-edit-unit';
      u.textContent = unit;
      wrap.appendChild(u);
    }
    fieldsCol.appendChild(wrap);

    decomposedInputs[field] = handle;
    return handle;
  }

  bindDecomposed('scaleX', 'scale x', initial.scaleX);
  bindDecomposed('scaleY', 'scale y', initial.scaleY);
  bindDecomposed('rotation', 'rotation', initial.rotation, '°');
  bindDecomposed('positionX', 'position x', initial.positionX);
  bindDecomposed('positionY', 'position y', initial.positionY);

  // ── Quick-ops strip + reset-to-identity ───────────────────────────
  const quickopsStrip = document.createElement('div');
  quickopsStrip.className = 'pyr3-edit-aff-quickops';
  for (const q of QUICK_OPS_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pyr3-edit-quickop';
    btn.dataset['op'] = q.id;
    btn.textContent = q.icon + (q.delta ? ' ' + q.delta : ' ' + q.label);
    btn.title = `${q.label}${q.delta ? ' ' + q.delta : ''}`;
    btn.addEventListener('click', () => {
      const before = getRaw();
      // Pivot rotate/scale/flip about the GIZMO CENTER (apply(0.5,0.5)), not the
      // xform origin — so the square transforms in place (#350 quick-ops).
      const ctrX = before.a * 0.5 + before.b * 0.5 + before.c;
      const ctrY = before.d * 0.5 + before.e * 0.5 + before.f;
      const dec = rawToDecomposed(before);
      // Convert affine-decompose contract (radians + positionX/Y) →
      // quickops contract (degrees + posX/Y), apply, then back.
      const qop: QuickOpAffine = {
        scaleX: dec.scaleX,
        scaleY: dec.scaleY,
        rotation: dec.rotation / RAD,
        shear: dec.shear,
        posX: dec.positionX,
        posY: dec.positionY,
      };
      const after = applyQuickOp(q.id, qop);
      const nextDec: DecomposedAffine = {
        scaleX: after.scaleX,
        scaleY: after.scaleY,
        rotation: after.rotation * RAD,
        shear: after.shear,
        positionX: after.posX,
        positionY: after.posY,
      };
      const raw = decomposedToRaw(nextDec);
      // Re-anchor translation so the center stays fixed under the op.
      const ctrAfterX = raw.a * 0.5 + raw.b * 0.5 + raw.c;
      const ctrAfterY = raw.d * 0.5 + raw.e * 0.5 + raw.f;
      raw.c += ctrX - ctrAfterX;
      raw.f += ctrY - ctrAfterY;
      setRaw(raw);
      viz.draw();
      // Displays re-read from the FINAL decomposition (position changed).
      const finalDec = rawToDecomposed(raw);
      decomposedInputs.scaleX?.setValue(finalDec.scaleX);
      decomposedInputs.scaleY?.setValue(finalDec.scaleY);
      decomposedInputs.rotation?.setValue(finalDec.rotation / RAD);
      decomposedInputs.positionX?.setValue(finalDec.positionX);
      decomposedInputs.positionY?.setValue(finalDec.positionY);
      if (shearHandle) shearHandle.setValue(finalDec.shear);
      if (shearFold && Math.abs(finalDec.shear) > 1e-9) shearFold.open = true;
      refreshRawInputs();
      onChange(`${pathBase}.quickop`);
    });
    quickopsStrip.appendChild(btn);
  }
  block.appendChild(quickopsStrip);

  // Separate reset-to-identity action (accent button, popped from the strip).
  const resetBtn = buildButton({
    variant: 'accent',
    label: 'reset to identity',
    icon: '⟲',
    onClick: () => {
      const pos = rawToDecomposed(getRaw());
      const nextDec: DecomposedAffine = {
        scaleX: 1, scaleY: 1, rotation: 0, shear: 0,
        positionX: pos.positionX, positionY: pos.positionY,
      };
      setRaw(decomposedToRaw(nextDec));
      viz.draw();
      decomposedInputs.scaleX?.setValue(1);
      decomposedInputs.scaleY?.setValue(1);
      decomposedInputs.rotation?.setValue(0);
      decomposedInputs.positionX?.setValue(nextDec.positionX);
      decomposedInputs.positionY?.setValue(nextDec.positionY);
      if (shearHandle) shearHandle.setValue(0);
      refreshRawInputs();
      onChange(`${pathBase}.reset`);
    },
  });
  resetBtn.classList.add('pyr3-edit-aff-reset');
  block.appendChild(resetBtn);

  // ── Shear fold-up (auto-opens if shear !== 0) ─────────────────────
  // Routed through the shared Tier-4 expander (uniform orange accent-bar,
  // decision Q1). The legacy `.pyr3-edit-aff-shear-fold` class is retained on
  // the <details> so existing selectors keep resolving; the subpanel key is
  // passed through buildExpander (undo/redo open-state restore, #358).
  const shearExp = buildExpander({
    summary: 'shear',
    open: Math.abs(initial.shear) > 1e-9,
    subpanelKey: `${pathBase}.shearFold`,
  });
  const shearFold = shearExp.details;
  shearFold.classList.add('pyr3-edit-aff-shear-fold');
  const shearWrap = document.createElement('div');
  shearWrap.className = 'pyr3-edit-field pyr3-edit-aff-shear';
  const shearLbl = document.createElement('label');
  shearLbl.className = 'pyr3-edit-field-label';
  shearLbl.textContent = 'shear';
  const shearHandle = scrubbyInput({
    value: initial.shear,
    kind: 'position',
    ariaLabel: 'shear',
    onInput: (n) => {
      if (!Number.isFinite(n)) return; // #388 — drop non-finite input
      const dec = rawToDecomposed(getRaw());
      setRaw(decomposedToRaw({ ...dec, shear: n }));
      viz.draw();
      refreshRawInputs();
      onChange(`${pathBase}.shear`);
    },
  });
  shearHandle.el.title = AFFINE_TOOLTIPS.shear ?? '';
  shearWrap.append(shearLbl, shearHandle.el);
  shearExp.body.appendChild(shearWrap);
  block.appendChild(shearFold);

  // ── Raw matrix fold-up ────────────────────────────────────────────
  // Shared Tier-4 expander (decision Q1). Legacy `.pyr3-edit-aff-raw-fold`
  // class retained for existing selectors; subpanel key threads through for
  // undo/redo open-state restore (#358).
  const rawExp = buildExpander({
    summary: 'raw matrix',
    subpanelKey: `${pathBase}.rawFold`,
  });
  const rawFold = rawExp.details;
  rawFold.classList.add('pyr3-edit-aff-raw-fold');
  const rawGrid = document.createElement('div');
  rawGrid.className = 'pyr3-edit-raw-grid';
  const rawInputs: Partial<Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', ScrubbyHandle>> = {};
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
    const wrap = document.createElement('div');
    wrap.className = `pyr3-edit-field pyr3-edit-aff-raw-${key}`;
    const lbl = document.createElement('label');
    lbl.className = 'pyr3-edit-field-label';
    lbl.textContent = key;
    const handle = scrubbyInput({
      value: getRaw()[key],
      kind: 'position',
      ariaLabel: `raw ${key}`,
      onInput: (n) => {
        if (!Number.isFinite(n)) return; // #388 — drop non-finite input (raw a..f)
        const raw = getRaw();
        raw[key] = n;
        setRaw(raw);
        viz.draw();
        // Mirror the change into the decomposed inputs so they stay in sync.
        const dec = rawToDecomposed(raw);
        decomposedInputs.scaleX?.setValue(dec.scaleX);
        decomposedInputs.scaleY?.setValue(dec.scaleY);
        decomposedInputs.rotation?.setValue(dec.rotation / RAD);
        decomposedInputs.positionX?.setValue(dec.positionX);
        decomposedInputs.positionY?.setValue(dec.positionY);
        shearHandle.setValue(dec.shear);
        onChange(`${pathBase}.${key}`);
      },
    });
    handle.el.title = AFFINE_TOOLTIPS.rawMatrix ?? '';
    wrap.append(lbl, handle.el);
    rawGrid.appendChild(wrap);
    rawInputs[key] = handle;
  }
  rawExp.body.appendChild(rawGrid);
  block.appendChild(rawFold);

  function refreshRawInputs(): void {
    const raw = getRaw();
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      rawInputs[key]?.setValue(raw[key]);
    }
  }

  // #350 #1 — refresh ALL displayed values + the mini-viz from the live genome
  // affine. Fired when an external surface (the on-canvas gizmo) mutates this
  // xform, so the panel fields + mini-viz track the drag in real time.
  function syncFromGenome(): void {
    const dec = rawToDecomposed(getRaw());
    decomposedInputs.scaleX?.setValue(dec.scaleX);
    decomposedInputs.scaleY?.setValue(dec.scaleY);
    decomposedInputs.rotation?.setValue(dec.rotation / RAD);
    decomposedInputs.positionX?.setValue(dec.positionX);
    decomposedInputs.positionY?.setValue(dec.positionY);
    shearHandle.setValue(dec.shear);
    refreshRawInputs();
    viz.draw();
  }
  // Self-removing document listener: the detail pane is rebuilt (replaceChildren)
  // on selection change, so a detached block unhooks itself on the next event.
  const onGizmoAffine = (): void => {
    if (!block.isConnected) { document.removeEventListener('pyr3:xform-affine-changed', onGizmoAffine); return; }
    syncFromGenome();
  };
  document.addEventListener('pyr3:xform-affine-changed', onGizmoAffine);

  // Initial paint of the viz.
  viz.draw();
}

// ── Detail pane ──────────────────────────────────────────────────────────────

/** Which xform the detail pane is editing. Regular carries the index; final
 *  is the singular post-pick lens (no weight, no xaos). */
type DetailTarget = { kind: 'regular'; index: number } | { kind: 'final' };

// A collapsible detail sub-accordion (#350 Phase 2.2). The header chevron
// toggles `state.xformDetailCollapse[group]` (a persisted per-browser pref,
// global across xforms) and shows/hides the body — it never re-renders the
// body, so the affine viz + scrubby handles inside stay live (avoids the #283
// per-frame-replaceChildren click hazard). `fill` populates the body once.
function buildAccordion(
  title: string,
  group: XformDetailGroup,
  state: EditState,
  fill: (body: HTMLElement) => void,
  helpKey?: HelpKey,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-accordion';
  wrap.dataset['group'] = group;

  const collapsed = state.xformDetailCollapse[group] === true;

  const header = document.createElement('div');
  header.className = 'pyr3-edit-accordion-header';
  const chev = document.createElement('span');
  chev.className = 'pyr3-edit-accordion-chev';
  chev.textContent = collapsed ? '▸' : '▾';
  const titleEl = document.createElement('span');
  titleEl.className = 'pyr3-edit-accordion-title';
  titleEl.textContent = title;
  header.append(chev, titleEl);
  if (helpKey) {
    const help = infoIcon(helpKey);
    // Clicking the help icon must NOT toggle the accordion collapse.
    help.addEventListener('click', (e) => e.stopPropagation());
    header.appendChild(help);
  }

  const body = document.createElement('div');
  body.className = 'pyr3-edit-accordion-body';
  body.style.display = collapsed ? 'none' : 'block';
  fill(body);

  header.addEventListener('click', () => {
    const now = !(state.xformDetailCollapse[group] === true);
    state.xformDetailCollapse[group] = now;
    persistXformDetailCollapse(state.xformDetailCollapse);
    chev.textContent = now ? '▸' : '▾';
    body.style.display = now ? 'none' : 'block';
  });

  wrap.append(header, body);
  return wrap;
}

// Build the editable detail for the selected xform into `host`. `rebuildDetail`
// re-renders just this pane (used after a kind/variation change). Regular xforms
// show weight + affine + variations + post + color + xaos; the final omits
// weight and xaos (it is not in the chaos pick and has no transition row).
function buildXformDetail(
  host: HTMLElement,
  state: EditState,
  target: DetailTarget,
  onChange: (path: string) => void,
  rebuildDetail: () => void,
): void {
  host.replaceChildren();

  const isFinal = target.kind === 'final';
  const xform = isFinal ? state.genome.finalxform : state.genome.xforms[target.index];
  if (!xform) return;
  const pathPrefix = isFinal ? 'finalxform' : `xforms.${target.index}`;
  const soloKey = isFinal ? FINAL_SEL : target.index;
  const totalXforms = state.genome.xforms.length;

  // ── Detail header line (which xform + its weight) ──────────────────
  const headerLine = document.createElement('div');
  headerLine.className = 'pyr3-edit-detail-header';
  headerLine.textContent = isFinal
    ? 'Editing final xform'
    : `Editing xform ${target.index + 1}`;
  host.appendChild(headerLine);

  // ── weight (regular only — meaningless for the final lens) ─────────
  if (!isFinal) {
    const weightInput = makeNumberInput(
      xform.weight,
      (n) => {
        xform.weight = n;
        onChange(`${pathPrefix}.weight`);
      },
      { kind: 'weight', min: 0, width: '80px' },
    );
    weightInput.el.title = 'Relative chance this xform gets picked each chaos-game step. Higher = more contribution.';
    weightInput.el.classList.add('pyr3-edit-xform-weight');
    const weightRow = buildRow('weight', weightInput.el);
    host.appendChild(weightRow);
  }

  // ── Affine accordion (decomposed + quick-ops + shear/raw folds + the
  //    optional post-transform, all grouped under the geometric core; §3) ──
  host.appendChild(buildAccordion('Affine', 'affine', state, (body) => {
    buildDecomposedAffineBlock(body, xform, pathPrefix, onChange, 'pre');

    // Post-transform (optional second affine) — a fold within Affine.
    const postWrap = document.createElement('div');
    postWrap.className = 'pyr3-edit-post-wrap';
    postWrap.appendChild(makeSectionLabel('post-transform'));

    const postBlockHost = document.createElement('div');
    postBlockHost.className = 'pyr3-edit-post-block-host';

    const mountPostBlock = (): void => {
      postBlockHost.replaceChildren();
      if (xform.post !== undefined) {
        buildDecomposedAffineBlock(postBlockHost, xform, pathPrefix, onChange, 'post');
      }
    };

    const postToggle = buildToggle({
      value: xform.post !== undefined,
      onChange: (next) => {
        xform.post = next ? makeIdentityPost() : undefined;
        onChange(`${pathPrefix}.post`);
        mountPostBlock();
      },
    });
    postToggle.classList.add('pyr3-edit-post-toggle');
    postToggle.title = 'Apply a second affine AFTER the variation chain.';
    postWrap.appendChild(buildRow('use post-transform', postToggle));
    postWrap.appendChild(postBlockHost);
    mountPostBlock();
    body.appendChild(postWrap);
  }, 'xform.affine'));

  // ── Variations accordion ────────────────────────────────────────────
  host.appendChild(buildAccordion('Variations', 'variations', state, (body) => {
    const varHeader = document.createElement('div');
    varHeader.className = 'pyr3-edit-var-header-row';
    const addVarBtn = makeIconButton('+ var', () => {
      if (xform.variations.length >= MAX_VARIATIONS_PER_XFORM) return;
      // Open picker. New row is appended only when user picks (onPreview).
      let inserted = false;
      openVariationPicker({
        host: document.body,
        initialIndex: V.linear,
        onPreview: (idx) => {
          if (!inserted) {
            const nv: Variation = { index: idx as Variation['index'], weight: 1 };
            applyVariationKind(nv, nv.index); // stamp the kind's default params (#261)
            xform.variations.push(nv);
            inserted = true;
            rebuildDetail();
          } else {
            applyVariationKind(
              xform.variations[xform.variations.length - 1]!,
              idx as Variation['index'],
            );
            onChange(
              `${pathPrefix}.variations.${xform.variations.length - 1}.index`,
            );
          }
        },
        onCommit: () => {
          onChange(`${pathPrefix}.variations.added`);
        },
        onCancel: () => {
          if (inserted) {
            xform.variations.pop();
            rebuildDetail();
          }
        },
        // #315 — revert means "undo the add" (matching ✕ cancel), not "reset
        // the new slot to linear". The picker stays open, so reset `inserted`.
        onRevert: () => {
          if (inserted) {
            xform.variations.pop();
            inserted = false;
            rebuildDetail();
          }
        },
      });
    });
    addVarBtn.classList.add('pyr3-edit-var-add');
    addVarBtn.title = 'Add a variation to this xform — opens the variation picker.';
    varHeader.appendChild(addVarBtn);
    body.appendChild(varHeader);

    const varList = document.createElement('div');
    varList.className = 'pyr3-edit-var-list';
    for (let j = 0; j < xform.variations.length; j++) {
      const row = buildVariationRow(state, xform, pathPrefix, soloKey, j, onChange, () => {
        if (xform.variations.length <= 1) return;
        xform.variations.splice(j, 1);
        onChange(`${pathPrefix}.variations.${j}.removed`);
        rebuildDetail();
      }, rebuildDetail);
      varList.appendChild(row);
    }
    body.appendChild(varList);
  }));

  // ── Color accordion (color / colorSpeed / opacity) ──────────────────
  host.appendChild(buildAccordion('Color', 'color', state, (body) => {
    // #114 — when any variation in the chain is a DC kind, color + color_speed
    // are overridden at render time by the dc_*'s RGB. The values stay editable
    // (kept on the genome so removing the DC variation restores them) — a note
    // tells the user they're inactive right now.
    const dcVarInChain = xform.variations.find(v => DC_VARIATION_SET.has(v.index));
    const dcKindName = dcVarInChain ? (VARIATION_NAMES[dcVarInChain.index] ?? 'a DC variation') : null;
    if (dcKindName) {
      const note = makeSectionLabel(`overridden by ${dcKindName}`);
      note.style.opacity = '0.7';
      note.title = `This xform's color is computed from position by ${dcKindName}; the slider values below are kept on the genome but not in effect.`;
      body.appendChild(note);
    }

    const colorSliderEl = buildSlider({
      value: xform.color,
      min: 0,
      max: 1,
      step: 0.001,
      onChange: (n) => {
        xform.color = n;
        onChange(`${pathPrefix}.color`);
      },
    });
    colorSliderEl.classList.add('pyr3-edit-color-slider');
    colorSliderEl.title = 'Where this xform pulls toward on the palette gradient (0 = left, 1 = right).';
    const colorRow = buildRow('color', colorSliderEl);
    colorRow.querySelector('.pyr3-ctrl')?.appendChild(infoIcon('xform.color'));
    body.appendChild(colorRow);

    const colorSpeedInput = buildNumberInput({
      value: xform.colorSpeed,
      kind: 'color',
      min: 0,
      max: 1,
      onChange: (n) => {
        xform.colorSpeed = n;
        onChange(`${pathPrefix}.colorSpeed`);
      },
    });
    colorSpeedInput.el.title = 'How fast each visit tugs the color toward its target. 0 = ignore, 1 = snap.';
    colorSpeedInput.el.classList.add('pyr3-edit-color-speed');
    const colorSpeedRow = buildRow('colorSpeed', colorSpeedInput.el);
    colorSpeedRow.querySelector('.pyr3-ctrl')?.appendChild(infoIcon('xform.colorSpeed'));
    body.appendChild(colorSpeedRow);

    const opacitySliderEl = buildSlider({
      value: xform.opacity ?? 1,
      min: 0,
      max: 1,
      step: 0.001,
      onChange: (n) => {
        xform.opacity = n;
        onChange(`${pathPrefix}.opacity`);
      },
    });
    opacitySliderEl.classList.add('pyr3-edit-opacity-slider');
    opacitySliderEl.title = "Visibility of this xform's deposits. 0 = ghostly, 1 = full.";
    const opacityRow = buildRow('opacity', opacitySliderEl);
    opacityRow.querySelector('.pyr3-ctrl')?.appendChild(infoIcon('xform.opacity'));
    body.appendChild(opacityRow);
  }));

  // ── Xaos accordion (regular + 2+ xforms only; the final has no xaos) ─
  if (!isFinal && totalXforms > 1) {
    host.appendChild(buildAccordion('Xaos →', 'xaos', state, (body) => {
      const xaosWrap = document.createElement('div');
      xaosWrap.className = 'pyr3-edit-xaos-row';
      for (let k = 0; k < totalXforms; k++) {
        const current = xform.xaos?.[k] ?? 1;
        const inp = buildNumberInput({
          value: current,
          kind: 'weight',
          min: 0,
          onChange: (n) => {
            if (!xform.xaos) {
              xform.xaos = new Array<number>(totalXforms).fill(1);
            }
            // Grow if shorter than the destination index.
            while (xform.xaos.length <= k) xform.xaos.push(1);
            xform.xaos[k] = n;
            onChange(`${pathPrefix}.xaos.${k}`);
          },
        });
        inp.el.title = `→xf${k + 1}: how likely xform ${k + 1} is picked as the NEXT xform right after THIS one fires. 1 = neutral, 0 = forbidden, >1 = favored.`;
        xaosWrap.appendChild(buildRow(`→xf${k + 1}`, inp.el));
      }
      body.appendChild(xaosWrap);
    }, 'xform.xaos'));
  }
}

export const xformsSection: SectionMount = {
  key: 'xforms',
  lens: 'xform',
  title: '🧬 XFORMS',

  build(host, state, onChange): void {
    ensureXformStyles();
    host.replaceChildren();

    // Clamp the regular selection into range (a prior flame may have had more
    // xforms). The final sentinel (-1) is left untouched.
    function clampSelection(): void {
      const n = state.genome.xforms.length;
      if (state.selectedXformIndex !== FINAL_SEL) {
        state.selectedXformIndex = Math.max(0, Math.min(state.selectedXformIndex, n - 1));
      } else if (state.genome.finalxform === undefined) {
        // Final selected but none exists (e.g. cleared) → fall back to xform 0.
        state.selectedXformIndex = 0;
      }
    }

    // The regular dropdown always reflects a valid regular index, even while
    // the final detail is showing (sentinel -1). Regular-bar ops act on this.
    const regIndex = (): number =>
      state.selectedXformIndex === FINAL_SEL ? 0 : state.selectedXformIndex;

    const selectorHost = document.createElement('div');
    selectorHost.className = 'pyr3-edit-xform-selectors';
    const detailHost = document.createElement('div');
    detailHost.className = 'pyr3-edit-xform-detail';
    host.append(selectorHost, detailHost);

    function rebuildDetail(): void {
      const sel = state.selectedXformIndex;
      if (sel === FINAL_SEL) {
        if (state.genome.finalxform) {
          buildXformDetail(detailHost, state, { kind: 'final' }, onChange, rebuildDetail);
        } else {
          detailHost.replaceChildren();
          const hint = document.createElement('div');
          hint.className = 'pyr3-edit-detail-hint';
          hint.textContent = 'No final xform. Toggle ⏻ to add one.';
          detailHost.appendChild(hint);
        }
      } else {
        buildXformDetail(detailHost, state, { kind: 'regular', index: sel }, onChange, rebuildDetail);
      }
    }

    function rebuildAll(): void {
      clampSelection();
      rebuildSelectors();
      rebuildDetail();
      // #350 Phase 2.3 — notify the on-canvas gizmo that the selected xform
      // (or the xform list) changed so it can redraw its live square/handles.
      document.dispatchEvent(new CustomEvent('pyr3:xform-selection-changed'));
    }

    function rebuildSelectors(): void {
      selectorHost.replaceChildren();
      const n = state.genome.xforms.length;
      const sel = state.selectedXformIndex;

      // ── Regular xform selector ──────────────────────────────────────
      selectorHost.appendChild(makeSelectorLabel('xform'));

      const selectWrap = document.createElement('div');
      selectWrap.className = 'pyr3-edit-select-wrap';
      const finalSelected = sel === FINAL_SEL;
      if (!finalSelected) selectWrap.classList.add('pyr3-edit-selected');
      const select = document.createElement('select');
      select.className = 'pyr3-edit-xform-select';
      // #374 — while the FINAL detail owns the selection, the regular <select>
      // must not pre-select a regular index. A native select fires no `change`
      // when the picked value equals the shown value, so if it claimed "xform 1"
      // the user couldn't re-pick xform 1 to switch back to it. A leading
      // placeholder owns the shown value instead, making EVERY regular pick a
      // genuine value change. The placeholder is disabled so it can't be chosen.
      if (finalSelected) {
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— pick an xform —';
        ph.disabled = true;
        ph.selected = true;
        select.appendChild(ph);
      }
      for (let i = 0; i < n; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `xform ${i + 1} · of ${n}`;
        if (!finalSelected && i === regIndex()) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        if (select.value === '') return; // placeholder — no selection change
        state.selectedXformIndex = Number(select.value);
        rebuildAll();
      });
      selectWrap.appendChild(select);
      selectorHost.appendChild(selectWrap);

      // ── Regular action bar ──────────────────────────────────────────
      const bar = document.createElement('div');
      bar.className = 'pyr3-edit-xform-bar';

      const cur = state.genome.xforms[regIndex()]!;
      const power = makePowerButton(
        cur.active !== false,
        () => {
          cur.active = cur.active === false ? undefined : false;
          onChange(`xforms.${regIndex()}.active`);
          rebuildAll();
        },
        () => soloXform(regIndex()),
      );
      power.classList.add('pyr3-edit-xform-active'); // legacy hook for solo tests
      bar.append(power, makeBarDiv());

      bar.appendChild(makeBarButton('＋', 'Add a new xform.', () => {
        state.selectedXformIndex = addXform(state.genome);
        onChange('xforms.add');
        rebuildAll();
      }));
      bar.appendChild(makeBarButton('🗑', 'Remove the selected xform.', () => {
        state.selectedXformIndex = removeXform(state.genome, regIndex());
        onChange('xforms.remove');
        rebuildAll();
      }, { disabled: n <= 1 }));
      bar.appendChild(makeBarButton('⧉', 'Duplicate the selected xform.', () => {
        state.selectedXformIndex = duplicateXform(state.genome, regIndex());
        onChange('xforms.duplicate');
        rebuildAll();
      }));

      const spacer = document.createElement('span');
      spacer.className = 'pyr3-edit-bar-spacer';
      bar.appendChild(spacer);

      bar.appendChild(makeBarButton('↑', 'Move the selected xform up.', () => {
        const i = regIndex();
        if (i <= 0) return;
        swapXforms(state.genome, i, i - 1);
        state.selectedXformIndex = i - 1;
        onChange('xforms.reorder');
        rebuildAll();
      }, { disabled: regIndex() <= 0 }));
      bar.appendChild(makeBarButton('↓', 'Move the selected xform down.', () => {
        const i = regIndex();
        if (i >= n - 1) return;
        swapXforms(state.genome, i, i + 1);
        state.selectedXformIndex = i + 1;
        onChange('xforms.reorder');
        rebuildAll();
      }, { disabled: regIndex() >= n - 1 }));

      selectorHost.appendChild(bar);

      // ── Final xform selector (always present) ───────────────────────
      selectorHost.appendChild(makeSelectorLabel('final xform'));

      const fx = state.genome.finalxform;
      const finalActive = fx !== undefined && fx.active !== false;
      const finalRow = document.createElement('div');
      finalRow.className = 'pyr3-edit-final-row';
      if (sel === FINAL_SEL) finalRow.classList.add('pyr3-edit-selected');
      if (!finalActive) finalRow.classList.add('pyr3-edit-final-dim');
      const finalLabel = document.createElement('span');
      finalLabel.className = 'pyr3-edit-final-label';
      finalLabel.textContent = '✨ final';
      finalRow.appendChild(finalLabel);
      if (fx === undefined) {
        const tag = document.createElement('span');
        tag.className = 'pyr3-edit-final-tag';
        tag.textContent = '(none)';
        finalRow.appendChild(tag);
      } else if (fx.active === false) {
        const tag = document.createElement('span');
        tag.className = 'pyr3-edit-final-tag';
        tag.textContent = '(inactive)';
        finalRow.appendChild(tag);
      }
      finalRow.title = 'The post-pick lens applied to every point after the chaos draw. Click to edit.';
      finalRow.addEventListener('click', () => {
        state.selectedXformIndex = FINAL_SEL;
        rebuildAll();
      });
      selectorHost.appendChild(finalRow);

      // Final action bar: ⏻ active · delimiter · 🗑 clear.
      const finalBar = document.createElement('div');
      finalBar.className = 'pyr3-edit-xform-bar';
      const finalPower = makePowerButton(finalActive, () => {
        if (state.genome.finalxform === undefined) {
          state.genome.finalxform = makeDefaultXform();
          state.selectedXformIndex = FINAL_SEL;
        } else {
          const f = state.genome.finalxform;
          f.active = f.active === false ? undefined : false;
        }
        onChange('finalxform.active');
        rebuildAll();
      });
      finalPower.classList.add('pyr3-edit-final-active');
      finalBar.append(finalPower, makeBarDiv());
      finalBar.appendChild(makeBarButton('🗑', 'Clear the final xform.', () => {
        state.genome.finalxform = undefined;
        if (state.selectedXformIndex === FINAL_SEL) state.selectedXformIndex = 0;
        onChange('finalxform.clear');
        rebuildAll();
      }, { disabled: fx === undefined }));
      selectorHost.appendChild(finalBar);
    }

    // Solo a regular xform (turn off all others), or restore from a prior solo.
    function soloXform(index: number): void {
      if (state.soloXformSnapshot && state.soloXformSnapshot.targetIndex === index) {
        restoreFromSolo(state.genome.xforms, state.soloXformSnapshot);
        state.soloXformSnapshot = undefined;
      } else {
        if (state.soloXformSnapshot) {
          restoreFromSolo(state.genome.xforms, state.soloXformSnapshot);
        }
        state.soloXformSnapshot = snapshotForSolo(state.genome.xforms, index);
        for (let i = 0; i < state.genome.xforms.length; i++) {
          if (i !== index) state.genome.xforms[i]!.active = false;
        }
        state.genome.xforms[index]!.active = undefined;
      }
      onChange(`xforms.${index}.solo`);
      rebuildAll();
    }

    clampSelection();
    rebuildSelectors();
    rebuildDetail();
  },
};

function makeSelectorLabel(text: string): HTMLDivElement {
  const lbl = document.createElement('div');
  lbl.className = 'pyr3-edit-selector-label';
  lbl.textContent = text;
  return lbl;
}

// One-time style injection for the xforms section. Idempotent so HMR + repeat
// mounts don't double-inject.
function ensureXformStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pyr3-edit-xforms-styles')) return;
  const style = document.createElement('style');
  style.id = 'pyr3-edit-xforms-styles';
  style.textContent = XFORM_CSS;
  document.head.appendChild(style);
}

const ACCENT = '#ff8c1a';

const XFORM_CSS = `
.pyr3-edit-xform-selectors { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.pyr3-edit-selector-label {
  color: var(--text-dim, #888);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 4px;
}
.pyr3-edit-select-wrap {
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 1px;
}
.pyr3-edit-select-wrap.pyr3-edit-selected { border-color: ${ACCENT}; box-shadow: 0 0 0 1px ${ACCENT}; }
.pyr3-edit-xform-select {
  width: 100%;
  background: var(--bar-bg-3, #0f0f13);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 3px 4px;
  font: inherit;
  font-size: 12px;
}
.pyr3-edit-xform-bar { display: flex; align-items: center; gap: 4px; }
.pyr3-edit-bar-spacer { flex: 1 1 auto; }
.pyr3-edit-bardiv {
  width: 1px;
  align-self: stretch;
  background: var(--bar-border, #2a2a30);
  margin: 2px 2px;
}
.pyr3-edit-bar-btn {
  min-width: 26px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bar-bg-2, #1a1a20);
  color: #cfcfd6;
  border: 1px solid #34343e;
  border-radius: 5px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 0 4px;
}
.pyr3-edit-bar-btn:hover:not(:disabled) {
  border-color: #55556a;
  background: #202028;
}
.pyr3-edit-bar-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pyr3-edit-power.on { color: #4ade80; border-color: #2f6f49; }
.pyr3-edit-power:not(.on) { color: var(--text-dim, #888); }
.pyr3-edit-final-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: var(--bar-bg-3, #0f0f13);
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
}
.pyr3-edit-final-row:hover { background: var(--accent-soft, rgba(255, 140, 26, 0.18)); }
.pyr3-edit-final-row.pyr3-edit-selected { border-color: ${ACCENT}; box-shadow: 0 0 0 1px ${ACCENT}; }
.pyr3-edit-final-row.pyr3-edit-final-dim { opacity: 0.5; }
.pyr3-edit-final-label { font-weight: 600; font-size: 12px; color: #ffd27a; }
.pyr3-edit-final-row.pyr3-edit-final-dim .pyr3-edit-final-label { color: var(--text-dim, #888); }
.pyr3-edit-final-tag { font-size: 10px; color: var(--text-dim, #888); }
.pyr3-edit-detail-header {
  font-weight: 600;
  font-size: 11px;
  color: var(--text, #ddd);
  margin: 2px 0 4px;
  padding-top: 6px;
  border-top: 1px solid var(--bar-border, #2a2a30);
}
.pyr3-edit-detail-hint {
  color: var(--text-dim, #888);
  font-size: 11px;
  padding: 12px 4px;
  text-align: center;
}
.pyr3-edit-xform-detail { display: flex; flex-direction: column; gap: 4px; }
/* Detail sub-accordions (#350 Phase 2.2). */
.pyr3-edit-accordion {
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 3px;
  overflow: hidden;
}
/* Sub-group separation: each accordion after the first (Affine) gets a
   group gap so the eye finds Variations / Color / Xaos boundaries (Q5). */
.pyr3-edit-accordion + .pyr3-edit-accordion { margin-top: var(--sp-group, 12px); }
/* Nested sub-section header (AFFINE/VARIATIONS/COLOR/XAOS). Tier-2 "nested"
   variant (#373) — heavier fill + crisp title + a thin NEUTRAL left-rule so it
   reads as a pressable bar while staying subordinate to the blue-ruled top
   section header (preserves the nesting hierarchy). See docs/ui-affordance-system.md. */
.pyr3-edit-accordion-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  cursor: pointer;
  user-select: none;
  background: #1c1c24;
  border-left: 2px solid #3a3a46;
}
.pyr3-edit-accordion-header:hover { background: var(--accent-soft, rgba(255, 140, 26, 0.18)); }
.pyr3-edit-accordion-chev { color: #aab; font-size: 10px; width: 10px; }
.pyr3-edit-accordion-title {
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #e6e6ea;
}
.pyr3-edit-accordion-body {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* Quick-ops strip + reset-to-identity button. */
.pyr3-edit-aff-quickops {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  margin-top: 3px;
}
.pyr3-edit-quickop {
  background: var(--bar-bg-2, #1a1a20);
  color: #cfcfd6;
  border: 1px solid #34343e;
  border-radius: 5px;
  padding: 3px 4px;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  text-align: center;
}
.pyr3-edit-quickop:hover {
  border-color: #55556a;
  background: #202028;
}
.pyr3-edit-aff-reset {
  margin-top: 6px;
  align-self: flex-start;
}
.pyr3-edit-field { display: flex; align-items: center; gap: 4px; }
.pyr3-edit-field-label { color: var(--text-dim, #888); font-size: 10px; }
.pyr3-edit-sublabel {
  color: var(--text-dim, #888);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 4px;
}
.pyr3-edit-num, .pyr3-edit-select {
  background: var(--bar-bg-3, #0f0f13);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 1px 4px;
  font: inherit;
  font-size: 11px;
}
/* #373 field affordance (decision B) — a 2px accent bottom-rule on every scrubby
   number box signals drag-to-edit and echoes the slider thumb's orange, so plain
   number boxes read as clearly editable (not static text). Brightens on focus/drag. */
.pyr3-edit-num { border-bottom: 2px solid var(--accent-border, #884a1a); }
.pyr3-edit-num:focus { border-bottom-color: var(--accent, #ff8c1a); outline: none; }
.pyr3-edit-num.pyr3-scrubby-dragging { border-bottom-color: var(--accent, #ff8c1a); }
.pyr3-edit-num:disabled { opacity: 0.4; }
.pyr3-edit-slider { flex: 1 1 auto; min-width: 80px; }
.pyr3-edit-checkbox { margin: 0 4px 0 0; }
.pyr3-edit-post-wrap { display: flex; flex-direction: column; gap: 3px; }
.pyr3-edit-var-header-row { display: flex; align-items: center; gap: 4px; }
.pyr3-edit-var-list { display: flex; flex-direction: column; gap: 3px; }
.pyr3-edit-var-row {
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 3px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pyr3-edit-var-header { display: flex; align-items: center; gap: 4px; }
.pyr3-edit-var-params { display: flex; flex-wrap: wrap; gap: 4px; }
.pyr3-edit-xaos-row { display: flex; flex-direction: column; gap: 4px; }
.pyr3-edit-icon-btn {
  background: var(--bar-bg-2, #1a1a20);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 1px 6px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.pyr3-edit-icon-btn:hover:not(:disabled) {
  background: var(--accent-soft, rgba(255, 140, 26, 0.18));
  border-color: var(--accent-border, #884a1a);
}
.pyr3-edit-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
/* "+ var" add-action — tinted accent-bar treatment so the primary "add a
   variation" action is clearly visible, not a faint outline (#373). Matches the
   Tier-4 accent family. */
.pyr3-edit-var-add {
  background: var(--accent-soft, rgba(255, 140, 26, 0.12));
  color: var(--accent, #ff8c1a);
  border: 1px solid var(--accent-border, #884a1a);
  border-radius: 5px;
  padding: 4px 12px;
  font-weight: 600;
}
.pyr3-edit-var-add:hover:not(:disabled) {
  background: var(--accent-soft, rgba(255, 140, 26, 0.2));
  border-color: var(--accent, #ff8c1a);
}
/* Variation-name pill (e.g. "horseshoe") — secondary tier (#373 button vocab).
   Was rendering with the UA-default button chrome (2px outset border); pin it to
   the canonical secondary look so it reads as a pressable workhorse control. */
.pyr3-edit-var-kind-btn {
  background: var(--bar-bg-2, #1a1a20);
  color: #cfcfd6;
  border: 1px solid #34343e;
  border-radius: 5px;
  padding: 2px 8px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pyr3-edit-var-kind-btn:hover {
  border-color: #55556a;
  background: #202028;
}
.pyr3-edit-aff-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}
.pyr3-edit-aff-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.pyr3-edit-aff-fields { display: flex; flex-direction: column; gap: 3px; flex: 1 1 auto; min-width: 0; }
/* Decomposed affine fields (scale x/y · rotation · position x/y) line up like
   the xaos rows (#373) — a [label][1fr input][unit] grid with full-width,
   right-aligned number boxes, instead of content-width boxes of varying width.
   Scoped to .pyr3-edit-aff-fields so the raw-matrix 3-col grid + variation
   params are untouched. Applies to both the pre- and post-affine blocks. */
.pyr3-edit-aff-fields .pyr3-edit-field {
  display: grid;
  /* Fixed unit column (14px) so the °-bearing rotation row's box is the same
     width as the unit-less rows — every box right-edge lines up. */
  grid-template-columns: 60px 1fr 14px;
  align-items: center;
  gap: 6px;
}
.pyr3-edit-aff-fields .pyr3-edit-num {
  width: 100%;
  box-sizing: border-box;
  text-align: right;
}
.pyr3-edit-aff-viz-col { flex: 0 0 auto; }
canvas.pyr3-edit-aff-viz {
  background: var(--bar-bg-3, #0f0f13);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  display: block;
  max-width: 100%;
  height: auto;
}
.pyr3-edit-unit { color: var(--text-dim, #888); font-size: 10px; margin-left: 2px; }
/* The shear + raw-matrix folds now route through buildExpander, so the shared
   pyr3-aff-expander accent-bar summary chrome (EDIT_CSS) governs their look —
   the old dim-10px summary override that lived here was dropped (decision Q1:
   uniform orange accent-bar across all sub-expanders, #373). */
.pyr3-edit-raw-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  margin-top: 3px;
}
`;
