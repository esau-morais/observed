# Sources and adaptation decisions

Reviewed on 23 September 2026. These project skills use original, shortened wording informed by the linked workflows. They are adapted instructions, not an unmodified pstack installation.

## Decisions

| Topic | Project decision |
| --- | --- |
| Package manager and runtime | Bun manages dependencies and executes the TypeScript application, TypeScript compiler, ESLint, Prettier, and Vitest. package.json owns the version declaration. Vitest execution under Bun was checked with the suite and a temporary worker-runtime probe |
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

## Phase 0 enforcement

Rules were selected from official documentation for the schema, filesystem, and
report CLI implemented in this phase. `eslint.config.ts` is the executable policy.

- [Recommended type-checked rules](https://typescript-eslint.io/users/configs#recommended-type-checked)
  catch unsafe `any` flows and misused promises. Add
  [unsafe assertion checks](https://typescript-eslint.io/rules/no-unsafe-type-assertion)
  and [non-null assertion checks](https://typescript-eslint.io/rules/no-non-null-assertion)
  so generated code cannot bypass boundary validation with a cast or `!`.
- [Floating promises](https://typescript-eslint.io/rules/no-floating-promises)
  reject `void` as an escape hatch and check thenables.
  [Unknown rejection values](https://typescript-eslint.io/rules/use-unknown-in-catch-callback-variable)
  keep Promise error handling from introducing `any`.
- [Exhaustive switches](https://typescript-eslint.io/rules/switch-exhaustiveness-check)
  protect outcome variants. [Explicit boolean conditions](https://typescript-eslint.io/rules/strict-boolean-expressions)
  prevent absent values and zero measurements from being conflated.
- [TypeScript directive checks](https://typescript-eslint.io/rules/ban-ts-comment)
  forbid `ts-ignore` and `ts-nocheck`; `ts-expect-error` needs a description.
  Unused ESLint suppressions and inline configurations are errors.
- [Braces](https://eslint.org/docs/latest/rules/curly),
  [strict equality](https://eslint.org/docs/latest/rules/eqeqeq),
  [no nested ternaries](https://eslint.org/docs/latest/rules/no-nested-ternary), and
  [no eval](https://eslint.org/docs/latest/rules/no-eval) keep control flow explicit.
  Prettier enforces layout and one statement per line. The core
  `max-statements-per-line` rule is deprecated, so it is not enabled.

These checks do not establish report truth or detect every unused Effect value.
Contract tests and execution against independent expectations remain required.
React Hooks and StyleX rules belong to the later viewer setup.

Effect references: [v4 onboarding](https://effect.website/docs/v4/onboarding),
[installation](https://effect.website/docs/v4/getting-started/installation),
[Command](https://effect.website/docs/v4/api/effect/unstable/cli/Command), and
[Bun platform](https://effect.website/docs/v4/api/platform-bun). Implementation APIs
were checked against installed `4.0.0-rc.117` sources and their `ai-docs` examples.
The release-candidate version and lockfile are pinned. The
[Bun runtime documentation](https://bun.com/docs/runtime#bun) explains why invoking
a script with Bun does not by itself change that script's runtime.

## Retrieved source hashes

- `typescript-best-practices/SKILL.md`: `28f9e61710e205f6f3c5476f333483cff0e988f6a5b639e2faad536344b40c5e`
- `typescript-best-practices/references/patterns.md`: `62e9cd32d2fa066a35d0d1349aac22dce31a48ad7d5eaf142570770cfe707384`
- `no-comments/SKILL.md`: `5c5b0882297d704c3a9720c52b7a793c68b013eaf717989f0945624efdfe2b05`
- `tdd/SKILL.md`: `eeb868e2dfebee528d730a67d7b17498fac4bb85dec2e38bc5c5176aca4d5d2f`
- `unslop/SKILL.md`: `195411d320b5b328f9f642baf59757ed19aaf0931c0838740e0aca273d538dc1`
