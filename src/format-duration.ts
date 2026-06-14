// Human-readable time helpers for the export progress modal (#279).
// Pure — no DOM, no clock reads (callers pass absolute epochs).

/** A coarse duration: largest non-zero unit leads, ≤3 terms. Days drop seconds. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return '<1s';
  const total = Math.round(seconds);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** Local 12-hour wall-clock `h:mm AM/PM` for an absolute epoch (ms). */
export function formatFinishTime(epochMs: number): string {
  const dt = new Date(epochMs);
  let h = dt.getHours();
  const m = dt.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}
