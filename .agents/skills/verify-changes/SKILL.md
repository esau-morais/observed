---
name: verify-changes
description: Verify Observed repository changes with checks that actually exist, inspect evidence and skill links, and retain local results. Use before committing or updating an implementation PR. Runtime application verification remains unavailable until Observed runs.
---

# Verify an Observed change

## Discover the available checks

Inspect the changed files and package.json before choosing commands. At generation,
Observed has documentation and skills but no package.json or runnable application.
The repository checks below were executed; no application launch, UI journey,
typecheck, lint, test, or build is claimed.

When application scripts exist, run the applicable declared commands from AGENTS.md
through Bun. Do not use `bun test`, invent scripts, install an unrelated test
framework, or treat an unavailable check as passing. Use the runtime verification
recipe only after its launch, drive, capture, and cleanup steps have worked.

## Documentation and workflow changes

From the repository root:

```bash
git status --short --branch
git diff --check
git diff --cached --check
test -L .claude/skills
test "$(realpath .claude/skills)" = "$(realpath .agents/skills)"
git check-ignore evidence/verification-probe.log
git ls-files evidence
```

The last command should list no routine capture files. Review new files too:
unstaged untracked files are not covered by `git diff --check`. Inspect local
Markdown link targets and heading anchors in touched documents. Check that skill
metadata describes its real scope, instructions agree, and commands use actual
scripts and supported tool features.

For a changed runnable recipe, check its shell syntax where applicable, then run
the real workflow. Retain setup/version failures, command output, resulting-state
evidence, and cleanup results. Do not mark a recipe ready from syntax checks alone.

## Application changes, once runnable

Verify the named behavior through the actual entry point and a second read of its
resulting state. A URL change or accepted click is not render completion. Use
condition waits for the state being checked; an empty element may have no visible
box. Use owned sessions and disposable fixtures, and close only owned resources.

Generate verify-observed after its real application workflow has executed, as
required by AGENTS.md. This repository-check skill is not a substitute for it.

## Evidence and report checks

Keep routine screenshots, logs, traces, recordings, failed attempts, and assembled
development reports local under gitignored `evidence/`. Retain them for inspection.
Commit project recipes and useful findings. Select and sanitize an attributable
fixture or small report example only when it supports a regression contract or
report evaluation. Shared CI artifact retention is future work until configured.

Before reporting results, compare claims with raw output. Check artifact links,
identity, producer versions, conditions, and hashes when recorded. Preserve unknown
or failed captures separately from failed application checks. Keep earlier runs
immutable when rerunning; verify cleanup and that the evidence remains accessible.

## Handoff

Report checks actually run, their outcomes, remaining unknowns, and local evidence
paths. Do not present local files as GitHub attachments. Use
[babysit-pr](../babysit-pr/SKILL.md) to inspect current GitHub checks and feedback.
Self-review and a passing report do not replace independent runtime expectations.
