// src/screensaver-record-filename.test.ts
import { describe, it, expect } from 'vitest';
import { deriveRecordingFilename } from './screensaver-record-filename';
import type { Genome } from './genome';
import type { SheepRef } from './gallery-mount';

const PIN = new Date(2026, 5, 5, 16, 24); // June 5 2026 16:24 — local time
function blankGenome(over: Partial<Genome> = {}): Genome {
  return {
    xforms: [],
    palette: { name: 'default', stops: [] },
    name: '',
    nick: '',
    ...over,
  } as Genome;
}

describe('deriveRecordingFilename', () => {
  it('case 1: ESF flame with corpus ref → electricsheep.<gen>.<id>.pyr3.webm', () => {
    const ref: SheepRef = { gen: 247, id: 19679 };
    const out = deriveRecordingFilename({ genome: blankGenome(), ref, now: PIN });
    expect(out).toBe('electricsheep.247.19679.pyr3.webm');
  });

  it('case 2: name is a template → resolved + .pyr3.webm', () => {
    const g = blankGenome({
      name: '{palette}-{date}',
      palette: { name: 'south-sea-bather', stops: [] },
    } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('south-sea-bather-20260605.pyr3.webm');
  });

  it('case 3: plain name (non-empty), no template → name.pyr3.webm', () => {
    const g = blankGenome({ name: 'My Cool Flame' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('My-Cool-Flame.pyr3.webm');
  });

  it('case 4: only nick set → nick.pyr3.webm', () => {
    const g = blankGenome({ nick: 'sheep_walker' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('sheep_walker.pyr3.webm');
  });

  it('case 5: nothing set → pyr3-<YYYYMMDD-HHMM>.pyr3.webm', () => {
    const out = deriveRecordingFilename({ genome: blankGenome(), now: PIN });
    expect(out).toBe('pyr3-20260605-1624.pyr3.webm');
  });

  it('case 1 takes precedence over name/nick when ref is provided', () => {
    const g = blankGenome({ name: 'override', nick: 'override-nick' } as Partial<Genome>);
    const ref: SheepRef = { gen: 248, id: 23554 };
    const out = deriveRecordingFilename({ genome: g, ref, now: PIN });
    expect(out).toBe('electricsheep.248.23554.pyr3.webm');
  });

  it('sanitizes path-unsafe characters', () => {
    const g = blankGenome({ name: 'evil/name:with*bad?chars' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('evil-name-with-bad-chars.pyr3.webm');
  });

  it('falls through to fallback when sanitized name is empty', () => {
    const g = blankGenome({ name: '???' } as Partial<Genome>);
    const out = deriveRecordingFilename({ genome: g, now: PIN });
    expect(out).toBe('pyr3-20260605-1624.pyr3.webm');
  });
});
