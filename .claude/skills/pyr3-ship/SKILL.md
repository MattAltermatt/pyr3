---
name: pyr3-ship
description: Ship a finished pyr3 feature branch — FF-merge to main, push, close the linked issue with a SHA-stamped comment, delete the branch local + remote. Use when the user says "/pyr3-ship N", "ship #N", "FF-merge and close N", or finishes verifying an issue's work on a feature branch.
disable-model-invocation: true
---

# pyr3-ship

The standardized ship-the-branch sequence. User-invoked only — it pushes to main, closes an issue, and deletes the branch on origin. Claude must NOT auto-fire it.

**Input:** an issue number, e.g. `/pyr3-ship 53` (a leading `#` is fine).

## Why this exists

Every shipped issue in this session triggered the same 5–6-command sequence:
`git checkout main && git merge --ff-only ... && git push origin main && gh issue close N --comment ... && git branch -d ... && git push origin --delete ...`. The skill captures it as one invocation, derives the SHA + branch + commit-body summary from current state, and removes a class of "forgot to delete remote branch" / "wrong issue number in comment" errors.

## Preconditions (bail loudly on any miss)

1. **On a feature branch** (not main). `git rev-parse --abbrev-ref HEAD` must NOT be `main`.
2. **Tree is clean.** `git status --porcelain` empty.
3. **Branch is pushed.** `git rev-parse --quiet --verify origin/<branch>` resolves AND `git status -sb | grep -E 'ahead|behind'` is empty.
4. **CI passed on the branch tip** — `gh run list --branch <branch> --limit 1 --json conclusion -q '.[0].conclusion'` is `success`. If still in progress, wait (or bail and ask the user). If failed, bail — don't ship red.
5. **Issue N exists + is open.** `gh issue view N --json state -q .state` is `OPEN`.

## Workflow

1. **Derive context.**
   ```bash
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   SHA=$(git rev-parse HEAD)
   SHA_SHORT=$(git rev-parse --short HEAD)
   COMMIT_SUBJECT=$(git log -1 --format=%s)
   ```

2. **FF-merge + push main.**
   ```bash
   git checkout main
   git merge --ff-only "$BRANCH"
   git push origin main
   ```

3. **Close the issue with a SHA-stamped comment.** Derive the comment from the commit body (one-line summary or first paragraph). The standard form:
   ```bash
   gh issue close N --comment "Shipped in [<SHA_SHORT>](https://github.com/MattAltermatt/pyr3/commit/<SHA>) — FF-merged to main. <commit subject>. Gates: ..."
   ```
   If the commit body includes a `Closes #N` trailer, GitHub may auto-close — still post the comment to record the SHA + gates.

4. **Delete the branch local + remote.**
   ```bash
   git branch -d "$BRANCH"
   git push origin --delete "$BRANCH"
   ```

5. **Verify the end state — read it back.**
   ```bash
   gh issue view N --json state,closed -q '. | "\(.state) \(.closed)"'   # must say "CLOSED true"
   git branch --remotes | grep "$BRANCH" && echo "ERROR: remote branch still present" || true
   ```

## Quick reference

```text
preconds  feature branch, clean tree, pushed, branch CI green, issue OPEN
merge     git checkout main && git merge --ff-only <branch> && git push origin main
close     gh issue close N --comment "Shipped in [SHA](url) — ..."
delete    git branch -d <branch> && git push origin --delete <branch>
verify    gh issue view N --json state  →  CLOSED
```

## Common mistakes

- **Skipping the CI check** — shipping a red branch in a hotfix scramble. The skill's CI gate is load-bearing.
- **Force-delete (`-D`) when `-d` refuses** — `-d` refuses unmerged work; that's the safety. If it refuses after FF-merge, something's wrong; investigate.
- **Wrong issue number in the comment** — the skill takes N as input precisely so the comment can't drift. Pass it explicitly; don't infer.
