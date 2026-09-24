---
name: verify-todomvc
description: Repeat Observed's executed Phase 0 TodoMVC browser journey, retain real local artifacts, and report scoped checks and unavailable revision comparisons. Use for this external demo only, not for verification of an Observed application.
---

# Verify the Phase 0 TodoMVC journey

Read [the canonical recipe](../../recipes/todomvc.md) and the installed
agent-browser core skill before driving. The recipe owns the commands,
expectations, conditions, and cleanup. Do not duplicate them here.

## Prerequisites and run identity

- Confirm `agent-browser --version` matches the recipe's pinned producer version.
  Use Bun if installation is necessary. A producer update needs a new recorded run.
- Use the recipe's public demo URL, readiness check, empty fixture check, viewport,
  and disposable title. No local app server, credentials, or auth state is needed.
- Choose a new gitignored `evidence/` directory and session prefix. Preserve earlier
  artifacts. Use `session id --scope worktree` as shown in the recipe.
- Keep the deployed source revision unknown unless attributable evidence supplies
  it. Repeating the same URL does not establish a base/candidate comparison.

## Execute and inspect

Execute the recipe from the repository root. It covers launch, add, complete,
reload persistence, Active and Completed filters, capture, and cleanup. Two
isolated runs of version 4 completed with agent-browser 0.38.1 during the initial
Phase 0 exercise.

Use built-in locators, queries, and condition waits. A changed URL alone is not
render completion. An empty element may have no visible box; use the documented
zero-row condition instead of waiting for that empty element to be visible.

Inspect the command results and screenshots before assembling the report. Keep
execution, check outcomes, and revision comparison separate. Preserve failures
and mark unexecuted steps unknown. Do not change expectations to hide a failure.

## Cleanup and handoff

The recipe clears its fixture and closes only its owned session through an EXIT
trap. If the run stops early, report which cleanup actions were not executed.
Confirm the files remain and owned sessions are closed.

Keep raw output and the assembled report local and gitignored. Report the five
named behavior checks, cleanup result, producer and browser conditions, artifact
paths, and unavailable comparisons. These captures do not establish pilot
adoption, performance, accessibility conformance, or complete application coverage.
