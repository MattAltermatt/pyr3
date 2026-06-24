import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { V } from '../src/variations';
import { HERO_GEN, HERO_ID } from '../src/load-intent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the audit findings interface
export interface AuditFinding {
  type: 'version' | 'variations' | 'hero' | 'legacy-route' | 'error';
  message: string;
  found?: string;
  expected?: string;
}

// Extract logic into a pure, testable function
export function checkHtml(
  html: string,
  expectedVersion: string,
  expectedVariationCount: number,
  expectedHeroString: string
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const seenVariations = new Set<string>();

  // Audit variations count
  // Look for patterns like "99 variations", "220 variations", "225 variations", etc.
  const varRegex = /\b(\d+)\s+(?:type|class|set of|different\s+)?variations\b/gi;
  let varMatch;
  while ((varMatch = varRegex.exec(html)) !== null) {
    const count = parseInt(varMatch[1]!, 10);
    if (count !== expectedVariationCount) {
      const foundStr = String(count);
      if (!seenVariations.has(foundStr)) {
        seenVariations.add(foundStr);
        findings.push({
          type: 'variations',
          message: `Stale variation count found: "${varMatch[0]}"`,
          found: foundStr,
          expected: String(expectedVariationCount),
        });
      }
    }
  }

  // Fallback: search for known stale numbers near "variation".
  // NOTE: 99 is deliberately NOT in this list. "the 99 in pyr3's core set"
  // on /help/direct-color-variations.html is a permanent, correct reference
  // to the 99 numbered flam3 core variations (VAR_0..VAR_98) — not a stale
  // catalog total. Flagging it was a false positive; do not re-add 99.
  const knownStaleCounts = [166, 220, 225];
  for (const stale of knownStaleCounts) {
    const staleStr = String(stale);
    if (stale !== expectedVariationCount && !seenVariations.has(staleStr) && html.includes(staleStr)) {
      // Double check if it is near the word variation
      const index = html.indexOf(staleStr);
      const snippet = html.slice(Math.max(0, index - 40), Math.min(html.length, index + 40));
      if (/variation/i.test(snippet)) {
        seenVariations.add(staleStr);
        findings.push({
          type: 'variations',
          message: `Suspected stale variation count in snippet: "...${snippet.trim()}..."`,
          found: staleStr,
          expected: String(expectedVariationCount),
        });
      }
    }
  }

  // Audit version
  // Check if the current version is mentioned anywhere on pages that display the version
  // If we have an older version but not the current version, report it
  const knownOlderVersions = ['1.3.0', '1.2.0', '1.1.0', '1.0.0', '0.36.0'];
  for (const oldVer of knownOlderVersions) {
    if (html.includes(oldVer) && !html.includes(expectedVersion)) {
      findings.push({
        type: 'version',
        message: `Stale version reference found: "${oldVer}"`,
        found: oldVer,
        expected: expectedVersion,
      });
    }
  }

  // Audit hero references — blocklist of former default heroes that, if still
  // present, signal a stale page.
  // NOTE: electricsheep.248.31324 is deliberately NOT in this list. It is a
  // permanent curated card in the /showcase gallery (one of the 54 fixtures),
  // so it appears on that page by design — flagging it was a false positive.
  // Only list former heroes that should NOT appear anywhere once superseded.
  const oldHeroes = ['electricsheep.244.00617'];
  for (const oldHero of oldHeroes) {
    if (html.includes(oldHero)) {
      findings.push({
        type: 'hero',
        message: `Stale hero reference found: "${oldHero}"`,
        found: oldHero,
        expected: expectedHeroString,
      });
    }
  }

  // Audit legacy routes — the #264 migration dropped the /v1/ prefix, and #449
  // flattened /esf/* to /browse + /gallery (redirect map in
  // src/route-redirects.ts). Any live href/src/text still pointing at /v1/* or
  // /esf/* (or ../-relative) is stale: on gh-pages it bounces through the 404
  // SPA shell, and on a stricter static host it hard-404s.
  const legacyRouteRegex = /\.{0,2}\/(v1|esf)\/[^\s"'<>)]*/g;
  const seenLegacy = new Set<string>();
  let legacyMatch;
  while ((legacyMatch = legacyRouteRegex.exec(html)) !== null) {
    const token = legacyMatch[0];
    if (seenLegacy.has(token)) continue;
    seenLegacy.add(token);
    findings.push({
      type: 'legacy-route',
      message: `Legacy route reference found: "${token}"`,
      found: token,
      expected: 'flat route (e.g. /editor, /browse/gen/.../id/..., /gallery)',
    });
  }

  return findings;
}

// URL fetch and check wrapper
async function auditUrl(
  url: string,
  expectedVersion: string,
  expectedVariationCount: number,
  expectedHeroString: string
): Promise<{ url: string; findings: AuditFinding[] }> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        url,
        findings: [{
          type: 'error',
          message: `HTTP request failed with status ${res.status} (${res.statusText})`,
        }],
      };
    }
    const html = await res.text();
    const findings = checkHtml(html, expectedVersion, expectedVariationCount, expectedHeroString);
    return { url, findings };
  } catch (err: any) {
    return {
      url,
      findings: [{
        type: 'error',
        message: `Failed to fetch URL: ${err.message || err}`,
      }],
    };
  }
}

// 4. Main runner function
async function main() {
  const pkgPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const currentVersion = pkg.version;

  const expectedVariationCount = Object.keys(V).length;
  const expectedHeroString = `electricsheep.${HERO_GEN}.${HERO_ID}`;

  console.log(`Current codebase state:`);
  console.log(`  - Version: ${currentVersion}`);
  console.log(`  - Variations: ${expectedVariationCount}`);
  console.log(`  - Hero: ${expectedHeroString}`);
  console.log('');

  // Parse CLAUDE.md for live pages to audit
  const claudePath = path.resolve(__dirname, '../CLAUDE.md');
  const claudeText = fs.readFileSync(claudePath, 'utf8');
  const urls: string[] = [];
  const lines = claudeText.split('\n');
  let inAuditSection = false;

  for (const line of lines) {
    if (line.trim().startsWith('## Live pages to audit')) {
      inAuditSection = true;
      continue;
    }
    if (inAuditSection) {
      if (line.trim().startsWith('##')) {
        break;
      }
      const match = line.match(/^\s*-\s*(https?:\/\/\S+)/);
      if (match && match[1]) {
        urls.push(match[1]);
      }
    }
  }

  if (urls.length === 0) {
    console.error('Error: No live pages found to audit under "## Live pages to audit" in CLAUDE.md');
    process.exit(1);
  }

  console.log(`Auditing ${urls.length} live URLs...`);
  const results = await Promise.all(
    urls.map(url => auditUrl(url, currentVersion, expectedVariationCount, expectedHeroString))
  );

  let totalFindings = 0;
  for (const { url, findings } of results) {
    console.log(`\nURL: ${url}`);
    if (findings.length === 0) {
      console.log('  ✓ No stale reference issues found.');
    } else {
      for (const finding of findings) {
        totalFindings++;
        console.log(`  ✗ [${finding.type.toUpperCase()}] ${finding.message}`);
        if (finding.found && finding.expected) {
          console.log(`      Found: ${finding.found} | Expected: ${finding.expected}`);
        }
      }
    }
  }

  console.log('\n----------------------------------------');
  if (totalFindings === 0) {
    console.log('Audit completed successfully. All pages are up to date!');
    process.exit(0);
  } else {
    console.log(`Audit completed with ${totalFindings} warning(s). Please review and update the stale content.`);
    process.exit(0);
  }
}

// check if main runner
const isMain = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1] === path.resolve(__dirname, 'audit-live-pages.ts') ||
  process.argv[1].endsWith('audit-live-pages.ts')
);

if (isMain) {
  main();
}
