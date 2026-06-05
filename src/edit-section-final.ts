// pyr3 — /v1/edit final xform section.
//
// Final xform (finalxform) is flam3's post-pick lens: applied to every stored
// point AFTER the chaos pick (genome.ts:69-73). It carries the same Xform
// shape as a regular xform but `weight` is meaningless (it's not in the chaos
// draw) and `xaos` is N/A. The section UI:
//   - [checkbox] active — toggles `genome.finalxform = undefined` ↔ a default
//     identity finalxform.
//   - When active: the v2-style card — decomposed affine (+ mini viz + presets
//     + shear/raw fold-ups), picker-button variations chain, optional post-
//     transform (same decomposed UI shape), then COLOR (slider + colorSpeed
//     + opacity slider). No header bar, no weight, no duplicate/delete, no
//     collapse chevron, no xaos.
//
// Per-task constraint: we may NOT import from edit-section-xforms.ts. The
// card-building logic is inlined here even though it duplicates xform's
// equivalent. Future cleanup can extract the shared card helper once both
// sections stabilise; v1 keeps each section self-contained.

import { type EditState } from './edit-state';
import { type SectionMount } from './edit-ui';
import {
  type Variation,
  type VariationIndex,
  V,
  VARIATION_NAMES,
  MAX_VARIATIONS_PER_XFORM,
} from './variations';
import { VARIATION_PARAMS, PARAM_KEYS } from './serialize';
import { type Xform } from './genome';
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
import {
  scrubbyInput,
  type FieldKind,
  type ScrubbyHandle,
} from './edit-scrubby-input';
import {
  buildButton,
  buildToggle,
  buildRow,
  buildSlider,
  buildNumberInput,
  buildRemoveButton,
} from './edit-primitives';

function paramNamesFor(variationIndex: number): readonly string[] {
  const kindName = VARIATION_NAMES[variationIndex];
  if (kindName === undefined) return [];
  return VARIATION_PARAMS[kindName] ?? [];
}

function makeDefaultFinalxform(): Xform {
  return {
    a: 1, b: 0, c: 0, d: 0, e: 1, f: 0,
    weight: 1,
    color: 0.5,
    colorSpeed: 0.5,
    opacity: 1,
    variations: [{ index: V.linear as VariationIndex, weight: 1 }],
  };
}

function makeIdentityPost(): NonNullable<Xform['post']> {
  return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
}

function makeNumberInput(
  initial: number,
  commit: (val: number) => void,
  opts: {
    kind?: FieldKind;
    min?: number;
    max?: number;
    width?: string;
    format?: (v: number) => string;
  } = {},
): ScrubbyHandle {
  const handle = scrubbyInput({
    value: initial,
    onInput: commit,
    kind: opts.kind,
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
// raw fold) inside `parent`. Used by both pre- and post-affine on the
// finalxform. Mirrors edit-section-xforms.ts:buildDecomposedAffineBlock per
// the "do not import from xforms" constraint.
function buildDecomposedAffineBlock(
  parent: HTMLElement,
  fx: Xform,
  onChange: (path: string) => void,
  lens: AffineLens,
): void {
  const getRaw = (): RawAffine => {
    if (lens === 'pre') return { a: fx.a, b: fx.b, c: fx.c, d: fx.d, e: fx.e, f: fx.f };
    if (!fx.post) return { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    return { ...fx.post };
  };
  const setRaw = (r: RawAffine): void => {
    if (lens === 'pre') {
      fx.a = r.a; fx.b = r.b; fx.c = r.c;
      fx.d = r.d; fx.e = r.e; fx.f = r.f;
      return;
    }
    if (!fx.post) fx.post = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
    fx.post.a = r.a; fx.post.b = r.b; fx.post.c = r.c;
    fx.post.d = r.d; fx.post.e = r.e; fx.post.f = r.f;
  };
  const pathBase = lens === 'pre' ? `finalxform` : `finalxform.post`;

  const block = document.createElement('div');
  block.className =
    lens === 'pre'
      ? 'pyr3-edit-aff-block'
      : 'pyr3-edit-aff-block pyr3-edit-aff-post';
  parent.appendChild(block);

  // Top row: decomposed fields on left, mini viz on right. Folds (presets /
  // shear / raw matrix) stack below this row as siblings inside `block`.
  const topRow = document.createElement('div');
  topRow.className = 'pyr3-edit-aff-row';
  block.appendChild(topRow);

  const fieldsCol = document.createElement('div');
  fieldsCol.className = 'pyr3-edit-aff-fields';
  const vizCol = document.createElement('div');
  vizCol.className = 'pyr3-edit-aff-viz-col';
  const vizCanvas = document.createElement('canvas');
  vizCanvas.className = 'pyr3-edit-aff-viz';
  vizCanvas.width = 88;
  vizCanvas.height = 88;
  vizCol.appendChild(vizCanvas);
  topRow.append(fieldsCol, vizCol);

  const viz = attachXformViz(vizCanvas, getRaw);

  const RAD = Math.PI / 180;
  const initial = rawToDecomposed(getRaw());

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
    const displayInitial = field === 'rotation' ? initialValue / RAD : initialValue;
    const kind: FieldKind =
      field === 'rotation' ? 'rotation'
      : field === 'scaleX' || field === 'scaleY' ? 'scale'
      : 'position';
    const handle = scrubbyInput({
      value: displayInitial,
      kind,
      ariaLabel: label,
      format: field === 'rotation' ? (v) => v.toFixed(3) + '°' : undefined,
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
  // Mirrors the strip in edit-section-xforms.ts. The "do not import from
  // xforms" constraint in v1 was about NOT depending on the card
  // skeleton; quick-ops live in their own module (edit-xform-quickops.ts)
  // so both sections share the strip via that seam.
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

  viz.draw();
}

// Build one variation row inside the finalxform's variation list.
function buildVariationRow(
  fx: Xform,
  varIndex: number,
  onChange: (path: string) => void,
  removeSelf: () => void,
): HTMLDivElement {
  const v = fx.variations[varIndex]!;

  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-var-row';
  if (v.active === false) wrap.classList.add('pyr3-edit-var-inactive');

  const headerRow = document.createElement('div');
  headerRow.className = 'pyr3-edit-var-header';

  const activeCbx = document.createElement('input');
  activeCbx.type = 'checkbox';
  activeCbx.className = 'pyr3-edit-var-active';
  activeCbx.checked = v.active !== false;
  activeCbx.title = 'Click to toggle this variation.';
  activeCbx.addEventListener('click', () => {
    v.active = activeCbx.checked ? undefined : false;
    wrap.classList.toggle('pyr3-edit-var-inactive', v.active === false);
    onChange(`finalxform.variations.${varIndex}.active`);
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
        (v as unknown as Record<string, unknown>)['param0'] = undefined;
        (v as unknown as Record<string, unknown>)['param1'] = undefined;
        (v as unknown as Record<string, unknown>)['param2'] = undefined;
        kindBtn.textContent = VARIATION_NAMES[idx] ?? `var${idx}`;
        onChange(`finalxform.variations.${varIndex}.index`);
      },
      onCommit: () => {},
      onCancel: () => {
        v.index = initialIndex as Variation['index'];
        kindBtn.textContent = VARIATION_NAMES[initialIndex] ?? `var${initialIndex}`;
        onChange(`finalxform.variations.${varIndex}.index`);
      },
    });
  });

  const weightInput = makeNumberInput(
    v.weight,
    (n) => {
      v.weight = n;
      onChange(`finalxform.variations.${varIndex}.weight`);
    },
    { kind: 'weight', width: '64px' },
  );
  weightInput.el.title = "Strength of this variation's contribution.";
  weightInput.el.classList.add('pyr3-edit-var-weight');

  const delBtn = makeIconButton('🗑️', () => removeSelf());
  delBtn.title = 'Remove this variation from the chain.';

  headerRow.append(activeCbx, kindBtn, weightInput.el, delBtn);
  wrap.appendChild(headerRow);

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
          onChange(`finalxform.variations.${varIndex}.${paramKey}`);
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

function buildFinalxformCard(
  host: HTMLElement,
  fx: Xform,
  onChange: (path: string) => void,
  rebuildCard: () => void,
): void {
  host.replaceChildren();

  // ── 1. Affine (decomposed) ─────────────────────────────────────────
  host.appendChild(makeSectionLabel('affine'));
  buildDecomposedAffineBlock(host, fx, onChange, 'pre');

  // ── 2. Variations chain ────────────────────────────────────────────
  host.appendChild(makeSectionLabel('variations'));
  const varHeader = document.createElement('div');
  varHeader.className = 'pyr3-edit-var-header-row';
  const addVarBtn = makeIconButton('+ var', () => {
    if (fx.variations.length >= MAX_VARIATIONS_PER_XFORM) return;
    let inserted = false;
    openVariationPicker({
      host: document.body,
      initialIndex: V.linear,
      onPreview: (idx) => {
        if (!inserted) {
          fx.variations.push({ index: idx as Variation['index'], weight: 1 });
          inserted = true;
          rebuildCard();
        } else {
          fx.variations[fx.variations.length - 1]!.index =
            idx as Variation['index'];
          onChange(
            `finalxform.variations.${fx.variations.length - 1}.index`,
          );
        }
      },
      onCommit: () => {
        onChange(`finalxform.variations.added`);
      },
      onCancel: () => {
        if (inserted) {
          fx.variations.pop();
          rebuildCard();
        }
      },
    });
  });
  addVarBtn.classList.add('pyr3-edit-var-add');
  addVarBtn.title = 'Add a variation — opens the variation picker.';
  varHeader.appendChild(addVarBtn);
  host.appendChild(varHeader);

  const varList = document.createElement('div');
  varList.className = 'pyr3-edit-var-list';
  for (let j = 0; j < fx.variations.length; j++) {
    const row = buildVariationRow(fx, j, onChange, () => {
      if (fx.variations.length <= 1) return;
      fx.variations.splice(j, 1);
      onChange(`finalxform.variations.${j}.removed`);
      rebuildCard();
    });
    varList.appendChild(row);
  }
  host.appendChild(varList);

  // ── 3. Post-transform block (buildToggle + decomposed UI) ──────────
  const postWrap = document.createElement('div');
  postWrap.className = 'pyr3-edit-post-wrap';
  postWrap.appendChild(makeSectionLabel('post-transform'));

  const postBlockHost = document.createElement('div');
  postBlockHost.className = 'pyr3-edit-post-block-host';

  const mountPostBlock = (): void => {
    postBlockHost.replaceChildren();
    if (fx.post !== undefined) {
      buildDecomposedAffineBlock(postBlockHost, fx, onChange, 'post');
    }
  };

  const postToggle = buildToggle({
    value: fx.post !== undefined,
    onChange: (next) => {
      if (next) {
        fx.post = makeIdentityPost();
      } else {
        fx.post = undefined;
      }
      onChange('finalxform.post');
      mountPostBlock();
    },
  });
  postToggle.classList.add('pyr3-edit-post-toggle');
  postToggle.title = 'Apply a second affine AFTER the variation chain.';
  postWrap.appendChild(buildRow('use post-transform', postToggle));
  postWrap.appendChild(postBlockHost);
  mountPostBlock();
  host.appendChild(postWrap);

  // ── 4. Color block (buildRow + buildSlider) ────────────────────────
  host.appendChild(makeSectionLabel('color'));
  const colorSliderEl = buildSlider({
    value: fx.color,
    min: 0,
    max: 1,
    step: 0.001,
    onChange: (n) => {
      fx.color = n;
      onChange('finalxform.color');
    },
  });
  colorSliderEl.classList.add('pyr3-edit-color-slider');
  colorSliderEl.title = 'Where this xform pulls toward on the palette gradient.';
  host.appendChild(buildRow('color', colorSliderEl));

  const colorSpeedInput = buildNumberInput({
    value: fx.colorSpeed,
    kind: 'color',
    min: 0,
    max: 1,
    onChange: (n) => {
      fx.colorSpeed = n;
      onChange('finalxform.colorSpeed');
    },
  });
  colorSpeedInput.el.title = 'How fast each visit tugs the color toward its target.';
  colorSpeedInput.el.classList.add('pyr3-edit-color-speed');
  host.appendChild(buildRow('colorSpeed', colorSpeedInput.el));

  const opacitySliderEl = buildSlider({
    value: fx.opacity ?? 1,
    min: 0,
    max: 1,
    step: 0.001,
    onChange: (n) => {
      fx.opacity = n;
      onChange('finalxform.opacity');
    },
  });
  opacitySliderEl.classList.add('pyr3-edit-opacity-slider');
  opacitySliderEl.title = "Visibility of this xform's deposits.";
  host.appendChild(buildRow('opacity', opacitySliderEl));
}

export const finalSection: SectionMount = {
  key: 'final',
  title: '🔚 FINAL XFORM',
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void {
    host.replaceChildren();

    // ── active checkbox row (always at the top) ────────────────────────
    const headerRow = document.createElement('div');
    headerRow.className = 'pyr3-edit-row';
    const activeLabel = document.createElement('label');
    activeLabel.className = 'pyr3-edit-checklabel';
    const activeCheck = document.createElement('input');
    activeCheck.type = 'checkbox';
    activeCheck.checked = state.genome.finalxform !== undefined;
    activeLabel.append(activeCheck, document.createTextNode(' active'));
    headerRow.appendChild(activeLabel);
    host.appendChild(headerRow);

    // ── card host (filled when active, hidden when inactive) ───────────
    const card = document.createElement('div');
    card.className = 'pyr3-edit-final-card';
    card.style.display = state.genome.finalxform ? 'block' : 'none';
    host.appendChild(card);

    const refreshCard = (): void => {
      if (state.genome.finalxform) {
        card.style.display = 'block';
        buildFinalxformCard(card, state.genome.finalxform, onChange, refreshCard);
      } else {
        card.style.display = 'none';
        card.replaceChildren();
      }
    };
    refreshCard();

    activeCheck.addEventListener('change', () => {
      if (activeCheck.checked) {
        state.genome.finalxform = makeDefaultFinalxform();
      } else {
        state.genome.finalxform = undefined;
      }
      refreshCard();
      onChange('finalxform.active');
    });
  },
};
