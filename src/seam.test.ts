// Seam-invariant unit tests (#60).
//
// pyr3's load-bearing architectural invariant: the same engine modules
// (`src/*.ts` + `src/shaders/*.wgsl`) drive BOTH the browser viewer
// (`src/main.ts`) and the headless CLI (`bin/pyr3-render.ts` +
// `bin/pyr3-bake-features.ts`). The CLI hosts stamp WebGPU globals +
// happy-dom's DOMParser onto `globalThis` before importing engine code;
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
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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
  'about-mount.ts',       // /about page body — DOM-mounting (#103 visual overhaul)
  'variation-picker.ts',  // DOM-mounting variation picker (#79)
  'screensaver-mount.ts', // /v1/screensaver page body — DOM-mounting (#109)
  'screensaver-ui.ts',    // /v1/screensaver landing card — DOM-mounting (#109)
  'screensaver-record.ts', // MediaRecorder wrapper — URL.createObjectURL + anchor download (#111)
  'webgpu-check.ts',      // probes navigator.gpu — checking is its job
  'brotli.ts',            // platform-aware decoder probe (native vs wasm)
  'device.ts',            // viewer-side device acquisition uses navigator.gpu
  'save-image.ts',        // unrelated — exports a pure helper, no env access
  'save-flame.ts',        // viewer .pyr3.json export — uses URL.createObjectURL + anchor download (#103 visual overhaul)
  'no-innerhtml.test.ts', // test file; allowed
  'parity.test.ts',       // test file
  'parity-fe-be.test.ts', // test file
  'render-orchestrator.ts', // orchestrator pulls rAF when available — see below
  'edit-mount.ts',        // /v1/edit page mount — owns canvas + DOM
  'edit-ui.ts',           // /v1/edit panel shell — DOM-mounting
  'edit-section-palette.ts',  // /v1/edit section — DOM-mounting
  'edit-section-viewport.ts', // /v1/edit section — DOM-mounting
  'edit-section-xforms.ts',   // /v1/edit section — DOM-mounting
  'edit-section-final.ts',    // /v1/edit section — DOM-mounting
  'edit-section-global.ts',   // /v1/edit section — DOM-mounting
  'edit-section-density.ts',  // /v1/edit section — DOM-mounting
  'edit-section-render.ts',   // /v1/edit section — DOM-mounting
  'edit-canvas-nav.ts',   // /v1/edit pan + zoom — owns mouse/wheel listeners on window
  'edit-xform-viz.ts',    // /v1/edit affine viz — owns a 2D canvas
  'edit-variation-picker.ts',  // /v1/edit variation picker — owns a modal, document keydown listener
  'edit-scrubby-input.ts',     // /v1/edit drag-to-scrub numeric cell — owns DOM + pointer lock
  'edit-primitives.ts',        // /v1/edit shared row/input/dropdown/swatch/pair builders (#103 Phase 7)
  'edit-tooltip.ts',           // /v1/edit info-icon + anchored popover (#103 Phase 7)
  'palette-picker.ts',         // /v1/edit docked palette picker (#103 Phase 9)
  'edit-slow-render-nudge.ts', // /v1/edit slow-render UX nudge — owns toast DOM (#118)
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
];

function listEngineFiles(): string[] {
  return readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .filter((name) => !SEAM_EXEMPT.has(name));
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
    const present = new Set(readdirSync(SRC_DIR));
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
    // Don't call it — happy-dom not stamped in this env. The exported
    // identity is the contract that matters for the seam.
  });

  it('load-intent exports the gallery URL shape used by both surfaces', () => {
    expect(typeof galleryUrl).toBe('function');
    expect(GALLERY_PAGE_SIZE).toBe(9);
    expect(galleryUrl(1)).toMatch(/v1\/gallery$/);
    expect(galleryUrl(27)).toMatch(/v1\/gallery\/p\/27$/);
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
