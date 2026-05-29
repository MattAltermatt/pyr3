# Corpus share-URL & chunk delivery — pyr3's responsibilities

> **Canonical spec lives in electric-sheep-fold:**
> `electric-sheep-fold/docs/superpowers/specs/2026-05-28-corpus-share-url-and-chunk-delivery-design.md`
> (local sibling path: `../../electric-sheep-fold/docs/superpowers/specs/2026-05-28-corpus-share-url-and-chunk-delivery-design.md`).
> This file is a pointer + a summary of the **pyr3-side** work. Do not
> duplicate design detail here — edit the canonical spec.

## What pyr3 must do (short-term scope)

A shareable URL like `https://pyr3.app/v1/gen/247/id/12345` opens pyr3 and
loads that exact corpus flame.

1. **URL router** — parse `location.pathname` under `/v1/`:
   - `/v1/gen` → browse landing (list gens from `/chunks/gens.json`).
   - `/v1/gen/{gen}` → reserved; render a "browse coming soon — N available"
     placeholder fed by the availability manifest (visual gallery is deferred).
   - `/v1/gen/{gen}/id/{id}` → load & render the corpus flame.
   - `/v1/flame/{token}` → reserved (future custom flame); "not yet supported".
   - Keep decoding legacy `?flame=v1:<gzip+base64url>` indefinitely.
2. **Chunk fetch + decode** — `chunk_lo = (id // 256) * 256`; fetch
   `/chunks/{gen}/{chunk_lo:05d}.flam3chunk` (same-origin, baked into the
   deploy); fetch **raw bytes**; brotli-decode via
   `DecompressionStream("brotli")` with a feature-detect + lazy ~200 KB
   wasm fallback; `JSON.parse`; pick the id (skip the `"_v"` key); hand the
   XML to the existing flame-import path. The opaque `.flam3chunk` extension
   is deliberate — never assume `Content-Encoding`.
3. **Availability** — lazy-load `/chunks/{gen}/avail.flam3idx` (brotli'd
   present-id list) to render browse + to short-circuit dead-link clicks
   with a "this sheep doesn't exist (lost upstream)" state *before* fetching
   a chunk.
4. **GH Pages deploy workflow** — Actions build → **bake-at-deploy** step
   (`gh release download` the `corpus-chunks-{date}.tar` from
   electric-sheep-fold, pinned by tag, untar into `dist/chunks/`) →
   `cp dist/index.html dist/404.html` + `touch dist/.nojekyll` →
   `upload-pages-artifact`. Custom domain `pyr3.app` (CNAME + DNS).

## Routing note (load-bearing)

Path routing on GH Pages uses the `404.html` SPA-fallback and returns an
HTTP **404 status** on deep links — cosmetic for humans, but it forecloses
nothing: a future Cloudflare Worker can upgrade to 200 + per-flame social
previews **without changing any URL**. Hash routing was rejected precisely
because `#fragments` never reach a server, permanently killing per-flame
previews. See the canonical spec §"The one-way door".

## Deferred (documented in the canonical spec §12, not built now)

Per-flame social previews (Cloudflare Worker + offline thumbnail bake via
`npm run render` → R2), the `/v1/gen/{gen}` visual gallery, and the
`/v1/flame/{token}` custom-flame form.
