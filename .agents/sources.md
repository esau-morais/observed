# Sources and adaptation decisions

Reviewed on 23 September 2026. These project skills use original, shortened wording informed by the linked workflows. They are adapted instructions, not an unmodified pstack installation.

## Decisions

| Topic | Project decision |
| --- | --- |
| Package manager | Bun only, as requested. Node executes tooling and application code |
| Viewer | React, Vite, and StyleX. Vite and StyleX follow the user's selections; React follows the report plan |
| Test runner | Vitest, chosen for the Vite project. Use bun run test so Bun does not select its own runner |
| Instruction size | Root policy contains stack, commands, evidence invariants, test selection, and boundaries. Load detailed skills only for relevant tasks |
| Skill location | Canonical .agents/skills with a relative .claude/skills link and a CLAUDE.md import |
| Verification | Execute a recipe before marking it ready. No runnable app exists yet, so verify-observed is not generated |
| Comments | Remove redundant prose; preserve invariants, external constraints, licenses, and justified directives |
| Type examples | Correct the upstream examples that imply a plain number is non-negative or a non-empty array guarantees an arbitrary index |
| Provider tests | Test our contracts and failure handling. Sanitized fixtures need provenance and do not prove current provider compatibility |
| Distribution | Contributor skills remain project files. Product operation does not require them. Offer one optional product skill through explicit setup when needed |

AGENTS.md uses the unslop editing approach. The generator's feature-map structure informs the recipe record, but the project does not copy its application-specific commands or require exhaustive feature coverage.

## Source workflows

The upstream revision observed during research was `12d587dfb20741cafc376c42c696c5f6e2a64487`. Source files retrieved from the supplied main-branch links are listed with their SHA-256 values below.

- [TypeScript practices](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/typescript-best-practices/SKILL.md).
- [TypeScript examples](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/typescript-best-practices/references/patterns.md).
- [Verification generator](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/create-verification-skill/SKILL.md).
- [Preference capture](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/automate-me/SKILL.md).
- [Comment review](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/no-comments/SKILL.md).
- [Focused TDD](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/tdd/SKILL.md).
- [Unslop](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/unslop/SKILL.md).
- [Feature-map examples](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/create-verification-skill/references/feature-map-example).

## PR workflow

The maintainer supplied [babysitting-pr](https://raw.githubusercontent.com/spencerpauly/awesome-cursor-skills/refs/heads/main/resources/babysitting-pr/SKILL.md)
as a model for project automation. `.agents/skills/babysit-pr` adapts its
inspect/fix/push/re-check loop and three-cycle bound for Observed. It uses declared
Bun scripts, explicit-path commits, preserved expectations, current-head approval,
and GitHub merge checks. It also distinguishes active-task monitoring from a
persistent event service. No upstream scheduler or CI integration was installed.

## Official technical references

- [AGENTS.md format](https://agents.md/). Project-specific instructions, relevant commands, and scoped files.
- [Agent Skills specification](https://agentskills.io/specification). Portable skill structure and progressive loading.
- [Bun installation and lockfiles](https://bun.sh/docs/pm/cli/install). Dependency installation and frozen-lockfile behavior.
- [Node.js releases](https://nodejs.org/en/about/previous-releases). Choose a supported LTS release at implementation time.
- [Vite TypeScript behavior](https://vite.dev/guide/features#typescript). Transpilation does not perform typechecking.
- [StyleX with Vite and React](https://stylexjs.com/docs/learn/installation/vite/vite-react/). Compiler integration, plugin order, and CSS entrypoint.
- [Vitest setup](https://vitest.dev/guide/). Node requirements and bun run test instead of bun test.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html).
- [Unchecked indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html).
- [Claude project instructions](https://code.claude.com/docs/en/memory). Shared AGENTS.md imports.
- [Claude project skills](https://code.claude.com/docs/en/skills). Project discovery under .claude/skills.

The selected agent host still needs a discovery check. A resolving filesystem link does not prove the host loaded each skill.

## Retrieved source hashes

- `typescript-best-practices/SKILL.md`: `28f9e61710e205f6f3c5476f333483cff0e988f6a5b639e2faad536344b40c5e`
- `typescript-best-practices/references/patterns.md`: `62e9cd32d2fa066a35d0d1349aac22dce31a48ad7d5eaf142570770cfe707384`
- `create-verification-skill/SKILL.md`: `644f2551403c1bca01a2855b34611b6e7be0ce0dc5b204514c376c0f6a6e6ac4`
- `automate-me/SKILL.md`: `1510979b0b71b54284427a19c09918f8b1fdfc168f9b7f9e30098793a5ec88ef`
- `no-comments/SKILL.md`: `5c5b0882297d704c3a9720c52b7a793c68b013eaf717989f0945624efdfe2b05`
- `tdd/SKILL.md`: `eeb868e2dfebee528d730a67d7b17498fac4bb85dec2e38bc5c5176aca4d5d2f`
- `unslop/SKILL.md`: `195411d320b5b328f9f642baf59757ed19aaf0931c0838740e0aca273d538dc1`
