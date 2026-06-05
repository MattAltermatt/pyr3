// About page body — owns the version chip, the lineage paragraph, credits, and
// external links. Mounted into the chrome `middleSlot` returned by mountAboutBar.
// Single-column readable layout, ~740px wide, centered. Pure DOM — no external
// dependencies beyond the COLORS token table.

import { COLORS } from './ui-tokens';

export interface AboutOpts {
  version: string;
  buildDate?: string;
  gpuInfo?: string;
}

interface LinkSpec {
  href: string;
  label: string;
  detail?: string;
}

const LINEAGE_LINKS = {
  flam3: 'https://github.com/scottdraves/flam3',
  esf: 'https://github.com/ElectricSheepFold',
} as const;

const EXTERNAL_LINKS: LinkSpec[] = [
  {
    href: 'https://github.com/MattAltermatt/pyr3',
    label: 'github.com/MattAltermatt/pyr3',
    detail: 'source + issues',
  },
  {
    href: 'https://github.com/MattAltermatt/pyr3/releases',
    label: 'Releases',
    detail: 'ship history',
  },
  {
    href: 'https://github.com/MattAltermatt/pyr3/blob/main/LICENSE',
    label: 'License',
    detail: 'GPL-3.0-or-later',
  },
];

const CREDIT_BULLETS = [
  'Algorithm · Scott Draves & Erik Reckase (flam3, 1992–present, GPL-3.0)',
  'Corpus · Electric Sheep Fold',
  'WebGPU + WGSL · Chrome team / Dawn',
  'This implementation · pyr3 — TypeScript port + WGSL rewrite (GPL-3.0-or-later)',
];

export function mountAbout(root: HTMLElement, opts: AboutOpts): void {
  const page = document.createElement('div');
  page.className = 'pyr3-about';
  applyStyle(page, {
    maxWidth: '740px',
    margin: '0 auto',
    padding: '40px 24px 80px',
    color: COLORS.text.primary,
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    lineHeight: '1.55',
    fontSize: '15px',
  });

  page.appendChild(buildTitle());
  page.appendChild(buildTagline());
  page.appendChild(buildVersionChip(opts));
  page.appendChild(buildWhatItIs());
  page.appendChild(buildLineage());
  page.appendChild(buildCredits());
  page.appendChild(buildLinks());
  page.appendChild(buildNotes());

  root.appendChild(page);
}

// ----- section builders -----

function buildTitle(): HTMLElement {
  const h1 = document.createElement('h1');
  h1.textContent = 'pyr3';
  applyStyle(h1, {
    fontSize: '64px',
    fontWeight: '800',
    lineHeight: '1',
    margin: '0 0 16px 0',
    background: `linear-gradient(180deg, ${COLORS.flame.top}, ${COLORS.flame.mid}, ${COLORS.flame.bot})`,
    backgroundClip: 'text',
    webkitBackgroundClip: 'text',
    color: 'transparent',
    webkitTextFillColor: 'transparent',
    letterSpacing: '-0.02em',
  });
  return h1;
}

function buildTagline(): HTMLElement {
  const p = document.createElement('p');
  p.textContent =
    'A TypeScript + WebGPU fractal-flame renderer in the flam3 lineage. ' +
    'GPL-3.0-or-later. Runs in any browser with WebGPU, and headless from Node for batch rendering.';
  applyStyle(p, {
    margin: '0 0 24px 0',
    color: COLORS.text.muted,
    fontSize: '16px',
  });
  return p;
}

function buildVersionChip(opts: AboutOpts): HTMLElement {
  const wrap = document.createElement('div');
  applyStyle(wrap, { margin: '0 0 32px 0' });

  const chip = document.createElement('span');
  applyStyle(chip, {
    display: 'inline-block',
    padding: '6px 14px',
    border: `1px solid ${COLORS.flame.mid}`,
    borderRadius: '999px',
    color: COLORS.flame.top,
    fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing: '0.01em',
  });

  const parts: string[] = [`⚙ version ${opts.version}`];
  if (opts.buildDate) parts.push(`build ${opts.buildDate}`);
  parts.push(`WebGPU on ${opts.gpuInfo ?? 'WebGPU'}`);
  chip.textContent = parts.join(' · ');

  wrap.appendChild(chip);
  return wrap;
}

function buildWhatItIs(): HTMLElement {
  const sec = buildSection('whatItIs', 'What it is');
  appendParagraph(
    sec,
    'pyr3 renders fractal flames on the GPU using WebGPU and WGSL. The same engine drives ' +
      'two consumers: a browser viewer (this site) and a headless CLI (Node + the webgpu npm ' +
      'package). One TypeScript module graph; one set of shaders; two hosts.',
  );
  appendParagraph(
    sec,
    'Output is "similar but not identical to flam3-C" — pyr3 tracks the flam3 reference ' +
      'C renderer through a curated fixture set under an R-tolerance contract, not bit-faithful ' +
      'parity. Cross-vendor GPU determinism is not guaranteed; every render still passes the ' +
      'visual-tolerance gate against the flam3-C golden.',
  );
  return sec;
}

function buildLineage(): HTMLElement {
  const sec = buildSection('lineage', 'Lineage');
  const p = document.createElement('p');
  applyStyle(p, paragraphStyle());

  p.appendChild(document.createTextNode('The fractal flame algorithm is the work of '));
  p.appendChild(makeTextNode('Scott Draves and Erik Reckase', { weight: '600' }));
  p.appendChild(
    document.createTextNode(' (1992–present). The C reference renderer '),
  );
  p.appendChild(makeExternalLink(LINEAGE_LINKS.flam3, 'flam3'));
  p.appendChild(
    document.createTextNode(
      ' is the algorithmic ground truth pyr3 reads from — the TypeScript and WGSL in this ' +
        'repo are an independent reimplementation under the same GPL-3.0-or-later license. ' +
        'The corpus of flames pyr3 browses comes from the ',
    ),
  );
  p.appendChild(makeExternalLink(LINEAGE_LINKS.esf, 'Electric Sheep Fold'));
  p.appendChild(document.createTextNode(' archive.'));

  sec.appendChild(p);
  return sec;
}

function buildCredits(): HTMLElement {
  const sec = buildSection('credits', 'Credits');
  const ul = document.createElement('ul');
  applyStyle(ul, listStyle());
  for (const bullet of CREDIT_BULLETS) {
    const li = document.createElement('li');
    li.textContent = bullet;
    applyStyle(li, { margin: '6px 0' });
    ul.appendChild(li);
  }
  sec.appendChild(ul);
  return sec;
}

function buildLinks(): HTMLElement {
  const sec = buildSection('links', 'Links');
  const ul = document.createElement('ul');
  applyStyle(ul, listStyle());
  for (const spec of EXTERNAL_LINKS) {
    const li = document.createElement('li');
    applyStyle(li, { margin: '6px 0' });
    li.appendChild(makeExternalLink(spec.href, spec.label));
    if (spec.detail) {
      const detail = document.createElement('span');
      detail.textContent = ` · ${spec.detail}`;
      applyStyle(detail, { color: COLORS.text.muted });
      li.appendChild(detail);
    }
    ul.appendChild(li);
  }
  sec.appendChild(ul);
  return sec;
}

function buildNotes(): HTMLElement {
  const sec = buildSection('notes', 'Notes');
  const p = document.createElement('p');
  p.textContent =
    'WebGPU is required — recent Chrome, Edge, and Safari Technology Preview all qualify. ' +
    'Render output varies slightly across GPU vendors (Apple Silicon vs. AMD vs. NVIDIA); pyr3 ' +
    'treats this divergence as expected, with the R-tolerance gate as the equivalence contract.';
  applyStyle(p, {
    ...paragraphStyle(),
    color: COLORS.text.dim,
    fontSize: '13px',
  });
  sec.appendChild(p);
  return sec;
}

// ----- primitives -----

function buildSection(slug: string, heading: string): HTMLElement {
  const sec = document.createElement('section');
  sec.dataset.sec = slug;
  applyStyle(sec, { margin: '36px 0 0 0' });

  const h2 = document.createElement('h2');
  h2.textContent = heading;
  applyStyle(h2, {
    fontSize: '13px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: COLORS.flame.top,
    margin: '0 0 12px 0',
  });
  sec.appendChild(h2);

  return sec;
}

function appendParagraph(section: HTMLElement, text: string): void {
  const p = document.createElement('p');
  p.textContent = text;
  applyStyle(p, paragraphStyle());
  section.appendChild(p);
}

function paragraphStyle(): Record<string, string> {
  return {
    margin: '0 0 12px 0',
    color: COLORS.text.muted,
  };
}

function listStyle(): Record<string, string> {
  return {
    margin: '0',
    padding: '0 0 0 20px',
    color: COLORS.text.muted,
  };
}

function makeExternalLink(href: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `${label} ↗`;
  applyStyle(a, {
    color: COLORS.flame.mid,
    textDecoration: 'none',
    borderBottom: `1px solid ${COLORS.border}`,
  });
  return a;
}

function makeTextNode(
  text: string,
  opts: { weight?: string } = {},
): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  if (opts.weight) span.style.fontWeight = opts.weight;
  span.style.color = COLORS.text.primary;
  return span;
}

function applyStyle(el: HTMLElement, style: Record<string, string>): void {
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    // Vendor-prefixed CSSStyleDeclaration keys come in camelCase form; JSDOM/happy-dom accept both.
    (el.style as unknown as Record<string, string>)[key] = value;
  }
}
