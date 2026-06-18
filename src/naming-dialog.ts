import { COLORS } from './ui-tokens';
import { buildButton } from './edit-primitives';

export type NamingKind = 'render' | 'flame' | 'palette-library' | 'palette-export';

export interface NamingFieldSeed { name?: string; nick?: string; filename?: string }

export interface NamingDialogOpts {
  kind: NamingKind;
  seed: NamingFieldSeed;
  /** Optional filename template → live "→ resolved.ext" preview under the field. */
  template?: string;
  computePreview?: (template: string) => string | null;
  ext?: string;
}

export interface NamingResult { name: string; nick: string; filename: string }

interface FieldConfig { name: boolean; nick: boolean; filename: boolean; nameLabel: string }

function fieldsFor(kind: NamingKind): FieldConfig {
  switch (kind) {
    case 'render':
    case 'flame':
      return { name: true, nick: true, filename: true, nameLabel: 'flame name' };
    case 'palette-export':
      return { name: true, nick: false, filename: true, nameLabel: 'palette name' };
    case 'palette-library':
      return { name: true, nick: false, filename: false, nameLabel: 'palette name' };
  }
}

function labeledInput(labelText: string, role: string, value: string): { row: HTMLElement; input: HTMLInputElement } {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px' });
  const label = document.createElement('span');
  label.dataset['role'] = `${role}-label`;
  label.textContent = labelText;
  Object.assign(label.style, { fontSize: '12px', color: COLORS.text.muted, width: '84px', flex: '0 0 auto' });
  const input = document.createElement('input');
  input.type = 'text';
  input.dataset['role'] = role;
  input.value = value;
  Object.assign(input.style, {
    flex: '1 1 0', background: COLORS.bg.input, color: COLORS.text.primary,
    border: `1px solid ${COLORS.border}`, borderRadius: '3px', padding: '5px 8px', font: 'inherit',
  });
  row.append(label, input);
  return { row, input };
}

/** Open the save-time naming modal. Resolves the chosen values on Save, or
 *  null on Cancel / Escape / outside-click (mousedown-origin). */
export function openNamingDialog(opts: NamingDialogOpts): Promise<NamingResult | null> {
  const cfg = fieldsFor(opts.kind);
  return new Promise<NamingResult | null>((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)', zIndex: '200',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    const box = document.createElement('div');
    box.className = 'pyr3-naming-dialog';
    Object.assign(box.style, {
      minWidth: '360px', maxWidth: '90vw', padding: '18px 18px 14px',
      background: COLORS.bg.bar, color: COLORS.text.primary,
      border: `1px solid ${COLORS.border}`, borderRadius: '6px', boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
    });
    const title = document.createElement('h2');
    title.textContent = opts.kind === 'palette-library' ? 'Save palette' : 'Name your save';
    Object.assign(title.style, { fontSize: '15px', margin: '0 0 14px', color: COLORS.flame.top });
    box.append(title);

    const nameF = labeledInput(cfg.nameLabel, 'name', opts.seed.name ?? '');
    box.append(nameF.row);
    let nickF: { row: HTMLElement; input: HTMLInputElement } | null = null;
    if (cfg.nick) { nickF = labeledInput('nick', 'nick', opts.seed.nick ?? ''); box.append(nickF.row); }

    let filenameF: { row: HTMLElement; input: HTMLInputElement } | null = null;
    if (cfg.filename) {
      filenameF = labeledInput('filename', 'filename', opts.seed.filename ?? '');
      box.append(filenameF.row);
      const preview = document.createElement('div');
      preview.dataset['role'] = 'filename-preview';
      Object.assign(preview.style, { fontSize: '11px', color: COLORS.text.muted, margin: '-4px 0 10px 92px' });
      box.append(preview);
      const ext = opts.ext ? `.${opts.ext}` : '';
      const renderPreview = (): void => {
        const resolved = opts.computePreview?.(filenameF!.input.value) ?? null;
        preview.textContent = resolved !== null ? `→ ${resolved}${ext}` : '';
        preview.style.display = resolved !== null ? '' : 'none';
      };
      filenameF.input.addEventListener('input', renderPreview);
      renderPreview();
    }

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '6px' });
    const cancelBtn = buildButton({ variant: 'plain', label: 'Cancel', onClick: () => settle(null) });
    cancelBtn.dataset['role'] = 'cancel';
    const saveBtn = buildButton({ variant: 'primary', label: 'Save', onClick: () => commit() });
    saveBtn.dataset['role'] = 'save';
    btnRow.append(cancelBtn, saveBtn);
    box.append(btnRow);

    backdrop.append(box);
    document.body.append(backdrop);
    nameF.input.focus();

    function commit(): void {
      settle({
        name: nameF.input.value.trim(),
        nick: nickF?.input.value.trim() ?? '',
        filename: filenameF?.input.value.trim() ?? '',
      });
    }
    let settled = false;
    function settle(result: NamingResult | null): void {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('mousedown', onBackdropDown);
      backdrop.remove();
      resolve(result);
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') settle(null);
      else if (e.key === 'Enter') commit();
    };
    // Outside-click = cancel, gated on mousedown-origin (dismiss-memory trap-safe).
    const onBackdropDown = (e: MouseEvent): void => { if (e.target === backdrop) settle(null); };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', onBackdropDown);
  });
}
