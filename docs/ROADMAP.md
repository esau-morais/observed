# Observed roadmap

[PRODUCT.md](PRODUCT.md) owns scope, [ARCHITECTURE.md](ARCHITECTURE.md) owns
contracts, and this file owns sequence, status and decisions.

## Status

| Phase | Deliverable | State |
| --- | --- | --- |
| 0. Validate | Reports from existing artifacts | Built. No developer has used the combined view yet |
| 1. See a real project | One command previews or compares a running change. Two separate applications, one non-React, use the same runner without core edits | Complete |
| 2. Repeatable use | Executed recipes, isolated runs, the GitHub Action, export. Failed, missing and stale captures never pass | Complete. An agent set up an unfamiliar app from the README. No person has |
| 3. Extensions | Several checks and journeys, React renders, browser timing, accessibility, browser errors, API operations, Playwright import | Shipped in #26 to #33, before any pilot |
| 3a. MVP | Change scope, protected expectations, generated journeys, and the independent gate corpus | Next. Every [MVP release gate](#mvp-release-gates) must hold |
| 4. Bounded repair | Patch agent driven by the evidence handoff, isolated patches, protected checks, budgets, independent reruns. An agent command in CI for generated journeys | Starts once gates 1 to 8 hold |
| Later | Database, jobs, traces, more frameworks, proof adapters, each tied to a recurring workflow | Not started |

Phase 3a comes first because Observed runs saved journeys on base and
candidate, and nothing related those journeys to the files a pull request
changed. Two probes
on the Request lab example at `ad28490` showed the cost. A fault seeded outside
the saved journey read "No regression". A duplicate request shipped with its
expectation raised from 1 to 2 also read "No regression".

Line delivery and posting modes, the two unshipped parts of the 2026-09-27
delivery refresh, follow the MVP gates. Working code does not establish that
people find Observed useful, so the pilot stays a separate step.

## MVP release gates

No release drops the alpha label until every gate holds. Each gate is a base
and candidate pair with an outcome written before the run. Gates 1 to 7 run on
trial repositories. A checker judges them by reading `result.json` and the raw
producer output, without importing the comparator.

| Gate | Pair | Required result | Status at `ad28490` |
| --- | --- | --- | --- |
| 1. Correct change | A change inside a saved journey that keeps its expectation | No regression, exit 0, and the scope lists the changed file as checked or exercised | Verdict holds. No change scope |
| 2. Seeded fault | One fault per shipped evidence kind, inside a saved journey | Regression, values equal to the raw producer output, exit 2 | Holds for request count in #26's trial. Other kinds need pairs |
| 3. Change outside saved journeys | A fault in captured source that no saved journey exercises | Without an agent, the scope lists the file as not observed. With one, a generated journey runs the changed lines and a baseline check reports the fault | Fails. The probe read "No regression" |
| 4. Missing evidence | Failed base capture, deleted artifact, stale revision, older schema, unsupported collector | Unavailable or unknown, never a pass, exit 1 | Covered by unit tests. Needs pairs |
| 5. Altered expectations | The change relaxes, removes, or rewrites a check or its journey | The result names each altered check and judges it by the base's expectation, with the proposed version beside it | Fails. The probe read "No regression" |
| 6. Intentional change | A visual or copy change with passing checks | An observation, not a regression | Holds in tests. Needs a pair |
| 7. No captured change | A change to docs or to files outside `source.paths` | Says no captured file changed, lists the outside files, and claims nothing about the change | Fails. Nothing states it |
| 8. Observed's own faults | Known faults seeded into copies of the comparator and collector | Unit tests or the gate corpus fail on each fault | Fails for the one fault tried. With "no regression" ranked above "unavailable", all 360 unit tests passed |
| 9. Unfamiliar project | Three projects the maintainers did not write, one non-React, set up by a person with their own agent from the README | A first report without help. Record time and every stall | Not run with people |
| 10. Reading the result | At least three developers outside the project read reports for gates 3 and 5 | Each names what was checked and what was not, without explanation | Not run |

The counts in gates 9 and 10 are proposals. Those two gates need people, so an
agent can prepare them and cannot pass them. Self-observation runs on every
pull request and decides none of these gates.

Probe results, seed diffs and test scripts are in
`evidence/mvp-reconciliation-2026-09-29/`, which Git ignores.

## Decisions

| Date | Decision | Basis |
| --- | --- | --- |
| 2026-09-26 | GitHub and Slack delivery come before the pilot, so participants see results where they work | Maintainer |
| 2026-09-27 | Delivery presents Observed as a proof-check, with source locations and an evidence handoff to the user's own agent | Maintainer |
| 2026-09-28 | Setup needs no GitHub App. The action posts with the workflow token, the job's check carries the verdict, and bare `observed` opens the person's own agent with `observed skill`. An App setup command, a public App, fork comments through `workflow_run`, and installing the skill wait for pilot demand | Maintainer |
| 2026-09-29 | Keep every shipped evidence kind. The pilot removes kinds nobody uses | They are built and tested |
| 2026-09-29 | The PR line reads "N checks passed", then the change scope | The original line said "affected behaviors". The count never was about the change |
| 2026-09-29 | Files not observed are work for the agent, through generated journeys, before they are a report for the person | The stated intent is to avoid manual work. A person decides only what is uncertain, risky, or needs permission |
| 2026-09-29 | Execution coverage is the basis for "exercised": the browser, Node servers and Bun servers | Probes ran on all three. See [ARCHITECTURE.md](ARCHITECTURE.md#change-scope) |
| 2026-09-29 | The base's expectation judges an altered check. The candidate's version is shown as proposed. Merging to base accepts it | Visual baselines work this way in [Chromatic](https://www.chromatic.com/docs/test). Observed has no hosted review step, so the merge is the acceptance |
| 2026-09-29 | A pull request that alters a check fails or is unavailable on that check. Bypass is repository policy | ARCHITECTURE.md gates merges through repository policy. The pilot counts how often this happens |
| 2026-09-29 | With no captured change, capture anyway and say the checks describe unchanged behavior | The run still detects drift in the environment or a stale fixture |
| 2026-09-29 | fast-check 4.10.2 is a dev dependency for properties of pure verdict logic | A property caught the seeded precedence fault that 360 unit tests missed |
| 2026-09-29 | No proof tool is an MVP requirement or a CI dependency | See [optional experiments](#optional-experiments) |
| 2026-09-29 | Three developers for gate 10, then the pilot's six to eight | Enough to find wording that misleads before recruiting more |
| 2026-09-29 | Repair starts when gates 1 to 8 hold, without waiting for the pilot | Repair depends on protected expectations and change scope, not on adoption |

The maintainer delegated the 2026-09-29 rows. Reverse any of them here. Two
things stay with the maintainer. One is recruiting the people for gates 9 and
10. The other is whether a required Observed job gets a bypass rule.

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
| Unrelated failures | Count runs that are unavailable for reasons outside the change, such as the expired self-observe fixture on 2026-09-28. Each one names its cause |
| Change scope | Count changed files still not observed after generated journeys, and how often a person had to step in |
| Detection | Report precision and seeded-regression detection by category. Explain misses and track escaped regressions |
| Continued use | At least three users keep the trigger enabled for two weeks and maintain recipes without recurring author intervention |
| Cost | Saved effort exceeds setup and maintenance. Track browser time, model cost, and storage |

If existing skills and reports solve the problem, publish the smaller solution. If users value one evidence type, narrow scope before adding domains.

## Optional experiments

None of these is an MVP requirement, and running one does not make a result
more reliable. Each stays outside the release path and must beat the simpler
method on the same cases.

Proof tools, first pass on 2026-09-29. Two invariants, each with a correct
model and a seeded fault. The first comes from Observed's code and
says that a run with an unavailable journey never concludes no regression.
The second is an ordering property. It says that a cancel arriving while a
capture runs is never followed by completion.

| | Lean 4.34 | Bend 2.0.34 | TLA+ with TLC 1.8.0 |
| --- | --- | --- | --- |
| Install | About 3 GB | 92 MB. `--verdict` also needs Lean 4.34.0 | 4.5 MB jar and Java |
| Precedence invariant | Proved for any list of journeys, 1.3 s | Proved over presence flags, 0.1 s | Not modeled |
| Cancellation invariant | Proved for any events before the cancel, 0.2 s | Proved for any events after the cancel, 0.1 s | Checked over 4 states, 0.4 s |
| Seeded fault | Proof fails | Proof fails, naming the case and both terms | Counterexample trace of 3 states |
| Open proof | Exit 0 with a warning. `#print axioms` shows `sorryAx` | Exit 1 | Does not apply |
| Adding a verdict kind | 13 changed lines. Proofs untouched, one bound in the statement changed | 36 changed lines. The law and the proof both changed | Not tried |
| Tie to TypeScript | None built in | `-o model.mjs` emits the model as JavaScript. It agreed with `summarizeJourneys` on all 47 cases | None built in |
| Risk | Large install | Released 2026-09-17, and its site says to expect bugs. It asks bend-lang.com for the latest version daily unless `BEND_NO_TELEMETRY=1` is set. Linux and macOS only. `Kind`, `Event` and `State` are taken names | Bounded to the states in the model |

| Need | Tool |
| --- | --- |
| Properties of the real functions, in CI | fast-check |
| A small finite model that needs a conformance run against TypeScript | Bend |
| Statements over unbounded data | Lean |
| Orderings and interleavings, where a counterexample trace is the useful output | TLC |

The cancellation models describe the property. Nobody has tied them to
`src/capture/coordinator.ts`, so they say nothing about Observed's code yet.
A proved model says nothing about an application until a conformance run ties
it to the code.

Jev: [Pydantic AI's documentation](https://pydantic.dev/docs/ai/models/typesafe.md)
describes it as a model that answers typed questions with calibrated
probabilities. Two uses are worth testing, both as proposal sources. One is
writing generated journeys for changes that are not observed, in parallel
browser sessions. The other is routing, which needs roughly 150 to 300 labeled
cases, split by repository or later time, to compare it with rules and the
existing model on missed required checks, abstentions, latency and cost. Jev
never decides a measurement, a permission or a verdict.

Revisit backend priority, a persistent runner, and native React
instrumentation only when pilot evidence identifies a repeated need.

## Keep the plan small

Update the owning document and link to it. Keep the plan to three files, and
add a section only when it changes implementation or acceptance.
[CONFIGURATION.md](CONFIGURATION.md) and [GITHUB.md](GITHUB.md) are reference
for people using Observed, not plan. Three files is a project choice that
follows [Anthropic's context guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
not a proven optimum.
