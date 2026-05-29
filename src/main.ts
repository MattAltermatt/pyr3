// pyr3 — viewer entry point.
//
// Boot WebGPU, mount the top bar, paint the default genome, then
// accept .flame files via the bar's Open button. Per the v1 design
// spec (docs/superpowers/specs/2026-05-26-pyr3-direction-design.md):
// no drag-drop, no `L` hotkey, no overlays on the rendered flame.

import { fetchFlameXml, FlameNotFound } from './chunk-fetch';
import { initDevice, showError } from './device';
import { SPIRAL_GALAXY, type Genome } from './genome';
import { parseLoadIntent, type LoadIntent } from './load-intent';
import { load as loadFileFromUser, type LoadResult } from './loader';
import { startChunkedRender, type RunHandle } from './render-orchestrator';
import { createRenderer, DEFAULT_FILTER_RADIUS, type Renderer } from './renderer';
import { mountBar, type BarHandle } from './ui-bar';
import { decodeFlame } from './url-codec';
import { checkWebGPU } from './webgpu-check';

// The "welcome flame" — what `/` paints when there are no URL params.
// Hardcoded path keeps the URL surface to a single share mechanism
// (?flame=<inline>); no bundled-fixture slug exposed. The specific
// flame was hand-picked from the Electric Sheep Fold (ESF) corpus.
const WELCOME_FLAME_URL = `${import.meta.env.BASE_URL}fixtures/electricsheep.247.19679.flam3`;

const RENDER_SIZE = 1024;

// Quick-preview render caps. Many .flam3 files (especially Electric
// Sheep / JWildfire pieces) ship with offline-rendering presets:
// `size="4096 4096"`, `quality="1000"`, `oversample="4"` are common.
// Those settings combine to ~256× more GPU work than the quick view
// needs — heavy enough to lock the browser. Quick caps:
//   · max(width, height) ≤ QUICK_MAX_DIM, aspect preserved
//   · quality clamped to QUICK_MAX_SPP
//   · oversample forced to QUICK_OVERSAMPLE
// The 4K render path is BE-only (see bin/pyr3-render.ts --preset 4k;
// the pre-v0.20 wrapper script scripts/pyr3-023-be-render-4k.mjs was
// graduated into src/presets.ts) — FE viewer is interactive at
// quick quality only. PYR3-023 probe found that FE 4K crashes Chrome
// for ~40% of showcase fixtures + runs 13× slower than BE when it
// doesn't crash; the showcase ships as static pre-rendered 4K JPGs
// per the predecessor renderer's pattern.
const QUICK_MAX_DIM = 1024;
const QUICK_MAX_SPP = 16;
const QUICK_OVERSAMPLE = 1;

async function main(): Promise<void> {
  const webgpu = await checkWebGPU();

  // First-paint cue ("dreaming…" in index.html) — cleared once the first
  // flame paints, so the visitor sees the engine is alive on a cold load.
  let firstPaintDone = false;
  const clearFirstPaintCue = (): void => {
    if (firstPaintDone) return;
    firstPaintDone = true;
    const cue = document.getElementById('pyr3-firstpaint');
    if (cue) {
      cue.classList.add('hidden');
      setTimeout(() => cue.remove(), 450);
    }
  };

  let openFilePicker: () => void = () => {
    console.warn('pyr3: file picker invoked before canvas init');
  };

  const bar: BarHandle = mountBar(document.getElementById('pyr3-bar')!, {
    webgpu,
    onOpenFile: () => openFilePicker(),
  });

  if (!webgpu.available) {
    const detail = webgpu.detail ? `, ${webgpu.detail}` : '';
    console.warn(`pyr3: WebGPU unavailable (reason=${webgpu.reason}${detail})`);
    mountWebGPUFallback();
    bar.setBusy(true);
    return;
  }

  const { device, context, format, canvas } = await initDevice('pyr3-canvas');
  canvas.width = RENDER_SIZE;
  canvas.height = RENDER_SIZE;

  const renderer: Renderer = createRenderer(device, format, {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    oversample: QUICK_OVERSAMPLE,
    filterRadius: DEFAULT_FILTER_RADIUS,
  });

  const seed = (Math.random() * 0xffffffff) >>> 0;
  let activeGenome: Genome = SPIRAL_GALAXY;

  let runHandle: RunHandle | null = null;

  // PYR3-018 FE parity sweep: pixel-readback hook (dev-only).
  // The canvas swap-chain texture is single-frame-presented and not
  // readable via drawImage / toDataURL post-render. This hook mirrors
  // the CLI readback (bin/pyr3-render.ts §5): allocate an offscreen
  // texture with COPY_SRC, re-present the existing accumulated
  // histogram into it (renderer.present is cheap; iteration state is
  // preserved), copyTextureToBuffer → mapAsync → return RGBA bytes.
  let lastRenderInfo: { genome: Genome; totalSamples: number } | null = null;
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3CapturePixels?: () => Promise<{ width: number; height: number; rgba: Uint8ClampedArray; format: GPUTextureFormat }>;
    }).__pyr3CapturePixels = async () => {
      if (!lastRenderInfo) {
        throw new Error('__pyr3CapturePixels: no render to capture (load a flame first)');
      }
      const { genome, totalSamples } = lastRenderInfo;
      const W = renderer.width;
      const H = renderer.height;
      const tex = device.createTexture({
        label: 'pyr3.capture.output',
        size: { width: W, height: H },
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      renderer.present({ genome, outputView: tex.createView(), totalSamples, forceDeOff: false });
      const bytesPerPixel = 4;
      const unpaddedBytesPerRow = W * bytesPerPixel;
      const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
      const readBuf = device.createBuffer({
        label: 'pyr3.capture.readback',
        size: bytesPerRow * H,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder({ label: 'pyr3.capture.encoder' });
      encoder.copyTextureToBuffer(
        { texture: tex },
        { buffer: readBuf, bytesPerRow, rowsPerImage: H },
        { width: W, height: H },
      );
      device.queue.submit([encoder.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      tex.destroy();
      readBuf.destroy();
      // Strip row padding to tight RGBA, swap channels if needed (Chrome's
      // preferred canvas format is bgra8unorm on macOS — our pipeline target
      // matches, but parity comparison + PNG encoding expects RGBA).
      const tight = new Uint8ClampedArray(W * H * 4);
      const swapBR = format === 'bgra8unorm';
      for (let y = 0; y < H; y++) {
        const srcOff = y * bytesPerRow;
        const dstOff = y * unpaddedBytesPerRow;
        if (swapBR) {
          for (let x = 0; x < W; x++) {
            const s = srcOff + x * 4;
            const d = dstOff + x * 4;
            tight[d] = padded[s + 2]!;   // R ← B
            tight[d + 1] = padded[s + 1]!; // G
            tight[d + 2] = padded[s]!;     // B ← R
            tight[d + 3] = padded[s + 3]!; // A
          }
        } else {
          tight.set(padded.subarray(srcOff, srcOff + unpaddedBytesPerRow), dstOff);
        }
      }
      return { width: W, height: H, rgba: tight, format };
    };
  }

  const rerender = async (): Promise<void> => {
    // Cancel any in-flight orchestrator before starting a new one. The
    // promise still settles cleanly (either 'cancelled' or 'completed')
    // so awaiting it serializes the JS side.
    if (runHandle) {
      runHandle.cancel();
      await runHandle.promise;
      runHandle = null;
      // Drain pending GPU before we potentially resize.
      await device.queue.onSubmittedWorkDone();
    }

    // Quick-preview sizing: cap at QUICK_MAX_DIM long-edge (no upscale
    // of small genomes — preview snappy). The 4K render path lives in
    // the BE CLI (bin/pyr3-render.ts) per PYR3-023 — FE viewer is
    // interactive at quick quality only.
    const declW = activeGenome.size?.width ?? RENDER_SIZE;
    const declH = activeGenome.size?.height ?? RENDER_SIZE;
    const maxDecl = Math.max(declW, declH);
    const sizeScale = maxDecl > QUICK_MAX_DIM ? QUICK_MAX_DIM / maxDecl : 1;
    const targetW = Math.max(1, Math.round(declW * sizeScale));
    const targetH = Math.max(1, Math.round(declH * sizeScale));
    const targetFilter = activeGenome.spatialFilter?.radius ?? DEFAULT_FILTER_RADIUS;

    if (
      targetW !== renderer.width
      || targetH !== renderer.height
      || QUICK_OVERSAMPLE !== renderer.oversample
      || targetFilter !== renderer.filterRadius
    ) {
      canvas.width = targetW;
      canvas.height = targetH;
      renderer.resize({ width: targetW, height: targetH, oversample: QUICK_OVERSAMPLE, filterRadius: targetFilter });
    }

    const renderGenome: Genome = {
      ...activeGenome,
      scale: activeGenome.scale * sizeScale,
      // CRITICAL: keep `genome.oversample` aligned with the pipeline's
      // configured oversample. chaos.ts computes the WGSL scale uniform as
      // `g.scale * g.oversample` — if the pipeline is built at oversample=1
      // but g.oversample stays at the genome's declared supersample
      // (often 4 for ES flames), the projection over-zooms by that factor,
      // producing the "camera stuck at the middle point" over-zoom symptom.
      oversample: QUICK_OVERSAMPLE,
      quality: Math.min(activeGenome.quality ?? QUICK_MAX_SPP, QUICK_MAX_SPP),
    };
    const targetSamples = (renderGenome.quality ?? QUICK_MAX_SPP) * renderer.width * renderer.height;

    // Tier 3 mounts immediately on render start — visitor always sees
    // "this is working" + "N% / chunk M of K". Hides on completion.
    bar.showProgress({
      label: 'Rendering',
      percent: 0,
      etaSeconds: 0,
      samples: 0,
      onCancel: () => runHandle?.cancel(),
    });

    const handle = startChunkedRender({
      renderer,
      genome: renderGenome,
      outputViewProvider: () => context.getCurrentTexture().createView(),
      targetSamples,
      seedBase: seed,
      onProgress: (info) => {
        bar.showProgress({
          label: 'Rendering',
          percent: info.percent,
          etaSeconds: info.etaSeconds,
          samples: info.samples,
          onCancel: () => runHandle?.cancel(),
        });
      },
    });
    runHandle = handle;
    if (import.meta.env.DEV) {
      (window as unknown as { __pyr3LastHandle?: RunHandle }).__pyr3LastHandle = handle;
    }
    // PYR3-018 capture hook reads from the post-render histogram via
    // renderer.present(). Stash genome + sample count so the hook can
    // re-present into an offscreen texture without re-iterating.
    lastRenderInfo = { genome: renderGenome, totalSamples: targetSamples };

    try {
      await handle.promise;
    } finally {
      bar.hideProgress();
      clearFirstPaintCue();
      if (runHandle === handle) runHandle = null;
    }
  };

  const applyLoadResult = async (result: LoadResult, sourceLabel: string): Promise<void> => {
    // Resize logic lives in rerender (it depends on the loaded genome's
    // dims); applyLoadResult just updates activeGenome + meta then kicks
    // the render path, which resizes if needed.
    activeGenome = result.genome;
    if (result.kind === 'flame' && result.report) {
      const dropCount = result.report.droppedVariations.length;
      const ignoredCount = result.report.ignoredFields.length;
      if (dropCount > 0 || ignoredCount > 0) {
        console.log(
          `pyr3: import report — ${dropCount} unsupported variations · ${ignoredCount} ignored fields`,
        );
      }
    }
    console.log(`pyr3: loaded "${result.genome.name}" from ${sourceLabel}`);
    bar.setMeta({
      flameName: result.genome.name || 'Untitled',
      authorNick: result.genome.nick,
      sourceFilename: sourceLabel,
    });
    await rerender();
  };

  let loadInFlight = false;
  const loadFromFile = async (file: File): Promise<void> => {
    console.log(`pyr3: loadFromFile("${file.name}") · loadInFlight=${loadInFlight}`);
    if (loadInFlight) {
      console.warn(`pyr3: load already in flight; ignoring ${file.name}`);
      return;
    }
    loadInFlight = true;
    bar.setBusy(true);
    try {
      const result = await loadFileFromUser(file);
      await applyLoadResult(result, file.name);
      // Wait for the GPU to drain the queued work before releasing the
      // loadInFlight guard. The orchestrator's promise resolves when
      // JS-side iterate calls finish; GPU may still be processing.
      // Without this drain, the NEXT load's renderer.resize() can
      // destroyPipelines() while previous commands still reference
      // those buffers (Phase 2 verify, 2026-05-26).
      await device.queue.onSubmittedWorkDone();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`pyr3: failed to load ${file.name}: ${msg}`);
      bar.showToast('Couldn’t load that .flame — see console.');
    } finally {
      // Clear the first-paint cue even if the (initial) load threw before
      // rerender() ran — otherwise "dreaming…" would stick on a black canvas.
      // Idempotent via the firstPaintDone guard.
      clearFirstPaintCue();
      bar.setBusy(false);
      loadInFlight = false;
    }
  };

  // PYR3-026 FE↔BE parity rig: programmatic flame-load hook (dev-only).
  // Mirrors the file-picker path (loadFromFile → applyLoadResult →
  // rerender) but takes raw text so Playwright can inject each fixture
  // without touching the OS file dialog. Serialized via an internal
  // queue so the test rig's `__pyr3LoadFlame(A); __pyr3LoadFlame(B)`
  // sequence does NOT hit loadFromFile's in-flight rejection — and
  // waits for the initial welcome-flame load to settle before its
  // first call. Awaiting resolves once the render completes (rerender
  // awaits the orchestrator promise).
  let loadHookQueue: Promise<void> = Promise.resolve();
  if (import.meta.env.DEV) {
    (window as unknown as {
      __pyr3LoadFlame?: (text: string, label?: string) => Promise<void>;
    }).__pyr3LoadFlame = (text: string, label = 'test.flame') => {
      const next = loadHookQueue.then(async () => {
        // If a non-hook caller (welcome flame, file picker) is still
        // in flight, wait it out — loadFromFile would otherwise reject.
        while (loadInFlight) {
          await new Promise((r) => setTimeout(r, 25));
        }
        const file = new File([text], label, { type: 'text/xml' });
        await loadFromFile(file);
      });
      loadHookQueue = next.catch(() => {});
      return next;
    };
  }

  openFilePicker = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.flame,.flam3';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await loadFromFile(file);
      input.remove();
    });
    // Chrome 113+ fires `cancel` when the OS dialog is dismissed without a
    // selection — without this listener, hidden inputs accumulate on cancel.
    input.addEventListener('cancel', () => input.remove());
    document.body.appendChild(input);
    input.click();
  };

  // Resolve initial load from the URL (parseLoadIntent): a /v1/gen/{gen}/id/{id}
  // corpus link, a legacy ?flame= share link, or default. Fallback chain is
  // welcome fixture → hardcoded SPIRAL_GALAXY (safety net if fetch fails —
  // better than a black canvas).
  const intent = parseLoadIntent(window.location);
  const initialFile = await resolveLoadIntent(intent);
  if (initialFile) {
    await loadFromFile(initialFile);
  } else {
    console.warn('pyr3: no initial load resolved; painting SPIRAL_GALAXY default');
    bar.setMeta({ flameName: SPIRAL_GALAXY.name });
    await rerender();
  }

  console.log(
    `pyr3: ${renderer.width}×${renderer.height} (oversample ${renderer.oversample}), seed=0x${seed.toString(16).padStart(8, '0')} — click 📂 Open .flame in the bar to load a different flame.`,
  );
}

function mountWebGPUFallback(): void {
  const fallback = document.getElementById('pyr3-fallback');
  if (!fallback) return;
  document.body.classList.add('webgpu-unavailable');
  // DOM-build the explainer (createElement + textContent so no
  // innerHTML XSS surface).
  fallback.replaceChildren();
  const h2 = document.createElement('h2');
  h2.textContent = '⚠️ This browser can\'t run WebGPU';
  const p1 = document.createElement('p');
  p1.textContent = "pyr3 renders fractal flames using your GPU through the WebGPU web standard. Your current browser doesn't expose it — so there's no engine here to draw with.";
  const fixP = document.createElement('p');
  fixP.className = 'fix';
  const fixStrong = document.createElement('strong');
  fixStrong.textContent = 'Likely fix: ';
  fixP.append(fixStrong, document.createTextNode('Chrome 113+, Edge 113+, Safari 18+ on macOS Sequoia, or Firefox Nightly. Sometimes a flag toggle, sometimes a GPU-driver update.'));
  const ul = document.createElement('ul');
  for (const item of [
    'Chrome / Edge 113+ (auto-enabled)',
    'Safari 18+ on macOS Sequoia',
    'Firefox Nightly (behind dom.webgpu.enabled in about:config)',
  ]) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  const cta = document.createElement('a');
  cta.className = 'cta';
  cta.href = `${import.meta.env.BASE_URL}help/webgpu.html#why-not-working`;
  cta.textContent = 'Read the full WebGPU help page ↗';
  fallback.append(h2, p1, ul, fixP, cta);
  fallback.hidden = false;
}

async function resolveLoadIntent(intent: LoadIntent): Promise<File | null> {
  switch (intent.kind) {
    case 'corpus': {
      // Share-link leaf: /v1/gen/{gen}/id/{id} → fetch the one chunk holding
      // this sheep, extract its flam3 XML, render it.
      try {
        const xml = await fetchFlameXml(intent.gen, intent.id);
        const name = `electricsheep.${intent.gen}.${intent.id}.flam3`;
        return new File([xml], name, { type: 'text/xml' });
      } catch (err) {
        if (err instanceof FlameNotFound) {
          showError(
            `pyr3: gen ${intent.gen} sheep ${intent.id} isn't in the corpus — ` +
              `it was never born, or was lost upstream.`,
          );
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          showError(`pyr3: couldn't load gen ${intent.gen} sheep ${intent.id} — ${msg}.`);
        }
        return fetchAsFile(WELCOME_FLAME_URL);
      }
    }
    case 'gen-list':
    case 'gen-browse':
    case 'custom-reserved':
      // Browse + custom-flame sharing are a deferred phase (design spec §12).
      // For now, paint the welcome flame; no gallery/overlay UI is built yet.
      console.info(`pyr3: "${intent.kind}" view is not built yet (deferred) — painting welcome flame.`);
      return fetchAsFile(WELCOME_FLAME_URL);
    case 'flame':
      try {
        const xml = await decodeFlame(intent.payload);
        return new File([xml], 'from-link.flame', { type: 'text/xml' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`pyr3: failed to decode ?flame= share link — ${msg}; falling back to welcome`);
        return fetchAsFile(WELCOME_FLAME_URL);
      }
    case 'default':
      return fetchAsFile(WELCOME_FLAME_URL);
  }
}

async function fetchAsFile(path: string): Promise<File | null> {
  try {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const filename = path.split('/').pop() ?? 'flame';
    return new File([blob], filename, { type: 'text/xml' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`pyr3: failed to fetch ${path} — ${msg}`);
    return null;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('pyr3 init failed:', err);
  showError(`pyr3: init failed — ${msg}`);
});
