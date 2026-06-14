import { describe, expect, it } from 'vitest';
import { formatDuration, formatFinishTime } from './format-duration';

describe('formatDuration (#279)', () => {
  it('returns empty for non-finite / negative', () => {
    expect(formatDuration(NaN)).toBe('');
    expect(formatDuration(-5)).toBe('');
  });
  it('sub-second', () => {
    expect(formatDuration(0)).toBe('<1s');
    expect(formatDuration(0.4)).toBe('<1s');
  });
  it('seconds and minutes', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 05s');
  });
  it('hours show three terms', () => {
    expect(formatDuration(4655)).toBe('1h 17m 35s');
    expect(formatDuration(15455)).toBe('4h 17m 35s');
  });
  it('days drop the seconds term', () => {
    expect(formatDuration(90061)).toBe('1d 1h 01m');
  });
});

describe('formatFinishTime (#279)', () => {
  it('formats local 12-hour clock from an absolute epoch', () => {
    // built from local components → deterministic regardless of TZ
    const epoch = new Date(2026, 5, 13, 23, 7).getTime();
    expect(formatFinishTime(epoch)).toBe('11:07 PM');
    const noon = new Date(2026, 5, 13, 12, 0).getTime();
    expect(formatFinishTime(noon)).toBe('12:00 PM');
    const midnight = new Date(2026, 5, 13, 0, 5).getTime();
    expect(formatFinishTime(midnight)).toBe('12:05 AM');
  });
});
