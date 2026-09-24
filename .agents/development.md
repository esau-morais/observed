# Contributor verification setup

The product sequence and self-verification stages live in [ROADMAP.md](../docs/ROADMAP.md#observe-observed-during-development). Code and agent responsibilities live in [ARCHITECTURE.md](../docs/ARCHITECTURE.md#code-skills-and-ai). Follow those decisions instead of maintaining a second plan here.

## Project skills

The skills in .agents/skills support contributors. They have no editor-specific commands, transcript paths, or specialist-agent dependencies. The automate-me skill requires an explicit preference-capture request.

.agents/skills is canonical. .claude/skills is a relative directory symlink to ../.agents/skills. CLAUDE.md imports @AGENTS.md for hosts that need it.

Check the symlink after checkout. If the system does not preserve links, report the setup problem and use a documented link-creation step. Do not maintain an edited copy. Check discovery in the intended agent before claiming installation works there.

## Future product setup

When setup becomes repeated work, offer an explicit action for one versioned Observed skill and a project recipe. Show planned files, respect existing files, record skill and CLI versions, and support removal. Do not silently modify user instructions or install this contributor collection.

Generate verify-observed only after the app's actual launch, drive, capture, and cleanup steps work. Record blocked prerequisites instead of inventing commands.

## Local evidence

Keep routine screenshots, browser logs, traces, recordings, failed runs, and draft
reports under the gitignored `evidence/` directory. Retain them for inspection at
handoff. Commit reusable recipes and useful findings. Commit a small report
example or sanitized, attributable fixture only when it supports evaluation or a
regression contract. Shared CI artifacts need a retention policy when CI is added.

The [TodoMVC recipe](recipes/todomvc.md) is the first Phase 0 exercise. Its local
report is `evidence/phase-0/todomvc/report.md`. It checks an external demo, not
Observed. The final two runs passed five named behavior checks each and restored
the empty fixture. Earlier failed attempts remain local. No developer adoption or
verification-time savings have been measured.

Use [verify-todomvc](skills/verify-todomvc/SKILL.md) to repeat that external-demo
journey. It references the executed recipe; it does not verify an Observed app.

Use agent-browser first for browser verification. Read its installed core skill
before driving, check its version, and prefer its built-in commands. Use custom
evaluation only for a demonstrated gap. Check whether the desktop browser is
connected before calling its browser actions; if that fallback is necessary and
disconnected, ask the user to connect it.
