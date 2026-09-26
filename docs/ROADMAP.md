# Observed roadmap

## Implementation priority

Phase 1 is complete: one command previews or compares a running change, and two
separate applications, including a non-React one, use the same capture path
without core edits. Named checks decide the result while pixel changes stay
observations, and missing requested captures show as unavailable.

The next implementation milestone is Phase 2: repeatable use. Keep the adoption
study separate: working code does not establish that people find it useful.

Read only the document relevant to the task:

| Task | Document |
| --- | --- |
| Decide scope, evidence views, or user-facing result meaning | [PRODUCT.md](PRODUCT.md) |
| Change schemas, capture, comparisons, integrations, or repair | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Choose work and establish its exit conditions | This file |
| Implement or verify code | [AGENTS.md](../AGENTS.md) and its relevant skill |
| Change visual design | [DESIGN.md](../DESIGN.md) |

## Milestones

Advance when the exit condition holds.

| Phase | Deliverable and exit condition |
| --- | --- |
| 0. Validate | Reports from existing artifacts. Developers use the combined view and repeated verification pain is observed |
| 1. See a real project | One command opens a captured page or a version comparison. Two separate applications, including non-React, use the same runner without core edits. Optional checks distinguish failed expectations from visual changes; missing requested captures stay visible |
| 2. Repeatable use | Executed recipes, isolated runs, one existing hook or CI trigger, export. Fresh-checkout runs need no recurring setup help; stale or failed captures never pass |
| 3. One extension | Choose Slack delivery, an existing-test importer, deeper performance, or an API operation from pilot demand. It saves work and preserves the report contract |
| 4. Bounded repair | Agent handoff, isolated patches, protected checks, budgets, independent reruns. Repair stops correctly and improves on manual handoff |
| Later | Database, jobs, traces, additional frameworks, and optional proof adapters, each tied to a recurring workflow |

## First implementation sequence

Do not create code merely to satisfy every row at once. Each item should support a reviewable change.

1. Define the project configuration and immutable evidence contract. Agents can prepare configuration; Observed generates capture manifests.
2. Run project-supplied startup commands and browser actions from isolated, identified source. Pin the recipe and expectations before either capture.
3. Open the captured application first, with a comparison when requested. Keep source details and requests available on demand.
4. Evaluate optional expectations independently of application routes or framework. Preserve unknown results for missing, stale, corrupted, and failed evidence.
5. Exercise the same public workflow on two separate projects with different startup commands, actions, endpoints, and expected results. Include a non-React app. Neither application may require a core branch or fixture import.
6. Retain focused integration tests for seeded regressions, intentional changes, missing baselines, timeout/cancellation, and evidence faults. Use the existing test runner; do not build an application-specific verification product.
7. Repeat from a fresh checkout and inspect a relocated bundle. Cleanup retains immutable evidence and stops owned resources.
8. Add one existing trigger and export destination after the project workflow works. Validate another agent environment. Add an API-only operation when backend expansion begins.

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
- Lean and Bend: after Phase 1, use the same small retry/cancellation invariant and correct and faulty examples. Pin tools; compare setup, specification effort, proof maintenance, and clean/incremental checking. Inspect incomplete proofs, assumptions, and escape mechanisms. Default to Lean for a production proof adapter unless evidence favors Bend for a specific case.
- Existing TypeScript invariants: try property-based testing before translating code into another language. For state-machine exploration, evaluate TLA+/TLC with explicit model bounds. A model result still needs a justified connection to implementation.

Revisit Slack versus backend priority, a persistent runner, and native React instrumentation only when pilot evidence identifies a repeated need.

References for experiments: [Jev](https://docs.typesafe.ai/introduction), [Lean](https://lean-lang.org/), [Bend](https://bend-lang.com/), [fast-check](https://fast-check.dev/), [TLA+](https://lamport.azurewebsites.net/tla/tla.html). Recheck current documentation before selecting versions or claiming support.

## Keep the plan small

PRODUCT.md owns scope; ARCHITECTURE.md owns contracts and boundaries; this file owns sequence, status, and open decisions. Update the owner and link to it rather than copying policy. Keep the three-file limit; add sections only when they change implementation or acceptance.

This structure applies [Anthropic's context guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and [progressive disclosure](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). [GitHub's agent-file guidance](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) informs concrete commands and boundaries in AGENTS.md. Three files is a project choice, not a proven universal optimum.
