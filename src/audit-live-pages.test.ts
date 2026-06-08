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
          <a href="/v1/gen/247/id/19679">Open ${hero}</a>
        </body>
      </html>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    expect(findings).toHaveLength(0);
  });

  it('flags stale variation counts', () => {
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
    expect(varFindings).toHaveLength(2);
    const foundValues = varFindings.map(f => f.found);
    expect(foundValues).toContain('99');
    expect(foundValues).toContain('220');
    expect(varFindings[0]?.expected).toBe('258');
    expect(varFindings[1]?.expected).toBe('258');
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
        <p>Featured sheep: electricsheep.248.31324</p>
      </div>
    `;
    const findings = checkHtml(html, version, varCount, hero);
    const heroFindings = findings.filter(f => f.type === 'hero');
    expect(heroFindings).toHaveLength(1);
    expect(heroFindings[0]?.found).toBe('electricsheep.248.31324');
    expect(heroFindings[0]?.expected).toBe(hero);
  });
});
