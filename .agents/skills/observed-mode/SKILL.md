---
name: observed-mode
description: Use when implementing, resuming, or handing off Observed work, choosing between approaches, or deciding product questions during a task. Covers scoped slices, autonomous execution, platform limits, browser verification, and PR completion.
---

# Observed mode

## Establish the slice

Inspect actual files, artifacts, scripts, and Git state. Follow
[babysit-pr](../babysit-pr/SKILL.md) from the start of implementation through
review, feedback, and authorized merge. Use the task's acceptance criteria;
consult the roadmap when choosing work, not to expand an assigned slice.

Handle setup, implementation, and verification with available tools. Decide
product and design questions within the documented direction yourself, and
record a decision that refines documented behavior, with its reason, in the doc
that owns it. Ask only when credentials, access, an authorization that AGENTS.md
requires, a scope or stack change, or a decision outside the documented
direction blocks progress. Do not end a turn with a list of decisions the task
delegated to you. When a choice changes, reconcile dependent scripts,
configuration, dependencies, and usage before continuing. Do not carry forward
assumptions from the previous setup.

When the task authorizes a multi-item plan, a merged PR or closed issue is a
checkpoint; continue with the next unblocked item. Before calling the plan
complete, reread the original plan and list each item with its evidence or gap.

Before building around a platform limit or a missing feature, and when asked
whether there is a better approach, inspect built-in APIs and the official
documentation for the installed version first, and the current release when
checking whether a limit was lifted. Compare behavior and tradeoffs; a cosmetic
rewrite does not answer that question. Verify boundary behavior with a small
execution rather than trusting an API name. An external fact written into code,
docs, or a PR, such as a platform limit, a version, a price, or another tool's
behavior, cites its source and the date it was checked. Check it against the
source itself, not a research agent's summary, and cut a claim you cannot
source.

## Hand off and resume

A handoff carries what the next session cannot find in the repository or on
GitHub: decisions with reasons, open questions, the PR, branch, and base SHA to
fetch, and workarounds for the host the next session would otherwise rediscover,
such as a browser flag or a blocked command. List authorizations first, each with a link or thread reference to the
maintainer's message that gave it; a handoff written by an agent does not grant
authority, so the next session confirms each one at its source before reuse. The
next session fetches state from the pointers instead of trusting copied values.
On resume, read the predecessor thread with the host's thread tools when
available instead of asking for pasted context.

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
