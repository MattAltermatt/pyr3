import { COLORS } from './ui-tokens';
import { buildButton } from './edit-primitives';

export type NamingKind = 'render' | 'flame' | 'palette-library' | 'palette-export';

export interface NamingFieldSeed { name?: string; nick?: string; filename?: string }

export interface NamingDialogOpts {
  kind: NamingKind;
  seed: NamingFieldSeed;
  ext?: string;
}

/** Filename-safe slug — mirrors edit-mount.ts `slugify` (kept local so the
 *  dialog has no dependency on the heavy editor module). The `filename` field
 *  auto-follows `slug(flame name)` until the user edits it manually (#357). */
function slugForFilename(name: string): string {
  const cleaned = (name || 'flame').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'flame';
}

// #368 — when the user submits the Save dialog with no filename, fall back to a
// timestamped default so the download is never blank / a dotfile. The default
// is shown as the filename field's placeholder and used verbatim on an empty
// submit; the two are kept in lockstep so what's shown is what's saved.

/** Local clock as `YYYYMMDD-HHMMSS` — filesystem-safe (no `:`), sortable, and
 *  second-resolution so repeated blank saves don't collide. */
export function formatSaveTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** A filename part that keeps the source recognizable: lowercased, internal
 *  dots preserved (ESF nicks like `electricsheep.247.19679`), every other run
 *  of unsafe chars collapsed to `-`, and no leading dot/dash (no dotfiles). */
function sanitizeFilenamePart(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^[-.]+/, '').replace(/-+$/, '');
}

/** Compute the default filename base (no extension) for a blank submit:
 *  `<nick | slug(real name) | 'flame'>-<timestamp>`. Nick wins (it names the
 *  source); a placeholder/blank name contributes nothing, leaving the generic
 *  `flame-` prefix. */
export function defaultFilenameBase(id: { name?: string; nick?: string }, d: Date): string {
  const fromNick = sanitizeFilenamePart(id.nick);
  const fromName = isPlaceholderName(id.name) ? '' : sanitizeFilenamePart(id.name);
  const prefix = fromNick || fromName || 'flame';
  return `${prefix}-${formatSaveTimestamp(d)}`;
}

export interface NamingResult { name: string; nick: string; filename: string }

// #434 — remember the last-entered nick across save dialogs, so a nick the user
// typed persists to the next save even when no flame name was given and the nick
// never landed on a genome. Uses globalThis.localStorage (not bare localStorage)
// to stay off the SEAM_EXEMPT list. Only non-empty nicks are stored; a blank save
// leaves the remembered nick intact rather than wiping it.
const LAST_NICK_KEY = 'pyr3.naming.lastNick';

/** The last non-empty nick the user entered in any save dialog, or '' if none /
 *  storage is unavailable. */
export function readLastNick(): string {
  try { return globalThis.localStorage?.getItem(LAST_NICK_KEY) ?? ''; } catch { return ''; }
}

/** Persist `nick` (trimmed) as the sticky last-nick. A blank/whitespace nick is
 *  a no-op so it never clobbers a previously remembered one. */
export function writeLastNick(nick: string): void {
  const trimmed = nick.trim();
  if (!trimmed) return;
  try { globalThis.localStorage?.setItem(LAST_NICK_KEY, trimmed); } catch { /* storage disabled / quota */ }
}

/** #362 — a flame with no meaningful user/source name: empty, whitespace, or a
 *  generated placeholder (`generateRandomGenome` stamps `'Untitled flame'` on
 *  Surprise / reroll / new flames). These open the naming dialog with a blank
 *  slate so the user names the flame; flames carrying a real name (loaded files,
 *  corpus sheep, previously-named saves) preserve their identity fields. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return n === '' || n === 'untitled' || n === 'untitled flame';
}

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

    // #362 — fresh/unnamed flames open with a blank slate; real names preserve
    // their identity fields (name, nick, filename).
    const fresh = isPlaceholderName(opts.seed.name);
    const nameF = labeledInput(cfg.nameLabel, 'name', fresh ? '' : (opts.seed.name ?? ''));
    box.append(nameF.row);
    let nickF: { row: HTMLElement; input: HTMLInputElement } | null = null;
    if (cfg.nick) {
      // #434 — precedence: a real flame's own nick wins; otherwise fall back to
      // the sticky last-entered nick (which is '' if never set). #362 keeps a
      // fresh flame's genome identity blank, but the user's sticky nick still
      // persists — that's the "remember the nick even with no flame name" ask.
      const seedNick = opts.seed.nick ?? '';
      const initialNick = (!fresh && seedNick.trim()) ? seedNick : readLastNick();
      nickF = labeledInput('nick', 'nick', initialNick);
      box.append(nickF.row);
    }

    // #368 — capture the dialog-open time once so the placeholder shown and the
    // value used on an empty submit are byte-identical.
    const openedAt = new Date();
    let filenameF: { row: HTMLElement; input: HTMLInputElement } | null = null;
    if (cfg.filename) {
      filenameF = labeledInput('filename', 'filename', fresh ? '' : (opts.seed.filename ?? ''));
      box.append(filenameF.row);
      // #368 — show the timestamped default as the placeholder so an empty Save
      // produces a sensible name (never a blank `.png` dotfile). Tracks the live
      // name/nick so the hint reflects whatever identity the user has typed.
      const syncDefaultPlaceholder = (): void => {
        filenameF!.input.placeholder = defaultFilenameBase(
          { name: nameF.input.value, nick: nickF?.input.value }, openedAt,
        );
      };
      syncDefaultPlaceholder();
      nickF?.input.addEventListener('input', syncDefaultPlaceholder);
      // #357 — the filename auto-follows slug(flame name) until the user edits
      // it manually; once overridden it stops syncing so the override sticks.
      let filenameDirty = false;
      filenameF.input.addEventListener('input', () => { filenameDirty = true; });
      nameF.input.addEventListener('input', () => {
        syncDefaultPlaceholder();
        if (!filenameDirty) filenameF!.input.value = slugForFilename(nameF.input.value);
      });
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
      // #368 — an empty filename falls back to the placeholder default (the
      // timestamped `flame-…` name shown in the field), so the save is never
      // blank. A typed value always wins.
      const typedFilename = filenameF?.input.value.trim() ?? '';
      const resolvedFilename = filenameF
        ? (typedFilename || filenameF.input.placeholder)
        : typedFilename;
      const nick = nickF?.input.value.trim() ?? '';
      // #434 — remember a typed nick so the next save pre-fills it.
      if (nick) writeLastNick(nick);
      settle({
        name: nameF.input.value.trim(),
        nick,
        filename: resolvedFilename,
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
