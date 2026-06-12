---
name: pyr3-serve-verify
description: Boot pyr3-serve from a fresh dist build and hand a clickable URL for backend-gated viewer features (animation export, Save Render past the browser quality cap, /api/render, /api/animate) that `npm run dev` leaves disabled. Use when Chrome-verifying anything that depends on the Dawn-node backend host — the `📤 Export sequence` button, capability-gated controls, or any /api/* route.
---

# pyr3-serve-verify

`npm run dev` (plain Vite) serves the viewer but **cannot** exercise backend-gated
features: the `📤 Export sequence` button on `/v1/animate`, Save Render past the
browser's ≤200 quality cap, and the `/api/render` + `/api/animate` SSE routes are
all capability-gated to `can_render_animation` / `can_write_files`, which are only
true under `pyr3 serve`. Verifying them by hand is a 4-step dance
(build → serve-from-dist → load flame → drive Chrome). This skill collapses that.

## When to use

- Chrome-verifying the animation **Export sequence** modal or its outputs.
- Verifying **Save Render** at quality above the browser cap (#201 backend path).
- Any change that touches `/api/render`, `/api/animate`, `/api/pick-dir`, or the
  capability gate (`src/capability.ts`, `bin/pyr3-serve.ts`, `bin/serve/*`).
- Any `/v1/*` UI whose control is **disabled on gh-pages / dev** and only lights
  up under the local backend host.

Do NOT use for ordinary render-path verification — that's plain `npm run dev`
(faster, no build step) or the `pyr3-verify` parity-HTML skill.

## Why a fresh dist build is mandatory

`pyr3 serve` serves the viewer from `dist/` only when `PYR3_SERVE_FROM_DIST=1` is
set; without a build it warns "no viewer asset source detected" and returns 503
for static assets (API still responds). And because the served viewer JS is the
**built bundle**, any source change you're verifying must be rebuilt first — a
stale `dist/` will silently show old behavior.

## Workflow

1. **Build the viewer.** `npm run build` (~2s). Don't skip — the served bundle is
   what the user inspects.

2. **Launch serve-from-dist in the background** (the agent starts servers, per the
   global workflow — never hand the user a start command as a precondition):
   ```bash
   PYR3_SERVE_FROM_DIST=1 npm run serve >/tmp/pyr3-serve.log 2>&1 &
   disown
   ```

3. **Poll until listening**, then confirm the viewer (not just the API) responds:
   ```bash
   # wait for the listen line, then check a real viewer route
   sleep 7; grep -m1 listening /tmp/pyr3-serve.log
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/v1/animate   # expect 200
   ```
   Port is **5174** (pyr3 serve's default — distinct from Vite's 5173). If 503,
   the dist build didn't land / `PYR3_SERVE_FROM_DIST` wasn't set — fix and retry.

4. **Hand the clickable URL on its own line** (pyr3 has no audio — no `?mute=1`):
   ```
   http://localhost:5174/v1/animate
   ```
   Name the route the feature lives on (`/v1/animate`, `/v1/edit`, `/v1`, …) and,
   for animation work, a known **multi-keyframe** fixture to load:
   `fixtures/flam3-goldens/247.29388/247.29388.flam3` (2 keyframes, t = 0 … 160).
   Single-keyframe flames open in the Viewer, not the animation surface.

5. **Drive Chrome via `chrome-devtools-mcp`** (never the built-in preview). The
   `📤 Export sequence` button enables once a multi-keyframe flame is loaded; its
   tooltip distinguishes the two disabled states (install-pyr3 vs load-a-flame).
   `upload_file` accepts in-tree fixture paths; read back DOM state with
   `evaluate_script` rather than chained `getImageData` (synchronous redraws don't
   flush to the readable backing store — prefer screenshots).

6. **Teardown** when done verifying:
   ```bash
   pkill -f pyr3-serve; sleep 1; lsof -ti:5174 || echo 'port free'
   ```

## Gotchas

- **Rebuild on every source change you re-verify.** Vite HMR does not apply to the
  served dist bundle — it's a static build. Re-run step 1 after each edit.
- **`pkill -f pyr3-serve`, not the npm wrapper PID.** `npm run serve` spawns a
  child `node bin/pyr3-serve.ts`; killing the npm PID can orphan the listener.
  Match the process by name and confirm `:5174` is free.
- The SEA binary (`npm run build:cli:serve` → `build/pyr3-serve`) is the
  production host; for local verify the tsx path (`npm run serve`) is faster and
  needs no SEA fuse.
