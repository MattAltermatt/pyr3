// pyr3 — /v1/edit final xform section.
//
// Final xform (finalxform) is flam3's post-pick lens: applied to every stored
// point AFTER the chaos pick (genome.ts:69-73). It carries the same Xform
// shape as a regular xform but `weight` is meaningless (it's not in the chaos
// draw) and `xaos` is N/A. The section UI:
//   - [checkbox] active — toggles `genome.finalxform = undefined` ↔ a default
//     `{a:1,b:0,c:0,d:0,e:1,f:0, weight:1, color:0.5, colorSpeed:0.5,
//     opacity:1, variations:[{index:linear, weight:1}]}` (weight kept for
//     shape compat though ignored at chaos time).
//   - When active: the same card structure as a regular xform — color slider,
//     colorSpeed input, opacity slider, 6-cell affine grid, post-affine toggle
//     + 6 inputs, variations list — but no weight input and no xaos row.
//
// Per-task constraint: we may NOT import from edit-section-xforms.ts. The
// card-building logic is inlined here even though it duplicates xform's
// equivalent. Future cleanup can extract the shared card helper once both
// sections stabilise; v1 keeps each section self-contained.

import { type EditState } from './edit-state';
import { type SectionMount } from './edit-ui';
import { type Variation, type VariationIndex, V, VARIATION_NAMES, MAX_VARIATIONS_PER_XFORM } from './variations';
import { VARIATION_PARAMS, PARAM_KEYS } from './serialize';
import { type Xform } from './genome';
import { scrubbyInput, type FieldKind, type ScrubbyHandle } from './edit-scrubby-input';

const ALL_VARIATION_INDICES: number[] = Object.values(V).sort((a, b) => a - b);

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

function num(
  value: number,
  onInput: (v: number) => void,
  opts: { kind?: FieldKind; min?: number; max?: number } = {},
): ScrubbyHandle {
  return scrubbyInput({
    value,
    onInput,
    kind: opts.kind,
    min: opts.min,
    max: opts.max,
  });
}

function slider(
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.className = 'pyr3-edit-slider';
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onInput(v);
  });
  return input;
}

function labeledRow(label: string, control: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'pyr3-edit-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'pyr3-edit-label';
  labelEl.textContent = label;
  row.append(labelEl, control);
  return row;
}

function buildFinalxformCard(
  host: HTMLElement,
  fx: Xform,
  onChange: (path: string) => void,
): void {
  host.replaceChildren();

  // ── color slider ─────────────────────────────────────────────────────
  host.appendChild(labeledRow('color', slider(fx.color, 0, 1, 0.001, (v) => {
    fx.color = v;
    onChange('finalxform.color');
  })));

  // ── colorSpeed number ────────────────────────────────────────────────
  host.appendChild(labeledRow('colorSpeed', num(fx.colorSpeed, (v) => {
    fx.colorSpeed = v;
    onChange('finalxform.colorSpeed');
  }, { kind: 'color', min: 0, max: 1 }).el));

  // ── opacity slider ───────────────────────────────────────────────────
  host.appendChild(labeledRow('opacity', slider(fx.opacity ?? 1, 0, 1, 0.001, (v) => {
    fx.opacity = v;
    onChange('finalxform.opacity');
  })));

  // ── affine pre (a b c / d e f) ───────────────────────────────────────
  const affineLabel = document.createElement('div');
  affineLabel.className = 'pyr3-edit-sublabel';
  affineLabel.textContent = 'affine';
  host.appendChild(affineLabel);

  const affineGrid = document.createElement('div');
  affineGrid.className = 'pyr3-edit-affine';
  const affineKeys: Array<'a' | 'b' | 'c' | 'd' | 'e' | 'f'> = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const k of affineKeys) {
    const wrap = document.createElement('label');
    wrap.className = 'pyr3-edit-affine-cell';
    const span = document.createElement('span');
    span.textContent = k;
    const input = num(fx[k], (v) => {
      fx[k] = v;
      onChange(`finalxform.${k}`);
    }, { kind: 'position' });
    wrap.append(span, input.el);
    affineGrid.appendChild(wrap);
  }
  host.appendChild(affineGrid);

  // ── post-affine toggle + 6 inputs ────────────────────────────────────
  const postRow = document.createElement('div');
  postRow.className = 'pyr3-edit-row';
  const postLabel = document.createElement('label');
  postLabel.className = 'pyr3-edit-checklabel';
  const postCheck = document.createElement('input');
  postCheck.type = 'checkbox';
  postCheck.checked = fx.post !== undefined;
  postLabel.append(postCheck, document.createTextNode(' post-transform'));
  postRow.appendChild(postLabel);
  host.appendChild(postRow);

  const postGrid = document.createElement('div');
  postGrid.className = 'pyr3-edit-affine';
  postGrid.style.display = fx.post ? 'grid' : 'none';

  const buildPostGrid = (): void => {
    postGrid.replaceChildren();
    if (!fx.post) return;
    for (const k of affineKeys) {
      const wrap = document.createElement('label');
      wrap.className = 'pyr3-edit-affine-cell';
      const span = document.createElement('span');
      span.textContent = k;
      const input = num(fx.post[k], (v) => {
        if (!fx.post) return;
        fx.post[k] = v;
        onChange(`finalxform.post.${k}`);
      }, { kind: 'position' });
      wrap.append(span, input.el);
      postGrid.appendChild(wrap);
    }
  };
  buildPostGrid();
  host.appendChild(postGrid);

  postCheck.addEventListener('change', () => {
    if (postCheck.checked) {
      fx.post = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };
      postGrid.style.display = 'grid';
    } else {
      fx.post = undefined;
      postGrid.style.display = 'none';
    }
    buildPostGrid();
    onChange('finalxform.post');
  });

  // ── variations list ──────────────────────────────────────────────────
  const varsLabel = document.createElement('div');
  varsLabel.className = 'pyr3-edit-sublabel';
  varsLabel.textContent = 'variations';
  host.appendChild(varsLabel);

  const varsList = document.createElement('div');
  varsList.className = 'pyr3-edit-vars';
  host.appendChild(varsList);

  const rebuildVarsList = (): void => {
    varsList.replaceChildren();
    for (let j = 0; j < fx.variations.length; j++) {
      const v = fx.variations[j]!;
      const row = document.createElement('div');
      row.className = 'pyr3-edit-var';

      // kind dropdown
      const kindSel = document.createElement('select');
      kindSel.className = 'pyr3-edit-var-kind';
      for (const idx of ALL_VARIATION_INDICES) {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = VARIATION_NAMES[idx] ?? `var${idx}`;
        kindSel.appendChild(opt);
      }
      kindSel.value = String(v.index);
      const captureJ = j;
      kindSel.addEventListener('change', () => {
        const newIdx = parseInt(kindSel.value, 10);
        if (Number.isFinite(newIdx)) {
          v.index = newIdx as VariationIndex;
          onChange(`finalxform.variations.${captureJ}.index`);
          rebuildVarsList();
        }
      });
      row.appendChild(kindSel);

      // weight (per-variation weight; allowed on finalxform)
      const w = num(v.weight, (val) => {
        v.weight = val;
        onChange(`finalxform.variations.${captureJ}.weight`);
      }, { kind: 'weight' });
      w.el.classList.add('pyr3-edit-var-weight');
      row.appendChild(w.el);

      // delete button
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '🗑️';
      del.className = 'pyr3-edit-btn';
      del.addEventListener('click', () => {
        fx.variations.splice(captureJ, 1);
        if (fx.variations.length === 0) {
          // Keep at least one — restore linear to avoid an empty chain.
          fx.variations.push({ index: V.linear as VariationIndex, weight: 1 });
        }
        onChange(`finalxform.variations.${captureJ}`);
        rebuildVarsList();
      });
      row.appendChild(del);

      // per-variation param inputs (only the ones used by this kind)
      const kindName = VARIATION_NAMES[v.index] ?? '';
      const paramNames = VARIATION_PARAMS[kindName] ?? [];
      if (paramNames.length > 0) {
        const paramsWrap = document.createElement('div');
        paramsWrap.className = 'pyr3-edit-var-params';
        const nParams = Math.min(paramNames.length, PARAM_KEYS.length);
        for (let p = 0; p < nParams; p++) {
          const pname = paramNames[p]!;
          const pkey = PARAM_KEYS[p]!;
          const current = (v[pkey] as number | undefined) ?? 0;
          const pwrap = document.createElement('label');
          pwrap.className = 'pyr3-edit-var-param';
          const pl = document.createElement('span');
          pl.textContent = pname;
          const pi = num(current, (val) => {
            (v as unknown as Record<string, number>)[pkey] = val;
            onChange(`finalxform.variations.${captureJ}.${pkey}`);
          }, { kind: 'generic' });
          pwrap.append(pl, pi.el);
          paramsWrap.appendChild(pwrap);
        }
        row.appendChild(paramsWrap);
      }

      varsList.appendChild(row);
    }
  };
  rebuildVarsList();

  // ── + var button ─────────────────────────────────────────────────────
  const addVar = document.createElement('button');
  addVar.type = 'button';
  addVar.textContent = '+ var';
  addVar.className = 'pyr3-edit-btn';
  addVar.addEventListener('click', () => {
    if (fx.variations.length >= MAX_VARIATIONS_PER_XFORM) return;
    const newVar: Variation = { index: V.linear as VariationIndex, weight: 1 };
    fx.variations.push(newVar);
    onChange(`finalxform.variations.${fx.variations.length - 1}`);
    rebuildVarsList();
  });
  host.appendChild(addVar);
}

export const finalSection: SectionMount = {
  key: 'final',
  title: '🔚 FINAL XFORM',
  build(host: HTMLElement, state: EditState, onChange: (path: string) => void): void {
    host.replaceChildren();

    // ── active checkbox row ────────────────────────────────────────────
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
        buildFinalxformCard(card, state.genome.finalxform, onChange);
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
