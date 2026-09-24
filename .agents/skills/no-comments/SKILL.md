---
name: no-comments
description: Review comments in the current diff and touched code. Remove redundant narration and obsolete statements while preserving necessary constraints and provenance.
---

# Comment review

Review the requested scope. Read surrounding code before deleting comments.

- Remove narration of clear operations, obsolete descriptions, and decorative headings.
- Prefer clearer names or small refactors when they resolve the explanation within scope.
- Keep evidence invariants, external API quirks, ordering constraints, and measured tradeoffs when code cannot convey the reason.
- Preserve licenses, copyright notices, generated-file markers, and necessary tool directives.
- Inspect suppressions and fix their causes where practical. Necessary exceptions need narrow scope and an explanation. Deleting the explanation does not fix the issue.
- Enforce important contracts with a type, runtime check, or test when the task warrants it. Keep context that enforcement cannot express.

Do not purge comments across the repository or invoke unavailable specialist agents. Report unresolved constraints instead of deleting them to make code look cleaner.
