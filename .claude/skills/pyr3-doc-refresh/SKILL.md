---
name: pyr3-doc-refresh
description: Audit and refresh in-repo documentation (README, VISION, CLAUDE.md) and run a live-page staleness audit to check for version, variation count, and hero references on deployed sites. Use when the user says "doc refresh", "refresh docs", "pyr3 doc-refresh", "update all docs", "audit the docs", or otherwise asks for a comprehensive documentation refresh.
---

# pyr3-doc-refresh

A project-specific doc-refresh pass that combines the standard in-repo documentation cleaning checks with a live deployed page staleness audit. 

## When to use

- After shipping major feature milestones or batching variation additions.
- Before preparing a new release or tagging v1.x.
- Whenever the user asks to check if the docs are up to date.

## Workflow

1. **Setup Branch:**
   Ensure you are on a documentation-specific branch (e.g., `feature/docs-refresh-YYYYMMDD`). Do not work on `main`.

2. **Codebase Snapshot:**
   Inspect current version from `package.json`, current variation count from `src/variations.ts` (keys in `V`), and active milestones.

3. **Live Deployed Audit:**
   Run `npm run audit:live` to fetch and audit the public URLs listed under the "Live pages to audit" section in `CLAUDE.md`. Look for:
   - Stale variation counts (e.g. references to `99`, `220`, or `225` variations instead of the current count).
   - Stale versions (e.g. references to pre-release or outdated version numbers).
   - Stale hero sheep images or links.

4. **In-Repo Shape Audit:**
   Audit and refresh the local repository documentation using the standard rules:
   - **README.md:** Keep description, features, setup commands. Links to vision/history. No inline ship history.
   - **VISION.md:** Core vision, past tense for shipped milestones.
   - **HISTORY.md:** Append-frozen pre-1.0 ship log. Do not touch.
   - **CLAUDE.md:** Keep it current with command listings and configuration.

5. **Generate Punch List:**
   Report a summary to the user outlining:
   - Local documentation updates made (with diff summaries).
   - Public/live page mismatches found (e.g. "https://pyr3.app/help/about.html says 99 variations, but code has 257").

6. **User Review & Memory Consolidation:**
   Apply local updates in separate commits per document. Run the CLAUDE.md improver and perform auto-memory consolidation (`/consolidate-memory`).
