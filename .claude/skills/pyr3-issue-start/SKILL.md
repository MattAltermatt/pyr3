---
name: pyr3-issue-start
description: Start work on a pyr3 GitHub issue — guards against picking up an already-shipped (closed) issue, assigns it to the user, and sets up the feature branch. Use when the user says "start #N", "work on #N", "pick up issue N", or begins any issue-tracked task.
---

# pyr3-issue-start

Standardized entry point for working a pyr3 issue, so every session opens work
the same way. User-invoked only (it performs GitHub writes) — Claude must not
auto-fire it.

**Input:** an issue number, e.g. `/pyr3-issue-start 6` (a leading `#` is fine).

## Why this exists

Without a guard, it's easy to pick up an issue that already shipped (closed but
something resurfaced it in conversation) and redo the work. This skill checks
state first, then sets up the branch atomically.

## Workflow

1. **GUARD — is it already closed?** (the redo-work trap)
   ```bash
   gh issue view <N> --json number,title,state,labels,milestone,assignees,url
   ```
   If `state == CLOSED` → **STOP**. Show the closing comment / linked PR and say
   plainly: *"#N looks already shipped — confirm before reopening."* Do not start
   work until the user confirms. This is the single most important step.

2. **Confirm intent.** Echo title, type/size labels, and milestone so the user
   knows it's the right issue.

3. **Assign to the user.**
   ```bash
   gh issue edit <N> --add-assignee @me
   ```

4. **Set up the feature branch** (global rule: branch, don't work on `main`).
   Suggest `feature/issue-<N>-<short-slug>`; create it if the user wants:
   ```bash
   git switch -c feature/issue-<N>-<slug>
   ```

5. **Summarize.** Print: state, assignee, branch, and the issue URL.

## Quick reference

```text
guard      gh issue view <N>                       →  STOP if CLOSED
assign     gh issue edit <N> --add-assignee @me
branch     git switch -c feature/issue-<N>-<slug>
```

## Common mistakes

- **Skipping the guard.** The whole reason this skill exists. Always check state first.
- **Working on `main`.** Issue work goes on a `feature/...` branch.
