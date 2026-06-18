import { type Palette, type ColorStop, PYRE_PALETTE } from './palette';
import { mountPaletteEditor } from './palette-editor';
import { mountPalettePicker, type PalettePickerHandle } from './palette-picker';
import { type PaletteSource } from './flam3-palette-names';
import { getLibraryStops } from './flam3-palettes';
import { getMine, saveMine } from './palette-library';
import { exportPalette, importPalette } from './palette-file';
import { openNamingDialog } from './naming-dialog';
import { buildButton } from './edit-primitives';
import { mountGradientBar } from './ui-bar';
import { createHistory, type History } from './edit-history';
import { type WebGPUStatus } from './webgpu-check';
import { COLORS } from './ui-tokens';
import { consumeGradientHandoff, writeGradientReturn } from './edit-state';
import { resampleToN } from './palette-transforms';
import { type Genome } from './genome';
import { createRenderer, type Renderer } from './renderer';
import { startChunkedRender, type RunHandle } from './render-orchestrator';
import { load as loadFlameFile } from './loader';
import {
  downsampleIndexMap, brushHistogram, regionMask, insertStopAtIndex,
  clientToPixel, colorAtIndex, type IndexMap,
} from './color-index-map';

export interface GradientPageOpts {
  /** #353 — the shared top-bar root (`#pyr3-bar`). The page mounts
   *  `mountGradientBar` here and owns it; the editor + flame body mount into
   *  the bar's `middleSlot`. */
  barRoot: HTMLElement;
  /** #353 — WebGPU status threaded to the bar chrome (drives the WebGPU pill). */
  webgpu: WebGPUStatus;
  initialPalette?: Palette;
  /** #269 — optional GPU device/format. When present (passed from main.ts), the
   *  page renders the flame below the bar; absent (unit tests / no WebGPU) it
   *  stays a palette-only editor with a placeholder in the flame zone. */
  device?: GPUDevice;
  format?: GPUTextureFormat;
}
export interface GradientPageHandle { destroy(): void }

// Overridable for tests — real nav returns to the editor page.
export const gradReturnNav = {
  go(): void { window.location.href = '/editor'; },
};

const ROUNDTRIP_RESAMPLE_N = 16;
// Above this stop count a palette is treated as "dense" (a flame's 256-entry LUT
// or a raw library palette) and always opens behind the Modify gate — we never
// mount a handle-per-stop editor for it, even if it's flagged custom. Generous
// enough that a hand-built custom gradient (a few dozen stops) opens in place.
const ROUNDTRIP_DENSE_CAP = 64;

/** Build a `linear-gradient(...)` CSS string from raw stops, for the
 *  read-only flame strip in round-trip mode (no editor mounted yet). */
function gradientCssFromStops(stops: ColorStop[]): string {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return 'linear-gradient(to right,#000,#000)';
  const parts = sorted.map((s) =>
    `rgb(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)}) `
    + `${(Math.max(0, Math.min(1, s.t)) * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function mountGradientPage(opts: GradientPageOpts): GradientPageHandle {
  // #353 — the editor + flame body lives in the shared bar's middleSlot.
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    maxWidth: '760px', margin: '0 auto', padding: '24px 16px', color: COLORS.text.primary,
  });

  // basic instructions (collapsible, open by default)
  const help = document.createElement('details');
  help.open = false; // #269 — collapsed by default to reclaim vertical space
  Object.assign(help.style, {
    margin: '0 0 14px', padding: '8px 12px', fontSize: '12px', lineHeight: '1.55',
    color: COLORS.text.muted, background: COLORS.bg.info,
    border: `1px solid ${COLORS.border}`, borderRadius: '4px',
  });
  const summary = document.createElement('summary');
  summary.textContent = 'How to use';
  Object.assign(summary.style, { cursor: 'pointer', color: COLORS.text.primary, marginBottom: '4px' });
  const helpBody = document.createElement('div');
  function bullet(lead: string, rest: string): HTMLElement {
    const row = document.createElement('div');
    const b = document.createElement('strong');
    b.textContent = lead;
    b.style.color = COLORS.text.primary;
    row.append('• ', b, ' ' + rest);
    return row;
  }
  helpBody.append(
    bullet('Add', 'a color stop: double-click the bar.'),
    bullet('Move / recolor:', 'drag a handle to move it; click a handle to recolor it (HSV picker).'),
    bullet('Remove', 'a stop: select it, then press Delete — or use the 🗑 delete stop button. The two end stops are permanent.'),
    bullet('Interpolation:', 'how colors blend across the bar — linear, smooth, or step.'),
    bullet('Transforms:', 'reverse / mirror / rotate / invert-lum reshape the palette; resample to N turns it into N editable stops.'),
    bullet('Save to library', 'keeps it (appears under the “mine” tab in Browse). Export / Import as .pyre-palette.json. Reset starts over.'),
    bullet('Point-to-paint:', 'hover the flame to light up where it maps on the gradient bar; hover the gradient bar to highlight the matching flame regions; double-click the flame to add a stop there.'),
  );
  help.append(summary, helpBody);
  wrap.appendChild(help);

  // editor — `seed` is the palette the page opened with; Reset restores it.
  // #266 — if a flame's palette was handed off from /v1/edit, enter round-trip
  // mode: the flame's palette opens read-only behind a "Modify gradient" gate
  // (explicit opt-in to a lossy resample) plus an "Apply to flame" return.
  const handoff = consumeGradientHandoff();      // null in standalone mode
  const roundTrip = handoff !== null;
  const handoffGenome = handoff?.genome ?? null; // #269 — render this flame
  const seed: Palette = handoffGenome?.palette ?? opts.initialPalette ?? PYRE_PALETTE;

  // #266 — open the editor directly (no read-only Modify gate) when the handed
  // palette is the user's OWN custom gradient. Two signals: `editable` (the
  // genome's paletteSource was 'custom' — robust within a session, set on every
  // apply-back) OR a sparse stop count (≤ resample-N — a durable fallback that
  // survives a reload, since paletteSource provenance is in-memory UI state).
  // A dense palette (a 256-stop flame LUT, or a library palette pulled in via
  // Browse) always gets the gate so we never render an unusable handle-per-LUT-
  // entry editor.
  const openInPlace =
    roundTrip
    && (handoff.editable || seed.stops.length <= ROUNDTRIP_RESAMPLE_N)
    && seed.stops.length <= ROUNDTRIP_DENSE_CAP;

  // #353 — mount the shared top bar. It owns the chrome + the load/library/file
  // action verbs (+ Apply/Cancel in round-trip mode) + the read-only palette
  // identity chip + transient status. The editor + flame body mount into its
  // middleSlot below. Callbacks are forward refs to functions declared further
  // down (only invoked on click, never at mount time).
  const bar = mountGradientBar(opts.barRoot, {
    webgpu: opts.webgpu,
    roundTrip,
    onLoadFlame: () => loadFlameInput.click(),
    onBrowse: () => openBrowse(),
    onSave: () => { void doSave(); },
    onExport: () => { void doExport(); },
    onImport: () => fileInput.click(),
    onReset: () => doReset(),
    onUndo: () => doUndo(),   // #265
    onRedo: () => doRedo(),
    // Round-trip CTAs — write the (possibly untouched) palette back + return,
    // or return without writing (flame keeps its palette). (#266)
    onApply: () => { writeGradientReturn(currentPalette()); gradReturnNav.go(); },
    onCancelReturn: () => { gradReturnNav.go(); },
  });
  function setStatus(msg: string): void { bar.setStatus(msg); }

  const editorHost = document.createElement('div');
  wrap.appendChild(editorHost);

  let editor: ReturnType<typeof mountPaletteEditor> | null = null;

  // #265 — undo / redo. Snapshots the live `Palette` onto a generic
  // `History<Palette>` (the same stack the /editor uses for Genome). The
  // palette editor's `onChange` fires continuously during a drag, so in-place
  // edits commit on a trailing debounce (a drag = one entry, not sixty);
  // discrete palette swaps (Browse / Import / Reset / paint / round-trip Modify)
  // commit immediately. `editor.setPalette` does NOT re-fire `onChange`, so
  // restoring a snapshot can't loop — but an `applyingHistory` guard makes the
  // no-re-push contract explicit. History seeds on the first editor mount so
  // the very first edit is undoable back to the starting palette.
  const COMMIT_DEBOUNCE_MS = 250;
  let history: History<Palette> | null = null;
  let applyingHistory = false;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;

  function syncHistoryButtons(): void {
    bar.setUndoEnabled(history?.canUndo() ?? false);
    bar.setRedoEnabled(history?.canRedo() ?? false);
  }
  /** Seed the stack on first call, push thereafter. No-op while restoring a
   *  snapshot or before an editor exists. Identical snapshots coalesce inside
   *  History.push, so callers can be liberal. */
  function commitHistory(): void {
    if (applyingHistory || !editor) return;
    const snap = currentPalette();
    if (!history) history = createHistory(snap);
    else history.push(snap);
    syncHistoryButtons();
  }
  function scheduleCommit(): void {
    if (commitTimer !== null) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => { commitTimer = null; commitHistory(); }, COMMIT_DEBOUNCE_MS);
    // Optimistic button state: an in-flight edit means undo is already available
    // and the redo tail is about to be dropped — reflect that now rather than
    // leaving the button dead until the debounce fires. commitHistory() (or a
    // flush on undo) reconciles to the true stack state.
    if (history) { bar.setUndoEnabled(true); bar.setRedoEnabled(false); }
  }
  function flushCommit(): void {
    if (commitTimer !== null) { clearTimeout(commitTimer); commitTimer = null; commitHistory(); }
  }
  function applySnapshot(p: Palette): void {
    if (!editor) return;
    applyingHistory = true;
    editor.setPalette(p);                  // does NOT fire onChange (palette-editor.ts)
    bar.setIdentity(currentPalette().name);
    applyingHistory = false;
    scheduleFlameRender();                 // re-render the flame with the restored palette
    syncHistoryButtons();
  }
  function doUndo(): void {
    flushCommit();                         // capture any in-flight edit as the tip first
    const prev = history?.undo();
    if (prev) applySnapshot(prev);
  }
  function doRedo(): void {
    flushCommit();
    const next = history?.redo();
    if (next) applySnapshot(next);
  }
  // Ctrl/Cmd-Z undo · Ctrl/Cmd-Shift-Z (or Ctrl-Y on non-Mac) redo. Scoped to
  // the page lifecycle; removed in destroy(). Ignored while typing in a field
  // or while the naming dialog is open (let native text-undo / the modal win).
  function onHistoryKeyDown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const isUndo = k === 'z' && !e.shiftKey;
    const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && !isMacUA);
    if (!isUndo && !isRedo) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (document.querySelector('.pyr3-naming-dialog')) return;
    e.preventDefault();
    if (isRedo) doRedo(); else doUndo();
  }
  const isMacUA = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);
  document.addEventListener('keydown', onHistoryKeyDown);
  function mountEditor(stops: ColorStop[], name: string): void {
    editorHost.replaceChildren();
    editor = mountPaletteEditor(editorHost, {
      initial: { name, stops },
      onChange: () => {
        scheduleFlameRender();   // #269 — live-update the flame
        scheduleCommit();        // #265 — debounced history snapshot (drag = 1 entry)
      },
    });
    bar.setIdentity(currentPalette().name);   // #353 — sync the read-only chip
    wireBarOverlay();   // #269 Phase 2 — (re)attach the point-to-paint overlay
    // #265 — seed the history stack the first time an editor mounts (so the very
    // first edit undoes back to the starting palette); a later (re)mount with a
    // fresh palette (e.g. Browse/Import before round-trip Modify) is a discrete
    // commit.
    if (!history) { history = createHistory(currentPalette()); syncHistoryButtons(); }
    else commitHistory();
  }

  // #269 Phase 2 — point-to-paint hint is painted ON the gradient bar itself
  // (the [data-role="strip"] the palette editor owns). mountEditor rebuilds the
  // strip on every (re)mount, so wireBarOverlay re-attaches the overlay canvas
  // + scrub listener each time. The overlay is pointer-events:none so the bar's
  // own drag/dblclick handlers stay live.
  const HINT_BINS = 64;
  let hintOverlayCtx: CanvasRenderingContext2D | null = null;

  // #269 Phase 2 — point-to-paint state. The index map is a property of the
  // GEOMETRY, so it survives palette edits: capture ONCE per genome, reuse
  // across recolors. Declared before mountEditor (which wires the bar overlay
  // and reads indexMap via refreshOverlayCapability). Invalidated only when the
  // genome changes (Load flame).
  let indexMap: IndexMap | null = null;
  let indexMapGenome: Genome | null = null;   // identity guard for "capture once"
  let captureNeeded = false;                   // set when a fresh genome renders

  function wireBarOverlay(): void {
    hintOverlayCtx = null;
    const strip = editorHost.querySelector('[data-role="strip"]') as HTMLElement | null;
    if (!strip) return;
    const ov = document.createElement('canvas');
    ov.dataset['role'] = 'bar-hint-overlay';
    ov.width = HINT_BINS; ov.height = 1;   // CSS-stretched over the 40px bar
    Object.assign(ov.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', borderRadius: '3px', imageRendering: 'pixelated',
    });
    strip.appendChild(ov);
    hintOverlayCtx = ov.getContext('2d');
    // Scrub the gradient bar → highlight matching flame regions. Plain hover
    // (no mouse button) doesn't conflict with the strip's mousedown stop-drag.
    strip.addEventListener('mousemove', onBarScrub);
    strip.addEventListener('mouseleave', onBarLeave);
    refreshOverlayCapability();
  }
  function onBarScrub(e: MouseEvent): void {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    paintRegion(t);
  }
  function onBarLeave(): void { paintRegion(null); }

  // Hover-flame hint as a SPOTLIGHT on the bar: dim the gradient zones that do
  // NOT feed the brushed region, leaving the contributing zones bright. Reads
  // as "this part of the gradient colors what you're pointing at."
  function paintHint(hist: Float32Array | null): void {
    if (!hintOverlayCtx) return;
    hintOverlayCtx.clearRect(0, 0, HINT_BINS, 1);
    if (!hist) return;   // not hovering the flame → no dimming, full gradient
    for (let b = 0; b < HINT_BINS; b++) {
      const w = hist[b] ?? 0;
      const dim = 0.62 * (1 - Math.min(1, w));   // w=1 → no dim; w=0 → 0.62 dim
      if (dim <= 0.01) continue;
      hintOverlayCtx.fillStyle = `rgba(8, 8, 12, ${dim})`;
      hintOverlayCtx.fillRect(b, 0, 1, 1);
    }
  }

  if (!roundTrip) {
    // Standalone mode (unchanged): the seed palette is immediately editable.
    mountEditor(seed.stops, seed.name);
  } else if (openInPlace) {
    // #266 — the handed palette is the user's OWN custom gradient (flagged
    // `editable`, or sparse enough to be one). No dense→sparse lossy conversion
    // to protect against, so skip the Modify gate and open it directly editable
    // — "the custom gradient I saved is right here, ready to keep editing."
    mountEditor(seed.stops, seed.name);
  } else {
    // Dense flame palette (256-stop LUT): read-only strip + "Modify gradient"
    // gate — explicit opt-in to the lossy resample. The editor isn't mounted
    // yet; surface the seed name on the bar's read-only identity chip. (#353)
    bar.setIdentity(seed.name);
    const strip = document.createElement('div');
    strip.className = 'pyr3-gradient-readonly-strip';
    Object.assign(strip.style, {
      width: '100%', height: '28px', borderRadius: '3px',
      border: `1px solid ${COLORS.border}`, background: gradientCssFromStops(seed.stops),
      marginBottom: '8px',
    });
    editorHost.appendChild(strip);

    const modifyRow = document.createElement('div');
    const notice = document.createElement('div');   // hidden until Modify clicked
    notice.hidden = true;
    Object.assign(notice.style, {
      fontSize: '12px', color: COLORS.text.muted, margin: '6px 0',
      lineHeight: '1.5',
    });
    notice.append(
      'Modifying converts this flame’s palette into '
      + `${ROUNDTRIP_RESAMPLE_N} editable color stops — a close approximation, `
      + 'not a byte-exact copy of the original gradient.',
    );

    const modifyBtn = buildButton({
      variant: 'accent', label: 'Modify gradient', icon: '✏️',
      onClick: () => { notice.hidden = false; modifyBtn.style.display = 'none'; confirmRow.hidden = false; },
    });
    modifyBtn.dataset['role'] = 'modify';

    const confirmBtn = buildButton({
      variant: 'primary', label: 'Continue',
      onClick: () => {
        const resampled = resampleToN(seed.stops, ROUNDTRIP_RESAMPLE_N);
        editorHost.replaceChildren();              // drop strip + gate
        mountEditor(resampled, seed.name);
      },
    });
    confirmBtn.dataset['role'] = 'modify-confirm';
    const cancelBtn = buildButton({
      variant: 'plain', label: 'Cancel',
      onClick: () => { notice.hidden = true; confirmRow.hidden = true; modifyBtn.style.display = ''; },
    });
    const confirmRow = document.createElement('div');
    confirmRow.hidden = true;
    Object.assign(confirmRow.style, { display: 'flex', gap: '8px', marginBottom: '8px' });
    confirmRow.append(confirmBtn, cancelBtn);

    modifyRow.append(modifyBtn);
    editorHost.append(modifyRow, notice, confirmRow);
  }

  // current palette = the editor's palette. #353 — the name comes from the
  // editor's palette (set via the #346 naming dialog on Save/Export); there is
  // no bar name input. In round-trip mode the editor may not be mounted yet
  // (Modify not pressed) — fall back to the seed so Apply-without-Modify sends
  // the original untouched palette (#266).
  function currentPalette(): Palette {
    if (editor) {
      const p = editor.getPalette();
      return { ...p, name: p.name?.trim() || seed.name || 'untitled' };
    }
    return { ...seed, name: seed.name || 'untitled' };
  }

  // Set a palette into the live editor, mounting it first if it isn't up yet
  // (round-trip mode before Modify — Browse / Import replace the read-only
  // strip with an editable editor). #266 — and refresh the bar identity chip.
  function setPaletteOrMount(p: Palette): void {
    if (editor) {
      // #265 — a discrete palette swap on a live editor. setPalette doesn't fire
      // onChange, so flush any pending in-flight edit then record this as its own
      // undoable entry. (When the editor isn't up yet, mountEditor handles the
      // history seed/commit itself.)
      flushCommit();
      editor.setPalette(p);
      bar.setIdentity(currentPalette().name);
      commitHistory();
    } else {
      mountEditor(p.stops, p.name);
      bar.setIdentity(currentPalette().name);
    }
  }

  // action handlers — wired into the bar's verb callbacks (#353).
  let picker: PalettePickerHandle | null = null;
  function closePicker(): void { if (picker) { picker.destroy(); picker = null; } }
  function openBrowse(): void {
    if (picker) { closePicker(); return; }
    picker = mountPalettePicker(document.body, {
      current: { kind: 'flam3', number: 0 },
      onApply: (src: PaletteSource) => {
        let stops; let name = 'imported';
        if (src.kind === 'flam3') { stops = getLibraryStops(src.number) ?? undefined; name = `flame #${src.number}`; }
        else if (src.kind === 'mine') { const m = getMine(src.name); stops = m?.stops; name = src.name; }
        if (stops) { setPaletteOrMount({ name, stops }); setStatus(`Loaded "${name}"`); }
      },
      onClose: () => { closePicker(); },
    });
  }
  async function doSave(): Promise<void> {
    // #346 — save-time naming dialog. Library palettes have no file, so the
    // dialog shows only the palette-name field; its name becomes the library key.
    const p = currentPalette();
    const res = await openNamingDialog({ kind: 'palette-library', seed: { name: p.name } });
    if (!res) return;
    saveMine({ name: res.name, stops: p.stops, hue: p.hue, mode: p.mode });
    setStatus(`Saved "${res.name}" to your library`);
  }
  async function doExport(): Promise<void> {
    // #346 — palette-export dialog: palette name + filename (no nick).
    const p = currentPalette();
    const res = await openNamingDialog({
      kind: 'palette-export',
      seed: { name: p.name, filename: p.name },
      ext: 'pyre-palette.json',
    });
    if (!res) return;
    exportPalette({ ...p, name: res.name }, res.filename);
  }
  function doReset(): void {
    closePicker();
    // Round-trip mode, still behind the Modify gate (editor not mounted): Reset
    // must NOT mount a live editor — that would silently bypass the lossy-
    // conversion notice. Leave the read-only strip + gate intact; only restore
    // the bar's identity chip to the seed name. (#266 review fix / #353)
    if (roundTrip && editor === null) {
      bar.setIdentity(seed.name);
      setStatus('Reset to the starting palette');
      return;
    }
    setPaletteOrMount(seed);
    setStatus('Reset to the starting palette');
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    importPalette(f)
      .then((p) => { setPaletteOrMount(p); setStatus(`Imported "${p.name}"`); })
      .catch((err: Error) => setStatus(err.message))
      .finally(() => { fileInput.value = ''; });
  });

  // #353 — the load/library/file action verbs (+ Apply/Cancel round-trip CTAs)
  // now live in the shared bar (mountGradientBar). The page keeps only the
  // hidden file <input>s the bar's onLoadFlame / onImport callbacks trigger.

  // #269 — "Load flame…" — open a flame file, render it, adopt its palette.
  const loadFlameInput = document.createElement('input');
  loadFlameInput.type = 'file';
  loadFlameInput.accept = '.pyr3.json,.json,.flame,.flam3,.png,application/xml,text/xml';
  loadFlameInput.hidden = true;
  loadFlameInput.addEventListener('change', () => {
    const f = loadFlameInput.files?.[0];
    if (!f) return;
    loadFlameFile(f)
      .then((res) => {
        currentFlame = res.genome;                 // adopt + render
        setPaletteOrMount(res.genome.palette);     // override the bar (sets identity)
        renderFlame();
        setStatus(`Loaded flame "${f.name}"`);
      })
      .catch((err: Error) => setStatus(err.message))
      .finally(() => { loadFlameInput.value = ''; });
  });

  // #269 — flame body below the editor; editorHost was appended to `wrap`
  // earlier — re-parent it into the editor column (appendChild moves nodes).
  const topZone = document.createElement('div');
  topZone.dataset['zone'] = 'top';
  Object.assign(topZone.style, { display: 'flex', gap: '16px', alignItems: 'flex-start' });

  const editorCol = document.createElement('div');
  Object.assign(editorCol.style, { flex: '1 1 0', minWidth: '0' });
  // #269 Phase 2 — persistent teaching caption under the bar (the interactions
  // aren't obvious; the transient status line only shows after you act).
  const barHint = document.createElement('div');
  barHint.dataset['role'] = 'point-to-paint-hint';
  Object.assign(barHint.style, {
    fontSize: '11px', lineHeight: '1.5', color: COLORS.text.muted, margin: '2px 0 0',
  });
  const barHintLead = document.createElement('strong');
  barHintLead.textContent = 'Point-to-paint:';
  barHintLead.style.color = COLORS.text.primary;
  barHint.append(
    '🎯 ', barHintLead,
    ' hover the flame to spotlight where it maps on this bar · '
    + 'hover the bar to highlight those flame regions · '
    + 'click a flame spot to select its stop · double-click to add one.',
  );
  // #353 — the actions column moved to the shared bar; the body is now just
  // the editor column (editor + point-to-paint hint) with the hidden file
  // <input>s parked in the subtree so the bar's callbacks can trigger them.
  editorCol.append(editorHost, barHint, fileInput, loadFlameInput);

  topZone.append(editorCol);

  // #269 — flame zone: render the flame below the bar (device-optional).
  const flameZone = document.createElement('div');
  flameZone.dataset['zone'] = 'flame';
  Object.assign(flameZone.style, { marginTop: '16px' });

  let currentFlame: Genome | null = handoffGenome;   // the flame to render (null = none)
  let renderer: Renderer | null = null;
  let runHandle: RunHandle | null = null;
  let flameCtx: GPUCanvasContext | null = null;      // configured once (constant dims)
  // (indexMap / indexMapGenome / captureNeeded declared above, before mountEditor.)

  const placeholder = document.createElement('div');
  placeholder.dataset['role'] = 'flame-placeholder';
  // Sell the point-to-paint value, not just "see your palette" (#269 Phase 2).
  placeholder.textContent =
    'Load a flame ("Load flame… 🔥") to paint with it: hover the flame to see '
    + 'which gradient colors land where, click a spot to jump to its stop, and '
    + 'double-click to add one — so recoloring stops being guesswork.';
  Object.assign(placeholder.style, {
    color: COLORS.text.muted, fontSize: '13px', padding: '24px', textAlign: 'center',
  });

  const flameCanvas = document.createElement('canvas');
  flameCanvas.dataset['role'] = 'flame-canvas';
  Object.assign(flameCanvas.style, {
    width: '100%', maxWidth: '512px', display: 'block', margin: '0 auto', borderRadius: '4px',
  });

  const FLAME_DIM = 384;            // preview size; aspect refinement can come later
  const FLAME_PREVIEW_SPP = 16;     // browser preview cap (#211)

  // #269 Phase 2 — re-evaluate which point-to-paint affordances are live once
  // the index map exists. The mousemove/dblclick handlers read `indexMap`
  // directly, so this is a hook for cursor/label affordances; kept minimal.
  function refreshOverlayCapability(): void {
    // Cursor affordance: crosshair on the gradient bar once the map is live
    // (signals it's scrubbable for region highlight).
    const strip = editorHost.querySelector('[data-role="strip"]') as HTMLElement | null;
    if (strip) strip.style.cursor = indexMap ? 'crosshair' : '';
  }

  // #269 Phase 2 — placeholder and flameStack both live in flameZone (mounted
  // below); toggle visibility instead of swapping children, so the overlay
  // canvas + flame canvas stay in the DOM (and re-rendering doesn't thrash the
  // node tree). Returns true when the flame is being shown.
  function showFlame(on: boolean): void {
    placeholder.style.display = on ? 'none' : '';
    flameStack.style.display = on ? '' : 'none';
  }

  function renderFlame(): void {
    if (!opts.device || !opts.format || !currentFlame) {
      runHandle?.cancel(); runHandle = null;
      showFlame(false);
      return;
    }
    showFlame(true);
    // Configure the canvas context ONCE — dims are constant, so re-setting
    // canvas.width / re-configuring per edit would thrash the swap chain.
    if (!flameCtx) {
      flameCanvas.width = FLAME_DIM; flameCanvas.height = FLAME_DIM;
      flameCtx = flameCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!flameCtx) { showFlame(false); return; }
      flameCtx.configure({ device: opts.device, format: opts.format, alphaMode: 'opaque' });
    }
    const ctx = flameCtx;
    if (!renderer) renderer = createRenderer(opts.device, opts.format, { width: FLAME_DIM, height: FLAME_DIM });

    // #269 Phase 2 — (re)capture the index map only when the genome itself
    // changed. Palette edits keep the same genome identity → reuse the cached
    // map (the index is geometry, not color, so recoloring never moves it).
    if (currentFlame !== indexMapGenome) {
      indexMap = null;
      indexMapGenome = currentFlame;
      captureNeeded = true;
      renderer.setCaptureIndex(true);
      refreshOverlayCapability();
    } else {
      renderer.setCaptureIndex(false);
    }

    runHandle?.cancel();
    // Bake the CURRENT bar palette into the genome so the flame shows it.
    const g: Genome = { ...currentFlame, palette: currentPalette() };
    runHandle = startChunkedRender({
      renderer,
      genome: g,
      outputViewProvider: () => ctx.getCurrentTexture().createView(),
      targetSamples: FLAME_PREVIEW_SPP * FLAME_DIM * FLAME_DIM,
      seedBase: 1,
      onProgress: () => {},
    });
    if (captureNeeded) {
      const r = renderer;
      const handleAtStart = runHandle;
      void runHandle.promise.then(async (outcome) => {
        // Ignore if a newer render superseded this one (palette drag / reload).
        if (outcome !== 'completed' || runHandle !== handleAtStart) return;
        const { idxSum, count, width, height } = await r.readIndexMap();
        indexMap = downsampleIndexMap(idxSum, count, width, height, FLAME_DIM, FLAME_DIM);
        captureNeeded = false;
        refreshOverlayCapability();   // affordances live now the map exists
      });
    }
  }

  // Debounce flame re-renders during a palette drag (a full re-iterate is
  // needed since RGB is baked at splat time — present-only won't reflect it).
  let _flameTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleFlameRender(): void {
    if (_flameTimer) clearTimeout(_flameTimer);
    _flameTimer = setTimeout(() => { _flameTimer = null; renderFlame(); }, 250);
  }

  // ────────────────────────────────────────────────────────────────────────
  // #269 Phase 2 — point-to-paint interactions, built on the cached index map.
  // The flame→bar hint (paintHint) + bar→flame scrub (wireBarOverlay) live up
  // near mountEditor (they re-bind to the editor strip per (re)mount). Below:
  // the flame-side overlay canvas + its region painter.
  // ────────────────────────────────────────────────────────────────────────

  // Scrub the gradient bar → highlight matching flame regions on a 2D overlay
  // layered over the flame (pointer-events:none → never eats flame mouse
  // events). flameStack wraps the flame + overlay for absolute layering.
  const flameStack = document.createElement('div');
  Object.assign(flameStack.style, { position: 'relative', maxWidth: '512px', margin: '0 auto' });
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.dataset['role'] = 'flame-overlay';
  overlayCanvas.width = FLAME_DIM; overlayCanvas.height = FLAME_DIM;
  Object.assign(overlayCanvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    display: 'block', pointerEvents: 'none', borderRadius: '4px',
  });
  // flameCanvas fills the stack; the stack owns the centering + max width.
  Object.assign(flameCanvas.style, { width: '100%', maxWidth: 'none', margin: '0' });
  flameStack.append(flameCanvas, overlayCanvas);
  // Both placeholder + flameStack live in flameZone from mount; renderFlame's
  // showFlame() toggles which is visible (keeps the overlay in the DOM).
  flameStack.style.display = 'none';
  flameZone.append(placeholder, flameStack);

  const overlayCtx = overlayCanvas.getContext('2d');
  const REGION_EPSILON = 0.03;   // ±3% of the index range; tunable
  function paintRegion(stopIndex: number | null): void {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, FLAME_DIM, FLAME_DIM);
    if (stopIndex === null || !indexMap) return;
    const mask = regionMask(indexMap, stopIndex, REGION_EPSILON);
    const img = overlayCtx.createImageData(FLAME_DIM, FLAME_DIM);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        // Bright cyan highlight at moderate alpha → matching regions pop.
        img.data[i * 4 + 0] = 80; img.data[i * 4 + 1] = 240; img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 150;
      }
    }
    overlayCtx.putImageData(img, 0, 0);
  }

  // Listeners attached once — the canvas + strip elements are stable across
  // re-renders. All read `indexMap` directly (no-op until the map is captured).
  const FLAME_BRUSH_RADIUS = 10;   // px in FLAME_DIM space
  const STOP_DEDUP = 0.02;         // don't duplicate within 2% of an existing stop
  flameCanvas.addEventListener('mousemove', (e) => {
    if (!indexMap) { paintHint(null); return; }
    const px = clientToPixel(flameCanvas.getBoundingClientRect(), e.clientX, e.clientY, FLAME_DIM, FLAME_DIM);
    if (!px) { paintHint(null); return; }
    paintHint(brushHistogram(indexMap, px.ox, px.oy, FLAME_BRUSH_RADIUS, HINT_BINS));
  });
  flameCanvas.addEventListener('mouseleave', () => paintHint(null));

  // avg index at client coords, or null if off-canvas / an empty (no-hit) pixel.
  function indexAtClient(clientX: number, clientY: number): number | null {
    if (!indexMap) return null;
    const px = clientToPixel(flameCanvas.getBoundingClientRect(), clientX, clientY, FLAME_DIM, FLAME_DIM);
    if (!px) return null;
    const o = px.oy * FLAME_DIM + px.ox;
    return indexMap.mask[o] ? indexMap.avg[o]! : null;
  }

  // Interaction: single click on the flame → if the point maps to an existing
  // stop with high precision, select that stop on the bar AND open its color
  // picker (ready to recolor). Deferred behind a short timer so a
  // double-click-to-add cancels it (no picker pop mid-add).
  const SELECT_PRECISION = 0.04;   // within 4% of a stop's index → "maps to it"
  const DBLCLICK_GUARD_MS = 250;
  let pendingClick: ReturnType<typeof setTimeout> | null = null;
  flameCanvas.addEventListener('click', (e) => {
    if (!editor) return;
    const cx = e.clientX, cy = e.clientY;   // capture before the deferred fire
    if (pendingClick) clearTimeout(pendingClick);
    pendingClick = setTimeout(() => {
      pendingClick = null;
      const ed = editor;
      if (!ed) return;
      const t = indexAtClient(cx, cy);
      if (t === null) return;
      const stops = currentPalette().stops;
      let best = -1;
      let bestD = SELECT_PRECISION;
      stops.forEach((s, i) => { const d = Math.abs(s.t - t); if (d <= bestD) { bestD = d; best = i; } });
      if (best >= 0) {
        ed.selectStop(best);   // highlights + opens the HSV picker on that stop
        setStatus(`Selected the stop at ${(stops[best]!.t * 100).toFixed(0)}% — recolor it to repaint this region.`);
      } else {
        setStatus(`This region maps to ~${(t * 100).toFixed(0)}% of the gradient — double-click to add a stop there.`);
      }
    }, DBLCLICK_GUARD_MS);
  });

  // Interaction 3 — double-click the flame → add a stop at that region's index.
  flameCanvas.addEventListener('dblclick', (e) => {
    if (pendingClick) { clearTimeout(pendingClick); pendingClick = null; }  // cancel the pending select
    if (!indexMap || !editor) return;   // need a map + a live editable bar
    const px = clientToPixel(flameCanvas.getBoundingClientRect(), e.clientX, e.clientY, FLAME_DIM, FLAME_DIM);
    if (!px) return;
    const o = px.oy * FLAME_DIM + px.ox;
    if (!indexMap.mask[o]) { setStatus('That spot is empty — no color to map.'); return; }
    const t = indexMap.avg[o]!;
    const pal = currentPalette();
    const rgb = colorAtIndex(pal.stops, pal.hue ?? 0, pal.mode ?? 'linear', t);
    const res = insertStopAtIndex(pal.stops, t, rgb, STOP_DEDUP);
    if (res.selectedExisting) { setStatus(`A stop already maps near here (${(t * 100).toFixed(0)}%).`); return; }
    flushCommit();
    editor.setPalette({ ...pal, stops: res.stops });
    setStatus(`Added a stop at ${(t * 100).toFixed(0)}% — recolor it to repaint that region.`);
    scheduleFlameRender();   // same genome identity → reuses the cached map
    commitHistory();         // #265 — paint-add is a discrete undoable entry
  });
  // (bar scrub → flame region highlight is wired in wireBarOverlay, attached to
  // the gradient bar strip on each editor (re)mount.)

  wrap.append(topZone, flameZone);

  // #353 — the body mounts into the shared bar's middleSlot (below the bar rows).
  bar.middleSlot.appendChild(wrap);
  renderFlame();   // paint the flame (or placeholder) once mounted

  return {
    destroy(): void {
      closePicker();
      document.removeEventListener('keydown', onHistoryKeyDown);   // #265
      if (commitTimer !== null) clearTimeout(commitTimer);          // #265
      if (_flameTimer) clearTimeout(_flameTimer);
      if (pendingClick) clearTimeout(pendingClick);
      runHandle?.cancel();
      renderer?.destroy();        // release GPU buffers (every renderer surface must)
      if (editor) editor.destroy();
      indexMap = null; indexMapGenome = null;   // #269 Phase 2 — drop the cache
      wrap.remove();
      bar.destroy();              // #353 — tear down the shared bar chrome
    },
  };
}
