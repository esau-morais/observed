# Contributor verification setup

The product sequence and self-verification stages live in [ROADMAP.md](../docs/ROADMAP.md#observe-observed-during-development). Code and agent responsibilities live in [ARCHITECTURE.md](../docs/ARCHITECTURE.md#code-skills-and-ai). Follow those decisions instead of maintaining a second plan here.

## Project skills

The skills in .agents/skills support contributors. They have no editor-specific commands, transcript paths, or specialist-agent dependencies. The automate-me skill requires an explicit preference-capture request.

Generated project workflows: [Observed mode](skills/observed-mode/SKILL.md) and
[PR maintenance](skills/babysit-pr/SKILL.md).

.agents/skills is canonical. .claude/skills is a relative directory symlink to ../.agents/skills. CLAUDE.md imports @AGENTS.md for hosts that need it.

Check the symlink after checkout. If the system does not preserve links, report the setup problem and use a documented link-creation step. Do not maintain an edited copy. Check discovery in the intended agent before claiming installation works there.

## Future product setup

When setup becomes repeated work, offer an explicit action for one versioned Observed skill and a project recipe. Show planned files, respect existing files, record skill and CLI versions, and support removal. Do not silently modify user instructions or install this contributor collection.

Generate verify-observed only after the app's actual launch, drive, capture, and cleanup steps work. Record blocked prerequisites instead of inventing commands.

Current prerequisite gap: no package.json, application entry point, or Observed
runtime journey exists. Repository checks and external-demo captures do not
satisfy that execution requirement.
