// pyr3 — /v1/edit Xforms section.
//
// Dense card-stack section: one collapsible card per xform with weight,
// color/colorSpeed/opacity, affine + optional post-affine, variation chain
// (kind dropdown + weight + per-kind named params), and xaos row. Plus
// `+ add` / per-card 🗑️ to grow/shrink the xform list.
//
// ALL edits route through `onChange` with `xforms.${i}.…` paths; pathLane()
// routes the entire `xforms.*` family to the slow lane (re-iterate + re-DE
// + present), so we don't need to think about lane assignment here.
//
// On add/remove we rebuild only the section body (the cheap re-render —
// 3-7 cards on a typical seed; no need for surgical DOM diffing).

import { type SectionMount } from './edit-ui';
import { type EditState, snapshotForSolo, restoreFromSolo } from './edit-state';
import { type Xform } from './genome';
import { type Variation, V, VARIATION_NAMES, MAX_VARIATIONS_PER_XFORM } from './variations';
import { VARIATION_PARAMS, PARAM_KEYS } from './serialize';
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
import { scrubbyInput, type FieldKind, type ScrubbyHandle } from './edit-scrubby-input';
import { buildButton, buildToggle, buildRemoveButton } from './edit-primitives';

// Per-variation param-slot keys, in stable index order. Names match the
// VARIATION_PARAMS schema; slot index = positional index into PARAM_KEYS.
// Variations missing from VARIATION_PARAMS are parameterless.
function paramNamesFor(variationIndex: number): readonly string[] {
  const kindName = VARIATION_NAMES[variationIndex];
  if (kindName === undefined) return [];
  return VARIATION_PARAMS[kindName] ?? [];
}

function makeDefaultXform(): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1,
    color: 0.5,
    colorSpeed: 0.5,
    opacity: 1,
    variations: [{ index: V.linear, weight: 1 }],
  };
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

function makeSliderInput(
  initial: number,
  commit: (val: number) => void,
  opts: { min: number; max: number; step?: number } = { min: 0, max: 1 },
): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.className = 'pyr3-edit-slider';
  inp.min = String(opts.min);
  inp.max = String(opts.max);
  inp.step = String(opts.step ?? 0.001);
  inp.value = String(initial);
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    if (Number.isFinite(n)) commit(n);
  });
  return inp;
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

// Build one variation row (active checkbox + kind picker-trigger button +
// weight + 🗑️ + per-kind param inputs). The param-row sub-container is
// rebuilt in place on kind change.
function buildVariationRow(
  state: EditState,
  xform: Xform,
  xformIndex: number,
  varIndex: number,
  onChange: (path: string) => void,
  removeSelf: () => void,
  rebuildSection?: () => void,
): HTMLDivElement {
  const v = xform.variations[varIndex]!;

  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-var-row';
  if (v.active === false) wrap.classList.add('pyr3-edit-var-inactive');

  const headerRow = document.createElement('div');
  headerRow.className = 'pyr3-edit-var-header';

  const activeCbx = document.createElement('input');
  activeCbx.type = 'checkbox';
  activeCbx.className = 'pyr3-edit-var-active';
  activeCbx.checked = v.active !== false;
  activeCbx.title = 'Click to toggle. Shift-click to solo within this xform.';
  activeCbx.addEventListener('click', (ev) => {
    const me = ev as MouseEvent;
    if (me.shiftKey) {
      me.preventDefault();
      me.stopPropagation();
      state.soloVariationSnapshot = state.soloVariationSnapshot ?? {};
      const existing = state.soloVariationSnapshot[xformIndex];
      if (existing && existing.targetIndex === varIndex) {
        restoreFromSolo(xform.variations, existing);
        delete state.soloVariationSnapshot[xformIndex];
      } else {
        if (existing) restoreFromSolo(xform.variations, existing);
        state.soloVariationSnapshot[xformIndex] = snapshotForSolo(xform.variations, varIndex);
        for (let i = 0; i < xform.variations.length; i++) {
          if (i !== varIndex) xform.variations[i]!.active = false;
        }
      }
      onChange(`xforms.${xformIndex}.variations.solo`);
      rebuildSection?.();
      return;
    }
    v.active = activeCbx.checked ? undefined : false;
    wrap.classList.toggle('pyr3-edit-var-inactive', v.active === false);
    onChange(`xforms.${xformIndex}.variations.${varIndex}.active`);
  });

  const kindBtn = document.createElement('button');
  kindBtn.type = 'button';
  kindBtn.className = 'pyr3-edit-var-kind-btn';
  kindBtn.textContent = VARIATION_NAMES[v.index] ?? `var${v.index}`;
  kindBtn.title = 'Click to pick a different variation kind.';
  kindBtn.addEventListener('click', () => {
    const initialIndex = v.index;
    openVariationPicker({
      host: document.body,
      initialIndex,
      onPreview: (idx) => {
        v.index = idx as Variation['index'];
        // Reset params on kind change.
        (v as unknown as Record<string, unknown>)['param0'] = undefined;
        (v as unknown as Record<string, unknown>)['param1'] = undefined;
        (v as unknown as Record<string, unknown>)['param2'] = undefined;
        kindBtn.textContent = VARIATION_NAMES[idx] ?? `var${idx}`;
        onChange(`xforms.${xformIndex}.variations.${varIndex}.index`);
      },
      onCommit: () => {
        // No-op; the live previews already wrote final state.
      },
      onCancel: () => {
        v.index = initialIndex as Variation['index'];
        kindBtn.textContent = VARIATION_NAMES[initialIndex] ?? `var${initialIndex}`;
        onChange(`xforms.${xformIndex}.variations.${varIndex}.index`);
      },
    });
  });

  const weightInput = makeNumberInput(
    v.weight,
    (n) => {
      v.weight = n;
      onChange(`xforms.${xformIndex}.variations.${varIndex}.weight`);
    },
    { kind: 'weight', width: '64px' },
  );
  weightInput.el.title = "Strength of this variation's contribution. The chain sums weighted contributions.";
  weightInput.el.classList.add('pyr3-edit-var-weight');

  const delBtn = makeIconButton('🗑️', () => removeSelf());
  delBtn.title = 'Remove this variation from the chain.';

  headerRow.append(activeCbx, kindBtn, weightInput.el, delBtn);
  wrap.appendChild(headerRow);

  // Param row — labels + inputs per VARIATION_PARAMS[kind]. Rebuilt on
  // kind change. Held in a dedicated child so we can replace just it.
  const paramRow = document.createElement('div');
  paramRow.className = 'pyr3-edit-var-params';
  wrap.appendChild(paramRow);

  const renderParams = (): void => {
    paramRow.replaceChildren();
    const names = paramNamesFor(v.index);
    for (let p = 0; p < names.length && p < MAX_VARIATIONS_PER_XFORM; p++) {
      const paramKey = PARAM_KEYS[p]!;
      const current = (v as unknown as Record<string, number | undefined>)[paramKey] ?? 0;
      const inp = makeNumberInput(
        current,
        (n) => {
          (v as unknown as Record<string, number>)[paramKey] = n;
          onChange(`xforms.${xformIndex}.variations.${varIndex}.${paramKey}`);
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

// Builds the decomposed-affine UI (5 fields + viz + presets + shear fold +
// raw fold) inside `parent`. Used by both pre- and post-affine. The
// genome's authoritative a..f stays the source of truth — the decomposed
// view recomposes on every edit.
function buildDecomposedAffineBlock(
  parent: HTMLElement,
  xform: Xform,
  xformIndex: number,
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
  const pathBase = lens === 'pre' ? `xforms.${xformIndex}` : `xforms.${xformIndex}.post`;

  // Container — stacks the fields-and-viz row above the three fold-ups
  // (shape presets, shear, raw matrix). Previously all five children sat
  // in one flex row; the fold-up summary labels clipped at panel width.
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
  // Mini viz canvas. Sized to fit the editor's 340px panel comfortably:
  // 88×88 intrinsic + 1px border ≈ 90px column → leaves ~210px for fields
  // even with a ~16px scrollbar. CSS keeps a max-width: 100% so further
  // panel shrinkage doesn't overflow.
  vizCanvas.width = 88;
  vizCanvas.height = 88;
  vizCol.appendChild(vizCanvas);
  topRow.append(fieldsCol, vizCol);

  const viz = attachXformViz(vizCanvas, getRaw);

  const RAD = Math.PI / 180;
  const initial = rawToDecomposed(getRaw());

  // Cache the 5 decomposed-field scrubby handles so preset clicks + raw-
  // matrix edits can refresh displayed values without re-triggering onInput.
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
    // Pick scrubby kind per field.
    const kind: FieldKind =
      field === 'rotation' ? 'rotation'
      : field === 'scaleX' || field === 'scaleY' ? 'scale'
      : 'position';
    const handle = scrubbyInput({
      value: displayInitial,
      kind,
      ariaLabel: label,
      onInput: (n) => {
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
  // Relative modifiers (rotate ±45° / scale ×2 ×½ / flip x / flip y /
  // shear +0.1) applied via applyQuickOp from edit-xform-quickops.ts.
  // The reset-to-identity is a separate accent button below — it's the
  // only absolute write left and is intentionally distinguished.
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
      const dec = rawToDecomposed(getRaw());
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
      setRaw(decomposedToRaw(nextDec));
      viz.draw();
      for (const f of ['scaleX', 'scaleY', 'rotation', 'positionX', 'positionY'] as const) {
        const h = decomposedInputs[f];
        if (!h) continue;
        const v = f === 'rotation' ? nextDec.rotation / RAD : nextDec[f];
        h.setValue(v);
      }
      if (shearHandle) shearHandle.setValue(nextDec.shear);
      if (shearFold && Math.abs(nextDec.shear) > 1e-9) shearFold.open = true;
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
  const shearFold = document.createElement('details');
  shearFold.className = 'pyr3-edit-aff-shear-fold';
  const shearSum = document.createElement('summary');
  shearSum.textContent = 'shear';
  shearFold.appendChild(shearSum);
  if (Math.abs(initial.shear) > 1e-9) shearFold.open = true;
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
      const dec = rawToDecomposed(getRaw());
      setRaw(decomposedToRaw({ ...dec, shear: n }));
      viz.draw();
      refreshRawInputs();
      onChange(`${pathBase}.shear`);
    },
  });
  shearHandle.el.title = AFFINE_TOOLTIPS.shear ?? '';
  shearWrap.append(shearLbl, shearHandle.el);
  shearFold.appendChild(shearWrap);
  block.appendChild(shearFold);

  // ── Raw matrix fold-up ────────────────────────────────────────────
  const rawFold = document.createElement('details');
  rawFold.className = 'pyr3-edit-aff-raw-fold';
  const rawSum = document.createElement('summary');
  rawSum.textContent = 'raw matrix';
  rawFold.appendChild(rawSum);
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
  rawFold.appendChild(rawGrid);
  block.appendChild(rawFold);

  function refreshRawInputs(): void {
    const raw = getRaw();
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      rawInputs[key]?.setValue(raw[key]);
    }
  }

  // Initial paint of the viz.
  viz.draw();
}

// Build one xform card (header + collapsible body). The card is the unit
// the section body re-renders on add/remove; the body within the card is
// the unit the per-xform collapse toggles.
function buildXformCard(
  state: EditState,
  xformIndex: number,
  onChange: (path: string) => void,
  rebuildSection: () => void,
): HTMLDivElement {
  const xform = state.genome.xforms[xformIndex]!;
  const totalXforms = state.genome.xforms.length;

  const card = document.createElement('div');
  card.className = 'pyr3-edit-xform-card';
  if (xform.active === false) card.classList.add('pyr3-edit-xform-inactive');

  // ── Header (always visible) ──────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'pyr3-edit-xform-header';

  const chev = document.createElement('span');
  chev.className = 'pyr3-edit-chev';
  const collapsed = state.xformCollapse[xformIndex] === true;
  chev.textContent = collapsed ? '▶' : '▼';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'pyr3-edit-xform-title';
  titleSpan.textContent = `xform ${xformIndex + 1}`;

  const weightLabel = document.createElement('span');
  weightLabel.className = 'pyr3-edit-field-label';
  weightLabel.textContent = ' · weight ';

  const weightInput = makeNumberInput(
    xform.weight,
    (n) => {
      xform.weight = n;
      onChange(`xforms.${xformIndex}.weight`);
    },
    { kind: 'weight', min: 0, width: '64px' },
  );
  weightInput.el.title = 'Relative chance this xform gets picked each chaos-game step. Higher = more contribution.';
  // Stop pointer interactions on the weight input from toggling collapse —
  // both `click` (dblclick → text mode) and `pointerdown` (start of a scrub
  // drag) need to be silenced so the card-header collapse listener never
  // sees them.
  weightInput.el.addEventListener('click', (e) => e.stopPropagation());
  weightInput.el.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ── Active toggle (pyr3-toggle pill; shift-click solos) ──────────────
  // buildToggle's internal click handler flips boolean state + calls
  // onChange(next). We intercept shift-click in the CAPTURE phase to drive
  // solo behavior before the toggle's own handler runs.
  const activeToggle = buildToggle({
    value: xform.active !== false,
    onChange: (next) => {
      xform.active = next ? undefined : false;
      card.classList.toggle('pyr3-edit-xform-inactive', xform.active === false);
      onChange(`xforms.${xformIndex}.active`);
    },
  });
  // Legacy compatibility class (#102 contract): keep `pyr3-edit-xform-active`
  // on the new toggle widget so existing tests + shift-click solo wiring
  // remain stable. Tests query by this class.
  activeToggle.classList.add('pyr3-edit-xform-active');
  activeToggle.title = 'Click to toggle this xform. Shift-click to solo (turn off all others).';
  // Don't propagate clicks up to the collapse-toggle handler on the header.
  activeToggle.addEventListener('click', (e) => e.stopPropagation());
  // Capture-phase shift-click → solo (intercept before buildToggle's listener).
  activeToggle.addEventListener('click', (ev) => {
    const me = ev as MouseEvent;
    if (!me.shiftKey) return;
    me.preventDefault();
    me.stopImmediatePropagation();
    if (state.soloXformSnapshot && state.soloXformSnapshot.targetIndex === xformIndex) {
      restoreFromSolo(state.genome.xforms, state.soloXformSnapshot);
      state.soloXformSnapshot = undefined;
    } else {
      if (state.soloXformSnapshot) {
        restoreFromSolo(state.genome.xforms, state.soloXformSnapshot);
      }
      state.soloXformSnapshot = snapshotForSolo(state.genome.xforms, xformIndex);
      for (let i = 0; i < state.genome.xforms.length; i++) {
        if (i !== xformIndex) state.genome.xforms[i]!.active = false;
      }
      xform.active = undefined;
    }
    onChange(`xforms.${xformIndex}.solo`);
    rebuildSection();
  }, true);

  // ── Duplicate icon (kept from v1; not in spec but shipped) ──
  const dupBtn = makeIconButton('⎘', () => {
    const clone: Xform = JSON.parse(JSON.stringify(xform));
    state.genome.xforms.splice(xformIndex + 1, 0, clone);
    onChange(`xforms.${xformIndex}.duplicated`);
    rebuildSection();
  });
  dupBtn.title = 'Clone this xform with the same affine, color, and variations.';
  dupBtn.classList.add('pyr3-edit-xform-dup');
  dupBtn.addEventListener('click', (e) => e.stopPropagation());

  // ── Remove × button (buildRemoveButton primitive) ──
  const removeBtn = buildRemoveButton({
    title: 'Remove this xform from the genome.',
    onClick: () => {
      if (state.genome.xforms.length <= 1) return;
      state.genome.xforms.splice(xformIndex, 1);
      // xaos arrays on the surviving xforms still index by destination;
      // splice them too so the row count stays in sync.
      for (const x of state.genome.xforms) {
        if (x.xaos) x.xaos.splice(xformIndex, 1);
      }
      onChange(`xforms.${xformIndex}.removed`);
      rebuildSection();
    },
  });
  removeBtn.classList.add('pyr3-edit-xform-del');
  // Dim + visually disable when only one xform remains (removing would
  // leave the genome empty).
  if (totalXforms <= 1) {
    removeBtn.style.opacity = '0.35';
    removeBtn.style.cursor = 'not-allowed';
    removeBtn.setAttribute('aria-disabled', 'true');
  }
  removeBtn.addEventListener('click', (e) => e.stopPropagation());

  header.append(chev, titleSpan, weightLabel, weightInput.el, activeToggle, dupBtn, removeBtn);
  card.appendChild(header);

  // ── Body (collapsible) ───────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'pyr3-edit-xform-body';
  body.style.display = collapsed ? 'none' : 'block';

  header.addEventListener('click', () => {
    const nowCollapsed = !state.xformCollapse[xformIndex];
    state.xformCollapse[xformIndex] = nowCollapsed;
    chev.textContent = nowCollapsed ? '▶' : '▼';
    body.style.display = nowCollapsed ? 'none' : 'block';
  });

  // Body section order (spec Decision 7): shape → math → color → mixing.
  //   1. Affine        — the xform's geometric core
  //   2. Variations    — the math chain that warps space after the affine
  //   3. Post-affine   — optional second affine, applied after variations
  //   4. Color         — color / colorSpeed / opacity (deposit properties)
  //   5. Xaos          — per-source mixing weights (only when totalXforms > 1)

  // ── 1. Affine (decomposed) ─────────────────────────────────────────
  body.appendChild(makeSectionLabel('affine'));
  buildDecomposedAffineBlock(body, xform, xformIndex, onChange, 'pre');

  // ── 3. Post-transform header sits below variations (see below). ────
  // (The post-transform block construction stays here so refs are in scope;
  //  we mount it into the body AFTER variations.)
  const postWrap = document.createElement('div');
  postWrap.className = 'pyr3-edit-post-wrap';
  // (post-transform header label is appended into the body below variations.)
  postWrap.appendChild(makeSectionLabel('post-transform'));

  const postCheckbox = document.createElement('input');
  postCheckbox.type = 'checkbox';
  postCheckbox.className = 'pyr3-edit-checkbox pyr3-edit-post-toggle';
  postCheckbox.checked = xform.post !== undefined;
  postCheckbox.title = 'Apply a second affine AFTER the variation chain.';
  postWrap.appendChild(makeLabeledField('use post-transform ', postCheckbox));

  // Container that mounts the decomposed post-block when active.
  const postBlockHost = document.createElement('div');
  postBlockHost.className = 'pyr3-edit-post-block-host';
  postWrap.appendChild(postBlockHost);

  function mountPostBlock(): void {
    postBlockHost.replaceChildren();
    if (xform.post !== undefined) {
      buildDecomposedAffineBlock(postBlockHost, xform, xformIndex, onChange, 'post');
    }
  }
  mountPostBlock();

  postCheckbox.addEventListener('change', () => {
    if (postCheckbox.checked) {
      xform.post = makeIdentityPost();
    } else {
      xform.post = undefined;
    }
    onChange(`xforms.${xformIndex}.post`);
    mountPostBlock();
  });

  // ── 2. Variations chain (before post per spec body order) ──────────
  body.appendChild(makeSectionLabel('variations'));
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
          xform.variations.push({ index: idx as Variation['index'], weight: 1 });
          inserted = true;
          rebuildSection();
        } else {
          xform.variations[xform.variations.length - 1]!.index =
            idx as Variation['index'];
          onChange(
            `xforms.${xformIndex}.variations.${xform.variations.length - 1}.index`,
          );
        }
      },
      onCommit: () => {
        onChange(`xforms.${xformIndex}.variations.added`);
      },
      onCancel: () => {
        if (inserted) {
          xform.variations.pop();
          rebuildSection();
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
    const row = buildVariationRow(state, xform, xformIndex, j, onChange, () => {
      if (xform.variations.length <= 1) return;
      xform.variations.splice(j, 1);
      onChange(`xforms.${xformIndex}.variations.${j}.removed`);
      rebuildSection();
    }, rebuildSection);
    varList.appendChild(row);
  }
  body.appendChild(varList);

  // ── 3. Post-affine (the postWrap was built above; append it here) ──
  body.appendChild(postWrap);

  // ── 4. Color block (color slider, colorSpeed, opacity slider) ──────
  body.appendChild(makeSectionLabel('color'));
  const colorSlider = makeSliderInput(
    xform.color,
    (n) => {
      xform.color = n;
      onChange(`xforms.${xformIndex}.color`);
    },
    { min: 0, max: 1, step: 0.001 },
  );
  colorSlider.title = 'Where this xform pulls toward on the palette gradient (0 = left, 1 = right).';
  colorSlider.classList.add('pyr3-edit-color-slider');
  body.appendChild(makeLabeledField('color ', colorSlider));

  const colorSpeedInput = makeNumberInput(
    xform.colorSpeed,
    (n) => {
      xform.colorSpeed = n;
      onChange(`xforms.${xformIndex}.colorSpeed`);
    },
    { kind: 'color', min: 0, max: 1, width: '64px' },
  );
  colorSpeedInput.el.title = 'How fast each visit tugs the color toward its target. 0 = ignore, 1 = snap.';
  colorSpeedInput.el.classList.add('pyr3-edit-color-speed');
  body.appendChild(makeLabeledField('colorSpeed ', colorSpeedInput.el));

  const opacitySlider = makeSliderInput(
    xform.opacity ?? 1,
    (n) => {
      xform.opacity = n;
      onChange(`xforms.${xformIndex}.opacity`);
    },
    { min: 0, max: 1, step: 0.001 },
  );
  opacitySlider.title = "Visibility of this xform's deposits. 0 = ghostly, 1 = full.";
  opacitySlider.classList.add('pyr3-edit-opacity-slider');
  body.appendChild(makeLabeledField('opacity ', opacitySlider));

  // ── 5. Xaos row — one number input per OTHER xform. ────────────────
  if (totalXforms > 1) {
    body.appendChild(makeSectionLabel('xaos →'));
    const xaosRow = document.createElement('div');
    xaosRow.className = 'pyr3-edit-xaos-row';
    for (let k = 0; k < totalXforms; k++) {
      const current = xform.xaos?.[k] ?? 1;
      const inp = makeNumberInput(
        current,
        (n) => {
          if (!xform.xaos) {
            xform.xaos = new Array<number>(totalXforms).fill(1);
          }
          // Grow if shorter than the destination index.
          while (xform.xaos.length <= k) xform.xaos.push(1);
          xform.xaos[k] = n;
          onChange(`xforms.${xformIndex}.xaos.${k}`);
        },
        { kind: 'weight', min: 0, width: '56px' },
      );
      inp.el.title = `Per-source bias: how likely THIS xform is picked AFTER xform ${k + 1}. 1 = neutral, 0 = forbidden.`;
      xaosRow.appendChild(makeLabeledField(`→xf${k + 1} `, inp.el));
    }
    body.appendChild(xaosRow);
  }

  card.appendChild(body);
  return card;
}

export const xformsSection: SectionMount = {
  key: 'xforms',
  title: '🧬 XFORMS',

  build(host, state, onChange): void {
    ensureXformStyles();
    host.replaceChildren();

    // Outer wrapper: header row (count + add) + card list. We rebuild only
    // the inner contents on add/remove so the section's own collapse state
    // (managed by mountEditUi) isn't perturbed.
    const headerRow = document.createElement('div');
    headerRow.className = 'pyr3-edit-xforms-header';

    const countLabel = document.createElement('span');
    countLabel.className = 'pyr3-edit-xforms-count';
    countLabel.textContent = `(${state.genome.xforms.length})`;

    const addBtn = makeIconButton('+ add', () => {
      state.genome.xforms.push(makeDefaultXform());
      // Grow xaos rows for existing xforms so their displayed length tracks
      // the new totalXforms — the GPU packer treats trailing missing entries
      // as 1.0 already, but the UI row count is read once at card build.
      onChange(`xforms.${state.genome.xforms.length - 1}.added`);
      rebuildSection();
    });

    headerRow.append(countLabel, addBtn);
    host.appendChild(headerRow);

    const cardList = document.createElement('div');
    cardList.className = 'pyr3-edit-xform-list';
    host.appendChild(cardList);

    function rebuildSection(): void {
      // Update the count label + card list in place; leave the section
      // collapse + outer header alone.
      countLabel.textContent = `(${state.genome.xforms.length})`;
      cardList.replaceChildren();
      for (let i = 0; i < state.genome.xforms.length; i++) {
        cardList.appendChild(buildXformCard(state, i, onChange, rebuildSection));
      }
    }

    rebuildSection();
  },
};

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

const XFORM_CSS = `
.pyr3-edit-xforms-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.pyr3-edit-xforms-count { color: var(--text-dim, #888); font-size: 11px; }
.pyr3-edit-xform-list { display: flex; flex-direction: column; gap: 4px; }
.pyr3-edit-xform-card {
  background: var(--bar-bg-2, #1a1a20);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 3px;
  overflow: hidden;
}
.pyr3-edit-xform-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  cursor: pointer;
  user-select: none;
  background: var(--bar-bg-3, #0f0f13);
}
.pyr3-edit-xform-header:hover { background: var(--accent-soft, rgba(255, 140, 26, 0.18)); }
.pyr3-edit-xform-title { font-weight: 600; font-size: 11px; }
.pyr3-edit-xform-body {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pyr3-edit-xform-inactive .pyr3-edit-xform-body {
  opacity: 0.4;
  pointer-events: none;
}
.pyr3-edit-xform-inactive .pyr3-edit-xform-header {
  background: repeating-linear-gradient(
    45deg,
    var(--bar-bg-3, #0f0f13),
    var(--bar-bg-3, #0f0f13) 4px,
    var(--bar-bg-2, #1a1a20) 4px,
    var(--bar-bg-2, #1a1a20) 8px
  );
}
/* Quick-ops strip + reset-to-identity button (Phase 8). */
.pyr3-edit-aff-quickops {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  margin-top: 3px;
}
.pyr3-edit-quickop {
  background: var(--bar-bg-2, #1a1a20);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 3px 4px;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  text-align: center;
}
.pyr3-edit-quickop:hover {
  background: var(--accent-soft, rgba(255, 140, 26, 0.18));
  border-color: var(--accent-border, #884a1a);
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
.pyr3-edit-affine-row {
  display: flex;
  gap: 4px;
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
.pyr3-edit-xaos-row { display: flex; flex-wrap: wrap; gap: 4px; }
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
.pyr3-edit-aff-presets details > summary,
.pyr3-edit-aff-shear-fold > summary,
.pyr3-edit-aff-raw-fold > summary {
  color: var(--text-dim, #888);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 0;
  user-select: none;
}
.pyr3-edit-preset-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  margin-top: 3px;
}
.pyr3-edit-preset {
  background: var(--bar-bg-2, #1a1a20);
  color: var(--text, #ddd);
  border: 1px solid var(--bar-border, #2a2a30);
  border-radius: 2px;
  padding: 2px 4px;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.pyr3-edit-preset:hover {
  background: var(--accent-soft, rgba(255, 140, 26, 0.18));
  border-color: var(--accent-border, #884a1a);
}
.pyr3-edit-raw-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  margin-top: 3px;
}
`;
