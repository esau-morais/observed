# Observed product

What people should be able to see, and what the evidence can tell them.
[Architecture](ARCHITECTURE.md) covers implementation; [Roadmap](ROADMAP.md) covers
the next steps.

## Purpose

Observed lets you see the result of a code change in the running application.
Compare with an earlier version when useful. Each result traces one path:
code change → runtime behavior → evidence.

Observed is a proof-check, not another review bot. Proof decides: measurements
and named checks set the verdict. Prediction assists: a suggested cause or fix is
labeled as interpretation and never changes a verdict or a count. Observed does
not walk through the diff, guess severity, or add commentary the evidence does not
support.

For a new checkout, show the completed screen. For a layout fix, put the old and
new versions side by side. If the page looks right but sends duplicate requests,
keep those requests close enough to inspect.

An existing coding agent can prepare the project configuration and run captures.
The person opens the result. Test whether this saves people work before adding
more features.

## First release

Support one developer, one repository, and one to three saved captures. Show the
current application on its own or compare identified versions. Start with browser
applications; capture must work with React and non-React apps.

1. The existing agent captures the change through one project entry point. It can prepare the project configuration; people do not author manifests or orchestrate capture steps.
2. Identify the changed commit or worktree snapshot and any version chosen for comparison.
3. Capture the configured page or interaction. Use the same capture conditions when comparing versions.
4. Evaluate any configured checks and explain unavailable evidence.
5. Open the captured result. Keep comparisons, source details, checks, and original artifacts available on demand.

Use existing agents and capture tools. Viewing reports and evaluating explicit checks require no model or account. Keep the project open source, local by default, and suitable for self-hosting. Optional model integrations must not become a cloud dependency.

Project configuration supplies source selection, startup, readiness, browser actions,
and expectations. Connecting another application must require no edits to Observed.
A bundled demonstration is an integration test of this same public workflow.

## Evidence views

| Evidence | View | Claim limit |
| --- | --- | --- |
| Appearance | A captured page, or images side by side | A visual difference alone is not a regression |
| Interaction and errors | Action timeline, resulting state, error record | Only the exercised path and inputs |
| Network | Request ledger with method, route, status, count | Browser responses do not establish every backend side effect |
| Browser performance | Named samples and spread | Local samples are not production percentiles |
| Accessibility | Names, roles, states, automated findings | Automated checks do not establish complete accessibility |
| React, optional | Relevant subtree, render changes, source references | Instrumentation does not reveal all data flow |
| Later API and database checks | Contract comparison and fixture readback | Only the specified operation and controlled data |
| Later jobs and traces | Event sequence and linked spans | Observed schedules and traces do not prove causation |
| Later formal checks | Property, checker result, assumptions, implementation connection | A proved model is not proof of the whole application |

## Report behavior

Lead with the captured application. When a comparison was requested, show both
versions and identify any missing capture. A standalone preview needs no baseline.
Keep checks and technical details one disclosure away. Absent checks do not become
passes. Label agent interpretations when present.

Keep these dimensions separate:

| Dimension | Values |
| --- | --- |
| Execution | Complete, blocked, failed |
| Difference | Unchanged, changed, unavailable |
| Named check | Passed, failed, unknown, not configured |
| Interpretation | Expected change, suspected regression, confirmed regression |

A behavior can change while its checks pass. Call it a regression when a comparable passing baseline now fails the same expectation. If another explicit correctness rule establishes a failure, name that rule and disclose any missing baseline. Missing evidence never becomes a pass. AI interpretations remain labeled suggestions.

A source location is stated as a fact about where evidence was read: "thrown at
App.jsx:10", never "caused by App.jsx:10". Show a line only when the evidence
places it there. When nothing does, show no line rather than a guess.

Illustrative summary: "One filter action sent 1 request before and 4 after. The saved check allows 1. Seven of eight checks passed; checkout was outside scope." Counts refer to actual named checks. Never imply complete change coverage or unconditional merge readiness.

## GitHub, Slack, and unattended use

GitHub and Slack deliver the same revision-bound result. They are not evidence types or separate verdict engines. One check and one comment cover every evidence type from a run, with a report link. Line-level output appears only where a measurement has a source location.

The PR line takes the shape "N issues found · N behaviors verified · N unresolved". Leave out "automatically fixed" until repair exists, and never say "ready to merge". Name the head commit the result describes.

| Delivery mode | Behavior |
| --- | --- |
| `always` (default) | Post the check and the comment on every run |
| `quiet` | Always post the check. Comment only when a result fails or is unknown, and still update an existing comment when the result recovers |
| `mention` | Run only when a PR comment starts with `/observed`. A slash command, because an @handle can notify a real user |

Update an existing result instead of adding a message for every retry. Reuse established permissions for routine work. Ask when intent, credentials, risk, or an unapproved action prevents progress.

Self-correction starts with an evidence handoff. Each result includes a deterministic prompt the user can give their own agent: the values, commit SHAs, source locations, artifact paths, and the reminder that a changed value is not a regression by itself and must be checked against the artifacts. Observed does not write the fix. Patching and re-verification belong to [Phase 4](ROADMAP.md#milestones), and rerun actions wait for authorization and run identity work.

Mobile access needs an accessible report copy. Remote actions need a reachable runner, such as existing CI or a self-hosted worker. Show offline, queued, stale, and expired states; a sleeping laptop cannot execute a rerun.

## First success and exclusions

Open a useful capture from a real project. A new screen works as a standalone
preview; a requested comparison shows the selected versions. Repeat this on
another project without editing Observed's source.

Then seed a duplicate request while leaving the UI unchanged. The optional check
should catch it and expose the requests. Intentional visual changes remain
observations. A requested baseline that cannot be captured remains unavailable.

Automatic repair follows this milestone. Defer a new agent runtime, mandatory daemon, universal graph, plugin marketplace, generic production observability, automatic merging, billing, Kubernetes, and broad framework support.

## Background

The supplied screenshots motivate inspection across evidence types; their PR counts, costs, and shipping claims are not planning assumptions. Broader context: [Stack Overflow AI survey](https://survey.stackoverflow.co/2025/ai) and [DORA 2025](https://dora.dev/research/2025/dora-report/). Neither replaces a pilot of Observed.
