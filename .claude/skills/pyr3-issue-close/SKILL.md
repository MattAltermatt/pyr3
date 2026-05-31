---
name: pyr3-issue-close
description: Properly close out a finished pyr3 GitHub issue — verifies the work actually shipped (merged, tests green, docs updated), posts a closing summary comment, closes the issue as completed, and moves its "pyr3 roadmap" board card to Done so it never resurfaces. Use when the user says "close #N", "mark N done", "wrap up issue N", or finishes issue-tracked work.
disable-model-invocation: true
---

# pyr3-issue-close

Standardized exit for a pyr3 issue. The mirror of `pyr3-issue-start`. User-invoked
only (it performs GitHub writes) — Claude must not auto-fire it.

**Input:** an issue number, e.g. `/pyr3-issue-close 6` (a leading `#` is fine).

## Why this exists

An issue closed on GitHub but left `In Progress`/`Backlog` on the **board** is the
exact failure that makes a later session redo finished work — `whats-next` and the
human both read the board, not the issue's closed-state. **Closing is not "done" until
the board card reads `Done`.** This skill makes that atomic, behind a completeness gate.

## Workflow

1. **Completeness gate — confirm it actually shipped.** Do NOT close on hope. Verify,
   with evidence (per the global "evidence before success claims" rule):
   - Work is **merged to `main`** — `git log --oneline main | grep -i "#<N>"` or the
     linked PR is merged. If still on a feature branch, FF-merge first (separate ask).
   - **Tests + typecheck pass**: `npm run typecheck && npm test` (run the parity rig
     only if the render path was touched).
   - **Docs track code**: if behavior/feature/flags changed, `CLAUDE` / `README` /
     `VISION` and `HISTORY.md` are updated.
   - The work matches what the issue actually asked for (re-read the issue body).

   If any item fails → stop and finish it. Don't close a half-done issue.

2. **Post a closing summary comment** — what shipped, the commit SHA(s), and any
   residual follow-up (with the new issue number if one was filed):
   ```bash
   gh issue comment <N> --body "Shipped in <sha> (<one-line what>). <residual / follow-up #M if any>."
   ```

3. **Close the issue as completed.**
   ```bash
   gh issue close <N> --reason completed
   ```

4. **Move the board card to Done** (the load-bearing step):
   ```bash
   scripts/gh-board-status.sh <N> "Done"
   ```

5. **Verify the end state** — read it back, don't assume:
   ```bash
   gh issue view <N> --json state,closed
   gh project item-list 1 --owner MattAltermatt --format json --limit 400 \
     | ISSUE=<N> python3 -c 'import json,sys,os; n=int(os.environ["ISSUE"]); h=next((i for i in json.load(sys.stdin)["items"] if i.get("content",{}).get("number")==n),None); print("board:", h.get("status") if h else "(not on board)")'
   ```
   Confirm `state == CLOSED` **and** `board: Done`. Only then report the issue closed.

## Quick reference

```text
gate     merged to main? tests/typecheck green? docs updated? matches the ask?
comment  gh issue comment <N> --body "Shipped in <sha> ..."
close    gh issue close <N> --reason completed
board    scripts/gh-board-status.sh <N> "Done"
verify   gh issue view <N> --json state,closed   +   board read-back == Done
```

## Common mistakes

- **Closing the issue but not the board card.** This is the bug this skill prevents —
  `whats-next` reads the board; a closed-but-not-Done issue gets redone. Step 4 is
  mandatory, not optional.
- **Closing on "it compiles".** The gate wants merged + green + docs, with evidence.
- **Silent close.** Always leave the closing comment — it's the provenance a future
  session reads before reopening anything.
