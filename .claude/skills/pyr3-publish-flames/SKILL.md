---
name: pyr3-publish-flames
description: Publish the user's own flames from ~/pyr3-flames/incoming into the live gallery. Use when the user says "publish my flames", "ship my flames", "bake my incoming flames", "add my flames to the gallery", or drops new flames in ~/pyr3-flames/incoming and asks to publish them. Runs ingest (--add-new) → bake from json/ → commit → push → verify pyr3.app.
---

# Publish flames (Pass 3)

The recurring pipeline. New flames in `~/pyr3-flames/incoming/` get a stable gallery id,
land in `~/pyr3-flames/json/`, are baked into the gen-1000 gallery, committed, pushed, and
shipped to pyr3.app. Run from the pyr3 repo root (`/Users/matt/dev/MattAltermatt/pyr3`).

The one-time reconcile (Pass 1 `flames:ingest`) and backfill (Pass 2 `flames:backfill`) are
NOT part of this skill — they ran once. This skill is steady-state only.

## Preconditions
- On a clean tree. Branch off `main` first: `feature/publish-flames-<YYYY-MM-DD>`.
- `~/pyr3-flames/incoming/` contains the new flames (png with embedded `pyr3` genome,
  or raw `.pyr3.json`).

## Steps

1. **Dry-run ingest.** `npm run flames:ingest -- --add-new`
   Show the planned writes + new id range. No mutation yet. If it reports `0 write(s)`,
   stop — there is nothing new to publish.

2. **Apply ingest.** `npm run flames:ingest -- --add-new --apply`
   Writes `json/<id>.pyr3.json` per new flame, deletes consumed `incoming/` sources, and
   appends new ids to `flames/pyr3-natives/ledger.json`. Confirm `incoming/` is now empty
   (or holds only files it skipped + warned about — investigate any skips).

3. **Bake from json/.** `npm run bake:natives`
   (Default src is `~/pyr3-flames/json`.) Regenerates `public/chunks/1000/*` and
   `public/chunks/pyr3-*`. ~minutes on a real GPU.

4. **Verify locally.** `npm run typecheck && npm test` — both must pass.

5. **Show the diff.** `git status` + `git diff --stat`. Expected repo changes ONLY:
   `flames/pyr3-natives/ledger.json`, `public/chunks/1000/*`, `public/chunks/pyr3-*`.
   `~/pyr3-flames/json/` is private — NOT part of the repo diff. Flag anything unexpected.

6. **GATE — ask the user to approve the ship.** Commit + push are gated per the user's
   workflow. Surface the new-flame count + id range (e.g. "publishing 6 flames, ids 487–492").
   Wait for an explicit go.

7. **Commit + push + FF-merge.** On the feature branch:
   `git add flames/pyr3-natives/ledger.json public/chunks` →
   `git commit -m "feat: publish N native flames (ids X–Y)"` → push the branch →
   FF-merge to `main` per the user's standard flow → push `main`. Then delete both branch
   ends (FF-merge cleanup is standing-authorized at merge time).

8. **Verify live.** pyr3.app auto-deploys on push to `main` (deploy.yml). After the deploy,
   open https://pyr3.app/gallery and confirm the count rose / the new flames lead page 1
   (gen `pyr3`). Confirm `main` advanced and HEAD == the publish commit.

## Invariants (do not break)
- **Identity:** ingest writes the RAW parsed pyr3-JSON; a `json/<id>.pyr3.json` always
  re-hashes to its own gallery id. Never re-serialize via `genomeToJson` to "clean up" a file.
- **Private json/:** `~/pyr3-flames/json/` and `renders/` are the user's local library; only
  the derived `ledger.json` + `public/chunks/*` ship to GitHub.
- **Dry-run first:** always run step 1 before step 2; never `--apply` blind.

## Companion — Pass 4 HQ renders
`npm run flames:render` renders every `json/<id>.pyr3.json` → `~/pyr3-flames/renders/<id>.png`
at 4K (long-edge 3840), quality 2000. Resumable (skips existing, atomic temp→rename),
shows per-render progress + ETA. Independent of publishing — run it whenever, stop/resume
freely. `renders/` is private (not committed).
