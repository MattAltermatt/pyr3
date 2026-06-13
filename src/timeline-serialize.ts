// pyr3 JSON timeline doc (#227). Genomes are inlined via genomeToJson/
// genomeFromJson — the doc renders standalone. No flame-XML writer exists
// (and none is added here); timeline persistence is pyr3 JSON only.

import { genomeToJson, genomeFromJson } from './serialize';
import { FLAM3_ANIMATION_DEFAULTS } from './animation';
import { type Timeline, type Clip } from './timeline';

export const TIMELINE_FORMAT = 'pyr3-timeline';
export const TIMELINE_VERSION = 1;

export function timelineToJson(tl: Timeline): string {
  const doc = {
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    clips: tl.clips.map((c) => ({
      flame: {
        genome: genomeToJson(c.flame.genome),
        ...(c.flame.source ? { source: c.flame.source } : {}),
      },
      duration: c.duration,
      transitionDuration: c.transitionDuration,
      ...(c.easing ? { easing: c.easing } : {}),
      ...(c.permutation ? { permutation: c.permutation } : {}),
    })),
    interpolation: tl.interpolation,
    interpolation_type: tl.interpolation_type,
    palette_interpolation: tl.palette_interpolation,
    hsv_rgb_palette_blend: tl.hsv_rgb_palette_blend,
    ntemporal_samples: tl.ntemporal_samples,
    temporal_filter_type: tl.temporal_filter_type,
    temporal_filter_width: tl.temporal_filter_width,
    temporal_filter_exp: tl.temporal_filter_exp,
  };
  return JSON.stringify(doc, null, 2);
}

export function timelineFromJson(text: string): Timeline {
  const doc = JSON.parse(text) as Record<string, unknown>;
  if (doc.format !== TIMELINE_FORMAT) {
    throw new Error(`pyr3: not a timeline doc (format=${String(doc.format)})`);
  }
  if (doc.version !== TIMELINE_VERSION) {
    throw new Error(`pyr3: unsupported timeline version ${String(doc.version)}`);
  }
  const rawClips = doc.clips;
  if (!Array.isArray(rawClips) || rawClips.length < 1) {
    throw new Error('pyr3: timeline has no clips');
  }
  const clips: Clip[] = rawClips.map((c: any) => ({
    flame: {
      genome: genomeFromJson(c.flame.genome),
      ...(c.flame.source ? { source: c.flame.source } : {}),
    },
    duration: c.duration,
    transitionDuration: c.transitionDuration,
    ...(c.easing ? { easing: c.easing } : {}),
    ...(c.permutation ? { permutation: c.permutation } : {}),
  }));
  return {
    clips,
    interpolation:
      (doc.interpolation as Timeline['interpolation']) ?? FLAM3_ANIMATION_DEFAULTS.interpolation,
    interpolation_type:
      (doc.interpolation_type as Timeline['interpolation_type']) ??
      FLAM3_ANIMATION_DEFAULTS.interpolation_type,
    palette_interpolation:
      (doc.palette_interpolation as Timeline['palette_interpolation']) ??
      FLAM3_ANIMATION_DEFAULTS.palette_interpolation,
    hsv_rgb_palette_blend:
      (doc.hsv_rgb_palette_blend as number) ?? FLAM3_ANIMATION_DEFAULTS.hsv_rgb_palette_blend,
    ntemporal_samples:
      (doc.ntemporal_samples as number) ?? FLAM3_ANIMATION_DEFAULTS.ntemporal_samples,
    temporal_filter_type:
      (doc.temporal_filter_type as Timeline['temporal_filter_type']) ??
      FLAM3_ANIMATION_DEFAULTS.temporal_filter_type,
    temporal_filter_width:
      (doc.temporal_filter_width as number) ?? FLAM3_ANIMATION_DEFAULTS.temporal_filter_width,
    temporal_filter_exp:
      (doc.temporal_filter_exp as number) ?? FLAM3_ANIMATION_DEFAULTS.temporal_filter_exp,
  };
}
