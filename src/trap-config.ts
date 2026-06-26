// #460 — trap-distance coloring: pure data types shared by the engine kernel
// (chaos.ts / renderer.ts / render-orchestrator.ts) and the FE preference layer
// (render-mode-config.ts).
//
// SEAM (#15): this module is intentionally DOM-free and GPU-free — no
// `window`/`document`/`localStorage`, no WebGPU imports — so the no-DOM engine
// tsconfig (tsconfig.engine.json, WebWorker lib) can pull it in. The engine may
// import this; the DOM config module (render-mode-config.ts) imports it too and
// layers the localStorage persistence on top. Do NOT add browser globals here.

export type TrapKind = 'point' | 'circle' | 'line';
export type TrapFalloffMode = 'glow' | 'rings';

/** Instantaneous distance-to-trap coloring params. A presentation pref, not a
 *  genome field. (NB: deliberately NOT min-over-orbit — see issue #460 / spec
 *  2026-06-25: that smears across the space-filling attractor.) */
export interface TrapConfig {
  kind: TrapKind;
  mode: TrapFalloffMode;
  cx: number;        // trap center x (genome space)
  cy: number;        // trap center y
  radius: number;    // circle radius (> 0)
  angle: number;     // line orientation, degrees (kernel normal = (-sinθ, cosθ))
  falloff: number;   // glow exp falloff (>= 0)
  freq: number;      // rings frequency (> 0)
  strength: number;  // blend over palette, [0, 1]
}

export const DEFAULT_TRAP_CONFIG: TrapConfig = {
  kind: 'point', mode: 'glow',
  cx: 0, cy: 0, radius: 0.5, angle: 0,
  falloff: 2.0, freq: 4.0, strength: 1.0,
};

const VALID_TRAP_KINDS: ReadonlyArray<TrapKind> = ['point', 'circle', 'line'];
const VALID_TRAP_MODES: ReadonlyArray<TrapFalloffMode> = ['glow', 'rings'];

/** Clamp/repair a possibly-malformed trap blob to a valid TrapConfig. A missing
 *  blob (e.g. a pre-#460 color-mode config) defaults to DEFAULT_TRAP_CONFIG, so
 *  no schema-version bump is needed. */
export function sanitizeTrap(o: unknown): TrapConfig {
  const d = DEFAULT_TRAP_CONFIG;
  const t = (o ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number) => (Number.isFinite(v) ? (v as number) : fb);
  const pos = (v: unknown, fb: number) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : fb);
  return {
    kind: VALID_TRAP_KINDS.includes(t['kind'] as TrapKind) ? (t['kind'] as TrapKind) : d.kind,
    mode: VALID_TRAP_MODES.includes(t['mode'] as TrapFalloffMode) ? (t['mode'] as TrapFalloffMode) : d.mode,
    cx: num(t['cx'], d.cx),
    cy: num(t['cy'], d.cy),
    radius: pos(t['radius'], d.radius),
    angle: num(t['angle'], d.angle),
    falloff: Number.isFinite(t['falloff']) && (t['falloff'] as number) >= 0 ? (t['falloff'] as number) : d.falloff,
    freq: pos(t['freq'], d.freq),
    strength: Math.min(1, Math.max(0, num(t['strength'], d.strength))),
  };
}
