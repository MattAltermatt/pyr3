// #119 — Variation Catalog sidebar.
//
// Sticky left-pane index: search + four collapsible sticky-headed
// sections (flam3 / DC family / JWildfire ports / Novel pyr3 originals).
// All 225 variations always render in numeric order. Search filters
// in-place; collapse hides a section's members but keeps its header
// pinned. Scroll-spy is wired by the host (which knows about scroll
// containers); this module only exposes `setActive(idx)` for the host
// to call.
//
// All DOM construction goes through createElement + textContent — pyr3's
// no-innerHTML invariant (PYR3-065) is enforced by a test.

import { V } from './variations';
import { sourceForIdx, type CatalogSource } from './variation-catalog-data';

interface VariationRow {
  idx: number;
  name: string;
  source: CatalogSource;
}

const SOURCES: readonly CatalogSource[] = ['flam3', 'dc', 'jwf', 'novel'];
const SOURCE_LABEL: Record<CatalogSource, string> = {
  flam3: 'flam3',
  dc:    'DC family',
  jwf:   'JWildfire ports',
  novel: 'Novel pyr3 originals',
};
const SOURCE_BADGE: Record<CatalogSource, string> = {
  flam3: '',
  dc:    'DC',
  jwf:   'JWF',
  novel: 'New',
};

export interface SidebarOptions {
  onJump(idx: number): void;
}

export interface SidebarHandle {
  setActive(idx: number): void;
  setSearch(s: string): void;
  destroy(): void;
}

/** Lift the variation registry to a row array in numeric order. The V
 *  table is the source of truth — adding a new variation there
 *  automatically populates the sidebar. */
export function listVariations(): VariationRow[] {
  return (Object.entries(V) as [string, number][])
    .map(([name, idx]) => ({ idx, name, source: sourceForIdx(idx) }))
    .sort((a, b) => a.idx - b.idx);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountSidebar(host: HTMLElement, opts: SidebarOptions): SidebarHandle {
  const rows = listVariations();

  let search = '';
  const collapsed = new Set<CatalogSource>();
  let active: number | null = null;

  host.replaceChildren();

  // Header
  const head = el('div', 'pyr3-cat-sidebar-head');
  const title = el('div', 'pyr3-cat-sidebar-title');
  title.append(el('span', undefined, 'Variations'));
  const countEl = el('span', 'pyr3-cat-sidebar-count', String(rows.length));
  title.append(countEl);
  head.append(title);

  // Search
  const searchWrap = el('div', 'pyr3-cat-search-wrap');
  const searchInput = el('input', 'pyr3-cat-search');
  searchInput.type = 'text';
  searchInput.placeholder = 'filter by name…';
  searchWrap.append(searchInput);

  // List
  const list = el('nav', 'pyr3-cat-list');

  host.append(head, searchWrap, list);

  function searchMatches(r: VariationRow): boolean {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.name.toLowerCase().includes(q) || ('v' + r.idx).includes(q);
  }

  function render(): void {
    const visibleBySource = new Map<CatalogSource, VariationRow[]>();
    for (const src of SOURCES) visibleBySource.set(src, []);
    for (const r of rows) if (searchMatches(r)) visibleBySource.get(r.source)!.push(r);

    list.replaceChildren();
    const trimmedSearch = search.trim();
    let anyRendered = false;

    for (const src of SOURCES) {
      const members = visibleBySource.get(src)!;
      if (members.length === 0 && trimmedSearch) continue;
      anyRendered = true;

      const isCollapsed = collapsed.has(src);

      const groupHead = el('div', `pyr3-cat-group-head${isCollapsed ? ' collapsed' : ''}`);
      groupHead.dataset.source = src;
      const trigger = el('span', 'pyr3-cat-trigger');
      trigger.append(el('span', 'pyr3-cat-caret', '▾'));
      trigger.append(document.createTextNode(SOURCE_LABEL[src]));
      groupHead.append(trigger);
      groupHead.append(el('span', 'pyr3-cat-gct', String(members.length)));
      groupHead.addEventListener('click', () => {
        if (collapsed.has(src)) collapsed.delete(src);
        else collapsed.add(src);
        render();
      });
      list.append(groupHead);

      if (!isCollapsed) {
        for (const r of members) {
          const item = el(
            'a',
            `pyr3-cat-item${r.idx === active ? ' active' : ''}`,
          );
          item.href = `#v${r.idx}-${r.name}`;
          item.dataset.idx = String(r.idx);
          item.append(el('span', 'pyr3-cat-vnum', `V${r.idx}`));
          item.append(el('span', 'pyr3-cat-name', r.name));
          item.append(
            SOURCE_BADGE[r.source]
              ? el('span', 'pyr3-cat-badge', SOURCE_BADGE[r.source])
              : el('span'),
          );
          item.addEventListener('click', (e) => {
            e.preventDefault();
            opts.onJump(r.idx);
          });
          list.append(item);
        }
      }
    }

    if (!anyRendered) {
      list.append(el('div', 'pyr3-cat-empty', 'no matches'));
    }
  }

  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    render();
  });

  render();

  return {
    setActive(idx: number): void {
      if (active === idx) return;
      active = idx;
      render();
      const itemEl = list.querySelector('.pyr3-cat-item.active') as HTMLElement | null;
      if (itemEl) itemEl.scrollIntoView({ block: 'nearest' });
    },
    setSearch(s: string): void {
      search = s;
      searchInput.value = s;
      render();
    },
    destroy(): void {
      host.replaceChildren();
    },
  };
}
