---
name: create-verification-skill
description: Create or update a project verification skill from a runnable application and demonstrated user journeys. Use when repeatable browser, CLI, or service verification is missing or has drifted.
---

# Create a verification recipe

## Inspect the application

Read scripts, startup docs, checks, routes, and commands. Identify user actions, launch commands, readiness conditions, and an available driving tool.

Prefer a working existing journey. For initial Observed capture, use the installed agent-browser version and documented commands. Do not guess selectors or flags.

Record environment variable names, the test-credential mechanism, fixtures, ports, process ownership, and cleanup. Determine whether base and candidate can run independently. If they share state, serialize execution and reset it explicitly.

If the app does not exist or cannot start, record the blocker. Do not create a fabricated verify-observed skill. Fix startup only within the task's scope.

## Write a useful skill

Create .agents/skills/verify-<app>/SKILL.md with a name and task-specific description. Include:

- Exact launch commands and readiness for the expected revision.
- A read-only health check of the run's process, build, authentication, and fixtures.
- Tested user actions with stable selectors and observable expectations.
- Evidence locations, run identity, tool versions, and checked contracts.
- Cleanup for owned resources, with evidence retained.

Use [recipe-fields.md](references/recipe-fields.md). Start with one working journey. Add others when changes or repeated use justify them. The map indexes recipes; it does not require a test for each feature.

Exercise the real entry point. A successful click or request does not prove the expected result. Check resulting state and relevant persisted effects through a second read.

## Execute before calling it ready

Run the written launch, health check, journey, capture, and cleanup. Confirm artifacts survive. Mark additional unexecuted journeys as unverified.

On failure, retain commands and output, clean up owned resources, and distinguish setup failure from application failure. Do not retry indefinitely or erase the failed run.

Update recipes as routes, commands, fixtures, and expectations change. Changed expectations must reflect intentional product contract changes. Never update a recipe to hide a regression.

When Observed can import artifacts, compare its report with the original check. Keep the direct tool path for validating Observed itself.
