import { type Palette, PYRE_PALETTE } from './palette';
import { mountPaletteEditor } from './palette-editor';
import { mountPalettePicker, type PalettePickerHandle } from './palette-picker';
import { type PaletteSource } from './flam3-palette-names';
import { getLibraryStops } from './flam3-palettes';
import { getMine, saveMine } from './palette-library';
import { exportPalette, importPalette } from './palette-file';
import { buildButton } from './edit-primitives';
import { COLORS } from './ui-tokens';

export interface GradientPageOpts { root: HTMLElement; initialPalette?: Palette; }
export interface GradientPageHandle { destroy(): void }

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
  const seed: Palette = opts.initialPalette ?? PYRE_PALETTE;
  const editorHost = document.createElement('div');
  wrap.appendChild(editorHost);
  const editor = mountPaletteEditor(editorHost, {
    initial: seed,
    onChange: () => {},
  });
  if (opts.initialPalette?.name) nameInput.value = opts.initialPalette.name;

  // status line
  const status = document.createElement('div');
  Object.assign(status.style, { fontSize: '12px', color: COLORS.text.muted, minHeight: '16px', margin: '8px 0' });
  function setStatus(msg: string): void { status.textContent = msg; }

  // current palette = editor stops + the name field
  function currentPalette(): Palette {
    const p = editor.getPalette();
    return { ...p, name: nameInput.value.trim() || p.name || 'untitled' };
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
        if (stops) { editor.setPalette({ name, stops }); nameInput.value = name; setStatus(`Loaded "${name}"`); }
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
    editor.setPalette(seed);
    nameInput.value = opts.initialPalette?.name ?? '';
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
      .then((p) => { editor.setPalette(p); nameInput.value = p.name; setStatus(`Imported "${p.name}"`); })
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
  wrap.appendChild(actions);
  wrap.appendChild(status);

  opts.root.appendChild(wrap);

  return {
    destroy(): void {
      closePicker();
      editor.destroy();
      wrap.remove();
    },
  };
}
