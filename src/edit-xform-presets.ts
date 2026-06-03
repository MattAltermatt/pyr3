// pyr3 — /v1/edit shape presets.
//
// Eight quick-set buttons that overwrite the 5 decomposed affine fields.
// Position is preserved (the xform's "where it lives" stays put). Used
// by the "shape presets" fold-up in the affine block.

import { type DecomposedAffine } from './affine-decompose';

const RAD = Math.PI / 180;

/** Input to a preset: only the position survives. The other fields are
 *  set by the preset itself. */
export interface PresetInput {
  positionX: number;
  positionY: number;
}

export interface ShapePreset {
  /** Stable key for tests + localStorage. */
  key: string;
  /** Human-readable label shown on the button. */
  label: string;
  /** Apply this preset to the input, returning a full decomposed affine. */
  apply(input: PresetInput): DecomposedAffine;
}

function preset(key: string, label: string, override: Omit<DecomposedAffine, 'positionX' | 'positionY'>): ShapePreset {
  return {
    key,
    label,
    apply: (input) => ({ ...override, positionX: input.positionX, positionY: input.positionY }),
  };
}

export const SHAPE_PRESETS: readonly ShapePreset[] = [
  preset('identity',    'identity',    { scaleX: 1,  scaleY: 1,  rotation: 0,         shear: 0   }),
  preset('half-scale',  'half scale',  { scaleX: 0.5, scaleY: 0.5, rotation: 0,        shear: 0   }),
  preset('rotate-30',   'rotate 30°',  { scaleX: 1,  scaleY: 1,  rotation: 30 * RAD,  shear: 0   }),
  preset('rotate-45',   'rotate 45°',  { scaleX: 1,  scaleY: 1,  rotation: 45 * RAD,  shear: 0   }),
  preset('rotate-90',   'rotate 90°',  { scaleX: 1,  scaleY: 1,  rotation: 90 * RAD,  shear: 0   }),
  preset('flip-y',      'flip y',      { scaleX: 1,  scaleY: -1, rotation: 0,         shear: 0   }),
  preset('flip-x',      'flip x',      { scaleX: -1, scaleY: 1,  rotation: 0,         shear: 0   }),
  preset('shear-right', 'shear right', { scaleX: 1,  scaleY: 1,  rotation: 0,         shear: 0.5 }),
];
