import { describe, expect, it } from 'vitest';
import { checkHtml } from '../scripts/audit-live-pages';

describe('audit-live-pages checkHtml', () => {
  const version = '1.4.0';
  const varCount = 258;
  const hero = 'electricsheep.247.19679';

  it('reports nothing on fully up-to-date page', () => {
    const html = `
      <html>
        <body>
          <h1>pyr3 version ${version}</h1>
          <p>We support ${varCount} different variations!</p>
          <a href="/esf/gen/247/id/19679">Open ${hero}</a>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    expect(findings).toHaveLength(0);
  });

  it('flags stale variation counts but not the legit flam3-99 core reference', () => {
    const html = `
      <html>
        <body>
          <p>Every standard flam3 variation (the 99 in pyr3's core set — etc)</p>
          <p>Another mention: 220 variations in total</p>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    const varFindings = findings.filter(f => f.type === 'variations');
    const foundValues = varFindings.map(f => f.found);
    // "the 99 in pyr3's core set" is the correct count of flam3 core
    // variations, not a stale catalog total — must NOT be flagged.
    expect(foundValues).not.toContain('99');
    // 220 is a genuinely stale catalog total — must be flagged.
    expect(foundValues).toContain('220');
    expect(varFindings.every(f => f.expected === '258')).toBe(true);
  });

  it('flags stale versions if current version is absent', () => {
    const html = `
      <html>
        <body>
          <p>Welcome to version 1.0.0 of pyr3!</p>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    const verFindings = findings.filter(f => f.type === 'version');
    expect(verFindings).toHaveLength(1);
    expect(verFindings[0]?.found).toBe('1.0.0');
    expect(verFindings[0]?.expected).toBe('1.4.0');
  });

  it('does not flag older version if current version is also present', () => {
    const html = `
      <html>
        <body>
          <p>We upgraded from 1.0.0 to ${version}!</p>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    const verFindings = findings.filter(f => f.type === 'version');
    expect(verFindings).toHaveLength(0);
  });

  it('flags stale hero references', () => {
    const html = `
      <div>
        <p>Featured sheep: electricsheep.244.00617</p>
      </div>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    const heroFindings = findings.filter(f => f.type === 'hero');
    expect(heroFindings).toHaveLength(1);
    expect(heroFindings[0]?.found).toBe('electricsheep.244.00617');
    expect(heroFindings[0]?.expected).toBe(hero);
  });

  it('does not flag electricsheep.248.31324 — a legit /showcase gallery card', () => {
    const html = `
      <div class="card">
        <a class="idlink" href="../esf/gen/248/id/31324">electricsheep.248.31324</a>
      </div>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    expect(findings.filter(f => f.type === 'hero')).toHaveLength(0);
  });

  it('flags legacy /v1/ route links (#264 dropped the prefix)', () => {
    const html = `
      <html>
        <body>
          <a href="/v1/edit">editor</a>
          <a href="../v1/variations">catalog</a>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    const legacy = findings.filter(f => f.type === 'legacy-route');
    expect(legacy.map(f => f.found)).toEqual(
      expect.arrayContaining(['/v1/edit', '../v1/variations']),
    );
  });

  it('does not flag a fully-migrated flat-route page', () => {
    const html = `
      <html>
        <body>
          <a href="/editor">editor</a>
          <a href="../variations">catalog</a>
          <a href="/esf/gen/247/id/19679">hero</a>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    expect(findings.filter(f => f.type === 'legacy-route')).toHaveLength(0);
  });
});
