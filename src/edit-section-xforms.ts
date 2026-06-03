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
import { type EditState } from './edit-state';
import { type Xform } from './genome';
import { type Variation, V, VARIATION_NAMES, MAX_VARIATIONS_PER_XFORM } from './variations';
import { VARIATION_PARAMS, PARAM_KEYS } from './serialize';

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

// Numeric input that writes back via `commit(num)` on each `input` event.
// `step` controls the spinner granularity; `min`/`max` are optional clamps.
function makeNumberInput(
  initial: number,
  commit: (val: number) => void,
  opts: { step?: number; min?: number; max?: number; width?: string } = {},
): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'pyr3-edit-num';
  inp.value = String(initial);
  if (opts.step !== undefined) inp.step = String(opts.step);
  if (opts.min !== undefined) inp.min = String(opts.min);
  if (opts.max !== undefined) inp.max = String(opts.max);
  if (opts.width !== undefined) inp.style.width = opts.width;
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    if (Number.isFinite(n)) commit(n);
  });
  return inp;
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

// Build one variation row (kind select + weight + 🗑️ + per-kind param inputs).
// The param-row sub-container is rebuilt in place on kind change.
function buildVariationRow(
  xform: Xform,
  xformIndex: number,
  varIndex: number,
  onChange: (path: string) => void,
  removeSelf: () => void,
): HTMLDivElement {
  const v = xform.variations[varIndex]!;

  const wrap = document.createElement('div');
  wrap.className = 'pyr3-edit-var-row';

  const headerRow = document.createElement('div');
  headerRow.className = 'pyr3-edit-var-header';

  const select = document.createElement('select');
  select.className = 'pyr3-edit-select';
  const sortedNames = Object.entries(VARIATION_NAMES).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  for (const [idxStr, name] of sortedNames) {
    const opt = document.createElement('option');
    opt.value = idxStr;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = String(v.index);

  const weightInput = makeNumberInput(
    v.weight,
    (n) => {
      v.weight = n;
      onChange(`xforms.${xformIndex}.variations.${varIndex}.weight`);
    },
    { step: 0.01, width: '64px' },
  );

  const delBtn = makeIconButton('🗑️', () => removeSelf());

  headerRow.append(select, weightInput, delBtn);
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
        { step: 0.01, width: '56px' },
      );
      const field = makeLabeledField(`${names[p]!} `, inp);
      paramRow.appendChild(field);
    }
  };
  renderParams();

  select.addEventListener('change', () => {
    const newIdx = Number(select.value) as Variation['index'];
    v.index = newIdx;
    onChange(`xforms.${xformIndex}.variations.${varIndex}.index`);
    renderParams();
  });

  return wrap;
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
    { step: 0.01, width: '64px' },
  );
  // Stop click on the weight input from toggling collapse.
  weightInput.addEventListener('click', (e) => e.stopPropagation());

  const delBtn = makeIconButton('🗑️', () => {
    if (state.genome.xforms.length <= 1) return;
    state.genome.xforms.splice(xformIndex, 1);
    // xaos arrays on the surviving xforms still index by destination;
    // splice them too so the row count stays in sync.
    for (const x of state.genome.xforms) {
      if (x.xaos) x.xaos.splice(xformIndex, 1);
    }
    onChange(`xforms.${xformIndex}.removed`);
    rebuildSection();
  });
  delBtn.disabled = totalXforms <= 1;
  delBtn.addEventListener('click', (e) => e.stopPropagation());

  header.append(chev, titleSpan, weightLabel, weightInput, delBtn);
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

  // color slider + label
  const colorSlider = makeSliderInput(
    xform.color,
    (n) => {
      xform.color = n;
      onChange(`xforms.${xformIndex}.color`);
    },
    { min: 0, max: 1, step: 0.001 },
  );
  body.appendChild(makeLabeledField('color ', colorSlider));

  // colorSpeed number
  const colorSpeedInput = makeNumberInput(
    xform.colorSpeed,
    (n) => {
      xform.colorSpeed = n;
      onChange(`xforms.${xformIndex}.colorSpeed`);
    },
    { step: 0.01, width: '64px' },
  );
  body.appendChild(makeLabeledField('colorSpeed ', colorSpeedInput));

  // opacity slider
  const opacitySlider = makeSliderInput(
    xform.opacity ?? 1,
    (n) => {
      xform.opacity = n;
      onChange(`xforms.${xformIndex}.opacity`);
    },
    { min: 0, max: 1, step: 0.001 },
  );
  body.appendChild(makeLabeledField('opacity ', opacitySlider));

  // affine label + 2 rows of 3 inputs (a b c / d e f).
  body.appendChild(makeSectionLabel('affine'));
  const affineRow1 = document.createElement('div');
  affineRow1.className = 'pyr3-edit-affine-row';
  for (const key of ['a', 'b', 'c'] as const) {
    const inp = makeNumberInput(
      xform[key],
      (n) => {
        xform[key] = n;
        onChange(`xforms.${xformIndex}.${key}`);
      },
      { step: 0.01, width: '64px' },
    );
    affineRow1.appendChild(makeLabeledField(`${key} `, inp));
  }
  body.appendChild(affineRow1);

  const affineRow2 = document.createElement('div');
  affineRow2.className = 'pyr3-edit-affine-row';
  for (const key of ['d', 'e', 'f'] as const) {
    const inp = makeNumberInput(
      xform[key],
      (n) => {
        xform[key] = n;
        onChange(`xforms.${xformIndex}.${key}`);
      },
      { step: 0.01, width: '64px' },
    );
    affineRow2.appendChild(makeLabeledField(`${key} `, inp));
  }
  body.appendChild(affineRow2);

  // post-transform checkbox + 6 inputs (disabled when checkbox off).
  body.appendChild(makeSectionLabel('post-transform'));
  const postWrap = document.createElement('div');
  postWrap.className = 'pyr3-edit-post-wrap';

  const postCheckbox = document.createElement('input');
  postCheckbox.type = 'checkbox';
  postCheckbox.className = 'pyr3-edit-checkbox';
  postCheckbox.checked = xform.post !== undefined;
  postWrap.appendChild(makeLabeledField('active ', postCheckbox));

  // Two rows of 3 post inputs.
  const postRow1 = document.createElement('div');
  postRow1.className = 'pyr3-edit-affine-row';
  const postRow2 = document.createElement('div');
  postRow2.className = 'pyr3-edit-affine-row';

  const postKeyOrder: Array<'a' | 'b' | 'c' | 'd' | 'e' | 'f'> = ['a', 'b', 'c', 'd', 'e', 'f'];
  const postInputs: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', HTMLInputElement> = {} as Record<
    'a' | 'b' | 'c' | 'd' | 'e' | 'f',
    HTMLInputElement
  >;

  for (const key of postKeyOrder) {
    const initial = xform.post ? xform.post[key] : (key === 'a' || key === 'e' ? 1 : 0);
    const inp = makeNumberInput(
      initial,
      (n) => {
        if (!xform.post) return; // disabled commits are no-ops
        xform.post[key] = n;
        onChange(`xforms.${xformIndex}.post.${key}`);
      },
      { step: 0.01, width: '64px' },
    );
    inp.disabled = !postCheckbox.checked;
    postInputs[key] = inp;
    const target = (key === 'a' || key === 'b' || key === 'c') ? postRow1 : postRow2;
    target.appendChild(makeLabeledField(`${key} `, inp));
  }
  postWrap.appendChild(postRow1);
  postWrap.appendChild(postRow2);

  postCheckbox.addEventListener('change', () => {
    if (postCheckbox.checked) {
      xform.post = makeIdentityPost();
      for (const key of postKeyOrder) {
        postInputs[key].disabled = false;
        postInputs[key].value = String(xform.post[key]);
      }
    } else {
      xform.post = undefined;
      for (const key of postKeyOrder) {
        postInputs[key].disabled = true;
      }
    }
    // Conventionally one path per toggle — the importer-side cares about
    // identity-or-undefined, not per-component. Use `.post` as the path.
    onChange(`xforms.${xformIndex}.post`);
  });

  body.appendChild(postWrap);

  // variations label + add button + list of variation rows.
  body.appendChild(makeSectionLabel('variations'));
  const varHeader = document.createElement('div');
  varHeader.className = 'pyr3-edit-var-header-row';
  const addVarBtn = makeIconButton('+ var', () => {
    if (xform.variations.length >= MAX_VARIATIONS_PER_XFORM) return;
    xform.variations.push({ index: V.linear, weight: 1 });
    onChange(`xforms.${xformIndex}.variations.${xform.variations.length - 1}.added`);
    rebuildSection();
  });
  varHeader.appendChild(addVarBtn);
  body.appendChild(varHeader);

  const varList = document.createElement('div');
  varList.className = 'pyr3-edit-var-list';
  for (let j = 0; j < xform.variations.length; j++) {
    const row = buildVariationRow(xform, xformIndex, j, onChange, () => {
      if (xform.variations.length <= 1) return;
      xform.variations.splice(j, 1);
      onChange(`xforms.${xformIndex}.variations.${j}.removed`);
      rebuildSection();
    });
    varList.appendChild(row);
  }
  body.appendChild(varList);

  // xaos row — one number input per OTHER xform.
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
        { step: 0.01, min: 0, width: '56px' },
      );
      xaosRow.appendChild(makeLabeledField(`→xf${k + 1} `, inp));
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
`;
