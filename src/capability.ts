/** Capability descriptor returned by `GET /api/capabilities` on a
 *  `pyr3 serve` host. On gh-pages (or any environment without the
 *  endpoint), `fetchCapability()` falls back to `GHPAGES_DEFAULT`.
 *
 *  Shape locked by the animation architecture spec § "Capability
 *  detection" and the P0 design spec § 2.3 (#201). New fields are
 *  additive — existing consumers should ignore unknowns. */
export interface Capability {
  /** Which surface owns the heavy render. `webgpu-browser` = caller
   *  runs the existing browser path; `dawn-node` = POST `/api/render`
   *  and consume SSE progress. */
  backend: 'webgpu-browser' | 'dawn-node';
  pyr3_version?: string;
  dawn_version?: string;
  /** Hard cap the UI should enforce on the quality slider. `null` means
   *  unlimited (the backend can run any value). */
  max_quality: number | null;
  /** Whether the backend can write rendered output to a host filesystem
   *  path (animation export, batch render). Wired for P4+. */
  can_write_files: boolean;
  /** Whether `/api/animate` is implemented. Wired for P4+. */
  can_render_animation: boolean;
  /** Host-local scratch directory for write-to-disk renders. */
  scratch_dir?: string;
  gpu_adapter?: string;
}

/** The capability the viewer assumes when no server is reachable —
 *  i.e. the gh-pages experience users have today. */
export const GHPAGES_DEFAULT: Capability = {
  backend: 'webgpu-browser',
  max_quality: 200,
  can_write_files: false,
  can_render_animation: false,
};

let cached: Capability | null = null;

/** Fetch the capability descriptor from `pyr3 serve`. Memoized — every
 *  call after the first returns the cached value. Networking failures
 *  (no server, 404, malformed JSON) silently degrade to
 *  `GHPAGES_DEFAULT` so the gh-pages path stays the safe fallback. */
export async function fetchCapability(): Promise<Capability> {
  if (cached) return cached;
  try {
    const r = await fetch('/api/capabilities');
    if (!r.ok) {
      cached = GHPAGES_DEFAULT;
      return cached;
    }
    cached = (await r.json()) as Capability;
    return cached;
  } catch {
    cached = GHPAGES_DEFAULT;
    return cached;
  }
}

/** Synchronous accessor for modules that mount after the boot fetch has
 *  resolved. Returns `GHPAGES_DEFAULT` if `fetchCapability()` hasn't run
 *  yet — safe default, never throws. */
export function getCapability(): Capability {
  return cached ?? GHPAGES_DEFAULT;
}

/** Test seam — clears the memoized value so each case starts cold. */
export function _resetCapabilityForTest(): void {
  cached = null;
}
