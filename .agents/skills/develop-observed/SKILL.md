---
name: develop-observed
description: Implement a small Observed roadmap slice autonomously, using the project's verification and PR workflows. Captures the maintainer's explicit working preferences from development sessions.
---

# Develop Observed

## Establish the slice

Read AGENTS.md, .agents/development.md, and the current roadmap milestone. Load
only the product, architecture, design, and language guidance needed for the work.
Inspect actual files, artifacts, scripts, and Git status. Preserve unrelated work.
Use an implementation branch and one reviewable slice rather than scaffolding a
later phase. A completed example does not establish completion of a milestone.

## Execute without routine handoffs

Use available tools and documented defaults to handle setup, implementation,
capture, and verification yourself. Do not ask the maintainer to collect evidence
that you can capture. Inspect tool errors and documentation before escalating.
Ask only when a missing decision, access, or authorization genuinely blocks work.

Write normally formatted, readable code. Keep the core independent of browser
tools, frameworks, models, and delivery services. Follow the current stack and
existing schemas. Never invent evidence to unblock a report.

## Verify the change

Use [verify-changes](../verify-changes/SKILL.md). Preserve failures as well as
successful reruns. A successful command is not proof of the resulting behavior;
check the intended state and retain its provenance. Missing evidence stays unknown.

Use agent-browser first for browser work. Read `agent-browser skills get core`
before driving and inspect its installed version. Check the official release when
selecting or updating the producer, then record the exact version used. Prefer
built-in locators, queries, waits, captures, and diagnostics. Use custom evaluation
only for a demonstrated gap. Before using the desktop browser, check whether it
is connected; ask to connect it only if that fallback is actually necessary.

## Carry the slice through its PR

Use [babysit-pr](../babysit-pr/SKILL.md). The maintainer explicitly authorized
opening and updating implementation PRs during each phase, self-review, handling
GitHub feedback, and merging through GitHub after approval and passing checks.
Continue without asking again for those routine actions. Keep approval distinct
from self-review and check success.

## Improve the project workflow

When the maintainer asks to capture session lessons, update these project skills
with automate-me. Use create-verification-skill to maintain actual project
verification as executable entry points become available. Do not generate skills
for temporary demos or fixtures. Keep generator skills available for later changes.
Do not turn a one-time workaround into a project rule.

These instructions guide an active agent. They do not install a scheduler or keep
a completed subagent watching GitHub. Report the actual PR and monitoring state.
