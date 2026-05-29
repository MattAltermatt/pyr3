---
name: pyr3-backlog-add
description: File a new [PYR3-NNN] BACKLOG entry with monotonic ID, correct section placement, and the conventional template (bug entries get Symptom/Hypothesis/Next-phase scaffolding). Use when the user asks to file a backlog entry, name a bug, or capture an investigation finding.
disable-model-invocation: true
---

# pyr3-backlog-add

User-invocable workflow for adding a new entry to `BACKLOG.md` with project conventions enforced. Has side effects (mutates BACKLOG.md), so this skill is user-only — Claude must not invoke it autonomously.

## Inputs

- `<title>`: short title for the entry.
- `[--type bug|feature|investigation|chore]` (default `feature`).
- `[--size XS|S|M|L|XL]` (default unspecified — let the user fill it in).
- `[--tag v1.0|v1.x|much-later]` (default `v1.x`).

## Workflow

1. Read `BACKLOG.md`.
2. Find the "Next ID" counter at the top (format: `Next ID: PYR3-NNN`).
3. Compose the new entry header `### [PYR3-NNN] <title>`.
4. Insert the body per `--type`:
   - **`bug`** (mandatory template per global CLAUDE.md):
     ```
     **Symptom (observed YYYY-MM-DD):** <what user saw>
     **Hypothesis (unverified):** <possible cause>
     **Next phase:** verify hypothesis against current code first.
     ```
   - **`investigation`**: probe-style header — what's being investigated, what artefacts (probe script, fixture, reference render) will be touched, decision rule for when the investigation closes.
   - **`feature` / `chore`**: lighter scaffold — title + size pill + tag pill + one-line description placeholder.
5. Insert into the correct section. `BACKLOG.md` is organised by status (`## Active`, `## Backlog`, `## Iceboxed`, etc.) — default new entries to `## Backlog` unless `--type investigation` (then `## Active`).
6. Increment the "Next ID" counter at the top.
7. Print the new ID and a single absolute path the user can `open`.

## Conventions (from pyr3/CLAUDE.md + global CLAUDE.md)

- IDs are monotonic — never reuse a number even for a deleted entry.
- Format strictly `[PYR3-NNN]` (3 digits, zero-padded).
- Bug-entry template is non-negotiable per the global "separate symptom from hypothesis" rule.
- Don't commit unless the user asks — this skill only writes BACKLOG.md. The user runs commit-commands afterward.
- Size letters lead: XS / S / M / L / XL (cognitive complexity), wall-clock estimates only as bracketed addition.
