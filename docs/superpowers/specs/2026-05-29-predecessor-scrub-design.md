# Predecessor-reference scrub — design

**Date:** 2026-05-29
**Status:** approved (brainstorm Q&A)
**Topic:** Remove all non-public predecessor references from the v1 public working tree.

> Note: this spec lives under `docs/superpowers/`, which this very task excludes from the
> public repo (Q3=A). It is therefore **local-only scaffolding** — written for the record,
> not committed to the public history.

## Context

pyr3 is about to go public (Chunk 4: GitHub repo replacement + gh-pages). The working tree
still carries ~178 references across 22 tracked files to **non-public predecessor repos**:
`pyr3-kotlin`, `pyr3-peek`, `pyr3-rust`, and `flam3-kotlin` (a name that was never a real
project). It also carries ~30 machine-local absolute paths (`/Users/matt/dev/MattAltermatt/...`)
that leak the maintainer's filesystem and the private repo locations.

A public ship reading these references looks unfinished and exposes private context. This task
scrubs them. The **flam3** (Scott Draves) C lineage is public, legitimate, and legally required
attribution — it **stays**.

This is the broadened, "scrub everything" execution of the FUNCTIONAL slice of `[PYR3-032]`.

## Goal

The v1 public **working tree** has:
- Zero references to `pyr3-kotlin` / `pyr3-peek` / `pyr3-rust` / `flam3-kotlin`.
- Zero machine-local absolute paths.

flam3 lineage stays. Git history and the CHANGELOG *narrative* are left intact as the factual
record (the in-repo analog of git history).

## Locked decisions (brainstorm Q1–Q4)

1. **Git history: untouched.** Scrub only the current working tree; old commit messages stay as
   the honest record.
2. **Kotlin 4K parity gate: dropped.** `fixtures/kotlin-4k-refs/` + `fixtures/kotlin-goldens/` hold
   kotlin v1.1's *render outputs* baked into `src/parity-4k.test.ts`. Since the v0.18 pivot,
   flam3-C is ground truth and the native-dim rig (`npm run test:parity`, 25 fixtures) is the
   canonical gate — the kotlin-4K comparison is legacy. Delete it; lose zero canonical coverage.
   File `[PYR3-043]` stub for an optional future 4K-vs-flam3-C gate.
3. **`docs/superpowers/`: excluded from the public repo.** Internal brainstorm/plan scaffolding,
   not user docs. `git rm -r --cached` + `.gitignore`; local copies kept. Clears ~46 references.
4. **CHANGELOG.md: narrative kept, local paths scrubbed.** Version/prose kotlin mentions stay
   (some entries — e.g. v0.18 — are *about* the kotlin→flam3-C pivot and can't be scrubbed
   without becoming incoherent). All `/Users/matt/...` absolute paths are removed even here.

## Work

### 1. Deletions (untrack predecessor artifacts; local copies kept)
- `git rm -r --cached docs/superpowers/` + add to `.gitignore`.
- `git rm` `fixtures/kotlin-4k-refs/`, `fixtures/kotlin-goldens/`, `src/parity-4k.test.ts`, the
  orphaned `scripts/pyr3-023-*` + `scripts/pyr3-024-*` helpers that reference them; remove the
  `test:parity-4k` script from `package.json` + any vitest config wiring.
- `git rm --cached .claude/agents/wgsl-parity-reviewer.md` +
  `.claude/agents/flame-fixture-investigator.md` + `.gitignore` them — internal tooling whose
  defined purpose is diffing pyr3 against the private kotlin source.

### 2. NOTICE.md (legal — careful surgery)
- **KEEP** the flam3 / Scott Draves upstream-reference section (third-party GPL-3.0, legally
  required).
- **REMOVE** the "TS + WGSL basis: pyr3-peek" and "GPU shader / parser / variation ports:
  pyr3-kotlin" sections — these attribute the maintainer's own prior GPL works (same author →
  no third-party obligation → safe to drop). Confirmed with user.

### 3. CLAUDE.md (project → public)
- Drop the Lineage-table predecessor rows + absolute paths; keep a one-line flam3 lineage note.
- Remove the `Port: pyr3-kotlin <ref>` commit-message convention.
- Scrub predecessor paths from "Useful pointers."

### 4. Public docs — scrub in place (keep flam3, drop predecessors + local paths)
- `VISION.md` / `ROADMAP.md` / `README.md`: genericize; lineage reads "flam3 → pyr3."
- `docs/flam3-local-build.md`: strip local paths; keep flam3 build guidance.
- `BACKLOG.md`: rewrite `[PYR3-032]` as the scrub itself / mark done; genericize residual kotlin
  mentions in other entries (PYR3-030, etc.).

### 5. Source comments
- `src/compare.ts`, `src/serialize.ts`, `src/shaders/chaos.wgsl`: remove `Port: pyr3-kotlin`
  provenance comments. Keep flam3 algorithmic citations (public/legit).

### 6. Functional — manifest + scripts
- `fixtures/showcase-v1.0/_manifest.json`: strip `/Users/matt/dev/MattAltermatt/` prefixes →
  portable relative ESF paths; re-point any pyr3-kotlin source paths to the public
  `electric-sheep-fold` corpus. (Gallery regen is dev-only — not a CI gate.)
- `scripts/render-showcase-v1.0.mjs` + `scripts/build-showcase-v1.0-gallery.mjs`: same local-path
  scrub.

### 7. Local-path sweep (everywhere, incl. CHANGELOG)
- `git grep -n '/Users/matt'` → genericize/remove every match in tracked files.

## Verification

- `git grep -iE 'pyr3-kotlin|pyr3-peek|pyr3-rust|flam3-kotlin'` → only the documented
  CHANGELOG-narrative exceptions remain; zero elsewhere in tracked files.
- `git grep -n '/Users/matt'` → zero tracked matches.
- `npm run typecheck && npm test` (unit) green.
- `npm run test:parity` (flam3-C rig, 25 fixtures) green — confirms nothing functional broke
  (manifest/script edits, fixture-gate removal).
- `package.json` has no dangling `test:parity-4k` reference.
- `[PYR3-043]` backlog stub filed (optional 4K-vs-flam3-C gate).
- 6-doc set synced; CHANGELOG entry added for the scrub ship.

## Out of scope (local-only, never published)
- `~/.claude` project memory, `.remember/`, global `~/.claude/CLAUDE.md`.

## Execution mode
Lead-inline. The work is shell-heavy (`git rm`, `git grep`, `.gitignore` edits, cross-file
edits) — subagents have narrower Bash perms. Single focused session on a `feature/predecessor-scrub`
branch.
