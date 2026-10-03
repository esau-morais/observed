# Observed product

What people should be able to see, and what the evidence can tell them.
[Architecture](ARCHITECTURE.md) covers implementation and
[Roadmap](ROADMAP.md) covers sequence.

## Purpose

Observed shows the result of a code change in the running application, alone
or beside an earlier version. Each result traces one path: code change →
runtime behavior → evidence.

Observed is a proof-check, not a review bot. Measurements and named checks set
the verdict. A suggested cause or fix is labeled as interpretation and never
changes a verdict or a count. Observed does not walk through the diff or guess
severity.

The person's own coding agent prepares the configuration, runs captures, and
covers what a change touched. The person opens the result and decides only
what is uncertain, risky, or needs permission. Test whether this saves people
work before adding more features.

## First release

One developer, one repository, one to three saved journeys. Browser
applications first, React or not.

1. The agent captures the change through one entry point. People do not write
   manifests or orchestrate capture steps.
2. Observed identifies the changed commit or worktree snapshot and any version
   chosen for comparison.
3. It captures each journey under the same conditions on both versions.
4. It evaluates the named checks, relates the evidence to the changed files,
   and explains unavailable evidence.
5. The person opens the result. Comparisons, source details, checks and
   original artifacts stay one step away.

Viewing reports and evaluating checks need no model and no account. The
project is open source, local by default, and suitable for self-hosting.
Optional model integrations must not become a cloud dependency.
Connecting another application requires no edits to Observed.

## Evidence views

| Evidence | View | Claim limit |
| --- | --- | --- |
| Appearance | A captured page, or images side by side | A visual difference alone is not a regression |
| Interaction and errors | Action timeline, resulting state, error record | Only the exercised path and inputs |
| Network | Request ledger with method, route, status, count | Browser responses do not establish every backend side effect |
| Browser performance | Named samples and spread | Local samples are not production percentiles |
| Accessibility | Names, roles, states, automated findings | Automated checks do not establish complete accessibility |
| React, optional | Relevant subtree, render changes, source references | Instrumentation does not reveal all data flow |
| API operations | Status, schema match, readback | Only the specified operation and controlled data |
| Imported tests | Each Playwright test as a check | Observed did not run the assertions |
| Phase 3a: replay | Base and candidate recordings side by side, with step captions from the action timeline | One recorded run. Not timing evidence |
| Later: database, jobs, traces | Fixture readback, event sequence, linked spans | Schedules and traces do not prove causation |
| Later: formal checks | Property, checker result, assumptions, implementation connection | A proved model is not proof of the application |

## Report behavior

Lead with the evidence that explains the verdict: a failed or unknown check's
evidence when present, otherwise the captured application. With a change
scope, that evidence opens beside the [change map](#change-map). A requested
comparison shows both versions and names any missing capture. A standalone
preview needs no baseline. Checks and technical details sit one disclosure
away.

Keep these dimensions separate:

| Dimension | Values |
| --- | --- |
| Execution | Complete, capture failed, unavailable |
| Difference | Unchanged, changed, unavailable |
| Named check | Passed, failed, unknown, not run |
| Check against base | Regression, when the base passed the same expectation |
| Run conclusion | Regression, check failed, unavailable, no regression, not checked, preview |
| Artifact integrity | Hash matched, unavailable |
| Interpretation | Expected change, suspected regression, confirmed regression |

- A behavior can change while its checks pass.
- A regression is a comparable passing baseline that now fails the same
  expectation. If another rule establishes a failure, name the rule and
  disclose any missing baseline.
- Missing evidence never becomes a pass, and an absent check is not a pass.
- A check that one side lacks reads "not run" on that side when its capture
  completed, and "unknown" when the capture did not complete.
- A source location is a fact about where evidence was read: "thrown at
  App.jsx:10", never "caused by App.jsx:10". Show a line only when the
  evidence places it there, or when a name matches a changed line and is
  labeled as a match. Otherwise show no line.
- Counts refer to named checks. Never imply complete coverage of the change or
  readiness to merge.

### Writing

Generated text follows a reduced form of ASD-STE100, the controlled English
written for aircraft maintenance manuals. Observed copies its rules, not its
dictionary, which ASD holds the copyright to.

- Each status word has one meaning, defined once in `statusWords` in
  `src/result-text.ts`. A test over the report, the PR comment, and the agent
  handoffs rejects synonyms such as "verified", "safe", and "no issues".
- An instruction has at most 20 words and tells the reader to do one thing. A
  statement of fact has at most 25 words.
- Facts and instructions stay in separate sections. The agent handoff lists
  the facts, then the next steps.
- A check is named after the behavior it protects, such as "Each Load items
  click sends one item request". The setup guide asks the agent for names in
  this form. A journey is named after the user's action, such as "Load items".
  The PR comment leads with the name of each failed or unknown check, then
  the count line.
- No analogies and no "explain like I'm five" version. An analogy adds claims
  that the evidence does not make: two captured requests are not proof of a
  double charge. Check names supply the plain words.

## Change scope

Built as `result.json` data and as text in the report, the job summary, and
the pull request comment. The change map, coverage, recipe differences, and
generated journeys are not built. Until coverage is, no file is "exercised"
through coverage.

A saved journey checks the behavior it exercises. It does not check the
change. Every comparison lists each file that differs between base and
candidate with one relation:

| Relation | Meaning | Claim limit |
| --- | --- | --- |
| Checked | A named check evaluated evidence that touched the file | Only that check's expectation and scope |
| Exercised | Execution coverage or another record shows that lines in scope ran in a journey | The code ran. Nothing says it ran correctly |
| Not observed | No evidence touched the lines in scope | Nothing is known about those lines |
| Outside the captured source | The file changed outside the project's `source.paths` | Neither snapshot contains it |

The lines in scope depend on the view. In the change map they are the file's
changed lines. In the [repository map](#repository-map), which has no diff,
they are all of the file's lines.

Each relation records its basis, such as execution coverage, a stack frame, a
component source, or a test location. Label a name match as a match. With no
basis the relation is "not observed", never a guess. Coverage counts the lines
in scope that ran and the lines that did not, so a journey can exercise part
of a file. A file that no collector can execute, such as a stylesheet, a type
declaration, or code for a server runtime without a collector, is "not
observed" with that reason, and the agent spends no budget on it.

### Change map

The report draws the change scope as a map. The table of changed files stays
as the map's text version, with the same facts, so the map makes no claim that
the table lacks.

- A block is a changed file, or a file that imports one or is imported by one.
  Blocks group by directory. Selecting a directory opens it, and Escape goes
  back up. A package outside the captured source is one block, outside the
  directory groups.
- A changed file's chip is its relation: checked, exercised, not observed, or
  outside the captured source. Unchanged files give context and have no chip.
- Each connection comes from evidence records of one type, and each type has
  one source:

| Connection | Source |
| --- | --- |
| Imports | The static import graph of each snapshot |
| Ran in | Execution coverage, with the count of lines in scope that ran and that did not |
| Requested | The request ledger: method, route, status, and count on each side |
| Threw at | An error record and its stack frame |
| Checked by | A named check and its scope |

- Pointing at a block dims every block without a connection to it. Journeys
  are a separate layer, and their connections show only on hover or
  selection.
- Selecting a block opens a side panel with its changed lines, the journeys
  that ran them, the checks that covered them, and the artifact paths. A
  connection's label is its evidence, such as "GET /api/items: 2 requests,
  base 1".
- When a comparison has a change scope, the map is the report's main view.
  The side panel opens on the evidence that explains the verdict: a failed or
  unknown check's evidence when present, otherwise the captured application.
  A preview has no change scope and opens on the captured application.

### Repository map

Without a change, the same map covers every file in `source.paths`. Every
file gets a chip from the latest capture, with the relations above: checked,
exercised, or not observed. The map shows what Observed
watches in the project and what it does not. It does not show services, data
stores, or production traces.

### Agent descriptions

The person's agent can supply a short description of each block and
connection, in a file of its own for one run. Each description names the
source files it was written from and follows the writing rules above. The map
shows descriptions in the inference color, labeled as written by the
agent. They never set a chip, a count, or a verdict, and the map works without
them. Observed does not call a model to write them.

### Generated journeys

The agent writes journeys for files that are not observed. The report lists
what is still not observed afterwards.

1. The agent reads the scope and writes journeys aimed at the files that are
   not observed.
2. Observed runs them on base and candidate like any journey, and coverage
   shows whether they reached the changed lines.
3. Generated journeys carry baseline checks, which need no written
   expectation: no new browser errors, no new serious accessibility
   violations, and no new server errors. A new server error is a response of
   500 or above that the base did not give for the same request. Other
   differences are observations, so a fault that returns wrong data without
   an error is listed as a difference and sets no verdict.
4. A generated journey that reached changed code is proposed for saving, so
   the next change starts with it. A project that already has three saved
   journeys gets the proposal as a replacement for one of them. Observed never
   drops a saved journey itself.

Generated journeys are labeled as generated, live outside `observed.json`, and
never replace or alter a saved check. A run has a budget for them. What stays
not observed after the budget is reported with the reason, such as missing
credentials or a path that needs data the run does not have.

Without an agent, Observed reports the scope and stops there. Its checks and
its report never need a model.

### Altered checks

When `observed.json` differs between base and candidate, the result names
each added, removed, or altered journey and check. The base's expectation is
the protected one.

| Difference | How Observed judges the check |
| --- | --- |
| Expectation altered | By the base's expectation. The candidate's version is shown beside it as proposed, with its own outcome, and sets no verdict |
| Check removed | By the base's definition, when the evidence it needs was still captured. Otherwise unknown |
| Check added | On the candidate, labeled "added by this change", with no baseline |
| Journey steps altered | Every check in that journey is unknown, with both versions of the steps shown |
| Imported test whose file changed | By the candidate's file, labeled as changed by this change. A failure is not called a regression, and a pass carries the label |

A relaxed expectation cannot turn a fault into a pass. An intended contract
change fails or stays unknown on the pull request that makes it, and resolves
once it is on the base. Whether that pull request may merge is repository
policy, not a verdict.

### Wording

A run whose checks all pass while files are not observed reads "No regression
in the named checks", followed by the count of files not observed. It never
reads as a verified change. When no captured file changed, say so, because
the checks then describe unchanged behavior.

## What each source establishes

| Source | Establishes | Does not establish |
| --- | --- | --- |
| Executed capture | What the application did on the exercised path under recorded conditions | Behavior on other paths or conditions |
| Named check | Whether that evidence met one stated expectation | That the expectation is the right one, or that the change is correct |
| Agent proposal | A journey, check, cause, or fix worth trying | Anything, until Observed runs it |
| Formal result | A stated property of a model under named assumptions and a named checker | That the implementation matches the model |
| Self-observation | That Observed's viewer passes its own saved journeys | That the collector, comparator, or delivery is correct |

## Self-correction and self-improvement

| Loop | What changes | First release | Later |
| --- | --- | --- | --- |
| Self-correction | The application's code, after a failed check | The evidence handoff prompt for the user's own agent | [Bounded repair](ARCHITECTURE.md#bounded-repair-later): patch, new run, same protected checks |
| Self-improvement | The journeys, after a change that is not observed | Generated journeys, run locally through the agent's guide | The same loop in CI through a configured agent command |

Neither loop may edit the expectation that judges it. A repair that changes a
check, and a proposal that weakens one, are recipe differences, and the rules
for altered checks apply.

## GitHub, Slack, and unattended use

GitHub and Slack deliver the same revision-bound result. They are not
evidence types or separate verdict engines. One check and at most one summary
comment cover every evidence type from a run, with a report link. Line-level
output appears only where a finding has a source location.
[GITHUB.md](GITHUB.md) describes what ships today.

- The action posts with the workflow's own token, so a first result needs no
  GitHub App, secret, or hosted service.
- The job's own check carries the verdict, so there is one check to require on
  every pull request, forks and Dependabot included.
- Every run states what it posted and what it skipped, with the reason. A
  skipped delivery never changes the verdict.
- The PR line names the head commit and leaves out "automatically fixed"
  until repair exists. It reads "N checks passed", then each count of
  regressed, failed, unknown, and not run checks that is not zero, such as
  "4 checks passed · 1 failed". The target adds the change scope, such as
  "2 of 7 changed files not observed".
- Generated journeys run locally in the first release. A run in CI lists the
  files that are not observed and adds them to the agent prompt.
- Reuse established permissions for routine work. Ask when intent,
  credentials, risk, or an unapproved action prevents progress.
- Update an existing result instead of adding a message for every retry.

Planned posting modes, set by the `comment` input:

| Mode | Behavior |
| --- | --- |
| `always` (default) | Post or update the check and the comment on every run |
| `quiet` | Always post the check. Comment only when a result fails or is unknown, and still update an existing comment when the result recovers |
| `mention` | Run only when a PR comment starts with `/observed`. A slash command, because an @handle can notify a real user |

Each result includes a deterministic prompt for the user's own agent: the
values, commit SHAs, source locations, artifact paths, and the reminder that a
changed value is not a regression by itself. The files not observed join it
with the change scope. Observed writes no model-generated fix. A suggestion block appears
only for a mechanical fix.

Mobile access needs an accessible report copy. Remote actions need a
reachable runner, such as existing CI or a self-hosted worker, and wait for
authorization and run identity work. Show offline, queued, stale, and expired
states.

## First success and exclusions

Open a useful capture from a real project, then repeat it on another project
without editing Observed's source. Seed a duplicate request while leaving the
UI unchanged. The check catches it and exposes the requests. Intentional
visual changes remain observations. A requested baseline that cannot be
captured remains unavailable.

The first release that drops the alpha label must pass the
[MVP release gates](ROADMAP.md#mvp-release-gates). Until a later phase these stay unsupported, and the README lists them:
automatic repair, generated journeys in CI, formal proof adapters, model
routing, coverage for server runtimes other than Node and Bun, remote rerun
actions, and database, job, and trace evidence. Bun coverage depends on
mapping its offsets to source lines, which is untested.

Also deferred: a new agent runtime, a mandatory daemon, a graph of services
and data stores beyond the captured source, a plugin marketplace, generic
production observability, automatic merging, billing, Kubernetes, and broad
framework support.

## Background

The maintainer supplied eight screenshots of the posts that motivated the
project. They show formal models written from code and turned into bug-fix
pull requests, screenshots made for every pushed feature, parallel
adversarial browser testing with a small fast model, live React tree and
data-flow diagrams, and a before-and-after skill for pull requests. Their PR
counts, costs, and shipping claims are not planning assumptions. Broader
context: [Stack Overflow AI survey](https://survey.stackoverflow.co/2025/ai)
and [DORA 2025](https://dora.dev/research/2025/dora-report/). Neither
replaces a pilot of Observed.
