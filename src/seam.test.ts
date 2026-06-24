// Seam-invariant unit tests (#60).
//
// pyr3's load-bearing architectural invariant: the same engine modules
// (`src/*.ts` + `src/shaders/*.wgsl`) drive BOTH the browser viewer
// (`src/main.ts`) and the headless CLI (`bin/pyr3-render.ts` +
// `bin/pyr3-bake-features.ts`). The CLI hosts stamp WebGPU globals +
// linkedom's DOMParser onto `globalThis` before importing engine code;
// engine code is supposed to be ENVIRONMENT-AGNOSTIC — never checking
// `typeof window`, `process`, `isNode`, etc.
//
// Before this file: the only thing catching a regression that broke the
// seam (e.g., someone added `if (typeof window === 'undefined')` to a
// hot path) was the 13-minute FE↔BE parity sweep (`parity-fe-be.test.ts`,
// retired from routine runs in #58). This file catches the same class of
// regression in milliseconds.
//
// Companion: `src/renderer.test.ts` (added in #48 Task 2) pins the
// canvas-per-call contract on the Renderer specifically. This file
// generalizes — it scans the engine surface for the broader "no
// environment branching" invariant.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRenderer } from './renderer';
import { applyPreset, QUALITY_TIERS, tierToSpec } from './presets';
import { parseFlame } from './flame-import';
import { GALLERY_PAGE_SIZE, galleryUrl } from './load-intent';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = __dirname;

// Files in `src/` that are ALLOWED to reference environment-specific
// globals — entry points (main.ts is the viewer's, mounts DOM) and
// build-constant consumers (avail-client / chunk-fetch read
// `import.meta.env.BASE_URL`, a Vite-build-time string, not a runtime
// environment branch). New entry points or build-constant readers go
// here; engine modules MUST NOT.
const SEAM_EXEMPT = new Set<string>([
  'main.ts',              // viewer entry — uses document, window, history
  'main-dev-hooks.ts',    // DEV-only window.__pyr3* debug hooks (#423)
  'avail-client.ts',      // uses import.meta.env.BASE_URL (build constant)
  'corpus-bounds.ts',     // same
  'chunk-fetch.ts',       // same
  'feature-index-client.ts', // same
  'flame-import.ts',      // DOMParser-based XML parse; "document" appears only in a comment
  'gallery-filter-ui.ts', // mounts DOM — #79 sibling gap to variation-picker
  'gallery-mount.ts',     // mounts DOM — fine to use document there
  'load-intent.ts',       // galleryUrl/corpusUrl read import.meta.env.BASE_URL
  'loader.ts',            // user-facing file loader, uses File API
  'ui-bar.ts',            // viewer bar — uses document
  'nav-menu.ts',          // top-nav menus — DOM-mounting + document dismiss listeners (#264)
  'about-mount.ts',       // /about page body — DOM-mounting (#103 visual overhaul)
  'how-it-works-mount.ts', // /how-it-works guide page body — DOM-mounting (#347)
  'learn/chaos-player.ts', // /how-it-works demo player — Canvas2D DOM-mounting (#347)
  'learn/sections.ts',     // /how-it-works section builders — DOM-mounting (#347)
  'learn/self-similar.ts', // /how-it-works §0 recursive-subdivision visual — DOM (#347)
  'learn/mandelbrot.ts',   // /how-it-works §1 escape-time Mandelbrot — Canvas2D DOM (#347)
  'learn/affine-warp.ts',  // /how-it-works §3 affine playground — Canvas2D DOM (#347)
  'learn/glow.ts',         // /how-it-works §7 colour+glow density demo — Canvas2D DOM (#347)
  'variation-picker.ts',  // DOM-mounting variation picker (#79)
  'screensaver-mount.ts', // /screensaver page body — DOM-mounting (#109)
  'screensaver-ui.ts',    // /screensaver landing card — DOM-mounting (#109)
  'screensaver-controls.ts', // /screensaver in-playback control bar — DOM-mounting (#355)
  'screensaver-settings.ts', // /screensaver settings widgets — DOM-mounting (#355)
  'webgpu-check.ts',      // probes navigator.gpu — checking is its job
  'brotli.ts',            // platform-aware decoder probe (native vs wasm)
  'device.ts',            // viewer-side device acquisition uses navigator.gpu
  'mobile.ts',            // device-TYPE detection (viewport width / pointer) for the mobile consumption UI (#66)
  'mobile-interstitial.ts', // "needs desktop" card shown for hidden routes on mobile — DOM-mounting (#66)
  'save-image.ts',        // unrelated — exports a pure helper, no env access
  'save-flame.ts',        // viewer .pyr3.json export — uses URL.createObjectURL + anchor download (#103 visual overhaul)
  'gpu-test-harness.ts',  // node-only *.gpu.test.ts support helper (create([]) + node:fs read); never imported by engine code (#428)
  'no-innerhtml.test.ts', // test file; allowed
  'parity.test.ts',       // test file
  'parity-fe-be.test.ts', // test file
  'render-orchestrator.ts', // orchestrator pulls rAF when available — see below
  'edit-mount.ts',        // /editor page mount — owns canvas + DOM
  'edit-ui.ts',           // /editor panel shell — DOM-mounting
  'edit-section-palette.ts',  // /editor section — DOM-mounting
  'edit-palette-generator.ts', // /editor palette ramp generator — DOM-mounting (#358)
  'edit-section-viewport.ts', // /editor section — DOM-mounting
  'edit-section-xforms.ts',   // /editor section — DOM-mounting
  'edit-section-global.ts',   // /editor section — DOM-mounting
  'edit-section-background.ts', // shared bg control — DOM-mounting (#27)
  'edit-section-density.ts',  // /editor section — DOM-mounting
  'edit-section-render.ts',   // /editor section — DOM-mounting
  'edit-section-curves.ts',   // /editor Color Curves section — DOM-mounting (#116)
  'edit-section-scopes.ts',   // /editor Scopes section — DOM-mounting (#174)
  'edit-section-hsl.ts',      // /editor HSL Adjust section — DOM-mounting (#172)
  'edit-canvas-nav.ts',   // /editor pan + zoom — owns mouse/wheel listeners on window
  'edit-xform-viz.ts',    // /editor affine viz — owns a 2D canvas
  'edit-xform-gizmo.ts',       // /editor on-canvas affine gizmo overlay — owns a 2D canvas + listeners (#350)
  'edit-gradient-overlay.ts',  // /editor on-canvas gradient bar overlay — DOM host + embedded palette editor (#372)
  'edit-paint-region.ts', // /editor point-to-paint region canvas — DOM + pointer listeners (#423)
  'edit-canvas-overlays.ts',   // /editor screen-fixed canvas chrome menu — DOM-mounting (#350)
  'edit-compose-overlay.ts',   // /editor screen-fixed compositional guides — owns a 2D canvas (#364)
  'edit-compose-menu.ts',      // /editor compose popover — DOM-mounting menu (#364)
  'edit-variation-picker.ts',  // /editor variation picker — owns a modal, document keydown listener
  'edit-variation-kind.ts',    // /editor variation-kind helpers — opens the picker on document.body (#236/#237)
  'edit-scrubby-input.ts',     // /editor drag-to-scrub numeric cell — owns DOM + pointer lock
  'edit-primitives.ts',        // /editor shared row/input/dropdown/swatch/pair builders (#103 Phase 7)
  'edit-tooltip.ts',           // /editor info-icon + anchored popover (#103 Phase 7)
  'help-text.ts',              // shared help-text registry — builds info icons via edit-tooltip (#343/#348)
  'palette-picker.ts',         // /editor docked palette picker (#103 Phase 9)
  'edit-slow-render-nudge.ts', // /editor slow-render UX nudge — owns toast DOM (#118)
  'surprise-mount.ts',            // /surprise wall page mount — owns DOM (#186)
  'surprise-bars.ts',             // /surprise generation settings bars — DOM-mounting (#433)
  'variation-catalog-mount.ts',   // /variations page mount — owns DOM (#119)
  'variation-catalog-sidebar.ts', // /variations sidebar — DOM-mounting (#119)
  'variation-catalog-section.ts', // /variations per-section component (#119)
  'welcome-card.ts',           // viewer first-load welcome card — owns DOM (#338)
  'naming-dialog.ts',          // save-time naming dialog — owns DOM (#346)
  'render-progress-modal.ts',  // Save Render progress modal — owns DOM (#176)
  'render-mode-bar.ts',        // shared PREVIEW/RENDER bar — owns DOM (#176 Task 3)
  'size-preset-control.ts',    // shared SIZE_PRESETS dropdown widget — owns DOM (#274)
  'render-save.ts',            // shared Save Render helper — anchor download (#201 P0)
  'animate-mount.ts',          // /animate page body — DOM-mounting (#211 P6)
  'animate-export-modal.ts',   // /animate export modal — DOM-mounting (#212 P7)
  'animate-easing-panel.ts',   // /animate per-segment easing panel — DOM-mounting (#224)
  'playback-bar.ts',           // /animate scrubber — DOM-mounting (#211 P6)
  'palette-editor.ts',         // /gradient stop-bar editor — DOM-mounting (#115)
  'color-picker.ts',           // /gradient HSV picker popover — owns DOM (#115)
  'palette-file.ts',           // /gradient .pyre-palette.json import/export — anchor download (#115)
  'timeline-thumbnails.ts',    // /animate clip thumbnails — creates offscreen canvases via document (#227c)
  'timeline-sections.ts',      // /animate section-model authoring track — DOM-mounting (#227d)
  'timeline-section-editor.ts',// /animate clip/section inspector — DOM-mounting (#227d)
  'timeline-context-panel.ts', // /animate selection-editor overlay — DOM-mounting (#283)
  'timeline-add-dialog.ts',    // /animate animation-import modal — DOM-mounting (#227d)
  'timeline-scale.ts',         // /animate shared ruler — renderTicks/attachScrub touch DOM (#276)
  'timeline-xform-pairing.ts', // /animate xform-pairing widget — DOM-mounting (#282)
]);

// Banned patterns — direct runtime checks for the host environment AND
// imports that wire engine code to one environment only. These would fork
// the engine into "works in browser only" or "works in node only", which
// is exactly the seam we're protecting.
//
// #80 extended the original "typeof X" / isNode / isBrowser set with:
//   - process.env reads — node-only env access
//   - `from 'node:*'` imports — node built-ins
//   - `from 'pngjs' | 'happy-dom' | 'webgpu'` — node-only npm packages
//     (engine code that needs these belongs in bin/ host or scripts/)
//   - raw `document.` / `window.` references — browser-only globals; the
//     property-access form (`document.foo`) catches real runtime uses
//     while skipping bare "document" mentions inside comments/strings.
const BANNED_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /typeof\s+window\s*[!=]==?\s*['"`]undefined['"`]/, description: 'typeof window check' },
  { pattern: /typeof\s+process\s*[!=]==?\s*['"`]undefined['"`]/, description: 'typeof process check' },
  { pattern: /typeof\s+document\s*[!=]==?\s*['"`]undefined['"`]/, description: 'typeof document check' },
  { pattern: /\bisNode\b/, description: 'isNode runtime branch' },
  { pattern: /\bisBrowser\b/, description: 'isBrowser runtime branch' },
  { pattern: /\bprocess\.env\b/, description: 'process.env read (node-only)' },
  { pattern: /from\s+['"]node:[^'"]+['"]/, description: "from 'node:*' import" },
  { pattern: /from\s+['"](pngjs|happy-dom|webgpu)['"]/, description: 'node-only npm import' },
  { pattern: /\bdocument\.[a-zA-Z_$]/, description: 'raw document.* (browser-only)' },
  { pattern: /\bwindow\.[a-zA-Z_$]/, description: 'raw window.* (browser-only)' },
  // #309 — bare browser storage / rAF globals. The convention is the defensive
  // `globalThis.localStorage?.` form (works no-op in Node); a bare access
  // hard-couples the module to the browser. The lookbehind skips the
  // `globalThis.`-prefixed form; the trailing `.`/`[`/`(` skips prose mentions.
  { pattern: /(?<![.\w])localStorage(\.[a-zA-Z_$]|\[)/, description: 'bare localStorage (use globalThis.localStorage?.)' },
  { pattern: /(?<![.\w])sessionStorage(\.[a-zA-Z_$]|\[)/, description: 'bare sessionStorage (use globalThis.sessionStorage?.)' },
  { pattern: /(?<![.\w])requestAnimationFrame\s*\(/, description: 'bare requestAnimationFrame (use globalThis.requestAnimationFrame?.)' },
];

// #322 — recurse into subdirectories so an engine module placed under e.g.
// src/shaders/ can't escape the seam invariant. Returns paths RELATIVE to
// SRC_DIR with posix separators, so SEAM_EXEMPT keys on the repo-relative path
// (a root file's relative path is just its basename — existing entries match).
function collectSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSrcFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Engine .ts files (recursive), as SRC_DIR-relative posix paths. */
function listAllEngineFiles(): string[] {
  return collectSrcFiles(SRC_DIR).map((p) => p.slice(SRC_DIR.length + 1).split(sep).join('/'));
}

function listEngineFiles(): string[] {
  return listAllEngineFiles().filter((rel) => !SEAM_EXEMPT.has(rel));
}

describe('seam invariant — engine modules are environment-agnostic', () => {
  it('no engine module contains a typeof-window / typeof-process / isNode runtime branch', () => {
    const offenders: Array<{ file: string; pattern: string; line: string }> = [];
    for (const name of listEngineFiles()) {
      const text = readFileSync(join(SRC_DIR, name), 'utf8');
      for (const { pattern, description } of BANNED_PATTERNS) {
        const match = text.match(pattern);
        if (match !== null) {
          // Pull the offending line for the error message.
          const lines = text.split('\n');
          const lineIndex = lines.findIndex((l) => pattern.test(l));
          offenders.push({
            file: name,
            pattern: description,
            line: lineIndex >= 0 ? `${lineIndex + 1}: ${lines[lineIndex]!.trim()}` : '?',
          });
        }
      }
    }
    if (offenders.length > 0) {
      const formatted = offenders
        .map((o) => `  ${o.file}:${o.line}  [${o.pattern}]`)
        .join('\n');
      throw new Error(
        `seam invariant violated — engine modules must NOT branch on host environment:\n${formatted}\n` +
          `If this is intentional (new entry point or build-constant consumer), add the file to SEAM_EXEMPT in seam.test.ts.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('the SEAM_EXEMPT list points at real files (catches stale entries)', () => {
    // Keyed on SRC_DIR-relative posix paths (matches listEngineFiles); the test
    // files allowed in SEAM_EXEMPT are added explicitly since the scan skips them.
    const present = new Set([...listAllEngineFiles(), 'no-innerhtml.test.ts', 'parity.test.ts', 'parity-fe-be.test.ts']);
    const stale: string[] = [];
    for (const name of SEAM_EXEMPT) {
      if (!present.has(name)) stale.push(name);
    }
    expect(stale).toEqual([]);
  });
});

describe('seam invariant — engine module surface is stable', () => {
  it('createRenderer is exported from src/renderer.ts', () => {
    expect(typeof createRenderer).toBe('function');
  });

  it('QUALITY_TIERS exports a Draft tier as the default low-cost preset', () => {
    expect(QUALITY_TIERS.length).toBeGreaterThan(0);
    const draft = QUALITY_TIERS[0]!;
    expect(draft.name).toBe('Draft');
    expect(draft.longEdge).toBe(512);
    expect(draft.spp).toBeLessThan(20);
  });

  it('applyPreset(tierToSpec(tier)) returns a spec-shape that the Renderer understands', () => {
    const tier = QUALITY_TIERS[0]!;
    const spec = tierToSpec(tier);
    expect(spec.maxDim).toBe(tier.longEdge);
    expect(spec.maxSpp).toBe(tier.spp);
    expect(spec.oversample).toBe(1);
  });

  it('parseFlame is exported + accepts an XML string (smoke contract — no real flame parse)', () => {
    expect(typeof parseFlame).toBe('function');
    // Don't call it — linkedom not stamped in this env. The exported
    // identity is the contract that matters for the seam.
  });

  it('load-intent exports the gallery URL shape used by both surfaces', () => {
    expect(typeof galleryUrl).toBe('function');
    expect(GALLERY_PAGE_SIZE).toBe(9);
    expect(galleryUrl(1)).toMatch(/\/gallery$/);
    expect(galleryUrl(27)).toMatch(/\/gallery\/p\/27$/);
  });
});

describe('seam invariant — dawn-node globals stamp pattern works', () => {
  // bin/pyr3-render.ts + bin/pyr3-bake-features.ts both do
  // `Object.assign(globalThis, globals)` from the `webgpu` npm to make
  // WebGPU constants (GPUBufferUsage etc.) available to engine code.
  // This test verifies the dawn-node `globals` export still has the
  // constants the engine references — catches breaking changes to the
  // dawn-node API in node-only test runs (no GPU device needed).

  it('webgpu npm exports a globals object with the constants engine code uses', async () => {
    // dawn-node's `globals` export is typed as `Object`; cast to a record
    // shape locally so we can poke at the GPU* fields without ts-ignore.
    const dawn = await import('webgpu');
    const g = dawn.globals as unknown as Record<string, unknown>;
    expect(typeof g).toBe('object');
    expect(g).not.toBeNull();
    // The actual engine references these in shader bind groups, buffer
    // descriptors, texture descriptors, etc. If dawn-node drops or
    // renames any of these, the engine breaks under the CLI hosts.
    // The WebGPU spec exposes them as namespace-style objects with
    // static numeric props; dawn-node packages each as either a function
    // (class with static props) or a plain object depending on version,
    // both of which work at the engine call site (`GPUBufferUsage.COPY_SRC`
    // resolves either way). The contract we pin is presence + a
    // referenceable static prop.
    const required = [
      ['GPUBufferUsage', 'COPY_SRC'],
      ['GPUMapMode', 'READ'],
      ['GPUTextureUsage', 'RENDER_ATTACHMENT'],
      ['GPUShaderStage', 'COMPUTE'],
    ] as const;
    for (const [api, prop] of required) {
      const obj = g[api] as Record<string, unknown> | undefined;
      expect(obj, `dawn-node globals.${api} is missing`).toBeDefined();
      expect(obj![prop], `dawn-node globals.${api}.${prop} is missing`).toBeDefined();
    }
  });
});
