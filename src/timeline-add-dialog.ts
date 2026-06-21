// src/timeline-add-dialog.ts
// #227d — modal shown when an animation (multi-keyframe) .flam3 is added to the
// timeline: import all keyframes with their timing, or pick a single keyframe.
// createElement only (no innerHTML). Resolves a choice or null (cancel).

export type AddAnimationChoice =
  | { kind: 'all' }
  | { kind: 'one'; keyframeIndex: number };

export function openAddAnimationDialog(host: HTMLElement, keyframeCount: number): Promise<AddAnimationChoice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)', zIndex: '1000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });
    const box = document.createElement('div');
    // #408 — themed to the app's design language (was ad-hoc CLI monospace).
    Object.assign(box.style, {
      background: 'var(--bar-bg-2, #1a1a20)', border: '1px solid var(--bar-border, #2a2a30)',
      borderRadius: '10px', padding: '20px 22px', width: '360px',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      color: 'var(--text, #ddd)', fontSize: '13px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    });
    overlay.appendChild(box);

    const title = document.createElement('div');
    title.textContent = `This file has ${keyframeCount} keyframes`;
    Object.assign(title.style, { fontSize: '15px', fontWeight: '600', color: 'var(--text, #ddd)', marginBottom: '14px' });
    box.appendChild(title);

    const name = 'pyr3-add-anim';
    let pickIndex = 0;

    // (•) Import all
    const allRow = document.createElement('label');
    Object.assign(allRow.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', cursor: 'pointer' });
    const allRadio = document.createElement('input');
    allRadio.type = 'radio'; allRadio.name = name; allRadio.checked = true;
    allRadio.style.accentColor = 'var(--accent, #ff8c1a)';
    const allText = document.createElement('span');
    allText.textContent = 'Import all keyframes (with their timing)';
    allRow.append(allRadio, allText);
    box.appendChild(allRow);

    // ( ) Import one: [select]
    const oneRow = document.createElement('label');
    Object.assign(oneRow.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', cursor: 'pointer' });
    const oneRadio = document.createElement('input');
    oneRadio.type = 'radio'; oneRadio.name = name;
    oneRadio.style.accentColor = 'var(--accent, #ff8c1a)';
    const oneText = document.createElement('span');
    oneText.textContent = 'Import one keyframe:';
    const sel = document.createElement('select');
    Object.assign(sel.style, { background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)', color: 'var(--text, #ddd)', borderRadius: '5px', fontFamily: 'inherit', fontSize: '12px', padding: '3px 8px' });
    for (let i = 0; i < keyframeCount; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = `keyframe ${i + 1}`;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { pickIndex = Number(sel.value); oneRadio.checked = true; });
    oneRow.append(oneRadio, oneText, sel);
    box.appendChild(oneRow);

    // Buttons
    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' });
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.textContent = 'Add';
    for (const b of [cancel, ok]) {
      // #408 — Cancel = secondary bar-btn; Add = primary accent (set below).
      Object.assign(b.style, { background: 'var(--bar-bg-3, #0f0f13)', border: '1px solid var(--bar-border, #2a2a30)', color: 'var(--text, #ddd)', padding: '4px 14px', borderRadius: '5px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px' });
    }
    Object.assign(ok.style, { background: 'var(--accent, #ff8c1a)', borderColor: 'var(--accent, #ff8c1a)', color: '#1a1a1a', fontWeight: '600' });
    btnRow.append(cancel, ok);
    box.appendChild(btnRow);

    function close(result: AddAnimationChoice | null): void {
      overlay.remove();
      resolve(result);
    }
    cancel.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    ok.addEventListener('click', () =>
      close(allRadio.checked ? { kind: 'all' } : { kind: 'one', keyframeIndex: pickIndex }),
    );

    host.appendChild(overlay);
  });
}
