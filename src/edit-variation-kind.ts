// Shared variation-kind logic for the editor's "pick a different variation"
// button (xforms section + final-xform section both use it). Centralises two
// param-lifecycle invariants that were previously open-coded — and buggy — in
// each caller:
//   #236 — a kind change must clear ALL param slots before stamping the new
//          kind's defaults, or stale param3..param9 from the old variation leak
//          (the packer + serializer read params positionally).
//   #237 — cancel / revert must restore the FULL pre-picker variation (index +
//          every param), not just the index — otherwise tuned params destroyed
//          by live previews are lost.
import { type Variation, type VariationIndex, VARIATION_NAMES } from './variations';
import { VARIATION_DEFAULTS, PARAM_KEYS } from './serialize';
import { openVariationPicker } from './edit-variation-picker';

type ParamBag = Record<string, number | undefined>;

/** Set `v`'s kind to `index`: clear every param slot, then stamp the new
 *  kind's default params. Mirrors `createVariation` (edit-seed.ts) but mutates
 *  in place so no stale slot survives the kind change (#236). */
export function applyVariationKind(v: Variation, index: VariationIndex): void {
  v.index = index;
  const bag = v as unknown as ParamBag;
  for (const pk of PARAM_KEYS) bag[pk] = undefined;
  const name = VARIATION_NAMES[index];
  const defaults = name ? VARIATION_DEFAULTS[name] : undefined;
  if (defaults) {
    for (let i = 0; i < defaults.length; i++) bag[`param${i}`] = defaults[i]!;
  }
}

/** Copy `snap`'s index + every param slot back onto `v` (#237). Slots absent
 *  from the snapshot are cleared so nothing from an intervening preview leaks. */
export function restoreVariation(v: Variation, snap: Variation): void {
  v.index = snap.index;
  const bag = v as unknown as ParamBag;
  const src = snap as unknown as ParamBag;
  for (const pk of PARAM_KEYS) bag[pk] = src[pk];
}

/** Wire a "change variation kind" button to the picker. Live previews apply
 *  leak-free kind changes (#236); cancel AND revert restore the exact variation
 *  the picker opened on (#237). `changePath` is the onChange path for this slot
 *  (e.g. `xforms.0.variations.1.index` or `finalxform.variations.1.index`). */
export function wireVariationKindButton(
  kindBtn: HTMLButtonElement,
  v: Variation,
  changePath: string,
  onChange: (path: string) => void,
): void {
  const syncLabel = () => {
    kindBtn.textContent = VARIATION_NAMES[v.index] ?? `var${v.index}`;
  };
  kindBtn.addEventListener('click', () => {
    const snapshot = structuredClone(v);
    const restore = () => {
      restoreVariation(v, snapshot);
      syncLabel();
      onChange(changePath);
    };
    openVariationPicker({
      host: document.body,
      initialIndex: v.index,
      onPreview: (idx) => {
        applyVariationKind(v, idx as VariationIndex);
        syncLabel();
        onChange(changePath);
      },
      onCommit: () => {
        // No-op; the live previews already wrote final state.
      },
      onCancel: restore,
      onRevert: restore,
    });
  });
}
