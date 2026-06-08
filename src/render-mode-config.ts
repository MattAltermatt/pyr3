// #176 — workstation-pref preview render config.
//
// Two-config split: this module owns the preview side (tier + quality), which
// drives the editor's + viewer's live canvas. Persists per-browser per-origin
// via localStorage; not part of the genome / .pyr3.json / .flame XML.
//
// Render side (genome.size / genome.quality / oversample / filterRadius) lives
// on the genome and is unchanged by this module.
//
// Aspect ratio for the preview canvas always derives from genome.size — preview
// tier picks scale only. This guarantees WYSIWYG composition between editor
// preview and Save Render output (only fidelity differs, not crop).

export type PreviewTier = 'fast' | 'balanced' | 'sharp';

export interface PreviewRenderConfig {
  tier: PreviewTier;
  quality: number; // iter density target; clamped to [10, 50]
}

export const DEFAULT_PREVIEW_CONFIG: PreviewRenderConfig = {
  tier: 'balanced',
  quality: 30,
};

export const PREVIEW_TIER_LONGEST_EDGE: Record<PreviewTier, number> = {
  fast: 512,
  balanced: 1024,
  sharp: 1536,
};

const STORAGE_KEY = 'pyr3-preview-config';
const SCHEMA_VERSION = 1;

const VALID_TIERS: ReadonlyArray<PreviewTier> = ['fast', 'balanced', 'sharp'];

const PREVIEW_QUALITY_MIN = 10;
const PREVIEW_QUALITY_MAX = 50;

function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return DEFAULT_PREVIEW_CONFIG.quality;
  return Math.max(PREVIEW_QUALITY_MIN, Math.min(PREVIEW_QUALITY_MAX, Math.round(q)));
}

/** Resolve preview canvas dims from tier + render-side size.
 *
 *  Long edge of the preview is capped at the tier's longest-edge value
 *  (Fast=512 / Balanced=1024 / Sharp=1536). Aspect ratio is preserved from
 *  renderSize. If renderSize is already smaller than the cap, returns
 *  renderSize unchanged (never upscale).
 *
 *  Degenerate input (zero / negative / NaN dims) returns at least { 1, 1 }
 *  so downstream canvas resize never sees a zero. */
export function computePreviewDims(
  tier: PreviewTier,
  renderSize: { width: number; height: number },
): { width: number; height: number } {
  const w = Math.max(1, Math.floor(renderSize.width || 0));
  const h = Math.max(1, Math.floor(renderSize.height || 0));
  const longEdge = Math.max(w, h);
  const cap = PREVIEW_TIER_LONGEST_EDGE[tier];
  if (longEdge <= cap) return { width: w, height: h };
  const scale = cap / longEdge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Read PreviewRenderConfig from localStorage. Returns DEFAULT_PREVIEW_CONFIG
 *  on any failure (missing key, malformed JSON, schema-version mismatch,
 *  invalid tier value, etc). Quality is clamped to range. */
export function loadPreviewConfig(): PreviewRenderConfig {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return DEFAULT_PREVIEW_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREVIEW_CONFIG;
    const obj = parsed as Record<string, unknown>;
    if (obj._v !== SCHEMA_VERSION) return DEFAULT_PREVIEW_CONFIG;
    if (typeof obj.tier !== 'string' || !VALID_TIERS.includes(obj.tier as PreviewTier)) {
      return DEFAULT_PREVIEW_CONFIG;
    }
    return {
      tier: obj.tier as PreviewTier,
      quality: clampQuality(typeof obj.quality === 'number' ? obj.quality : NaN),
    };
  } catch (err) {
    console.warn('pyr3: loadPreviewConfig failed; falling back to defaults', err);
    return DEFAULT_PREVIEW_CONFIG;
  }
}

/** Persist PreviewRenderConfig to localStorage. Quality is clamped to range
 *  before write so a malformed program-supplied value is normalized at the
 *  storage boundary. Silently logs on quota-exceeded; no throw. */
export function savePreviewConfig(cfg: PreviewRenderConfig): void {
  try {
    const payload = {
      tier: cfg.tier,
      quality: clampQuality(cfg.quality),
      _v: SCHEMA_VERSION,
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('pyr3: savePreviewConfig failed (localStorage quota?)', err);
  }
}
