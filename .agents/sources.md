# Sources and adaptation decisions

Reviewed on 23 September 2026. These project skills use original, shortened wording informed by the linked workflows. They are adapted instructions, not an unmodified pstack installation.

## Decisions

| Topic | Project decision |
| --- | --- |
| Package manager and runtime | Bun installs dependencies and runs the application and tools. Versions are declared in package.json |
| Effect | Effect v4 is required for schemas, typed failures, resources, and workflows. Effect Command uses `@effect/platform-bun` at the CLI boundary |
| Viewer | React, Vite, and StyleX. Vite and StyleX follow the user's selections; React follows the report plan |
| Test runner | Vitest, chosen for the Vite project. Use bun run test so Bun does not select its own runner |
| Instruction size | Root policy contains stack, commands, evidence invariants, test selection, and boundaries. Load detailed skills only for relevant tasks |
| Skill location | Canonical .agents/skills with a relative .claude/skills link and a CLAUDE.md import |
| Verification | Execute a recipe before marking it ready. verify-observed covers the report CLI and inspection against retained artifacts; application capture and revision comparison remain unavailable |
| Comments | Remove redundant prose; preserve invariants, external constraints, licenses, and justified directives |
| Type examples | Correct the upstream examples that imply a plain number is non-negative or a non-empty array guarantees an arbitrary index |
| Provider tests | Test our contracts and failure handling. Sanitized fixtures need provenance and do not prove current provider compatibility |
| Distribution | Contributor skills remain project files. Product operation does not require them. Offer one optional product skill through explicit setup when needed |

AGENTS.md uses the unslop editing approach. Project verification uses executed commands and scoped checks rather than exhaustive feature coverage.

## Source workflows

The upstream revision observed during research was `12d587dfb20741cafc376c42c696c5f6e2a64487`. Source files retrieved from the supplied main-branch links are listed with their SHA-256 values below.

- [TypeScript practices](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/typescript-best-practices/SKILL.md).
- [TypeScript examples](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/typescript-best-practices/references/patterns.md).
- [Comment review](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/no-comments/SKILL.md).
- [Focused TDD](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/tdd/SKILL.md).
- [Unslop](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/unslop/SKILL.md).

## Official technical references

- [AGENTS.md format](https://agents.md/). Project-specific instructions, relevant commands, and scoped files.
- [Agent Skills specification](https://agentskills.io/specification). Portable skill structure and progressive loading.
- [Bun installation and lockfiles](https://bun.sh/docs/pm/cli/install). Dependency installation and frozen-lockfile behavior.
- [Vite TypeScript behavior](https://vite.dev/guide/features#typescript). Transpilation does not perform typechecking.
- [StyleX with Vite and React](https://stylexjs.com/docs/learn/installation/vite/vite-react/). Compiler integration, plugin order, and CSS entrypoint.
- [Vitest setup](https://vitest.dev/guide/). Test framework setup; use bun run test instead of Bun's own test runner.
- [TypeScript strict mode](https://www.typescriptlang.org/tsconfig/strict.html).
- [Unchecked indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html).
- [Claude project instructions](https://code.claude.com/docs/en/memory). Shared AGENTS.md imports.
- [Claude project skills](https://code.claude.com/docs/en/skills). Project discovery under .claude/skills.

The selected agent host still needs a discovery check. A resolving filesystem link does not prove the host loaded each skill.

## Runtime and lint references

- Effect v4: [onboarding](https://effect.website/docs/v4/onboarding), [Command](https://effect.website/docs/v4/api/effect/unstable/cli/Command), [Bun platform](https://effect.website/docs/v4/api/platform-bun).
- [Bun runtime selection](https://bun.com/docs/runtime#bun): `--bun` overrides Node shebangs in local tools.
- [Type-checked ESLint presets](https://typescript-eslint.io/users/configs#recommended-type-checked), [unsafe assertions](https://typescript-eslint.io/rules/no-unsafe-type-assertion), and [non-null assertions](https://typescript-eslint.io/rules/no-non-null-assertion): prevent unchecked type escapes.
- [Floating promises](https://typescript-eslint.io/rules/no-floating-promises), [unknown rejections](https://typescript-eslint.io/rules/use-unknown-in-catch-callback-variable), and [exhaustive switches](https://typescript-eslint.io/rules/switch-exhaustiveness-check): enforce handled async work and outcomes.
- [Boolean conditions](https://typescript-eslint.io/rules/strict-boolean-expressions) and [TypeScript directives](https://typescript-eslint.io/rules/ban-ts-comment): require explicit conditions and justified exceptions.
- [ESLint rules](https://eslint.org/docs/latest/rules/): control-flow rules live in `eslint.config.ts`; Prettier handles formatting.

## Retrieved source hashes

- `typescript-best-practices/SKILL.md`: `28f9e61710e205f6f3c5476f333483cff0e988f6a5b639e2faad536344b40c5e`
- `typescript-best-practices/references/patterns.md`: `62e9cd32d2fa066a35d0d1349aac22dce31a48ad7d5eaf142570770cfe707384`
- `no-comments/SKILL.md`: `5c5b0882297d704c3a9720c52b7a793c68b013eaf717989f0945624efdfe2b05`
- `tdd/SKILL.md`: `eeb868e2dfebee528d730a67d7b17498fac4bb85dec2e38bc5c5176aca4d5d2f`
- `unslop/SKILL.md`: `195411d320b5b328f9f642baf59757ed19aaf0931c0838740e0aca273d538dc1`
