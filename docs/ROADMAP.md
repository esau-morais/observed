# Observed roadmap

## Current state and next action

Specifications and visual concepts exist. Phase 0 now has an executed
[TodoMVC verification recipe](../.agents/recipes/todomvc.md) and a local report
assembled from real captures. No runnable Observed application, developer pilot,
or production integration has been verified. Stack and workflow decisions are in
[AGENTS.md](../AGENTS.md).

Continue Phase 0: evaluate whether the combined report helps a developer inspect
a real change and observe their repeated verification work. The contributor-run
demo established a capture path, not the milestone's adoption exit condition.
Do not build the full adapter list before checking whether people use the report.

Read only the document relevant to the task:

| Task | Document |
| --- | --- |
| Decide scope, evidence views, or user-facing result meaning | [PRODUCT.md](PRODUCT.md) |
| Change schemas, capture, comparisons, integrations, or repair | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Choose work and establish its exit conditions | This file |
| Implement or verify code | [AGENTS.md](../AGENTS.md) and its relevant skill |
| Change visual design | [DESIGN.md](../DESIGN.md) |

## Milestones

Estimates assume one experienced builder and pilot access. They are planning ranges, not commitments. Advance when the exit condition holds.

| Phase | Effort | Deliverable and exit condition |
| --- | --- | --- |
| 0. Validate | About 1 week | Reports from existing artifacts. Developers use the combined view and repeated verification pain is observed |
| 1. First report | About 2 weeks | One capture adapter, bundle, local viewer, explicit checks. A seeded runtime regression, intentional change, and missing baseline produce truthful results |
| 2. Repeatable use | About 2 weeks | Executed recipes, isolated runs, one existing hook or CI trigger, export. Fresh-checkout runs need no recurring setup help; stale or failed captures never pass |
| 3. One extension | About 1 to 2 weeks | Choose Slack delivery, an existing-test importer, deeper performance, or an API operation from pilot demand. It saves work and preserves the report contract |
| 4. Bounded repair | About 2 weeks after reliable checks | Agent handoff, isolated patches, protected checks, budgets, independent reruns. Repair stops correctly and improves on manual handoff |
| Later | Demand-led | Database, jobs, traces, additional frameworks, and optional proof adapters, each tied to a recurring workflow |

## First implementation sequence

Do not create code merely to satisfy every row at once. Each item should support a reviewable change.

1. Define the bundle using attributable fixtures, including an unavailable check. Preserve identity through export.
2. Render the report from fixtures. A reader can find the changed behavior and distinguish observations from suggestions.
3. Add agent-browser capture for one real journey. Pin its version and expose unsupported evidence.
4. Compare a base and candidate under recorded conditions. A duplicate-request regression fails; an intentional visual change does not become a regression automatically.
5. Handle missing auth, collector crashes, fixture mismatch, stale revisions, and interrupted runs without false passes.
6. Execute and save a recipe that works after a fresh checkout. Cleanup retains evidence.
7. Add one existing trigger and export destination. Retries update one revision-bound result without duplicate jobs or comments.
8. Validate another agent environment and a non-React browser app without changing core evidence types. Add an API-only operation when backend expansion begins.

## Pilot and continuation gates

Recruit six to eight developers across at least five repositories and two agent environments. Include frequent and occasional agent users. Observe actual tasks, startup work, interruptions, trusted evidence, and incorrect agent claims. Compare with each user's best existing setup.

For roughly 30 suitable changes, alternate workflow order where practical. Separate onboarding, active human checking, unattended execution, and maintenance. Independently inspect failures and sampled passes. Include seeded regressions with known outcomes.

These are proposed pilot targets, not measured results or statistical guarantees:

| Gate | Target or observation |
| --- | --- |
| Setup | First useful report within 10 minutes on a documented compatible project. Record excluded installation and credential time separately |
| Repeated effort | At least 30% lower median active verification time, reporting paired results and variation |
| Comprehension | Most participants identify the change, check scope, and next action within one minute without explanation |
| Result integrity | No false pass caused by missing evidence, stale revision, blocked checks, or collector failure in the pilot |
| Detection | Report precision and seeded-regression detection by category. Explain misses and track escaped regressions |
| Continued use | At least three users keep the trigger enabled for two weeks and maintain recipes without recurring author intervention |
| Cost | Saved effort exceeds setup and maintenance. Track browser time, model cost, and storage |

If existing skills and reports solve the problem, publish the smaller solution. If users value one evidence type, narrow scope before adding domains.

## Observe Observed during development

Before Observed runs, use existing tools and retain raw artifacts. Generate verify-observed only after executing its launch, drive, capture, and cleanup steps.

When import works, compare displayed results with independent expected outcomes. As capture becomes reliable, use it on Observed's own changes. Keep direct checks for the collector, comparator, and status rendering; their own green report is insufficient evidence of correctness.

Follow the focused test policy in AGENTS.md. Avoid feature-existence checks, provider simulations that merely repeat assumptions, and broad UI snapshots. Preserve meaningful contracts and a few consequential browser journeys.

## Optional experiments

- Jev: after real routing cases accumulate, compare it with rules and the existing model on roughly 150 to 300 labeled cases, split by repository or later time. Measure missed required checks, abstentions, latency, and total cost. Include stale and adversarial inputs. Keep it optional and retain it only with a demonstrated advantage. This is screening, not rare-event safety evidence.
- Lean and Bend: after Phase 1, allow two or three days outside the critical path. Use the same small retry/cancellation invariant and correct and faulty examples. Pin tools; compare setup, specification effort, proof maintenance, and clean/incremental checking. Inspect incomplete proofs, assumptions, and escape mechanisms. Default to Lean for a production proof adapter unless evidence favors Bend for a specific case.
- Existing TypeScript invariants: try property-based testing before translating code into another language. For state-machine exploration, evaluate TLA+/TLC with explicit model bounds. A model result still needs a justified connection to implementation.

Revisit Slack versus backend priority, a persistent runner, and native React instrumentation only when pilot evidence identifies a repeated need.

References for experiments: [Jev](https://docs.typesafe.ai/introduction), [Lean](https://lean-lang.org/), [Bend](https://bend-lang.com/), [fast-check](https://fast-check.dev/), [TLA+](https://lamport.azurewebsites.net/tla/tla.html). Recheck current documentation before selecting versions or claiming support.

## Keep the plan small

PRODUCT.md owns scope; ARCHITECTURE.md owns contracts and boundaries; this file owns sequence, status, and open decisions. Update the owner and link to it rather than copying policy. Keep the three-file limit; add sections only when they change implementation or acceptance.

This structure applies [Anthropic's context guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and [progressive disclosure](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). [GitHub's agent-file guidance](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) informs concrete commands and boundaries in AGENTS.md. Three files is a project choice, not a proven universal optimum.
