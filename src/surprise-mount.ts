// src/surprise-mount.ts
//
// /surprise page — the Surprise Wall. Generates diverse flame batches, renders
// thumbnails through the serial GPU queue, auto-culls degenerates, shows a wall +
// a persistent keep tray. DOM-mounting module → on SEAM_EXEMPT.

import { type Genome } from './genome';
import { VARIATION_NAMES } from './variations';
import { generateSurpriseBatch } from './surprise-seed';
import { createSurpriseQueue } from './surprise-queue';
import { makeGpuRenderThumb, THUMB_DIM } from './surprise-render';
import { createSurpriseState, type WallTile } from './surprise-state';
import { readWall, writeWall } from './surprise-prefs';
import { writePendingTransfer } from './edit-state';

export interface SurpriseMountOptions { device: GPUDevice; format: GPUTextureFormat }
export interface SurpriseMountHandle { destroy(): void }

const BATCH = 16;
// Canvas backing store must equal the renderer's output dims (THUMB_DIM) so the
// readback ImageData maps 1:1 onto the canvas. CSS scales it to the grid cell.
const TILE_PX = THUMB_DIM;

function symmetryLabel(genome: Genome): string {
  const s = genome.symmetry;
  if (!s) return 'asym';
  return `${s.kind[0]!.toUpperCase()}${s.n}`;
}

export function mountSurprisePage(host: HTMLElement, opts: SurpriseMountOptions): SurpriseMountHandle {
  host.replaceChildren();
  const state = createSurpriseState();
  const gpu = makeGpuRenderThumb(opts.device, opts.format);

  // ---- DOM skeleton (createElement only — never innerHTML) ----
  const root = document.createElement('div'); root.className = 'pyr3-surprise-root';
  const controls = document.createElement('div'); controls.className = 'pyr3-surprise-controls';
  const moreBtn = document.createElement('button'); moreBtn.className = 'pyr3-surprise-more';
  moreBtn.textContent = '🎲 Surprise more';
  const status = document.createElement('div'); status.className = 'pyr3-surprise-status';
  controls.append(moreBtn, status);

  const wall = document.createElement('div'); wall.className = 'pyr3-surprise-wall';
  const tray = document.createElement('aside'); tray.className = 'pyr3-surprise-tray';
  tray.dataset.role = 'tray';
  root.append(controls, wall, tray);
  host.append(root);

  // wallGenomes mirrors what each slot currently shows (assigned the moment a
  // genome is queued, before it renders) so the wall can persist + restore.
  const wallGenomes: (Genome | null)[] = new Array(BATCH).fill(null);
  function persistWall(): void { writeWall(wallGenomes.filter((g): g is Genome => g !== null)); }
  function openInEditor(slot: number): void {
    const genome = wallGenomes[slot] ?? state.getTile(slot)?.genome;
    if (!genome) return;
    // Stash the genome, then open the editor in a NEW TAB. pending-transfer is a
    // localStorage handoff (shared across tabs, single-shot consume), so the new
    // tab picks it up on load while the wall stays put in this tab. The click is
    // a direct user gesture, so window.open isn't popup-blocked.
    writePendingTransfer({ genome, corpusId: null, timestamp: Date.now() });
    window.open('/editor', '_blank', 'noopener');
  }

  // ---- tiles: pre-create BATCH slots so the grid never reflows (no-jump) ----
  const slots: HTMLElement[] = [];
  let generated = 0, culled = 0;
  function makeSlot(i: number): HTMLElement {
    const cell = document.createElement('div'); cell.className = 'pyr3-surprise-tile pending';
    cell.dataset.role = 'tile'; cell.dataset.slot = String(i);
    const cv = document.createElement('canvas'); cv.width = TILE_PX; cv.height = TILE_PX;
    // ↗ link-out — opens this flame in the editor immediately (upper-right corner).
    const open = document.createElement('button'); open.className = 'pyr3-tile-open'; open.textContent = '↗';
    open.title = 'Open in editor';
    open.onclick = () => openInEditor(i);
    const keep = document.createElement('button'); keep.className = 'pyr3-tile-keep'; keep.textContent = '⭐';
    keep.title = 'Keep this flame';
    keep.onclick = () => { state.keep(i); renderTray(); };
    const reroll = document.createElement('button'); reroll.className = 'pyr3-tile-reroll'; reroll.textContent = '✕';
    reroll.title = 'Reroll this tile';
    reroll.onclick = () => fillSlot(i);
    const label = document.createElement('div'); label.className = 'pyr3-tile-label';
    cell.append(cv, open, keep, reroll, label);
    return cell;
  }
  for (let i = 0; i < BATCH; i++) { const s = makeSlot(i); slots.push(s); wall.append(s); }

  // ---- render queue: paint surviving tiles to their slot canvas via putImageData ----
  // pendingGenomes is a FIFO that maps each dequeued thumb back to its slot. The
  // queue is serial + FIFO and every enqueue is paired with exactly one push here,
  // so the head always corresponds to the genome being reported.
  const pendingGenomes: { genome: Genome; slot: number }[] = [];
  const queue = createSurpriseQueue({
    renderThumb: gpu.renderThumb,
    onReady: (t) => {
      const item = pendingGenomes.shift(); if (!item) return;
      const cell = slots[item.slot]!; const cv = cell.querySelector('canvas') as HTMLCanvasElement | null;
      const ctx = cv?.getContext('2d');
      // Copy into a fresh (non-shared) ArrayBuffer-backed array — ImageData's
      // lib types reject the ArrayBufferLike union the readback produces.
      if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.w, t.h), 0, 0);
      const name = VARIATION_NAMES[t.genome.xforms[0]?.variations[0]?.index ?? 0] ?? '';
      const tile: WallTile = {
        genome: t.genome, rgba: t.rgba, w: t.w, h: t.h,
        label: { variation: name, symmetry: symmetryLabel(t.genome) },
      };
      state.setTile(item.slot, tile);
      cell.classList.remove('pending');
      const labelEl = cell.querySelector('.pyr3-tile-label') as HTMLElement | null;
      if (labelEl) labelEl.textContent = name;
      updateStatus();
    },
    onCulled: () => {
      culled++;
      const item = pendingGenomes.shift();
      if (item) fillSlot(item.slot);
      updateStatus();
    },
  });

  function fillSlot(slot: number): void {
    slots[slot]!.classList.add('pending');
    const [genome] = generateSurpriseBatch(Math.random, 1);
    generated++; wallGenomes[slot] = genome!; persistWall();
    pendingGenomes.push({ genome: genome!, slot });
    queue.enqueue([genome!]);
  }

  function surpriseMore(): void {
    // One stratified batch of BATCH so the wall spans the catalog (the whole
    // point of the broadened pool) rather than 16 independent single-picks.
    const batch = generateSurpriseBatch(Math.random, BATCH);
    queue.clear(); pendingGenomes.length = 0;
    for (let i = 0; i < BATCH; i++) {
      slots[i]!.classList.add('pending');
      generated++;
      wallGenomes[i] = batch[i]!;
      pendingGenomes.push({ genome: batch[i]!, slot: i });
    }
    persistWall();
    queue.enqueue(batch);
  }

  // Re-render a previously-persisted wall (genomes restored from localStorage)
  // into the same slots, so a page reload returns the user to the same flames.
  function restoreWall(genomes: Genome[]): void {
    queue.clear(); pendingGenomes.length = 0;
    const n = Math.min(genomes.length, BATCH);
    for (let i = 0; i < n; i++) {
      slots[i]!.classList.add('pending');
      wallGenomes[i] = genomes[i]!;
      pendingGenomes.push({ genome: genomes[i]!, slot: i });
    }
    queue.enqueue(genomes.slice(0, n));
    // Top up any remaining empty slots (older saved walls < BATCH).
    for (let i = n; i < BATCH; i++) fillSlot(i);
  }

  function updateStatus(): void {
    status.textContent = `generated ${generated} · culled ${culled} degenerate · showing ${BATCH}`;
  }
  moreBtn.onclick = surpriseMore;

  // ---- tray rendering ----
  function renderTray(): void {
    tray.replaceChildren();
    const title = document.createElement('h2'); title.textContent = '⭐ Keep tray'; tray.append(title);
    const entries = state.tray();
    if (!entries.length) {
      const empty = document.createElement('div'); empty.className = 'pyr3-tray-empty';
      empty.dataset.role = 'tray-empty'; empty.textContent = 'No keepers yet — hover a flame & tap ⭐';
      tray.append(empty); return;
    }
    entries.forEach((e, idx) => {
      const card = document.createElement('div'); card.className = 'pyr3-kept';
      const name = VARIATION_NAMES[e.genome.xforms[0]?.variations[0]?.index ?? 0] ?? 'flame';
      const cap = document.createElement('span'); cap.className = 'pyr3-kept-label'; cap.textContent = name;
      const edit = document.createElement('button'); edit.textContent = '✏️'; edit.title = 'Edit this flame';
      edit.onclick = () => {
        writePendingTransfer({ genome: e.genome, corpusId: null, timestamp: Date.now() });
        window.location.href = '/editor';
      };
      const rm = document.createElement('button'); rm.textContent = '🗑️'; rm.title = 'Remove from tray';
      rm.onclick = () => { state.removeFromTray(idx); renderTray(); };
      card.append(cap, edit, rm); tray.append(card);
    });
  }

  renderTray(); updateStatus();
  // Restore the last wall on load; only generate fresh on a first-ever visit.
  const saved = readWall();
  if (saved.length) restoreWall(saved); else surpriseMore();

  return { destroy() { queue.clear(); gpu.destroy(); host.replaceChildren(); } };
}
