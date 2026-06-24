// #264 — legacy /v1/* → flat-route redirect map. Run once at boot (main.ts)
// before parseLoadIntent so old bookmarks, the README hero link, and shared
// deep-links resolve to the new flat scheme. Pure string mapping, no DOM —
// the gh-pages 404-shell already serves the SPA for arbitrary paths, so the
// redirect is a client-side replaceState, not server config.
//
// Returns the new "pathname+search+hash" string, or null when `pathname` is not
// a legacy /v1 path (caller leaves the URL untouched). `hash` (#299) carries the
// deep-link anchor (e.g. /v1/variations#julia) through the rewrite, including
// the leading '#'; pass '' when there is none.

export function redirectLegacyPath(pathname: string, search: string, hash = ''): string | null {
  const stripped = pathname.replace(/^\//, '').replace(/\/$/, '');
  const parts = stripped.length === 0 ? [] : stripped.split('/');

  // #372 — the standalone /gradient page was retired; palette editing now lives
  // in the editor's Color lens. Redirect old bookmarks (both the flat /gradient
  // and the legacy /v1/gradient handled below) to /editor.
  if (parts[0] === 'gradient') return '/editor' + search + hash;

  // #347 — poppy no-hyphen alias for the interactive guide page.
  if (parts[0] === 'howitworks') return '/how-it-works' + search + hash;

  // The Creator page's old path was /surprise; the route was renamed to
  // /creator. Redirect old bookmarks / shared links to the new path.
  if (parts[0] === 'surprise') return '/creator' + search + hash;

  if (parts[0] !== 'v1') return null;

  const sub = parts[1];
  let dest: string | null = null;

  if (sub === undefined || sub === 'viewer') dest = '/esf';
  else if (sub === 'gen') dest = `/esf/${parts.slice(1).join('/')}`;
  else if (sub === 'gallery') dest = `/esf/${parts.slice(1).join('/')}`;
  else if (sub === 'edit') dest = '/editor';
  else if (sub === 'gradient') dest = '/editor';  // #372 — /gradient retired → editor
  else if (sub === 'animate') dest = '/animate';
  else if (sub === 'screensaver') dest = '/screensaver';
  else if (sub === 'variations') dest = '/variations';
  else if (sub === 'surprise') dest = '/creator';  // Creator page renamed /surprise → /creator

  if (dest === null) return null;
  return dest + search + hash;
}
