---
name: pyr3-release
description: Run the pyr3 milestone-release ritual end-to-end — bump package.json, FF-merge the bump, verify the deploy, tag, push the tag, cut a GitHub Release with notes composed from closed issues, close the milestone. Use when a v1.x milestone hits 100% closed.
disable-model-invocation: true
---

# pyr3-release

The standardized end-of-milestone ship. User-invoked only — it pushes a tag, creates a GitHub Release, and closes the milestone. Claude must NOT auto-fire it.

**Input:** the version string, e.g. `/pyr3-release 1.3.0` (no `v` prefix; the `v` is added at tag time).

## Preconditions (bail loudly on any miss)

1. **Milestone is 100% closed.** `gh api repos/MattAltermatt/pyr3/milestones --jq '.[] | select(.title | startswith("v<MAJOR>.<MINOR>")) | "\(.open_issues)/\(.closed_issues)"'` must say `0/N`.
2. **On main, tree clean.** `git rev-parse --abbrev-ref HEAD == main` and `git status --porcelain` empty.
3. **Main is in sync with origin.** `git fetch origin && git status -sb` shows no `ahead`/`behind`.
4. **Latest CI + Deploy on main are green** (`gh run list --branch main --limit 2`).
5. **The tag `v<version>` does NOT yet exist** locally or on remote.

## Workflow

### Phase A — bump

1. Create a release branch: `git checkout -b release/v<version>`.
2. Bump `package.json` `"version"` from current to `<version>`.
3. Local gates: `npm run typecheck && npm test`.
4. Commit: `git commit -am "chore: bump version to <version>"`.
5. Push: `git push -u origin release/v<version>`.
6. FF-merge to main: `git checkout main && git merge --ff-only release/v<version> && git push origin main`.
7. Delete the release branch local + remote: `git branch -d release/v<version> && git push origin --delete release/v<version>`.

### Phase B — verify deploy

8. Wait for the deploy on the bumped main to complete (`gh run list --branch main --limit 1 --json conclusion`). Must be `success`.
9. Verify live: hand the user `https://pyr3.app/`, ask them to confirm the new version chip is visible. The deploy isn't truly shipped until the live page proves it (per `feedback-verify-live-before-claiming-ship`). **STOP HERE** for an explicit user `go` before tagging.

### Phase C — tag + release

10. Tag: `git tag -a v<version> -m "v<version> — <milestone tagline>"`.
11. Push tag: `git push origin v<version>`.
12. Compose release notes — group closed issues by theme (Highlights / Tooling / CI / etc.) using the closing comment of each issue as a one-liner. Mirror the v1.2.0 release tone (see `gh release view v1.2.0 --json body`). Include a `## Milestone` link and a `## Compatibility` section.
13. Create the GitHub Release: `gh release create v<version> --title "v<version> — <tagline>" --notes-file <path-or-stdin>`.

### Phase D — close milestone

14. Find the milestone number: `gh api repos/MattAltermatt/pyr3/milestones --jq '.[] | select(.title | startswith("v<MAJOR>.<MINOR>")) | .number'`.
15. Close: `gh api -X PATCH repos/MattAltermatt/pyr3/milestones/<N> -f state=closed`.
16. Verify end state: `gh api repos/MattAltermatt/pyr3/milestones/<N> --jq '{title, state, open_issues, closed_issues}'`. Must say `closed`.

## Quick reference

```text
A. bump        branch → bump package.json → gates → commit → push → FF-merge → push main → delete branch
B. verify      wait for deploy SUCCESS → hand user pyr3.app → wait for explicit go
C. tag/release git tag -a v<version> → push → gh release create with composed notes
D. close       gh api PATCH milestones/<N> state=closed → verify
```

## Common mistakes

- **Tagging before the deploy is live.** The user-verify gate in Phase B is the only check that the live site reflects the new version. Don't skip.
- **Wrong tag format.** Tag is `v<version>` (with the `v`); the input arg is `<version>` (without). The skill adds the `v` at tag time.
- **Force-pushing or rewriting tag history.** Tags on GitHub are reproducibility anchors; if you got the tag wrong, file a new patch release instead of rewriting.
- **Closing the milestone before the Release exists.** A closed milestone with no Release looks half-finished. Order is: tag → release → close.
