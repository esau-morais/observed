---
name: observed-mode
description: Apply Observed's working conventions for scoped implementation, autonomous execution, browser verification, and PR completion.
---

# Observed mode

## Establish the slice

Inspect actual files, artifacts, scripts, and Git state. Follow
[babysit-pr](../babysit-pr/SKILL.md) from the start of implementation through
review, feedback, and authorized merge. Use the task's acceptance criteria;
consult the roadmap when choosing work, not to expand an assigned slice.

Handle setup, implementation, and verification with available tools. Ask only
when a missing decision, access, or authorization blocks progress. When a choice
changes, reconcile dependent scripts, configuration, dependencies, and usage
before continuing. Do not carry forward assumptions from the previous setup.

When asked whether there is a better approach, inspect built-in APIs and the
installed library's documentation first. Compare behavior and tradeoffs; a
cosmetic rewrite does not answer that question. Verify boundary behavior with
a small execution rather than trusting an API name.

## Verify real behavior

Use [verify-observed](../verify-observed/SKILL.md). Keep run-specific evidence and
findings local; project skills describe reusable procedures.

For browser work, use agent-browser first. Read `agent-browser skills get core`
and inspect the installed version. Check the official release when selecting or
updating the producer, then record the exact version used. Prefer built-in
locators, waits, captures, and diagnostics; use custom evaluation only for a
demonstrated gap. Check desktop-browser connectivity before using that fallback.

Update existing workflows rather than adding parallel instructions. AGENTS.md
owns repository decisions, package scripts own checks, and the PR workflow owns
review and merge handling.
