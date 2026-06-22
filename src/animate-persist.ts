// #411 — persist the /animate working timeline across page refreshes.
//
// The timeline already round-trips through `timelineToJson` / `timelineFromJson`
// (src/timeline-serialize.ts); this module just parks that JSON in a single
// namespaced localStorage key and reads it back on mount, so a refresh restores
// the in-progress sequence instead of dropping to the empty state.
//
// Scope (option A): TIMELINE mode only. A loaded multi-keyframe `.flam3`
// animation is a file the user re-opens, so animation mode is transient and
// clears the key. The output-size / quality / settle bar values already persist
// independently (#176 workstation-pref convention).
//
// Best-effort everywhere — localStorage may be disabled (private mode) or full;
// failures are swallowed so the page stays interactive. Restore fails soft to
// null on a missing / corrupt / old payload, mirroring the editor's restoreWip.

import { type Timeline } from './timeline';
import { timelineToJson, timelineFromJson } from './timeline-serialize';

export const ANIMATE_TIMELINE_KEY = 'pyr3.animate.timeline';

/** Park the working timeline as JSON, or clear the key when `null` (the page
 *  dropped to the empty state or switched into animation mode). Best-effort. */
export function persistTimeline(timeline: Timeline | null): void {
  try {
    if (timeline === null) {
      globalThis.localStorage?.removeItem(ANIMATE_TIMELINE_KEY);
      return;
    }
    globalThis.localStorage?.setItem(ANIMATE_TIMELINE_KEY, timelineToJson(timeline));
  } catch {
    // localStorage disabled (private browsing) or quota exceeded — no-op.
  }
}

/** Read the persisted timeline back. Returns null when the key is absent, the
 *  stored JSON is malformed/old, or localStorage itself throws — the caller
 *  treats null as "no saved timeline" and stays on the empty state. */
export function restoreTimeline(): Timeline | null {
  try {
    const raw = globalThis.localStorage?.getItem(ANIMATE_TIMELINE_KEY);
    if (!raw) return null;
    return timelineFromJson(raw);
  } catch {
    return null;
  }
}
