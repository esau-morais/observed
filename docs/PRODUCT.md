# Observed product

Decision baseline, 23 September 2026. Read this file for scope, user experience, and acceptance behavior. Read [ARCHITECTURE.md](ARCHITECTURE.md) for implementation boundaries or [ROADMAP.md](ROADMAP.md) for the next milestone. Contributor rules and stack choices live in [AGENTS.md](../AGENTS.md); visual rules live in [DESIGN.md](../DESIGN.md).

## Purpose

Observed helps developers understand what a software change did. Its product unit is a portable change report connecting a behavior or operation to before/after evidence, relevant source locations, and the limits of the checks performed.

The target user repeatedly reconstructs environments, replays actions, collects evidence, or questions an agent's claim that work is complete. High shipping volume is optional. The product hypothesis is that a combined report saves more effort than the user's existing skills and tools. Validate that before expanding scope.

## First release

Support one developer, one repository, two comparable application versions, and one to three saved journeys. Start with browser applications, validated initially on React. React instrumentation is optional; browser evidence must also work on a non-React sample.

1. Reuse a verification recipe or let the current agent propose one.
2. Identify the base revision and candidate commit or worktree snapshot.
3. Run the same journey against isolated versions, or import a compatible baseline.
4. Capture evidence, compare named expectations, and explain unavailable observations.
5. Open the report locally and export the report with its evidence bundle.

Use existing agents and capture tools. Viewing reports and evaluating explicit checks require no model or account. Keep the project open source, local by default, and suitable for self-hosting. Optional model integrations must not become a cloud dependency.

## Evidence views

| Evidence | View | Claim limit |
| --- | --- | --- |
| Appearance | Paired images and changed regions | A visual difference alone is not a regression |
| Interaction and errors | Action timeline, resulting state, error record | Only the exercised path and inputs |
| Network | Request ledger with method, route, status, count | Browser responses do not establish every backend side effect |
| Browser performance | Named samples and spread | Local samples are not production percentiles |
| Accessibility | Names, roles, states, automated findings | Automated checks do not establish complete accessibility |
| React, optional | Relevant subtree, render changes, source references | Instrumentation does not reveal all data flow |
| Later API and database checks | Contract comparison and fixture readback | Only the specified operation and controlled data |
| Later jobs and traces | Event sequence and linked spans | Observed schedules and traces do not prove causation |
| Later formal checks | Property, checker result, assumptions, implementation connection | A proved model is not proof of the whole application |

## Report behavior

Lead with the conclusion, important difference, and incomplete checks. Keep revision pair, recipe, environment, and capture time reachable. Expand into the appropriate evidence view, then original artifacts or native diagnostic viewers. Use source links only where evidence supports them; label inferred associations.

Keep these dimensions separate:

| Dimension | Values |
| --- | --- |
| Execution | Complete, blocked, failed |
| Difference | Unchanged, changed, unavailable |
| Named check | Passed, failed, unknown |
| Interpretation | Expected change, suspected regression, confirmed regression |

A behavior can change while its checks pass. Call it a regression when a comparable passing baseline now fails the same expectation. If another explicit correctness rule establishes a failure, name that rule and disclose any missing baseline. Missing evidence never becomes a pass. AI interpretations remain labeled suggestions.

Illustrative summary: "One filter action sent 1 request before and 4 after. The saved check allows 1. Seven of eight checks passed; checkout was outside scope." Counts refer to actual named checks. Never imply complete change coverage or unconditional merge readiness.

## GitHub, Slack, and unattended use

GitHub and Slack deliver the same revision-bound result. They are not evidence types or separate verdict engines. Start with concise delivery and a report link. Add rerun and fix actions after authorization and run identity work.

Update an existing result instead of adding a message for every retry. Notify on meaningful failures or decisions; use quiet updates or digests for ordinary success. Reuse established permissions for routine work. Ask when intent, credentials, risk, or an unapproved action prevents progress.

Mobile access needs an accessible report copy. Remote actions need a reachable runner, such as existing CI or a self-hosted worker. Show offline, queued, stale, and expired states; a sleeping laptop cannot execute a rerun.

## First success and exclusions

On a real app, seed duplicate requests that existing tests miss while appearance remains unchanged. Show the passing base, failed candidate, request evidence, and available source association. A reader should locate the failure without reproducing it manually. Also handle intentional visual change and unavailable baseline correctly.

Automatic repair follows this milestone. Defer a new agent runtime, mandatory daemon, universal graph, plugin marketplace, generic production observability, automatic merging, billing, Kubernetes, and broad framework support.

## Background

The supplied screenshots motivate inspection across evidence types; their PR counts, costs, and shipping claims are not planning assumptions. Broader context: [Stack Overflow AI survey](https://survey.stackoverflow.co/2025/ai) and [DORA 2025](https://dora.dev/research/2025/dora-report/). Neither replaces a pilot of Observed.
