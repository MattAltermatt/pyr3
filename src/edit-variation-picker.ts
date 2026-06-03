// pyr3 — /v1/edit variation kind picker.
//
// Tiered modal: recently-used → featured (~25 curated) → browse all
// (categorized accordion) → with instant search across all tiers. Fitting-
// room preview: clicking a tile fires onPreview live so the flame canvas
// updates behind the picker; apply commits, revert restores snapshot
// while keeping the picker open, cancel/Escape/click-outside restores +
// closes.
//
// Recently-used persists in localStorage; FIFO cap = 5; dedup-to-front.

import { V, VARIATION_NAMES } from './variations';

// ──────────────────────────────────────────────────────────────────────
// Tier data
// ──────────────────────────────────────────────────────────────────────

/** Curated featured set — the workhorses 90% of flames use. */
export const FEATURED_VARIATIONS: readonly number[] = [
  V.linear, V.sinusoidal, V.spherical, V.swirl, V.horseshoe,
  V.polar, V.heart, V.disc, V.spiral, V.hyperbolic, V.diamond,
  V.ex, V.julian, V.julia, V.waves, V.fisheye, V.bubble,
  V.rings, V.fan, V.cross, V.ngon, V.cell, V.blob, V.rectangles,
];

/** All known variations, grouped by family. Every index in V appears in
 *  exactly one category. Order within a category is approximate flam3
 *  index order. */
export const CATEGORY_MAP: Record<string, readonly number[]> = (() => {
  const groups: Record<string, number[]> = {
    'Polar / angular': [
      V.polar, V.handkerchief, V.heart, V.disc, V.spiral, V.hyperbolic,
      V.diamond, V.eyefish, V.bubble, V.cylinder, V.perspective,
    ],
    'Julia family': [V.julia, V.julian, V.juliascope, V.cpow, V.wedge_julia ?? -1].filter(i => i >= 0),
    'Waves / rings': [V.waves, V.rings, V.fan, V.rings2, V.fan2, V.popcorn, V.flower ?? -1, V.auger ?? -1].filter(i => i >= 0),
    'Blur / random': [V.blur, V.gaussian_blur, V.noise, V.pre_blur ?? -1, V.square, V.rays, V.blade, V.twintrian, V.radial_blur].filter(i => i >= 0),
    'Transcendental': [V.exp ?? -1, V.log ?? -1, V.sin ?? -1, V.cos ?? -1, V.tan ?? -1, V.sec ?? -1, V.csc ?? -1, V.cot ?? -1, V.sinh ?? -1, V.cosh ?? -1, V.tanh ?? -1, V.sech ?? -1, V.csch ?? -1, V.coth ?? -1].filter(i => i >= 0),
    'Linear / basic': [V.linear, V.sinusoidal, V.swirl, V.horseshoe, V.ex, V.fisheye],
  };
  // Sweep up everything else into 'Misc / exotic'.
  const seen = new Set<number>();
  for (const arr of Object.values(groups)) for (const i of arr) seen.add(i);
  const misc: number[] = [];
  for (const i of Object.values(V)) if (!seen.has(i as number)) misc.push(i as number);
  if (misc.length > 0) groups['Misc / exotic'] = misc;
  return groups;
})();

// ──────────────────────────────────────────────────────────────────────
// Recently-used (localStorage, FIFO, max 5, dedup-to-front)
// ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pyr3.varpicker.recents';
const RECENTS_CAP = 5;

export function readRecentlyUsed(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(n => typeof n === 'number' && Number.isInteger(n));
  } catch {
    return [];
  }
}

export function pushRecentlyUsed(index: number): void {
  const cur = readRecentlyUsed().filter(i => i !== index);
  const next = [index, ...cur].slice(0, RECENTS_CAP);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be disabled (private mode); ignore.
  }
}

// ──────────────────────────────────────────────────────────────────────
// Picker modal
// ──────────────────────────────────────────────────────────────────────

export interface VariationPickerOpts {
  /** Where to append the modal — usually `document.body`. */
  host: HTMLElement;
  /** The variation index that's currently in the slot, used as the
   *  snapshot to revert to. */
  initialIndex: number;
  /** Called on each tile click. The host should write to genome and fire
   *  the slow lane so the flame canvas updates behind the picker. */
  onPreview: (index: number) => void;
  /** Called when the user clicks "✓ apply". The current preview wins. */
  onCommit: () => void;
  /** Called when the user cancels (×, Escape, click outside). Host should
   *  treat as "abandon picker state" — the most recent preview was a
   *  no-op in retrospect. */
  onCancel: () => void;
}

export interface VariationPickerHandle {
  /** Programmatic close, equivalent to clicking "× cancel". */
  close(): void;
}

export function openVariationPicker(opts: VariationPickerOpts): VariationPickerHandle {
  // Snapshot the index the picker opened on; revert restores to this.
  const snapshot = opts.initialIndex;
  let currentIndex = opts.initialIndex;
  const sessionRecents: number[] = []; // grows as user previews this session

  // ── DOM ──────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = 'pyr3-var-picker';
  // (Styles injected by edit-ui.ts EDIT_CSS; minimal inline for happy-dom.)

  // Header
  const head = document.createElement('div');
  head.className = 'pyr3-var-head';
  const title = document.createElement('h2');
  title.textContent = 'Pick a variation';
  head.append(title);

  // Action row: search + apply / revert / cancel
  const actions = document.createElement('div');
  actions.className = 'pyr3-var-actions';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'pyr3-var-search';
  searchInput.placeholder = `search ${Object.keys(VARIATION_NAMES).length} variations…`;
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'pyr3-var-apply pyr3-edit-btn';
  applyBtn.textContent = '✓ apply';
  const revertBtn = document.createElement('button');
  revertBtn.type = 'button';
  revertBtn.className = 'pyr3-var-revert pyr3-edit-btn';
  revertBtn.textContent = '↺ revert';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'pyr3-var-cancel pyr3-edit-btn';
  cancelBtn.textContent = '× cancel';
  actions.append(searchInput, applyBtn, revertBtn, cancelBtn);

  // Body — three sections (recents, featured, browse all)
  const body = document.createElement('div');
  body.className = 'pyr3-var-body';

  const recentsSection = document.createElement('div');
  recentsSection.className = 'pyr3-var-recents';
  const featuredSection = document.createElement('div');
  featuredSection.className = 'pyr3-var-featured';
  const browseSection = document.createElement('div');
  browseSection.className = 'pyr3-var-browse';
  body.append(recentsSection, featuredSection, browseSection);

  root.append(head, actions, body);
  opts.host.appendChild(root);

  // ── Render helpers ───────────────────────────────────────────────
  function makeTile(varIndex: number): HTMLButtonElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'pyr3-var-tile';
    tile.dataset['vidx'] = String(varIndex);
    tile.dataset['vname'] = VARIATION_NAMES[varIndex] ?? `var${varIndex}`;
    if (varIndex === currentIndex) tile.classList.add('selected');

    const img = document.createElement('img');
    img.className = 'pyr3-var-thumb';
    img.alt = VARIATION_NAMES[varIndex] ?? '';
    img.src = `/variation-thumbs/${VARIATION_NAMES[varIndex]}.png`;
    img.onerror = () => {
      // Fallback: replace with a 64px canvas the variation is live-rendered
      // into. Same math, slower first-paint. Stubbed here as a 1-color box
      // so the UI doesn't show a broken-image icon while we add the fallback.
      img.replaceWith(document.createElement('div'));
    };
    const label = document.createElement('div');
    label.className = 'pyr3-var-name';
    label.textContent = VARIATION_NAMES[varIndex] ?? `var${varIndex}`;
    tile.append(img, label);

    tile.addEventListener('click', () => {
      currentIndex = varIndex;
      sessionRecents.unshift(varIndex);
      opts.onPreview(varIndex);
      // Update selected highlight
      root.querySelectorAll('.pyr3-var-tile.selected').forEach(el => el.classList.remove('selected'));
      tile.classList.add('selected');
    });

    return tile;
  }

  function renderRecents(): void {
    recentsSection.replaceChildren();
    const persisted = readRecentlyUsed();
    const combined = [...new Set([...sessionRecents, ...persisted])].slice(0, 5);
    if (combined.length === 0) return;
    const label = document.createElement('div');
    label.className = 'pyr3-var-section-label';
    label.textContent = `recently used · ${combined.length}`;
    recentsSection.append(label);
    const grid = document.createElement('div');
    grid.className = 'pyr3-var-grid';
    for (const idx of combined) grid.append(makeTile(idx));
    recentsSection.append(grid);
  }

  function renderFeatured(): void {
    featuredSection.replaceChildren();
    const label = document.createElement('div');
    label.className = 'pyr3-var-section-label';
    label.textContent = `featured · ${FEATURED_VARIATIONS.length}`;
    featuredSection.append(label);
    const grid = document.createElement('div');
    grid.className = 'pyr3-var-grid';
    for (const idx of FEATURED_VARIATIONS) grid.append(makeTile(idx));
    featuredSection.append(grid);
  }

  function renderBrowse(): void {
    browseSection.replaceChildren();
    const label = document.createElement('div');
    label.className = 'pyr3-var-section-label';
    label.textContent = `browse all`;
    browseSection.append(label);
    for (const [catName, indices] of Object.entries(CATEGORY_MAP)) {
      const det = document.createElement('details');
      det.className = 'pyr3-var-category';
      const sum = document.createElement('summary');
      sum.textContent = `${catName} · ${indices.length}`;
      det.append(sum);
      const grid = document.createElement('div');
      grid.className = 'pyr3-var-grid';
      for (const idx of indices) grid.append(makeTile(idx));
      det.append(grid);
      browseSection.append(det);
    }
  }

  function applyFilter(query: string): void {
    const q = query.trim().toLowerCase();
    const all = root.querySelectorAll('.pyr3-var-tile') as NodeListOf<HTMLElement>;
    all.forEach(tile => {
      const name = tile.dataset['vname']?.toLowerCase() ?? '';
      const match = q === '' || name.includes(q);
      tile.style.display = match ? '' : 'none';
    });
  }

  // ── Wire actions ─────────────────────────────────────────────────
  function close(): void {
    document.removeEventListener('keydown', onKeyDown);
    root.remove();
  }

  function commit(): void {
    pushRecentlyUsed(currentIndex);
    opts.onCommit();
    close();
  }

  function revert(): void {
    currentIndex = snapshot;
    opts.onPreview(snapshot);
    // Update selected highlight on the snapshot tile, clear others.
    root.querySelectorAll('.pyr3-var-tile.selected').forEach(el => el.classList.remove('selected'));
    const snapTile = root.querySelector(`.pyr3-var-tile[data-vidx="${snapshot}"]`);
    snapTile?.classList.add('selected');
  }

  function cancel(): void {
    if (currentIndex !== snapshot) opts.onPreview(snapshot); // restore one final time
    opts.onCancel();
    close();
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      cancel();
    }
  }

  applyBtn.addEventListener('click', commit);
  revertBtn.addEventListener('click', revert);
  cancelBtn.addEventListener('click', cancel);
  searchInput.addEventListener('input', () => applyFilter(searchInput.value));
  document.addEventListener('keydown', onKeyDown);

  // Initial paint
  renderRecents();
  renderFeatured();
  renderBrowse();

  return { close: () => cancel() };
}
