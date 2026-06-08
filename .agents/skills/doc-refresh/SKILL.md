---
name: doc-refresh
description: Extended doc-refresh for pyr3. Inherits the global comprehensive dev-doc audit and additionally audits all human-facing UI pages for accuracy.
---

# `doc-refresh` (pyr3 extended)

**IMPORTANT:** This is an extended version of the global `doc-refresh` skill. When invoked, you must FIRST read and apply the complete workflow from the global skill at `~/.agents/skills/doc-refresh/SKILL.md` (which handles README, VISION, CLAUDE, GitHub Issues, `.remember/` consolidation, etc.).

In addition to that global workflow, you must **ALSO** perform the following pyr3-specific human-facing documentation audit:

## Pyr3-Specific Extension: Human-Facing Pages

Before concluding the doc-refresh and running the final memory consolidations, you must audit the human-facing web application to ensure its textual descriptions match the current engine implementation:

1. **Check `index.html`:** Audit any static textual explanations, feature lists, "about" sections, or inline help.
2. **Check UI Source Files:** Locate UI components in `src/` that render user-facing help text, parameter tooltips, sidebars, or modals (e.g. keyboard shortcuts, variation descriptions).
3. **Verify Technical Accuracy:** Ensure the UI text reflects the *actual* implemented behavior in the WGSL shaders and TypeScript engine. If defaults, parameter limits, or features have changed, the UI text must be updated.
4. **Apply Updates:** Use precision edits to bring the UI source files back into sync with the engine.

Follow the rest of the global `doc-refresh` workflow exactly as written once this UI sweep is integrated!
