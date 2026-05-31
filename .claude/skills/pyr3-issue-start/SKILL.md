---
name: pyr3-issue-start
description: Start work on a pyr3 GitHub issue — guards against picking up an already-shipped (closed/Done) issue, moves its "pyr3 roadmap" board card Ready → In Progress, assigns it to the user, and sets up the feature branch. Use when the user says "start #N", "work on #N", "pick up issue N", or begins any issue-tracked task.
disable-model-invocation: true
---

# pyr3-issue-start

Standardized entry point for working a pyr3 issue, so every session opens work the
same way and the board reflects reality. User-invoked only (it performs GitHub
writes) — Claude must not auto-fire it.

**Input:** an issue number, e.g. `/pyr3-issue-start 6` (a leading `#` is fine).

## Why this exists

`whats-next` and the human both read the **board** to decide what to do next. If a
shipped issue is left `In Progress` (never moved to `Done`), it resurfaces and gets
**redone**. This skill's mirror — `pyr3-issue-close` — moves things to `Done`; this
skill *guards the front door* so you never start something already finished.

## Workflow

1. **GUARD — is it already done?** (the redo-work trap)
   ```bash
   gh issue view <N> --json number,title,state,labels,milestone,assignees,url
   # board status (read-only):
   gh project item-list 1 --owner MattAltermatt --format json --limit 400 \
     | ISSUE=<N> python3 -c 'import json,sys,os; n=int(os.environ["ISSUE"]); h=next((i for i in json.load(sys.stdin)["items"] if i.get("content",{}).get("number")==n),None); print(h.get("status") if h else "(not on board)")'
   ```
   If `state == CLOSED` **or** board status is `Done` → **STOP**. Show the closing
   comment / linked PR and say plainly: *"#N looks already shipped — confirm before
   reopening."* Do not start work until the user confirms. This is the single most
   important step.

2. **Confirm intent.** Echo title, type/size labels, and milestone so the user knows
   it's the right issue.

3. **Move the board card Ready → In Progress.** Two transitions (the user's standard):
   ```bash
   scripts/gh-board-status.sh <N> "Ready"
   scripts/gh-board-status.sh <N> "In Progress"
   ```
   End state is `In Progress`. The script adds the issue to the board if absent.

4. **Assign to the user.**
   ```bash
   gh issue edit <N> --add-assignee @me
   ```

5. **Set up the feature branch** (global rule: branch, don't work on `main`). Suggest
   `feature/issue-<N>-<short-slug>`; create it if the user wants:
   ```bash
   git switch -c feature/issue-<N>-<slug>
   ```

6. **Summarize.** Print: board status, assignee, branch, and the issue URL.

## Quick reference

```text
guard      gh issue view <N> + board-status read   →  STOP if CLOSED/Done
board      scripts/gh-board-status.sh <N> "Ready" ; then "In Progress"
assign     gh issue edit <N> --add-assignee @me
branch     git switch -c feature/issue-<N>-<slug>
```

## Common mistakes

- **Skipping the guard.** The whole reason this skill exists. Always check state first.
- **Working on `main`.** Issue work goes on a `feature/...` branch.
- **Forgetting the board.** Assigning the issue isn't enough — `whats-next` keys off
  the board Status, so the card must read `In Progress`.
