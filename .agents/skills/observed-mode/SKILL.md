---
name: observed-mode
description: Apply Observed's working conventions when asked for observed-mode or to follow the project's development style. Covers autonomy, browser tools, verification, evidence, and PR handling.
---

# Observed mode

## Establish the slice

Inspect actual files, artifacts, scripts, and Git status before editing. Follow
the current roadmap milestone and load only relevant guidance. Work on one small,
reviewable slice. Preserve unrelated work; do not scaffold later phases to avoid
a missing prerequisite.

## Execute without routine handoffs

Use available tools and documented defaults to handle setup, implementation,
capture, and verification yourself. Do not ask the maintainer to collect evidence
that you can capture. Inspect tool errors and documentation before escalating.
Ask only when a missing decision, access, or authorization genuinely blocks work.

Use normal formatting, clear indentation, one statement per line, and blank lines
between logical blocks. Do not compress implementations. Keep prose concrete and
brief. State the action or result without attributing it to a request or explaining
which source skill inspired it.

Write review-comment replies in lowercase, with short, direct phrasing. Preserve
case in code, identifiers, file paths, commands, and quoted text when it matters.

## Verify the change

Check package.json before choosing commands and run only applicable checks that
exist. Exercise the changed behavior through its real entry point. A successful
command is not proof of the resulting state. Preserve unknown and failed outcomes;
do not invent captures or relax expectations to get a pass.

Keep routine screenshots, logs, traces, recordings, failed attempts, and draft
reports local under gitignored `evidence/`. Retain them for inspection. Commit
project recipes and useful findings; select a sanitized fixture with provenance
only when a test or report contract needs it. Do not commit each development run.

Use agent-browser first for browser work. Read `agent-browser skills get core`
before driving and inspect its installed version. Check the official release when
selecting or updating the producer, then record the exact version used. Prefer
built-in locators, queries, waits, captures, and diagnostics. Use custom evaluation
only for a demonstrated gap. Before using the desktop browser, check whether it
is connected; ask to connect it only if that fallback is actually necessary.

## Carry the slice through its PR

Use [babysit-pr](../babysit-pr/SKILL.md). Open and update implementation PRs during
each phase, review the changes, handle GitHub feedback, and squash-merge through GitHub
after approval and passing checks. Continue without asking again for those routine
actions. Keep approval distinct from self-review and check success.

## Improve the project workflow

Keep project automation and verification procedures in their generated skills.
Use AGENTS.md to index them, not to duplicate their contents. Update an existing
workflow before adding another. Do not generate skills for temporary demos or
fixtures, or turn a one-time workaround into a project rule.

These instructions guide an active agent. They do not install a scheduler or keep
a completed subagent watching GitHub. Report the actual PR and monitoring state.
