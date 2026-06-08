# #53 — Global default quality preference (Option C)

**Date:** 2026-06-01
**Status:** Approved (brainstorm Q&A, 2026-06-01)
**Tracking:** GitHub issue [#53](https://github.com/MattAltermatt/pyr3/issues/53)

## Problem

The viewer's quality choice is session-sticky (PYR3-050 — `currentQuality` survives ‹/› nav within a session) but resets on page refresh / cold load. The user has to re-pick their preferred tier every visit.

## Decision

Persist the user's most recent `QualityRequest` in `localStorage` under key `pyr3-prefs`. Cold load reads it as the initial `currentQuality`; every subsequent quality change writes back. No per-sheep state, no global UI for the preference — the existing tier picker IS the setter.

User directive (2026-06-01, brainstorm): "if a user selects a quality, it should stay that quality." This rules out per-sheep (Option A) and favorites-list (Option B); user picked Option C.

## Storage

```text
key:    pyr3-prefs
value:  JSON-encoded { globalQuality: QualityRequest }
        — wrapper object (not bare QualityRequest) so a future per-sheep
          layer can extend without breaking compat:
          { globalQuality, perSheep: { "247/19679": "High", ... } }
```

Examples:
- Tier pick: `{"globalQuality":{"kind":"tier","tier":"High"}}`
- Custom pick: `{"globalQuality":{"kind":"custom","longEdge":2000,"spp":75}}`

Tier is stored as the tier's `name` (string), not the full `QualityTier` object — the runtime resolves the name to the `QUALITY_TIERS` entry on read. Decouples persisted data from in-memory tier shape (a future tier-table change doesn't invalidate stored prefs unless the tier name disappears).

## Read path (cold load)

`src/main.ts:217` init becomes:
```ts
let currentQuality: QualityRequest = readGlobalQuality() ?? { kind: 'tier', tier: DEFAULT_TIER };
```

`readGlobalQuality()` lives in new `src/prefs.ts`. Returns `QualityRequest | null`:
- `null` if `localStorage.getItem('pyr3-prefs')` is null.
- `null` if `JSON.parse` throws.
- `null` if the shape doesn't match (no `globalQuality` field, unknown `kind`, unknown tier name, custom missing/invalid `longEdge`/`spp`).
- Otherwise: the resolved `QualityRequest`.

Safe to bad data: any malformed pref silently falls back to `DEFAULT_TIER` (Preview).

## Write path (on quality change)

Single choke point: every site in `main.ts` where `currentQuality = ...` happens, add a paired `writeGlobalQuality(currentQuality)` call. Today there are 1-2 such sites (the bar's `onQualityChange` callback and the custom-panel apply).

`writeGlobalQuality(q)`:
- Serializes `{globalQuality: q}` to JSON.
- `localStorage.setItem('pyr3-prefs', json)`.
- Wrapped in try/catch — `localStorage` can throw (Safari private mode, quota exceeded). Failure silently drops the write; preferences are best-effort.

## Gallery interplay

- Gallery cells stay at Draft tier (gallery is the discovery surface; per #47 design).
- Clicking a cell calls `loadCorpus(gen, id, true)` which goes through the existing render path — `currentQuality` (now driven by the global pref) applies.
- Initial-load route `/v1/gen/N/id/M` (cold-link entry) also lands in the same `currentQuality`-driven render, so a shared URL of "High preferred" → "/v1/gen/X/id/Y" loads at High on the recipient's machine too (subject to their own pref).

## First-time visitor

No `pyr3-prefs` in localStorage → `readGlobalQuality()` returns `null` → fall through to `DEFAULT_TIER` (Preview) → behavior identical to today's cold load.

## Slow-load cue

Saved tier > Preview means first paint takes 1–5s on heavy fixtures. The existing render-progress bar (which already fires for High/4K renders mid-session) handles this. No new UI.

## Tests

`src/prefs.test.ts`:
- `readGlobalQuality` returns `null` when key missing.
- `readGlobalQuality` returns `null` on malformed JSON.
- `readGlobalQuality` returns `null` on shape mismatch (no `globalQuality`, unknown tier name, custom missing `longEdge`).
- Read/write round-trip for tier kind (every tier in `QUALITY_TIERS`).
- Read/write round-trip for custom kind (sample dims/spp).
- `writeGlobalQuality` does NOT throw when `localStorage.setItem` throws (mocked).

Uses happy-dom `localStorage` (vitest default for `src/` tests).

## Out of scope (deferred)

- Per-sheep memory (Option A) — the wrapper-object storage shape leaves room for it.
- Favorites-list view (Option B).
- Cross-device sync.
- A "reset to defaults" button. (User can pick Preview; that becomes the saved pref.)

## Spec self-review

- No placeholders / TBDs.
- Internally consistent: storage shape ↔ read/write helpers ↔ test list.
- Scope tight: single localStorage key, single new module, single test file, ~5 lines in main.ts.
- No ambiguity: tier name string is the persisted form; runtime resolves.
