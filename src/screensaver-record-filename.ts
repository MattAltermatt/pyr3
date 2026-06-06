// src/screensaver-record-filename.ts
import type { Genome } from './genome';
import type { SheepRef } from './gallery-mount';
import { hasTemplate, resolveTemplate, type TemplateContext } from './flame-name-template';

export interface RecordingFilenameContext {
  genome: Genome;
  ref?: SheepRef;
  now: Date;
}

const SUFFIX = '.pyr3.webm';
const UNSAFE = /[ /\\:<>"|?*]+/g;

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function stampMinutes(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function sanitize(s: string): string {
  return s.replace(UNSAFE, '-').replace(/^-+|-+$/g, '');
}

function fallback(now: Date): string {
  return `pyr3-${stampMinutes(now)}${SUFFIX}`;
}

export function deriveRecordingFilename(ctx: RecordingFilenameContext): string {
  // Case 1: ESF corpus flame.
  if (ctx.ref) {
    return `electricsheep.${ctx.ref.gen}.${ctx.ref.id}${SUFFIX}`;
  }

  const name = ctx.genome.name?.trim() ?? '';
  const nick = ctx.genome.nick?.trim() ?? '';

  // Case 2: template name.
  if (name && hasTemplate(name)) {
    const templateCtx: TemplateContext = {
      genome: ctx.genome,
      seed: 0,
      now: ctx.now,
      index: 1,
      random: '0000',
    };
    const resolved = sanitize(resolveTemplate(name, templateCtx));
    if (resolved) return `${resolved}${SUFFIX}`;
    return fallback(ctx.now);
  }

  // Case 3: plain name.
  if (name) {
    const clean = sanitize(name);
    if (clean) return `${clean}${SUFFIX}`;
    return fallback(ctx.now);
  }

  // Case 4: nick only.
  if (nick) {
    const clean = sanitize(nick);
    if (clean) return `${clean}${SUFFIX}`;
    return fallback(ctx.now);
  }

  // Case 5: fallback.
  return fallback(ctx.now);
}
