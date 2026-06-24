// src/surprise-mount.ts
//
// /surprise page — the Surprise Wall (v2, #surprise-v2). A full-bleed, viewport-
// filling wall of steerable flame ideas: three always-visible bars drive the
// recipe (ACTIONS here + GENERATE/VARIATIONS from surprise-bars.ts, #433),
// clicking a tile opens it in the editor (new tab), and all settings apply only
// on 🎲 Reroll (the button becomes "Apply & Reroll" + pulses when pending).
// Undo/redo is wall-batch only (Ctrl+Z); per-bar ↺ Reset replaced the old
// settings-history (#433). DOM-mounting module → on SEAM_EXEMPT.

import { type Genome } from './genome';
import { VARIATION_NAMES } from './variations';
import { generateSurpriseBatch, type SurpriseGenParams } from './surprise-seed';
import { createSurpriseQueue } from './surprise-queue';
import { makeGpuRenderThumb, THUMB_DIM } from './surprise-render';
import { createSurpriseState } from './surprise-state';
import {
  readWall, writeWall, loadSurpriseSettings, saveSurpriseSettings,
  resetGeneration, resetVariations, type SurpriseSettings,
} from './surprise-prefs';
import { computeGrid, type Viewport, type GridMode } from './surprise-grid';
import { mountSurpriseBars, type SurpriseBarsHandle } from './surprise-bars';
import { buildInfoIcon } from './edit-tooltip';
import { writePendingTransfer } from './edit-state';

export interface SurpriseMountOptions { device: GPUDevice; format: GPUTextureFormat }
export interface SurpriseMountHandle { destroy(): void }

const GAP_PX = 8;
// Hard cap on tiles per wall. Each thumbnail is a full GPU fractal render (heavy),
// so an unbounded screen-scaled count (a 4K monitor in fill mode wants ~120) would
// peg the GPU for minutes. 60 fills common displays while staying responsive; Set #
// above this is clamped. (#surprise-v2 perf fix)
const MAX_TILES = 60;
// Pause between renders so a long wall fill gives the GPU/OS relief instead of
// pegging the machine. (#surprise-v2)
const RELIEF_MS = 40;

/** Tile caption: xform count + the distinct variations used (#surprise-v2). */
function tileCaption(g: Genome): string {
  const names = [...new Set(
    g.xforms.flatMap((x) => x.variations.map((v) => VARIATION_NAMES[v.index] ?? `#${v.index}`)),
  )];
  const nxf = g.xforms.length;
  return `${nxf} xform${nxf === 1 ? '' : 's'} · ${names.join(', ')}`;
}

/** Map the user's settings onto the generator's params. */
function settingsToParams(s: SurpriseSettings): SurpriseGenParams {
  return {
    xformCount: s.xformCount, blendPerXform: s.blendPerXform,
    preferred: s.preferred, preferMode: s.preferMode,
  };
}

export function mountSurprisePage(host: HTMLElement, opts: SurpriseMountOptions): SurpriseMountHandle {
  host.replaceChildren();
  let settings = loadSurpriseSettings();
  const state = createSurpriseState(settings);
  const gpu = makeGpuRenderThumb(opts.device, opts.format);

  // ---- DOM skeleton (createElement only — never innerHTML) ----
  const root = document.createElement('div'); root.className = 'pyr3-surprise-root';
  // ACTIONS bar — reroll (doubles as stop) / wall undo·redo / status. Renders
  // below the two #433 bars (GENERATE + VARIATIONS come from mountSurpriseBars).
  const controls = document.createElement('div');
  controls.className = 'pyr3-surprise-bar pyr3-surprise-controls';
  const controlsLabel = document.createElement('span');
  controlsLabel.className = 'pyr3-surprise-bar-label';
  controlsLabel.textContent = 'Actions';

  // Reroll doubles as Stop. While a wall is rendering the button becomes
  // "■ Stop" and halts the in-flight gen+render; idle, it rolls a fresh wall.
  // When settings are pending (idle) the label becomes "Apply & Reroll" + a
  // pulse (a `.dirty` class), so the button itself tells the user clicking it
  // applies the changes — no separate cue line that would grow the controls bar.
  // min-width is pinned (CSS) to the widest label so the swaps don't jump.
  const rerollBtn = document.createElement('button'); rerollBtn.className = 'pyr3-surprise-more';
  rerollBtn.dataset.role = 'reroll'; rerollBtn.textContent = '🎲 Reroll';

  const wallUndo = document.createElement('button'); wallUndo.className = 'pyr3-surprise-wall-undo';
  wallUndo.dataset.role = 'wall-undo'; wallUndo.textContent = '↶'; wallUndo.title = 'Undo reroll (Ctrl+Z)';
  const wallRedo = document.createElement('button'); wallRedo.className = 'pyr3-surprise-wall-redo';
  wallRedo.dataset.role = 'wall-redo'; wallRedo.textContent = '↷'; wallRedo.title = 'Redo reroll (Ctrl+⇧Z)';

  // Tightened status: "<N> shown · <M> culled ⓘ" — the ⓘ explains culling (#433).
  const status = document.createElement('div'); status.className = 'pyr3-surprise-status';
  const statusShown = document.createElement('strong'); statusShown.className = 'pyr3-surprise-status-shown';
  const statusCulled = document.createElement('span'); statusCulled.className = 'pyr3-surprise-status-culled';
  const cullHelp = buildInfoIcon({
    title: 'Culled flames',
    body: 'Each Reroll generates more flames than it shows. Mathematically degenerate ones — blank, divergent, or collapsed to a point — are detected and skipped before display.',
    hint: '“culled” counts how many were skipped to fill this wall.',
  });
  cullHelp.classList.add('pyr3-surprise-status-help');
  status.append(statusShown, document.createTextNode(' shown · '), statusCulled,
    document.createTextNode(' '), cullHelp);
  controls.append(controlsLabel, rerollBtn, wallUndo, wallRedo, status);

  const wall = document.createElement('div'); wall.className = 'pyr3-surprise-wall';
  wall.style.display = 'grid'; wall.style.gap = `${GAP_PX}px`;

  // GENERATE + VARIATIONS bars mount here (#433).
  const barsHost = document.createElement('div'); barsHost.className = 'pyr3-surprise-bars-mount';

  // Actions bar renders below the GENERATE/VARIATIONS bars (grid-template-areas);
  // append in that order too so tab-order matches the visual order.
  root.append(barsHost, controls, wall);
  host.append(root);

  // ---- state mirrors ----
  // wallGenomes mirrors what each slot shows; appliedSettings is the snapshot that
  // produced the current wall (the dirty cue compares live settings against it).
  let wallGenomes: Genome[] = [];
  let appliedSettings: SurpriseSettings = settings;
  let generated = 0, culled = 0;

  function viewport(): Viewport {
    const r = wall.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height || window.innerHeight - r.top), gap: GAP_PX };
  }
  function gridMode(count?: number): GridMode {
    // Reroll uses the settings; resize re-fits the CURRENT count (set-mode) so a
    // resize never changes how many flames are shown (that waits for Reroll, #C).
    if (count !== undefined) return { mode: 'set', n: count };
    return settings.countMode === 'fill'
      ? { mode: 'fill', density: settings.density }
      : { mode: 'set', n: Math.min(MAX_TILES, Math.max(1, settings.setN)) };
  }

  // ---- render queue ----
  const pendingGenomes: { genome: Genome; slot: number }[] = [];
  const queue = createSurpriseQueue({
    renderThumb: gpu.renderThumb,
    reliefMs: RELIEF_MS,
    // Mark the tile whose render is starting now (it's the FIFO head). #surprise-v2
    onRenderStart: () => {
      const head = pendingGenomes[0];
      if (head) slots[head.slot]?.classList.add('rendering');
    },
    onReady: (t) => {
      const item = pendingGenomes.shift(); if (!item) return;
      const cell = slots[item.slot]; if (!cell) return;
      const cv = cell.querySelector('canvas') as HTMLCanvasElement | null;
      const ctx = cv?.getContext('2d');
      if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.w, t.h), 0, 0);
      cell.classList.remove('pending', 'rendering');
      const cap = tileCaption(t.genome);
      const labelEl = cell.querySelector('.pyr3-tile-label') as HTMLElement | null;
      if (labelEl) labelEl.textContent = cap;
      cell.title = cap; // hover shows the full caption when truncated
      updateStatus();
    },
    onCulled: () => {
      culled++;
      const item = pendingGenomes.shift();
      if (item) slots[item.slot]?.classList.remove('rendering');
      if (item) refillSlot(item.slot);
      updateStatus();
    },
  });

  // ---- tiles ----
  let slots: HTMLElement[] = [];
  function makeSlot(i: number): HTMLElement {
    const cell = document.createElement('div'); cell.className = 'pyr3-surprise-tile pending';
    cell.dataset.role = 'tile'; cell.dataset.slot = String(i);
    cell.style.cursor = 'pointer';
    const cv = document.createElement('canvas'); cv.width = THUMB_DIM; cv.height = THUMB_DIM;
    const label = document.createElement('div'); label.className = 'pyr3-tile-label';
    cell.append(cv, label);
    // Whole-tile click → open in the editor (new tab). #surprise-v2.
    cell.addEventListener('click', () => openInEditor(i));
    return cell;
  }
  function rebuildSlots(count: number): void {
    slots = [];
    wall.replaceChildren();
    for (let i = 0; i < count; i++) { const s = makeSlot(i); slots.push(s); wall.append(s); }
  }
  /** Lay the grid columns/tile-size out for the given mode (snap-to-fit). */
  function applyGridLayout(mode: GridMode): void {
    const g = computeGrid(viewport(), mode);
    wall.style.gridTemplateColumns = `repeat(${g.cols}, ${g.tile}px)`;
  }

  function openInEditor(slot: number): void {
    const genome = wallGenomes[slot];
    if (!genome) return;
    // pending-transfer is a localStorage handoff (shared across tabs, single-shot
    // consume) so the new tab picks it up on load while the wall stays put here.
    writePendingTransfer({ genome, corpusId: null, timestamp: Date.now() });
    window.open('/editor', '_blank', 'noopener');
  }

  function refillSlot(slot: number): void {
    if (!slots[slot]) return;
    slots[slot]!.classList.add('pending');
    const [genome] = generateSurpriseBatch(Math.random, 1, settingsToParams(appliedSettings));
    generated++; wallGenomes[slot] = genome!; persistWall();
    pendingGenomes.push({ genome: genome!, slot });
    queue.enqueue([genome!]);
  }

  function persistWall(): void { writeWall(wallGenomes.filter((g): g is Genome => g != null)); }

  // Generation epoch — bumped by every fillWall() so an in-flight chunked fill
  // (from a prior Reroll) cancels the moment a newer one starts.
  let genEpoch = 0;
  let genActive = false; // chunked generation still producing genomes
  const GEN_CHUNK = 4; // genomes generated per tick

  /** Rendering while genomes are still being generated OR tiles still queued. */
  function isRendering(): boolean { return genActive || pendingGenomes.length > 0; }
  /** The Reroll button doubles as Stop. While a wall is rendering it shows
   *  "■ Stop" and halts; idle it shows "🎲 Reroll" (or "🎲 Apply & Reroll" when
   *  settings are pending). The standalone Stop button was retired. */
  function refreshRerollBtn(): void {
    if (isRendering()) {
      rerollBtn.textContent = '■ Stop';
      rerollBtn.title = 'Stop rendering the current wall';
      rerollBtn.classList.add('stopping');
      rerollBtn.classList.remove('dirty');
    } else {
      const dirty = isDirty();
      rerollBtn.textContent = dirty ? '🎲 Apply & Reroll' : '🎲 Reroll';
      rerollBtn.title = '';
      rerollBtn.classList.toggle('dirty', dirty);
      rerollBtn.classList.remove('stopping');
    }
  }

  /** Fill the wall with `count` tiles. When `provided` is given (restore / undo)
   *  those genomes are used; otherwise genomes are generated in small YIELDING
   *  chunks — generateRandomGenome runs a CPU fit-oracle per genome, so generating
   *  a whole screen-sized batch synchronously would freeze the page. Chunking +
   *  setTimeout keeps the main thread responsive and lets the first tiles render
   *  almost immediately while the rest stream in. (#surprise-v2 perf fix) */
  function fillWall(count: number, provided: Genome[] | null): void {
    const myEpoch = ++genEpoch;
    queue.clear(); pendingGenomes.length = 0;
    wallGenomes = new Array<Genome>(count);
    rebuildSlots(count);
    applyGridLayout(gridMode(count));
    genActive = true; refreshRerollBtn();
    let i = 0;
    const step = (): void => {
      if (myEpoch !== genEpoch) return; // superseded by a newer fill
      const end = Math.min(count, i + GEN_CHUNK);
      const chunk = provided
        ? provided.slice(i, end)
        : generateSurpriseBatch(Math.random, end - i, settingsToParams(appliedSettings));
      for (let k = 0; k < chunk.length; k++, i++) {
        wallGenomes[i] = chunk[k]!;
        generated++;
        pendingGenomes.push({ genome: chunk[k]!, slot: i });
      }
      queue.enqueue(chunk);
      persistWall();
      updateStatus();
      if (i < count) { setTimeout(step, 0); }
      else { genActive = false; refreshRerollBtn(); if (!provided) { state.wallHistory.push(wallGenomes.slice()); refreshWallHistoryButtons(); } }
    };
    step();
  }

  /** Halt the in-flight generation + queued renders (Reroll's Stop state). */
  function stopRendering(): void {
    genEpoch++;            // cancel any pending chunked-gen step
    genActive = false;
    queue.clear();         // drop everything not yet started (#295 epoch drop)
    pendingGenomes.length = 0;
    for (const cell of slots) cell.classList.remove('rendering');
    refreshRerollBtn();
    updateStatus();
  }

  /** Resolve how many tiles a Reroll should produce (capped). */
  function rerollCount(): number {
    const m = gridMode();
    const raw = m.mode === 'set' ? m.n : computeGrid(viewport(), m).count;
    return Math.min(MAX_TILES, Math.max(1, raw));
  }

  /** Apply pending settings + roll a fresh wall (the 🎲 Reroll action). */
  function reroll(): void {
    appliedSettings = settings;
    culled = 0; // the culled count is per-reroll, not cumulative across walls
    fillWall(rerollCount(), null);
    refreshRerollBtn();
    refreshWallHistoryButtons();
  }

  function restoreWallBatch(batch: Genome[]): void {
    fillWall(Math.min(MAX_TILES, batch.length), batch.slice(0, MAX_TILES));
    refreshWallHistoryButtons();
  }

  // ---- resize re-fill (Fill mode): keep existing tiles, append/trim to match
  //      the new viewport. Gated on the wall being idle so it never disturbs an
  //      in-flight fill, and only the viewport-driven count tracks the window —
  //      generation SETTINGS still wait for Reroll. (#surprise-v2)
  function growWall(from: number, to: number): void {
    const myEpoch = ++genEpoch; genActive = true; refreshRerollBtn();
    for (let idx = from; idx < to; idx++) { const s = makeSlot(idx); slots.push(s); wall.append(s); }
    applyGridLayout(gridMode(to));
    let i = from;
    const step = (): void => {
      if (myEpoch !== genEpoch) return;
      const end = Math.min(to, i + GEN_CHUNK);
      const chunk = generateSurpriseBatch(Math.random, end - i, settingsToParams(appliedSettings));
      for (let k = 0; k < chunk.length; k++, i++) {
        wallGenomes[i] = chunk[k]!; generated++;
        pendingGenomes.push({ genome: chunk[k]!, slot: i });
      }
      queue.enqueue(chunk); persistWall(); updateStatus();
      if (i < to) setTimeout(step, 0);
      else { genActive = false; refreshRerollBtn(); }
    };
    step();
  }
  function shrinkWall(to: number): void {
    for (let idx = slots.length - 1; idx >= to; idx--) slots[idx]?.remove();
    slots.length = to;
    wallGenomes.length = to;
    applyGridLayout(gridMode(to));
    persistWall(); updateStatus();
  }
  /** Re-fill the wall to the current Fill-mode viewport — only once the wall is
   *  idle (no gen, no queued renders), so existing tiles are never disturbed. */
  function refillToFit(): void {
    if (settings.countMode !== 'fill') return;
    if (genActive || pendingGenomes.length > 0) { scheduleRefill(); return; } // retry when idle
    const target = Math.min(MAX_TILES, Math.max(1,
      computeGrid(viewport(), { mode: 'fill', density: settings.density }).count));
    const current = wallGenomes.length;
    if (target > current) growWall(current, target);
    else if (target < current) shrinkWall(target);
  }
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRefill(): void {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refillToFit, 250); // debounce — refill after dragging stops
  }

  function updateStatus(): void {
    statusShown.textContent = String(wallGenomes.length);
    statusCulled.textContent = `${culled} culled`;
    refreshRerollBtn();
  }

  // ---- dirty signal: when settings differ from the wall's, the Reroll button
  //      becomes "Apply & Reroll" + pulses so clicking it clearly applies them
  //      (rendered by refreshRerollBtn, which also owns the Stop state). ----
  function isDirty(): boolean { return JSON.stringify(settings) !== JSON.stringify(appliedSettings); }

  // ---- settings wiring (no settings-history; per-bar ↺ Reset only — #433) ----
  function commitSettings(next: SurpriseSettings): void {
    settings = next;
    saveSurpriseSettings(next);
    bars?.refresh();
    refreshRerollBtn();
  }

  let bars: SurpriseBarsHandle | null = null;
  bars = mountSurpriseBars(barsHost, {
    getSettings: () => settings,
    onChange: (next) => commitSettings(next),
    onResetGeneration: () => commitSettings(resetGeneration(settings)),
    onResetVariations: () => commitSettings(resetVariations(settings)),
  });

  // ---- wall history wiring ----
  function refreshWallHistoryButtons(): void {
    wallUndo.disabled = !state.wallHistory.canUndo();
    wallRedo.disabled = !state.wallHistory.canRedo();
  }
  wallUndo.onclick = () => { const b = state.wallHistory.undo(); if (b) restoreWallBatch(b); };
  wallRedo.onclick = () => { const b = state.wallHistory.redo(); if (b) restoreWallBatch(b); };
  function onKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) { const b = state.wallHistory.redo(); if (b) restoreWallBatch(b); }
    else { const b = state.wallHistory.undo(); if (b) restoreWallBatch(b); }
  }
  window.addEventListener('keydown', onKey);

  // One button, two jobs: halt while rendering, else roll a fresh wall.
  rerollBtn.onclick = () => { if (isRendering()) stopRendering(); else reroll(); };

  // ---- resize: live re-fit the current tiles (cheap), then debounced re-fill
  //      to the new viewport in Fill mode (Set # keeps its explicit count). ----
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        if (wallGenomes.length > 0) applyGridLayout(gridMode(wallGenomes.length));
        scheduleRefill();
      })
    : null;
  ro?.observe(wall);

  // ---- boot: restore the last wall, else roll a fresh one ----
  updateStatus();
  refreshRerollBtn();
  refreshWallHistoryButtons();
  const saved = readWall();
  if (saved.length) {
    appliedSettings = settings;
    const batch = saved.slice(0, MAX_TILES);
    state.wallHistory.push(batch);
    fillWall(batch.length, batch);
    refreshWallHistoryButtons();
  } else reroll();

  return {
    destroy() {
      window.removeEventListener('keydown', onKey);
      if (resizeTimer) clearTimeout(resizeTimer);
      ro?.disconnect();
      bars?.destroy();
      queue.clear(); gpu.destroy(); host.replaceChildren();
    },
  };
}
