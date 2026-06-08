# Predecessor-reference scrub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (this plan runs
> lead-inline — it is shell-heavy: `git rm`, `git grep`, `.gitignore` edits). Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all references to the non-public predecessor repos (`pyr3-kotlin`, `pyr3-peek`,
`pyr3-rust`, `flam3-kotlin`) and all machine-local absolute paths from the v1 public working
tree, keeping the public `flam3` lineage and the CHANGELOG/git-history narrative intact.

**Architecture:** A linear file-group scrub on a `feature/predecessor-scrub` branch. Each task
edits one coherent group, verifies with `git grep`, and commits. Functional safety is proven by
`npm run typecheck`, `npm test` (unit), and `npm run test:parity` (flam3-C, 25 fixtures) at the
end. No engine logic changes.

**Tech Stack:** git, ripgrep/`git grep`, Node/Vitest, npm scripts.

**Spec:** `docs/superpowers/specs/2026-05-29-predecessor-scrub-design.md` (local-only).

**Reference pattern (used throughout):**
`PRED='pyr3-kotlin|pyr3-peek|pyr3-rust|flam3-kotlin'`

---

## Task 0: Branch

- [ ] **Step 1: Create the feature branch**

Run: `git switch -c feature/predecessor-scrub`
Expected: `Switched to a new branch 'feature/predecessor-scrub'`

- [ ] **Step 2: Confirm clean baseline + capture starting counts**

Run: `git status` (expect clean except the already-staged hygiene + spec/plan files from this
session), then `git grep -icE "$PRED" | wc -l` and `git grep -n '/Users/matt' | wc -l`.
Record both numbers — verification at the end drives them to (near) zero.

---

## Task 1: Deletions — untrack internal scaffolding + drop the kotlin 4K gate

**Files:**
- Untrack: `docs/superpowers/` (keep on disk)
- Untrack: `.claude/agents/wgsl-parity-reviewer.md`, `.claude/agents/flame-fixture-investigator.md`
- Delete: `fixtures/kotlin-4k-refs/`, `fixtures/kotlin-goldens/`, `src/parity-4k.test.ts`
- Delete: `scripts/pyr3-023-4k-build-html.mjs`, `scripts/pyr3-023-probe-build-html.mjs`,
  `scripts/pyr3-024-build-html.mjs`, `scripts/pyr3-024-probe.mjs`
- Modify: `.gitignore`, `package.json`, `vitest.config.ts` (if it names parity-4k)

- [ ] **Step 1: Untrack internal scaffolding (keep local copies)**

```bash
git rm -r --cached docs/superpowers
git rm --cached .claude/agents/wgsl-parity-reviewer.md .claude/agents/flame-fixture-investigator.md
```

- [ ] **Step 2: Add gitignore entries**

Append to `.gitignore`:
```
# internal scaffolding — not part of the public repo
docs/superpowers/
.claude/agents/wgsl-parity-reviewer.md
.claude/agents/flame-fixture-investigator.md
```

- [ ] **Step 3: Delete the kotlin 4K gate + its orphaned probe scripts**

```bash
git rm -r fixtures/kotlin-4k-refs fixtures/kotlin-goldens
git rm src/parity-4k.test.ts
git rm scripts/pyr3-023-4k-build-html.mjs scripts/pyr3-023-probe-build-html.mjs scripts/pyr3-024-build-html.mjs scripts/pyr3-024-probe.mjs
```
(If any path is already untracked/missing, drop it from the command — verify with `git ls-files`.)

- [ ] **Step 4: Remove `test:parity-4k` wiring**

Edit `package.json`: delete the `test:parity-4k` script and remove it from any `test:all`
composite. Check `vitest.config.ts` for a parity-4k include/path and remove if present.
Search first: `grep -rn 'parity-4k' package.json vitest.config.ts`.

- [ ] **Step 5: Verify nothing functional broke**

Run: `npm run typecheck`
Expected: PASS (no dangling import of the removed test or scripts).
Run: `grep -rn 'parity-4k\|kotlin-4k-refs\|kotlin-goldens' package.json vitest.config.ts src scripts`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: untrack internal scaffolding + drop legacy kotlin 4K parity gate"
```

---

## Task 2: NOTICE.md — legal surgery

**Files:** Modify `NOTICE.md`

- [ ] **Step 1: Remove the two self-authored predecessor sections, keep flam3**

Delete the `## TS + WGSL basis: pyr3-peek` section and the `## GPU shader / parser / variation
ports: pyr3-kotlin` section in full. KEEP the flam3 / Scott Draves upstream-reference section
verbatim (legally required third-party GPL attribution). If a sentence in the kept intro
references pyr3-peek/pyr3-kotlin, reword to describe pyr3 as an independent GPL-3.0-or-later
reimplementation reading flam3 C as reference.

- [ ] **Step 2: Verify**

Run: `git grep -nE "$PRED" -- NOTICE.md`
Expected: no matches. `grep -n flam3 NOTICE.md` still shows the Scott Draves attribution.

- [ ] **Step 3: Commit**

```bash
git add NOTICE.md
git commit -m "chore: NOTICE.md keep flam3 attribution, drop self-authored predecessor sections"
```

---

## Task 3: CLAUDE.md — Lineage table, Port convention, pointers

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: Scrub predecessor references**

- Replace the `## Lineage (where ports come from)` table: drop the pyr3-kotlin / pyr3-peek /
  pyr3-rust rows and all absolute paths. Keep a one-line note that pyr3 reads flam3 (C) as its
  reference lineage.
- Remove the `Port: pyr3-kotlin <ref>` commit-message convention paragraph.
- In `## Useful pointers`, delete bullets pointing at predecessor repo paths; keep flam3 +
  in-repo pointers.

- [ ] **Step 2: Verify**

Run: `git grep -nE "$PRED" -- CLAUDE.md`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: scrub predecessor lineage + Port convention from CLAUDE.md"
```

---

## Task 4: Public docs — VISION / ROADMAP / README / flam3-local-build / BACKLOG

**Files:** Modify `VISION.md`, `ROADMAP.md`, `README.md`, `docs/flam3-local-build.md`, `BACKLOG.md`

- [ ] **Step 1: Scrub VISION / ROADMAP / README**

Genericize predecessor mentions. Lineage phrasing becomes "flam3 → pyr3" (drop the fictional
`flam3-kotlin` intermediate and the pyr3-kotlin/peek mentions). Keep flam3 references. Preserve
each doc's meaning — these describe pyr3's own story, so rephrase rather than delete wholesale.

- [ ] **Step 2: Scrub docs/flam3-local-build.md**

Strip absolute `/Users/matt/...pyr3-kotlin/...` paths; keep the flam3 build guidance (the flam3
source lives publicly at `github.com/scottdraves/flam3` — reference that, not a local kotlin
checkout).

- [ ] **Step 3: BACKLOG.md — rewrite PYR3-032 as done + genericize residue**

Mark `[PYR3-032]` RESOLVED (this scrub IS its functional slice). Genericize remaining kotlin
mentions in other live entries (e.g. PYR3-030's CpuF64Backend path reference → describe the
algorithm, drop the path). Leave the new `[PYR3-043]` slot for Task 8.

- [ ] **Step 4: Verify**

Run: `git grep -nE "$PRED" -- VISION.md ROADMAP.md README.md docs/flam3-local-build.md BACKLOG.md`
Expected: no matches (or only an intentional, documented one — note it if so).

- [ ] **Step 5: Commit**

```bash
git add VISION.md ROADMAP.md README.md docs/flam3-local-build.md BACKLOG.md
git commit -m "docs: scrub predecessor references from public docs + BACKLOG"
```

---

## Task 5: Source-comment scrub

**Files:** Modify `src/compare.ts`, `src/serialize.ts`, `src/shaders/chaos.wgsl`

- [ ] **Step 1: Remove Port comments**

In each file, delete the `Port: pyr3-kotlin ...` provenance comment line(s). Keep any flam3
algorithmic citation (e.g. "matches flam3 var36" / `rect.c` references) — flam3 is public.

- [ ] **Step 2: Verify**

Run: `git grep -nE "$PRED" -- src/`
Expected: no matches.
Run: `npm run typecheck`
Expected: PASS (comments-only edits, but confirm).

- [ ] **Step 3: Commit**

```bash
git add src/compare.ts src/serialize.ts src/shaders/chaos.wgsl
git commit -m "chore: drop Port: pyr3-kotlin provenance comments from engine source"
```

---

## Task 6: Functional — manifest + showcase scripts (local-path scrub)

**Files:** Modify `fixtures/showcase-v1.0/_manifest.json`,
`scripts/render-showcase-v1.0.mjs`, `scripts/build-showcase-v1.0-gallery.mjs`

- [ ] **Step 1: Strip local prefixes from the manifest**

In `_manifest.json`, replace every `source` value's `/Users/matt/dev/MattAltermatt/` prefix with
a portable relative form. Two cases:
- already-`electric-sheep-fold` paths → relative `electric-sheep-fold/corpus/<gen>/<bucket>/<file>`.
- any `pyr3-kotlin/parity/...` paths → re-point to the matching public ESF corpus path (same
  `electricsheep.<gen>.<id>.flam3` exists under `electric-sheep-fold/corpus/<gen>/<bucket>/`).

Confirm each re-pointed path exists: `ls /Users/matt/dev/MattAltermatt/electric-sheep-fold/corpus/<gen>/<bucket>/<file>`
before writing the relative form. (This is dev-only gallery-regen metadata, not a CI gate.)

- [ ] **Step 2: Scrub the showcase scripts**

In both scripts, replace hardcoded `/Users/matt/...` source roots with a resolved relative
path or a documented env var / sibling-repo default. Keep behavior identical for the maintainer.

- [ ] **Step 3: Verify**

Run: `git grep -nE "$PRED" -- fixtures/showcase-v1.0/_manifest.json scripts/`
Expected: no matches.
Run: `git grep -n '/Users/matt' -- fixtures/showcase-v1.0/_manifest.json scripts/render-showcase-v1.0.mjs scripts/build-showcase-v1.0-gallery.mjs`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add fixtures/showcase-v1.0/_manifest.json scripts/render-showcase-v1.0.mjs scripts/build-showcase-v1.0-gallery.mjs
git commit -m "chore: portable relative source paths in showcase manifest + scripts"
```

---

## Task 7: Repo-wide local-path sweep (incl. CHANGELOG)

**Files:** any remaining tracked file with `/Users/matt`

- [ ] **Step 1: Find residue**

Run: `git grep -n '/Users/matt'`
Expected at this point: only CHANGELOG.md and possibly a stray doc.

- [ ] **Step 2: Genericize each match**

For each hit, remove or genericize the local path (describe the file/repo by public name, or
drop the path). In CHANGELOG, keep the prose/version narrative (kotlin mentions stay) but strip
the absolute path itself.

- [ ] **Step 3: Verify**

Run: `git grep -n '/Users/matt'`
Expected: no matches in tracked files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: strip machine-local absolute paths from tracked files"
```

---

## Task 8: Backlog stub + doc sync

**Files:** Modify `BACKLOG.md`, `ROADMAP.md`, `CHANGELOG.md`

- [ ] **Step 1: File PYR3-043 stub**

Add at the top of BACKLOG (and bump the "Next ID" pointer to PYR3-044):
```
## [PYR3-043] parity · M · 🪶 · queued · post-v1 — Optional 4K parity gate vs flam3-C

Filed 2026-05-29. The legacy kotlin-v1.1 4K parity gate (fixtures/kotlin-4k-refs +
src/parity-4k.test.ts) was dropped during the predecessor-reference scrub — it compared against
a non-canonical reference (kotlin renders), superseded by the flam3-C ground-truth pivot (v0.18).
The native-dim flam3-C rig (npm run test:parity, 25 fixtures) is the canonical gate and is
unaffected. If a dedicated 4K-resolution regression guard is ever wanted, render a handful of
fixtures through flam3-C at 4K and calibrate per-fixture thresholds (mirrors the native rig).
Not needed for correctness — 4K is the same engine at higher sample/pixel counts.
```

- [ ] **Step 2: Add a CHANGELOG entry for the scrub ship**

Add a `## vX.Y` entry (next version after v0.24) summarizing: predecessor-reference scrub —
working tree cleared of pyr3-kotlin/pyr3-peek/pyr3-rust/flam3-kotlin + machine-local paths;
docs/superpowers/ + parity-investigator agent defs untracked; legacy kotlin 4K gate dropped
(PYR3-043 stub); NOTICE keeps flam3, drops self-authored predecessor sections; git history +
CHANGELOG narrative preserved; PYR3-032 resolved.

- [ ] **Step 3: Sync ROADMAP**

Update the Shipped table + Chunk 4 notes to reflect the scrub (PYR3-032 done; ready for repo
replacement).

- [ ] **Step 4: Commit**

```bash
git add BACKLOG.md ROADMAP.md CHANGELOG.md
git commit -m "docs: file PYR3-043, resolve PYR3-032, changelog the predecessor scrub"
```

---

## Task 9: Full verification gate

- [ ] **Step 1: Predecessor references gone**

Run: `git grep -inE "$PRED"`
Expected: only CHANGELOG.md narrative lines (the documented exception). Zero in src, scripts,
fixtures, config, README/VISION/ROADMAP/CLAUDE/NOTICE. Eyeball the CHANGELOG hits to confirm
they're all narrative, not paths.

- [ ] **Step 2: Local paths gone**

Run: `git grep -n '/Users/matt'`
Expected: zero matches.

- [ ] **Step 3: Functional safety**

Run: `npm run typecheck` → PASS
Run: `npm test` → unit suite green
Run: `npm run test:parity` → 25/25 flam3-C fixtures green (confirms manifest/script edits and the
4K-gate removal broke nothing functional). ~91s.

- [ ] **Step 4: Code review**

Dispatch a fresh `feature-dev:code-reviewer` (or `code-review` skill) over the branch diff — no
implementation bias. Confirm: no accidental flam3-attribution loss, no functional path breakage,
NOTICE legal section intact.

- [ ] **Step 5: User-verify before FF-merge**

Surface the final `git grep` results + the NOTICE.md diff for manual inspection. Wait for explicit
approval before FF-merging `feature/predecessor-scrub` → `main`.
