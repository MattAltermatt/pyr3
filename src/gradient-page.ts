import { type Palette, type ColorStop, PYRE_PALETTE } from './palette';
import { mountPaletteEditor } from './palette-editor';
import { mountPalettePicker, type PalettePickerHandle } from './palette-picker';
import { type PaletteSource } from './flam3-palette-names';
import { getLibraryStops } from './flam3-palettes';
import { getMine, saveMine } from './palette-library';
import { exportPalette, importPalette } from './palette-file';
import { buildButton } from './edit-primitives';
import { COLORS } from './ui-tokens';
import { consumeGradientHandoff, writeGradientReturn } from './edit-state';
import { resampleToN } from './palette-transforms';

export interface GradientPageOpts { root: HTMLElement; initialPalette?: Palette; }
export interface GradientPageHandle { destroy(): void }

// Overridable for tests — real nav returns to the editor page.
export const gradReturnNav = {
  go(): void { window.location.href = '/v1/edit'; },
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
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    maxWidth: '760px', margin: '0 auto', padding: '24px 16px', color: COLORS.text.primary,
  });

  const title = document.createElement('h1');
  title.textContent = 'Gradient editor';
  Object.assign(title.style, { fontSize: '18px', margin: '0 0 8px', color: COLORS.flame.top });
  wrap.appendChild(title);

  // basic instructions (collapsible, open by default)
  const help = document.createElement('details');
  help.open = true;
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
  );
  help.append(summary, helpBody);
  wrap.appendChild(help);

  // name row
  const nameRow = document.createElement('div');
  Object.assign(nameRow.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' });
  const nameLabel = document.createElement('span');
  nameLabel.textContent = 'name';
  Object.assign(nameLabel.style, { fontSize: '12px', color: COLORS.text.muted, width: '48px' });
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.dataset['role'] = 'name';
  nameInput.placeholder = 'palette name';
  Object.assign(nameInput.style, {
    flex: '1 1 0', background: COLORS.bg.input, color: COLORS.text.primary,
    border: `1px solid ${COLORS.border}`, borderRadius: '3px', padding: '4px 8px',
  });
  nameRow.append(nameLabel, nameInput);
  wrap.appendChild(nameRow);

  // editor — `seed` is the palette the page opened with; Reset restores it.
  // #266 — if a flame's palette was handed off from /v1/edit, enter round-trip
  // mode: the flame's palette opens read-only behind a "Modify gradient" gate
  // (explicit opt-in to a lossy resample) plus an "Apply to flame" return.
  const handoff = consumeGradientHandoff();      // null in standalone mode
  const roundTrip = handoff !== null;
  const seed: Palette = handoff?.palette ?? opts.initialPalette ?? PYRE_PALETTE;

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

  const editorHost = document.createElement('div');
  wrap.appendChild(editorHost);

  let editor: ReturnType<typeof mountPaletteEditor> | null = null;
  function mountEditor(stops: ColorStop[], name: string): void {
    editorHost.replaceChildren();
    editor = mountPaletteEditor(editorHost, {
      initial: { name, stops },
      onChange: () => {},
    });
    nameInput.value = name;
  }

  if (!roundTrip) {
    // Standalone mode (unchanged): the seed palette is immediately editable.
    mountEditor(seed.stops, seed.name);
    if (opts.initialPalette?.name) nameInput.value = opts.initialPalette.name;
  } else if (openInPlace) {
    // #266 — the handed palette is the user's OWN custom gradient (flagged
    // `editable`, or sparse enough to be one). No dense→sparse lossy conversion
    // to protect against, so skip the Modify gate and open it directly editable
    // — "the custom gradient I saved is right here, ready to keep editing."
    nameInput.value = seed.name;
    mountEditor(seed.stops, seed.name);
  } else {
    // Dense flame palette (256-stop LUT): read-only strip + "Modify gradient"
    // gate — explicit opt-in to the lossy resample.
    nameInput.value = seed.name;
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

  // status line
  const status = document.createElement('div');
  Object.assign(status.style, { fontSize: '12px', color: COLORS.text.muted, minHeight: '16px', margin: '8px 0' });
  function setStatus(msg: string): void { status.textContent = msg; }

  // current palette = editor stops + the name field. In round-trip mode the
  // editor may not be mounted yet (Modify not pressed) — fall back to the seed
  // so Apply-without-Modify sends the original untouched palette (#266).
  function currentPalette(): Palette {
    if (editor) {
      const p = editor.getPalette();
      return { ...p, name: nameInput.value.trim() || p.name || 'untitled' };
    }
    return { ...seed, name: nameInput.value.trim() || seed.name };
  }

  // Set a palette into the live editor, mounting it first if it isn't up yet
  // (round-trip mode before Modify — Browse / Import replace the read-only
  // strip with an editable editor). #266
  function setPaletteOrMount(p: Palette): void {
    if (editor) { editor.setPalette(p); nameInput.value = p.name; }
    else { mountEditor(p.stops, p.name); }
  }

  // actions
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
  function doSave(): void {
    const p = currentPalette();
    saveMine({ name: p.name, stops: p.stops, hue: p.hue, mode: p.mode });
    setStatus(`Saved "${p.name}" to your library`);
  }
  function doExport(): void { exportPalette(currentPalette()); }
  function doReset(): void {
    closePicker();
    // Round-trip mode, still behind the Modify gate (editor not mounted): Reset
    // must NOT mount a live editor — that would silently bypass the lossy-
    // conversion notice. Only the name field is mutable pre-Modify, so restore
    // it and leave the read-only strip + gate intact. (#266 review fix)
    if (roundTrip && editor === null) {
      nameInput.value = seed.name;
      setStatus('Reset to the starting palette');
      return;
    }
    setPaletteOrMount(seed);
    nameInput.value = roundTrip ? seed.name : (opts.initialPalette?.name ?? '');
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

  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' });
  const browse = buildButton({ variant: 'primary', label: 'Browse library…', onClick: openBrowse });
  browse.dataset['role'] = 'browse';
  const save = buildButton({ variant: 'accent', label: 'Save to library', onClick: doSave });
  save.dataset['role'] = 'save';
  const exportBtn = buildButton({ variant: 'plain', label: 'Export .json', onClick: doExport });
  exportBtn.dataset['role'] = 'export';
  const importBtn = buildButton({ variant: 'plain', label: 'Import…', onClick: () => fileInput.click() });
  importBtn.dataset['role'] = 'import';
  const resetBtn = buildButton({ variant: 'plain', label: '↺ Reset', onClick: doReset });
  resetBtn.dataset['role'] = 'reset';
  resetBtn.style.marginLeft = 'auto'; // push Reset to the far end, away from constructive actions
  actions.append(browse, save, exportBtn, importBtn, resetBtn, fileInput);

  // #266 — round-trip mode adds an "Apply to flame" CTA that leads the row;
  // it writes the (possibly untouched) palette back for /v1/edit to consume.
  if (roundTrip) {
    // "Cancel, return to flame" — navigate back WITHOUT writing a return, so
    // the flame keeps its current palette untouched. (#266)
    const cancelBtn = buildButton({
      variant: 'plain', label: 'Cancel, return to flame', icon: '✕',
      onClick: () => { gradReturnNav.go(); },
    });
    cancelBtn.dataset['role'] = 'cancel-return';
    actions.insertBefore(cancelBtn, actions.firstChild);

    const applyBtn = buildButton({
      variant: 'primary', label: 'Apply to flame', icon: '✓',
      onClick: () => { writeGradientReturn(currentPalette()); gradReturnNav.go(); },
    });
    applyBtn.dataset['role'] = 'apply';
    actions.insertBefore(applyBtn, actions.firstChild);  // lead the row
  }

  wrap.appendChild(actions);
  wrap.appendChild(status);

  opts.root.appendChild(wrap);

  return {
    destroy(): void {
      closePicker();
      if (editor) editor.destroy();
      wrap.remove();
    },
  };
}
